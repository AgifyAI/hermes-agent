"""Tests for the dashboard skill editor endpoints and cron skill attachment.

The Skills page can now create/edit custom skills (SKILL.md) and the Cron
page can attach skills to jobs — closing the "SSH + nano is the only way"
gap for headless/VPS users. These tests pin:

- GET /api/skills/content returns raw SKILL.md (and profile-scopes).
- POST /api/skills creates a skill through the same validated write path
  as the agent's ``skill_manage`` tool (frontmatter validation enforced).
- PUT /api/skills/content rewrites an existing SKILL.md (404 on unknown).
- POST /api/cron/jobs accepts ``skills`` and persists it on the job;
  PUT /api/cron/jobs/{id} can update the list.
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from hermes_cli.skill_locations import content_version


SKILL_MD = """---
name: {name}
description: a test skill
---

# {name}

Do the thing.
"""


def _write_skill(skills_dir, name, display_name=None):
    d = skills_dir / name
    d.mkdir(parents=True, exist_ok=True)
    (d / "SKILL.md").write_text(
        SKILL_MD.format(name=display_name or name), encoding="utf-8"
    )


@pytest.fixture
def isolated_profiles(tmp_path, monkeypatch, _isolate_hermes_home):
    """Isolated default home + one named profile, each with its own skills."""
    from hermes_constants import get_hermes_home
    from hermes_cli import profiles

    default_home = get_hermes_home()
    profiles_root = default_home / "profiles"
    worker_home = profiles_root / "worker_alpha"
    for home in (default_home, worker_home):
        (home / "skills").mkdir(parents=True, exist_ok=True)
        (home / "config.yaml").write_text("{}\n", encoding="utf-8")

    _write_skill(default_home / "skills", "dashboard-skill")
    _write_skill(worker_home / "skills", "worker-skill")

    monkeypatch.setattr(profiles, "_get_default_hermes_home", lambda: default_home)
    monkeypatch.setattr(profiles, "_get_profiles_root", lambda: profiles_root)
    return {"default": default_home, "worker_alpha": worker_home}


@pytest.fixture
def client(monkeypatch, isolated_profiles):
    try:
        from starlette.testclient import TestClient
    except ImportError:
        pytest.skip("fastapi/starlette not installed")

    import hermes_state
    from hermes_constants import get_hermes_home
    from hermes_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN

    monkeypatch.setattr(hermes_state, "DEFAULT_DB_PATH", get_hermes_home() / "state.db")
    c = TestClient(app)
    c.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN
    return c


class TestSkillContent:
    def test_get_content_returns_raw_skill_md(self, client, isolated_profiles):
        resp = client.get("/api/skills/content", params={"name": "dashboard-skill"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "dashboard-skill"
        assert data["content"].startswith("---")
        assert "Do the thing." in data["content"]

    def test_get_and_update_by_frontmatter_display_name(
        self, client, isolated_profiles
    ):
        skills_dir = isolated_profiles["default"] / "skills"
        _write_skill(skills_dir, "agong-deep-search-trace", "AGong Deep Search Trace")

        resp = client.get(
            "/api/skills/content", params={"name": "AGong Deep Search Trace"}
        )
        assert resp.status_code == 200

        new_content = resp.json()["content"].replace(
            "Do the thing.", "Do the NEW thing."
        )
        resp = client.put(
            "/api/skills/content",
            json={"name": "AGong Deep Search Trace", "content": new_content},
        )
        assert resp.status_code == 200
        skill_md = skills_dir / "agong-deep-search-trace" / "SKILL.md"
        assert "Do the NEW thing." in skill_md.read_text(encoding="utf-8")

    def test_get_content_scopes_to_profile(self, client, isolated_profiles):
        resp = client.get(
            "/api/skills/content",
            params={"name": "worker-skill", "profile": "worker_alpha"},
        )
        assert resp.status_code == 200
        # ...and the worker skill is invisible without the profile param.
        resp = client.get("/api/skills/content", params={"name": "worker-skill"})
        assert resp.status_code == 404

    def test_content_reports_configured_repository_without_using_request_cwd(
        self, client, isolated_profiles, tmp_path, monkeypatch
    ):
        """The gateway's repository root is authoritative even when Desktop sends a
        chat cwd from another checkout or another machine."""
        repository = tmp_path / "hermes"
        source = repository / "profiles" / "default" / "skills" / "dashboard-skill" / "SKILL.md"
        source.parent.mkdir(parents=True)
        (repository / ".git").mkdir()
        source.write_text(SKILL_MD.format(name="dashboard-skill").replace("Do the thing.", "From source."))
        monkeypatch.setenv("HERMES_REPOSITORY_ROOT", str(repository))

        response = client.get(
            "/api/skills/content",
            params={"name": "dashboard-skill", "cwd": str(tmp_path)},
        )

        assert response.status_code == 200, response.text
        payload = response.json()
        assert payload["location"]["source"]["kind"] == "repository"
        assert payload["location"]["source"]["path"] == str(source)
        assert payload["location"]["installation"]["status"] == "different"
        assert payload["location"]["source"]["editable"] is True
        assert payload["location"]["installation"]["runtime_editable"] is True
        assert payload["source_content"] == source.read_text()
        assert payload["location"]["source"]["display_path"]
        assert payload["location"]["runtime"]["display_path"]

    def test_project_only_source_is_not_reported_as_editable(self, tmp_path, monkeypatch):
        from hermes_cli.skill_locations import describe_skill_location

        repository = tmp_path / "hermes"
        project_skill = repository / "project" / "SKILL.md"
        project_skill.parent.mkdir(parents=True)
        (repository / ".git").mkdir()
        project_skill.write_text(SKILL_MD.format(name="project-skill"), encoding="utf-8")
        monkeypatch.setenv("HERMES_REPOSITORY_ROOT", str(repository))

        location = describe_skill_location("project-skill", project_skill)

        assert location["source"]["path"] == str(project_skill)
        assert location["source"]["editable"] is False
        assert location["source"]["write_reason"] == "source_not_separate"

    def test_display_paths_shorten_only_the_service_home(self, tmp_path, monkeypatch):
        from hermes_cli.skill_locations import _display_path

        canonical_home = tmp_path / "private" / "home"
        canonical_home.mkdir(parents=True)
        home_alias = tmp_path / "alias-home"
        home_alias.symlink_to(canonical_home, target_is_directory=True)
        monkeypatch.setenv("HOME", str(home_alias))

        local = canonical_home / "hermes" / "profiles" / "default" / "skills" / "demo" / "SKILL.md"
        outside = tmp_path / "demo" / "SKILL.md"

        assert _display_path(local) == "~/hermes/profiles/default/skills/demo/SKILL.md"
        assert _display_path(outside) == str(outside)

    def test_content_uses_the_requested_profile_repository(self, client, isolated_profiles, tmp_path, monkeypatch):
        """A same-named skill in another profile never supplies this profile's source."""
        repository = tmp_path / "hermes"
        source = repository / "profiles" / "worker_alpha" / "skills" / "worker-skill" / "SKILL.md"
        source.parent.mkdir(parents=True)
        (repository / ".git").mkdir()
        source.write_text(
            SKILL_MD.format(name="Renamed worker title").replace("Do the thing.", "From worker source.")
        )
        monkeypatch.setenv("HERMES_REPOSITORY_ROOT", str(repository))

        response = client.get(
            "/api/skills/content",
            params={"name": "worker-skill", "profile": "worker_alpha"},
        )

        assert response.status_code == 200, response.text
        payload = response.json()
        assert payload["location"]["profile"] == "worker_alpha"
        assert payload["location"]["source"]["path"] == str(source)
        assert payload["source_content"] == source.read_text()


class TestSkillSourceSync:
    def _repository_source(self, tmp_path, name="dashboard-skill", profile="default"):
        repository = tmp_path / "hermes"
        source = repository / "profiles" / profile / "skills" / name / "SKILL.md"
        source.parent.mkdir(parents=True)
        (repository / ".git").mkdir()
        source.write_text(SKILL_MD.format(name=name).replace("Do the thing.", "From source."))
        return repository, source

    def test_source_to_installed_requires_both_versions(self, client, isolated_profiles, tmp_path, monkeypatch):
        repository, source = self._repository_source(tmp_path)
        monkeypatch.setenv("HERMES_REPOSITORY_ROOT", str(repository))
        runtime = isolated_profiles["default"] / "skills" / "dashboard-skill" / "SKILL.md"
        expected_runtime = content_version(runtime.read_text(encoding="utf-8"))
        expected_source = content_version(source.read_text(encoding="utf-8"))

        missing_source = client.put(
            "/api/skills/source",
            json={
                "name": "dashboard-skill",
                "direction": "source_to_installed",
                "expected_runtime_version": expected_runtime,
            },
        )
        assert missing_source.status_code == 400, missing_source.text

        response = client.put(
            "/api/skills/source",
            json={
                "name": "dashboard-skill",
                "direction": "source_to_installed",
                "expected_runtime_version": expected_runtime,
                "expected_source_version": expected_source,
            },
        )

        assert response.status_code == 200, response.text
        assert runtime.read_text() == source.read_text()
        assert response.json()["location"]["installation"]["status"] == "identical"

    def test_installed_to_source_rejects_stale_version_without_writing(
        self, client, isolated_profiles, tmp_path, monkeypatch
    ):
        repository, source = self._repository_source(tmp_path)
        monkeypatch.setenv("HERMES_REPOSITORY_ROOT", str(repository))
        runtime = isolated_profiles["default"] / "skills" / "dashboard-skill" / "SKILL.md"
        before_source = source.read_text()
        expected_runtime = content_version(runtime.read_text(encoding="utf-8"))

        response = client.put(
            "/api/skills/source",
            json={
                "name": "dashboard-skill",
                "direction": "installed_to_source",
                "expected_runtime_version": expected_runtime,
                "expected_source_version": "stale-version",
            },
        )

        assert response.status_code == 409, response.text
        assert source.read_text() == before_source
        assert runtime.read_text() != source.read_text()

    def test_runtime_profile_skills_link_is_read_only(
        self, client, isolated_profiles, tmp_path, monkeypatch
    ):
        repository, source = self._repository_source(tmp_path)
        monkeypatch.setenv("HERMES_REPOSITORY_ROOT", str(repository))
        runtime_root = isolated_profiles["default"] / "skills"
        foreign_root = tmp_path / "other-profile-skills"
        runtime_root.rename(foreign_root)
        runtime_root.symlink_to(foreign_root, target_is_directory=True)

        loaded = client.get("/api/skills/content", params={"name": "dashboard-skill"})
        assert loaded.status_code == 200, loaded.text
        location = loaded.json()["location"]
        assert location["runtime"]["editable"] is False
        assert location["installation"]["runtime_editable"] is False
        assert location["source"]["editable"] is False
        assert location["source"]["write_reason"] == "runtime_not_editable"

        response = client.put(
            "/api/skills/source",
            json={
                "name": "dashboard-skill",
                "direction": "source_to_installed",
                "expected_runtime_version": location["installation"]["runtime_version"],
                "expected_source_version": location["installation"]["source_version"],
            },
        )
        assert response.status_code == 400, response.text
        assert response.json()["detail"]
        assert (foreign_root / "dashboard-skill" / "SKILL.md").read_text() != source.read_text()

    def test_runtime_profile_parent_link_is_read_only(
        self, client, isolated_profiles, tmp_path, monkeypatch
    ):
        repository, source = self._repository_source(tmp_path, name="worker-skill", profile="worker_alpha")
        monkeypatch.setenv("HERMES_REPOSITORY_ROOT", str(repository))
        profile_root = isolated_profiles["worker_alpha"]
        foreign_root = tmp_path / "other-profile-home"
        profile_root.rename(foreign_root)
        profile_root.symlink_to(foreign_root, target_is_directory=True)

        loaded = client.get(
            "/api/skills/content",
            params={"name": "worker-skill", "profile": "worker_alpha"},
        )
        assert loaded.status_code == 200, loaded.text
        location = loaded.json()["location"]
        assert location["runtime"]["editable"] is False
        assert location["installation"]["runtime_editable"] is False
        assert location["source"]["editable"] is False
        assert location["source"]["write_reason"] == "runtime_not_editable"

        response = client.put(
            "/api/skills/source?profile=worker_alpha",
            json={
                "name": "worker-skill",
                "direction": "source_to_installed",
                "expected_runtime_version": location["installation"]["runtime_version"],
                "expected_source_version": location["installation"]["source_version"],
            },
        )
        assert response.status_code == 400, response.text
        assert (foreign_root / "skills" / "worker-skill" / "SKILL.md").read_text() != source.read_text()

    def test_repository_profile_skills_link_is_read_only(
        self, client, isolated_profiles, tmp_path, monkeypatch
    ):
        repository, source = self._repository_source(tmp_path)
        monkeypatch.setenv("HERMES_REPOSITORY_ROOT", str(repository))
        source_root = repository / "profiles" / "default" / "skills"
        foreign_root = repository / "profiles" / "other" / "skills"
        foreign_root.parent.mkdir(parents=True)
        source_root.rename(foreign_root)
        source_root.symlink_to(foreign_root, target_is_directory=True)
        before_source = source.read_bytes()

        loaded = client.get("/api/skills/content", params={"name": "dashboard-skill"})
        assert loaded.status_code == 200, loaded.text
        location = loaded.json()["location"]
        assert location["source"]["editable"] is False
        assert location["source"]["write_reason"] == "source_is_read_only"

        response = client.put(
            "/api/skills/source",
            json={
                "name": "dashboard-skill",
                "direction": "edit_source",
                "expected_source_version": location["installation"]["source_version"],
                "content": loaded.json()["source_content"].replace("From source.", "Edited."),
            },
        )
        assert response.status_code == 400, response.text
        assert source.read_bytes() == before_source

    def test_repository_profile_parent_link_is_read_only(
        self, client, isolated_profiles, tmp_path, monkeypatch
    ):
        repository, _ = self._repository_source(tmp_path)
        monkeypatch.setenv("HERMES_REPOSITORY_ROOT", str(repository))
        profile_root = repository / "profiles" / "default"
        foreign_root = repository / "profiles" / "other"
        profile_root.rename(foreign_root)
        profile_root.symlink_to(foreign_root, target_is_directory=True)

        loaded = client.get("/api/skills/content", params={"name": "dashboard-skill"})
        assert loaded.status_code == 200, loaded.text
        location = loaded.json()["location"]
        assert location["source"]["editable"] is False
        assert location["source"]["write_reason"] == "source_is_read_only"

        response = client.put(
            "/api/skills/source",
            json={
                "name": "dashboard-skill",
                "direction": "edit_source",
                "expected_source_version": location["installation"]["source_version"],
                "content": loaded.json()["source_content"].replace("From source.", "Edited."),
            },
        )
        assert response.status_code == 400, response.text

    def test_edit_source_saves_only_repository_copy(self, client, isolated_profiles, tmp_path, monkeypatch):
        repository, source = self._repository_source(tmp_path)
        monkeypatch.setenv("HERMES_REPOSITORY_ROOT", str(repository))
        runtime = isolated_profiles["default"] / "skills" / "dashboard-skill" / "SKILL.md"
        before_runtime = runtime.read_text()
        next_source = source.read_text().replace("name: dashboard-skill", "name: renamed-dashboard")
        next_source = next_source.replace("From source.", "Edited in source.")

        response = client.put(
            "/api/skills/source",
            json={
                "name": "dashboard-skill",
                "direction": "edit_source",
                "expected_source_version": content_version(source.read_text(encoding="utf-8")),
                "content": next_source,
            },
        )

        assert response.status_code == 200, response.text
        assert source.read_text() == next_source
        assert runtime.read_text() == before_runtime
        refreshed = client.get("/api/skills/content", params={"name": "dashboard-skill"})
        assert refreshed.status_code == 200, refreshed.text
        assert refreshed.json()["location"]["source"]["path"] == str(source)

    def test_edit_source_preserves_bom_and_crlf(self, client, isolated_profiles, tmp_path, monkeypatch):
        repository, source = self._repository_source(tmp_path)
        monkeypatch.setenv("HERMES_REPOSITORY_ROOT", str(repository))
        runtime = isolated_profiles["default"] / "skills" / "dashboard-skill" / "SKILL.md"
        crlf = "---\r\nname: dashboard-skill\r\ndescription: keep bytes\r\n---\r\n\r\n# Body\r\nOriginal\r\n"
        runtime.write_bytes(b"\xef\xbb\xbf" + crlf.encode())
        source.write_bytes(b"\xef\xbb\xbf" + crlf.encode())
        before_runtime = runtime.read_bytes()

        loaded = client.get("/api/skills/content", params={"name": "dashboard-skill"}).json()
        assert loaded["content"].startswith("---\r\n")
        next_source = loaded["source_content"].replace("Original", "Edited")
        response = client.put(
            "/api/skills/source",
            json={
                "name": "dashboard-skill",
                "direction": "edit_source",
                "expected_source_version": loaded["location"]["installation"]["source_version"],
                "content": next_source,
            },
        )

        assert response.status_code == 200, response.text
        assert source.read_bytes() == b"\xef\xbb\xbf" + next_source.encode()
        assert runtime.read_bytes() == before_runtime

    def test_concurrent_edit_source_uses_compare_and_swap(self, client, isolated_profiles, tmp_path, monkeypatch):
        repository, source = self._repository_source(tmp_path)
        monkeypatch.setenv("HERMES_REPOSITORY_ROOT", str(repository))
        runtime = isolated_profiles["default"] / "skills" / "dashboard-skill" / "SKILL.md"
        expected = content_version(source.read_text(encoding="utf-8"))
        contents = [
            source.read_text().replace("From source.", "First concurrent edit."),
            source.read_text().replace("From source.", "Second concurrent edit."),
        ]

        def save(content):
            return client.put(
                "/api/skills/source",
                json={
                    "name": "dashboard-skill",
                    "direction": "edit_source",
                    "expected_source_version": expected,
                    "content": content,
                },
            )

        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(save, contents))

        assert sorted(response.status_code for response in responses) == [200, 409]
        assert source.read_text() in contents
        assert runtime.read_text() != source.read_text()


class TestSkillCreate:
    def test_create_writes_skill_md(self, client, isolated_profiles):
        resp = client.post(
            "/api/skills",
            json={"name": "my-new-skill", "content": SKILL_MD.format(name="my-new-skill")},
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True
        skill_md = isolated_profiles["default"] / "skills" / "my-new-skill" / "SKILL.md"
        assert skill_md.exists()
        assert "Do the thing." in skill_md.read_text(encoding="utf-8")


    def test_create_rejects_missing_frontmatter(self, client, isolated_profiles):
        resp = client.post(
            "/api/skills",
            json={"name": "bad-skill", "content": "no frontmatter here"},
        )
        assert resp.status_code == 400
        assert "frontmatter" in resp.json()["detail"].lower()
        assert not (isolated_profiles["default"] / "skills" / "bad-skill").exists()


    def test_create_rejects_invalid_name(self, client, isolated_profiles):
        resp = client.post(
            "/api/skills",
            json={"name": "../escape", "content": SKILL_MD.format(name="x")},
        )
        assert resp.status_code == 400


class TestSkillUpdate:
    def test_update_rewrites_skill_md(self, client, isolated_profiles):
        new_content = SKILL_MD.format(name="dashboard-skill").replace(
            "Do the thing.", "Do the NEW thing."
        )
        resp = client.put(
            "/api/skills/content",
            json={"name": "dashboard-skill", "content": new_content},
        )
        assert resp.status_code == 200
        skill_md = (
            isolated_profiles["default"] / "skills" / "dashboard-skill" / "SKILL.md"
        )
        assert "Do the NEW thing." in skill_md.read_text(encoding="utf-8")


    def test_update_invalid_frontmatter_400(self, client, isolated_profiles):
        resp = client.put(
            "/api/skills/content",
            json={"name": "dashboard-skill", "content": "broken"},
        )
        assert resp.status_code == 400


class TestEditorEndpointsAuth:
    @pytest.mark.parametrize(
        "method,path,kwargs",
        [
            ("get", "/api/skills/content?name=dashboard-skill", {}),
            ("post", "/api/skills", {"json": {"name": "x", "content": "y"}}),
            ("put", "/api/skills/content", {"json": {"name": "x", "content": "y"}}),
        ],
    )
    def test_endpoints_401_without_token(
        self, client, isolated_profiles, method, path, kwargs
    ):
        from hermes_cli.web_server import _SESSION_HEADER_NAME

        client.headers.pop(_SESSION_HEADER_NAME, None)
        resp = getattr(client, method)(path, **kwargs)
        assert resp.status_code == 401


class TestCronJobSkills:
    def test_create_job_with_skills(self, client, isolated_profiles):
        resp = client.post(
            "/api/cron/jobs",
            json={
                "prompt": "do work",
                "schedule": "every 1h",
                "name": "skilled-job",
                "skills": ["dashboard-skill"],
            },
        )
        assert resp.status_code == 200
        job = resp.json()
        assert job["skills"] == ["dashboard-skill"]

        # Round-trip: the list endpoint carries the skills field too.
        listed = client.get("/api/cron/jobs", params={"profile": "default"}).json()
        match = [j for j in listed if j["id"] == job["id"]]
        assert match and match[0]["skills"] == ["dashboard-skill"]

    def test_update_job_skills(self, client, isolated_profiles):
        job = client.post(
            "/api/cron/jobs",
            json={"prompt": "do work", "schedule": "every 1h"},
        ).json()
        assert job.get("skills") in (None, [])

        resp = client.put(
            f"/api/cron/jobs/{job['id']}",
            json={"updates": {"skills": ["dashboard-skill", "worker-skill"]}},
            params={"profile": "default"},
        )
        assert resp.status_code == 200
        assert resp.json()["skills"] == ["dashboard-skill", "worker-skill"]

        # Clearing works too.
        resp = client.put(
            f"/api/cron/jobs/{job['id']}",
            json={"updates": {"skills": []}},
            params={"profile": "default"},
        )
        assert resp.status_code == 200
        assert resp.json()["skills"] == []
