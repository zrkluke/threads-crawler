"""Module defines the router and request handlers for the crawler."""

from __future__ import annotations

from apify import Actor
from crawlee.crawlers import PlaywrightCrawlingContext
from crawlee.router import Router

router = Router[PlaywrightCrawlingContext]()


def _clean_lines(text: str) -> list[str]:
    return [line.strip() for line in text.splitlines() if line.strip()]


def _looks_like_post_time(value: str) -> bool:
    return value.endswith(('s', 'm', 'h', 'd', 'w')) or value in {'now', 'yesterday'}


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


def _parse_posts(lines: list[str], username: str | None) -> list[dict[str, object]]:
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

        posts.append(
            {
                'author': author,
                'posted_at': posted_at,
                'text': '\n'.join(content_lines),
                'visible_metrics': metrics,
            }
        )

    return posts


@router.default_handler
async def default_handler(context: PlaywrightCrawlingContext) -> None:
    """Handle each request by extracting visible Threads profile data."""
    url = context.request.url
    Actor.log.info(f'Scraping {url}...')

    await context.page.wait_for_load_state('domcontentloaded')
    await context.page.wait_for_timeout(8_000)

    body_text = await context.page.locator('body').inner_text()
    lines = _clean_lines(body_text)
    profile = _parse_profile(lines)

    data = {
        'url': context.request.url,
        'title': await context.page.title(),
        'profile': profile,
        'posts': _parse_posts(lines, profile['username']),
        'raw_visible_text': body_text,
    }

    await context.push_data(data)
