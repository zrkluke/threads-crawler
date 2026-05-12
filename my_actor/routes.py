"""Module defines the router and request handlers for the crawler."""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta

from apify import Actor
from crawlee.crawlers import PlaywrightCrawlingContext
from crawlee.router import Router

router = Router[PlaywrightCrawlingContext]()


def _clean_lines(text: str) -> list[str]:
    return [line.strip() for line in text.splitlines() if line.strip()]


def _looks_like_post_time(value: str) -> bool:
    return value.endswith(('s', 'm', 'h', 'd', 'w')) or value in {'now', 'yesterday'}


def _parse_relative_datetime(value: str, scraped_at: datetime) -> str | None:
    normalized = value.strip().lower()
    if normalized == 'now':
        return scraped_at.isoformat()
    if normalized == 'yesterday':
        return (scraped_at - timedelta(days=1)).isoformat()

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
        if line in {'Threads', 'Replies', 'Media', 'Reposts'}:
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
        if line not in {'Follow', 'Mention', 'Threads', 'Replies', 'Media', 'Reposts'}:
            bio_lines.append(line)

    profile['bio'] = '\n'.join(bio_lines) or None
    return profile


def _parse_posts(lines: list[str], username: str | None, user_data: dict, scraped_at: datetime) -> list[dict[str, object]]:
    if not username:
        return []

    try:
        start = max(lines.index(tab) for tab in ('Threads', 'Replies', 'Media', 'Reposts') if tab in lines) + 1
    except ValueError:
        start = 0

    stop_markers = {
        f'Log in to see more from {username}.',
        'Log in',
        'Log in or sign up for Threads',
        'See what people are talking about and join the conversation.',
    }

    posts: list[dict[str, object]] = []
    index = start
    while index < len(lines):
        if lines[index] in stop_markers:
            break

        is_post_start = (
            lines[index] == username
            and index + 1 < len(lines)
            and _looks_like_post_time(lines[index + 1])
        )
        if not is_post_start:
            index += 1
            continue

        author = lines[index]
        posted_at = lines[index + 1]
        index += 2

        content_lines: list[str] = []
        while index < len(lines) and lines[index] != 'Translate':
            next_post_starts = (
                lines[index] == username
                and index + 1 < len(lines)
                and _looks_like_post_time(lines[index + 1])
            )
            if next_post_starts and content_lines:
                break
            if lines[index] in stop_markers:
                break
            content_lines.append(lines[index])
            index += 1

        if index < len(lines) and lines[index] == 'Translate':
            index += 1

        metrics: list[str] = []
        while index < len(lines):
            next_post_starts = (
                lines[index] == username
                and index + 1 < len(lines)
                and _looks_like_post_time(lines[index + 1])
            )
            if next_post_starts or lines[index] in stop_markers:
                break
            if lines[index].replace(',', '').isdigit():
                metrics.append(lines[index])
            index += 1

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

    return posts


async def _extract_media_urls(context: PlaywrightCrawlingContext) -> list[str]:
    media_urls = await context.page.evaluate(
        """() => Array.from(
            new Set([
                ...Array.from(document.querySelectorAll('img')).map((element) => element.currentSrc || element.src),
                ...Array.from(document.querySelectorAll('video')).map((element) => element.currentSrc || element.src),
                ...Array.from(document.querySelectorAll('source')).map((element) => element.src),
            ].filter(Boolean))
        )"""
    )
    return [url for url in media_urls if isinstance(url, str) and url.startswith('http')]


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
    profile = _parse_profile(lines)

    data = {
        'url': context.request.url,
        'mode': user_data.get('mode'),
        'target': user_data.get('target'),
        'scraped_at': scraped_at.isoformat(),
        'title': await context.page.title(),
        'profile': profile,
        'posts': _parse_posts(lines, profile['username'], user_data, scraped_at),
        'media_urls': await _extract_media_urls(context),
    }

    if user_data.get('includeRawText'):
        data['raw_visible_text'] = body_text

    await context.push_data(data)
