"""Token budget and the closing reserve (GST-200).

The /goal budget is measured in real provider tokens. Normal work stops while the closing reserve
is still unspent, exactly one closing turn is offered, and a human resume grants a new allowance
computed from what was actually spent.
"""

from __future__ import annotations

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


CONTINUE_JUDGE = ("continue", "more work", False, None, False)


def _mgr(session_id="tokens-sid", *, budget=100_000, reserve=20_000):
    from hermes_cli.goals import GoalManager

    mgr = GoalManager(session_id, default_max_tokens=budget)
    mgr.closing_reserve_configured = reserve
    mgr.set("ship the token budget", max_tokens=budget)
    return mgr


class TestTokenAccounting:
    def test_real_usage_accumulates_and_is_cumulative(self, hermes_home):
        from hermes_cli.goals import GoalManager

        mgr = _mgr()
        mgr.add_tokens(1_200, seconds=2.5)
        mgr.add_tokens(800, seconds=1.5)
        state = GoalManager("tokens-sid").state
        assert state.tokens_used == 2_000
        assert state.time_used_seconds == pytest.approx(4.0)
        assert state.token_budget == 100_000

    def test_the_driver_accounts_the_finished_turn_once(self, hermes_home):
        from hermes_cli import goal_driver

        mgr = _mgr()
        with patch("hermes_cli.goals.judge_goal", return_value=CONTINUE_JUDGE):
            decision = goal_driver.plan_after_turn(
                mgr, "worked", surface="test", turn_tokens=5_000, turn_seconds=1.0)
        assert decision["stop"] == goal_driver.STOP_CONTINUED
        assert mgr.state.tokens_used == 5_000
        assert mgr.state.rounds_started == 0  # reservation only, not admitted

    def test_tokens_are_counted_even_when_the_turn_failed(self, hermes_home):
        from hermes_cli import goal_driver

        mgr = _mgr()
        goal_driver.plan_after_turn(mgr, "boom", surface="test", failed=True, turn_tokens=3_000)
        assert mgr.state.tokens_used == 3_000
        assert mgr.state.phase == "active"

    def test_token_accounting_is_never_negative(self, hermes_home):
        from hermes_cli.goals import GoalManager

        mgr = _mgr()
        mgr.add_tokens(-40)
        assert GoalManager("tokens-sid").state.tokens_used == 0

    def test_agent_delta_from_cumulative_counters_never_goes_negative(self, hermes_home):
        from hermes_cli import goal_driver

        class _Agent:
            session_total_tokens = 900

        marks: dict[str, int] = {}
        assert goal_driver.agent_tokens_delta(_Agent(), marks) == 900
        assert goal_driver.agent_tokens_delta(_Agent(), marks) == 0
        _Agent.session_total_tokens = 1_500
        assert goal_driver.agent_tokens_delta(_Agent(), marks) == 600
        _Agent.session_total_tokens = 10  # a fresh/restored agent
        assert goal_driver.agent_tokens_delta(_Agent(), marks) == 10


class TestClosingReserve:
    def test_work_continues_while_above_the_reserve(self, hermes_home):
        from hermes_cli import goal_driver

        mgr = _mgr()  # budget 100k, reserve 20k
        with patch("hermes_cli.goals.judge_goal", return_value=CONTINUE_JUDGE):
            decision = goal_driver.plan_after_turn(mgr, "worked", surface="test", turn_tokens=50_000)
        assert decision["stop"] == goal_driver.STOP_CONTINUED
        assert decision["continuation"].closing is False

    def test_reaching_the_reserve_offers_exactly_one_closing_turn(self, hermes_home):
        from hermes_cli import goal_driver

        mgr = _mgr()
        with patch("hermes_cli.goals.judge_goal", return_value=CONTINUE_JUDGE):
            decision = goal_driver.plan_after_turn(mgr, "worked", surface="test", turn_tokens=85_000)
        assert decision["stop"] == goal_driver.STOP_CONTINUED
        assert decision["continuation"].closing is True
        assert decision["phase"] == "budget_limited"
        state = mgr.state
        assert state.phase == "budget_limited"
        assert state.closing_issued is True
        assert state.tokens_used == 85_000
        prompt = decision["continuation"].prompt
        assert "Closing this goal" in prompt
        assert "What is done" in prompt and "What remains" in prompt and "next step" in prompt
        assert "85,000" in prompt and "100,000" in prompt

    def test_only_one_closing_turn_is_ever_offered(self, hermes_home):
        from hermes_cli import goal_driver

        mgr = _mgr()
        with patch("hermes_cli.goals.judge_goal", return_value=CONTINUE_JUDGE):
            first = goal_driver.plan_after_turn(mgr, "worked", surface="test", turn_tokens=85_000)
            assert first["continuation"].closing is True
            second = goal_driver.plan_after_turn(mgr, "closing summary", surface="test", turn_tokens=1_000)
        assert second["stop"] == goal_driver.STOP_BUDGET
        assert second["continuation"] is None
        assert mgr.state.phase == "budget_limited"

    def test_the_closing_turn_is_admissible_and_counts_its_round(self, hermes_home):
        from hermes_cli import goal_driver
        from hermes_cli.goals import GoalManager

        mgr = _mgr()
        with patch("hermes_cli.goals.judge_goal", return_value=CONTINUE_JUDGE):
            decision = goal_driver.plan_after_turn(mgr, "worked", surface="test", turn_tokens=85_000)
        sent = []
        assert goal_driver.admit(mgr, decision["continuation"], lambda p: sent.append(p) or True) is True
        assert len(sent) == 1
        state = GoalManager("tokens-sid").state
        assert state.rounds_started == 1
        assert state.reserved_round is None

    def test_a_resume_after_the_budget_grants_a_new_allowance(self, hermes_home):
        from hermes_cli import goal_driver
        from hermes_cli.goals import GoalManager

        mgr = _mgr()
        with patch("hermes_cli.goals.judge_goal", return_value=CONTINUE_JUDGE):
            goal_driver.plan_after_turn(mgr, "worked", surface="test", turn_tokens=85_000)
        assert mgr.state.phase == "budget_limited"
        before = mgr.state.token_budget
        mgr.resume()
        state = GoalManager("tokens-sid").state
        assert state.phase == "active"
        assert state.closing_issued is False
        assert state.token_budget > before
        assert state.token_budget >= state.tokens_used + 2 * mgr.closing_reserve()
        with patch("hermes_cli.goals.judge_goal", return_value=CONTINUE_JUDGE):
            decision = goal_driver.plan_after_turn(mgr, "worked again", surface="test", turn_tokens=1_000)
        assert decision["stop"] == goal_driver.STOP_CONTINUED
        assert decision["continuation"].closing is False

    def test_recovery_work_is_refused_when_only_the_reserve_is_left(self, hermes_home):
        from hermes_cli import goal_driver

        mgr = _mgr()
        mgr.add_tokens(85_000)
        assert goal_driver.plan_recovery(mgr, "retry compression", surface="test") is None
        # The closing turn itself is still offered by the normal path.
        with patch("hermes_cli.goals.judge_goal", return_value=CONTINUE_JUDGE):
            decision = goal_driver.plan_after_turn(mgr, "worked", surface="test")
        assert decision["continuation"].closing is True

    def test_an_unset_token_budget_leaves_the_round_safety_path(self, hermes_home):
        from hermes_cli import goal_driver
        from hermes_cli.goals import GoalManager

        mgr = GoalManager("no-token-budget", default_max_tokens=0)
        mgr.set("no token budget", max_tokens=0)
        assert mgr.state.token_budget == 0
        with patch("hermes_cli.goals.judge_goal", return_value=CONTINUE_JUDGE):
            decision = goal_driver.plan_after_turn(mgr, "worked", surface="test", turn_tokens=10_000)
        assert decision["stop"] == goal_driver.STOP_CONTINUED
        assert decision["continuation"].closing is False
        assert mgr.state.tokens_used == 10_000


class TestDisplay:
    def test_status_line_shows_tokens_and_time(self, hermes_home):
        mgr = _mgr()
        mgr.add_tokens(12_345, seconds=30)
        line = mgr.status_line()
        assert "12,345/100,000 tokens" in line
        assert "rounds" in line

    def test_the_continue_message_reports_tokens(self, hermes_home):
        from hermes_cli import goal_driver

        mgr = _mgr()
        with patch("hermes_cli.goals.judge_goal", return_value=CONTINUE_JUDGE):
            decision = goal_driver.plan_after_turn(mgr, "worked", surface="test", turn_tokens=4_000)
        assert "4,000/100,000 tokens" in decision["message"]
