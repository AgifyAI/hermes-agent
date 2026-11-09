"""Resolve the runtime and source locations of a skill for the Desktop editor.

The Desktop can be running on a different machine from the gateway. A skill's
``SKILL.md`` path is therefore meaningful only together with the backend host,
profile and workspace that resolved it. This module keeps that provenance
lookup read-only: it never guesses a source outside a known checkout, the
configured skill roots, or the bundled package tree.
"""

from __future__ import annotations

import hashlib
import logging
import os
import platform
from pathlib import Path
from typing import Any, Iterable, Optional


logger = logging.getLogger(__name__)


def read_skill_text(path: Path) -> Optional[str]:
    """Read UTF-8 without changing BOMs or CRLF line endings."""
    try:
        return path.read_bytes().decode("utf-8")
    except (OSError, UnicodeDecodeError):
        return None


_read_text = read_skill_text


def content_version(content: Optional[str | bytes]) -> Optional[str]:
    """Return the optimistic-concurrency version without normalising file bytes."""
    if content is None:
        return None
    raw = content if isinstance(content, bytes) else content.encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def display_skill_text(content: Optional[str]) -> Optional[str]:
    """Remove only the BOM marker for the editor; keep every newline unchanged."""
    return content.removeprefix("\ufeff") if content is not None else None


def _display_path(path: Optional[Path]) -> Optional[str]:
    """Shorten service-local paths for display without changing the real path."""
    if path is None:
        return None
    actual = str(path)
    try:
        # ``HOME`` and a resolved file can use different spellings of the same
        # directory (for example ``/var`` versus ``/private/var`` on macOS).
        # Resolve only for this display comparison; ``path`` remains the exact
        # absolute path returned to the editor for file operations.
        absolute = Path(path).resolve(strict=False)
        home = Path.home().resolve(strict=False)
        relative = absolute.relative_to(home)
    except (OSError, RuntimeError, ValueError, TypeError):
        return actual
    return "~" if not relative.parts else f"~/{relative.as_posix()}"


def _skill_name(path: Path) -> str:
    try:
        from tools.skill_usage import read_skill_name

        return read_skill_name(path, path.parent.name)
    except (ImportError, OSError, UnicodeDecodeError, ValueError, TypeError):
        return path.parent.name


def _skill_file(
    root: Path,
    name: str,
    relative_dir: Optional[Path] = None,
    *,
    exact: bool = False,
) -> Optional[Path]:
    """Find *name* under *root*, preferring the runtime's relative directory."""
    candidates: list[Path] = []
    if relative_dir is not None:
        candidate = root / relative_dir / "SKILL.md"
        if candidate.is_file():
            candidates.append(candidate)
    if exact:
        # The relative directory is the stable identity shared by runtime and
        # source. A user may edit frontmatter ``name`` before synchronising;
        # requiring matching display names here would hide that source.
        return candidates[0] if candidates else None
    try:
        from agent.skill_utils import iter_skill_index_files

        files: Iterable[Path] = iter_skill_index_files(root, "SKILL.md")
    except (ImportError, OSError, RuntimeError):
        files = root.rglob("SKILL.md") if root.is_dir() else ()
    for candidate in files:
        try:
            if candidate.is_file() and _skill_name(candidate) == name and candidate not in candidates:
                candidates.append(candidate)
        except OSError:
            continue
    return candidates[0] if candidates else None


def _repo_root(path: Path) -> Optional[Path]:
    """Return the nearest git checkout containing *path*, without running git."""
    try:
        current = path.resolve(strict=False)
    except OSError:
        return None
    for _ in range(64):
        try:
            if (current / ".git").exists():
                return current
        except OSError:
            return None
        if current.parent == current:
            return None
        current = current.parent
    return None


def _relative_skill_dir(skill_md: Path) -> Optional[Path]:
    try:
        from hermes_constants import get_hermes_home

        return skill_md.resolve(strict=False).relative_to(
            (get_hermes_home() / "skills").resolve(strict=False)
        ).parent
    except (OSError, ValueError):
        return None


def _configured_repository_source(
    name: str, relative_dir: Optional[Path], profile: str
) -> Optional[Path]:
    """Resolve a profile source from the server's explicit repository root.

    The running gateway may have a different cwd from the source checkout. Do
    not use the request's cwd, a skill name, or a home-directory scan to infer
    a source. ``HERMES_REPOSITORY_ROOT`` is set by the gateway deployment and
    the profile/relative path below is fixed by the profile layout.
    """
    repository_root = configured_repository_root()
    if repository_root is None or relative_dir is None:
        return None
    profile_root = repository_root / "profiles" / profile / "skills"
    return _skill_file(profile_root, name, relative_dir, exact=True)


def configured_source_for_skill(name: str, skill_md: Path, profile: Optional[str] = None) -> Optional[Path]:
    """Return the source path for a profile skill using its stable relative directory."""
    return _configured_repository_source(name, _relative_skill_dir(skill_md), profile or _profile_name())


def configured_repository_root() -> Optional[Path]:
    """Return the explicitly configured writable source checkout, if any."""
    try:
        from hermes_cli.config import load_config

        configured = (load_config().get("skills") or {}).get("repository_root")
    except (ImportError, OSError, RuntimeError, TypeError, ValueError):
        configured = None
    # This is an existing deployment-provided root (not a new setting); the
    # config key above is the normal long-term form.
    raw_root = str(configured or os.environ.get("HERMES_REPOSITORY_ROOT", "")).strip()  # health: allow HX002 -- existing deployment root, with config.yaml preferred
    if not raw_root or not Path(raw_root).is_absolute():
        return None
    try:
        repository_root = Path(raw_root).expanduser().resolve(strict=False)
        return repository_root if repository_root.is_dir() and _repo_root(repository_root) == repository_root else None
    except (OSError, RuntimeError, ValueError, TypeError):
        return None


def _release_root() -> Optional[Path]:
    raw = os.environ.get("HERMES_RELEASES_ROOT", "").strip()  # health: allow HX002 -- existing deployment release root
    if not raw or not Path(raw).is_absolute():
        return None
    try:
        return Path(raw).expanduser().resolve(strict=False)
    except (OSError, RuntimeError, ValueError):
        return None


def _is_release_path(path: Path) -> bool:
    release_root = _release_root()
    if release_root is None:
        return False
    try:
        path.resolve(strict=False).relative_to(release_root)
    except (OSError, RuntimeError, ValueError):
        return False
    return True


def _is_writable_file(path: Optional[Path], *, reject_symlink: bool = True) -> bool:
    if path is None:
        return False
    try:
        return (
            path.is_file()
            and (not reject_symlink or not path.is_symlink())
            and not _is_release_path(path)
            and os.access(path, os.W_OK)
            and os.access(path.parent, os.W_OK)
        )
    except OSError:
        return False


def _path_is_within_non_symlink_root(path: Path, root: Path) -> bool:
    """Confine a path to a profile root without following a link in that tree."""
    try:
        absolute_path = Path(os.path.abspath(path))
        absolute_root = Path(os.path.abspath(root))
        absolute_path.relative_to(absolute_root)
        current = absolute_path
        while True:
            if current.is_symlink():
                return False
            if current == absolute_root:
                return True
            parent = current.parent
            if parent == current:
                return False
            current = parent
    except (OSError, RuntimeError, ValueError, TypeError):
        return False


def _runtime_path_is_safe(skill_md: Path) -> bool:
    try:
        from hermes_constants import get_hermes_home

        profile_root = get_hermes_home()
        skills_root = profile_root / "skills"
    except (OSError, RuntimeError, ValueError):
        return False
    return (
        _path_is_within_non_symlink_root(skill_md, profile_root)
        and _path_is_within_non_symlink_root(skill_md, skills_root)
    )


def _runtime_is_editable(skill_md: Path) -> bool:
    return _runtime_path_is_safe(skill_md) and _is_writable_file(skill_md)


def _source_is_editable(source_path: Optional[Path]) -> bool:
    repository_root = configured_repository_root()
    if repository_root is None or source_path is None:
        return False
    try:
        profile_root = repository_root / "profiles" / _profile_name() / "skills"
        source_path.relative_to(profile_root)
    except (OSError, RuntimeError, ValueError):
        try:
            source_path.relative_to(repository_root)
        except (OSError, RuntimeError, ValueError):
            return False
        return _path_is_within_non_symlink_root(source_path, repository_root) and _is_writable_file(source_path)
    if not (
        _path_is_within_non_symlink_root(source_path, profile_root)
        and _path_is_within_non_symlink_root(source_path, profile_root.parent)
    ):
        return False
    return _is_writable_file(source_path)


def _profile_name() -> str:
    try:
        from hermes_cli.profiles import current_profile_name

        return current_profile_name("default") or "default"
    except (ImportError, OSError, RuntimeError, ValueError, TypeError):
        return "default"


def _known_source(name: str, skill_md: Path, cwd: Optional[str]) -> tuple[Optional[Path], dict[str, Any]]:
    """Return ``(local source path, source metadata)`` for a resolved skill."""
    installed = skill_md.resolve(strict=False)
    source_meta: dict[str, Any] = {"kind": "unknown", "path": None, "repo": None}

    # A symlink is an explicit source declaration and must win over all guesses.
    if skill_md.is_symlink():
        try:
            target = skill_md.resolve(strict=True)
        except OSError:
            target = None
        if target is not None and target.is_file():
            source_meta["kind"] = "symlink"
            return target, source_meta

    # A hub install has authoritative remote provenance in lock.json, but usually
    # no local source file. Match by the actual install path, not only by name:
    # another source can legitimately use the same display name.
    try:
        from tools.skills_hub import HubLockFile
        from hermes_constants import get_hermes_home

        skills_root = (get_hermes_home() / "skills").resolve(strict=False)
        for entry in HubLockFile().list_installed():
            install_path = str(entry.get("install_path") or "").strip()
            if not install_path:
                continue
            try:
                lock_path = (skills_root / install_path).resolve(strict=False)
                matches = installed == lock_path or installed == (lock_path / "SKILL.md").resolve(strict=False)
            except (OSError, RuntimeError):
                matches = False
            if matches:
                metadata = entry.get("metadata")
                source_meta.update({
                    "kind": "hub",
                    "identifier": entry.get("identifier"),
                    "registry": entry.get("source"),
                    "repo": metadata.get("repo") if isinstance(metadata, dict) else None,
                })
                return None, source_meta
    except (ImportError, OSError, RuntimeError, ValueError, TypeError, KeyError) as exc:
        logger.debug("skills hub provenance unavailable: %s", exc)

    # A profile checkout is the authoritative writable source configured by the
    # gateway. Resolve it before package/external copies so a same-named bundled
    # skill cannot hide the profile's source file.
    relative_dir = _relative_skill_dir(skill_md)
    source = _configured_repository_source(name, relative_dir, _profile_name())
    if source is not None and source.resolve(strict=False) != installed:
        source_meta["kind"] = "repository"
        return source, source_meta

    # A project skill already lives in the configured checkout. It is its own
    # source; do not infer another repository from its display name.
    repository_root = configured_repository_root()
    if repository_root is not None:
        try:
            installed.relative_to(repository_root)
        except (OSError, RuntimeError, ValueError) as exc:
            logger.debug("skill is outside configured repository root: %s", exc)
        else:
            source_meta["kind"] = "repository"
            return skill_md, source_meta

    # Bundled source is a local checkout/package tree when available.
    try:
        from hermes_constants import get_bundled_skills_dir

        bundled_root = get_bundled_skills_dir(Path(__file__).resolve().parents[1] / "skills")
        bundled = _skill_file(bundled_root, name, relative_dir)
        if bundled is not None and bundled.resolve(strict=False) != installed:
            source_meta["kind"] = "bundled"
            return bundled, source_meta
    except (ImportError, OSError, RuntimeError, ValueError) as exc:
        logger.debug("bundled skill provenance unavailable: %s", exc)

    # External and configured create directories are explicit source roots.
    try:
        from agent.skill_utils import get_external_skills_dirs, get_skill_create_dir

        roots = list(get_external_skills_dirs())
        if (create_dir := get_skill_create_dir()) is not None:
            roots.append(create_dir)
        for root in roots:
            source = _skill_file(Path(root), name, relative_dir)
            if source is not None and source.resolve(strict=False) != installed:
                source_meta["kind"] = "external"
                return source, source_meta
    except (ImportError, OSError, RuntimeError, ValueError) as exc:
        logger.debug("external skill provenance unavailable: %s", exc)

    return None, source_meta


def describe_skill_location(name: str, skill_md: Path, *, cwd: Optional[str] = None) -> dict[str, Any]:
    """Build the JSON-safe provenance contract used by the Skills page."""
    from hermes_cli.profiles import current_profile_name

    installed_path = str(skill_md)
    source_path, source = _known_source(name, skill_md, cwd)
    source_path_str = str(source_path) if source_path is not None else None
    repo_path = _repo_root(source_path or skill_md)
    repository = None
    if repo_path is not None:
        try:
            relative = str((source_path or skill_md).resolve(strict=False).relative_to(repo_path))
        except (OSError, ValueError):
            relative = None
        repository = {"name": repo_path.name, "root": str(repo_path), "relative_path": relative}

    installed_content = _read_text(skill_md)
    source_content = _read_text(source_path) if source_path is not None else None
    comparison = "unknown"
    if source_path is not None:
        comparison = "identical" if installed_content is not None and installed_content == source_content else "different"
        if source_path.resolve(strict=False) == skill_md.resolve(strict=False):
            comparison = "identical"

    machine = platform.node() or "unknown"
    profile = current_profile_name("default") or "default"
    effective_cwd = str(cwd or "").strip()
    if not effective_cwd:
        try:
            from agent.runtime_cwd import resolve_agent_cwd

            effective_cwd = str(resolve_agent_cwd())
        except (OSError, RuntimeError):
            effective_cwd = ""
    source["path"] = source_path_str
    source["display_path"] = _display_path(source_path)
    source["known"] = source["kind"] != "unknown"
    # Hub metadata can carry a remote repository URL/name even when no local
    # source file is available. Keep it instead of replacing it with ``None``.
    if repository is not None:
        source["repo"] = repository
    if source_path is not None:
        source["cwd"] = str(repo_path or source_path.parent)
    source["exists"] = source_path is not None and source_content is not None
    source["matches_runtime"] = comparison == "identical"
    runtime_path_safe = _runtime_path_is_safe(skill_md)
    configured_source = configured_source_for_skill(name, skill_md, profile)
    source_is_separate = source_path is not None and source_path.resolve(strict=False) != skill_md.resolve(strict=False)
    source_is_configured = source_path is not None and configured_source == source_path
    source["editable"] = (
        source["kind"] == "repository"
        and source_content is not None
        and source_is_separate
        and source_is_configured
        and runtime_path_safe
        and _source_is_editable(source_path)
    )
    source["write_reason"] = (
        "configured_repository" if source["editable"]
        else "source_unreadable" if source_path is not None and source_content is None
        else "source_not_separate" if source_path is not None and not source_is_separate
        else "source_not_allowed" if source["kind"] == "repository" and not source_is_configured
        else "runtime_not_editable" if not runtime_path_safe
        else "source_is_read_only" if source_path is not None
        else "source_managed" if source["kind"] != "unknown"
        else "source_unavailable"
    )
    runtime_version = content_version(installed_content)
    source_version = content_version(source_content)
    runtime_editable = installed_content is not None and _runtime_is_editable(skill_md)

    return {
        "machine": machine,
        "profile": profile,
        "cwd": effective_cwd,
        "path": installed_path,
        "runtime": {
            "machine": machine,
            "profile": profile,
            "cwd": effective_cwd,
            "path": installed_path,
            "display_path": _display_path(skill_md),
            "editable": runtime_editable,
        },
        "source": source,
        "repo": repository,
        "installation": {
            "path": installed_path,
            "status": comparison,
            "source_path": source_path_str,
            "runtime_version": runtime_version,
            "source_version": source_version,
            "runtime_editable": runtime_editable,
        },
    }
