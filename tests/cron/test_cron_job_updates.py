"""Tests for partial cron-job edits made by the dashboard editor."""

from concurrent.futures import ThreadPoolExecutor

import pytest

from cron.jobs import create_job, get_job, update_job


@pytest.fixture()
def tmp_cron_dir(tmp_path, monkeypatch):
    """Redirect cron storage to a temp directory."""
    monkeypatch.setattr("cron.jobs.CRON_DIR", tmp_path / "cron")
    monkeypatch.setattr("cron.jobs.JOBS_FILE", tmp_path / "cron" / "jobs.json")
    monkeypatch.setattr("cron.jobs.OUTPUT_DIR", tmp_path / "cron" / "output")
    return tmp_path


def test_partial_updates_preserve_configuration_and_merge_concurrent_writes(tmp_cron_dir):
    """Editing one field must not erase the rest of a job, even when two fields save together."""
    workdir = str(tmp_cron_dir)
    job = create_job(
        prompt="Keep the full configuration",
        schedule="every 1h",
        name="Original",
        repeat=3,
        skills=["research", "summarize"],
        provider="openai",
        base_url="https://example.test/v1",
        context_from=["upstream-job"],
        enabled_toolsets=["file", "web"],
        workdir=workdir,
        no_agent=False,
    )

    # The first edit is intentionally separate from the racing writes: a sequence of
    # inline saves must use the latest persisted record as its merge base too.
    assert update_job(job["id"], {"name": "Renamed"})["name"] == "Renamed"

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [
            pool.submit(update_job, job["id"], {"base_url": "https://other.test/v1"}),
            pool.submit(update_job, job["id"], {"provider": "anthropic"}),
        ]
        [future.result() for future in futures]

    updated = get_job(job["id"])
    assert updated is not None
    assert updated["name"] == "Renamed"
    assert updated["base_url"] == "https://other.test/v1"
    assert updated["provider"] == "anthropic"
    assert updated["prompt"] == job["prompt"]
    assert updated["repeat"] == job["repeat"]
    assert updated["skills"] == ["research", "summarize"]
    assert updated["context_from"] == ["upstream-job"]
    assert updated["enabled_toolsets"] == ["file", "web"]
    assert updated["workdir"] == workdir
