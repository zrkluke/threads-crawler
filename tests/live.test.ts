import { describe, test, expect } from 'vitest';
import { chromium } from 'playwright';
import { _clean_lines, _parse_posts } from '../src/routes.js';
import { ActorInput } from '../src/types.js';

describe('Threads Live Layout Integration Test', () => {
    test('test_threads_live_profile', async () => {
        const browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            locale: "zh-TW",
            timezoneId: "Asia/Taipei",
        });
        const page = await context.newPage();
        await page.goto("https://www.threads.com/@largitdata");
        await page.waitForLoadState("domcontentloaded");
        await page.waitForTimeout(8000);

        // Click all "More" buttons to expand truncated posts
        await page.evaluate(() => {
            const targetTexts = new Set<string>(['more', '更多', '顯示更多', '显示更多']);
            const elements = Array.from(document.querySelectorAll('div, span, button, [role="button"]'));
            for (const el of elements) {
                if (el.children.length > 0) continue;
                const text = (el.textContent || '').trim().toLowerCase();
                if (targetTexts.has(text)) {
                    try {
                        (el as HTMLElement).click();
                    } catch (e) {
                        // ignore
                    }
                }
            }
        });
        await page.waitForTimeout(1000);

        const bodyLocator = page.locator("body");
        const bodyText = await bodyLocator.innerText();
        const lines = _clean_lines(bodyText);

        const scraped_at = new Date();
        const user_data: ActorInput = {
            maxPostsPerAccount: 10,
            mode: "profile",
            postLanguageFilter: "any",
        };

        const posts = _parse_posts(lines, "largitdata", user_data, scraped_at);

        expect(posts.length).toBeGreaterThan(0);
        for (const post of posts) {
            expect(post.author).toBe("largitdata");
            expect(post.text).toBeTruthy();
            expect(post.text.slice(-10)).not.toContain("...");
        }

        await browser.close();
    }, 60000); // 60s timeout for live network call
});
