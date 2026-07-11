from datetime import UTC, datetime
import pytest
from playwright.sync_api import sync_playwright
from my_actor.routes import _clean_lines, _parse_posts

@pytest.mark.live
def test_threads_live_profile():
    """Live integration test that fetches the real Threads page and parses it.
    This test runs daily via GitHub Actions to detect any layout changes early.
    """
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            locale="zh-TW",
            timezone_id="Asia/Taipei",
        )
        page = context.new_page()
        page.goto("https://www.threads.net/@largitdata")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(8000)
        
        # Click all "More" buttons to expand truncated posts
        page.evaluate(
            r"""() => {
                const targetTexts = new Set(['more', '更多', '顯示更多', '显示更多']);
                const elements = Array.from(document.querySelectorAll('div, span, button, [role="button"]'));
                for (const el of elements) {
                    if (el.children.length > 0) continue;
                    const text = (el.textContent || el.innerText || '').trim().toLowerCase();
                    if (targetTexts.has(text)) {
                        try { el.click(); } catch(e) {}
                    }
                }
            }"""
        )
        page.wait_for_timeout(1000)
        
        body_text = page.locator("body").inner_text()
        lines = _clean_lines(body_text)
        
        scraped_at = datetime.now(UTC)
        user_data = {
            "maxPostsPerAccount": 10,
            "mode": "profile",
            "postLanguageFilter": "any",
        }
        
        posts = _parse_posts(lines, "largitdata", user_data, scraped_at)
        
        assert len(posts) > 0, "No posts extracted from live Threads page! Layout might have changed."
        for post in posts:
            assert post.get("author") == "largitdata", f"Expected author 'largitdata', got '{post.get('author')}'"
            assert post.get("text"), "Post text is empty!"
            assert "..." not in post.get("text")[-10:], f"Post text appears truncated: '{post.get('text')}'"
            
        browser.close()
