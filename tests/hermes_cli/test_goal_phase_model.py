"""The versioned goal model (GST-193): goals get an identity, a revision, phases and a journal.

Every assertion is a behaviour contract, not a source read: legacy rows must load, two writers must
not silently overwrite each other, a second goal must not discard the first one's progress, and the
"armed" state must never survive a restart.
"""

from __future__ import annotations

import json
import time
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
    goals.disarm_goal("phase-sid")
    yield home
    goals._DB_CACHE.clear()


def _raw(session_id: str) -> dict:
    from hermes_cli import goals

    db = goals._get_session_db()
    return json.loads(db.get_meta(f"goal:{session_id}"))


def _write_raw(session_id: str, payload: dict) -> None:
    from hermes_cli import goals

    goals._get_session_db().set_meta(f"goal:{session_id}", json.dumps(payload))


class TestLegacyMigration:
    def test_legacy_active_row_is_upgraded_in_place(self, hermes_home):
        from hermes_cli import goals

        _write_raw("legacy-active", {
            "goal": "finish the migration", "status": "active", "turns_used": 3, "max_turns": 9,
            "created_at": 1.0, "last_turn_at": 2.0,
        })
        state = goals.load_goal("legacy-active")
        assert state is not None
        assert state.phase == "active"
        assert state.status == "active"
        assert state.rounds_started == 3
        assert state.max_rounds == 9
        assert state.goal_id  # identity was minted
        assert state.revision == 1

        # The upgrade is persisted once: the row now carries the new keys, not the old shape.
        stored = _raw("legacy-active")
        assert stored["phase"] == "active"
        assert stored["goal_id"] == state.goal_id
        assert "turns_used" not in stored

    def test_legacy_done_maps_to_complete(self, hermes_home):
        from hermes_cli import goals

        _write_raw("legacy-done", {"goal": "old", "status": "done", "turns_used": 4})
        state = goals.load_goal("legacy-done")
        assert state.phase == "complete"
        assert state.status == "done"  # legacy readers keep seeing "done"

    def test_legacy_paused_row_stays_paused(self, hermes_home):
        from hermes_cli import goals

        _write_raw("legacy-paused", {"goal": "old", "status": "paused", "paused_reason": "user"})
        assert goals.load_goal("legacy-paused").phase == "paused"


class TestCompareAndSet:
    def test_stale_revision_is_refused_instead_of_overwriting(self, hermes_home):
        from hermes_cli import goals

        mgr = goals.GoalManager("cas-sid")
        mgr.set("first objective")
        first_revision = mgr.state.revision

        # A second surface reads the same revision and saves a change.
        other = goals.GoalManager("cas-sid")
        other.state.goal = "other surface objective"
        other._save()

        stale = goals.GoalManager("cas-sid")
        stale._revision = first_revision  # it loaded before the other write
        stale.state.goal = "stale objective"
        with pytest.raises(goals.GoalStaleRevision) as excinfo:
            goals.save_goal("cas-sid", stale.state, expected_revision=first_revision)
        assert excinfo.value.code == "GOAL_STALE_REVISION"

        # The newer write survives.
        assert goals.load_goal("cas-sid").goal == "other surface objective"

    def test_successful_write_bumps_the_revision(self, hermes_home):
        from hermes_cli import goals

        mgr = goals.GoalManager("cas-ok")
        mgr.set("objective")
        start = mgr.state.revision
        mgr.add_subgoal("criterion")
        assert mgr.state.revision == start + 1
        assert _raw("cas-ok")["revision"] == start + 1

    def test_manager_retries_once_when_another_surface_moved_the_revision(self, hermes_home):
        from hermes_cli import goals

        mgr = goals.GoalManager("cas-retry")
        mgr.set("objective")
        goals.GoalManager("cas-retry").add_subgoal("external criterion")
        # The first CAS fails, the manager adopts the fresh revision and retries with its own change.
        mgr.pause(reason="user-paused")
        stored = goals.load_goal("cas-retry")
        # The CAS detected the racing write (logged, one retry) and the newest local intent landed.
        assert stored.phase == "paused"
        assert stored.revision >= 3


class TestOneUnfinishedGoal:
    def test_second_goal_refused_while_one_is_in_progress(self, hermes_home):
        from hermes_cli import goals

        mgr = goals.GoalManager("one-goal")
        mgr.set("first objective")
        with pytest.raises(goals.GoalAlreadyActive) as excinfo:
            mgr.set("second objective")
        assert excinfo.value.code == "GOAL_ALREADY_ACTIVE"
        assert goals.load_goal("one-goal").goal == "first objective"

    def test_preserving_rewrite_keeps_rounds_criteria_gates_and_contract(self, hermes_home):
        from hermes_cli import goals

        mgr = goals.GoalManager("rewrite-sid")
        mgr.set("first objective", contract=goals.GoalContract(verification="tests pass"))
        mgr.add_subgoal("keep the API stable")
        mgr.add_gate("true")
        mgr.reserve_round()
        mgr.admit_round()
        with patch("hermes_cli.goals.judge_goal", return_value=("continue", "more", False, None, False)):
            mgr.evaluate_after_turn("worked")
            mgr.pause(reason="user-paused")

        rewritten = mgr.set("second objective", replace=True)
        assert rewritten.goal == "second objective"
        assert rewritten.phase == "active"
        assert rewritten.rounds_started == 1          # rounds are preserved
        assert rewritten.subgoals == ["keep the API stable"]
        assert [g.command for g in rewritten.gates] == ["true"]
        assert rewritten.contract.verification == "tests pass"

    def test_rewrite_does_not_change_the_goal_identity(self, hermes_home):
        from hermes_cli import goals

        mgr = goals.GoalManager("rewrite-id")
        original = mgr.set("first objective")
        rewritten = mgr.set("second objective", replace=True)
        assert rewritten.goal_id == original.goal_id

    def test_a_completed_goal_can_be_replaced_without_confirmation(self, hermes_home):
        from hermes_cli import goals

        mgr = goals.GoalManager("done-replace")
        mgr.set("first objective")
        completed_id = mgr.state.goal_id
        mgr.mark_done("finished")
        fresh = mgr.set("next objective")
        assert fresh.goal == "next objective"
        assert fresh.rounds_started == 0
        assert fresh.goal_id != completed_id  # a new identity, the finished goal stays auditable


class TestPhases:
    def test_round_budget_exhaustion_sets_budget_limited(self, hermes_home):
        from hermes_cli import goals

        mgr = goals.GoalManager("budget-sid", default_max_turns=1)
        mgr.set("small goal")
        mgr.reserve_round()
        mgr.admit_round()
        with patch("hermes_cli.goals.judge_goal", return_value=("continue", "more", False, None, False)):
            decision = mgr.evaluate_after_turn("step")
        assert decision["phase"] == "budget_limited"
        assert decision["status"] == "paused"  # legacy view
        assert mgr.state.phase == "budget_limited"
        assert mgr.state.blocked_reason is None

    def test_blocked_verdict_sets_blocked_with_a_reason_code(self, hermes_home):
        from hermes_cli import goals

        mgr = goals.GoalManager("blocked-phase")
        mgr.set("impossible goal")
        with patch("hermes_cli.goals.judge_goal", return_value=("blocked", "no access", False, None, False)):
            decision = mgr.evaluate_after_turn("cannot do it")
        assert decision["phase"] == "blocked"
        assert mgr.state.phase == "blocked"
        assert mgr.state.blocked_reason == {"code": "judge-blocked", "message": "judged unachievable: no access"}

    def test_resume_clears_blocked_and_arms_again(self, hermes_home):
        from hermes_cli import goals

        mgr = goals.GoalManager("blocked-resume")
        mgr.set("goal")
        mgr._pause_state("no access", phase="blocked", code="judge-blocked")
        assert not goals.is_goal_armed("blocked-resume")
        state = mgr.resume()
        assert state.phase == "active"
        assert state.blocked_reason is None
        assert goals.is_goal_armed("blocked-resume")


class TestArmedIsMemoryOnly:
    def test_armed_state_is_never_persisted(self, hermes_home):
        from hermes_cli import goals

        mgr = goals.GoalManager("armed-sid")
        mgr.set("goal")
        assert goals.is_goal_armed("armed-sid")
        assert "armed" not in _raw("armed-sid")

    def test_a_reloaded_session_starts_disarmed(self, hermes_home):
        from hermes_cli import goals

        mgr = goals.GoalManager("restart-sid")
        mgr.set("goal")
        goals.disarm_goal("restart-sid")  # a new process has no armed set
        reloaded = goals.GoalManager("restart-sid")
        assert reloaded.state.phase == "active"
        assert not goals.is_goal_armed("restart-sid")
        reloaded.resume()
        assert goals.is_goal_armed("restart-sid")

    def test_clear_disarms(self, hermes_home):
        from hermes_cli import goals

        mgr = goals.GoalManager("clear-arm")
        mgr.set("goal")
        mgr.clear()
        assert not goals.is_goal_armed("clear-arm")


class TestEventJournal:
    def test_mutations_are_recorded_in_order(self, hermes_home):
        from hermes_cli import goals

        mgr = goals.GoalManager("journal-sid")
        mgr.set("goal")
        mgr.add_subgoal("criterion")
        mgr.add_gate("true")
        mgr.pause(reason="user-paused")
        events = [entry["event"] for entry in goals.load_goal("journal-sid").events]
        assert events[:4] == ["goal_set", "subgoal_added", "gate_added", "paused"]

    def test_journal_is_bounded(self, hermes_home):
        from hermes_cli import goals

        state = goals.GoalState(goal="bounded", goal_id="bounded-id")
        for i in range(goals.MAX_EVENTS + 25):
            state.record("tick", index=i)
        assert len(state.events) == goals.MAX_EVENTS
        assert state.events[-1]["index"] == goals.MAX_EVENTS + 24

    def test_goal_identity_and_timestamps_are_stored(self, hermes_home):
        from hermes_cli import goals

        mgr = goals.GoalManager("identity-sid")
        before = time.time()
        mgr.set("goal")
        stored = _raw("identity-sid")
        assert stored["goal_id"] == mgr.state.goal_id
        assert stored["created_at"] >= before
        assert stored["updated_at"] >= stored["created_at"]
