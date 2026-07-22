import { Actor } from 'apify';
import { Page } from 'playwright';
import {
    ActorInput,
    ThreadMetrics,
    ThreadPost,
    ThreadProfile,
    ProfileSearchResult
} from './types.js';

export const PROFILE_TABS = new Set<string>(["Threads", "Replies", "Media", "Reposts", "串文", "影音內容", "轉發"]);
export const GLOBAL_STOP_MARKERS = new Set<string>([
    "Log in",
    "Log in or sign up for Threads",
    "See what people are talking about and join the conversation.",
    "登入或註冊 Threads查看人們談論的主題，並加入對話。",
    "登入或註冊 Threads",
    "登入",
    "登录或注册 Threads",
    "登录",
]);
export const TRANSLATE_MARKERS = new Set<string>(["Translate", "翻譯", "翻译"]);
export const NON_AUTHOR_LINES = new Set<string>([
    ...PROFILE_TABS,
    ...TRANSLATE_MARKERS,
    "Follow",
    "Following",
    "Mention",
    "Search",
    "Top",
    "Latest",
    "For you",
    "Threads",
    "Post",
    "Reply",
    "Repost",
    "Share",
    "Like",
    "View",
    "More",
]);

const SIMPLIFIED_CHINESE_MARKERS = new Set<string>(
    "个们会后发关欢见过还进时说让从对该网车门东长云电学广书买开问题现与扩优软体虽请这里为于号实"
);
const CJK_PATTERN = /[\u4e00-\u9fff]/;

export function _clean_lines(text: string | null | undefined): string[] {
    if (!text) return [];
    return text.split('\n').map(line => line.trim()).filter(Boolean);
}

export function _looks_like_post_time(value: string): boolean {
    const normalized = value.trim().toLowerCase();
    return (
        /^\d+\s*[smhdw]$/.test(normalized)
        || /^\d+\s*(秒|分鐘|分|小時|天|日|週|周|月|年)$/.test(normalized)
        || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(normalized)
        || /^\d{4}-\d{1,2}-\d{1,2}$/.test(normalized)
        || ["now", "yesterday", "現在", "昨天"].includes(normalized)
    );
}

export function _is_metric_line(value: string): boolean {
    return /^[\d,.]+\s*[KMB]?$/i.test(value.trim());
}

export function _looks_like_author(value: string): boolean {
    const normalized = value.trim();
    if (!normalized || NON_AUTHOR_LINES.has(normalized)) return false;
    if (GLOBAL_STOP_MARKERS.has(normalized)) return false;
    if (_looks_like_post_time(normalized) || _is_metric_line(normalized)) return false;
    return normalized.length <= 80;
}

export function _matches_post_language_filter(text: string, post_language_filter: string | undefined): boolean {
    if (!post_language_filter || post_language_filter === 'any') return true;
    if (post_language_filter !== 'traditionalChinese') return true;

    const normalized = text.trim();
    const contentWithoutUiLabels = normalized.split('\n')
        .map(line => line.trim())
        .filter(line => !TRANSLATE_MARKERS.has(line))
        .join('\n');

    if (!CJK_PATTERN.test(contentWithoutUiLabels)) return false;

    let simplifiedHits = 0;
    for (const char of contentWithoutUiLabels) {
        if (SIMPLIFIED_CHINESE_MARKERS.has(char)) {
            simplifiedHits++;
        }
    }
    return simplifiedHits === 0;
}

export function _parse_relative_datetime(value: string, scraped_at: Date): string | null {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'now' || normalized === '現在') {
        return scraped_at.toISOString();
    }
    if (normalized === 'yesterday' || normalized === '昨天') {
        const d = new Date(scraped_at.getTime());
        d.setDate(d.getDate() - 1);
        return d.toISOString();
    }

    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(normalized)) {
        const d = new Date(normalized);
        if (!isNaN(d.getTime())) return d.toISOString();
    }

    if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(normalized)) {
        const parts = normalized.split('/');
        const month = parseInt(parts[0], 10) - 1;
        const day = parseInt(parts[1], 10);
        let year = parseInt(parts[2], 10);
        if (year < 100) year += 2000;
        const d = new Date(Date.UTC(year, month, day));
        if (!isNaN(d.getTime())) return d.toISOString();
    }

    let match = normalized.match(/^(\d+)\s*([smhdw])$/);
    if (match) {
        const amount = parseInt(match[1], 10);
        const unit = match[2];
        const d = new Date(scraped_at.getTime());
        if (unit === 's') d.setSeconds(d.getSeconds() - amount);
        else if (unit === 'm') d.setMinutes(d.getMinutes() - amount);
        else if (unit === 'h') d.setHours(d.getHours() - amount);
        else if (unit === 'd') d.setDate(d.getDate() - amount);
        else if (unit === 'w') d.setDate(d.getDate() - amount * 7);
        return d.toISOString();
    }

    match = normalized.match(/^(\d+)\s*(秒|分鐘|分|小時|天|日|週|周|月|年)$/);
    if (match) {
        const amount = parseInt(match[1], 10);
        const unit = match[2];
        const d = new Date(scraped_at.getTime());
        if (unit === '秒') d.setSeconds(d.getSeconds() - amount);
        else if (unit === '分鐘' || unit === '分') d.setMinutes(d.getMinutes() - amount);
        else if (unit === '小時') d.setHours(d.getHours() - amount);
        else if (unit === '天' || unit === '日') d.setDate(d.getDate() - amount);
        else if (unit === '週' || unit === '周') d.setDate(d.getDate() - amount * 7);
        else if (unit === '月') d.setMonth(d.getMonth() - amount);
        else if (unit === '年') d.setFullYear(d.getFullYear() - amount);
        return d.toISOString();
    }

    return null;
}

export function _parse_relative_window(value: string | undefined, scraped_at: Date): Date | null {
    if (!value) return null;
    const match = value.toLowerCase().match(/(\d+)\s*(second|minute|hour|day|week|month|year|秒|分鐘|小時|天|日|週|周|月|年)s?/);
    if (!match) return null;
    const amount = parseInt(match[1], 10);
    const unit = match[2];
    const d = new Date(scraped_at.getTime());
    if (['second', '秒'].includes(unit)) d.setSeconds(d.getSeconds() - amount);
    else if (['minute', '分鐘'].includes(unit)) d.setMinutes(d.getMinutes() - amount);
    else if (['hour', '小時'].includes(unit)) d.setHours(d.getHours() - amount);
    else if (['day', '天', '日'].includes(unit)) d.setDate(d.getDate() - amount);
    else if (['week', '週', '周'].includes(unit)) d.setDate(d.getDate() - amount * 7);
    else if (['month', '月'].includes(unit)) d.setMonth(d.getMonth() - amount);
    else d.setFullYear(d.getFullYear() - amount);
    return d;
}

export function _parse_date(value: string | undefined): Date | null {
    if (typeof value !== 'string' || !value) return null;
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
}

export function _is_in_date_range(posted_at_iso: string | null, user_data: ActorInput, scraped_at: Date): boolean {
    if (!posted_at_iso) return true;
    const posted_at = new Date(posted_at_iso);
    const start_date = _parse_date(user_data.startDate);
    const end_date = _parse_date(user_data.endDate);
    const relative_start = _parse_relative_window(user_data.relativeDate, scraped_at);

    if (relative_start && posted_at < relative_start) return false;
    if (start_date && posted_at < start_date) return false;
    if (end_date) {
        const end_limit = new Date(end_date.getTime());
        end_limit.setDate(end_limit.getDate() + 1);
        if (posted_at > end_limit) return false;
    }
    return true;
}

export function _parse_visible_metrics(values: string[]): ThreadMetrics {
    const padded: (string | null)[] = [...values];
    while (padded.length < 6) padded.push(null);
    return {
        likes: padded[0],
        replies: padded[1],
        reposts: padded[2],
        shares: padded[3],
        views: padded[4],
        quotes: padded[5],
        raw: values,
    };
}

export function _parse_profile(lines: string[]): ThreadProfile {
    const firstLine = (lines[0] || "").trim();
    const isValidUsername = !!(firstLine
        && !GLOBAL_STOP_MARKERS.has(firstLine)
        && !NON_AUTHOR_LINES.has(firstLine)
        && /^[a-zA-Z0-9._]+$/.test(firstLine));
    const username = isValidUsername ? firstLine : null;
    const profile: ThreadProfile = {
        username,
        display_name: null,
        bio: null,
        external_url: null,
        followers: null,
    };
    if (!username) return profile;

    let content_start = 0;
    for (let i = 0; i < lines.length; i++) {
        if (PROFILE_TABS.has(lines[i])) {
            content_start = i + 1;
            break;
        }
    }

    const header_lines = lines.slice(0, content_start);
    let repeated_username_count = 0;
    const bio_lines: string[] = [];

    // Localization labels for buttons and UI elements that should not leak into bio
    const EXCLUDED_BIO_LABELS = new Set<string>([
        "Follow", "Following", "Mention", "Share",
        "追蹤", "追蹤中", "關注", "已關注", "关注", "已关注", "提及", "分享"
    ]);

    for (const line of header_lines) {
        if (line === username) {
            repeated_username_count++;
            if (repeated_username_count === 2) {
                profile.display_name = line;
            }
            continue;
        }

        const lowerLine = line.toLowerCase().trim();
        const isFollowersLine = lowerLine.endsWith('followers')
            || lowerLine.endsWith('位粉絲')
            || lowerLine.endsWith('位粉丝')
            || lowerLine.endsWith('粉絲')
            || lowerLine.endsWith('粉丝');

        if (isFollowersLine) {
            profile.followers = line;
            continue;
        }
        if (line.includes('.') && !line.includes(' ') && !profile.external_url) {
            profile.external_url = line;
            continue;
        }
        if (!EXCLUDED_BIO_LABELS.has(line) && !PROFILE_TABS.has(line)) {
            bio_lines.push(line);
        }
    }
    profile.bio = bio_lines.join('\n') || null;
    return profile;
}

interface PostStartInfo {
    author: string;
    posted_at: string;
    nextIndex: number;
}

export function _find_post_start(lines: string[], index: number, username: string | null, profile_only: boolean): PostStartInfo | null {
    if (index >= lines.length || !_looks_like_author(lines[index])) return null;
    if (profile_only && lines[index] !== username) return null;

    if (index + 1 < lines.length && _looks_like_post_time(lines[index + 1])) {
        return { author: lines[index], posted_at: lines[index + 1], nextIndex: index + 2 };
    }

    const has_display_name = (
        !profile_only
        && index + 2 < lines.length
        && _looks_like_author(lines[index + 1])
        && _looks_like_post_time(lines[index + 2])
    );
    if (has_display_name) {
        return { author: lines[index], posted_at: lines[index + 2], nextIndex: index + 3 };
    }
    return null;
}

export function _find_next_post_start(lines: string[], index: number, username: string | null, profile_only: boolean): boolean {
    if (_find_post_start(lines, index, username, profile_only)) return true;
    return !!(profile_only && _find_post_start(lines, index, username, false));
}

export function _expand_combined_author_time_lines(lines: string[], username: string | null): string[] {
    if (!username) return lines;
    const expanded_lines: string[] = [];
    const username_prefix = `${username} `;
    for (const line of lines) {
        if (!line.toLowerCase().startsWith(username_prefix.toLowerCase())) {
            expanded_lines.push(line);
            continue;
        }
        const remainder = line.slice(username_prefix.length).trim();
        if (!remainder) {
            expanded_lines.push(line);
            continue;
        }
        const parts = remainder.split(/\s+/);
        let split_values: { posted_at: string; remainder: string } | null = null;
        if (parts.length > 0 && _looks_like_post_time(parts[0])) {
            split_values = { posted_at: parts[0], remainder: parts.slice(1).join(' ') };
        } else if (parts.length >= 2 && _looks_like_post_time(`${parts[0]} ${parts[1]}`)) {
            split_values = { posted_at: `${parts[0]} ${parts[1]}`, remainder: parts.slice(2).join(' ') };
        }

        if (!split_values) {
            expanded_lines.push(line);
            continue;
        }

        expanded_lines.push(username, split_values.posted_at);
        if (split_values.remainder) {
            expanded_lines.push(split_values.remainder);
        }
    }
    return expanded_lines;
}

export function _parse_posts(lines: string[], username: string | null, user_data: ActorInput, scraped_at: Date): ThreadPost[] {
    const max_posts = parseInt(String(user_data.maxPostsPerAccount || 10), 10);
    const mode = user_data.mode;
    const profile_only = mode === 'profile' && !!username;
    lines = _expand_combined_author_time_lines(lines, username);

    let start = 0;
    let max_tab_index = -1;
    for (const tab of PROFILE_TABS) {
        const idx = lines.indexOf(tab);
        if (idx !== -1 && idx > max_tab_index) {
            max_tab_index = idx;
        }
    }
    if (max_tab_index !== -1) {
        start = max_tab_index + 1;
    }

    const stop_markers = new Set<string>(GLOBAL_STOP_MARKERS);
    if (username) {
        stop_markers.add(`Log in to see more from ${username}.`);
        stop_markers.add(`登入以查看更多來自${username}的內容。`);
        stop_markers.add(`登录以查看更多来自${username}的内容。`);
    }

    const posts: ThreadPost[] = [];
    let index = start;
    while (index < lines.length) {
        if (stop_markers.has(lines[index])) {
            break;
        }

        const post_start = _find_post_start(lines, index, username, profile_only);
        if (!post_start) {
            index++;
            continue;
        }

        const { author, posted_at } = post_start;
        index = post_start.nextIndex;

        const content_lines: string[] = [];
        while (index < lines.length && !TRANSLATE_MARKERS.has(lines[index])) {
            if (_find_next_post_start(lines, index, username, profile_only) && content_lines.length) {
                break;
            }
            if (stop_markers.has(lines[index])) {
                break;
            }
            content_lines.push(lines[index]);
            index++;
        }

        if (index < lines.length && TRANSLATE_MARKERS.has(lines[index])) {
            index++;
        }

        let metrics: string[] = [];
        while (index < lines.length) {
            if (_find_next_post_start(lines, index, username, profile_only) || stop_markers.has(lines[index])) {
                break;
            }
            if (_is_metric_line(lines[index])) {
                metrics.push(lines[index]);
            }
            index++;
        }

        const trailing_metrics: string[] = [];
        while (content_lines.length && _is_metric_line(content_lines[content_lines.length - 1])) {
            const popped = content_lines.pop();
            if (popped !== undefined) {
                trailing_metrics.unshift(popped);
            }
        }
        metrics = [...trailing_metrics, ...metrics];

        const posted_at_iso = _parse_relative_datetime(posted_at, scraped_at);
        if (_is_in_date_range(posted_at_iso, user_data, scraped_at)) {
            const text = content_lines.join('\n');
            if (!_matches_post_language_filter(text, user_data.postLanguageFilter)) {
                continue;
            }

            posts.push({
                author,
                posted_at,
                posted_at_iso,
                text,
                metrics: _parse_visible_metrics(metrics),
            });

            if (posts.length >= max_posts) {
                break;
            }
        }
    }

    return posts;
}

export function _post_url_username(post_url: string): string | null {
    try {
        const parsed = new URL(post_url);
        const path_parts = parsed.pathname.split('/').filter(Boolean);
        if (path_parts.length === 2 && ['t', 'post'].includes(path_parts[0])) {
            return null;
        }
        if (path_parts.length < 3 || path_parts[1] !== 'post') {
            return null;
        }
        if (!path_parts[0].startsWith('@')) {
            return null;
        }
        return path_parts[0].replace(/^@/, '');
    } catch {
        return null;
    }
}

export function _profile_replies_url(profile_url: string, username: string): string {
    try {
        const parsed = new URL(profile_url);
        return `${parsed.protocol}//${parsed.host}/@${username}/replies`;
    } catch {
        return `https://www.threads.net/@${username}/replies`;
    }
}

export function _same_post_text(left: string | null | undefined, right: string | null | undefined): boolean {
    if (typeof left !== 'string' || typeof right !== 'string') return false;
    const l = left.trim();
    const r = right.trim();
    if (!l || !r) return false;
    if (l === r || l.includes(r) || r.includes(l)) return true;

    // Strip whitespace, punctuation and brackets for fuzzy text matching
    const stripPunct = (s: string) => s.replace(/[\s\n\r\t【】\[\]()（）|｜:：\-_,，.!\?！？]/g, '');
    const cleanL = stripPunct(l);
    const cleanR = stripPunct(r);
    if (!cleanL || !cleanR) return false;
    if (cleanL === cleanR || cleanL.includes(cleanR) || cleanR.includes(cleanL)) return true;

    return false;
}

export function _merge_text_posts_with_dom_posts(text_posts: ThreadPost[], dom_posts: ThreadPost[], max_posts: number): ThreadPost[] {
    const merged_posts = text_posts.map(post => ({ ...post }));
    const used_dom_indexes = new Set<number>();

    for (const text_post of merged_posts) {
        if (text_post.post_url) continue;

        for (let i = 0; i < dom_posts.length; i++) {
            if (used_dom_indexes.has(i)) continue;
            const dom_post = dom_posts[i];

            const sameAuthor = !text_post.author || !dom_post.author || text_post.author.toLowerCase() === dom_post.author.toLowerCase();
            const sameTime = text_post.posted_at === dom_post.posted_at;
            const sameText = _same_post_text(text_post.text, dom_post.text);

            if ((sameAuthor && sameText) || (sameTime && sameText) || (sameText && text_post.text.length > 10)) {
                if (typeof dom_post.post_url === 'string') {
                    text_post.post_url = dom_post.post_url;
                }
                used_dom_indexes.add(i);
                break;
            }
        }
    }

    const seen_post_urls = new Set<string>(merged_posts.map(p => p.post_url).filter(Boolean) as string[]);
    const seen_texts = merged_posts.map(p => p.text);

    for (let i = 0; i < dom_posts.length; i++) {
        if (used_dom_indexes.has(i)) continue;
        const dom_post = dom_posts[i];

        if (typeof dom_post.post_url === 'string' && seen_post_urls.has(dom_post.post_url)) continue;
        if (seen_texts.some(txt => _same_post_text(dom_post.text, txt))) continue;

        merged_posts.push({ ...dom_post });
        if (typeof dom_post.post_url === 'string') {
            seen_post_urls.add(dom_post.post_url);
        }
        seen_texts.push(dom_post.text);

        if (merged_posts.length >= max_posts) {
            break;
        }
    }

    return merged_posts.slice(0, max_posts);
}

export function _has_reply_context(text: string | null | undefined): boolean {
    if (typeof text !== 'string') return false;
    const markers = ["Replying to", "replied to", "回覆給", "回覆了", "回复给", "回复了"];
    return markers.some(m => text.includes(m));
}

interface EvaluatedCard {
    url: string;
    text: string;
    contextText: string;
}

export async function _extract_dom_posts(
    page: Page,
    user_data: ActorInput,
    scraped_at: Date,
    profile_username: string | null = null,
    exclude_reply_context = false
): Promise<ThreadPost[]> {
    const cards = await page.evaluate(() => {
        const postUrlPattern = /^https:\/\/(www\.)?threads\.(com|net)\/(?:(@[^/]+)\/post|t|post)\/([^/?#]+)/;
        const seen = new Set<string>();
        const cardsList: EvaluatedCard[] = [];

        const isVisible = (element: Element | null): boolean => {
            if (!element || !element.isConnected) return false;
            const style = window.getComputedStyle(element);
            if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) {
                return false;
            }
            return element.getClientRects().length > 0;
        };

        const normalizePostUrl = (href: string | null): string | null => {
            if (!href) return null;
            try {
                const url = new URL(href, window.location.origin);
                const match = url.href.match(postUrlPattern);
                if (!match) return null;
                const usernameVal = match[3];
                const postId = match[4];
                if (usernameVal) {
                    return `${url.origin}/${usernameVal}/post/${postId}`;
                }
                return `${url.origin}/t/${postId}`;
            } catch {
                return null;
            }
        };

        const cleanClone = (node: Element): string => {
            const clone = node.cloneNode(true) as Element;
            clone.querySelectorAll('a[href]').forEach(link => {
                const linkText = (link.textContent || '').trim();
                if (!linkText && (link.querySelector('img') || link.querySelector('svg'))) {
                    link.remove();
                }
            });
            return (clone.textContent || '').trim();
        };

        const findCardTextForLink = (element: Element, url: string) => {
            let node: Element | null = element;
            for (let depth = 0; node && depth < 10; depth++, node = node.parentElement) {
                if (!isVisible(node)) continue;

                const textVal = cleanClone(node);
                if (!textVal) continue;

                const linesList = textVal.split('\n').map(line => line.trim()).filter(Boolean);
                if (linesList.length < 2 || linesList.length > 80) continue;
                if (textVal.includes('Log in or sign up for Threads')) continue;

                const postUrls = Array.from(new Set(
                    Array.from(node.querySelectorAll('a[href]'))
                        .map(link => normalizePostUrl(link.getAttribute('href')))
                        .filter(Boolean) as string[]
                ));

                if (postUrls.length >= 1 && postUrls.includes(url)) {
                    const article = element.closest('[role="article"]');
                    const contextText = article && isVisible(article)
                        ? (article.textContent || '').trim()
                        : textVal;
                    return { text: textVal, contextText, postUrls };
                }
            }
            return null;
        };

        const candidateLinks = Array.from(document.querySelectorAll('a[href]'))
            .map(element => ({ element, url: normalizePostUrl(element.getAttribute('href')) }))
            .filter((item): item is { element: Element; url: string } => item.url !== null);

        for (const { element, url } of candidateLinks) {
            if (seen.has(url)) continue;
            if (!isVisible(element)) continue;

            const cardInfo = findCardTextForLink(element, url);
            if (cardInfo) {
                cardsList.push({ url, text: cardInfo.text, contextText: cardInfo.contextText });
                for (const pUrl of cardInfo.postUrls) {
                    seen.add(pUrl);
                }
            }
        }
        return cardsList;
    });

    const max_posts = parseInt(String(user_data.maxPostsPerAccount || 10), 10);
    const posts: ThreadPost[] = [];

    for (const card of cards) {
        if (!card || typeof card.url !== 'string' || typeof card.text !== 'string') continue;

        if (profile_username) {
            let card_username = _post_url_username(card.url);
            if (card_username) {
                if (card_username.toLowerCase() !== profile_username.toLowerCase()) continue;
            } else {
                const post_id = card.url.split('/').pop();
                card.url = `https://www.threads.net/@${profile_username}/post/${post_id}`;
            }
            if (exclude_reply_context && _has_reply_context(card.contextText)) continue;
        }

        const parsed = _parse_posts(
            _clean_lines(card.text),
            profile_username,
            { ...user_data, maxPostsPerAccount: 1 },
            scraped_at
        );

        if (!parsed || parsed.length === 0) continue;
        const post = parsed[0];
        post.post_url = card.url;
        posts.push(post);

        if (posts.length >= max_posts) break;
    }

    return posts;
}

export async function _extract_profile_results(page: Page): Promise<ProfileSearchResult[]> {
    return page.evaluate(() => {
        const byUrl = new Map<string, ProfileSearchResult>();
        for (const element of document.querySelectorAll('a[href]')) {
            let url: URL;
            const href = element.getAttribute('href');
            if (!href) continue;
            try {
                url = new URL(href, window.location.origin);
            } catch {
                continue;
            }

            if (!/^https:\/\/(www\.)?threads\.(com|net)$/.test(url.origin)) continue;
            if (!/^\/@[^/]+\/?$/.test(url.pathname)) continue;

            const profileUrl = `${url.origin}${url.pathname.replace(/\/$/, '')}`;
            const username = url.pathname.replace(/^\/@/, '').replace(/\/$/, '');
            const text = (element.textContent || element.getAttribute('aria-label') || '').trim();
            if (!byUrl.has(profileUrl)) {
                byUrl.set(profileUrl, { username, url: profileUrl, text: text || null });
            }
        }
        return Array.from(byUrl.values());
    });
}

export function _empty_profile(): ThreadProfile {
    return {
        username: null,
        display_name: null,
        bio: null,
        external_url: null,
        followers: null,
    };
}

export async function _remove_link_preview_cards(page: Page): Promise<void> {
    try {
        await page.evaluate(() => {
            const isExternal = (href: string | null): boolean => {
                if (!href) return false;
                try {
                    const url = new URL(href, window.location.origin);
                    return !/(www\.)?threads\.(com|net)$/.test(url.hostname);
                } catch {
                    return false;
                }
            };
            document.querySelectorAll('a[href]').forEach((link) => {
                if (isExternal(link.getAttribute('href')) && link.querySelector('div')) {
                    link.remove();
                }
            });
        });
    } catch (e: any) {
        console.warn(`Failed to remove link preview cards from DOM: ${e.message}`);
    }
}

export async function _expand_truncated_posts(page: Page): Promise<void> {
    try {
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
    } catch (e: any) {
        console.warn(`Failed to expand truncated posts: ${e.message}`);
    }
}

export async function _save_debug_artifacts(page: Page, requestUrl: string, suffix: string): Promise<void> {
    try {
        const parsed = new URL(requestUrl);
        const raw_slug = parsed.pathname.replace(/^\/|\/$/g, '').replace(/\//g, '_').replace(/@/g, '') || "root";
        const sanitized_slug = raw_slug.replace(/[^a-zA-Z0-9!_\-.'()]/g, '_');
        const key_base = `DEBUG_${sanitized_slug}_${suffix}`.replace(/[^a-zA-Z0-9!_\-.'()]/g, '_').slice(0, 200);

        const screenshot_png = await page.screenshot({ fullPage: false });
        await Actor.setValue(`${key_base}_screenshot`, screenshot_png, { contentType: 'image/png' });

        const html_content = await page.content();
        await Actor.setValue(`${key_base}_html`, html_content, { contentType: 'text/html' });

        console.log(`Saved debug artifacts. Keys: '${key_base}_screenshot' (PNG), '${key_base}_html' (HTML).`);
    } catch (e: any) {
        console.error(`Failed to save debug artifacts for ${suffix}: ${e.message}`);
    }
}
