"""Session metadata mutation handlers for the API-server adapter.

The adapter keeps the route and authentication seam; this module owns the
session-field validation and persistence so the large route facade stays below
its ratcheted size cap.
"""

import asyncio


async def handle_patch_session(adapter, request):
    """Update client-safe session metadata through the adapter's existing DB seam."""
    from gateway.platforms.api_server import _error_response, web

    session_id = request.match_info["session_id"]
    session, err = await adapter._get_existing_session_or_404(session_id)
    if err:
        return err
    body, err = await adapter._read_json_body(request)
    if err:
        return err
    unknown = sorted(set(body) - {"title", "end_reason", "pinned", "archived", "hidden", "unread", "scratchpad"})
    if unknown:
        return _error_response(
            f"Unsupported session fields: {', '.join(unknown)}", 400, code="unsupported_session_field")
    for flag in ("pinned", "archived", "hidden", "unread"):
        if flag in body and not isinstance(body[flag], bool):
            return _error_response(f"'{flag}' must be a boolean", 400, code="invalid_session_field")
    if "scratchpad" in body and body["scratchpad"] is not None:
        if not isinstance(body["scratchpad"], str):
            return _error_response("'scratchpad' must be a string or null", 400, code="invalid_session_field")
        if len(body["scratchpad"]) > 100_000:
            return _error_response("'scratchpad' is too long", 400, code="invalid_session_field")
    db = await adapter._ensure_session_db_async()
    if db is None:
        return adapter._session_db_unavailable()
    if "title" in body:
        try:
            await asyncio.to_thread(
                db.set_session_title, session_id, "" if body["title"] is None else str(body["title"]))
        except ValueError as exc:
            return _error_response(str(exc), 400, code="invalid_title")
    # Pinned last: set_session_pinned clears hidden, so a pin in the same request
    # wins over an explicit hidden (same order as the dashboard's flag setters).
    for flag, setter in (("archived", db.set_session_archived), ("hidden", db.set_session_hidden),
                         ("pinned", db.set_session_pinned)):
        if flag in body:
            await asyncio.to_thread(setter, session_id, body[flag])
    if "scratchpad" in body:
        await asyncio.to_thread(db.set_session_scratchpad, session_id, body["scratchpad"])
    if "unread" in body:
        await asyncio.to_thread(db.set_session_read, session_id, read=not body["unread"])
    if body.get("end_reason"):
        await asyncio.to_thread(db.end_session, session_id, str(body["end_reason"]))
    session = await asyncio.to_thread(db.get_session, session_id) or session
    return web.json_response({"object": "hermes.session", "session": adapter._session_response(session)})
