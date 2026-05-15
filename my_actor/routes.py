"""Module defines the router and request handlers for the crawler."""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta

from apify import Actor
from crawlee.crawlers import PlaywrightCrawlingContext
from crawlee.router import Router

router = Router[PlaywrightCrawlingContext]()

PROFILE_TABS = {'Threads', 'Replies', 'Media', 'Reposts'}
GLOBAL_STOP_MARKERS = {
    'Log in',
    'Log in or sign up for Threads',
    'See what people are talking about and join the conversation.',
}
NON_AUTHOR_LINES = {
    *PROFILE_TABS,
    'Follow',
    'Following',
    'Mention',
    'Search',
    'Top',
    'Latest',
    'For you',
    'Translate',
    'Threads',
    'Post',
    'Reply',
    'Repost',
    'Share',
    'Like',
    'View',
    'More',
}


def _clean_lines(text: str) -> list[str]:
    return [line.strip() for line in text.splitlines() if line.strip()]


def _looks_like_post_time(value: str) -> bool:
    normalized = value.strip().lower()
    return (
        bool(re.fullmatch(r'\d+\s*[smhdw]', normalized))
        or bool(re.fullmatch(r'\d{1,2}/\d{1,2}/\d{2,4}', normalized))
        or bool(re.fullmatch(r'\d{4}-\d{1,2}-\d{1,2}', normalized))
        or normalized in {'now', 'yesterday'}
    )


def _is_metric_line(value: str) -> bool:
    return bool(re.fullmatch(r'[\d,.]+\s*[KMB]?', value.strip(), flags=re.IGNORECASE))


def _looks_like_author(value: str) -> bool:
    normalized = value.strip()
    if not normalized or normalized in NON_AUTHOR_LINES:
        return False
    if normalized in GLOBAL_STOP_MARKERS:
        return False
    if _looks_like_post_time(normalized) or _is_metric_line(normalized):
        return False
    return len(normalized) <= 80


def _parse_relative_datetime(value: str, scraped_at: datetime) -> str | None:
    normalized = value.strip().lower()
    if normalized == 'now':
        return scraped_at.isoformat()
    if normalized == 'yesterday':
        return (scraped_at - timedelta(days=1)).isoformat()

    for date_format in ('%m/%d/%y', '%m/%d/%Y', '%Y-%m-%d'):
        try:
            return datetime.strptime(normalized, date_format).replace(tzinfo=UTC).isoformat()
        except ValueError:
            pass

    match = re.fullmatch(r'(\d+)\s*([smhdw])', normalized)
    if not match:
        return None

    amount = int(match.group(1))
    unit = match.group(2)
    delta_by_unit = {
        's': timedelta(seconds=amount),
        'm': timedelta(minutes=amount),
        'h': timedelta(hours=amount),
        'd': timedelta(days=amount),
        'w': timedelta(weeks=amount),
    }
    return (scraped_at - delta_by_unit[unit]).isoformat()


def _parse_relative_window(value: str | None, scraped_at: datetime) -> datetime | None:
    if not value:
        return None

    match = re.search(r'(\d+)\s*(second|minute|hour|day|week|month|year|秒|分鐘|小時|天|日|週|周|月|年)s?', value.lower())
    if not match:
        return None

    amount = int(match.group(1))
    unit = match.group(2)
    if unit in {'second', '秒'}:
        delta = timedelta(seconds=amount)
    elif unit in {'minute', '分鐘'}:
        delta = timedelta(minutes=amount)
    elif unit in {'hour', '小時'}:
        delta = timedelta(hours=amount)
    elif unit in {'day', '天', '日'}:
        delta = timedelta(days=amount)
    elif unit in {'week', '週', '周'}:
        delta = timedelta(weeks=amount)
    elif unit in {'month', '月'}:
        delta = timedelta(days=amount * 30)
    else:
        delta = timedelta(days=amount * 365)

    return scraped_at - delta


def _parse_date(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None

    try:
        return datetime.fromisoformat(value).replace(tzinfo=UTC)
    except ValueError:
        return None


def _is_in_date_range(posted_at_iso: str | None, user_data: dict, scraped_at: datetime) -> bool:
    if not posted_at_iso:
        return True

    posted_at = datetime.fromisoformat(posted_at_iso)
    start_date = _parse_date(user_data.get('startDate'))
    end_date = _parse_date(user_data.get('endDate'))
    relative_start = _parse_relative_window(user_data.get('relativeDate'), scraped_at)

    if relative_start and posted_at < relative_start:
        return False
    if start_date and posted_at < start_date:
        return False
    if end_date and posted_at > end_date + timedelta(days=1):
        return False
    return True


def _parse_visible_metrics(values: list[str]) -> dict[str, object]:
    padded = values + [None] * (6 - len(values))
    return {
        'likes': padded[0],
        'replies': padded[1],
        'reposts': padded[2],
        'shares': padded[3],
        'views': padded[4],
        'quotes': padded[5],
        'raw': values,
    }


def _parse_profile(lines: list[str]) -> dict[str, str | None]:
    username = lines[0] if lines else None
    profile = {
        'username': username,
        'display_name': None,
        'bio': None,
        'external_url': None,
        'followers': None,
    }

    if not username:
        return profile

    content_start = 0
    for index, line in enumerate(lines):
        if line in PROFILE_TABS:
            content_start = index + 1
            break

    header_lines = lines[:content_start]
    repeated_username_count = 0
    bio_lines: list[str] = []

    for line in header_lines:
        if line == username:
            repeated_username_count += 1
            if repeated_username_count == 2:
                profile['display_name'] = line
            continue
        if line.endswith('followers'):
            profile['followers'] = line
            continue
        if '.' in line and ' ' not in line and not profile['external_url']:
            profile['external_url'] = line
            continue
        if line not in {'Follow', 'Mention', *PROFILE_TABS}:
            bio_lines.append(line)

    profile['bio'] = '\n'.join(bio_lines) or None
    return profile


def _find_post_start(lines: list[str], index: int, username: str | None, profile_only: bool) -> tuple[str, str, int] | None:
    if index >= len(lines) or not _looks_like_author(lines[index]):
        return None
    if profile_only and lines[index] != username:
        return None

    if index + 1 < len(lines) and _looks_like_post_time(lines[index + 1]):
        return lines[index], lines[index + 1], index + 2

    has_display_name = (
        not profile_only
        and index + 2 < len(lines)
        and _looks_like_author(lines[index + 1])
        and _looks_like_post_time(lines[index + 2])
    )
    if has_display_name:
        return lines[index], lines[index + 2], index + 3

    return None


def _parse_posts(lines: list[str], username: str | None, user_data: dict, scraped_at: datetime) -> list[dict[str, object]]:
    max_posts = int(user_data.get('maxPostsPerAccount') or 10)
    mode = user_data.get('mode')
    profile_only = mode == 'profile' and bool(username)

    try:
        start = max(lines.index(tab) for tab in PROFILE_TABS if tab in lines) + 1
    except ValueError:
        start = 0

    stop_markers = set(GLOBAL_STOP_MARKERS)
    if username:
        stop_markers.add(f'Log in to see more from {username}.')

    posts: list[dict[str, object]] = []
    index = start
    while index < len(lines):
        if lines[index] in stop_markers:
            break

        post_start = _find_post_start(lines, index, username, profile_only)
        if not post_start:
            index += 1
            continue

        author, posted_at, index = post_start

        content_lines: list[str] = []
        while index < len(lines) and lines[index] != 'Translate':
            if _find_post_start(lines, index, username, profile_only) and content_lines:
                break
            if lines[index] in stop_markers:
                break
            content_lines.append(lines[index])
            index += 1

        if index < len(lines) and lines[index] == 'Translate':
            index += 1

        metrics: list[str] = []
        while index < len(lines):
            if _find_post_start(lines, index, username, profile_only) or lines[index] in stop_markers:
                break
            if _is_metric_line(lines[index]):
                metrics.append(lines[index])
            index += 1

        trailing_metrics: list[str] = []
        while content_lines and _is_metric_line(content_lines[-1]):
            trailing_metrics.insert(0, content_lines.pop())
        metrics = trailing_metrics + metrics

        posted_at_iso = _parse_relative_datetime(posted_at, scraped_at)
        if _is_in_date_range(posted_at_iso, user_data, scraped_at):
            posts.append(
                {
                    'author': author,
                    'posted_at': posted_at,
                    'posted_at_iso': posted_at_iso,
                    'text': '\n'.join(content_lines),
                    'metrics': _parse_visible_metrics(metrics),
                }
            )
            if len(posts) >= max_posts:
                break

    return posts


async def _extract_post_urls(context: PlaywrightCrawlingContext) -> list[str]:
    post_urls = await context.page.evaluate(
        r"""() => {
            const urls = Array.from(document.querySelectorAll('a[href]'))
                .map((element) => {
                    try {
                        return new URL(element.getAttribute('href'), window.location.origin).href;
                    } catch {
                        return null;
                    }
                })
                .filter((url) => url && /^https:\/\/(www\.)?threads\.(com|net)\/@[^/]+\/post\/[^/?#]+/.test(url))
                .map((url) => url.replace(/[?#].*$/, ''));

            return Array.from(new Set(urls));
        }"""
    )
    return [url for url in post_urls if isinstance(url, str)]


async def _extract_profile_results(context: PlaywrightCrawlingContext) -> list[dict[str, str | None]]:
    profiles = await context.page.evaluate(
        r"""() => {
            const byUrl = new Map();
            for (const element of document.querySelectorAll('a[href]')) {
                let url;
                try {
                    url = new URL(element.getAttribute('href'), window.location.origin);
                } catch {
                    continue;
                }

                if (!/^https:\/\/(www\.)?threads\.(com|net)$/.test(url.origin)) {
                    continue;
                }
                if (!/^\/@[^/]+\/?$/.test(url.pathname)) {
                    continue;
                }

                const profileUrl = `${url.origin}${url.pathname.replace(/\/$/, '')}`;
                const username = url.pathname.replace(/^\/@/, '').replace(/\/$/, '');
                const text = (element.innerText || element.getAttribute('aria-label') || '').trim();
                if (!byUrl.has(profileUrl)) {
                    byUrl.set(profileUrl, { username, url: profileUrl, text: text || null });
                }
            }

            return Array.from(byUrl.values());
        }"""
    )
    return [
        profile
        for profile in profiles
        if isinstance(profile, dict) and isinstance(profile.get('url'), str)
    ]


def _attach_post_urls(posts: list[dict[str, object]], post_urls: list[str]) -> None:
    for post, post_url in zip(posts, post_urls, strict=False):
        post['post_url'] = post_url


def _empty_profile() -> dict[str, str | None]:
    return {
        'username': None,
        'display_name': None,
        'bio': None,
        'external_url': None,
        'followers': None,
    }


@router.default_handler
async def default_handler(context: PlaywrightCrawlingContext) -> None:
    """Handle each request by extracting visible Threads profile data."""
    url = context.request.url
    Actor.log.info(f'Scraping {url}...')
    user_data = dict(context.request.user_data)
    scraped_at = datetime.now(UTC)

    await context.page.wait_for_load_state('domcontentloaded')
    await context.page.wait_for_timeout(8_000)

    body_text = await context.page.locator('body').inner_text()
    lines = _clean_lines(body_text)
    if user_data.get('mode') == 'profile':
        profile = _parse_profile(lines)
    else:
        profile = _empty_profile()
    if user_data.get('mode') == 'search' and user_data.get('searchSort') == 'profiles':
        posts = []
    else:
        posts = _parse_posts(lines, profile['username'], user_data, scraped_at)
    post_urls = await _extract_post_urls(context)
    _attach_post_urls(posts, post_urls)

    data = {
        'url': context.request.url,
        'mode': user_data.get('mode'),
        'target': user_data.get('target'),
        'scraped_at': scraped_at.isoformat(),
        'title': await context.page.title(),
        'profile': profile,
        'posts': posts,
    }

    if user_data.get('mode') == 'search' and user_data.get('searchSort') == 'profiles':
        data['profiles'] = await _extract_profile_results(context)

    if user_data.get('includeRawText'):
        data['raw_visible_text'] = body_text

    await context.push_data(data)
