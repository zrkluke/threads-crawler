import html
from typing import Any, override
from urllib.parse import quote

import httpx
from apify import Actor
from camoufox import AsyncNewBrowser
from crawlee import ConcurrencySettings, Request
from crawlee.browsers import BrowserPool, PlaywrightBrowserController, PlaywrightBrowserPlugin
from crawlee.crawlers import PlaywrightCrawler, PlaywrightPreNavCrawlingContext

from .routes import router

THREADS_BASE_URL = "https://www.threads.com"
RECENT_SEARCH_DEFAULT_RELATIVE_DATE = "7 days"
SEARCH_FILTER_BY_SORT = {
    "top": None,
    "latest": "recent",
    "profiles": "profiles",
}
ZH_TW_CONTEXT_OPTIONS = {
    "locale": "zh-TW",
    "timezone_id": "Asia/Taipei",
    "extra_http_headers": {
        "Accept-Language": "zh-TW,zh;q=0.9,en-US;q=0.6,en;q=0.4",
    },
}


def _split_bulk(value: str | None, *, split_spaces: bool = False) -> list[str]:
    if not value:
        return []

    normalized = value.replace(",", "\n").replace("\t", "\n")
    if split_spaces:
        normalized = normalized.replace(" ", "\n")
    return [item.strip() for item in normalized.splitlines() if item.strip()]


def _dedupe(values: list[str]) -> list[str]:
    seen: set[str] = set()
    deduped: list[str] = []

    for value in values:
        key = value.lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(value)

    return deduped


def _normalize_account(value: str) -> str:
    return value.strip().removeprefix("@").strip("/")


def _normalize_tag(value: str) -> str:
    return value.strip().removeprefix("#").strip("/")


def _urls_from_request_list(items: list[dict[str, str]] | None) -> list[str]:
    return [item["url"] for item in items or [] if item.get("url")]


def _build_search_url(keyword: str, search_sort: str) -> str:
    url = f"{THREADS_BASE_URL}/search?q={quote(keyword)}&serp_type=default"
    search_filter = SEARCH_FILTER_BY_SORT.get(search_sort)
    if search_filter:
        url = f"{url}&filter={search_filter}"
    return url


def _build_requests(actor_input: dict[str, Any]) -> list[Request]:
    mode = actor_input.get("mode", "profile")
    max_posts_per_account = min(int(actor_input.get("maxPostsPerAccount") or actor_input.get("maxItems") or 10), 100)
    search_sort = actor_input.get("searchSort", "latest")
    explicit_post_language_filter = actor_input.get("postLanguageFilter", actor_input.get("languageFilter"))
    default_post_language_filter = "traditionalChinese" if mode in {"search", "tag"} else "any"
    post_language_filter = explicit_post_language_filter or default_post_language_filter
    relative_date = actor_input.get("relativeDate")
    if (
        mode in {"search", "tag"}
        and not relative_date
        and not actor_input.get("startDate")
        and not actor_input.get("endDate")
    ):
        relative_date = RECENT_SEARCH_DEFAULT_RELATIVE_DATE
    common_user_data = {
        "mode": mode,
        "startDate": actor_input.get("startDate"),
        "endDate": actor_input.get("endDate"),
        "relativeDate": relative_date,
        "postLanguageFilter": post_language_filter,
        "includeRawText": bool(actor_input.get("includeRawText")),
        "searchSort": search_sort,
        "maxPostsPerAccount": max_posts_per_account,
    }

    requests: list[Request] = []

    if mode == "profile":
        accounts = list(actor_input.get("accounts") or []) + _split_bulk(
            actor_input.get("bulkAccounts"), split_spaces=True
        )
        for account in _dedupe([_normalize_account(value) for value in accounts if value]):
            requests.append(
                Request.from_url(
                    f"{THREADS_BASE_URL}/@{account}",
                    user_data={**common_user_data, "target": account},
                )
            )

    elif mode == "tag":
        tags = list(actor_input.get("keywordsOrTags") or []) + _split_bulk(actor_input.get("bulkKeywordsOrTags"))
        for tag in _dedupe([_normalize_tag(value) for value in tags if value]):
            requests.append(
                Request.from_url(
                    f"{THREADS_BASE_URL}/search?q={quote(tag)}&serp_type=tags",
                    user_data={**common_user_data, "target": tag},
                )
            )

    elif mode == "search":
        keywords = list(actor_input.get("keywordsOrTags") or []) + _split_bulk(actor_input.get("bulkKeywordsOrTags"))
        for keyword in _dedupe([value.strip() for value in keywords if value.strip()]):
            requests.append(
                Request.from_url(
                    _build_search_url(keyword, search_sort),
                    user_data={**common_user_data, "target": keyword},
                )
            )

    elif mode == "thread":
        for url in _dedupe(_urls_from_request_list(actor_input.get("threadUrls"))):
            requests.append(Request.from_url(url, user_data={**common_user_data, "target": url}))

    elif mode == "feed":
        for url in _dedupe(_urls_from_request_list(actor_input.get("feedUrls"))):
            requests.append(Request.from_url(url, user_data={**common_user_data, "target": url}))

    return requests


class CamoufoxPlugin(PlaywrightBrowserPlugin):
    """Browser plugin that uses Camoufox Browser, but otherwise keeps the functionality of PlaywrightBrowserPlugin."""

    @override
    async def new_browser(self) -> PlaywrightBrowserController:
        if not self._playwright:
            raise RuntimeError("Playwright browser plugin is not initialized.")

        return PlaywrightBrowserController(
            browser=await AsyncNewBrowser(self._playwright, headless=True),
            max_open_pages_per_browser=1,  #  Increase, if camoufox can handle it in your use case.
            header_generator=None,  #  This turns off the crawlee header_generation. Camoufox has its own.
        )


async def main() -> None:
    """Define a main entry point for the Apify Actor.

    This coroutine is executed using `asyncio.run()`, so it must remain an asynchronous function for proper execution.
    Asynchronous execution is required for communication with Apify platform, and it also enhances performance in
    the field of web scraping significantly.
    """
    # Enter the context of the Actor.
    async with Actor:
        # Retrieve the Actor input, and use default values if not provided.
        actor_input = await Actor.get_input() or {}
        requests = _build_requests(actor_input)

        # Exit if no start URLs are provided.
        if not requests:
            Actor.log.info("No crawl targets specified in Actor input, exiting...")
            await Actor.exit()

        # Create a crawler.
        crawler = PlaywrightCrawler(
            # Limit the crawl to max requests. Remove or increase it for crawling all links.
            max_requests_per_crawl=len(requests),
            concurrency_settings=ConcurrencySettings(
                min_concurrency=1,
                max_concurrency=1,
                desired_concurrency=1,
            ),
            browser_pool=BrowserPool(plugins=[CamoufoxPlugin(browser_new_context_options=ZH_TW_CONTEXT_OPTIONS)]),
            # Set the request handler to the request router defined in routes.py.
            request_handler=router,
        )

        @crawler.pre_navigation_hook
        async def block_static_assets(context: PlaywrightPreNavCrawlingContext) -> None:
            await context.block_requests()

        # Run the crawler with the starting requests.
        await crawler.run(requests)

        # Send Telegram notifications if configured
        telegram_token = actor_input.get("telegramToken")
        telegram_chat_id = actor_input.get("telegramChatId")

        if telegram_token and telegram_chat_id:
            await _send_telegram_notifications(telegram_token, telegram_chat_id)


async def _send_telegram_notifications(token: str, chat_id: str) -> None:
    Actor.log.info("Fetching scraped items from dataset for Telegram notification...")
    try:
        dataset = await Actor.open_dataset()
        results = await dataset.get_data()
        items = results.items

        if not items:
            Actor.log.info("No items found in dataset to send.")
            return

        messages = []
        current_message = "🤖 <b>Threads Crawler Report</b>\n\n"

        for item in items:
            mode = item.get("mode", "unknown")
            target = item.get("target", "unknown")
            posts = item.get("posts", [])

            target_header = f"📋 <b>Mode: {html.escape(mode)} | Target: {html.escape(target)}</b>\n"
            if not posts:
                target_header += "No posts found.\n\n"
                if len(current_message) + len(target_header) > 4000:
                    messages.append(current_message)
                    current_message = target_header
                else:
                    current_message += target_header
                continue

            if len(current_message) + len(target_header) > 4000:
                messages.append(current_message)
                current_message = target_header
            else:
                current_message += target_header

            for post in posts:
                author = post.get("author", target)
                posted_at = post.get("posted_at", "")
                post_text = post.get("text", "").strip()
                post_url = post.get("post_url")
                metrics = post.get("metrics", {})

                likes = metrics.get("likes", "0")
                replies = metrics.get("replies", "0")
                reposts = metrics.get("reposts", "0")

                post_str = f"👤 <b>@{html.escape(author)}</b>"
                if posted_at:
                    post_str += f" ({html.escape(posted_at)})"
                post_str += "\n"

                snippet = html.escape(post_text[:300]) + "..." if len(post_text) > 300 else html.escape(post_text)
                post_str += f"{snippet}\n"

                post_str += f"👍 {likes} | 💬 {replies} | 🔁 {reposts}\n"
                if post_url:
                    post_str += f'🔗 <a href="{html.escape(post_url)}">View Post</a>\n'
                post_str += "\n"

                if len(current_message) + len(post_str) > 4000:
                    messages.append(current_message)
                    current_message = post_str
                else:
                    current_message += post_str

        if current_message.strip():
            messages.append(current_message)

        # Send messages via Telegram API
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        async with httpx.AsyncClient() as client:
            for i, msg in enumerate(messages):
                Actor.log.info(f"Sending Telegram message {i + 1}/{len(messages)}...")
                payload = {
                    "chat_id": chat_id,
                    "text": msg,
                    "parse_mode": "HTML",
                    "disable_web_page_preview": True,
                }
                response = await client.post(url, json=payload, timeout=10.0)
                if response.is_error:
                    Actor.log.error(f"Failed to send Telegram message: {response.status_code} {response.text}")
                else:
                    Actor.log.info(f"Telegram message {i + 1} sent successfully.")

    except Exception as e:
        Actor.log.exception(f"Failed to send Telegram notifications: {e}")
