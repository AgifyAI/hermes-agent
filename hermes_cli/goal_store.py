"""Durable goal state: the versioned goal model, its compare-and-set store, and its event journal.

A goal is a free-form objective that stays active across turns. This module owns *what a goal is*
and *how it survives* a process restart: phases, rounds, token accounting, the completion contract,
quality gates, wait barriers, the append-only event journal, and the optimistic-concurrency write
that refuses a stale revision instead of silently overwriting another surface's edit.

The engine (judge prompts, round decisions, driver) stays in :mod:`hermes_cli.goals`, which
re-exports every name here so surfaces keep importing ``hermes_cli.goals``.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass, field, asdict, fields as dataclass_fields
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)


# ── Constants ─────────────────────────────────────────────────────────

DEFAULT_MAX_ROUNDS = 20
DEFAULT_GATE_TIMEOUT_SECONDS = 300
DEFAULT_GATE_MAX_RETRIES = 3
# Bounded tail of a failed gate's combined stdout/stderr fed back to the agent.
_GATE_OUTPUT_TAIL_CHARS = 3000
# Growth bound for the per-goal journal: enough to audit a long run, small enough that every
# state write stays a few KB (the row is rewritten atomically on each mutation).
MAX_EVENTS = 200

# Lifecycle phases (union of Codex CLI's statuses and DeepSeek Harness' phases).
GOAL_PHASES = ("active", "paused", "blocked", "budget_limited", "complete")
# ``cleared`` is not a lifecycle phase: it marks the row a user cleared so the audit trail
# survives, and every surface treats it as "no goal".
TERMINAL_PHASES = frozenset({"complete", "cleared"})

_LEGACY_STATUS_TO_PHASE = {
    "active": "active",
    "paused": "paused",
    "done": "complete",
    "cleared": "cleared",
    "blocked": "blocked",
    "budget_limited": "budget_limited",
    "complete": "complete",
}
# What old readers (RPC payloads, tests, Desktop before its phase rollout) call each phase.
_PHASE_TO_LEGACY_STATUS = {
    "active": "active",
    "paused": "paused",
    "blocked": "paused",
    "budget_limited": "paused",
    "complete": "done",
    "cleared": "cleared",
}


# ── Errors ────────────────────────────────────────────────────────────

class GoalError(RuntimeError):
    """Base for goal-domain refusals; a RuntimeError so existing command handlers catch it."""


class GoalStaleRevision(GoalError):
    """A write carried a revision another surface already moved past."""

    code = "GOAL_STALE_REVISION"

    def __init__(self, session_id: str, expected: int, actual: int) -> None:
        self.session_id = session_id
        self.expected = expected
        self.actual = actual
        super().__init__(
            f"GOAL_STALE_REVISION: goal for {session_id} is at revision {actual}, "
            f"not {expected} — reload and retry"
        )


class GoalAlreadyActive(GoalError):
    """One unfinished goal per session: create, edit or clear it instead of overwriting."""

    code = "GOAL_ALREADY_ACTIVE"

    def __init__(self, goal: str) -> None:
        self.goal = goal
        super().__init__(
            "a goal is already in progress; rewrite it preserving its rounds, criteria, gates and "
            "contract (/goal edit <text>), or clear it first (/goal clear)"
        )


# ── Completion contract ───────────────────────────────────────────────

# The five contract fields, in display order (after OpenAI Codex's "strong goal" guidance: what
# "done" means, how to prove it, what must not regress, what is in bounds, when to stop and ask).
# A bare free-form goal stays fully supported — empty fields are omitted from every prompt.
_CONTRACT_FIELDS = ("outcome", "verification", "constraints", "boundaries", "stop_when")

_CONTRACT_LABELS = {
    "outcome": "Outcome", "verification": "Verification", "constraints": "Constraints",
    "boundaries": "Boundaries", "stop_when": "Stop when blocked",
}

# Inline-input aliases the user may type before a value (`verify: tests pass`, `done when: ...`).
_CONTRACT_ALIASES = {
    "outcome": "outcome", "goal": "outcome", "done": "outcome", "done when": "outcome",
    "verification": "verification", "verify": "verification", "verified by": "verification",
    "evidence": "verification", "proof": "verification",
    "constraints": "constraints", "constraint": "constraints", "preserve": "constraints",
    "must not": "constraints", "do not change": "constraints",
    "boundaries": "boundaries", "boundary": "boundaries", "scope": "boundaries",
    "allowed": "boundaries", "files": "boundaries",
    "stop when": "stop_when", "stop_when": "stop_when", "blocked": "stop_when",
    "stop if blocked": "stop_when", "give up when": "stop_when",
}


@dataclass
class GoalContract:
    """Optional structured completion contract; empty fields are omitted everywhere."""
    outcome: str = ""
    verification: str = ""
    constraints: str = ""
    boundaries: str = ""
    stop_when: str = ""

    def is_empty(self) -> bool:
        return not any(getattr(self, f).strip() for f in _CONTRACT_FIELDS)

    def to_dict(self) -> dict[str, str]:
        return {f: getattr(self, f) for f in _CONTRACT_FIELDS}

    @classmethod
    def from_dict(cls, data: Optional[dict[str, Any]]) -> GoalContract:
        if not isinstance(data, dict):
            return cls()
        return cls(**{f: str(data.get(f) or "").strip() for f in _CONTRACT_FIELDS})

    def render_block(self) -> str:
        """Non-empty fields as a labelled block; empty contract → empty string."""
        return "\n".join(
            f"- {_CONTRACT_LABELS[f]}: {getattr(self, f).strip()}"
            for f in _CONTRACT_FIELDS if getattr(self, f).strip()
        )


def parse_contract(text: str) -> tuple[str, GoalContract]:
    """Split user-typed goal text into a headline + contract from inline ``field: value`` lines.

    A headline without an explicit ``outcome:`` IS the outcome — it is not duplicated into the
    contract block (the goal text already carries it), so outcome stays empty in that case.
    """
    if not text:
        return "", GoalContract()
    headline_parts: list[str] = []
    values: dict[str, list[str]] = {f: [] for f in _CONTRACT_FIELDS}
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if ":" in line:
            prefix, _, value = line.partition(":")
            key = _CONTRACT_ALIASES.get(prefix.strip().lower())
            if key is not None and value.strip():
                values[key].append(value.strip())
                continue
        headline_parts.append(line)
    contract = GoalContract(**{f: " ".join(v).strip() for f, v in values.items()})
    return " ".join(headline_parts).strip(), contract


def render_extra_criteria(subgoals: list[str]) -> str:
    return "\n".join(f"- Extra criterion {i}: {text}" for i, text in enumerate(subgoals, start=1))


# ── Quality gates ─────────────────────────────────────────────────────

@dataclass
class GoalGate:
    """A deterministic shell command that must pass before a goal can be done.

    Gates run at turn boundary before the goal is allowed to complete; a failing gate short-circuits
    the round decision and its bounded output becomes the continuation prompt.
    """
    command: str
    timeout_seconds: int = DEFAULT_GATE_TIMEOUT_SECONDS
    max_retries: int = DEFAULT_GATE_MAX_RETRIES
    attempts: int = 0
    last_exit_code: Optional[int] = None
    last_output_tail: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Optional[dict[str, Any]]) -> GoalGate:
        if not isinstance(data, dict):
            return cls(command="")
        try:
            exit_code = int(data["last_exit_code"]) if data.get("last_exit_code") is not None else None
        except (TypeError, ValueError):
            exit_code = None
        return cls(
            command=str(data.get("command") or ""),
            timeout_seconds=int(data.get("timeout_seconds") or DEFAULT_GATE_TIMEOUT_SECONDS),
            max_retries=int(data.get("max_retries") or DEFAULT_GATE_MAX_RETRIES),
            attempts=int(data.get("attempts") or 0),
            last_exit_code=exit_code,
            last_output_tail=str(data.get("last_output_tail") or ""),
        )


def gate_workspace() -> tuple[Optional[str], Optional[str]]:
    """``(cwd, refusal)`` for this check's gates. A multi-session backend's process directory is not
    the session's project, so gates run in the scoped session workspace (#125369). A declared
    workspace that is not a directory on this host (deleted, remote, container) is a refusal: a
    relative gate run anywhere else would check a different project and could pass a failing goal,
    and no agent turn can fix it, so the caller pauses instead of retrying.
    No declared workspace keeps the classic resolution (TERMINAL_CWD, else the launch directory)."""
    from agent.runtime_cwd import resolve_agent_cwd, scoped_session_cwd

    declared = scoped_session_cwd()
    if declared:
        path = Path(declared).expanduser()
        if path.is_dir():
            return str(path), None
        return None, (f"the session workspace {declared} is not a directory on this host, "
                      "and running gates anywhere else would check a different project")
    try:
        return str(resolve_agent_cwd()), None
    except OSError:
        return None, None  # deleted launch directory: subprocess reports it per gate


def run_gate(gate: GoalGate, *, cwd: Optional[str] = None) -> tuple[bool, int, str]:
    """Run one gate through the shell. Returns ``(passed, exit_code, output_tail)``; a timeout kills
    the process and counts as exit code -1."""
    try:
        # utf-8/replace: operator-configured output is arbitrary bytes; strict codepage decoding of
        # one unmappable byte (emoji/CJK on a non-UTF-8 Windows console) kills the reader thread and
        # the tail the agent needs arrives empty.
        proc = subprocess.run(
            gate.command, shell=True, capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=max(1, int(gate.timeout_seconds)), cwd=cwd or None,
            check=False,
        )
        combined = (proc.stdout or "") + (("\n" + proc.stderr) if proc.stderr else "")
        return proc.returncode == 0, proc.returncode, combined[-_GATE_OUTPUT_TAIL_CHARS:]
    except subprocess.TimeoutExpired as exc:
        out = "".join(c if isinstance(c, str) else c.decode("utf-8", "replace") for c in (exc.stdout, exc.stderr) if c)
        return False, -1, (out + f"\n[gate timed out after {gate.timeout_seconds}s]")[-_GATE_OUTPUT_TAIL_CHARS:]
    except Exception as exc:
        return False, -1, f"[gate could not run: {type(exc).__name__}: {exc}]"


# ── Goal state ────────────────────────────────────────────────────────

@dataclass(init=False)
class GoalState:
    """Versioned, serializable goal state stored per session.

    Canonical fields are the model the whole system reads (``phase``, ``rounds_started``,
    ``max_rounds``, token accounting, ``blocked_reason``). ``status``, ``turns_used`` and
    ``max_turns`` are read/write *views* kept so old rows, old callers and old RPC payloads keep
    working while every surface migrates at its own pace.
    """

    goal: str = ""
    goal_id: str = ""
    revision: int = 0
    phase: str = "active"
    rounds_started: int = 0
    max_rounds: int = DEFAULT_MAX_ROUNDS
    # Token budget (0 = unset → the round cap is the only budget). ``tokens_used`` is cumulative for
    # this goal and is what the closing reserve is computed from.
    token_budget: int = 0
    tokens_used: int = 0
    time_used_seconds: float = 0.0
    created_at: float = 0.0
    updated_at: float = 0.0
    last_turn_at: float = 0.0
    last_verdict: Optional[str] = None        # "done" | "blocked" | "continue" | "wait" | "skipped"
    last_reason: Optional[str] = None
    paused_reason: Optional[str] = None       # why the goal is paused (budget, wait, user)
    blocked_reason: Optional[dict] = None     # {"code", "message"} when phase == "blocked"
    # Judge reliability trackers (kept in the durable row so an auto-pause survives a restart).
    consecutive_parse_failures: int = 0       # unparseable judge replies in a row
    # Tracked separately from parse failures: a broken API key returns 401 every call and must
    # auto-pause instead of burning the budget on an unreachable judge.
    consecutive_transport_failures: int = 0   # judge API/transport errors in a row
    subgoals: list[str] = field(default_factory=list)
    # Wait barrier: parks the loop instead of re-poking the agent into busy-work. pid → until exit;
    # session → until that process_registry session's OWN trigger fires (exit OR watch_patterns
    # match); until → wall-clock deadline. Defaults empty so old state_meta rows load unchanged.
    waiting_on_pid: Optional[int] = None
    waiting_on_session: Optional[str] = None
    waiting_until: float = 0.0
    waiting_on_delegations: int = 0
    waiting_reason: Optional[str] = None
    waiting_since: float = 0.0
    contract: GoalContract = field(default_factory=GoalContract)
    gates: list[GoalGate] = field(default_factory=list)
    # Append-only audit journal: one entry per mutation, oldest first, bounded to MAX_EVENTS.
    events: list[dict] = field(default_factory=list)

    def __init__(
        self,
        goal: str = "",
        *,
        goal_id: str = "",
        revision: int = 0,
        phase: Optional[str] = None,
        status: Optional[str] = None,
        rounds_started: Optional[int] = None,
        turns_used: Optional[int] = None,
        max_rounds: Optional[int] = None,
        max_turns: Optional[int] = None,
        token_budget: int = 0,
        tokens_used: int = 0,
        time_used_seconds: float = 0.0,
        created_at: float = 0.0,
        updated_at: float = 0.0,
        last_turn_at: float = 0.0,
        last_verdict: Optional[str] = None,
        last_reason: Optional[str] = None,
        paused_reason: Optional[str] = None,
        blocked_reason: Optional[dict] = None,
        consecutive_parse_failures: int = 0,
        consecutive_transport_failures: int = 0,
        subgoals: Optional[list] = None,
        waiting_on_pid: Optional[int] = None,
        waiting_on_session: Optional[str] = None,
        waiting_until: float = 0.0,
        waiting_on_delegations: int = 0,
        waiting_reason: Optional[str] = None,
        waiting_since: float = 0.0,
        contract: Optional[GoalContract] = None,
        gates: Optional[list] = None,
        events: Optional[list] = None,
    ) -> None:
        # Legacy rows/callers pass ``status``/``turns_used``/``max_turns``; the new names win when both
        # are present so a modern writer is never downgraded by a compatibility alias.
        resolved_phase = (phase or _LEGACY_STATUS_TO_PHASE.get(str(status or "active").lower(), "active"))
        if resolved_phase not in GOAL_PHASES and resolved_phase != "cleared":
            resolved_phase = "active"
        self.goal = str(goal or "")
        self.goal_id = str(goal_id or "")
        self.revision = int(revision or 0)
        self.phase = resolved_phase
        self.rounds_started = int(turns_used if rounds_started is None and turns_used is not None
                                  else (rounds_started or 0))
        self.max_rounds = int(max_turns if max_rounds is None and max_turns is not None
                              else (max_rounds or DEFAULT_MAX_ROUNDS))
        if self.max_rounds < 1:
            self.max_rounds = DEFAULT_MAX_ROUNDS
        self.token_budget = max(0, int(token_budget or 0))
        self.tokens_used = max(0, int(tokens_used or 0))
        self.time_used_seconds = float(time_used_seconds or 0.0)
        self.created_at = float(created_at or 0.0)
        self.updated_at = float(updated_at or 0.0)
        self.last_turn_at = float(last_turn_at or 0.0)
        self.last_verdict = last_verdict
        self.last_reason = last_reason
        self.paused_reason = paused_reason
        self.blocked_reason = _normalize_blocked_reason(blocked_reason)
        self.consecutive_parse_failures = int(consecutive_parse_failures or 0)
        self.consecutive_transport_failures = int(consecutive_transport_failures or 0)
        self.subgoals = [str(s).strip() for s in (subgoals or []) if str(s).strip()]
        self.waiting_on_pid = int(waiting_on_pid) if waiting_on_pid else None
        self.waiting_on_session = str(waiting_on_session) if waiting_on_session else None
        self.waiting_until = float(waiting_until or 0.0)
        self.waiting_on_delegations = int(waiting_on_delegations or 0)
        self.waiting_reason = waiting_reason
        self.waiting_since = float(waiting_since or 0.0)
        self.contract = contract if isinstance(contract, GoalContract) else GoalContract.from_dict(contract)
        self.gates = [
            g if isinstance(g, GoalGate) else GoalGate.from_dict(g)
            for g in (gates or []) if isinstance(g, GoalGate) or (isinstance(g, dict) and str(g.get("command") or "").strip())
        ]
        self.events = [e for e in (events or []) if isinstance(e, dict)][-MAX_EVENTS:]

    # --- compatibility views -----------------------------------------

    @property
    def status(self) -> str:
        """Legacy status name for old readers (blocked/budget-limited both read as ``paused``)."""
        return _PHASE_TO_LEGACY_STATUS.get(self.phase, self.phase)

    @status.setter
    def status(self, value: str) -> None:
        self.phase = _LEGACY_STATUS_TO_PHASE.get(str(value or "").lower(), "active")

    @property
    def turns_used(self) -> int:
        return self.rounds_started

    @turns_used.setter
    def turns_used(self, value: int) -> None:
        self.rounds_started = int(value or 0)

    @property
    def max_turns(self) -> int:
        return self.max_rounds

    @max_turns.setter
    def max_turns(self, value: int) -> None:
        self.max_rounds = int(value or DEFAULT_MAX_ROUNDS)

    # --- serialization -----------------------------------------------

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        if self.events:
            data["events"] = list(self.events)
        return data

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False)

    @classmethod
    def from_json(cls, raw: str) -> GoalState:
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ValueError("goal state is not a JSON object")
        ints = {
            "revision": int(data.get("revision") or 0),
            "phase": _resolve_phase(data.get("phase") or data.get("status")),
            "rounds_started": data.get("rounds_started"),
            "turns_used": data.get("turns_used"),
            "max_rounds": data.get("max_rounds"),
            "max_turns": data.get("max_turns"),
            "token_budget": int(data.get("token_budget") or 0),
            "tokens_used": int(data.get("tokens_used") or 0),
            "time_used_seconds": float(data.get("time_used_seconds") or 0.0),
            "consecutive_parse_failures": int(data.get("consecutive_parse_failures") or 0),
            "consecutive_transport_failures": int(data.get("consecutive_transport_failures") or 0),
        }
        floats = {k: float(data.get(k) or 0.0) for k in ("created_at", "last_turn_at", "waiting_until", "waiting_since")}
        return cls(
            goal=data.get("goal", ""),
            goal_id=str(data.get("goal_id") or ""),
            last_verdict=data.get("last_verdict"),
            last_reason=data.get("last_reason"),
            paused_reason=data.get("paused_reason"),
            blocked_reason=data.get("blocked_reason"),
            subgoals=data.get("subgoals"),
            waiting_on_pid=int(data["waiting_on_pid"]) if data.get("waiting_on_pid") else None,
            waiting_on_session=str(data["waiting_on_session"]) if data.get("waiting_on_session") else None,
            waiting_on_delegations=int(data.get("waiting_on_delegations") or 0),
            waiting_reason=data.get("waiting_reason"),
            contract=GoalContract.from_dict(data.get("contract")),
            gates=[
                GoalGate.from_dict(g) for g in (data.get("gates") or [])
                if isinstance(g, dict) and str(g.get("command") or "").strip()
            ],
            events=data.get("events"),
            **ints, **floats,
        )

    # --- behaviour ----------------------------------------------------

    def is_terminal(self) -> bool:
        return self.phase in TERMINAL_PHASES

    def is_unfinished(self) -> bool:
        return self.phase not in TERMINAL_PHASES

    def has_contract(self) -> bool:
        return self.contract is not None and not self.contract.is_empty()

    def render_subgoals_block(self) -> str:
        """Numbered ``- N. text`` block; empty when there are no subgoals."""
        return "\n".join(f"- {i}. {text}" for i, text in enumerate(self.subgoals, start=1))

    def clear_wait(self) -> None:
        self.waiting_on_pid = None
        self.waiting_on_session = None
        self.waiting_until = 0.0
        self.waiting_on_delegations = 0
        self.waiting_reason = None
        self.waiting_since = 0.0

    def record(self, event: str, **detail: Any) -> None:
        """Append one journal entry (bounded). Never raises: an audit entry must not fail a write."""
        try:
            entry: dict[str, Any] = {"ts": round(time.time(), 3), "event": str(event)}
            for key, value in detail.items():
                if value is not None and value != "":
                    entry[key] = value
            self.events.append(entry)
            if len(self.events) > MAX_EVENTS:
                del self.events[: len(self.events) - MAX_EVENTS]
        except Exception:  # pragma: no cover - defensive
            logger.debug("goal event journal append failed", exc_info=True)


def _resolve_phase(value: Any) -> str:
    """Accept both the versioned phase names and the legacy status names (done → complete)."""
    text = str(value or "active").strip().lower()
    if text in GOAL_PHASES or text == "cleared":
        return text
    return _LEGACY_STATUS_TO_PHASE.get(text, "active")


def _normalize_blocked_reason(value: Any) -> Optional[dict]:
    if isinstance(value, str) and value.strip():
        return {"code": "blocked", "message": value.strip()}
    if not isinstance(value, dict):
        return None
    message = str(value.get("message") or "").strip()
    if not message:
        return None
    return {"code": str(value.get("code") or "blocked"), "message": message}


# ── Persistence (SessionDB state_meta) ────────────────────────────────

def _meta_key(session_id: str) -> str:
    return f"goal:{session_id}"


_DB_CACHE: dict[str, Any] = {}
_DB_BOOTSTRAP_LOCK = threading.Lock()
_DB_BOOTSTRAP_INFLIGHT: dict[str, threading.Event] = {}

# How long a loop-thread caller waits for an ALREADY-RUNNING bootstrap before degrading to None.
# Normal SessionDB init is ~10-100ms so a mid-bootstrap call usually picks the cached instance up;
# a contended init (locked state.db mid-migration) exceeds it and degrades. Far under the
# watchdog's probe window.
_DB_BOOTSTRAP_LOOP_WAIT_S = 0.25

# The call that STARTS the bootstrap (cold cache) waits this long instead. A fresh state.db init
# (schema DDL, FTS tables, first hermes_cli.config import) measures ~300ms warm and more on slow
# CI — well past 0.25s, which used to drop the first /goal write ("Goal set" but nothing
# persisted). Only the kick call pays this one-time stall; later calls keep the short window.
_DB_BOOTSTRAP_INIT_WAIT_S = 1.5


def _bootstrap_session_db(home: str, done: threading.Event) -> None:
    """Construct SessionDB off-loop and populate the cache (worker thread)."""
    try:
        db = _acquire_session_db(home)
    except Exception as exc:  # pragma: no cover
        logger.debug("GoalStore: background SessionDB() raised (%s)", exc)
        db = None
    with _DB_BOOTSTRAP_LOCK:
        if db is not None and home not in _DB_CACHE:
            _DB_CACHE[home] = db
            db = None
        _DB_BOOTSTRAP_INFLIGHT.pop(home, None)
    if db is not None:  # lost the race; drop our reference
        _release_session_db(db)
    done.set()


def _get_session_db() -> Optional[Any]:
    """Cached SessionDB per HERMES_HOME (profile switches pick the right DB); None on any failure.

    Never constructs SessionDB on an event-loop thread: a cache miss there kicks a one-shot background
    bootstrap and waits a bounded grace window (the kick call waits ``_DB_BOOTSTRAP_INIT_WAIT_S`` so a
    healthy cold init completes and the first write isn't dropped).
    """
    try:
        from hermes_constants import get_hermes_home

        home = str(get_hermes_home())
    except Exception as exc:  # pragma: no cover
        logger.debug("GoalStore: SessionDB bootstrap failed (%s)", exc)
        return None

    cached = _DB_CACHE.get(home)
    if cached is not None and _registry_tore_down(cached):
        # ``hermes profile delete`` force-closes every handle under the profile home
        # (``hermes_state_registry.close_all_under``) before rmtree; a same-name recreate in this
        # process must acquire a fresh handle, not keep writing into the torn-down one.
        with _DB_BOOTSTRAP_LOCK:
            if _DB_CACHE.get(home) is cached:
                del _DB_CACHE[home]
        cached = None
    if cached is not None:
        return cached

    import asyncio

    try:
        asyncio.get_running_loop()
    except RuntimeError:
        on_loop_thread = False
    else:
        on_loop_thread = True

    if on_loop_thread:
        with _DB_BOOTSTRAP_LOCK:
            # Re-check under the lock: a bootstrap may have finished since the unlocked read.
            cached = _DB_CACHE.get(home)
            if cached is not None:
                return cached
            done = _DB_BOOTSTRAP_INFLIGHT.get(home)
            wait = _DB_BOOTSTRAP_LOOP_WAIT_S   # already running: brief grace window only
            if done is None:
                done = _DB_BOOTSTRAP_INFLIGHT[home] = threading.Event()
                threading.Thread(target=_bootstrap_session_db, args=(home, done), name="goals-sessiondb-bootstrap", daemon=True).start()
                wait = _DB_BOOTSTRAP_INIT_WAIT_S   # kick call pays the one-time init cost
        done.wait(wait)
        return _DB_CACHE.get(home)

    try:
        db = _acquire_session_db(home)
    except Exception as exc:  # pragma: no cover
        logger.debug("GoalStore: SessionDB() raised (%s)", exc)
        return None
    with _DB_BOOTSTRAP_LOCK:
        existing = _DB_CACHE.get(home)
        if existing is not None:
            # A concurrent bootstrap won the race; drop our reference so connections don't leak.
            _release_session_db(db)
            return existing
        _DB_CACHE[home] = db
    return db


def _acquire_session_db(home: str):
    """The registry's shared handle for ``home/state.db``. A bare ``SessionDB()`` here was a SECOND
    writer per profile beside the gateway's registry handle — its own token-writer thread and
    close-time checkpoint (the #90837 corruption shape), doubled under multiplexing."""
    from hermes_state_registry import acquire
    return acquire(Path(home) / "state.db")


def _release_session_db(db) -> None:
    from hermes_state_registry import release_or_close
    try:
        release_or_close(db)
    except Exception:
        pass


def _registry_tore_down(db) -> bool:
    """True once the registry force-closed *db* (``close_all`` / ``close_all_under`` clear the
    shared-owned flag at teardown); every handle cached here was acquired through the registry, so a
    cleared flag means the connection is gone and the cache entry is stale."""
    return getattr(db, "_shared_registry_owned", True) is False


def _warn_dropped_write(manager: str, kind: str, session_id: str) -> None:
    """WARN on a dropped state write — the reply already told the user the state was set. One shared
    message keeps goal, loop and heartbeat logs greppable as one bug class."""
    logger.warning(
        "%s: %s for %s not persisted — session DB unavailable "
        "(bootstrap window exceeded, in-memory state still active)",
        manager, kind, session_id,
    )


# Errors a state_meta read/write may raise: sqlite3 failures from the store, the registry's
# RuntimeStoreError, filesystem OSErrors and malformed rows. Every catch below is one of these —
# a goal must never crash a turn because its bookkeeping row was unreadable.
_STORE_ERRORS = (sqlite3.Error, RuntimeError, OSError, ValueError)


def _db() -> Optional[Any]:
    """The store's SessionDB, resolved through the ``hermes_cli.goals`` facade when it is available.

    Every surface patches ``hermes_cli.goals._get_session_db`` in tests and in the gateway proxy; the
    facade is the seam production reads, so resolving it per call keeps that patch effective.
    """
    try:
        from hermes_cli import goals as facade

        getter = getattr(facade, "_get_session_db", None)
        if getter is not None:
            return getter()
    except (ImportError, AttributeError) as exc:  # facade still importing, or not built yet
        logger.debug("GoalStore: facade getter unavailable (%s); using the local store", exc)
    return _get_session_db()


def _revision_of(raw: Optional[str]) -> int:
    if not raw:
        return 0
    try:
        data = json.loads(raw)
    except ValueError:
        return 0
    try:
        return int(data.get("revision") or 0) if isinstance(data, dict) else 0
    except (TypeError, ValueError):
        return 0


def load_goal(session_id: str, *, upgrade: bool = True) -> Optional[GoalState]:
    """Load the goal for a session, or None if none exists.

    A row written before the versioned model is upgraded in place once (``goal_id`` + ``phase`` +
    ``revision`` are filled in) so the rest of the system never sees two shapes of state.
    """
    if not session_id:
        return None
    db = _db()
    if db is None:
        return None
    try:
        raw = db.get_meta(_meta_key(session_id))
    except _STORE_ERRORS as exc:
        logger.debug("GoalStore: get_meta failed: %s", exc)
        return None
    if not raw:
        return None
    try:
        state = GoalState.from_json(raw)
    except (TypeError, ValueError) as exc:
        logger.warning("GoalStore: could not parse stored goal for %s: %s", session_id, exc)
        return None
    if upgrade and (not state.goal_id or '"phase"' not in raw):
        state.goal_id = state.goal_id or uuid.uuid4().hex
        state.record("migrated", from_status=state.status, revision=state.revision)
        try:
            save_goal(session_id, state)
        except _STORE_ERRORS as exc:  # the row stays readable in its legacy shape
            logger.debug("GoalStore: in-place migration write failed: %s", exc)
    return state


def save_goal(session_id: str, state: GoalState, *, expected_revision: Optional[int] = None) -> None:
    """Persist a goal to SessionDB. No-op if the DB is unavailable.

    With ``expected_revision`` the write is a compare-and-set: the row is replaced only while it
    still carries that revision, otherwise :class:`GoalStaleRevision` is raised instead of
    silently overwriting a newer edit from another surface.
    """
    if not session_id:
        return
    state.updated_at = time.time()
    db = _db()
    key = _meta_key(session_id)
    if db is None:
        state.revision = int(expected_revision if expected_revision is not None else state.revision) + 1
        _warn_dropped_write("GoalStore", "goal", session_id)
        return

    if expected_revision is None:
        try:
            current = db.get_meta(key)
        except _STORE_ERRORS as exc:
            logger.debug("GoalStore: revision read failed: %s", exc)
            current = None
        state.revision = _revision_of(current) + 1
        try:
            db.set_meta(key, state.to_json())
        except _STORE_ERRORS as exc:
            logger.debug("GoalStore: set_meta failed: %s", exc)
        return

    try:
        current = db.get_meta(key)
    except _STORE_ERRORS as exc:
        logger.debug("GoalStore: compare-and-set read failed: %s", exc)
        current = None
    actual = _revision_of(current)
    if actual != int(expected_revision):
        raise GoalStaleRevision(session_id, int(expected_revision), actual)
    state.revision = actual + 1
    payload = state.to_json()
    cas = getattr(db, "cas_meta", None)
    if cas is None:  # a test double predating the CAS API: best-effort write
        try:
            db.set_meta(key, payload)
        except _STORE_ERRORS as exc:
            logger.debug("GoalStore: set_meta failed: %s", exc)
        return
    if not cas(key, current, payload):
        raise GoalStaleRevision(session_id, int(expected_revision), _revision_of(db.get_meta(key)))


def clear_goal(session_id: str) -> None:
    """Mark a goal cleared in the DB (preserved for audit, phase=cleared)."""
    if not session_id:
        return
    try:
        state = load_goal(session_id, upgrade=False)
    except _STORE_ERRORS as exc:
        logger.debug("GoalStore: clear read failed: %s", exc)
        state = None
    if state is None:
        return
    state.phase = "cleared"
    state.clear_wait()
    state.record("cleared")
    try:
        save_goal(session_id, state)
    except GoalStaleRevision:
        fresh = load_goal(session_id, upgrade=False)
        if fresh is not None:
            fresh.phase = "cleared"
            fresh.clear_wait()
            fresh.record("cleared")
            save_goal(session_id, fresh)


def delete_goal(session_id: str) -> None:
    """Remove the goal row entirely (used by tests and by an explicit purge)."""
    db = _db()
    if db is None or not session_id:
        return
    try:
        db.set_meta(_meta_key(session_id), "")
    except _STORE_ERRORS as exc:
        logger.debug("GoalStore: delete failed: %s", exc)


def migrate_goal_to_session(old_session_id: str, new_session_id: str, *, reason: str = "") -> bool:
    """Carry a persistent /goal from a parent session to its continuation. Best-effort, never raises
    (a failure here must not block compression). Returns True when a goal was migrated.

    Context compression rotates ``session_id`` to a fresh child session, but ``load_goal`` does a flat
    ``goal:<session_id>`` lookup with no parent-lineage walk — so an active goal silently dies at the
    compaction boundary (#33618). Copy the goal onto the new session and archive the old row as
    ``cleared`` so exactly one active goal row exists per logical conversation (avoids the "two active
    goals" hazard of a pure copy).
    """
    if not old_session_id or not new_session_id or old_session_id == new_session_id:
        return False
    try:
        state = load_goal(old_session_id)
        if state is None or state.phase in TERMINAL_PHASES:
            return False
        # Don't clobber a goal already set on the child (e.g. a resumed lineage).
        if load_goal(new_session_id, upgrade=False) is not None:
            return False
        save_goal(new_session_id, state)
        # Archive the parent's row so it isn't double-counted as active.
        clear_goal(old_session_id)
        logger.debug("GoalStore: migrated goal %s -> %s (%s)", old_session_id, new_session_id, reason or "rotation")
        return True
    except Exception as exc:  # pragma: no cover - defensive
        logger.debug("GoalStore: goal migration failed: %s", exc)
        return False


# ── Armed / disarmed (process memory only) ───────────────────────────

# DSH's model: a goal that is merely ``active`` does not auto-resume after a restart or a human
# resume of the session. Being "armed" is a per-process, in-memory fact — never persisted — and only
# an explicit human action (``/goal`` set, ``/goal resume``) arms the round driver again.
_ARMED_LOCK = threading.Lock()
_ARMED_SESSIONS: set[str] = set()


def arm_goal(session_id: str) -> None:
    if not session_id:
        return
    with _ARMED_LOCK:
        _ARMED_SESSIONS.add(str(session_id))


def disarm_goal(session_id: str) -> None:
    if not session_id:
        return
    with _ARMED_LOCK:
        _ARMED_SESSIONS.discard(str(session_id))


def is_goal_armed(session_id: str) -> bool:
    with _ARMED_LOCK:
        return str(session_id) in _ARMED_SESSIONS


__all__ = [
    "DEFAULT_GATE_MAX_RETRIES",
    "DEFAULT_GATE_TIMEOUT_SECONDS",
    "DEFAULT_MAX_ROUNDS",
    "GOAL_PHASES",
    "MAX_EVENTS",
    "TERMINAL_PHASES",
    "GoalAlreadyActive",
    "GoalContract",
    "GoalError",
    "GoalGate",
    "GoalStaleRevision",
    "GoalState",
    "arm_goal",
    "clear_goal",
    "delete_goal",
    "disarm_goal",
    "gate_workspace",
    "is_goal_armed",
    "load_goal",
    "migrate_goal_to_session",
    "parse_contract",
    "render_extra_criteria",
    "run_gate",
    "save_goal",
]
