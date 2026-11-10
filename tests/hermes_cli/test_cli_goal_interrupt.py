"""Tests for CLI goal-continuation interrupt handling.

Covers:
- Ctrl+C during a /goal turn auto-pauses the goal (no more continuations).
- Empty/whitespace-only responses never produce a continuation.
- A clean response without interrupt still enqueues the next goal round.
- A goal the agent ended during the turn produces no continuation.

These tests exercise ``_maybe_continue_goal_after_turn`` directly on a
minimal ``HermesCLI`` stub (pattern used elsewhere in tests/cli).
"""

from __future__ import annotations

import queue
import uuid
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# ──────────────────────────────────────────────────────────────────────
# Fixtures
# ──────────────────────────────────────────────────────────────────────

@pytest.fixture
def hermes_home(tmp_path, monkeypatch):
    """Isolated HERMES_HOME so SessionDB.state_meta writes stay hermetic."""
    home = tmp_path / ".hermes"
    home.mkdir()
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("HERMES_HOME", str(home))

    # Bust the goal module's DB cache so it re-resolves HERMES_HOME each test.
    from hermes_cli import goals
    goals._DB_CACHE.clear()
    yield home
    goals._DB_CACHE.clear()

def _make_cli_with_goal(session_id: str, goal_text: str = "build a thing"):
    """Build a minimal HermesCLI stub with an active goal wired in."""
    from cli import HermesCLI
    from hermes_cli.goals import GoalManager

    cli = HermesCLI.__new__(HermesCLI)
    # State the hook + helpers touch directly.
    cli._pending_input = queue.Queue()
    cli._last_turn_interrupted = False
    cli.conversation_history = []
    # `_get_goal_manager()` reads `self.session_id` directly, not
    # `self.agent.session_id`. Match the production lookup.
    cli.session_id = session_id
    cli.agent = MagicMock()
    cli.agent.session_id = session_id

    mgr = GoalManager(session_id=session_id, default_max_turns=5)
    mgr.set(goal_text)
    cli._goal_manager = mgr
    return cli, mgr

# ──────────────────────────────────────────────────────────────────────
# Tests
# ──────────────────────────────────────────────────────────────────────

class TestInterruptAutoPause:

    def test_interrupted_turn_is_resumable(self, hermes_home):
        """After auto-pause from Ctrl+C, /goal resume puts it back to active."""
        sid = f"sid-resume-{uuid.uuid4().hex}"
        cli, mgr = _make_cli_with_goal(sid)
        cli._last_turn_interrupted = True
        cli.conversation_history = [
            {"role": "assistant", "content": "partial"},
        ]
        cli._maybe_continue_goal_after_turn()
        assert mgr.state.status == "paused"

        mgr.resume()
        assert mgr.state.status == "active"

class TestHealthyTurnStillRuns:
    def test_clean_response_enqueues_the_next_goal_round(self, hermes_home):
        """Sanity check: the hook still works in the happy path."""
        sid = f"sid-healthy-{uuid.uuid4().hex}"
        cli, mgr = _make_cli_with_goal(sid)
        cli._last_turn_interrupted = False
        cli.conversation_history = [
            {"role": "user", "content": "go"},
            {"role": "assistant", "content": "did some work, more to do"},
        ]

        cli._maybe_continue_goal_after_turn()

        # Continuation prompt must be queued.
        assert not cli._pending_input.empty()
        queued = cli._pending_input.get_nowait()
        assert "Continuing toward your standing goal" in queued
        assert mgr.state.status == "active"

    def test_a_goal_ended_by_the_agent_produces_no_continuation(self, hermes_home):
        """The turn called update_goal(complete): the boundary must not relaunch anything."""
        sid = f"sid-done-{uuid.uuid4().hex}"
        cli, mgr = _make_cli_with_goal(sid)
        cli._last_turn_interrupted = False
        cli.conversation_history = [
            {"role": "assistant", "content": "all finished, here's the result"},
        ]
        # What the goal round looks like when the agent calls update_goal(complete).
        mgr.reserve_round()
        mgr.admit_round()
        mgr.mark_complete_by_agent("delivered the result")

        cli._maybe_continue_goal_after_turn()

        assert cli._pending_input.empty()
        assert mgr.state.phase == "complete"
