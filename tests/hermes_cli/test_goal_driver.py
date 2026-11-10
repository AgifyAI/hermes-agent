"""The round driver (GST-195): reservation → admission, disarm on restart, clean stops.

Every contract here is behavioural: what is counted, what is dispatched, and what a second process
or a human message can do to a continuation that is still being decided.
"""

from __future__ import annotations

import queue
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


def _mgr(session_id: str = "driver-sid", *, max_rounds: int = 5):
    from hermes_cli.goals import GoalManager

    mgr = GoalManager(session_id, default_max_turns=max_rounds)
    mgr.set("ship the driver")
    return mgr



class TestReservationAndAdmission:
    def test_a_round_is_not_counted_when_the_turn_is_only_judged(self, hermes_home):
        from hermes_cli import goal_driver

        mgr = _mgr()
        decision = goal_driver.plan_after_turn(mgr, "worked", surface="test")
        assert decision["stop"] == goal_driver.STOP_CONTINUED
        assert decision["continuation"].round_no == 1
        assert mgr.state.rounds_started == 0  # reserved, not consumed
        assert mgr.state.reserved_round == 1

    def test_admission_on_a_real_dispatch_consumes_exactly_one_round(self, hermes_home):
        from hermes_cli import goal_driver

        mgr = _mgr()
        decision = goal_driver.plan_after_turn(mgr, "worked", surface="test")
        sent = []
        assert goal_driver.admit(mgr, decision["continuation"], lambda p: sent.append(p) or True)
        assert sent == [decision["continuation"].prompt]
        state = mgr.state
        assert state.rounds_started == 1
        assert state.reserved_round is None

    def test_a_human_message_wins_and_releases_the_round(self, hermes_home):
        from hermes_cli import goal_driver

        mgr = _mgr()
        decision = goal_driver.plan_after_turn(mgr, "worked", surface="test")
        sent = []
        admitted = goal_driver.admit(mgr, decision["continuation"], lambda p: sent.append(p) or True,
                                     human_pending=True)
        assert admitted is False
        assert sent == []
        assert mgr.state.rounds_started == 0
        assert mgr.state.reserved_round is None

    def test_a_refused_dispatch_releases_the_round(self, hermes_home):
        from hermes_cli import goal_driver

        mgr = _mgr()
        decision = goal_driver.plan_after_turn(mgr, "worked", surface="test")
        assert goal_driver.admit(mgr, decision["continuation"], lambda _p: False) is False
        assert mgr.state.rounds_started == 0
        assert mgr.state.reserved_round is None

    def test_a_turn_cannot_reserve_twice(self, hermes_home):
        from hermes_cli import goal_driver

        mgr = _mgr()
        first = goal_driver.plan_after_turn(mgr, "worked", surface="test")
        second = goal_driver.plan_after_turn(mgr, "worked again", surface="test")
        assert first["stop"] == goal_driver.STOP_CONTINUED
        assert second["stop"] == goal_driver.STOP_ROUND_IN_FLIGHT
        assert second["continuation"] is None

    def test_round_cap_blocks_with_the_round_limit_code(self, hermes_home):
        from hermes_cli import goal_driver

        mgr = _mgr(max_rounds=1)
        mgr.reserve_round()
        mgr.admit_round()
        decision = goal_driver.plan_after_turn(mgr, "worked", surface="test")
        assert decision["stop"] == goal_driver.STOP_BUDGET
        assert decision["continuation"] is None
        assert mgr.state.phase == "budget_limited"
        assert mgr.state.blocked_reason is None
        assert "round budget exhausted" in (mgr.state.paused_reason or "")


class TestCleanStops:
    def test_a_failed_turn_never_continues(self, hermes_home):
        from hermes_cli import goal_driver

        mgr = _mgr()
        decision = goal_driver.plan_after_turn(mgr, "boom", surface="test", failed=True)
        assert decision["stop"] == goal_driver.STOP_FAILED_TURN
        assert mgr.state.phase == "active"

    def test_an_interrupted_turn_pauses_instead_of_continuing(self, hermes_home):
        from hermes_cli import goal_driver

        mgr = _mgr()
        decision = goal_driver.plan_after_turn(mgr, "partial", surface="test", interrupted=True)
        assert decision["stop"] == goal_driver.STOP_INTERRUPTED
        assert mgr.state.phase == "paused"
        assert "Ctrl+C" in (mgr.state.paused_reason or "")

    def test_compression_exhaustion_never_continues(self, hermes_home):
        from hermes_cli import goal_driver

        mgr = _mgr()
        decision = goal_driver.plan_after_turn(
            mgr, "context length exceeded", surface="test", compression_exhausted=True)
        # There is no judge to run: the driver simply refuses to continue on a compression failure.
        assert decision["stop"] == goal_driver.STOP_COMPRESSION
        assert decision["continuation"] is None

    def test_a_ghost_continuation_is_dropped_after_the_goal_was_cleared(self, hermes_home):
        from hermes_cli import goal_driver

        mgr = _mgr()
        decision = goal_driver.plan_after_turn(mgr, "worked", surface="test")
        continuation = decision["continuation"]
        from hermes_cli.goals import GoalManager

        GoalManager("driver-sid").clear()
        sent = []
        assert goal_driver.admit(mgr, continuation, lambda p: sent.append(p) or True) is False
        assert sent == []

    def test_a_ghost_continuation_is_dropped_after_the_goal_was_replaced(self, hermes_home):
        from hermes_cli import goal_driver
        from hermes_cli.goals import GoalManager

        mgr = _mgr()
        decision = goal_driver.plan_after_turn(mgr, "worked", surface="test")
        GoalManager("driver-sid").set("a different objective", replace=True)
        sent = []
        assert goal_driver.admit(mgr, decision["continuation"], lambda p: sent.append(p) or True) is False
        assert sent == []


class TestArmedLifecycle:
    def test_a_reloaded_process_does_not_continue_by_itself(self, hermes_home):
        from hermes_cli import goal_driver
        from hermes_cli.goals import GoalManager, disarm_goal

        _mgr()
        disarm_goal("driver-sid")  # what a new process starts with
        mgr = GoalManager("driver-sid")
        decision = goal_driver.plan_after_turn(mgr, "worked", surface="test")
        assert decision["stop"] == goal_driver.STOP_DISARMED
        assert decision["continuation"] is None

    def test_a_human_resume_arms_again(self, hermes_home):
        from hermes_cli import goal_driver
        from hermes_cli.goals import GoalManager

        mgr = _mgr()
        mgr.resume()  # the human resume action
        decision = goal_driver.plan_after_turn(mgr, "worked", surface="test")
        assert decision["stop"] == goal_driver.STOP_CONTINUED

    def test_unloading_a_session_disarms_and_releases(self, hermes_home):
        from hermes_cli import goal_driver
        from hermes_cli.goals import GoalManager, is_goal_armed

        mgr = _mgr()
        goal_driver.plan_after_turn(mgr, "worked", surface="test")
        assert mgr.state.reserved_round == 1
        reloaded = GoalManager("driver-sid")
        goal_driver.disarm_on_session_unload("driver-sid", mgr=reloaded)
        assert not is_goal_armed("driver-sid")
        assert GoalManager("driver-sid").state.reserved_round is None

    def test_opening_a_session_disarms(self, hermes_home):
        from hermes_cli import goal_driver
        from hermes_cli.goals import is_goal_armed

        _mgr()
        assert is_goal_armed("driver-sid")
        goal_driver.disarm_on_session_open("driver-sid")
        assert not is_goal_armed("driver-sid")


class TestRecoveryContinuation:
    def test_recovery_reserves_a_round_and_respects_the_cap(self, hermes_home):
        from hermes_cli import goal_driver

        mgr = _mgr(max_rounds=1)
        continuation = goal_driver.plan_recovery(mgr, "retry after compression", surface="test")
        assert continuation is not None and continuation.round_no == 1
        assert goal_driver.admit(mgr, continuation, lambda _p: True) is True
        assert goal_driver.plan_recovery(mgr, "retry again", surface="test") is None
        assert mgr.state.rounds_started == 1

    def test_recovery_is_not_offered_when_the_goal_is_disarmed(self, hermes_home):
        from hermes_cli import goal_driver
        from hermes_cli.goals import disarm_goal

        mgr = _mgr()
        disarm_goal("driver-sid")
        assert goal_driver.plan_recovery(mgr, "retry", surface="test") is None


class TestCliSurface:
    """The CLI hook is a thin adapter: plan, then queue exactly one admitted continuation."""

    def _cli(self, mgr, *, queued=None):
        from hermes_cli.cli_loops_mixin import CLILoopsMixin

        cli = CLILoopsMixin.__new__(CLILoopsMixin)
        cli._get_goal_manager = lambda: mgr
        cli._pending_input = queue.Queue()
        for item in queued or []:
            cli._pending_input.put(item)
        cli._last_turn_failed = False
        cli._last_turn_interrupted = False
        cli._last_assistant_response_text = lambda: "worked on it"
        cli.session_id = mgr.session_id
        cli.agent = None
        return cli

    def _run(self, cli):
        from hermes_cli.cli_loops_mixin import CLILoopsMixin

        CLILoopsMixin._maybe_continue_goal_after_turn(cli)

    def test_the_cli_hook_queues_and_admits_one_continuation(self, hermes_home):
        mgr = _mgr()
        cli = self._cli(mgr)
        self._run(cli)
        assert cli._pending_input.qsize() == 1
        assert mgr.state.rounds_started == 1

    def test_a_queued_user_message_preempts_the_continuation(self, hermes_home):
        mgr = _mgr()
        cli = self._cli(mgr, queued=["a real user message"])
        self._run(cli)
        assert cli._pending_input.qsize() == 1  # still just the user's message
        assert mgr.state.rounds_started == 0
        assert mgr.state.reserved_round is None

    def test_an_interrupted_turn_pauses_and_queues_nothing(self, hermes_home):
        mgr = _mgr()
        cli = self._cli(mgr)
        cli._last_turn_interrupted = True
        self._run(cli)
        assert cli._pending_input.empty()
        assert mgr.state.phase == "paused"
