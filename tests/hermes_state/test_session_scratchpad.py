"""Private scratchpads stay attached to a conversation's durable session."""

from __future__ import annotations

import json

from hermes_state import SessionDB


def test_scratchpad_is_copied_to_children_and_survives_export_import(tmp_path):
    source = SessionDB(tmp_path / "source.db")
    target = SessionDB(tmp_path / "target.db")
    try:
        source.create_session("parent", source="desktop")
        source.set_session_scratchpad("parent", "private plan")
        source.create_session("child", source="desktop", parent_session_id="parent")

        assert source.get_session("child")["scratchpad"] == "private plan"

        payload = json.loads(json.dumps(source.export_session("parent")))
        payload["id"] = "restored"
        assert target.import_sessions([payload])["ok"]
        assert target.get_session("restored")["scratchpad"] == "private plan"
    finally:
        source.close()
        target.close()

