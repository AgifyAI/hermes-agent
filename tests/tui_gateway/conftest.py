"""tui_gateway test fixtures.

Several files here import ``tui_gateway.server`` inside a ``patch.dict("sys.modules", {"hermes_constants":
MagicMock(...)})`` window so the module binds a fixed home. The server's import graph reaches
``agent.process_bootstrap`` → ``hermes_bootstrap``, which is process boot: PM dependency activation reads
the real install root through ``hermes_constants`` and exits the process when that is a MagicMock.
Importing it once here, before any window opens, keeps boot out of the mocked import.
"""

import hermes_bootstrap
import pytest


@pytest.fixture
def deferred_turn():
    """Pick the deferred prompt thread out of the threads a test captured.

    Opening a fresh SessionDB while ``threading.Thread`` is stubbed also captures the short-lived
    deleted-WAL sidecar scan; that is bookkeeping, not the turn, so the assertion stays about turn
    scheduling instead of thread creation order.
    """
    def pick(threads):
        turn = [t for t in threads if getattr(t.target, "__name__", "") != "_scan"]
        assert turn, "no deferred turn thread was created"
        return turn[0]

    return pick
