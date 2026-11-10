"""Structured Desktop controls for persisted goal, loop, and heartbeat state.

``session.control.read`` is a stable, allowlisted view of one live session.
``session.control`` accepts a closed set of intent-level actions: goal and
loop actions use their existing TUI command handlers, while controls without a
TUI command use the public manager API. A successful action emits one matching
``session.control.update`` event.
"""

from __future__ import annotations

import hashlib
import json
import logging
import threading
import time

from .method_ctx import HandlerRegistry, bind_module

_registry = HandlerRegistry()
method = _registry.method
_profile_scoped = _registry.profile_scoped

logger = logging.getLogger(__name__)


_ACTION_COMMAND_MAP: dict[str, tuple[str, str]] = {
    "goal.pause": ("goal", "pause"),
    "goal.resume": ("goal", "resume"),
    "goal.clear": ("goal", "clear"),
    "goal.unwait": ("goal", "unwait"),
    "loop.pause": ("loop", "pause"),
    "loop.resume": ("loop", "resume"),
    "loop.stop": ("loop", "stop"),
}

_MANAGER_ACTIONS = frozenset({
    "subgoal.add",
    "subgoal.remove",
    "subgoal.clear",
    "heartbeat.pause",
    "heartbeat.resume",
    "heartbeat.clear",
    # Goal editing (GST-202): objective rewrite (preserving), new goal, contract update.
    "goal.edit",
    "goal.set",
    "contract.set",
    # Quality gates (GST-198). session.control is owner-scoped (the Desktop viewer's own
    # connection is the session owner, the same trust position as the local-admin rule the
    # messaging surface applies); the shell command is echoed in the desktop confirmation
    # before it is ever sent here.
    "gate.add",
    "gate.remove",
    "gate.clear",
    # Deferral management (GST-198): set/clear the one bounded waiting state.
    "wait.set",
    "wait.clear",
    # Loop and heartbeat creation/editing from the panel (GST-205).
    "loop.set",
    "heartbeat.set",
})

# Actions whose input travels as ``args`` and is validated before any manager exists.
_GOAL_EDIT_ACTIONS = frozenset({"goal.edit", "goal.set", "contract.set"})
_CONTRACT_FIELDS = ("outcome", "verification", "constraints", "boundaries", "stop_when")
_GOAL_TEXT_MAX = 4000
_CONTRACT_FIELD_MAX = 2000
_GATE_COMMAND_MAX = 2000
_WAIT_REASON_MAX = 500

_VALID_ACTIONS = frozenset(_ACTION_COMMAND_MAP) | _MANAGER_ACTIONS


def _safe_goal_snapshot(state) -> dict | None:
    """Return only stable, frontend-safe GoalState fields."""
    if state is None or state.status == "cleared":
        return None
    snapshot = {
        "title": state.goal,
        # ``status`` keeps its historical names for old clients; ``phase`` is the versioned model
        # (active | paused | blocked | budget_limited | complete).
        "status": state.status,
        "phase": state.phase,
        "goal_id": state.goal_id,
        "revision": state.revision,
        "turns_used": state.rounds_started,
        "max_turns": state.max_rounds,
        "rounds_started": state.rounds_started,
        "max_rounds": state.max_rounds,
        "token_budget": state.token_budget,
        "tokens_used": state.tokens_used,
        "closing_issued": state.closing_issued,
        "time_used_seconds": state.time_used_seconds,
        "contract": state.contract.to_dict(),
        "subgoals": list(state.subgoals),
        "gates": [
            {
                "command": gate.command,
                "timeout_seconds": gate.timeout_seconds,
                "max_retries": gate.max_retries,
                "attempts": gate.attempts,
                "last_exit_code": gate.last_exit_code,
            }
            for gate in state.gates
        ],
    }
    if state.created_at:
        snapshot["created_at"] = state.created_at
    if state.last_turn_at:
        snapshot["updated_at"] = state.last_turn_at
    if state.paused_reason:
        snapshot["paused_reason"] = state.paused_reason
    if state.blocked_reason:
        snapshot["blocked_reason"] = dict(state.blocked_reason)
    if state.last_verdict:
        snapshot["last_verdict"] = state.last_verdict
    if state.last_reason:
        snapshot["last_reason"] = state.last_reason
    if barrier := _extract_wait_barrier(state):
        snapshot["wait_barrier"] = barrier
    if history := _goal_history(state):
        snapshot["history"] = history
    return snapshot


_HISTORY_LIMIT = 30
_HISTORY_KEYS = ("phase", "reason", "round", "tokens", "total", "command", "exit_code", "cause", "code", "goal")


def _goal_history(state) -> list[dict]:
    """The goal's own event journal, newest last, bounded and reduced to client-safe scalar fields.

    The journal lives in the goal row (MAX_EVENTS entries); the panel shows a compact chronological
    list, so only the tail and the fields the card actually renders cross the RPC boundary.
    """
    events = getattr(state, "events", None) or []
    history = []
    for event in events[-_HISTORY_LIMIT:]:
        if not isinstance(event, dict):
            continue
        entry = {"at": float(event.get("ts") or 0.0), "event": str(event.get("event") or "")}
        for key in _HISTORY_KEYS:
            value = event.get(key)
            if isinstance(value, (str, int, float, bool)) and value != "":
                entry[key] = value
        history.append(entry)
    return history


def _extract_wait_barrier(state) -> dict | None:
    """Expose the one continuation deferral; countdown presentation belongs to the client.

    ``cause`` makes the wait actionable in the panel (background work / timer / subagents /
    compaction / human-pending), ``deadline_at`` and ``remaining_seconds`` carry the hard ceiling.
    """
    reason = state.waiting_reason or ""
    now = time.time()
    cause = state.waiting_cause
    ceiling = float(state.waiting_max_seconds or 0.0)
    if state.waiting_on_session is not None:
        target = state.waiting_on_session
        kind = "session"
    elif state.waiting_on_pid is not None:
        target = state.waiting_on_pid
        kind = "pid"
    elif state.waiting_until and now < state.waiting_until:
        target = None
        kind = "until"
    else:
        return None
    if cause is None:
        cause = {"session": "background-session", "pid": "background-process"}.get(kind, "timer")
    started = float(state.waiting_since or 0.0)
    hard_stop = started + ceiling if started and ceiling else 0.0
    if kind == "until":
        deadline = min(float(state.waiting_until), hard_stop) if hard_stop else float(state.waiting_until)
    else:
        deadline = hard_stop
    barrier = {"type": kind, "cause": cause, "reason": reason}
    if target is not None:
        barrier["target"] = target
    if deadline:
        barrier["deadline_at"] = deadline
        barrier["remaining_seconds"] = max(0, round(deadline - now))
    if ceiling:
        barrier["max_seconds"] = ceiling
    return barrier


def _safe_loop_snapshot(state, *, deferred_by_goal: bool) -> dict | None:
    """Return allowlisted persisted LoopState fields, never its route."""
    if state is None or state.status == "cleared":
        return None
    snapshot = {
        "prompt": state.prompt,
        "status": state.status,
        "mode": state.mode,
        "interval_seconds": state.interval_seconds,
        "current_delay": state.current_delay,
        "times": state.times,
        "until": state.until,
        "max_ticks": state.max_ticks,
        "ticks_fired": state.ticks_fired,
        "created_at": state.created_at,
        "last_fired_at": state.last_fired_at,
        "next_due_at": state.next_due_at,
        "awaiting_response": state.awaiting_response,
        "deferred_by_goal": deferred_by_goal,
    }
    if state.paused_reason:
        snapshot["paused_reason"] = state.paused_reason
    if state.last_stop_reason:
        snapshot["last_stop_reason"] = state.last_stop_reason
    return snapshot


def _safe_heartbeat_snapshot(state) -> dict | None:
    """Return only the persisted HeartbeatState fields the Desktop renders."""
    if state is None or state.status == "cleared":
        return None
    return {
        "prompt": state.prompt,
        "status": state.status,
        "interval_seconds": state.interval_seconds,
        "created_at": state.created_at,
        "last_fired_at": state.last_fired_at,
        "fire_count": state.fire_count,
    }


def _snapshot_control(session_key: str) -> dict:
    """Serialize persisted session-control state once, without wall-clock churn."""
    goal_state = _load_goal_state(session_key)
    loop_state = _load_loop_state(session_key)
    heartbeat_state = _load_heartbeat_state(session_key)
    deferred_by_goal = bool(
        loop_state is not None
        and loop_state.status == "active"
        and goal_state is not None
        and goal_state.status == "active"
        and _goal_blocks_loop_tick(session_key)
    )
    goal = _safe_goal_snapshot(goal_state)
    loop = _safe_loop_snapshot(loop_state, deferred_by_goal=deferred_by_goal)
    heartbeat = _safe_heartbeat_snapshot(heartbeat_state)
    return {
        "goal": goal,
        "loop": loop,
        "heartbeat": heartbeat,
        "revision": _snapshot_revision(goal, loop, heartbeat),
        "updated_at": _snapshot_updated_at(goal_state, loop_state, heartbeat_state),
    }


def _snapshot_revision(goal, loop, heartbeat) -> str:
    """Hash canonical visible state so equal reads always have equal revisions."""
    if goal is None and loop is None and heartbeat is None:
        return ""
    canonical = json.dumps(
        {"goal": goal, "loop": loop, "heartbeat": heartbeat},
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _snapshot_updated_at(goal_state, loop_state, heartbeat_state):
    """Use only persisted timestamps; reads never manufacture a new timestamp."""
    candidates = []
    for state, fields in (
        (goal_state, ("created_at", "last_turn_at")),
        (loop_state, ("created_at", "last_fired_at")),
        (heartbeat_state, ("created_at", "last_fired_at")),
    ):
        if state is not None:
            candidates.extend(value for field in fields if (value := getattr(state, field, 0)))
    return max(candidates) if candidates else 0


def _load_goal_state(session_key):
    from hermes_cli.goals import load_goal

    return load_goal(session_key)


def _load_loop_state(session_key):
    from hermes_cli.loops import load_loop

    return load_loop(session_key)


def _load_heartbeat_state(session_key):
    from hermes_cli.heartbeat import load_heartbeat

    return load_heartbeat(session_key)


def _goal_blocks_loop_tick(session_key: str) -> bool:
    from hermes_cli.loops import goal_blocks_loop_tick

    return goal_blocks_loop_tick(session_key)


# Slash commands whose success changes the snapshot; ``command.dispatch`` (/goal, /loop built-ins) and the
# slash worker (/heartbeat, /subgoal) both publish after these so the Desktop card never waits for a turn.
_SESSION_CONTROL_SLASHES = frozenset({"goal", "heartbeat", "loop", "subgoal"})


# Tool completions publish from the agent thread while control actions and slash commands publish from
# RPC threads: the snapshot read, the revision compare and the emit happen as one step, so an update read
# before a user's change can never be emitted after it. The lock is the SESSION's: a stalled socket write
# (up to the transport's write timeout) only holds back that session's own later updates, never another's.
_PUBLISH_LOCK_GUARD = threading.Lock()


def _session_publish_lock(session: dict) -> threading.Lock:
    lock = session.get("control_publish_lock")
    if lock is None:
        with _PUBLISH_LOCK_GUARD:
            lock = session.setdefault("control_publish_lock", threading.Lock())
    return lock


def _publish_session_control_snapshot(sid: str, session: dict | None, *, only_if_present: bool = False,
                                      only_if_changed: bool = False) -> None:
    """Best-effort ``session.control.update`` for one live session. Also called after the post-turn hooks,
    because the goal judge and loop tick evaluation mutate persisted state AFTER ``message.complete`` — a
    client refresh keyed on that event reads the pre-judge turn count. ``only_if_present`` keeps the
    post-turn event stream of a session with no automation state byte-identical to today's;
    ``only_if_changed`` (every tool completion) also skips a snapshot equal to the last one published."""
    if not session or not (session_key := str(session.get("session_key") or "")):
        return
    try:
        with _session_publish_lock(session):
            with _session_profile_runtime_scope(session):
                control = _snapshot_control(session_key)
            if (only_if_present and not control["revision"]) or (
                    only_if_changed and control["revision"] == session.get("control_revision", "")):
                return
            session["control_revision"] = control["revision"]
            _emit("session.control.update", sid, {"control": control})
    except Exception:
        logger.debug("session.control.update publish failed for %s", sid, exc_info=True)


@method("session.control.read")
@_profile_scoped
def _(rid, params: dict) -> dict:
    """Return the current stable control snapshot for a live session."""
    session, err = _sess_nowait(params, rid)
    if err:
        return err
    session_key = str(session.get("session_key") or "")
    if not session_key:
        return _err(rid, 4001, "session has no stored key")
    try:
        return _ok(rid, {"control": _snapshot_control(session_key)})
    except Exception as exc:
        logger.debug("session.control.read failed: %s", exc, exc_info=True)
        return _err(rid, 5031, f"session.control.read failed: {exc}")


@method("session.control")
@_profile_scoped
def _(rid, params: dict) -> dict:
    """Run one allowlisted control action and emit its exact resulting snapshot."""
    raw_action = params.get("action")
    if not isinstance(raw_action, str) or not (action := raw_action.strip()):
        return _err(rid, 4004, "action is required")
    if action.startswith("goal.gate"):
        return _err(rid, 4004, "gate actions are not allowed through session.control")
    if action not in _VALID_ACTIONS:
        return _err(rid, 4004, f"unknown action: {action}")

    if "args" in params:
        args = params["args"]
        if not isinstance(args, dict):
            return _err(rid, 4004, "args must be an object")
    else:
        args = {}
    validated, validation_error = _validate_action_args(rid, action, args)
    if validation_error:
        return validation_error

    session, err = _sess_nowait(params, rid)
    if err:
        return err
    session_key = str(session.get("session_key") or "")
    if not session_key:
        return _err(rid, 4001, "session has no stored key")

    try:
        if action in _ACTION_COMMAND_MAP:
            name, arg = _ACTION_COMMAND_MAP[action]
            action_result = _dispatch_command(rid, session_id=params.get("session_id") or "", name=name, arg=arg)
        elif action in _GOAL_EDIT_ACTIONS:
            action_result = _execute_goal_edit_action(
                rid, session_id=params.get("session_id") or "", session_key=session_key,
                action=action, args=validated)
            if "error" in action_result:
                return action_result
        else:
            action_result = _execute_manager_action(session_key, action, validated)
    except (RuntimeError, ValueError, IndexError) as exc:
        return _err(rid, 4004, _manager_error_message(action, exc))

    if "error" in action_result:
        return action_result

    try:
        control = _snapshot_control(session_key)
    except Exception as exc:
        logger.debug("session.control snapshot after %s failed: %s", action, exc, exc_info=True)
        return _err(rid, 5031, f"session.control snapshot failed: {exc}")

    # command.dispatch already published the update for goal/loop actions; manager actions publish here,
    # through the one publisher that records the revision the tool-completion gate compares against.
    if action not in _ACTION_COMMAND_MAP:
        _publish_session_control_snapshot(params.get("session_id") or "", session)
    return _ok(rid, {"control": control, "dispatch": _dispatch_envelope(action_result)})


def _validated_contract(rid, value, *, partial: bool):
    """Validate the 5-field completion contract payload; None = absent."""
    if value is None:
        return {}, None
    if not isinstance(value, dict) or set(value) - set(_CONTRACT_FIELDS):
        return None, _err(rid, 4004, "contract must be an object with outcome, verification, constraints, boundaries, stop_when")
    clean: dict[str, str] = {}
    for key in _CONTRACT_FIELDS:
        if key not in value:
            continue
        field = value[key]
        if not isinstance(field, str):
            return None, _err(rid, 4004, f"contract {key} must be a string")
        if len(field) > _CONTRACT_FIELD_MAX:
            return None, _err(rid, 4004, f"contract {key} is too long (max {_CONTRACT_FIELD_MAX})")
        clean[key] = field.strip()
    return clean, None


def _validated_gate_add(rid, args: dict):
    command = args.get("command")
    if not isinstance(command, str) or not (command := command.strip()):
        return None, _err(rid, 4004, "gate command is required")
    if len(command) > _GATE_COMMAND_MAX:
        return None, _err(rid, 4004, f"gate command is too long (max {_GATE_COMMAND_MAX})")
    timeout = args.get("timeout_seconds")
    if timeout is not None and (type(timeout) is not int or not 1 <= timeout <= 3600):
        return None, _err(rid, 4004, "timeout_seconds must be an integer between 1 and 3600")
    retries = args.get("max_retries")
    if retries is not None and (type(retries) is not int or not 0 <= retries <= 10):
        return None, _err(rid, 4004, "max_retries must be an integer between 0 and 10")
    return {"command": command, "max_retries": retries, "timeout_seconds": timeout}, None


def _validated_wait_set(rid, args: dict):
    reason = args.get("reason", "")
    if not isinstance(reason, str) or len(reason) > _WAIT_REASON_MAX:
        return None, _err(rid, 4004, f"wait reason must be a string up to {_WAIT_REASON_MAX} characters")
    targets = [key for key in ("seconds", "pid", "session_id") if args.get(key) is not None]
    if len(targets) != 1:
        return None, _err(rid, 4004, "wait.set needs exactly one of seconds, pid or session_id")
    if "seconds" in targets and (type(args["seconds"]) is not int or not 1 <= args["seconds"] <= 86400):
        return None, _err(rid, 4004, "seconds must be an integer between 1 and 86400")
    if "pid" in targets and (type(args["pid"]) is not int or args["pid"] <= 0):
        return None, _err(rid, 4004, "pid must be a positive integer")
    if "session_id" in targets and (not isinstance(args["session_id"], str) or not args["session_id"].strip()):
        return None, _err(rid, 4004, "session_id must be a non-empty string")
    return {
        "pid": args.get("pid"),
        "reason": reason.strip(),
        "seconds": args.get("seconds"),
        "session_id": (args.get("session_id") or "").strip() or None,
    }, None


def _validated_loop_set(rid, args: dict):
    prompt = args.get("prompt")
    if not isinstance(prompt, str) or not (prompt := prompt.strip()):
        return None, _err(rid, 4004, "loop prompt is required")
    if len(prompt) > _GOAL_TEXT_MAX:
        return None, _err(rid, 4004, f"loop prompt is too long (max {_GOAL_TEXT_MAX})")
    interval = args.get("interval_seconds")
    if interval is not None and (type(interval) is not int or not 1 <= interval <= 86400):
        return None, _err(rid, 4004, "interval_seconds must be an integer between 1 and 86400")
    times = args.get("times")
    if times is not None and (type(times) is not int or not 0 <= times <= 100000):
        return None, _err(rid, 4004, "times must be an integer between 0 and 100000")
    until = args.get("until", "")
    if not isinstance(until, str) or len(until) > 200:
        return None, _err(rid, 4004, "until must be a string up to 200 characters")
    return {"interval_seconds": interval, "prompt": prompt, "times": times or 0, "until": until.strip()}, None


def _validated_heartbeat_set(rid, args: dict):
    prompt = args.get("prompt")
    if not isinstance(prompt, str) or not (prompt := prompt.strip()):
        return None, _err(rid, 4004, "heartbeat prompt is required")
    if len(prompt) > _GOAL_TEXT_MAX:
        return None, _err(rid, 4004, f"heartbeat prompt is too long (max {_GOAL_TEXT_MAX})")
    interval = args.get("interval_seconds")
    if type(interval) is not int or not 1 <= interval <= 604800:
        return None, _err(rid, 4004, "interval_seconds must be an integer between 1 and 604800")
    return {"interval_seconds": interval, "prompt": prompt}, None


def _validate_action_args(rid, action: str, args: dict):
    """Validate the only actions with input before any manager is constructed."""
    if action == "gate.add":
        return _validated_gate_add(rid, args)
    if action == "gate.remove":
        index = args.get("index")
        if type(index) is not int or index < 1:
            return None, _err(rid, 4004, "gate index must be >= 1")
        return {"index": index}, None
    if action == "loop.set":
        return _validated_loop_set(rid, args)
    if action == "heartbeat.set":
        return _validated_heartbeat_set(rid, args)
    if action == "wait.set":
        return _validated_wait_set(rid, args)
    if action in {"gate.clear", "wait.clear"}:
        return {}, None
    if action in {"goal.edit", "goal.set"}:
        return _validated_goal_text(rid, args)
    if action == "contract.set":
        return _validated_contract_set(rid, args)
    if action in {"subgoal.add", "subgoal.remove"}:
        return _validated_subgoal(rid, action, args)
    return {}, None


def _validated_goal_text(rid, args: dict):
    text = args.get("text")
    if not isinstance(text, str) or not (text := text.strip()):
        return None, _err(rid, 4004, "goal text is required")
    if len(text) > _GOAL_TEXT_MAX:
        return None, _err(rid, 4004, f"goal text is too long (max {_GOAL_TEXT_MAX})")
    contract, err = _validated_contract(rid, args.get("contract"), partial=False)
    if err:
        return None, err
    revision = args.get("revision")
    if revision is not None and type(revision) is not int:
        return None, _err(rid, 4004, "revision must be an integer")
    return {"text": text, "contract": contract, "revision": revision}, None


def _validated_contract_set(rid, args: dict):
    contract, err = _validated_contract(rid, args.get("contract"), partial=True)
    if err:
        return None, err
    revision = args.get("revision")
    if revision is not None and type(revision) is not int:
        return None, _err(rid, 4004, "revision must be an integer")
    return {"contract": contract, "revision": revision}, None


def _validated_subgoal(rid, action: str, args: dict):
    if action == "subgoal.add":
        text = args.get("text")
        if not isinstance(text, str) or not (text := text.strip()):
            return None, _err(rid, 4004, "subgoal text is required")
        if len(text) > 500:
            return None, _err(rid, 4004, "subgoal text is too long (max 500)")
        return {"text": text}, None
    index = args.get("index")
    if type(index) is not int or index < 1:
        return None, _err(rid, 4004, "subgoal index must be >= 1")
    return {"index": index}, None


def _dispatch_command(rid, *, session_id: str, name: str, arg: str) -> dict:
    """Delegate a fixed intent to the existing TUI command dispatcher."""
    handler = _methods.get("command.dispatch")
    if handler is None:
        return _err(rid, 5031, "command.dispatch unavailable")
    try:
        return handler(rid, {"session_id": session_id, "name": name, "arg": arg})
    except Exception as exc:
        logger.debug("command.dispatch %s %s failed: %s", name, arg, exc, exc_info=True)
        return _err(rid, 5031, f"dispatch failed: {exc}")


def _goal_command_arg(verb: str, text: str, contract: dict[str, str]) -> str:
    """Build the /goal command line for an edit/set, inline contract fields included."""
    lines = [text]
    for key in _CONTRACT_FIELDS:
        value = contract.get(key)
        if value:
            lines.append(f"{key}: {value}")
    body = "\n".join(lines)
    return f"{verb} {body}" if verb else body


def _execute_goal_edit_action(rid, *, session_id: str, session_key: str, action: str, args: dict) -> dict:
    """goal.edit / goal.set / contract.set: preserving rewrite, new goal, contract update.

    ``revision`` is the snapshot revision the client's form was built from; a mismatch means another
    surface changed the goal meanwhile, so the card must refresh instead of overwriting.
    """
    from hermes_cli.goals import GoalContract, GoalManager, load_goal

    state = load_goal(session_key)
    expected = args.get("revision")
    if expected is not None and state is not None and int(state.revision) != int(expected):
        return _err(rid, 4004,
                    "the goal changed since this form was loaded; reload the card and try again")
    if action == "contract.set":
        if state is None or state.phase == "cleared":
            return _err(rid, 4004, "no goal to update the contract on")
        merged = state.contract.to_dict()
        merged.update(args["contract"])
        contract = GoalContract.from_dict(merged)
        try:
            modified = GoalManager(session_key).set_contract(contract)
        except (RuntimeError, ValueError) as exc:
            return _err(rid, 4004, _manager_error_message(action, exc))
        if modified is None:
            return _err(rid, 4004, "no goal to update the contract on")
        return {"result": {"type": "exec", "output": "Completion contract updated."}}
    verb = "edit" if action == "goal.edit" else ""
    return _dispatch_command(rid, session_id=session_id, name="goal",
                             arg=_goal_command_arg(verb, args["text"], args["contract"]))


def _execute_manager_action(session_key: str, action: str, args: dict) -> dict:
    """Use manager APIs for controls that have no TUI command handler."""
    if action.startswith("subgoal."):
        return _execute_subgoal_action(session_key, action, args)
    if action.startswith("gate."):
        return _execute_gate_action(session_key, action, args)
    if action.startswith("wait."):
        return _execute_wait_action(session_key, action, args)
    if action.startswith("loop."):
        return _execute_loop_action(session_key, action, args)
    return _execute_heartbeat_action(session_key, action, args)


def _execute_gate_action(session_key: str, action: str, args: dict) -> dict:
    """Quality gates from the panel: add (shell command), remove one, clear all."""
    from hermes_cli.goals import GoalManager

    manager = GoalManager(session_id=session_key)
    if action == "gate.add":
        gate = manager.add_gate(
            args["command"], timeout_seconds=args["timeout_seconds"], max_retries=args["max_retries"])
        output = (f"⚿ Gate added: $ {gate.command} "
                  f"({gate.max_retries} retries, {gate.timeout_seconds}s timeout). "
                  "It must pass before the goal can complete.")
        return {"result": {"type": "exec", "output": output}}
    if action == "gate.remove":
        index = args["index"]
        command = manager.remove_gate(index)
        return {"result": {"type": "exec", "output": f"✓ Removed gate {index}: $ {command}"}}
    count = manager.clear_gates()
    output = f"✓ Cleared {count} gate{'s' if count != 1 else ''}." if count else "No gates to clear."
    return {"result": {"type": "exec", "output": output}}


def _execute_wait_action(session_key: str, action: str, args: dict) -> dict:
    """The one bounded deferral: set it explicitly, or clear it (resume now)."""
    from hermes_cli.goals import GoalManager

    manager = GoalManager(session_id=session_key)
    if action == "wait.clear":
        if not manager.stop_waiting():
            return {"result": {"type": "exec", "output": "No deferred continuation to resume."}}
        return {"result": {"type": "exec", "output": "▶ Deferral cleared — the goal loop resumes now."}}
    reason = args["reason"]
    if args["pid"] is not None:
        manager.wait_on(args["pid"], reason=reason)
    elif args["session_id"]:
        manager.wait_on_session(args["session_id"], reason=reason)
    else:
        manager.wait_for_seconds(args["seconds"], reason=reason)
    state = manager.state
    if state is not None and state.waiting_on_session is not None:
        target = f"session {state.waiting_on_session}"
    elif state is not None and state.waiting_on_pid is not None:
        target = f"pid {state.waiting_on_pid}"
    elif state is not None and state.waiting_on_delegations:
        target = f"{state.waiting_on_delegations} subagent batch(es)"
    else:
        target = f"{manager.deferral_remaining()}s timed wait"
    remaining = manager.deferral_remaining()
    return {"result": {"type": "exec", "output": (
        f"⏳ Goal deferred on {target} — {remaining}s left, ceiling {manager.max_wait_seconds()}s. "
        "/goal unwait resumes now.")}}


def _execute_subgoal_action(session_key: str, action: str, args: dict) -> dict:
    from hermes_cli.goals import GoalManager

    manager = GoalManager(session_id=session_key)
    if action == "subgoal.add":
        text = manager.add_subgoal(args["text"])
        return {"result": {"type": "exec", "output": f"✓ Added subgoal {len(manager.state.subgoals)}: {text}"}}
    if action == "subgoal.remove":
        index = args["index"]
        text = manager.remove_subgoal(index)
        return {"result": {"type": "exec", "output": f"✓ Removed subgoal {index}: {text}"}}
    count = manager.clear_subgoals()
    output = f"✓ Cleared {count} subgoal{'s' if count != 1 else ''}." if count else "No subgoals to clear."
    return {"result": {"type": "exec", "output": output}}


def _execute_loop_action(session_key: str, action: str, args: dict) -> dict:
    """Create or replace the session loop from the panel (pause/resume/stop go through /loop)."""
    from hermes_cli.loops import LoopManager

    manager = LoopManager(session_id=session_key)
    state = manager.set(
        args["prompt"],
        interval_seconds=args["interval_seconds"],
        times=args["times"],
        until=args["until"],
    )
    cadence = state.cadence_label()
    runs = f", {state.times} runs" if state.times else ""
    return {"result": {"type": "exec", "output": f"↻ Loop set ({cadence}{runs}): {state.prompt}"}}


def _execute_heartbeat_action(session_key: str, action: str, args: dict | None = None) -> dict:
    from hermes_cli.heartbeat import HeartbeatManager, format_interval

    manager = HeartbeatManager(session_id=session_key)
    if action == "heartbeat.set":
        state = manager.set(args["prompt"], args["interval_seconds"])
        return {"result": {"type": "exec", "output": f"♥ Heartbeat set (every {format_interval(state.interval_seconds)}): {state.prompt}"}}
    if action == "heartbeat.pause":
        state = manager.pause()
        output = f"⏸ Heartbeat paused: {state.prompt}" if state else "No heartbeat set."
    elif action == "heartbeat.resume":
        state = manager.resume()
        output = (
            f"▶ Heartbeat resumed (every {format_interval(state.interval_seconds)}): {state.prompt}"
            if state else "No heartbeat to resume."
        )
    elif action == "heartbeat.clear":
        output = "✓ Heartbeat cleared." if manager.clear() else "No heartbeat set."
    else:
        return _err(None, 4004, f"unknown heartbeat action: {action}")
    return {"result": {"type": "exec", "output": output}}


def _manager_error_message(action: str, exc: Exception) -> str:
    prefixes = {
        "subgoal.add": "/subgoal",
        "subgoal.remove": "/subgoal remove",
        "subgoal.clear": "/subgoal clear",
    }
    return f"{prefixes.get(action, action)}: {exc}"


def _dispatch_envelope(response: dict) -> dict:
    """Keep the command result's user-visible envelope without adding model-facing data."""
    result = response.get("result") or {}
    return {
        "type": result.get("type"),
        "output": result.get("output"),
        "notice": result.get("notice"),
        "message": result.get("message"),
        "display": result.get("display"),
    }


def register(server) -> None:
    """Rebind this module's handlers onto the server namespace."""
    bind_module(globals(), server, skip=("_",))
