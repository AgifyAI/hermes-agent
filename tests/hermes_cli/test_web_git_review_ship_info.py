"""Review ship-info keeps GitHub identity metadata separate from git writes."""

from unittest.mock import patch

from hermes_cli import web_git


def test_review_ship_info_returns_pr_heading_metadata_without_mutating_the_repo(tmp_path):
    gh_json = {
        "url": "https://github.com/example/demo/pull/42",
        "state": "OPEN",
        "number": 42,
        "title": "Show the review identity",
        "author": {"login": "octocat"},
        "baseRefName": "main",
        "headRefName": "feature/review-heading",
    }

    with patch.object(web_git, "_is_dir", return_value=True), patch.object(
        web_git, "_gh", side_effect=[(True, "", "")]
    ) as gh, patch.object(web_git, "_gh_json", return_value=gh_json) as gh_json_call:
        result = web_git.review_ship_info(str(tmp_path))

    assert result == {
        "ghReady": True,
        "pr": {
            "url": gh_json["url"],
            "state": "OPEN",
            "number": 42,
            "title": "Show the review identity",
            "author": "octocat",
            "baseRefName": "main",
            "headRefName": "feature/review-heading",
        },
    }
    gh.assert_called_once_with(str(tmp_path), ["auth", "status"])
    gh_json_call.assert_called_once_with(
        str(tmp_path), ["pr", "view", "--json", "url,state,number,title,author,baseRefName,headRefName"]
    )


def test_review_ship_info_keeps_fake_or_missing_repo_and_no_pr_boundary(tmp_path):
    with patch.object(web_git, "_is_dir", return_value=False), patch.object(web_git, "_gh"):
        assert web_git.review_ship_info(str(tmp_path / "not-a-repo")) == {"ghReady": False, "pr": None}

    gh_json = {"url": "", "state": "", "number": 0}
    with patch.object(web_git, "_is_dir", return_value=True), patch.object(
        web_git, "_gh", return_value=(True, "", "")
    ), patch.object(web_git, "_gh_json", return_value=gh_json):
        assert web_git.review_ship_info(str(tmp_path)) == {"ghReady": True, "pr": None}
