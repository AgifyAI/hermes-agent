"""Doc/code contract for /goal (GST-199).

Each test locks a statement the user guide and the developer guide make, so the two cannot drift
apart silently: the budget defaults, the phase set, the resume recovery path, the commands named in
pause messages, and the inline contract aliases.
"""

from __future__ import annotations

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


class TestDocumentedDefaults:
    def test_goal_config_defaults_are_the_documented_ones(self):
        from hermes_cli.config_defaults import DEFAULT_CONFIG

        goals = DEFAULT_CONFIG["goals"]
        assert goals["max_tokens"] == 2_000_000
        assert goals["closing_reserve_tokens"] == 0  # 0 = auto (5%, min 20k)
        assert goals["blocked_min_rounds"] == 3
        assert goals["max_wait_seconds"] == 1800
        # max_turns is the deprecated round safety cap, not the budget.
        assert goals["max_turns"] == 20

    def test_the_five_phases_are_the_documented_set(self):
        from hermes_cli.goal_store import GOAL_PHASES

        assert GOAL_PHASES == ("active", "paused", "blocked", "budget_limited", "complete")

    def test_round_cap_is_the_safety_cap_not_the_budget(self):
        from hermes_cli.goals import DEFAULT_MAX_ROUNDS, DEFAULT_MAX_TURNS

        assert DEFAULT_MAX_TURNS == DEFAULT_MAX_ROUNDS == 256


class TestDocumentedRecovery:
    def test_human_resume_resets_rounds_and_gate_retry_budgets(self, hermes_home):
        """The guide says resume gives gates a fresh retry budget after you fixed the failure."""
        from hermes_cli.goals import GoalManager

        mgr = GoalManager("resume-doc")
        mgr.set("finish the migration", replace=True)
        gate = mgr.add_gate("false", max_retries=3)
        mgr.state.gates[0].attempts = 3
        mgr.state.gates[0].last_exit_code = 1
        mgr.pause("gate exhausted")
        assert gate.attempts == 3

        resumed = GoalManager("resume-doc").resume()

        assert resumed is not None and resumed.phase == "active"
        assert resumed.rounds_started == 0
        assert resumed.gates[0].attempts == 0
        assert resumed.gates[0].last_exit_code is None

    def test_gate_exhaustion_pause_names_only_real_commands(self, hermes_home):
        """Pause and recovery messages must never point at a command that does not exist."""
        from hermes_cli.goals import GoalManager

        mgr = GoalManager("pause-doc")
        mgr.set("finish the migration", replace=True)
        mgr.add_gate("false", max_retries=1)
        mgr._check_gates()  # first failure: continuation with the gate output
        decision = mgr._check_gates()  # second failure exhausts the retry budget

        message = decision["message"]
        assert "/goal resume" in message
        assert "/goal gate remove" in message
        assert "/goal set" not in message

    def test_round_cap_pause_names_real_commands(self, hermes_home):
        from hermes_cli.goal_driver import plan_after_turn
        from hermes_cli.goals import GoalManager

        mgr = GoalManager("round-doc", default_max_turns=1)
        mgr.set("finish the migration", replace=True)
        state = mgr.state
        state.rounds_started = 1
        state.max_rounds = 1

        decision = plan_after_turn(mgr, "still working", surface="cli", turn_tokens=0)

        assert "/goal resume" in decision["message"]
        assert "/goal clear" in decision["message"]
        assert "/goal set" not in decision["message"]


class TestDocumentedAgentOwnedEnding:
    def test_the_completion_tool_is_the_only_agent_ending(self):
        from tools.goal_tools import UPDATE_GOAL_SCHEMA

        assert UPDATE_GOAL_SCHEMA["name"] == "update_goal"
        assert UPDATE_GOAL_SCHEMA["parameters"]["properties"]["status"]["enum"] == ["complete", "blocked"]
        assert UPDATE_GOAL_SCHEMA["parameters"]["additionalProperties"] is False

    def test_continuation_prompt_carries_no_judge_verdict_language(self, hermes_home):
        from hermes_cli.goals import GoalManager, build_continuation_prompt

        mgr = GoalManager("prompt-doc")
        mgr.set("finish the migration", replace=True)
        prompt = build_continuation_prompt(mgr.state)

        assert "judge" not in prompt.lower()
        assert "complete" in prompt.lower()  # the completion audit remains
        assert "update_goal" in prompt

    def test_contract_aliases_named_in_the_guide_are_accepted(self):
        from hermes_cli.goal_store import parse_contract

        headline, contract = parse_contract(
            "Migrate auth to JWT\n"
            "files: services/auth and tests/auth\n"
            "scope: only auth\n"
            "goal: users can log in with JWT\n"
            "stop when: a DB schema migration is required\n"
        )

        assert headline == "Migrate auth to JWT"
        assert "only auth" in contract.boundaries
        assert contract.outcome == "users can log in with JWT"
        assert contract.stop_when == "a DB schema migration is required"
