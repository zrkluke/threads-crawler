import { describe, test, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
    _clean_lines,
    _looks_like_post_time,
    _is_metric_line,
    _looks_like_author,
    _matches_post_language_filter,
    _parse_relative_datetime,
    _parse_relative_window,
    _parse_date,
    _is_in_date_range,
    _parse_visible_metrics,
    _parse_profile,
    _parse_posts,
} from '../src/routes.js';
import { _normalize_cookies } from '../src/main.js';
import { ActorInput } from '../src/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'largitdata_profile_body.txt');

function loadFixture(): string {
    return fs.readFileSync(FIXTURE_PATH, 'utf-8');
}

describe('Threads Parser Unit Tests', () => {
    test('test_profile_parse_from_real_body', () => {
        const body = loadFixture();
        const lines = _clean_lines(body);
        const profile = _parse_profile(lines);

        expect(profile.username).toBe('largitdata');
        expect(profile.display_name).toBe('largitdata');
        expect(profile.external_url).toBe('largitdata.com');
        expect(profile.bio).not.toBeNull();
        expect(profile.bio).toContain('大數軟體有限公司');
    });

    test('test_posts_parse_from_real_body_count', () => {
        const body = loadFixture();
        const lines = _clean_lines(body);
        const scraped_at = new Date(Date.UTC(2026, 5, 12, 16, 10, 45));
        const user_data: ActorInput = { maxPostsPerAccount: 10, mode: 'profile', postLanguageFilter: 'any' };

        const posts = _parse_posts(lines, 'largitdata', user_data, scraped_at);
        expect(posts.length).toBeGreaterThanOrEqual(5);
    });

    test('test_posts_first_post_from_real_body', () => {
        const body = loadFixture();
        const lines = _clean_lines(body);
        const scraped_at = new Date(Date.UTC(2026, 5, 12, 16, 10, 45));
        const user_data: ActorInput = { maxPostsPerAccount: 10, mode: 'profile', postLanguageFilter: 'any' };

        const posts = _parse_posts(lines, 'largitdata', user_data, scraped_at);
        const first = posts[0];

        expect(first.author).toBe('largitdata');
        expect(first.posted_at).toBe('1小時');
        
        // 1 hour before scraped_at
        const expectedTime = new Date(scraped_at.getTime() - 60 * 60 * 1000);
        expect(first.posted_at_iso).toBe(expectedTime.toISOString());
        expect(first.text).toContain('如何讓AI自己做AI研究');
    });

    test('test_posts_metrics_from_real_body', () => {
        const body = loadFixture();
        const lines = _clean_lines(body);
        const scraped_at = new Date(Date.UTC(2026, 5, 12, 16, 10, 45));
        const user_data: ActorInput = { maxPostsPerAccount: 10, mode: 'profile', postLanguageFilter: 'any' };

        const posts = _parse_posts(lines, 'largitdata', user_data, scraped_at);
        const colab_post = posts.find(p => String(p.text).includes('Colab CLI'));

        expect(colab_post).toBeDefined();
        expect(colab_post!.metrics.likes).toBe('29');
        expect(colab_post!.metrics.replies).toBe('5');
        expect(colab_post!.metrics.reposts).toBe('4');
        expect(colab_post!.metrics.shares).toBe('19');
    });

    test('test_translate_marker_stripped_from_real_body', () => {
        const body = loadFixture();
        const lines = _clean_lines(body);
        const scraped_at = new Date(Date.UTC(2026, 5, 12, 16, 10, 45));
        const user_data: ActorInput = { maxPostsPerAccount: 10, mode: 'profile', postLanguageFilter: 'any' };

        const posts = _parse_posts(lines, 'largitdata', user_data, scraped_at);
        for (const post of posts) {
            expect(post.text).not.toContain('翻譯');
        }
    });

    test('test_login_wall_stops_parsing', () => {
        const body = loadFixture();
        const lines = _clean_lines(body);
        const scraped_at = new Date(Date.UTC(2026, 5, 12, 16, 10, 45));
        const user_data: ActorInput = { maxPostsPerAccount: 100, mode: 'profile', postLanguageFilter: 'any' };

        const posts = _parse_posts(lines, 'largitdata', user_data, scraped_at);
        for (const post of posts) {
            expect(post.text).not.toContain('登入或註冊 Threads');
            expect(post.text).not.toContain('使用 Instagram 帳號繼續');
        }
    });

    test('test_looks_like_post_time_chinese', () => {
        expect(_looks_like_post_time("3秒")).toBe(true);
        expect(_looks_like_post_time("5分鐘")).toBe(true);
        expect(_looks_like_post_time("2小時")).toBe(true);
        expect(_looks_like_post_time("1天")).toBe(true);
        expect(_looks_like_post_time("1週")).toBe(true);
        expect(_looks_like_post_time("現在")).toBe(true);
        expect(_looks_like_post_time("昨天")).toBe(true);
    });

    test('test_looks_like_post_time_english', () => {
        expect(_looks_like_post_time("5s")).toBe(true);
        expect(_looks_like_post_time("10m")).toBe(true);
        expect(_looks_like_post_time("2h")).toBe(true);
        expect(_looks_like_post_time("3d")).toBe(true);
        expect(_looks_like_post_time("4w")).toBe(true);
        expect(_looks_like_post_time("now")).toBe(true);
        expect(_looks_like_post_time("yesterday")).toBe(true);
    });

    test('test_looks_like_post_time_rejects_non_time', () => {
        expect(_looks_like_post_time("not a time")).toBe(false);
        expect(_looks_like_post_time("100")).toBe(false);
    });

    test('test_is_metric_line', () => {
        expect(_is_metric_line("10")).toBe(true);
        expect(_is_metric_line("1,200")).toBe(true);
        expect(_is_metric_line("3.5K")).toBe(true);
        expect(_is_metric_line("1.2M")).toBe(true);
        expect(_is_metric_line("not metric")).toBe(false);
    });

    test('test_looks_like_author_rejects_ui_labels', () => {
        expect(_looks_like_author("Follow")).toBe(false);
        expect(_looks_like_author("Threads")).toBe(false);
        expect(_looks_like_author("登入")).toBe(false);
        expect(_looks_like_author("some_user")).toBe(true);
    });

    test('test_parse_relative_datetime_chinese_units', () => {
        const now = new Date(Date.UTC(2026, 5, 12, 12, 0, 0));
        expect(_parse_relative_datetime("3秒", now)).toBe(new Date(Date.UTC(2026, 5, 12, 11, 59, 57)).toISOString());
        expect(_parse_relative_datetime("5分", now)).toBe(new Date(Date.UTC(2026, 5, 12, 11, 55, 0)).toISOString());
        expect(_parse_relative_datetime("2小時", now)).toBe(new Date(Date.UTC(2026, 5, 12, 10, 0, 0)).toISOString());
        expect(_parse_relative_datetime("1天", now)).toBe(new Date(Date.UTC(2026, 5, 11, 12, 0, 0)).toISOString());
        expect(_parse_relative_datetime("1週", now)).toBe(new Date(Date.UTC(2026, 5, 5, 12, 0, 0)).toISOString());
    });

    test('test_parse_relative_window', () => {
        const now = new Date(Date.UTC(2026, 5, 12, 12, 0, 0));
        expect(_parse_relative_window("24 hours", now)!.toISOString()).toBe(new Date(Date.UTC(2026, 5, 11, 12, 0, 0)).toISOString());
        expect(_parse_relative_window("7天", now)!.toISOString()).toBe(new Date(Date.UTC(2026, 5, 5, 12, 0, 0)).toISOString());
        expect(_parse_relative_window("invalid", now)).toBeNull();
    });

    test('test_language_filter_traditional_chinese', () => {
        expect(_matches_post_language_filter("這是繁體中文貼文", "traditionalChinese")).toBe(true);
        expect(_matches_post_language_filter("This is English", "traditionalChinese")).toBe(false);
        expect(_matches_post_language_filter("这是简体中文贴文", "traditionalChinese")).toBe(false);
    });

    test('test_language_filter_any_accepts_all', () => {
        expect(_matches_post_language_filter("Hello world", "any")).toBe(true);
        expect(_matches_post_language_filter("這是繁體中文", "any")).toBe(true);
        expect(_matches_post_language_filter("这是简体中文", "any")).toBe(true);
    });

    test('test_normalize_cookies', () => {
        const raw = [
            "not-a-dict-should-be-ignored",
            {
                name: "sessionid",
                value: "secret123",
                domain: ".threads.net",
                path: "/",
                expirationDate: 1234567.89,
                httpOnly: true,
                secure: true,
                sameSite: "no_restriction"
            },
            {
                name: "mid",
                value: "mid123",
                domain: ".threads.net",
                expires: 987654.32,
                sameSite: "lax"
            }
        ];

        const normalized = _normalize_cookies(raw);
        expect(normalized.length).toBe(2);

        const c1 = normalized[0];
        expect(c1.name).toBe("sessionid");
        expect(c1.value).toBe("secret123");
        expect(c1.domain).toBe(".threads.net");
        expect(c1.path).toBe("/");
        expect(c1.expires).toBe(1234567.89);
        expect(c1.httpOnly).toBe(true);
        expect(c1.secure).toBe(true);
        expect(c1.sameSite).toBe("None");

        const c2 = normalized[1];
        expect(c2.name).toBe("mid");
        expect(c2.value).toBe("mid123");
        expect(c2.domain).toBe(".threads.net");
        expect(c2.path).toBe("/"); // defaults to "/"
        expect(c2.expires).toBe(987654.32);
        expect(c2.sameSite).toBe("Lax");
    });
});
