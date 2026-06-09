from typing import Any, override
from urllib.parse import quote

from apify import Actor
from camoufox import AsyncNewBrowser
from crawlee import Request
from crawlee.browsers import BrowserPool, PlaywrightBrowserController, PlaywrightBrowserPlugin
from crawlee.crawlers import PlaywrightCrawler

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
            browser_pool=BrowserPool(plugins=[CamoufoxPlugin(browser_new_context_options=ZH_TW_CONTEXT_OPTIONS)]),
            # Set the request handler to the request router defined in routes.py.
            request_handler=router,
        )

        # Run the crawler with the starting requests.
        await crawler.run(requests)
