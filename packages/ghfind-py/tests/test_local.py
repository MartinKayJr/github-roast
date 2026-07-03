"""Local scoring: offline unit tests + a token-gated live integration test.

The bit-exact score parity lives in test_score_parity.py (offline). Here we cover
the local module's own surface and a real end-to-end crawl when a token is present.
"""

import os

import pytest

from ghfind.local import collect_and_score, score_metrics, GitHubAuthRequiredError


def _empty_metrics(**over):
    m = {
        "username": "test", "profile_url": None, "avatar_url": None, "name": None,
        "bio": None, "company": None, "account_age_years": 0, "created_at": None,
        "followers": 0, "following": 0, "public_repos": 0, "fetched_repo_count": 0,
        "original_repo_count": 0, "nonempty_original_repo_count": 0, "fork_repo_count": 0,
        "empty_original_repo_count": 0, "total_stars": 0, "max_stars": 0,
        "merged_pr_count": 0, "total_pr_count": 0, "issues_created": 0,
        "last_year_contributions": 0, "activity_type_count": 0, "contribution_years_active": 0,
        "days_since_last_activity": None, "recent_merged_pr_sample": 0, "recent_trivial_pr_count": 0,
        "external_trivial_pr_count": 0, "max_impact_repo_stars": 0, "impact_pr_count": 0,
        "impact_depth_raw": 0, "star_inflation_suspect": False, "closed_unmerged_pr_count": 0,
        "pr_rejection_rate": 0, "recent_pr_sample": 0, "top_repo_pr_target": None,
        "top_repo_pr_share": 0, "templated_pr_ratio": 0, "pr_flood_suspect": False,
    }
    m.update(over)
    return m


def test_score_metrics_full_scoring():
    s = score_metrics(_empty_metrics())
    assert "final_score" in s and "tier" in s and "sub_scores" in s
    assert 0 <= s["final_score"] <= 100
    assert "contribution_quality" in s["sub_scores"]


def test_score_metrics_deterministic():
    m = _empty_metrics(followers=500, total_stars=3000, merged_pr_count=40)
    assert score_metrics(m)["final_score"] == score_metrics(m)["final_score"]


def test_collect_and_score_requires_token():
    prev = os.environ.pop("GITHUB_TOKEN", None)
    try:
        with pytest.raises(GitHubAuthRequiredError):
            collect_and_score("torvalds")
    finally:
        if prev is not None:
            os.environ["GITHUB_TOKEN"] = prev


@pytest.mark.skipif(not os.environ.get("GITHUB_TOKEN"), reason="needs GITHUB_TOKEN for a live crawl")
def test_collect_and_score_live():
    scan = collect_and_score("torvalds")
    assert scan["metrics"]["username"].lower() == "torvalds"
    s = scan["scoring"]
    assert 85 <= s["final_score"] <= 100  # a stable, very high account
    assert s["tier"] in ("夯", "顶级")
    assert set(s["sub_scores"]) == {
        "account_maturity", "original_project_quality", "contribution_quality",
        "ecosystem_impact", "community_influence", "activity_authenticity",
    }
