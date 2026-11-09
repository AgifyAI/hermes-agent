"""Skills dashboard routes.

Two routers because global route order matters: ``hub_router`` (skills-hub
install/search/scan) was registered before the profiles router include in
web_server, the plain skills CRUD ``router`` after it — each is mounted at its
original registration point.  Shared helpers are reached via the late-binding
seam so ``monkeypatch.setattr(<owning module>, ...)`` keeps working.
"""

import asyncio
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException

from hermes_cli.web_deps import late
from hermes_cli.web_server_profiles import _hub_action_name, _installed_hub_identifiers
from hermes_cli.web_models import (
    SkillContentUpdate, SkillCreate, SkillInstallRequest, SkillSourceSync, SkillToggle,
    SkillUninstallRequest, SkillsUpdateRequest)
from hermes_cli.web_routers._common import (
    _profile_scope, config_write_scope, http_failure, log as _log, require, scoped_to_thread,
    spawn_profile_action)

hub_router = APIRouter()
router = APIRouter()

_config_profile_scope = late("_config_profile_scope", "hermes_cli.web_server_profiles")
load_config = late("load_config", "hermes_cli.config")
# Labels per hub source id (matches `hermes skills search` provenance); keep in
# sync with create_source_router()'s source list.
_SKILL_HUB_SOURCE_LABELS = {
    "official": "Official (Nous)",
    "hermes-index": "Hermes Index",
    "skills-sh": "skills.sh",
    "well-known": "Well-Known",
    "url": "Direct URL",
    "github": "GitHub",
    "clawhub": "ClawHub",
    "lobehub": "LobeHub",
    "browse-sh": "browse.sh",
}


def _hub_sources(profile: Optional[str]):
    """Source router built under ``profile``'s config scope."""
    from tools.skills_hub_search import create_source_router

    with _config_profile_scope(profile):
        return create_source_router()


def _resolve_hub_skill(ident: str, profile: Optional[str]):
    """``(meta, bundle)`` for a hub identifier, resolved under ``profile``'s scope."""
    from hermes_cli.skills_hub import _resolve_source_meta_and_bundle
    from tools.skills_hub_search import create_source_router

    with _config_profile_scope(profile):
        sources = create_source_router()
        meta, bundle, _src = _resolve_source_meta_and_bundle(ident, sources)
    return meta, bundle


# Sources subsumed by an available hermes-index (progressive per-source fan-out
# skips them: ~70 GitHub calls per keystroke saved). Keep in sync with
# parallel_search_sources' _api_source_ids.
_API_SOURCE_IDS = frozenset({"github", "skills-sh", "clawhub", "lobehub", "well-known"})


def _flag(obj, attr: str) -> bool:
    """``bool(getattr(obj, attr, False))``; a raising property reads as False."""
    try:
        return bool(getattr(obj, attr, False))
    except Exception:
        return False


def _skill_meta_to_payload(m) -> dict:
    return {
        "name": m.name, "description": m.description, "source": m.source,
        "identifier": m.identifier, "trust_level": m.trust_level, "repo": m.repo,
        "tags": list(m.tags or [])}


def _clear_skills_prompt_cache() -> None:
    """Best-effort: invalidate the skills system-prompt snapshot after a write.

    Mirrors what ``skill_manage`` does so a dashboard-authored skill is picked
    up by the next session without a manual cache reset.
    """
    try:
        from agent.prompt_builder import clear_skills_system_prompt_cache
        clear_skills_system_prompt_cache(clear_snapshot=True)
    except Exception:
        pass


def _skill_location(name: str) -> dict:
    """Return the resolved file's runtime/source contract, or an empty object."""
    from tools.skill_manager_tool import _find_skill
    from hermes_cli.skill_locations import describe_skill_location

    found = _find_skill(name)
    if not found:
        return {}
    return describe_skill_location(name, found["path"] / "SKILL.md")


def _preserve_source_bom(content: str, original: str) -> str:
    """Keep the source file's BOM while accepting editor text without one."""
    clean = content.removeprefix("\ufeff")
    return ("\ufeff" if original.startswith("\ufeff") else "") + clean


def _write_synced_target(
    name: str,
    target_path: Path,
    target_dir: Path,
    original_content: str,
    next_content: str,
    editable: bool,
    not_editable_code: str,
    not_editable_message: str,
) -> Optional[dict]:
    from tools.skill_manager_tool import (
        _background_review_read_before_write_guard,
        _description_budget_error,
        _security_scan_skill,
        _validate_content_size,
        _validate_frontmatter,
    )
    from utils import atomic_write_text

    if not editable:
        return {
            "success": False,
            "error_code": not_editable_code,
            "error": not_editable_message,
        }
    if err := _validate_frontmatter(next_content) or _validate_content_size(next_content):
        return {"success": False, "error_code": "invalid_content", "error": err}
    if err := _description_budget_error(next_content, before=original_content):
        return {"success": False, "error_code": "invalid_content", "error": err}
    if guard := _background_review_read_before_write_guard(name, target_path, "edit", "SKILL.md"):
        return {"success": False, "error_code": "write_failed", "error": guard.get("error", "Write refused.")}
    try:
        atomic_write_text(target_path, next_content, preserve_mode=True, create_mode=0o644)
        try:
            scan_error = _security_scan_skill(target_dir)
        except (OSError, RuntimeError, TypeError, ValueError) as exc:
            scan_error = f"Security scan failed: {exc}"
        if not scan_error:
            return None
        try:
            atomic_write_text(target_path, original_content, preserve_mode=True)
        except OSError as rollback_error:
            return {
                "success": False,
                "error_code": "write_failed",
                "error": f"{scan_error}; rollback failed: {rollback_error}",
            }
        return {"success": False, "error_code": "write_failed", "error": scan_error}
    except OSError as exc:
        return {"success": False, "error_code": "write_failed", "error": str(exc)}


def _sync_skill_source(
    name: str,
    direction: str,
    expected_runtime_version: Optional[str],
    expected_source_version: Optional[str],
    legacy_expected_version: Optional[str] = None,
    content: Optional[str] = None,
) -> dict:
    """Copy one profile skill side only after an explicit version check.

    The source path is reconstructed from the configured repository root and
    the runtime skill's relative directory. No client path is accepted here;
    this keeps an immutable release or another profile outside the write scope.
    """
    from hermes_cli.skill_locations import (
        configured_repository_root,
        configured_source_for_skill,
        content_version,
        describe_skill_location,
        read_skill_text,
        _runtime_is_editable,
        _runtime_path_is_safe,
        _path_is_within_non_symlink_root,
        _source_is_editable,
    )
    from hermes_cli.profiles import current_profile_name
    from tools.skill_manager_tool import _find_skill

    found = _find_skill(name)
    if not found:
        return {"success": False, "error_code": "not_found", "error": f"Skill '{name}' not found."}
    skill_md = found["path"] / "SKILL.md"
    if not _runtime_path_is_safe(skill_md):
        return {
            "success": False,
            "error_code": "runtime_not_editable",
            "error": "The installed skill is not in the active profile; open its repository chat.",
        }

    profile = current_profile_name("default") or "default"
    repository_root = configured_repository_root()
    source_path = configured_source_for_skill(name, skill_md, profile)
    if repository_root is None or source_path is None:
        return {
            "success": False,
            "error_code": "source_unavailable",
            "error": "No writable repository source is configured for this profile.",
        }
    expected_source = repository_root / "profiles" / profile / "skills"
    try:
        source_path.relative_to(expected_source)
    except (OSError, RuntimeError, ValueError):
        return {
            "success": False,
            "error_code": "source_not_allowed",
            "error": "The configured source is outside the active profile repository.",
        }
    if not (
        _path_is_within_non_symlink_root(source_path, expected_source)
        and _path_is_within_non_symlink_root(source_path, expected_source.parent)
    ):
        return {
            "success": False,
            "error_code": "source_not_editable",
            "error": "The repository source follows a profile link and is read-only.",
        }
    if source_path.resolve(strict=False) == skill_md.resolve(strict=False):
        return {
            "success": False,
            "error_code": "source_not_separate",
            "error": "This skill has no separate installed and repository copy to synchronise.",
        }
    if direction == "edit_source":
        expected_source_version = expected_source_version or legacy_expected_version
        if expected_source_version is None:
            return {
                "success": False,
                "error_code": "missing_version",
                "error": "expected_source_version is required when editing the repository skill.",
            }
    elif expected_runtime_version is None or expected_source_version is None:
        return {
            "success": False,
            "error_code": "missing_version",
            "error": "Both expected_runtime_version and expected_source_version are required for a copy.",
        }
    from tools.skill_manager_tool import _skill_lock_path
    from tools.skill_usage import skill_file_lock

    with skill_file_lock(_skill_lock_path(name)):
        try:
            # Re-read after acquiring the lock: the version check and write must
            # observe one coherent pair of runtime/source files.
            runtime_content = read_skill_text(skill_md)
            source_content = read_skill_text(source_path)
            if runtime_content is None or source_content is None:
                return {
                    "success": False,
                    "error_code": "read_failed",
                    "error": "Skill source or installed content is not readable UTF-8.",
                }
        except (OSError, UnicodeDecodeError) as exc:
            return {"success": False, "error_code": "read_failed", "error": str(exc)}

        if direction == "edit_source" and content is None:
            return {
                "success": False,
                "error_code": "missing_content",
                "error": "Source content is required when editing the repository skill.",
            }
        runtime_version = content_version(runtime_content)
        source_version = content_version(source_content)
        versions_match = (
            runtime_version == expected_runtime_version if expected_runtime_version is not None else True
        ) and source_version == expected_source_version
        if not versions_match:
            location = describe_skill_location(name, skill_md)
            return {
                "success": False,
                "error_code": "version_conflict",
                "error": "The skill changed since it was loaded; refresh it before synchronising.",
                "location": location,
            }

        next_content = source_content if direction == "source_to_installed" else (
            runtime_content if direction == "installed_to_source" else content
        )
        if direction == "edit_source":
            next_content = _preserve_source_bom(next_content, source_content)
        target_path = skill_md if direction == "source_to_installed" else source_path
        target_dir = found["path"] if direction == "source_to_installed" else source_path.parent
        original_content = runtime_content if direction == "source_to_installed" else source_content
        write_error = _write_synced_target(
            name,
            target_path,
            target_dir,
            original_content,
            next_content,
            _runtime_is_editable(skill_md) if direction == "source_to_installed" else _source_is_editable(source_path),
            "runtime_not_editable" if direction == "source_to_installed" else "source_not_editable",
            "The installed skill is read-only; edit the repository source instead."
            if direction == "source_to_installed"
            else "The repository source is known but is not writable.",
        )
        if write_error:
            return write_error

    location = describe_skill_location(name, skill_md)
    return {
        "success": True,
        "name": name,
        "direction": direction,
        "version": location.get("installation", {}).get(
            "runtime_version" if direction == "source_to_installed" else "source_version"
        ),
        "location": location,
    }


@hub_router.post("/api/skills/hub/install")
async def install_skill_hub(body: SkillInstallRequest, profile: Optional[str] = None):
    identifier = require(body.identifier, "identifier is required")
    return spawn_profile_action(
        body.profile or profile, ["skills", "install", identifier, "--yes"],
        _hub_action_name("install", identifier), log_msg="Failed to spawn skills install",
        prefix="Failed to install skill")


@hub_router.post("/api/skills/hub/uninstall")
async def uninstall_skill_hub(body: SkillUninstallRequest, profile: Optional[str] = None):
    name = require(body.name, "name is required")
    return spawn_profile_action(
        body.profile or profile, ["skills", "uninstall", name, "--yes"],
        _hub_action_name("uninstall", name), log_msg="Failed to spawn skills uninstall",
        prefix="Failed to uninstall skill")


@hub_router.post("/api/skills/hub/update")
async def update_skills_hub(
    body: Optional[SkillsUpdateRequest] = None, profile: Optional[str] = None):
    return spawn_profile_action(
        (body.profile if body else None) or profile, ["skills", "update"], "skills-update",
        log_msg="Failed to spawn skills update", prefix="Failed to update skills")


@hub_router.get("/api/skills/hub/official")
async def list_official_skills(profile: Optional[str] = None):
    """The ENTIRE optional-skills catalog (local scan), marked installed for ``profile``."""

    def _run():
        from tools.skills_hub_official import OptionalSkillSource

        installed = _installed_hub_identifiers(profile)
        out = []
        for m in OptionalSkillSource().list_local():
            payload = _skill_meta_to_payload(m)
            ident = payload.get("identifier") or ""
            # identifier format: official/<category>/<skill> — surface the
            # category for row subtitles.
            rel = ident.split("/", 1)[-1] if "/" in ident else ident
            payload["category"] = rel.split("/", 1)[0] if "/" in rel else "general"
            payload["installed"] = ident in installed
            out.append(payload)
        return {"skills": out}

    with http_failure("official skills catalog listing failed", 502, "Official catalog failed"):
        return await asyncio.to_thread(_run)


@hub_router.get("/api/skills/hub/sources")
async def list_skills_hub_sources(profile: Optional[str] = None):
    """Configured skill-hub sources + installed-skill provenance (scoped to
    ``profile``), so the Browse-hub tab has something before a search runs."""

    def _run():
        sources = _hub_sources(profile)
        out = []
        index_available = False
        featured = []
        for src in sources:
            sid = src.source_id()
            entry = {"id": sid, "label": _SKILL_HUB_SOURCE_LABELS.get(sid, sid)}
            # GitHub exposes a rate-limit flag; the index an availability flag.
            if sid == "github":
                entry["rate_limited"] = _flag(src, "is_rate_limited")
            if sid == "hermes-index":
                index_available = _flag(src, "is_available")
                entry["available"] = index_available
                # Empty-query search on the index returns featured/popular skills.
                if index_available:
                    try:
                        featured = [
                            _skill_meta_to_payload(m) for m in src.search("", limit=12)]
                    except Exception:
                        featured = []
            out.append(entry)
        # Which sources are worth searching individually (see _API_SOURCE_IDS).
        for entry in out:
            entry["searchable"] = not (index_available and entry["id"] in _API_SOURCE_IDS)
        return {
            "sources": out, "index_available": index_available, "featured": featured,
            "installed": _installed_hub_identifiers(profile)}

    with http_failure("skills hub sources listing failed", 502, "Hub sources failed"):
        return await asyncio.to_thread(_run)


@hub_router.get("/api/skills/hub/search")
async def search_skills_hub(
    q: str = "", source: str = "all", limit: int = 20, profile: Optional[str] = None):
    """Search the skill hub across all configured sources (network-bound)."""
    query = (q or "").strip()
    if not query:
        return {"results": [], "source_counts": {}, "timed_out": [], "installed": {}}

    def _run():
        from tools.skills_hub_search import parallel_search_sources

        sources = _hub_sources(profile)
        capped = min(max(limit, 1), 50)
        all_results, source_counts, timed_out = parallel_search_sources(
            sources, query=query, source_filter=source or "all", overall_timeout=30)

        # Dedupe by identifier, preferring higher trust (mirrors unified_search).
        _rank = {"builtin": 2, "trusted": 1, "community": 0}
        seen = {}
        for r in all_results:
            prev = seen.get(r.identifier)
            if prev is None or _rank.get(r.trust_level, 0) > _rank.get(prev.trust_level, 0):
                seen[r.identifier] = r
        deduped = list(seen.values())[:capped]

        return {
            "results": [_skill_meta_to_payload(m) for m in deduped], "source_counts": source_counts,
            "timed_out": timed_out, "installed": _installed_hub_identifiers(profile)}

    with http_failure("skills hub search failed", 502, "Hub search failed"):
        return await asyncio.to_thread(_run)


async def _hub_lookup(fn, ident: str, log_msg: str, prefix: str):
    """Run ``fn`` off-loop; any failure -> 502 ``"<prefix>: <exc>"``, None -> 404."""
    with http_failure(log_msg, 502, prefix):
        result = await asyncio.to_thread(fn)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Skill not found: {ident}")
    return result


@hub_router.get("/api/skills/hub/preview")
async def preview_skill_hub(identifier: str = "", profile: Optional[str] = None):
    """A hub skill's SKILL.md + file manifest WITHOUT installing it; scoped to
    ``profile`` so different hub taps resolve against THAT source router."""
    ident = require(identifier, "identifier is required")

    def _run():
        meta, bundle = _resolve_hub_skill(ident, profile)
        if not bundle and not meta:
            return None

        files = {}
        skill_md = ""
        if bundle:
            for rel, content in (bundle.files or {}).items():
                if isinstance(content, bytes):
                    # Some sources store every file as bytes; decode text so
                    # SKILL.md renders, placeholder only for genuinely-binary data.
                    try:
                        files[rel] = content.decode("utf-8")
                    except UnicodeDecodeError:
                        files[rel] = "(binary file)"
                else:
                    files[rel] = content
            skill_md = files.get("SKILL.md", "") or ""

        m = meta or bundle
        return {
            "name": getattr(m, "name", ident), "description": getattr(m, "description", "") or "",
            "source": getattr(m, "source", "") or "",
            "identifier": getattr(m, "identifier", ident) or ident,
            "trust_level": getattr(m, "trust_level", "community") or "community",
            "repo": getattr(m, "repo", None), "tags": list(getattr(m, "tags", None) or []),
            "skill_md": skill_md, "files": sorted(files.keys())}

    return await _hub_lookup(_run, ident, "skills hub preview failed", "Hub preview failed")


@hub_router.get("/api/skills/hub/scan")
async def scan_skill_hub(identifier: str = "", profile: Optional[str] = None):
    """Install-time security scan of a hub skill WITHOUT installing it (the CLI's
    ``scan_skill`` / ``should_allow_install`` pipeline on a quarantined bundle);
    scoped to ``profile`` so the bundle resolves where an install would."""
    ident = require(identifier, "identifier is required")

    def _run():
        import shutil as _shutil

        from tools.skills_hub_install import quarantine_bundle
        from tools.skills_guard import scan_skill, should_allow_install

        meta, bundle = _resolve_hub_skill(ident, profile)
        if not bundle:
            return None

        if bundle.source == "official":
            scan_source = "official"
        else:
            scan_source = (
                getattr(bundle, "identifier", "") or getattr(meta, "identifier", "") or ident)

        tier1 = None
        q_path = quarantine_bundle(bundle)
        try:
            result = scan_skill(q_path, source=scan_source)
            # Advisory SkillEvaluator Tier 1 second opinion: optional binary,
            # never blocks, errors degrade to no data (same as the CLI installer).
            try:
                from tools.skillevaluator_scan import run_tier1_scan, tier1_advisory_enabled
                if tier1_advisory_enabled():
                    t1 = run_tier1_scan(q_path)
                    if t1.available:
                        tier1 = {
                            "passed": t1.passed,
                            "incomplete_checks": t1.incomplete_checks,
                            "findings": [
                                {
                                    "check": f.check, "validator": f.validator,
                                    "severity": f.severity, "message": f.message,
                                    "file": f.file, "line": f.line,
                                    "secrets_class": f.is_secrets_class}
                                for f in t1.findings]}
            except Exception:
                _log.debug("Tier 1 advisory scan skipped", exc_info=True)
        finally:
            _shutil.rmtree(q_path, ignore_errors=True)

        # `allowed` may be None ("ask") for agent-created/dangerous gates.
        allowed, reason = should_allow_install(result, force=False)
        findings = [
            {
                "severity": f.severity, "category": f.category, "file": f.file,
                "line": f.line, "description": f.description}
            for f in result.findings]
        counts = {sev: 0 for sev in ("critical", "high", "medium", "low")}
        for f in result.findings:
            if f.severity in counts:
                counts[f.severity] += 1

        return {
            "name": result.skill_name,
            "identifier": ident,
            "source": result.source,
            "trust_level": result.trust_level,
            "verdict": result.verdict,
            "summary": result.summary,
            "policy": "allow" if allowed is True else "ask" if allowed is None else "block",
            "policy_reason": reason,
            "findings": findings,
            "severity_counts": counts,
            "tier1": tier1,  # None when the optional scanner isn't installed/enabled
        }

    return await _hub_lookup(_run, ident, "skills hub scan failed", "Hub scan failed")


@router.get("/api/skills")
async def get_skills(profile: Optional[str] = None):
    from tools.skills_tool import find_all_skills
    from hermes_cli.skills_config import get_disabled_skills
    from tools.skill_usage import (
        _external_skill_names, _read_bundled_names, _read_hub_installed_names, activity_count, load_usage)

    def _run():
        with _profile_scope(profile):
            config = load_config()
            disabled = get_disabled_skills(config)
            skills = find_all_skills(skip_disabled=True)
            usage = load_usage()
            # Set-based provenance (same classification as skill_usage.provenance,
            # without a per-skill manifest read): hub > bundled > external > agent.
            # "external" is mounted from skills.external_dirs and absent locally —
            # externally authored, NOT learned. "agent" covers agent-authored AND
            # local hand-made skills — the ones the user may edit/delete from the
            # UI; external skills keep their in-place foreground edit rights
            # regardless of label (commit 8c8fc6c1ec).
            bundled_names = _read_bundled_names()
            hub_names = _read_hub_installed_names()
            external_names = _external_skill_names() - bundled_names - hub_names
            for s in skills:
                s["enabled"] = s["name"] not in disabled
                s["usage"] = activity_count(usage.get(s["name"], {}))
                s["provenance"] = (
                    "hub" if s["name"] in hub_names
                    else "bundled" if s["name"] in bundled_names
                    else "external" if s["name"] in external_names
                    else "agent")
        return skills

    return await asyncio.to_thread(_run)


@router.put("/api/skills/toggle")
async def toggle_skill(body: SkillToggle, profile: Optional[str] = None):
    from hermes_cli.skills_config import get_disabled_skills, save_disabled_skills

    def _run():
        with config_write_scope(body.profile or profile):
            config = load_config()
            disabled = get_disabled_skills(config)
            if body.enabled:
                disabled.discard(body.name)
            else:
                disabled.add(body.name)
            save_disabled_skills(config, disabled)
        return {"ok": True, "name": body.name, "enabled": body.enabled}

    return await asyncio.to_thread(_run)


@router.get("/api/skills/content")
async def get_skill_content(name: str, profile: Optional[str] = None):
    """Raw SKILL.md text for the dashboard editor."""
    from tools.skill_manager_tool import _find_skill
    from hermes_cli.skill_locations import display_skill_text, read_skill_text

    def _read():
        found = _find_skill(name)
        if not found:
            raise HTTPException(status_code=404, detail=f"Skill '{name}' not found.")
        skill_md = found["path"] / "SKILL.md"
        if not skill_md.exists():
            raise HTTPException(status_code=404, detail=f"Skill '{name}' has no SKILL.md.")
        content = display_skill_text(read_skill_text(skill_md))
        if content is None:
            raise HTTPException(status_code=500, detail=f"Unable to read {skill_md} as UTF-8.")
        location = _skill_location(name)
        payload = {"name": name, "content": content, "path": str(skill_md), "location": location}
        source_path = ((location.get("source") or {}).get("path") if location else None)
        if source_path and Path(source_path) != skill_md:
            payload["source_content"] = display_skill_text(read_skill_text(Path(source_path)))
        return payload

    return await scoped_to_thread(profile, _read)


@router.put("/api/skills/source")
async def sync_skill_source(body: SkillSourceSync, profile: Optional[str] = None):
    """Synchronise a profile's repository source and installed copy explicitly."""
    result = await scoped_to_thread(
        body.profile or profile,
        lambda: _sync_skill_source(
            body.name,
            body.direction,
            body.expected_runtime_version,
            body.expected_source_version,
            body.expected_version,
            body.content,
        ),
    )
    if not result.get("success"):
        status = 409 if result.get("error_code") == "version_conflict" else 404 if result.get("error_code") == "not_found" else 400
        raise HTTPException(status_code=status, detail=result.get("error", "Skill synchronisation failed."))
    _clear_skills_prompt_cache()
    return result


@router.post("/api/skills")
async def create_skill(body: SkillCreate, profile: Optional[str] = None):
    """Create a skill via the agent's ``skill_manage`` write path, minus the
    write-approval gate — an authenticated dashboard write IS the user.
    Profile from the body or ``?profile=``, like the rest of ``/api/skills``."""
    from tools.skill_manager_tool import _create_skill

    result = await scoped_to_thread(
        body.profile or profile,
        lambda: _create_skill(body.name, body.content, body.category or None))
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "Failed to create skill."))
    _clear_skills_prompt_cache()
    return result


@router.put("/api/skills/content")
async def update_skill_content(body: SkillContentUpdate, profile: Optional[str] = None):
    """Replace the SKILL.md of an existing skill (full rewrite) from the editor."""
    from tools.skill_manager_tool import _edit_skill

    result = await scoped_to_thread(
        body.profile or profile,
        lambda: _edit_skill(body.name, body.content))
    if not result.get("success"):
        err = result.get("error", "Failed to update skill.")
        status = 404 if "not found" in str(err).lower() else 400
        raise HTTPException(status_code=status, detail=err)
    _clear_skills_prompt_cache()
    return result
