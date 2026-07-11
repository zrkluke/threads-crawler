"""
Tests using REAL Threads page body text captured from an actual crawl run.

The fixture file tests/fixtures/largitdata_profile_body.txt contains the
raw_visible_text from a real @largitdata profile page crawled on 2026-06-12.

Why this approach matters:
- Tests use actual Threads page output, NOT made-up data
- If Threads changes their page layout/format, these tests will fail,
  alerting us immediately without having to run the full crawler
- When fixing a parsing bug, you update the fixture and the test together,
  giving a clear record of what Threads actually looks like

How to update fixtures:
- Run apify run with includeRawText: true
- Copy raw_visible_text from storage/datasets/default/*.json
- Save to tests/fixtures/<account>_<page>_body.txt
"""

from datetime import UTC, datetime, timedelta
from pathlib import Path

from my_actor.routes import (
    _clean_lines,
    _is_metric_line,
    _looks_like_author,
    _looks_like_post_time,
    _matches_post_language_filter,
    _parse_posts,
    _parse_profile,
    _parse_relative_datetime,
    _parse_relative_window,
)

FIXTURES_DIR = Path(__file__).parent / "fixtures"


def load_fixture(name: str) -> str:
    return (FIXTURES_DIR / name).read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# Snapshot tests: real Threads page output -> verified parser output
# ---------------------------------------------------------------------------


def test_profile_parse_from_real_body():
    """
    Parse the @largitdata profile from a real captured body text.
    Expected values come from the actual dataset output of that same crawl run.
    If this test breaks, Threads has changed their profile page format.
    """
    body = load_fixture("largitdata_profile_body.txt")
    lines = _clean_lines(body)
    profile = _parse_profile(lines)

    # These ground-truth values come from the actual crawl result:
    # storage/datasets/default/000000001.json
    assert profile["username"] == "largitdata"
    assert profile["display_name"] == "largitdata"
    assert profile["external_url"] == "largitdata.com"
    # bio includes follower count because Threads embeds it in the same text block
    assert profile["bio"] is not None
    assert "大數軟體有限公司" in str(profile["bio"])


def test_posts_parse_from_real_body_count():
    """
    Verify how many posts are parsed from the real body text.
    Currently Threads shows 5 posts on the profile page (with maxPosts=5).
    If this number changes unexpectedly, Threads' layout has shifted.
    """
    body = load_fixture("largitdata_profile_body.txt")
    lines = _clean_lines(body)
    scraped_at = datetime(2026, 6, 12, 16, 10, 45, tzinfo=UTC)
    user_data = {"maxPostsPerAccount": 10, "mode": "profile", "postLanguageFilter": "any"}

    posts = _parse_posts(lines, "largitdata", user_data, scraped_at)

    # We saw 5 posts in the actual crawl result
    assert len(posts) >= 5, (
        f"Expected at least 5 posts but got {len(posts)}. "
        "Threads may have changed their page format — update the fixture."
    )


def test_posts_first_post_from_real_body():
    """
    Verify the first post's author and time unit parsed from real body.
    The first post was posted '1小時' ago and authored by 'largitdata'.
    """
    body = load_fixture("largitdata_profile_body.txt")
    lines = _clean_lines(body)
    scraped_at = datetime(2026, 6, 12, 16, 10, 45, tzinfo=UTC)
    user_data = {"maxPostsPerAccount": 10, "mode": "profile", "postLanguageFilter": "any"}

    posts = _parse_posts(lines, "largitdata", user_data, scraped_at)
    first = posts[0]

    assert first["author"] == "largitdata"
    assert first["posted_at"] == "1小時"
    # Verify ISO time is about 1 hour before scraped_at
    assert first["posted_at_iso"] == (scraped_at - timedelta(hours=1)).isoformat()
    # Verify text starts with expected content
    assert "如何讓AI自己做AI研究" in str(first["text"])


def test_posts_metrics_from_real_body():
    """
    Verify likes/replies metrics are parsed correctly from real body.
    The second post (1天 ago, Colab CLI post) had: likes=29, replies=5, reposts=4, shares=19.
    """
    body = load_fixture("largitdata_profile_body.txt")
    lines = _clean_lines(body)
    scraped_at = datetime(2026, 6, 12, 16, 10, 45, tzinfo=UTC)
    user_data = {"maxPostsPerAccount": 10, "mode": "profile", "postLanguageFilter": "any"}

    posts = _parse_posts(lines, "largitdata", user_data, scraped_at)

    # Find the Colab CLI post (1天 ago)
    colab_post = next((p for p in posts if "Colab CLI" in str(p.get("text", ""))), None)
    assert colab_post is not None, "Colab CLI post not found — fixture may be stale"
    assert colab_post["metrics"]["likes"] == "29"
    assert colab_post["metrics"]["replies"] == "5"
    assert colab_post["metrics"]["reposts"] == "4"
    assert colab_post["metrics"]["shares"] == "19"


def test_translate_marker_stripped_from_real_body():
    """
    Verify '翻譯' marker does NOT appear in parsed post text.
    Threads shows a '翻譯' button under posts — the parser must strip this.
    If this test fails, the parser is polluting post text with UI labels.
    """
    body = load_fixture("largitdata_profile_body.txt")
    lines = _clean_lines(body)
    scraped_at = datetime(2026, 6, 12, 16, 10, 45, tzinfo=UTC)
    user_data = {"maxPostsPerAccount": 10, "mode": "profile", "postLanguageFilter": "any"}

    posts = _parse_posts(lines, "largitdata", user_data, scraped_at)
    for post in posts:
        assert "翻譯" not in str(post.get("text", "")), f"'翻譯' UI label found in post text: {post['text']!r}"


def test_login_wall_stops_parsing():
    """
    Verify that when Threads shows a login wall, parsing stops cleanly.
    The fixture has '登入' near the end — posts after it should NOT be parsed.
    """
    body = load_fixture("largitdata_profile_body.txt")
    lines = _clean_lines(body)
    scraped_at = datetime(2026, 6, 12, 16, 10, 45, tzinfo=UTC)
    user_data = {"maxPostsPerAccount": 100, "mode": "profile", "postLanguageFilter": "any"}

    posts = _parse_posts(lines, "largitdata", user_data, scraped_at)

    # Login wall text must not appear as post text
    for post in posts:
        text = str(post.get("text", ""))
        assert "登入或註冊 Threads" not in text
        assert "使用 Instagram 帳號繼續" not in text


# ---------------------------------------------------------------------------
# Pure-logic unit tests: these test specific parsing rules in isolation
# ---------------------------------------------------------------------------


def test_looks_like_post_time_chinese():
    """Threads in zh-TW uses Chinese time units — these must all be detected."""
    assert _looks_like_post_time("3秒") is True
    assert _looks_like_post_time("5分鐘") is True
    assert _looks_like_post_time("2小時") is True
    assert _looks_like_post_time("1天") is True
    assert _looks_like_post_time("1週") is True
    assert _looks_like_post_time("現在") is True
    assert _looks_like_post_time("昨天") is True


def test_looks_like_post_time_english():
    """English time units used on non-zh-TW pages."""
    assert _looks_like_post_time("5s") is True
    assert _looks_like_post_time("10m") is True
    assert _looks_like_post_time("2h") is True
    assert _looks_like_post_time("3d") is True
    assert _looks_like_post_time("4w") is True
    assert _looks_like_post_time("now") is True
    assert _looks_like_post_time("yesterday") is True


def test_looks_like_post_time_rejects_non_time():
    """Strings that look like time but are not should return False."""
    assert _looks_like_post_time("not a time") is False
    assert _looks_like_post_time("100") is False  # bare number is a metric, not time


def test_is_metric_line():
    """Threads engagement numbers appear as bare numbers or with K/M suffix."""
    assert _is_metric_line("10") is True
    assert _is_metric_line("1,200") is True
    assert _is_metric_line("1.5K") is True
    assert _is_metric_line("10M") is True
    assert _is_metric_line("Follow") is False
    assert _is_metric_line("largitdata") is False


def test_looks_like_author_rejects_ui_labels():
    """UI labels like Follow/Replies must NOT be treated as post authors."""
    assert _looks_like_author("Follow") is False
    assert _looks_like_author("Replies") is False
    assert _looks_like_author("5s") is False
    assert _looks_like_author("10K") is False
    # Valid usernames pass
    assert _looks_like_author("largitdata") is True
    assert _looks_like_author("user.name_123") is True


def test_parse_relative_datetime_chinese_units():
    """Verify all Chinese time unit conversions produce correct ISO datetimes."""
    scraped_at = datetime(2026, 6, 12, 12, 0, 0, tzinfo=UTC)
    assert _parse_relative_datetime("30秒", scraped_at) == (scraped_at - timedelta(seconds=30)).isoformat()
    assert _parse_relative_datetime("15分鐘", scraped_at) == (scraped_at - timedelta(minutes=15)).isoformat()
    assert _parse_relative_datetime("1小時", scraped_at) == (scraped_at - timedelta(hours=1)).isoformat()
    assert _parse_relative_datetime("5天", scraped_at) == (scraped_at - timedelta(days=5)).isoformat()
    assert _parse_relative_datetime("2週", scraped_at) == (scraped_at - timedelta(weeks=2)).isoformat()
    assert _parse_relative_datetime("1月", scraped_at) == (scraped_at - timedelta(days=30)).isoformat()
    assert _parse_relative_datetime("1年", scraped_at) == (scraped_at - timedelta(days=365)).isoformat()
    assert _parse_relative_datetime("現在", scraped_at) == scraped_at.isoformat()
    assert _parse_relative_datetime("昨天", scraped_at) == (scraped_at - timedelta(days=1)).isoformat()


def test_parse_relative_datetime_invalid_returns_none():
    scraped_at = datetime(2026, 6, 12, 12, 0, 0, tzinfo=UTC)
    assert _parse_relative_datetime("invalid format", scraped_at) is None
    assert _parse_relative_datetime("largitdata", scraped_at) is None


def test_parse_relative_window():
    scraped_at = datetime(2026, 6, 12, 12, 0, 0, tzinfo=UTC)
    assert _parse_relative_window("7 days", scraped_at) == scraped_at - timedelta(days=7)
    assert _parse_relative_window("2 weeks", scraped_at) == scraped_at - timedelta(weeks=2)
    assert _parse_relative_window("invalid window", scraped_at) is None


def test_language_filter_traditional_chinese():
    """Traditional Chinese posts must pass; simplified Chinese and English must fail."""
    assert _matches_post_language_filter("這是繁體中文貼文", "traditionalChinese") is True
    assert _matches_post_language_filter("This is English", "traditionalChinese") is False
    # Simplified Chinese markers (个们会发)
    assert _matches_post_language_filter("这是简体中文贴文", "traditionalChinese") is False


def test_language_filter_any_accepts_all():
    assert _matches_post_language_filter("Hello world", "any") is True
    assert _matches_post_language_filter("這是繁體中文", "any") is True
    assert _matches_post_language_filter("这是简体中文", "any") is True


def test_normalize_cookies():
    from my_actor.main import _normalize_cookies

    raw = [
        "not-a-dict-should-be-ignored",
        {
            "name": "sessionid",
            "value": "secret123",
            "domain": ".threads.net",
            "path": "/",
            "expirationDate": 1234567.89,
            "httpOnly": True,
            "secure": True,
            "sameSite": "no_restriction"
        },
        {
            "name": "mid",
            "value": "mid123",
            "domain": ".threads.net",
            "expires": 987654.32,
            "sameSite": "lax"
        }
    ]

    normalized = _normalize_cookies(raw)
    assert len(normalized) == 2

    c1 = normalized[0]
    assert c1["name"] == "sessionid"
    assert c1["value"] == "secret123"
    assert c1["domain"] == ".threads.net"
    assert c1["path"] == "/"
    assert c1["expires"] == 1234567.89
    assert c1["httpOnly"] is True
    assert c1["secure"] is True
    assert c1["sameSite"] == "None"

    c2 = normalized[1]
    assert c2["name"] == "mid"
    assert c2["value"] == "mid123"
    assert c2["domain"] == ".threads.net"
    assert c2["path"] == "/" # defaults to "/"
    assert c2["expires"] == 987654.32
    assert c2["sameSite"] == "Lax"
