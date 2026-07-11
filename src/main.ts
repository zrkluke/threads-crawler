import { Actor } from 'apify';
import { fileURLToPath } from 'url';
import path from 'path';
import { PlaywrightCrawler } from '@crawlee/playwright';
import { launchOptions as camoufoxLaunchOptions } from 'camoufox-js';
import { firefox } from 'playwright';
import axios from 'axios';
import {
    _clean_lines,
    _parse_profile,
    _empty_profile,
    _extract_dom_posts,
    _parse_posts,
    _merge_text_posts_with_dom_posts,
    _profile_replies_url,
    _extract_profile_results,
    _remove_link_preview_cards,
    _expand_truncated_posts,
    _save_debug_artifacts,
} from './routes.js';
import { ActorInput, ThreadPost, ThreadProfile, ProfileSearchResult, ScrapedResult } from './types.js';

const THREADS_BASE_URL = "https://www.threads.com";
const RECENT_SEARCH_DEFAULT_RELATIVE_DATE = "7 days";
const SEARCH_FILTER_BY_SORT: Record<string, string | null> = {
    top: null,
    latest: "recent",
    profiles: "profiles",
};

function _split_bulk(value: string | undefined | null, split_spaces = false): string[] {
    if (!value) return [];
    let normalized = value.replace(/,/g, '\n').replace(/\t/g, '\n');
    if (split_spaces) {
        normalized = normalized.replace(/ /g, '\n');
    }
    return normalized.split('\n').map(item => item.trim()).filter(Boolean);
}

function _dedupe(values: string[]): string[] {
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const val of values) {
        const key = val.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(val);
    }
    return deduped;
}

function _normalize_account(value: string): string {
    return value.trim().replace(/^@/, '').replace(/\/$/, '');
}

function _normalize_tag(value: string): string {
    return value.trim().replace(/^#/, '').replace(/\/$/, '');
}

function _urls_from_request_list(items?: { url: string }[]): string[] {
    return (items || []).map(item => item.url).filter(Boolean);
}

function _build_search_url(keyword: string, search_sort: string): string {
    let url = `${THREADS_BASE_URL}/search?q=${encodeURIComponent(keyword)}&serp_type=default`;
    const search_filter = SEARCH_FILTER_BY_SORT[search_sort];
    if (search_filter) {
        url = `${url}&filter=${search_filter}`;
    }
    return url;
}

export function _normalize_cookies(cookies: any[]): any[] {
    const normalized: any[] = [];
    for (const c of cookies) {
        if (!c || typeof c !== 'object') continue;
        const cookie: Record<string, any> = {
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path || "/",
            httpOnly: c.httpOnly || false,
            secure: c.secure || false,
        };
        if ('expirationDate' in c) {
            cookie.expires = c.expirationDate;
        } else if ('expires' in c) {
            cookie.expires = c.expires;
        }

        const same_site = c.sameSite;
        if (same_site) {
            const same_site_str = String(same_site).toLowerCase();
            if (same_site_str === 'no_restriction') {
                cookie.sameSite = 'None';
            } else if (['lax', 'strict', 'none'].includes(same_site_str)) {
                cookie.sameSite = same_site_str.charAt(0).toUpperCase() + same_site_str.slice(1);
            }
        }
        
        // Remove keys with undefined or null values
        const cleanCookie = Object.fromEntries(
            Object.entries(cookie).filter(([_, v]) => v !== null && v !== undefined)
        );
        normalized.push(cleanCookie);
    }
    return normalized;
}

function _build_requests(actor_input: ActorInput): any[] {
    const mode = actor_input.mode || "profile";
    const max_posts_per_account = Math.min(parseInt(String(actor_input.maxPostsPerAccount || actor_input.maxItems || 10), 10), 100);
    const search_sort = actor_input.searchSort || "latest";
    const explicit_post_language_filter = actor_input.postLanguageFilter || actor_input.languageFilter;
    const default_post_language_filter = ["search", "tag"].includes(mode) ? "traditionalChinese" : "any";
    const post_language_filter = explicit_post_language_filter || default_post_language_filter;
    let relative_date = actor_input.relativeDate;

    if (["search", "tag"].includes(mode) && !relative_date && !actor_input.startDate && !actor_input.endDate) {
        relative_date = RECENT_SEARCH_DEFAULT_RELATIVE_DATE;
    }

    const common_user_data = {
        mode,
        startDate: actor_input.startDate,
        endDate: actor_input.endDate,
        relativeDate: relative_date,
        postLanguageFilter: post_language_filter,
        includeRawText: !!actor_input.includeRawText,
        searchSort: search_sort,
        maxPostsPerAccount: max_posts_per_account,
    };

    const requests: any[] = [];

    if (mode === "profile") {
        const rawAccounts = [...(actor_input.accounts || []), ..._split_bulk(actor_input.bulkAccounts, true)];
        const accounts = _dedupe(rawAccounts.filter(Boolean).map(_normalize_account));
        for (const account of accounts) {
            requests.push({
                url: `${THREADS_BASE_URL}/@${account}`,
                userData: { ...common_user_data, target: account },
            });
        }
    } else if (mode === "tag") {
        const rawTags = [...(actor_input.keywordsOrTags || []), ..._split_bulk(actor_input.bulkKeywordsOrTags)];
        const tags = _dedupe(rawTags.filter(Boolean).map(_normalize_tag));
        for (const tag of tags) {
            requests.push({
                url: `${THREADS_BASE_URL}/search?q=${encodeURIComponent(tag)}&serp_type=tags`,
                userData: { ...common_user_data, target: tag },
            });
        }
    } else if (mode === "search") {
        const rawKeywords = [...(actor_input.keywordsOrTags || []), ..._split_bulk(actor_input.bulkKeywordsOrTags)];
        const keywords = _dedupe(rawKeywords.filter(Boolean).map(val => val.trim()));
        for (const keyword of keywords) {
            requests.push({
                url: _build_search_url(keyword, search_sort),
                userData: { ...common_user_data, target: keyword },
            });
        }
    } else if (mode === "thread") {
        const urls = _dedupe(_urls_from_request_list(actor_input.threadUrls));
        for (const url of urls) {
            requests.push({
                url,
                userData: { ...common_user_data, target: url },
            });
        }
    } else if (mode === "feed") {
        let feed_urls = _urls_from_request_list(actor_input.feedUrls);
        if (feed_urls.length === 0) {
            feed_urls = [THREADS_BASE_URL];
        }
        const urls = _dedupe(feed_urls);
        for (const url of urls) {
            requests.push({
                url,
                userData: { ...common_user_data, target: url },
            });
        }
    }

    return requests;
}

function escapeHtml(text: string | null | undefined): string {
    if (!text) return "";
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

async function _send_telegram_notifications(token: string, chat_id: string): Promise<void> {
    console.log("Fetching scraped items from dataset for Telegram notification...");
    try {
        const dataset = await Actor.openDataset();
        const { items } = await dataset.getData();
        if (!items || items.length === 0) {
            console.log("No items found in dataset to send.");
            return;
        }

        const now = new Date();
        const timeLimit = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        for (const item of items) {
            const typedItem = item as ScrapedResult;
            const target = typedItem.target || "unknown";
            const posts = typedItem.posts || [];

            const recentPosts = posts.filter(post => {
                if (post.posted_at_iso) {
                    try {
                        const postTime = new Date(post.posted_at_iso);
                        return postTime >= timeLimit;
                    } catch {
                        // ignore and fallback
                    }
                }
                const postedAt = post.posted_at || "";
                return ["秒", "分鐘", "小時", "現在", "昨天"].some(x => postedAt.includes(x));
            });

            if (recentPosts.length === 0) {
                console.log(`No posts within the last 24 hours for target: ${target}`);
                continue;
            }

            const messages: string[] = [];
            const header = `<b>Threads 爬蟲報告</b>\n<b>@${escapeHtml(target)}</b> (過去 24 小時新貼文)\n\n`;
            let currentMessage = header;

            for (let idx = 0; idx < recentPosts.length; idx++) {
                const post = recentPosts[idx];
                const postedAt = post.posted_at || "";
                const postText = (post.text || "").trim();
                const postUrl = post.post_url;

                let postStr = `<b>【貼文 ${idx + 1}】</b>`;
                if (postedAt) {
                    postStr += ` <i>(發布於 ${escapeHtml(postedAt)})</i>`;
                }
                postStr += `\n${escapeHtml(postText)}\n\n`;

                if (postUrl) {
                    postStr += `<b>連結：</b> <a href="${escapeHtml(postUrl)}">點此查看原文</a>\n`;
                } else {
                    const profileUrl = `https://www.threads.net/@${target}`;
                    postStr += `<b>連結：</b> <a href="${profileUrl}">前往 @${escapeHtml(target)} 主頁</a> (未取得貼文網址)\n`;
                }
                postStr += `────────────────────\n`;

                if (currentMessage.length + postStr.length > 4000) {
                    messages.push(currentMessage);
                    currentMessage = header + postStr;
                } else {
                    currentMessage += postStr;
                }
            }

            if (currentMessage.trim() && currentMessage !== header) {
                messages.push(currentMessage);
            }

            const url = `https://api.telegram.org/bot${token}/sendMessage`;
            for (let i = 0; i < messages.length; i++) {
                console.log(`Sending Telegram message for @${target} (${i + 1}/${messages.length})...`);
                const payload = {
                    chat_id,
                    text: messages[i],
                    parse_mode: 'HTML',
                    disable_web_page_preview: true,
                };
                const response = await axios.post(url, payload, { timeout: 10000 });
                if (response.status >= 400) {
                    console.error(`Failed to send Telegram message: ${response.status} ${response.statusText}`);
                } else {
                    console.log(`Telegram message for @${target} sent successfully.`);
                }
            }
        }
    } catch (e: any) {
        console.error(`Failed to send Telegram notifications: ${e.message}`);
    }
}

async function main() {
    await Actor.init();

    const actor_input: ActorInput = await Actor.getInput() || {};
    const requests = _build_requests(actor_input);

    if (requests.length === 0) {
        console.log("No crawl targets specified in Actor input, exiting...");
        await Actor.exit();
        return;
    }

    const camoufoxOptions = await camoufoxLaunchOptions({
        headless: true,
    });

    const crawler = new PlaywrightCrawler({
        maxRequestsPerCrawl: requests.length,
        minConcurrency: 1,
        maxConcurrency: 1,
        launchContext: {
            launcher: firefox,
            useIncognitoPages: true,
            launchOptions: {
                ...camoufoxOptions as any,
            },
        },
        browserPoolOptions: {
            prePageCreateHooks: [
                (pageId, browserController, pageOptions) => {
                    if (pageOptions) {
                        (pageOptions as any).locale = "zh-TW";
                        (pageOptions as any).timezoneId = "Asia/Taipei";
                    }
                },
            ],
        },
        preNavigationHooks: [
            async (crawlingContext) => {
                await crawlingContext.page.setExtraHTTPHeaders({
                    "Accept-Language": "zh-TW,zh;q=0.9,en-US;q=0.6,en;q=0.4",
                });
                await crawlingContext.blockRequests();
                const cookies = actor_input.cookies;
                if (cookies && cookies.length > 0) {
                    console.log("Injecting session cookies into browser context...");
                    try {
                        const normalized = _normalize_cookies(cookies);
                        await crawlingContext.page.context().addCookies(normalized);
                    } catch (e: any) {
                        console.error(`Failed to inject session cookies: ${e.message}`);
                    }
                }
            }
        ],
        async requestHandler(context) {
            const { request, page } = context;
            const url = request.url;
            console.log(`Scraping ${url}...`);

            const userData = request.userData;
            const scrapedAt = new Date();

            await page.waitForLoadState("domcontentloaded");
            await page.waitForTimeout(8000);
            await _expand_truncated_posts(page);
            await page.waitForTimeout(1000);
            await _remove_link_preview_cards(page);

            try {
                const bodyLocator = page.locator("body");
                const bodyText = await bodyLocator.innerText();
                const lines = _clean_lines(bodyText);
                const profile = userData.mode === "profile" ? _parse_profile(lines) : _empty_profile();
                const title = await page.title();

                let replies: ThreadPost[] = [];
                let posts: ThreadPost[] = [];
                let profiles: ProfileSearchResult[] = [];

                if (userData.mode === "search" && userData.searchSort === "profiles") {
                    profiles = await _extract_profile_results(page);
                    if (profiles.length === 0) {
                        console.warn(`No profiles extracted from search on ${url}. Saving debug artifacts...`);
                        await _save_debug_artifacts(page, url, "search_profiles_empty");
                    }
                } else {
                    let profile_username: string | null = null;
                    if (userData.mode === "profile") {
                        profile_username = profile.username || userData.target || null;
                    }

                    const domPosts = await _extract_dom_posts(
                        page,
                        userData,
                        scrapedAt,
                        profile_username,
                        userData.mode === "profile"
                    );
                    const textPosts = _parse_posts(lines, profile.username, userData, scrapedAt);

                    if (userData.mode === "profile" && textPosts.length > 0) {
                        posts = _merge_text_posts_with_dom_posts(
                            textPosts,
                            domPosts,
                            parseInt(String(userData.maxPostsPerAccount || 10), 10)
                        );
                    } else {
                        posts = domPosts.length > 0 ? domPosts : textPosts;
                    }

                    if (posts.length === 0) {
                        console.warn(`No posts extracted from ${url}. Saving debug artifacts...`);
                        await _save_debug_artifacts(page, url, "posts_empty");
                    }

                    if (userData.mode === "profile" && profile_username) {
                        const repliesUrl = _profile_replies_url(url, profile_username);
                        try {
                            console.log(`Navigating to replies page: ${repliesUrl}...`);
                            await page.goto(repliesUrl);
                            await page.waitForLoadState("domcontentloaded");
                            await page.waitForTimeout(8000);
                            await _expand_truncated_posts(page);
                            await page.waitForTimeout(1000);
                            await _remove_link_preview_cards(page);

                            const replyBodyText = await page.locator("body").innerText();
                            const replyLines = _clean_lines(replyBodyText);
                            const replyDomPosts = await _extract_dom_posts(page, userData, scrapedAt, profile_username);
                            const replyTextPosts = _parse_posts(replyLines, profile_username, userData, scrapedAt);
                            replies = _merge_text_posts_with_dom_posts(
                                replyTextPosts,
                                replyDomPosts,
                                parseInt(String(userData.maxPostsPerAccount || 10), 10)
                            );

                            if (replies.length === 0) {
                                console.warn(`No replies extracted for ${profile_username}. Saving debug artifacts...`);
                                await _save_debug_artifacts(page, repliesUrl, `replies_empty_${profile_username}`);
                            }
                        } catch (e: any) {
                            console.error(`Failed to scrape replies for ${profile_username} at ${repliesUrl}: ${e.message}`);
                            await _save_debug_artifacts(page, repliesUrl, `replies_failed_${profile_username}`);
                        }
                    }
                }

                const data: ScrapedResult = {
                    url,
                    mode: userData.mode,
                    target: userData.target,
                    scraped_at: scrapedAt.toISOString(),
                    title,
                    profile,
                    posts,
                };

                if (userData.mode === "profile") {
                    data.replies = replies;
                }

                if (userData.mode === "search" && userData.searchSort === "profiles") {
                    data.profiles = profiles;
                }

                if (userData.includeRawText) {
                    data.raw_visible_text = bodyText;
                }

                await Actor.pushData(data);

            } catch (e: any) {
                console.error(`Exception occurred in requestHandler while scraping ${url}: ${e.stack}`);
                await _save_debug_artifacts(page, url, "handler_exception");
                throw e;
            }
        }
    });

    await crawler.run(requests);

    const telegram_token = actor_input.telegramToken;
    const telegram_chat_id = actor_input.telegramChatId;

    if (telegram_token && telegram_chat_id) {
        await _send_telegram_notifications(telegram_token, telegram_chat_id);
    }

    await Actor.exit();
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
    main();
}
