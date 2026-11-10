"""One bounded, visible deferred continuation (GST-204).

Every way a goal round can wait is the same object now: an explicit cause, a target, a reason and a
hard ceiling. These tests prove no deferral can be eternal and that the compression orphan is fixed.
"""

from __future__ import annotations

import json
import time

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


def _mgr(session_id="defer-sid"):
    from hermes_cli.goals import GoalManager

    mgr = GoalManager(session_id, default_max_tokens=0)
    mgr.set("ship the deferral", max_tokens=0)
    return mgr


class TestOneDeferralConcept:
    def test_every_deferral_has_a_cause_target_reason_and_ceiling(self, hermes_home):
        mgr = _mgr()
        mgr.defer_continuation("timer", seconds=600, reason="rate limited")
        cause = mgr.deferral_cause()
        assert cause == "timer"
        state = mgr.state
        assert state.waiting_reason == "rate limited"
        assert state.waiting_max_seconds == mgr.max_wait_seconds()
        assert mgr.deferral_deadline() is not None
        assert 0 < mgr.deferral_remaining() <= 600

    def test_an_unknown_cause_is_refused(self, hermes_home):
        mgr = _mgr()
        with pytest.raises(ValueError):
            mgr.defer_continuation("vibes")

    def test_a_process_deferral_names_its_target(self, hermes_home):
        mgr = _mgr()
        proc = __import__("subprocess").Popen([__import__("sys").executable, "-c", "import time; time.sleep(30)"])
        try:
            mgr.defer_continuation("background-process", pid=proc.pid, reason="CI")
            assert mgr.state.waiting_on_pid == proc.pid
            assert mgr.is_waiting() is True
        finally:
            proc.terminate()
            proc.wait(timeout=10)

    def test_a_timed_wait_is_capped_by_the_configured_ceiling(self, hermes_home):
        mgr = _mgr()
        mgr.defer_continuation("timer", seconds=10 * 24 * 3600, reason="forever?")
        # The stored deadline can never exceed since + ceiling, whatever the caller asked.
        remaining = mgr.deferral_remaining()
        assert remaining <= mgr.max_wait_seconds()
        assert mgr.state.waiting_until <= time.time() + mgr.max_wait_seconds() + 2

    def test_a_stale_deferral_lifts_by_itself(self, hermes_home):
        mgr = _mgr()
        proc = __import__("subprocess").Popen([__import__("sys").executable, "-c", "import time; time.sleep(30)"])
        try:
            mgr.defer_continuation("background-process", pid=proc.pid, reason="poller")
            # Simulate a process that never exits AND a deferral older than the ceiling.
            mgr.state.waiting_since = time.time() - mgr.max_wait_seconds() - 1
            assert mgr.is_waiting() is False
            assert mgr.deferral_cause() is None
        finally:
            proc.terminate()
            proc.wait(timeout=10)

    def test_unwait_resumes_immediately_and_is_idempotent(self, hermes_home):
        mgr = _mgr()
        mgr.defer_continuation("timer", seconds=600)
        assert mgr.stop_waiting() is True
        assert mgr.deferral_cause() is None
        assert mgr.stop_waiting() is False

    @pytest.mark.parametrize("verb", ["pause", "clear", "resume"])
    def test_control_actions_reset_the_deferral(self, hermes_home, verb):
        from hermes_cli.goals import GoalManager

        mgr = _mgr()
        mgr.defer_continuation("timer", seconds=600, reason="waiting")
        getattr(mgr, verb)()
        reloaded = GoalManager("defer-sid").state
        assert (reloaded.waiting_cause, reloaded.waiting_until) == (None, 0.0)

    def test_the_waiting_decision_is_visible_and_actionable(self, hermes_home, monkeypatch):
        from hermes_cli import goals

        monkeypatch.setattr(goals, "count_active_delegations", lambda _sid: 2)
        mgr = _mgr()
        mgr.defer_continuation("subagents", on_delegations=2, seconds=600, reason="two batches running")
        decision = mgr.evaluate_after_turn("waiting")
        assert decision["verdict"] == "waiting"
        assert decision["should_continue"] is False
        assert "subagents" in decision["message"]
        assert "two batches running" in decision["message"]
        assert "/goal unwait" in decision["message"]

    def test_the_status_line_shows_cause_and_remaining(self, hermes_home):
        mgr = _mgr()
        mgr.defer_continuation("timer", seconds=600, reason="rate limited")
        line = mgr.status_line()
        assert "deferred: timer" in line
        assert "rate limited" in line
        assert "left of" in line

    def test_the_snapshot_exposes_the_deferral_to_the_panel(self, hermes_home):
        from tui_gateway.methods_session_control import _safe_goal_snapshot

        mgr = _mgr()
        mgr.defer_continuation("subagents", seconds=600, reason="delegations running")
        snapshot = _safe_goal_snapshot(mgr.state)
        barrier = snapshot["wait_barrier"]
        assert barrier["cause"] == "subagents"
        assert barrier["reason"] == "delegations running"
        assert "remaining_seconds" in barrier and "deadline_at" in barrier
        assert barrier["max_seconds"] == mgr.max_wait_seconds()


class TestCompressionOrphan:
    def test_an_exhausted_compression_pauses_the_goal_instead_of_orphaning_it(self, hermes_home):
        from hermes_cli import goal_driver
        from hermes_cli.goals import GoalManager

        mgr = _mgr()
        decision = goal_driver.plan_after_turn(
            mgr, "context length exceeded", surface="gateway", compression_exhausted=True)
        assert decision["stop"] == goal_driver.STOP_COMPRESSION
        assert decision["continuation"] is None
        assert "paused" in decision["message"].lower()
        assert "/goal resume" in decision["message"]
        state = GoalManager("defer-sid").state
        assert state.phase == "paused"
        assert "compression" in (state.paused_reason or "")

    def test_a_compressed_goal_still_resumes_cleanly(self, hermes_home):
        from hermes_cli import goal_driver
        from hermes_cli.goals import GoalManager

        mgr = _mgr()
        goal_driver.plan_after_turn(mgr, "boom", surface="gateway", compression_exhausted=True)
        reloaded = GoalManager("defer-sid")
        reloaded.resume()
        decision = goal_driver.plan_after_turn(reloaded, "worked", surface="gateway")
        assert decision["stop"] == goal_driver.STOP_CONTINUED
        assert decision["continuation"] is not None
        assert decision["continuation"].closing is False
