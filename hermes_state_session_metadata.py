"""Lineage-wide session metadata mutations kept separate from session listing."""

import time


class SessionSessionMetadataMixin:
    """Small metadata writers shared by dashboard and gateway session routes."""

    def set_session_read(self, session_id: str, read: bool = True) -> bool:
        """Mark read/unread across the compression lineage using a time watermark."""
        return self._set_lineage_column("last_read_at", session_id, time.time() if read else 0.0)

    def set_session_scratchpad(self, session_id: str, content: str | None) -> bool:
        """Save the private Desktop note across every compression segment."""
        value = None if content is None else str(content)

        return self._set_lineage_column("scratchpad", session_id, value)
