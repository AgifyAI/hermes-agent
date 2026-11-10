"""The model-facing /goal control tool: ``update_goal``.

A standing goal is ended by the agent itself, never by an auxiliary LLM judge. This tool is the one
sanctioned way for the model to say "the goal is complete" or "I am blocked"; the authority rules
(only from a real goal round, blocked refused before ``goals.blocked_min_rounds`` rounds, idempotent,
never create/edit/pause/resume) live in ``hermes_cli.goals.GoalManager`` so every surface agrees.
"""

from __future__ import annotations

import json
from typing import Any, Optional

from hermes_cli.goals import GoalManager, GoalToolRefusal
from tools.registry import registry


UPDATE_GOAL_SCHEMA: dict[str, Any] = {
    "name": "update_goal",
    "description": (
        "End the standing /goal for this session. Use status=\"complete\" only after running the "
        "completion audit from the continuation prompt (every requirement mapped to concrete "
        "evidence, real artifacts inspected, uncertainty treated as not done), and provide a "
        "one-line summary of what was delivered. Use status=\"blocked\" when a specific missing "
        "access, impossible requirement or user decision genuinely stops progress, and explain it "
        "in reason; blocked is refused before the configured number of goal rounds, so keep making "
        "progress until then. You cannot create, edit, pause or resume a goal — only the user can. "
        "Call this on a goal round, never on a plain user turn."
    ),
    "parameters": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "status": {
                "type": "string",
                "enum": ["complete", "blocked"],
                "description": "complete = the audited goal is done; blocked = a concrete blocker stops it.",
            },
            "reason": {
                "type": "string",
                "description": (
                    "complete: a one-line summary of the delivered result and its evidence. "
                    "blocked: exactly what blocks the goal and what the user must do. Required for blocked."
                ),
            },
        },
        "required": ["status"],
    },
}


def _json(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False)


def _refusal(exc: GoalToolRefusal) -> str:
    return _json({"success": False, "error": exc.code, "message": str(exc)})


def update_goal(status: str, reason: str = "", session_id: Optional[str] = None, **_kwargs: Any) -> str:
    """Handle ``update_goal`` in the agent process; every state write goes through the goal manager."""
    if not session_id:
        return _json({
            "success": False,
            "error": "GOAL_NO_SESSION",
            "message": "update_goal: this session has no goal-capable session id",
        })
    status = str(status or "").strip().lower()
    if status not in {"complete", "blocked"}:
        return _json({
            "success": False,
            "error": "GOAL_INVALID_STATUS",
            "message": "update_goal: status must be \"complete\" or \"blocked\"",
        })
    mgr = GoalManager(session_id)
    try:
        if status == "complete":
            payload = mgr.mark_complete_by_agent(reason)
        else:
            payload = mgr.mark_blocked_by_agent(reason)
    except GoalToolRefusal as exc:
        return _refusal(exc)
    return _json({"success": True, **payload})


def _check_goal_tool() -> bool:
    """Always reachable: the tool refuses with a stable code when no goal round is active.

    Deliberately NOT a per-session availability check — hiding a tool for some sessions would change
    the tool list mid-conversation and break prompt caching.
    """
    return True


registry.register(
    name="update_goal",
    toolset="goal",
    schema=UPDATE_GOAL_SCHEMA,
    handler=lambda args, **kw: update_goal(
        status=args.get("status", ""), reason=args.get("reason", ""),
        session_id=kw.get("session_id"),
    ),
    emoji="🎯",
    check_fn=_check_goal_tool,
)
