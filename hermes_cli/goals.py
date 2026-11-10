"""Persistent session goals — the Ralph loop for Hermes.

A goal is a free-form objective that stays active across turns. The AGENT owns the ending: on a goal
round it calls the ``update_goal`` tool (complete after a completion audit, or blocked after the
configured number of rounds). There is no LLM judge in the decision path; deterministic quality gates
and the token budget are the system's only stops. The continuation prompt is a normal user message
appended via ``run_conversation`` (no system-prompt mutation or toolset swap — prompt caching stays
intact).
"""

from __future__ import annotations

import json
import logging
import re
import time
import uuid
from datetime import datetime, UTC
from typing import Any, List, Optional

from hermes_cli.aux_judge import _call_goal_judge_llm, _extract_json_object, _goal_judge_timeout
from hermes_time import safe_strftime

logger = logging.getLogger(__name__)


# ── Constants & defaults ──────────────────────────────────────────────

# The durable model (phases, rounds, token budget, CAS store, event journal) lives in
# hermes_cli/goal_store.py; this facade owns the engine and re-exports the model so every surface
# keeps importing hermes_cli.goals.
from hermes_cli.goal_store import (
    _DB_CACHE,
    _get_session_db,
    _warn_dropped_write,
    DEFAULT_GATE_MAX_RETRIES,
    DEFAULT_GATE_TIMEOUT_SECONDS,
    DEFAULT_MAX_ROUNDS,
    GOAL_PHASES,
    MAX_EVENTS,
    TERMINAL_PHASES,
    GoalAlreadyActive,
    GoalContract,
    GoalGate,
    GoalStaleRevision,
    GoalState,
    GoalToolRefusal,
    arm_goal,
    clear_goal,
    disarm_goal,
    gate_workspace as _gate_workspace,
    is_goal_armed,
    load_goal,
    migrate_goal_to_session,
    parse_contract,
    render_extra_criteria as _render_extra_criteria,
    run_gate,
    save_goal,
)

DEFAULT_MAX_TURNS = DEFAULT_MAX_ROUNDS
# Longest a pid/session wait barrier may hold the loop before judging resumes. Timed barriers
# (``waiting_until``) carry their own deadline and are exempt.
_MAX_BARRIER_WAIT_S = 30 * 60


CONTINUATION_PROMPT_TEMPLATE = (
    "[Continuing toward your standing goal]\n"
    "Goal: {goal}\n\n"
    "Continue working toward this goal. Take the next concrete step. "
    "If you believe the goal is complete, state so explicitly and stop. "
    "If you are blocked and need input from the user, say so clearly and stop."
)

# With a completion contract: the block tells the agent what "done" means, how to prove it, what
# not to break, scope, and when to stop — so it targets the verification surface.
CONTINUATION_PROMPT_WITH_CONTRACT_TEMPLATE = (
    "[Continuing toward your standing goal]\n"
    "Goal: {goal}\n\n"
    "Completion contract:\n"
    "{contract_block}\n\n"
    "Continue working toward the outcome above. Take the next concrete step. "
    "Stay within the stated boundaries and do not violate the constraints. "
    "Before claiming the goal is done, satisfy the Verification criterion and "
    "show the concrete evidence (command output, file contents, test result). "
    "If you hit the stated stop condition or are otherwise blocked and need "
    "user input, say so clearly and stop."
)

# With /subgoal criteria: surfaced verbatim to the agent and to the judge.
CONTINUATION_PROMPT_WITH_SUBGOALS_TEMPLATE = (
    "[Continuing toward your standing goal]\n"
    "Goal: {goal}\n\n"
    "Additional criteria the user added mid-loop:\n"
    "{subgoals_block}\n\n"
    "Continue working toward the goal AND all additional criteria. Take "
    "the next concrete step. If you believe the goal and every "
    "additional criterion are complete, state so explicitly and stop. "
    "If you are blocked and need input from the user, say so clearly "
    "and stop."
)

# Fed back when a quality gate fails: bounded output is the evidence to repair against (no judge).
CONTINUATION_PROMPT_GATE_FAILED_TEMPLATE = (
    "[Continuing toward your standing goal — a quality gate failed]\n"
    "Goal: {goal}\n\n"
    "The quality gate command below must pass before this goal can be "
    "declared done, and it just failed (attempt {attempt}/{max_retries}):\n"
    "  $ {command}\n"
    "Exit code: {exit_code}\n"
    "Output (tail):\n"
    "```\n"
    "{output}\n"
    "```\n\n"
    "Fix the underlying problem so this gate passes, then re-run it to "
    "confirm. Do not declare the goal complete while any gate fails. If the "
    "gate itself is wrong or cannot pass, say so clearly and stop."
)

# Fixed closing instructions every continuation carries: the agent, not a judge, decides the end.
COMPLETION_AUDIT_BLOCK = (
    "\n\nCompletion audit — run it before you end the goal:\n"
    "1. Re-read the objective above (and every criterion/contract field).\n"
    "2. Map each requirement to concrete evidence: a file, a command output, a test result.\n"
    "3. Inspect the real artifacts; do not trust your memory of the conversation.\n"
    "4. Treat any unverified requirement or residual uncertainty as NOT done.\n"
    "When the audit passes, call the update_goal tool with status=\"complete\" and a one-line summary.\n"
    "If the goal is genuinely blocked (missing access, impossible requirement), call update_goal with "
    "status=\"blocked\" and a reason; blocked is refused before {min_rounds} goal rounds, so keep making "
    "progress until then. You can never create, edit, pause or resume the goal — only the user can. "
    "Never call update_goal from a plain user turn.\n"
)


def _closing_message(state: GoalState) -> str:
    """Message after the agent ended its own goal (or after a budget/blocked stop)."""
    reason = state.blocked_reason or {}
    if state.phase == "complete":
        return f"✓ Goal complete: {state.last_reason or 'the agent marked it complete'}"
    if state.phase == "blocked":
        why = reason.get("message") or state.paused_reason or "blocked"
        return f"🚫 Goal blocked: {why} Use /goal edit to re-scope, or /goal resume to continue."
    return state.paused_reason or ""


# /goal draft: turn a plain objective into a reviewable contract (after Codex's "draft the goal").
DRAFT_CONTRACT_SYSTEM_PROMPT = (
    "You turn a user's plain-language objective into a structured completion "
    "contract for an autonomous coding agent. The contract has five fields:\n"
    "- outcome: the single end state that must be true when done\n"
    "- verification: the specific test / command / artifact that PROVES the "
    "outcome (must be concrete and checkable)\n"
    "- constraints: what must NOT change or regress\n"
    "- boundaries: which files, dirs, tools, or systems are in scope\n"
    "- stop_when: the condition under which the agent should stop and ask "
    "for human input instead of pushing on\n\n"
    "Infer sensible, specific values from the objective and any project "
    "context implied by it. Prefer concrete verification (a named test "
    "command, a build, a benchmark) over vague phrases. Keep each field to "
    "one or two sentences. If a field genuinely cannot be inferred, use an "
    "empty string for it.\n\n"
    "Reply ONLY with a single JSON object on one line:\n"
    '{"outcome": "...", "verification": "...", "constraints": "...", '
    '"boundaries": "...", "stop_when": "..."}'
)


# ── Judge ─────────────────────────────────────────────────────────────

def _truncate(text: str, limit: int) -> str:
    if not text:
        return ""
    return text if len(text) <= limit else text[:limit] + "… [truncated]"


def _pid_alive(pid: int) -> bool:
    """Liveness via ``gateway.status._pid_exists`` (psutil + ctypes/POSIX fallback). Never uses
    ``os.kill(pid, 0)``: on Windows that routes to CTRL_C_EVENT and hard-kills the target's console
    group (bpo-14484)."""
    if not pid or pid <= 0:
        return False
    try:
        from gateway.status import _pid_exists

        return bool(_pid_exists(int(pid)))
    except Exception:
        pass
    try:
        import psutil  # type: ignore

        return bool(psutil.pid_exists(int(pid)))
    except Exception:
        return False


def _session_waiting(session_id: str) -> bool:
    """True while the process_registry session is running and its trigger hasn't fired. Fail-safe:
    any import/registry error yields False so a stale barrier can never wedge the loop."""
    if not session_id:
        return False
    try:
        from tools.process_registry import process_registry

        return bool(process_registry.is_session_waiting(session_id))
    except Exception:
        return False


_JSON_OBJECT_RE = re.compile(r"\{.*?\}", re.DOTALL)

# `/goal <text>` kicks the loop by sending the goal as the next user turn. When that text IS what
# the user just said (a pasted handoff note, a plan the agent already has), re-sending it makes the
# agent spend a turn deciding it is a replay and duplicates context. The pointer is used only when
# the goal is substantially the WHOLE last message: a short goal that merely appears inside a longer
# one ("ship the API" after a message offering API or UI work) selects one option.
GOAL_ALREADY_SEEN_KICK = "[Goal set] Continue with the goal you were just given; there is no need to re-read it."
_GOAL_REPASTE_MIN_CHARS = 400
_GOAL_REPASTE_MIN_SHARE = 0.8


def count_active_delegations(session_id: Optional[str]) -> int:
    """Live async delegation batches spawned by this session (fail-safe 0)."""
    if not session_id:
        return 0
    try:
        from tools.async_delegation import _LIVE_STATES, _session_records
        return len(_session_records(_LIVE_STATES, "", "", str(session_id)))
    except Exception:
        return 0


def goal_kick_prompt(goal: str, last_user_message: Any) -> str:
    """The goal text, or ``GOAL_ALREADY_SEEN_KICK`` when ``last_user_message`` is essentially that text."""
    content = last_user_message
    if isinstance(content, list):
        content = " ".join(str(b.get("text", "")) for b in content if isinstance(b, dict))
    goal_norm, last_norm = " ".join(str(goal or "").split()), " ".join(str(content or "").split())
    if (
        len(goal_norm) >= _GOAL_REPASTE_MIN_CHARS
        and goal_norm in last_norm
        and len(goal_norm) >= _GOAL_REPASTE_MIN_SHARE * len(last_norm)
    ):
        return GOAL_ALREADY_SEEN_KICK
    return goal


def last_user_message_content(history: Any) -> Any:
    """Content of the newest ``role == "user"`` message in an OpenAI-shaped history, else ``""``."""
    for msg in reversed(history or []):
        if isinstance(msg, dict) and msg.get("role") == "user":
            return msg.get("content")
    return ""


def last_user_message_from_db(session_id: Optional[str]) -> Any:
    """Newest user message of ``session_id`` from the SessionDB (gateway/TUI surfaces have no live
    history object at slash-command time); ``""`` on any error."""
    if not session_id:
        return ""
    try:
        db = _get_session_db()
        if db is None:
            return ""
        rows = db.get_messages(str(session_id), limit=20, latest=True)
        return last_user_message_content(rows)
    except Exception:
        return ""


def gather_background_processes(task_id: Optional[str] = None, *, owner_task_id: Optional[str] = None) -> list[dict[str, Any]]:
    """Fail-safe snapshot of RUNNING ``process_registry`` sessions for the judge; ``[]`` on any error
    so the loop degrades to its pre-wait-barrier behavior.

    ``owner_task_id`` restricts the snapshot to processes the goal's OWN session spawned. The registry's
    ``task_id`` is the container key, which collapses to one value for every agent in the process, so
    without this filter a fan-out parent's judge saw every subagent's pollers and parked the goal on a
    grandchild's ``proc_*`` session (one run: 7 of 7 root verdicts were WAIT on child-owned processes;
    parked 3 h 22 min at the end while nothing of its own was running)."""
    try:
        from tools.process_registry import process_registry

        sessions = process_registry.list_sessions(task_id=task_id) or []
    except Exception as exc:
        logger.debug("gather_background_processes failed: %s", exc)
        return []
    running = [s for s in sessions if isinstance(s, dict) and s.get("status") != "exited"]
    if owner_task_id:
        running = [s for s in running if str(s.get("owner_task_id") or s.get("task_id") or "") == str(owner_task_id)]
    return running


def draft_contract(objective: str, *, timeout: Optional[float] = None) -> Optional[GoalContract]:
    """Expand a plain-language objective into a completion contract via the ``goal_judge`` auxiliary
    task (a side LLM call, not a conversation turn). None when unavailable or unparseable."""
    objective = (objective or "").strip()
    if not objective:
        return None
    if timeout is None:
        # The declared default for this path is the config key, not the module constant — see
        # _goal_judge_timeout (#91022).
        # Same config-backed default as judge_goal (#91022).
        timeout = _goal_judge_timeout()

    try:
        from agent.auxiliary_client import call_llm
    except Exception as exc:
        logger.debug("goal draft: auxiliary client import failed: %s", exc)
        return None

    try:
        raw = _call_goal_judge_llm(call_llm, DRAFT_CONTRACT_SYSTEM_PROMPT, f"Objective:\n{_truncate(objective, 4000)}", timeout)
    except Exception as exc:
        logger.info("goal draft: API call failed (%s)", exc)
        return None

    data = _extract_json_object(raw)
    if not isinstance(data, dict):
        logger.debug("goal draft: reply was not JSON: %r", _truncate(raw, 200))
        return None
    contract = GoalContract.from_dict(data)
    return None if contract.is_empty() else contract


# ── GoalManager — the orchestration surface CLI + gateway talk to ──────

def _decision(status, should_continue: bool, prompt: Optional[str], verdict: str, reason: str,
              message: str, *, phase: Optional[str] = None) -> dict[str, Any]:
    """One decision dict shared by every surface.

    ``status`` keeps its historical names (done/paused) while ``phase`` carries the versioned model,
    so a surface can migrate to phases without breaking an older reader.
    """
    return {"status": status, "phase": phase or status, "should_continue": should_continue,
            "continuation_prompt": prompt, "verdict": verdict, "reason": reason, "message": message}


DEFAULT_GOAL_TOKEN_BUDGET = 2_000_000
# Smallest closing reserve auto-computed from a budget; a closing turn must at least fit a summary.
MIN_CLOSING_RESERVE_TOKENS = 20_000


def _goals_setting(key: str, default, cast):
    """Resolve ``goals.<key>``; an unreadable/non-positive value falls back to *default*."""
    try:
        from hermes_cli.config import load_config

        value = cast(((load_config() or {}).get("goals") or {}).get(key, default))
        if value > 0:
            return value
    except (ImportError, AttributeError, OSError, TypeError, ValueError) as exc:
        logger.debug("goal setting %s unavailable (%s); using %r", key, exc, default)
    return default


DEFAULT_GOAL_TOKEN_BUDGET = 2_000_000
# Smallest closing reserve auto-computed from a budget; a closing turn must at least fit a summary.
MIN_CLOSING_RESERVE_TOKENS = 20_000


def _goals_setting(key: str, default, cast):
    """Resolve ``goals.<key>``; an unreadable/non-positive value falls back to *default*."""
    try:
        from hermes_cli.config import load_config

        value = cast(((load_config() or {}).get("goals") or {}).get(key, default))
        if value > 0:
            return value
    except (ImportError, AttributeError, OSError, TypeError, ValueError) as exc:
        logger.debug("goal setting %s unavailable (%s); using %r", key, exc, default)
    return default


_JUDGE_CONFIG_HINT = (
    "~/.hermes/config.yaml:\n  auxiliary:\n    goal_judge:\n      provider: {provider}\n      model: {model}\n"
    "Then /goal resume to continue."
)


class GoalManager:
    """Per-session goal state + continuation decisions.

    The CLI and gateway each hold one per live session. ``evaluate_after_turn`` calls the judge and
    returns the decision dict that drives the next turn; ``next_continuation_prompt`` is the
    canonical user-role message to feed back into ``run_conversation``.
    """

    def __init__(self, session_id: str, *, default_max_turns: int = DEFAULT_MAX_TURNS,
                 default_max_tokens: Optional[int] = None):
        self.session_id = session_id
        # Rounds are a safety cap only since the 2026-11 budget decision; tokens are the budget.
        self.default_max_turns = int(default_max_turns or DEFAULT_MAX_TURNS)
        self.default_max_tokens = (
            int(default_max_tokens) if default_max_tokens is not None
            else _goals_setting("max_tokens", DEFAULT_GOAL_TOKEN_BUDGET, int)
        )
        self.closing_reserve_configured = _goals_setting("closing_reserve_tokens", 0, int)
        self.blocked_min_rounds = _goals_setting("blocked_min_rounds", 3, int)
        self._state: Optional[GoalState] = load_goal(session_id)
        self._revision: int = self._state.revision if self._state is not None else 0

    # --- token budget -------------------------------------------------

    def closing_reserve(self) -> int:
        """Tokens kept for the closing turn, never more than the budget itself."""
        state = self._state
        budget = int(getattr(state, "token_budget", 0) or 0)
        if self.closing_reserve_configured > 0:
            reserve = self.closing_reserve_configured
        else:
            reserve = max(MIN_CLOSING_RESERVE_TOKENS, budget // 20) if budget else MIN_CLOSING_RESERVE_TOKENS
        return min(reserve, budget) if budget else reserve

    def remaining_tokens(self) -> Optional[int]:
        """Tokens left before the closing reserve is reached; None without a token budget."""
        state = self._state
        budget = int(getattr(state, "token_budget", 0) or 0) if state is not None else 0
        if not budget:
            return None
        return budget - int(state.tokens_used or 0)

    def add_tokens(self, tokens: int, *, seconds: float = 0.0) -> None:
        """Account one turn's real provider usage; never negative, recorded once per turn."""
        state = self._state
        if state is None:
            return
        tokens = max(0, int(tokens or 0))
        seconds = max(0.0, float(seconds or 0.0))
        if not tokens and not seconds:
            return
        state.tokens_used += tokens
        state.time_used_seconds += seconds
        self._save(event="tokens_used", tokens=tokens, total=state.tokens_used,
                   time_seconds=round(seconds, 1))

    def tokens_until_closing(self) -> Optional[int]:
        """How many tokens of real work remain before only the closing reserve is left."""
        remaining = self.remaining_tokens()
        if remaining is None:
            return None
        return remaining - self.closing_reserve()

    def refresh(self) -> None:
        """Re-read state from the DB (another writer, e.g. a tool, moved it)."""
        self._state = load_goal(self.session_id)
        self._revision = self._state.revision if self._state is not None else 0

    # --- introspection ------------------------------------------------

    @property
    def state(self) -> Optional[GoalState]:
        return self._state

    def is_active(self) -> bool:
        return self._state is not None and self._state.phase == "active"

    def is_armed(self) -> bool:
        """Whether the round driver may continue this goal in this process (memory only)."""
        return is_goal_armed(self.session_id)

    def has_goal(self) -> bool:
        """True while a goal is unfinished: active, paused, blocked or budget-limited."""
        return self._state is not None and self._state.is_unfinished()

    def has_contract(self) -> bool:
        return self._state is not None and self._state.has_contract()

    def status_line(self) -> str:
        s = self._state
        if s is None or s.phase == "cleared":
            return "No active goal. Set one with /goal <text>."
        rounds = f"{s.rounds_started}/{s.max_rounds} rounds"
        if s.token_budget:
            tokens = f", {s.tokens_used:,}/{s.token_budget:,} tokens"
        else:
            tokens = f", {s.tokens_used:,} tokens" if s.tokens_used else ""
        sub = f", {len(s.subgoals)} subgoal{'s' if len(s.subgoals) != 1 else ''}" if s.subgoals else ""
        con = ", contract" if self.has_contract() else ""
        gat = f", {len(s.gates)} gate{'s' if len(s.gates) != 1 else ''}" if s.gates else ""
        meta = f"{rounds}{tokens}{sub}{con}{gat}"
        if s.phase == "active":
            if s.waiting_on_session and _session_waiting(s.waiting_on_session):
                return f"⏳ Goal (parked on {s.waiting_reason or f'session {s.waiting_on_session}'}, {meta}): {s.goal}"
            if s.waiting_on_pid and _pid_alive(s.waiting_on_pid):
                return f"⏳ Goal (parked on {s.waiting_reason or f'pid {s.waiting_on_pid}'}, {meta}): {s.goal}"
            if s.waiting_until and time.time() < s.waiting_until:
                remaining = int(s.waiting_until - time.time())
                wr = s.waiting_reason or f"{remaining}s"
                return f"⏳ Goal (parked {remaining}s — {wr}, {meta}): {s.goal}"
            return f"⊙ Goal (active, {meta}): {s.goal}"
        if s.phase == "blocked":
            why = (s.blocked_reason or {}).get("message") or s.paused_reason or "blocked"
            return f"🚫 Goal (blocked, {meta} — {why}): {s.goal}"
        if s.phase == "budget_limited":
            why = s.paused_reason or "token budget exhausted"
            return f"⏹ Goal (budget limited, {meta} — {why}): {s.goal}"
        if s.phase == "paused":
            extra = f" — {s.paused_reason}" if s.paused_reason else ""
            return f"⏸ Goal (paused, {meta}{extra}): {s.goal}"
        if s.phase == "complete":
            return f"✓ Goal done ({meta}): {s.goal}"
        return f"Goal ({s.phase}, {meta}): {s.goal}"

    # --- mutation -----------------------------------------------------

    def _save(self, event: Optional[str] = None, **detail: Any) -> Optional[GoalState]:
        """Record one journal entry and persist with compare-and-set.

        A stale revision means another surface wrote between our load and our save. We log it, adopt
        the fresh revision and retry once with our own state — the local action (the user's click,
        the turn boundary) is the newest intent and must not be lost; the CAS still guarantees the
        window is detected instead of silently overwriting, and the second writer within that window
        is the only one that can lose.
        """
        if self._state is None:
            return None
        if event:
            self._state.record(event, **detail)
        for attempt in (1, 2):
            try:
                save_goal(self.session_id, self._state, expected_revision=self._revision)
                self._revision = self._state.revision
                return self._state
            except GoalStaleRevision:
                fresh = load_goal(self.session_id, upgrade=False)
                logger.warning(
                    "goal %s: stale revision %s (now %s) on %s; reloading",
                    self.session_id, self._revision, fresh.revision if fresh else 0, event or "write",
                )
                self._revision = fresh.revision if fresh else 0
                if attempt == 2:
                    raise
        return self._state

    def _require_goal(self) -> GoalState:
        if self._state is None or not self.has_goal():
            raise RuntimeError("no active goal")
        return self._state

    def _require_active(self) -> GoalState:
        if self._state is None or self._state.phase != "active":
            raise RuntimeError("no active goal to park")
        return self._state

    def _pause_state(self, reason: str, *, phase: str = "paused", code: Optional[str] = None, event: str = "paused") -> None:
        self._state.phase = phase
        self._state.paused_reason = reason
        self._state.blocked_reason = (
            {"code": code or "blocked", "message": reason} if phase == "blocked" else None
        )
        self._state.reserved_round = None
        self._state.active_round = None
        # A blocked or budget-limited goal must not keep auto-running: only a human resume re-arms.
        if phase in {"blocked", "budget_limited", "paused"}:
            disarm_goal(self.session_id)
        self._save(event=event, phase=phase, reason=reason, code=code)

    def _pause_decision(self, paused_reason: str, verdict: str, reason: str, message: str,
                        *, phase: str = "paused", code: Optional[str] = None) -> dict[str, Any]:
        self._pause_state(paused_reason, phase=phase, code=code,
                          event="blocked" if phase == "blocked" else "paused")
        return _decision("paused", False, None, verdict, reason, message, phase=phase)

    def set(
        self,
        goal: str,
        *,
        max_turns: Optional[int] = None,
        max_tokens: Optional[int] = None,
        contract: Optional[GoalContract] = None,
        replace: bool = False,
    ) -> GoalState:
        """Start a new goal, or (``replace=True``) rewrite the unfinished one in place.

        One unfinished goal per session: a plain ``set`` while one is in progress raises
        ``GoalAlreadyActive`` so a surface can ask for confirmation instead of silently discarding
        the rounds, criteria, gates and contract the user already accumulated. ``replace`` keeps all
        of those (a preserving rewrite) and only swaps the objective text.
        """
        goal = (goal or "").strip()
        if not goal:
            raise ValueError("goal text is empty")
        previous = self._state
        if previous is not None and previous.is_unfinished():
            if not replace:
                raise GoalAlreadyActive(previous.goal)
            previous.goal = goal
            previous.phase = "active"
            previous.paused_reason = None
            previous.blocked_reason = None
            previous.last_verdict = None
            previous.last_reason = None
            previous.clear_wait()
            if contract is not None:
                previous.contract = contract
            if max_turns:
                previous.max_rounds = int(max_turns)
            if max_tokens is not None:
                previous.token_budget = max(0, int(max_tokens))
                previous.closing_issued = False
            self._state = previous
            arm_goal(self.session_id)
            return self._save(event="goal_rewritten", goal=goal)
        self._state = GoalState(
            goal=goal, goal_id=uuid.uuid4().hex, phase="active", rounds_started=0,
            created_at=time.time(), last_turn_at=0.0,
            max_rounds=int(max_turns) if max_turns else self.default_max_turns,
            token_budget=(max(0, int(max_tokens)) if max_tokens is not None else self.default_max_tokens),
            contract=contract if contract is not None else GoalContract(),
        )
        arm_goal(self.session_id)
        return self._save(event="goal_set", goal=goal)

    def set_contract(self, contract: GoalContract) -> Optional[GoalState]:
        """Attach or replace the completion contract on the active goal."""
        if self._state is None:
            return None
        self._state.contract = contract or GoalContract()
        return self._save(event="contract_set")

    def pause(self, reason: str = "user-paused") -> Optional[GoalState]:
        if not self._state:
            return None
        self._state.phase = "paused"
        self._state.active_round = None
        self._state.paused_reason = reason
        self._state.clear_wait()   # a wait barrier is meaningless once paused
        self._state.reserved_round = None   # a paused goal has no continuation in flight
        disarm_goal(self.session_id)
        return self._save(event="paused", reason=reason, source="user")

    def resume(self, *, reset_budget: bool = True) -> Optional[GoalState]:
        """Human resume: the only action that re-arms the round driver after a restart."""
        if not self._state:
            return None
        self._state.phase = "active"
        self._state.paused_reason = None
        self._state.blocked_reason = None
        self._state.active_round = None
        self._state.clear_wait()   # resuming starts fresh
        self._state.reserved_round = None
        if reset_budget:
            self._state.rounds_started = 0
        if self._state.token_budget:
            # The budget was the reason for the stop: a human resume grants one more closing reserve
            # plus an equal working allowance, computed from what was actually spent.
            reserve = self.closing_reserve()
            if self._state.phase == "budget_limited" or self._state.tokens_used >= self._state.token_budget - reserve:
                self._state.token_budget = max(self._state.token_budget, self._state.tokens_used) + 2 * reserve
                self._state.closing_issued = False
        arm_goal(self.session_id)
        return self._save(event="resumed", reset_rounds=bool(reset_budget),
                          token_budget=self._state.token_budget)

    def clear(self) -> None:
        if self._state is None:
            return
        self._state.phase = "cleared"
        self._state.active_round = None
        self._state.clear_wait()
        self._state.reserved_round = None
        disarm_goal(self.session_id)
        self._save(event="cleared")
        self._state = None

    def mark_done(self, reason: str) -> None:
        if not self._state:
            return
        self._state.phase = "complete"
        self._state.reserved_round = None
        self._state.active_round = None
        self._state.last_verdict = "done"
        self._state.last_reason = reason
        disarm_goal(self.session_id)
        self._save(event="completed", reason=reason)

    # --- /subgoal user controls ---------------------------------------

    def add_subgoal(self, text: str) -> str:
        """Append a user-added criterion; raises ``RuntimeError`` without ``has_goal()``."""
        state = self._require_goal()
        text = (text or "").strip()
        if not text:
            raise ValueError("subgoal text is empty")
        state.subgoals.append(text)
        self._save(event="subgoal_added", text=text)
        return text

    def _pop_item(self, attr: str, index_1based: int):
        items = getattr(self._require_goal(), attr)
        idx = int(index_1based) - 1
        if idx < 0 or idx >= len(items):
            raise IndexError(f"index out of range (1..{len(items)})")
        removed = items.pop(idx)
        self._save(event="item_removed", field=attr, index=int(index_1based))
        return removed

    def _clear_items(self, attr: str) -> int:
        state = self._require_goal()
        prev = len(getattr(state, attr))
        setattr(state, attr, [])
        self._save(event="items_cleared", field=attr, count=prev)
        return prev

    def remove_subgoal(self, index_1based: int) -> str:
        """Remove a subgoal by 1-based index. Returns the removed text."""
        return self._pop_item("subgoals", index_1based)

    def clear_subgoals(self) -> int:
        """Wipe all subgoals. Returns the previous count."""
        return self._clear_items("subgoals")

    def render_subgoals(self) -> str:
        """Public helper for the /subgoal slash command."""
        if self._state is None:
            return "(no active goal)"
        return self._state.render_subgoals_block() or "(no subgoals — use /subgoal <text> to add criteria)"

    # --- round reservation (reservation → admission) -------------------

    def pending_round(self) -> Optional[int]:
        """The round reserved for a continuation that has not entered the session yet."""
        return self._state.reserved_round if self._state is not None else None

    def reserve_round(self) -> Optional[int]:
        """Reserve the next round; ``None`` when the round cap is reached.

        The reservation is idempotent (returning the round already reserved) so a duplicated
        boundary cannot reserve twice, and it never counts the round — only ``admit_round`` does.
        """
        state = self._require_active()
        if state.reserved_round:
            return state.reserved_round
        if state.rounds_started >= state.max_rounds:
            return None
        state.reserved_round = state.rounds_started + 1
        self._save(event="round_reserved", round=state.reserved_round)
        return state.reserved_round

    def admit_round(self) -> bool:
        """Consume the reservation: the continuation message really entered the session.

        ``budget_limited`` is accepted because the single closing turn runs after the budget stop.
        """
        state = self._state
        if state is None or state.phase not in {"active", "budget_limited"} or not state.reserved_round:
            return False
        admitted = int(state.reserved_round)
        state.rounds_started = admitted
        state.reserved_round = None
        state.active_round = admitted
        state.last_turn_at = time.time()
        self._save(event="round_admitted", round=admitted, max_rounds=state.max_rounds)
        return True

    def issue_closing_turn(self, *, reserve: int) -> Optional[GoalState]:
        """Flag the single closing turn: budget reached, one summary continuation allowed."""
        state = self._state
        if state is None or state.closing_issued:
            return None
        state.phase = "budget_limited"
        state.closing_issued = True
        state.paused_reason = (
            f"token budget reached ({int(state.tokens_used or 0):,}/{int(state.token_budget or 0):,}, "
            f"{reserve:,} reserved for the closing turn)"
        )
        return self._save(event="closing_issued", tokens_used=state.tokens_used,
                          token_budget=state.token_budget, reserve=reserve)

    def release_round(self, reason: str = "") -> bool:
        """Drop a reservation that will never run; the round stays available."""
        state = self._state
        if state is None or not state.reserved_round:
            return False
        reserved = int(state.reserved_round)
        state.reserved_round = None
        self._save(event="round_released", round=reserved, reason=reason)
        return True

    # --- /goal gate quality gates ---------------------------------------

    def add_gate(self, command: str, *, timeout_seconds: Optional[int] = None, max_retries: Optional[int] = None) -> GoalGate:
        """Append a quality-gate command; raises ``RuntimeError`` without ``has_goal()``."""
        state = self._require_goal()
        command = (command or "").strip()
        if not command:
            raise ValueError("gate command is empty")
        gate = GoalGate(
            command=command,
            timeout_seconds=int(timeout_seconds) if timeout_seconds else DEFAULT_GATE_TIMEOUT_SECONDS,
            max_retries=int(max_retries) if max_retries else DEFAULT_GATE_MAX_RETRIES,
        )
        state.gates.append(gate)
        self._save(event="gate_added", command=gate.command)
        return gate

    def remove_gate(self, index_1based: int) -> str:
        """Remove a gate by 1-based index. Returns the removed command."""
        return self._pop_item("gates", index_1based).command

    def clear_gates(self) -> int:
        """Remove all gates. Returns the previous count."""
        return self._clear_items("gates")

    def render_gates(self) -> str:
        """Public helper for the /goal gate slash command."""
        if self._state is None:
            return "(no active goal)"
        if not self._state.gates:
            return "(no quality gates — use /goal gate add <command> to require one)"
        lines = []
        for i, g in enumerate(self._state.gates, start=1):
            status = ""
            if g.last_exit_code == 0:
                status = " ✓ passing"
            elif g.last_exit_code is not None:
                status = f" ✗ failing (exit {g.last_exit_code}, attempt {g.attempts}/{g.max_retries})"
            lines.append(f"- {i}. $ {g.command}{status}")
        return "\n".join(lines)

    def _check_gates(self) -> Optional[dict[str, Any]]:
        """Run quality gates in order; return a decision dict on failure.

        Every eligible boundary re-executes a failed gate. A git HEAD+porcelain fingerprint used to
        replay the recorded failure when "nothing changed", but porcelain sees neither the contents
        of an untracked or already-modified file nor inputs outside the repo, so a repaired input
        was replayed as still-failing until retry exhaustion paused the goal (#110649). The
        retry cap below still bounds a genuinely stuck red suite.
        """
        state = self._state
        if state is None or not state.gates:
            return None

        gate_cwd, refusal = _gate_workspace()
        if refusal:
            return self._pause_decision(
                f"quality gates not run: {refusal}", "gate_failed", f"gates not run: {refusal}",
                f"⏸ Goal paused — quality gates not run: {refusal}. Fix the workspace or "
                f"/goal gate remove the gates, then /goal resume.",
            )
        for gate in state.gates:
            passed, exit_code, tail = run_gate(gate, cwd=gate_cwd)
            gate.last_exit_code = exit_code
            gate.last_output_tail = tail
            if passed:
                gate.attempts = 0
                continue

            gate.attempts += 1

            if gate.attempts > gate.max_retries:
                return self._pause_decision(
                    f"quality gate exhausted {gate.attempts - 1} retries: $ {gate.command}",
                    "gate_failed", f"gate exhausted retries: $ {gate.command}",
                    f"⏸ Goal paused — quality gate still failing after "
                    f"{gate.max_retries} retries: $ {gate.command} "
                    f"(exit {exit_code}). Fix it manually or /goal gate remove it, "
                    f"then /goal resume.",
                )

            self._save(event="gate_failed", command=gate.command, exit_code=exit_code,
                       attempt=gate.attempts)
            prompt = CONTINUATION_PROMPT_GATE_FAILED_TEMPLATE.format(
                goal=state.goal, command=gate.command, exit_code=exit_code, attempt=gate.attempts,
                max_retries=gate.max_retries, output=tail or "(no output)",
            )
            return _decision(
                "active", True, prompt, "gate_failed",
                f"gate failed (exit {exit_code}): $ {gate.command}",
                f"✗ Quality gate failed ({state.turns_used}/{state.max_turns} turns, "
                f"attempt {gate.attempts}/{gate.max_retries}): $ {gate.command}",
            )

        self._save(event="gate_passed")
        return None

    # --- /goal wait barrier -------------------------------------------

    def _park(self, reason: str, **barrier) -> GoalState:
        state = self._require_active()
        state.clear_wait()
        for k, v in barrier.items():
            setattr(state, k, v)
        state.waiting_reason = (reason or "").strip() or None
        state.waiting_since = time.time()
        return self._save()

    def wait_on(self, pid: int, reason: str = "") -> GoalState:
        """Park the goal loop until a background PID exits (no turn burned, no judge call). For a
        process with a watch/notify trigger prefer ``wait_on_session``. Requires an active goal."""
        self._require_active()
        pid = int(pid)
        if pid <= 0:
            raise ValueError("pid must be a positive integer")
        if not _pid_alive(pid):
            raise ValueError("pid is not alive on this host")
        return self._park(reason, waiting_on_pid=pid)

    def wait_on_session(self, session_id: str, reason: str = "") -> GoalState:
        """Park on a process_registry session's OWN trigger: exit OR ``watch_patterns`` match. The
        right barrier for a long-lived watcher/poller that signals mid-run and may never exit."""
        self._require_active()
        session_id = str(session_id or "").strip()
        if not session_id:
            raise ValueError("session_id must be a non-empty string")
        return self._park(reason, waiting_on_session=session_id)

    def wait_for_seconds(self, seconds: int, reason: str = "", *, on_delegations: int = 0) -> GoalState:
        """Park until ``seconds`` from now (backoff/cooldown waits with no process to track). With
        ``on_delegations`` the wait is FOR those live delegation batches: it also lifts as soon as
        fewer are live (a batch result came back), so the loop re-judges with the result in hand
        instead of sleeping out a 20-minute timer (independent review: results arrived with 1,199 s
        left on the timer and nothing re-judged)."""
        self._require_active()
        seconds = int(seconds)
        if seconds <= 0:
            raise ValueError("seconds must be a positive integer")
        return self._park(reason, waiting_until=time.time() + seconds, waiting_on_delegations=max(0, int(on_delegations)))

    def stop_waiting(self) -> bool:
        """Clear any active wait barrier (pid / session / time). Returns True if one was cleared."""
        s = self._state
        if s is None or (s.waiting_on_pid is None and s.waiting_on_session is None and not s.waiting_until):
            return False
        s.clear_wait()
        self._save()
        return True

    def is_waiting(self) -> bool:
        """True iff a barrier is set AND not yet satisfied. A satisfied barrier is cleared here
        (lazy auto-clear) so the next evaluation resumes normal judging. A pid/session barrier
        also expires after ``_MAX_BARRIER_WAIT_S``: a watcher or poller that never exits would
        otherwise park the goal indefinitely (one run sat 3 h 22 min on a poller that outlived
        the work it was polling)."""
        s = self._state
        if s is None:
            return False
        if s.waiting_on_session is not None:
            still = _session_waiting(s.waiting_on_session)
        elif s.waiting_on_pid is not None:
            still = _pid_alive(s.waiting_on_pid)
        elif s.waiting_until:
            still = time.time() < s.waiting_until
            if still and s.waiting_on_delegations > 0:
                # Set because of live delegations: lift the moment one of them returned.
                live = count_active_delegations(self.session_id)
                if live < s.waiting_on_delegations:
                    still = False
        else:
            return False
        if still and s.waiting_since and s.waiting_until == 0.0 and time.time() - s.waiting_since > _MAX_BARRIER_WAIT_S:
            logger.info("goal %s: wait barrier on %s exceeded %ds; resuming judging",
                        self.session_id, s.waiting_on_session or s.waiting_on_pid, _MAX_BARRIER_WAIT_S)
            still = False
        if not still:
            self.stop_waiting()
        return still

    # --- the main entry point called after every turn -----------------

    def _waiting_decision(self, state: GoalState) -> dict[str, Any]:
        if state.waiting_on_session is not None:
            tgt = f"session {state.waiting_on_session}"
        elif state.waiting_on_pid is not None:
            tgt = f"pid {state.waiting_on_pid}"
        else:
            tgt = f"{max(0, int(state.waiting_until - time.time()))}s remaining"
        reason = state.waiting_reason or tgt
        return _decision("active", False, None, "waiting", reason, f"⏳ Goal parked — waiting on {tgt}: {reason}")

    # --- model-driven completion (the update_goal tool) -----------------

    def _require_goal_round(self, action: str) -> GoalState:
        """Authority: the model may only end the goal from inside a real goal round."""
        state = self._state
        if state is None or state.phase != "active":
            raise GoalToolRefusal(
                "GOAL_NOT_ACTIVE", f"{action}: this session has no active goal")
        if not state.active_round:
            raise GoalToolRefusal(
                "GOAL_NOT_A_GOAL_ROUND",
                f"{action} is only allowed from a goal round; finish this turn and call it from the "
                "continuation round, never from a plain user turn",
            )
        return state

    def mark_complete_by_agent(self, summary: str = "") -> dict[str, Any]:
        """``update_goal(status=complete)``: the agent ends its own goal (completion audit in prompt).

        Idempotent: a second complete is a success, not a second transition.
        """
        state = self._state
        if state is not None and state.phase == "complete":
            return {"status": "complete", "idempotent": True,
                    "message": "Goal is already complete; write your closing summary and stop."}
        state = self._require_goal_round("update_goal(complete)")
        summary = (summary or "").strip() or "the agent marked the goal complete"
        state.phase = "complete"
        state.active_round = None
        state.last_verdict = "complete"
        state.last_reason = summary
        disarm_goal(self.session_id)
        self._save(event="completed", source="agent", reason=summary)
        return {"status": "complete", "message": (
            "Goal marked complete. End this turn with a short closing summary of what was delivered "
            "and the evidence; do not start new work.")}

    def mark_blocked_by_agent(self, reason: str) -> dict[str, Any]:
        """``update_goal(status=blocked)``: refused until ``goals.blocked_min_rounds`` goal rounds."""
        state = self._state
        if state is not None and state.phase == "blocked":
            return {"status": "blocked", "idempotent": True,
                    "message": "Goal is already blocked; write your closing summary and stop."}
        reason = (reason or "").strip()
        if not reason:
            raise GoalToolRefusal(
                "GOAL_BLOCKED_REASON_REQUIRED",
                "update_goal(status=blocked) requires a reason describing exactly what blocks the goal",
            )
        state = self._require_goal_round("update_goal(blocked)")
        needed = int(self.blocked_min_rounds or 3)
        if state.rounds_started < needed:
            raise GoalToolRefusal(
                "GOAL_BLOCKED_TOO_EARLY",
                f"blocked is refused before {needed} goal rounds (started {state.rounds_started}); "
                "keep working, or say clearly in this turn what is missing and why",
            )
        state.phase = "blocked"
        state.active_round = None
        state.blocked_reason = {"code": "agent-blocked", "message": reason}
        state.paused_reason = f"agent reported blocked: {reason}"
        state.last_verdict = "blocked"
        state.last_reason = reason
        disarm_goal(self.session_id)
        self._save(event="blocked", source="agent", reason=reason)
        return {"status": "blocked", "message": (
            "Goal marked blocked. End this turn with a short closing summary: what is done, what the "
            "block is, and what the user can do next.")}

    def _budget_pause(self, state: GoalState, verdict: str, reason: str, note: str = "") -> dict[str, Any]:
        return self._pause_decision(
            f"round budget exhausted ({state.rounds_started}/{state.max_rounds})", verdict, reason,
            f"⏸ Goal paused — {state.rounds_started}/{state.max_rounds} rounds used{note}. "
            "Use /goal resume to keep going, or /goal clear to stop.",
            phase="budget_limited", code="round-limit",
        )

    def evaluate_after_turn(
        self, last_response: str, *, user_initiated: bool = True,
        background_processes: Optional[list[dict[str, Any]]] = None,
        active_delegations: int = 0,
    ) -> dict[str, Any]:
        """Turn-boundary decision WITHOUT an LLM judge.

        The agent owns the ending: during a goal round it calls ``update_goal`` (complete/blocked),
        which already updated the phase. This method only runs the deterministic gates, clears the
        round context and decides whether another continuation is due. A turn that produced no
        closing signal simply continues.

        It does not consume a round: rounds are reserved by ``reserve_round`` and counted by
        ``admit_round`` when the continuation message really starts (see goal_driver).
        """
        state = self._state
        if state is None:
            return _decision(None, False, None, "inactive", "no active goal", "", phase=None)
        if state.phase != "active":
            state.active_round = None
            return _decision(state.status, False, None, state.phase, state.paused_reason or "",
                             _closing_message(state), phase=state.phase)

        # Parked on a live process or an unexpired deadline: quiesce without a turn.
        if self.is_waiting():
            state.active_round = None
            return self._waiting_decision(state)

        state.last_turn_at = time.time()
        state.active_round = None

        # Gates run at the boundary: a failing gate is deterministic evidence the goal is not done,
        # so its bounded output becomes the next continuation.
        gate_decision = self._check_gates()
        if gate_decision is not None:
            if gate_decision.get("should_continue") and state.rounds_started >= state.max_rounds:
                return self._budget_pause(state, "gate_failed", gate_decision.get("reason", ""),
                                          note=" (a quality gate is still failing)")
            return gate_decision

        if state.rounds_started >= state.max_rounds:
            return self._budget_pause(state, "continue", "round safety cap reached")

        state.last_verdict = "continue"
        state.last_reason = "no closing signal from the agent yet"
        self._save(event="round_finished", round=state.rounds_started)
        if state.token_budget:
            progress = f"{state.tokens_used:,}/{state.token_budget:,} tokens"
        else:
            progress = f"{state.rounds_started}/{state.max_rounds} rounds"
        return _decision(
            "active", True, self.next_continuation_prompt(), "continue",
            "the agent has not marked the goal complete or blocked",
            f"↻ Continuing toward goal ({progress})",
        )

    def next_continuation_prompt(self) -> Optional[str]:
        s = self._state
        if not s or s.phase != "active":
            return None
        # Contract first (it carries the verification surface); subgoals fold in as extra criteria.
        if s.has_contract():
            contract_block = s.contract.render_block()
            if s.subgoals:
                contract_block = f"{contract_block}\n{_render_extra_criteria(s.subgoals)}"
            prompt = CONTINUATION_PROMPT_WITH_CONTRACT_TEMPLATE.format(goal=s.goal, contract_block=contract_block)
        elif s.subgoals:
            prompt = CONTINUATION_PROMPT_WITH_SUBGOALS_TEMPLATE.format(goal=s.goal, subgoals_block=s.render_subgoals_block())
        else:
            prompt = CONTINUATION_PROMPT_TEMPLATE.format(goal=s.goal)
        return prompt + COMPLETION_AUDIT_BLOCK.format(min_rounds=int(self.blocked_min_rounds or 3))

    def render_contract(self) -> str:
        """Public helper for the /goal show + /goal draft slash commands."""
        if self._state is None:
            return "(no active goal)"
        return self._state.contract.render_block() if self._state.has_contract() else (
            "(no completion contract — set one with /goal draft <objective> or inline field: value lines)")


# ── Kanban worker goal loop ───────────────────────────────────────────

# Fed to a kanban goal-mode worker that hasn't completed/blocked its task yet: short, and points it
# back at the lifecycle contract (it already has the full task body).
KANBAN_GOAL_CONTINUATION_TEMPLATE = (
    "[Continuing toward this kanban task — judge says it is not done yet]\n"
    "Reason: {reason}\n\n"
    "Take the next concrete step toward completing the task. When the work "
    "is genuinely finished, call kanban_complete with a summary. If it is a "
    "code change that needs same-card review before counting as done, call "
    "kanban_request_review with a summary instead. If you are blocked and "
    "need human input, call kanban_block with a reason. Do not stop without "
    "calling one of them."
)

# Judge says done but the worker never made a terminal board call
# (kanban_complete/kanban_request_review/kanban_block): one explicit nudge.
KANBAN_GOAL_FINALIZE_TEMPLATE = (
    "[The work looks complete, but the task is still open]\n"
    "Reason: {reason}\n\n"
    "If the task is genuinely done, call kanban_complete now with a short "
    "summary of what you did. If it is a code change awaiting same-card review, "
    "call kanban_request_review with that summary instead. If something still "
    "blocks completion, call kanban_block with the reason instead."
)


# Worker-driven terminal task statuses → loop outcome. The card's own acceptance criteria are the
# goal; the worker already has the full task body, so these outcomes stop the loop cleanly.
_KANBAN_TERMINAL_STATUSES = {
    "done": ("completed_by_worker", "worker completed the task", "task {task_id} completed by worker after {turns} turn(s)"),
    "blocked": ("blocked_by_worker", "worker blocked the task", "task {task_id} blocked by worker after {turns} turn(s)"),
    # kanban_request_review is a legitimate terminator: implementation done, awaiting a reviewer.
    "review": ("review_requested_by_worker", "worker requested review", "task {task_id} handed off for review by worker after {turns} turn(s)"),
    "changes_requested": ("changes_requested_by_reviewer", "reviewer requested changes", "reviewer returned task {task_id} for changes after {turns} turn(s)"),
}


def run_kanban_goal_loop(
    *,
    task_id: str,
    goal_text: str,
    run_turn,
    task_status_fn,
    block_fn,
    max_turns: int = DEFAULT_MAX_TURNS,
    first_response: str = "",
    log=None,
) -> dict[str, Any]:
    """Drive a kanban worker through a goal loop until the BOARD says the task ended.

    No judge: the worker's own ``kanban_complete`` / ``kanban_block`` / review hand-off are the
    authority, and the board status is the only completion signal. The loop keeps asking for the
    next step until the card is terminal or the round safety cap is reached.
    """

    def _log(msg: str) -> None:
        if log is not None:
            try:
                log(msg)
            except Exception:
                pass

    def _block(message: str) -> None:
        try:
            block_fn(message)
        except Exception as exc:
            _log(f"kanban goal loop: block_fn failed ({exc})")

    def _result(outcome: str, reason: str) -> dict[str, Any]:
        return {"outcome": outcome, "turns_used": turns_used, "reason": reason}

    max_turns = int(max_turns or DEFAULT_MAX_TURNS)
    if max_turns < 1:
        max_turns = DEFAULT_MAX_TURNS

    turns_used = 1   # the first turn already consumed one unit of budget
    prompt = KANBAN_GOAL_CONTINUATION_TEMPLATE.format(reason="the task is still open on the board")

    while True:
        try:
            status = task_status_fn()
        except Exception as exc:
            _log(f"kanban goal loop: status check failed ({exc}); stopping")
            return _result("stopped", "status check failed")

        terminal = _KANBAN_TERMINAL_STATUSES.get(status)
        if terminal is not None:
            outcome, reason, log_fmt = terminal
            _log("kanban goal loop: " + log_fmt.format(task_id=task_id, turns=turns_used))
            return _result(outcome, reason)
        if status not in ("running", "ready"):
            # Reclaimed / archived / unexpected — let the dispatcher own it.
            _log(f"kanban goal loop: task {task_id} status={status!r}; stopping")
            return _result("stopped", f"status={status}")

        if turns_used >= max_turns:
            _log(f"kanban goal loop: task {task_id} exhausted {turns_used}/{max_turns} turns; blocking")
            _block(
                f"Goal-mode worker exhausted its turn budget ({turns_used}/{max_turns}) without "
                "completing the task. Say what remains and why it is not finished."
            )
            return _result("blocked_budget", "turn budget exhausted")

        try:
            result = run_turn(prompt)
            if isinstance(result, dict):
                failed = bool(result.get("failed", False))
                failure_reason = result.get("failure_reason") or "unknown"
            else:
                failed = False
                failure_reason = None
        except Exception as exc:
            _log(f"kanban goal loop: run_turn failed ({exc}); stopping")
            return _result("stopped", f"run_turn error: {type(exc).__name__}")
        if failed:
            _log(f"kanban goal loop: worker failed on turn {turns_used} (reason={failure_reason}); stopping")
            return _result("stopped", f"worker failed: {failure_reason}")
        turns_used += 1
        _log(f"kanban goal loop: turn {turns_used - 1}/{max_turns} asked the worker for the next step")
        prompt = KANBAN_GOAL_CONTINUATION_TEMPLATE.format(reason="the task is still open on the board")


__all__ = [
    "CONTINUATION_PROMPT_TEMPLATE",
    "CONTINUATION_PROMPT_WITH_CONTRACT_TEMPLATE",
    "CONTINUATION_PROMPT_WITH_SUBGOALS_TEMPLATE",
    "DEFAULT_MAX_TURNS",
    "DRAFT_CONTRACT_SYSTEM_PROMPT",
    "KANBAN_GOAL_CONTINUATION_TEMPLATE",
    "KANBAN_GOAL_FINALIZE_TEMPLATE",
    "GoalContract",
    "GoalGate",
    "GoalManager",
    "GoalState",
    "clear_goal",
    "draft_contract",
    "load_goal",
    "migrate_goal_to_session",
    "parse_contract",
    "run_gate",
    "run_kanban_goal_loop",
    "save_goal",
]
