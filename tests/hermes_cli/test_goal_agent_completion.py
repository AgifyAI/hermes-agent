"""The agent owns the ending of a goal (GST-203): ``update_goal``, no LLM judge.

Every assertion is behavioural: what the model can and cannot do, the stable refusal codes, the
authority of the human, and that the turn boundary never calls an auxiliary judge.
"""

from __future__ import annotations

import json
from unittest.mock import patch

import pytest


@pytest.fixture
def hermes_home(tmp_path, monkeypatch):
    from pathlib import Path

    home = tmp_path / ".hermes"
    home.mkdir()
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("HERMES_HOME", str(home))
    from hermes_cli import goals

    goals._DB_CACHE.clear()
    yield home
    goals._DB_CACHE.clear()


def _goal_in_a_round(session_id="agent-goal", *, rounds=1):
    from hermes_cli.goals import GoalManager

    mgr = GoalManager(session_id, default_max_tokens=0)
    mgr.set("ship the feature", max_tokens=0)
    for _ in range(rounds):
        mgr.reserve_round()
        mgr.admit_round()
    return mgr


def _update_goal(status: str, reason: str = "", session_id="agent-goal"):
    from tools.goal_tools import update_goal

    return json.loads(update_goal(status=status, reason=reason, session_id=session_id))


class TestComplete:
    def test_complete_from_a_goal_round_ends_the_goal(self, hermes_home):
        from hermes_cli.goals import GoalManager

        _goal_in_a_round()
        payload = _update_goal("complete", "delivered the feature; tests pass")
        assert payload["success"] is True
        assert payload["status"] == "complete"
        assert "closing summary" in payload["message"].lower()
        state = GoalManager("agent-goal").state
        assert state.phase == "complete"
        assert state.active_round is None
        assert "tests pass" in (state.last_reason or "")

    def test_complete_is_idempotent(self, hermes_home):
        from hermes_cli.goals import GoalManager

        _goal_in_a_round()
        assert _update_goal("complete")["success"] is True
        second = _update_goal("complete")
        assert second["success"] is True and second.get("idempotent") is True
        assert GoalManager("agent-goal").state.phase == "complete"

    def test_complete_from_a_plain_user_turn_is_refused(self, hermes_home):
        from hermes_cli.goals import GoalManager

        GoalManager("agent-goal").set("ship the feature", max_tokens=0)
        payload = _update_goal("complete")
        assert payload["success"] is False
        assert payload["error"] == "GOAL_NOT_A_GOAL_ROUND"
        assert "goal round" in payload["message"]
        assert GoalManager("agent-goal").state.phase == "active"

    def test_complete_without_any_goal_is_refused(self, hermes_home):
        payload = _update_goal("complete")
        assert payload["success"] is False
        assert payload["error"] == "GOAL_NOT_ACTIVE"

    def test_an_invalid_status_is_refused(self, hermes_home):
        payload = _update_goal("pause")
        assert payload["success"] is False
        assert payload["error"] == "GOAL_INVALID_STATUS"

    def test_the_turn_boundary_after_complete_does_not_continue(self, hermes_home):
        from hermes_cli import goal_driver

        mgr = _goal_in_a_round()
        _update_goal("complete")
        mgr.refresh()
        decision = goal_driver.plan_after_turn(mgr, "delivered", surface="test")
        assert decision["stop"] == goal_driver.STOP_COMPLETE
        assert decision["continuation"] is None
        assert decision["phase"] == "complete"


class TestBlocked:
    def test_blocked_before_the_threshold_is_refused(self, hermes_home):
        from hermes_cli.goals import GoalManager

        _goal_in_a_round(rounds=2)
        payload = _update_goal("blocked", "the API key is missing")
        assert payload["success"] is False
        assert payload["error"] == "GOAL_BLOCKED_TOO_EARLY"
        assert "before 3 goal rounds" in payload["message"]
        assert GoalManager("agent-goal").state.phase == "active"

    def test_blocked_at_the_threshold_is_accepted_with_a_reason(self, hermes_home):
        from hermes_cli.goals import GoalManager

        _goal_in_a_round(rounds=3)
        payload = _update_goal("blocked", "the API key is missing")
        assert payload["success"] is True
        assert payload["status"] == "blocked"
        state = GoalManager("agent-goal").state
        assert state.phase == "blocked"
        assert state.blocked_reason == {"code": "agent-blocked", "message": "the API key is missing"}

    def test_blocked_requires_a_reason(self, hermes_home):
        from hermes_cli.goals import GoalManager

        _goal_in_a_round(rounds=3)
        payload = _update_goal("blocked", "   ")
        assert payload["success"] is False
        assert payload["error"] == "GOAL_BLOCKED_REASON_REQUIRED"
        assert GoalManager("agent-goal").state.phase == "active"

    def test_blocked_is_idempotent(self, hermes_home):
        _goal_in_a_round(rounds=3)
        assert _update_goal("blocked", "missing key")["success"] is True
        second = _update_goal("blocked", "missing key")
        assert second["success"] is True and second.get("idempotent") is True


class TestAuthority:
    def test_a_subagent_cannot_pilot_the_parents_goal(self, hermes_home):
        """The tool answers for the session it runs in; a child session has no goal."""
        _goal_in_a_round()
        payload = _update_goal("complete", "child thinks it is done", session_id="child-session")
        assert payload["success"] is False
        assert payload["error"] == "GOAL_NOT_ACTIVE"
        from hermes_cli.goals import GoalManager

        assert GoalManager("agent-goal").state.phase == "active"

    def test_the_human_keeps_pause_and_resume(self, hermes_home):
        from hermes_cli.goals import GoalManager

        _goal_in_a_round()
        mgr = GoalManager("agent-goal")
        mgr.pause(reason="user-paused")
        assert mgr.state.phase == "paused"
        mgr.resume()
        assert mgr.state.phase == "active"

    def test_the_tool_surface_offers_only_complete_and_blocked(self):
        from tools.goal_tools import UPDATE_GOAL_SCHEMA

        props = UPDATE_GOAL_SCHEMA["parameters"]["properties"]
        assert props["status"]["enum"] == ["complete", "blocked"]
        assert UPDATE_GOAL_SCHEMA["parameters"]["required"] == ["status"]
        assert UPDATE_GOAL_SCHEMA["parameters"]["additionalProperties"] is False


class TestNoJudge:
    def test_the_decision_path_calls_no_auxiliary_model(self, hermes_home):
        from hermes_cli import goal_driver

        mgr = _goal_in_a_round()
        with patch("agent.auxiliary_client.call_llm") as call:
            decision = goal_driver.plan_after_turn(
                mgr, "worked but not done", surface="test", turn_tokens=1_000)
        call.assert_not_called()
        assert decision["stop"] == goal_driver.STOP_CONTINUED
        assert "update_goal" in decision["continuation"].prompt

    def test_the_continuation_prompt_carries_the_completion_audit(self, hermes_home):
        mgr = _goal_in_a_round()
        prompt = mgr.next_continuation_prompt()
        assert "Completion audit" in prompt
        assert "update_goal" in prompt
        assert "concrete evidence" in prompt
        assert "blocked is refused before 3 goal rounds" in prompt.lower()

    def test_a_blocked_goal_stops_at_the_boundary(self, hermes_home):
        from hermes_cli import goal_driver

        mgr = _goal_in_a_round(rounds=3)
        _update_goal("blocked", "missing key")
        mgr.refresh()
        decision = goal_driver.plan_after_turn(mgr, "cannot continue", surface="test")
        assert decision["stop"] == goal_driver.STOP_BLOCKED
        assert decision["continuation"] is None


class TestRegistry:
    def test_update_goal_is_registered_and_dispatches_through_the_registry(self, hermes_home):
        from tools.registry import registry

        _goal_in_a_round()
        raw = registry.dispatch("update_goal", {"status": "complete", "reason": "done"},
                                session_id="agent-goal")
        payload = json.loads(raw)
        assert payload["success"] is True

    def test_the_tool_belongs_to_the_goal_toolset(self):
        from tools.registry import registry

        entry = registry.get_entry("update_goal")
        assert entry is not None
        assert entry.toolset == "goal"
