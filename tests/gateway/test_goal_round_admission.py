"""Gateway round accounting (GST-195): a queued continuation consumes its round when it RUNS.

The gateway enqueues the continuation into the adapter FIFO (or an authority admission), so the
reservation is claimed at execution time and released when the queued message is dropped — a
continuation that never starts must not spend the round budget.
"""

from __future__ import annotations

from types import SimpleNamespace

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


def _runner():
    from gateway.run_busy import GatewayBusySessionMixin
    from gateway.run_goals import GatewayGoalsMixin

    class Runner(GatewayGoalsMixin, GatewayBusySessionMixin):
        pass

    runner = Runner()
    runner.session_store = SimpleNamespace(peek_session_id=lambda key: {"route-a": "sid-a"}.get(key))
    return runner


def _goal_with_reservation(session_id: str = "sid-a"):
    from hermes_cli.goals import GoalManager

    mgr = GoalManager(session_id)
    mgr.set("ship the round accounting")
    assert mgr.reserve_round() == 1
    return mgr


def test_a_queued_continuation_consumes_its_round_when_it_runs(hermes_home):
    from hermes_cli.goals import GoalManager

    _goal_with_reservation()
    runner = _runner()
    runner._admit_goal_round_for_session("sid-a")
    state = GoalManager("sid-a").state
    assert state.rounds_started == 1
    assert state.reserved_round is None


def test_a_dropped_continuation_releases_its_round(hermes_home):
    from hermes_cli.goals import GoalManager

    _goal_with_reservation()
    runner = _runner()
    runner._release_goal_round_for_key("route-a", "dropped by /goal pause")
    state = GoalManager("sid-a").state
    assert state.rounds_started == 0
    assert state.reserved_round is None


def test_a_goal_command_purge_releases_the_pending_round(hermes_home):
    """``/goal pause`` removes queued continuations from the adapter FIFO: their round goes back."""
    from hermes_cli.goals import GoalManager

    _goal_with_reservation()
    runner = _runner()
    continuation = SimpleNamespace(text="[Continuing toward your standing goal]\nGoal: ship it\n\nContinue.")
    adapter = SimpleNamespace(_pending_messages={"route-a": continuation})
    runner._overflow_queue = lambda _key: []  # no overflow queue in this minimal runner
    assert runner._clear_goal_pending_continuations("route-a", adapter) == 1
    state = GoalManager("sid-a").state
    assert state.reserved_round is None
