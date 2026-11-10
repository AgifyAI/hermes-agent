"""The one round driver every goal surface goes through.

Before this module each surface carried its own copy of the post-turn logic (gateway FIFO hook, TUI
chained turn, CLI pending-input queue, kanban loop) with slightly different stops. The driver owns
the decisions; a surface only supplies how a continuation is dispatched.

The contract (DeepSeek Harness' ``dsh-goal-round-driver`` shape):

* A round is **reserved** before a continuation is offered and **admitted** only when that
  continuation message really enters the session. A human message that wins the boundary releases
  the reservation instead — no round is consumed by work that never started, and no round is
  double-counted.
* A continuation computed for a goal that was cleared, completed or replaced is dropped (the
  reservation carries the goal identity, and admission re-checks it against fresh state).
* ``armed`` is process memory (see :mod:`hermes_cli.goal_store`): a restart, a session resume, a fork
  or an unload leaves the goal disarmed, so nothing relaunches by itself; only a human ``resume``
  arms it again.
* Clean stops are explicit decision outcomes: failed turn, interrupted turn, compression exhausted,
  round cap, replaced goal.

The driver never imports the surfaces. It is synchronous (the judge and gates block), so callers run
it off their event loop.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any, Callable, Optional

from hermes_cli.goal_store import (
    disarm_goal,
    is_goal_armed,
    load_goal,
)

logger = logging.getLogger(__name__)


# Stop outcomes: why the driver chose not to continue. ``continued`` is the only one that carries a
# Continuation; every other one is a terminal state for this turn boundary.
STOP_COMPLETE = "complete"
STOP_BLOCKED = "blocked"
STOP_BUDGET = "budget-limited"
STOP_INACTIVE = "inactive"
STOP_DISARMED = "disarmed"
STOP_FAILED_TURN = "failed-turn"
STOP_INTERRUPTED = "interrupted"
STOP_COMPRESSION = "compression-exhausted"
STOP_HUMAN_PENDING = "human-preempted"
STOP_REPLACED = "goal-replaced"
STOP_ROUND_IN_FLIGHT = "round-in-flight"
STOP_CONTINUED = "continued"


@dataclass(frozen=True)
class Continuation:
    """A reserved continuation waiting for a surface to admit it."""

    goal_id: str
    revision: int
    round_no: int
    prompt: str
    # The single closing turn (budget spent): it runs while the goal is already budget_limited.
    closing: bool = False


def agent_tokens_delta(agent: Any, marks: dict[str, int], key: str = "total") -> int:
    """Tokens spent by the turn that just finished, from the agent's cumulative counters.

    The agent's ``session_*_tokens`` counters are cumulative for its whole life, so the surface keeps
    the last observed value in *marks* and the driver accounts the positive delta. A new agent (or a
    restored one whose counters restarted) yields the current value, never a negative.
    """
    if agent is None:
        return 0
    try:
        current = int(getattr(agent, "session_total_tokens", 0) or 0)
        previous = int(marks.get(key, 0) or 0)
        marks[key] = current
        return max(0, current - previous if current >= previous else current)
    except (TypeError, ValueError):  # health: allow BLE001 -- a fake agent without counters spends nothing to report
        return 0


def _inert(decision: dict[str, Any], stop: str) -> dict[str, Any]:
    decision["stop"] = stop
    decision["should_continue"] = False
    decision["continuation_prompt"] = None
    decision["continuation"] = None
    return decision


def plan_after_turn(
    mgr,
    response: str,
    *,
    surface: str,
    background_processes: Optional[list[dict[str, Any]]] = None,
    active_delegations: int = 0,
    failed: bool = False,
    interrupted: bool = False,
    compression_exhausted: bool = False,
    turn_tokens: int = 0,
    turn_seconds: float = 0.0,
) -> dict[str, Any]:
    """Decide what happens after a turn: judge/gates, then reserve the next round if valid.

    Returns the engine decision dict extended with ``stop``, ``goal_id``, ``revision`` and
    ``continuation`` (a :class:`Continuation` the caller must admit or release). The caller owns
    dispatch; the driver owns what is allowed to dispatch.
    """
    state = mgr.state if mgr is not None else None
    if state is None or state.phase != "active":
        if state is not None and state.phase == "complete":
            return _inert(
                {"status": "done", "phase": "complete", "should_continue": False,
                 "continuation_prompt": None, "verdict": "complete",
                 "reason": state.last_reason or "the agent marked the goal complete",
                 "message": ""},
                STOP_COMPLETE,
            )
        if state is not None and state.phase == "blocked":
            return _inert(
                {"status": "paused", "phase": "blocked", "should_continue": False,
                 "continuation_prompt": None, "verdict": "blocked",
                 "reason": (state.blocked_reason or {}).get("message") or "blocked",
                 "message": ""},
                STOP_BLOCKED,
            )
        if state is not None and state.phase == "budget_limited":
            # The closing turn already ran (or is in flight): no background work is relaunched;
            # only a human resume grants a new allowance.
            return _inert(
                {"status": "paused", "phase": "budget_limited", "should_continue": False,
                 "continuation_prompt": None, "verdict": "budget-limited",
                 "reason": "token budget reached",
                 "message": (f"⏹ Goal budget-limited — {int(state.tokens_used or 0):,}/"
                             f"{int(state.token_budget or 0):,} tokens used. "
                             "Use /goal resume to grant more budget, or /goal clear to stop.")},
                STOP_BUDGET,
            )
        return _inert(
            {"status": state.status if state else None, "phase": state.phase if state else None,
             "should_continue": False, "continuation_prompt": None, "verdict": "inactive",
             "reason": "no active goal", "message": ""},
            STOP_INACTIVE,
        )

    # Tokens are real spend whatever happens next: account them before any stop decision so the goal
    # cost stays exact even on a failed, disarmed or interrupted turn.
    if not turn_seconds:
        last = float(state.last_turn_at or state.created_at or 0.0)
        if last:
            turn_seconds = max(0.0, time.time() - last)
    if turn_tokens or turn_seconds:
        mgr.add_tokens(turn_tokens, seconds=turn_seconds)

    if not mgr.is_armed():
        # Restart/resume/fork/unload disarm; nothing relaunches until a human resumes the goal.
        return _inert(
            {"status": "active", "phase": "active", "should_continue": False,
             "continuation_prompt": None, "verdict": "disarmed", "message": "",
             "reason": "goal is active but not armed in this process"},
            STOP_DISARMED,
        )

    if failed:
        return _inert(
            {"status": "active", "phase": "active", "should_continue": False,
             "continuation_prompt": None, "verdict": "failed-turn", "message": "",
             "reason": "the turn failed before reaching the model"},
            STOP_FAILED_TURN,
        )
    if interrupted:
        # Judging a cancelled turn's partial output almost always says "continue" and would re-queue
        # exactly what the user cancelled. Pausing is explicit and recoverable with /goal resume.
        mgr.pause(reason="user-interrupted (Ctrl+C)")
        return _inert(
            {"status": "paused", "phase": "paused", "should_continue": False,
             "continuation_prompt": None, "verdict": "interrupted", "message": "",
             "reason": "turn interrupted by the user"},
            STOP_INTERRUPTED,
        )
    if compression_exhausted:
        # No judge and no continuation: without this pause the goal stayed active with no next round
        # (silent orphan after an exhausted compaction). Pausing is visible and /goal resume retries.
        mgr.pause(reason="context compression exhausted before the goal round could finish")
        return _inert(
            {"status": "paused", "phase": "paused", "should_continue": False,
             "continuation_prompt": None, "verdict": "compression-exhausted",
             "reason": "context compression exhausted",
             "message": ("⏸ Goal paused — context compression failed before this round could finish. "
                         "The history is safe; /goal resume retries, /goal edit re-scopes the work.")},
            STOP_COMPRESSION,
        )

    decision = mgr.evaluate_after_turn(
        response or "",
        user_initiated=True,
        background_processes=background_processes,
        active_delegations=active_delegations,
    )
    decision["goal_id"] = state.goal_id
    decision["revision"] = state.revision
    decision["continuation"] = None

    if decision.get("phase") == "complete" or decision.get("status") == "done":
        return _inert(decision, STOP_COMPLETE)
    if decision.get("phase") == "blocked":
        return _inert(decision, STOP_BLOCKED)
    if decision.get("phase") == "budget_limited":
        return _inert(decision, STOP_BUDGET)
    if decision.get("phase") == "paused":
        return _inert(decision, decision.get("stop") or STOP_BUDGET)
    if not decision.get("should_continue") or not decision.get("continuation_prompt"):
        return _inert(decision, decision.get("stop") or STOP_INACTIVE)

    # A round already reserved by an in-flight continuation (or a stale reservation from a dead
    # process) must not be double-counted; the surface decides that one.
    if state.reserved_round:
        return _inert(decision, STOP_ROUND_IN_FLIGHT)

    budget_stop = _token_budget_stop(mgr, decision, surface=surface)
    if budget_stop is not None:
        return budget_stop

    round_no = mgr.reserve_round()
    if round_no is None:
        return _inert(
            dict(decision, status="paused", phase="budget_limited",
                 message=(f"⏸ Goal paused — {state.rounds_started}/{state.max_rounds} rounds used. "
                          "Use /goal resume to keep going, or /goal clear to stop."),
                 reason="round budget exhausted"),
            STOP_BUDGET,
        )
    fresh = mgr.state or state
    decision["continuation"] = Continuation(
        goal_id=fresh.goal_id,
        revision=fresh.revision,
        round_no=round_no,
        prompt=decision["continuation_prompt"],
    )
    decision["stop"] = STOP_CONTINUED
    logger.info(
        "goal driver[%s]: continuation reserved for %s round %s/%s (goal %s)",
        surface, mgr.session_id, round_no, fresh.max_rounds, fresh.goal_id,
    )
    return decision


def _closing_prompt(state, reserve: int) -> str:
    """The ``budget_limit`` turn text lives with the other goal prompts."""
    from hermes_cli.goals import build_closing_prompt

    return build_closing_prompt(state, reserve=reserve)


def _token_budget_stop(mgr, decision: dict[str, Any], *, surface: str) -> Optional[dict[str, Any]]:
    """Token budget reached: offer the ONE closing turn, then stop launching work.

    The closing reserve is part of the budget: normal work stops while that reserve is still
    unspent, so the closing turn (summary / remaining / next step) is always affordable.
    """
    state = mgr.state
    if state is None or not state.token_budget:
        return None
    remaining = int(state.token_budget) - int(state.tokens_used or 0)
    reserve = mgr.closing_reserve()
    if remaining > reserve:
        return None
    if state.closing_issued:
        _inert(decision, STOP_BUDGET)
        decision["phase"] = "budget_limited"
        decision["message"] = (
            f"⏹ Goal budget-limited — {state.tokens_used:,}/{state.token_budget:,} tokens used "
            f"({reserve:,} kept for the closing turn, already delivered). "
            "Use /goal resume to grant more budget, or /goal clear to stop."
        )
        return decision
    round_no = mgr.reserve_round()
    if round_no is None:
        return _inert(decision, STOP_BUDGET)
    if mgr.issue_closing_turn(reserve=reserve) is None:
        return _inert(decision, STOP_BUDGET)
    state = mgr.state or state
    fresh = state
    decision["stop"] = STOP_CONTINUED
    decision["phase"] = "budget_limited"
    decision["message"] = (
        f"⏹ Goal budget-limited — {state.tokens_used:,}/{state.token_budget:,} tokens used. "
        f"One closing turn (summary, what remains, next step) is being sent."
    )
    decision["continuation"] = Continuation(
        goal_id=fresh.goal_id,
        revision=fresh.revision,
        round_no=round_no,
        prompt=_closing_prompt(state, reserve),
        closing=True,
    )
    logger.info(
        "goal driver[%s]: closing turn reserved for %s (%s/%s tokens, reserve %s)",
        surface, mgr.session_id, state.tokens_used, state.token_budget, reserve,
    )
    return decision


def plan_recovery(mgr, prompt: str, *, surface: str) -> Optional[Continuation]:
    """Reserve a round for a surface-computed recovery continuation (compression retry).

    The recovery prompt is not a judge verdict, but it still spends a turn: it goes through the same
    armed/cap/reservation rules so it cannot bypass the round budget.
    """
    state = mgr.state if mgr is not None else None
    if state is None or state.phase != "active" or not mgr.is_armed() or not prompt:
        return None
    if state.token_budget and int(state.tokens_used or 0) >= int(state.token_budget) - mgr.closing_reserve():
        return None  # only the closing reserve is left: no recovery work
    if state.reserved_round:
        return None
    round_no = mgr.reserve_round()
    if round_no is None:
        return None
    fresh = mgr.state or state
    logger.info(
        "goal driver[%s]: recovery continuation reserved for %s round %s/%s",
        surface, mgr.session_id, round_no, fresh.max_rounds,
    )
    return Continuation(
        goal_id=fresh.goal_id, revision=fresh.revision, round_no=round_no, prompt=prompt,
    )


def can_admit(mgr, continuation: Optional[Continuation], *, human_pending: bool = False) -> bool:
    """Whether this reservation may still be dispatched; releases it when it may not.

    Async surfaces (the gateway) call this before their own hand-off, then :func:`claim`.
    """
    if continuation is None or mgr is None:
        return False
    if human_pending:
        release(mgr, continuation, reason="a user message won the boundary")
        return False
    fresh = load_goal(mgr.session_id, upgrade=False) or mgr.state
    allowed_phase = "budget_limited" if continuation.closing else "active"
    if (
        fresh is None
        or fresh.goal_id != continuation.goal_id
        or fresh.revision != continuation.revision
        or fresh.phase != allowed_phase
        or fresh.reserved_round not in (None, continuation.round_no)
    ):
        # Ghost relaunch guard: the goal was cleared, completed, rewritten (a preserving rewrite keeps
        # the identity but bumps the revision), or the reservation belongs to another round. Nothing
        # is dispatched and no round is consumed.
        release(mgr, continuation, reason="goal changed before the continuation was admitted")
        return False
    return True


def claim(mgr, continuation: Continuation) -> bool:
    """Consume the reservation after the surface really handed the prompt to the session."""
    if not mgr.admit_round():
        release(mgr, continuation, reason="reservation lost before admission")
        return False
    return True


def admit(
    mgr,
    continuation: Optional[Continuation],
    dispatch: Callable[[str], bool],
    *,
    human_pending: bool = False,
) -> bool:
    """Claim the reserved round and hand the prompt to the surface.

    ``dispatch`` returns True when the continuation message really entered the session (or its
    ordered input queue). The reservation is admitted only then; every abort path releases it, so a
    preempted or failed hand-off never consumes a round.
    """
    if continuation is None or mgr is None:
        return False
    if not can_admit(mgr, continuation, human_pending=human_pending):
        return False
    try:
        accepted = bool(dispatch(continuation.prompt))
    except Exception:  # health: allow BLE001 -- the surface's dispatch is third-party scheduling code
        logger.warning("goal driver: continuation dispatch failed for %s", mgr.session_id, exc_info=True)
        release(mgr, continuation, reason="dispatch failed")
        return False
    if not accepted:
        release(mgr, continuation, reason="the surface refused the continuation")
        return False
    return claim(mgr, continuation)


def release(mgr, continuation: Optional[Continuation], *, reason: str = "") -> bool:
    """Release a reservation that will never be dispatched."""
    if mgr is None:
        return False
    try:
        released = mgr.release_round(reason=reason)
    except Exception:  # health: allow BLE001 -- a dropped reservation must not break teardown
        logger.debug("goal driver: release failed for %s", getattr(mgr, "session_id", "?"), exc_info=True)
        return False
    if released:
        logger.info("goal driver: released round %s for %s (%s)",
                    getattr(continuation, "round_no", "?"), mgr.session_id, reason or "no reason")
    return released


def finish_after_turn(
    mgr,
    response: str,
    *,
    surface: str,
    dispatch: Callable[[str], bool],
    background_processes: Optional[list[dict[str, Any]]] = None,
    active_delegations: int = 0,
    failed: bool = False,
    interrupted: bool = False,
    compression_exhausted: bool = False,
    human_pending: bool = False,
    turn_tokens: int = 0,
    turn_seconds: float = 0.0,
) -> dict[str, Any]:
    """``plan_after_turn`` + ``admit`` in one call for surfaces whose dispatch is synchronous."""
    decision = plan_after_turn(
        mgr, response, surface=surface, background_processes=background_processes,
        active_delegations=active_delegations, failed=failed, interrupted=interrupted,
        compression_exhausted=compression_exhausted,
        turn_tokens=turn_tokens, turn_seconds=turn_seconds,
    )
    continuation = decision.get("continuation")
    if continuation is not None:
        admitted = admit(mgr, continuation, dispatch, human_pending=human_pending)
        decision["admitted"] = admitted
    return decision


# ── Session lifecycle: armed is process memory only ──────────────────

def disarm_on_session_open(session_id: Optional[str]) -> None:
    """A session opened in this process starts disarmed (restart, resume, fork all go through it).

    The durable goal stays readable; only an explicit human ``/goal resume`` arms it again.
    """
    if session_id:
        disarm_goal(session_id)


def disarm_on_session_unload(session_id: Optional[str], *, mgr=None) -> None:
    """Unloading a session disarms it and drops any round that was reserved but never admitted."""
    if not session_id:
        return
    disarm_goal(session_id)
    if mgr is not None:
        try:
            mgr.release_round(reason="session unloaded")
        except Exception:  # health: allow BLE001 -- teardown must not raise
            logger.debug("goal driver: unload release failed for %s", session_id, exc_info=True)


__all__ = [
    "STOP_BLOCKED",
    "STOP_BUDGET",
    "STOP_COMPLETE",
    "STOP_COMPRESSION",
    "STOP_CONTINUED",
    "STOP_DISARMED",
    "STOP_FAILED_TURN",
    "STOP_HUMAN_PENDING",
    "STOP_INACTIVE",
    "STOP_INTERRUPTED",
    "STOP_REPLACED",
    "STOP_ROUND_IN_FLIGHT",
    "Continuation",
    "admit",
    "agent_tokens_delta",
    "can_admit",
    "claim",
    "disarm_on_session_open",
    "disarm_on_session_unload",
    "finish_after_turn",
    "plan_after_turn",
    "plan_recovery",
    "release",
]
