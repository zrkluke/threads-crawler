# Threads Crawler — Development Guide

This file is intended for **AI agents and developers** working on this project.
It captures project-specific architecture knowledge, debugging workflows, and
known issues that are NOT covered in the general `AGENTS.md`.

**Always read this file before making changes to `my_actor/routes.py`.**

---

## Architecture Overview

The crawler uses a **dual-path parsing strategy** to extract posts. Understanding
why both paths exist is critical to debugging extraction failures.

### Path 1: Text Parsing (`_parse_posts` in `routes.py`)
- Source: `body.inner_text()` — the raw visible text of the full page
- Extracts posts by recognising structural patterns in the text:
  author → time → content → metrics (likes/replies/reposts/shares)
- **Advantage**: Simple, fast, no DOM dependency
- **Failure mode**: Breaks silently when Threads changes UI labels or text layout

### Path 2: DOM Parsing (`_extract_dom_posts` in `routes.py`)
- Source: `page.evaluate(...)` — JavaScript executed in the browser context
- Finds post URLs by querying `a[href]` elements matching the Threads post URL pattern,
  then walks up the DOM tree to extract the surrounding card text
- **Advantage**: Captures `post_url` which the text path cannot
- **Failure mode**: Breaks when Threads changes DOM structure or CSS classes

### Merge Strategy
In `profile` mode, both paths run and results are merged
(`_merge_text_posts_with_dom_posts`), matching by author + timestamp + text
similarity to enrich text-path posts with their `post_url`.

In `search` / `tag` / `thread` / `feed` modes, only the DOM path is used.

---

## Parsing Rules — Critical Details

### Stop Markers (`GLOBAL_STOP_MARKERS`)
The parser stops consuming lines when it hits a stop marker.
**Both English AND Chinese variants must be present.** Missing a Chinese variant
causes login-wall text to leak into the last post's content.

Current markers to maintain:
```python
# English
"Log in"
"Log in or sign up for Threads"
"Log in to see more from {username}."

# Traditional Chinese (zh-TW)
"登入或註冊 Threads查看人們談論的主題，並加入對話。"
"登入或註冊 Threads"
"登入"
"登入以查看更多來自{username}的內容。"   # per-account, added dynamically

# Simplified Chinese (zh-CN)
"登录或注册 Threads"
"登录"
"登录以查看更多来自{username}的内容。"   # per-account, added dynamically
```

> **Lesson learned (2026-06-13):** The original code only had English stop markers.
> The zh-TW login wall text `"登入以查看更多來自largitdata的內容。"` leaked into
> the last parsed post's text. A snapshot test using a real fixture caught this.

### Translate Markers (`TRANSLATE_MARKERS`)
`{"Translate", "翻譯", "翻译"}` — Threads inserts a "Translate" button after posts.
The parser skips these lines so they don't pollute post content.

### Profile Tab Labels (`PROFILE_TABS`)
`{"Threads", "Replies", "Media", "Reposts", "串文", "影音內容", "轉發"}` — These
mark the boundary between the profile header and the post list. The parser uses
the last tab label to find where posts begin.

---

## Known Dependency Issues

### Playwright 1.60.0 crashes with Camoufox
**Symptom:** `TypeError: Cannot read properties of undefined (reading 'url')`
in `FFBrowserContext`, followed by `BrowserContext.cookies: Connection closed`.
The actor exits with code 91.

**Root cause:** Playwright 1.60.0 introduced a regression where the Firefox
driver crashes when a page fires an `uncaughtError` event without a `location`
field. Camoufox (a custom Firefox build) triggers this during navigation.

**Fix:** Pin `playwright < 1.60.0` in `requirements.txt`.
Check https://github.com/microsoft/playwright/issues/41169 for upstream fix status.
Once a patched version is released, the pin can be relaxed.

---

## Debugging Workflow

### Step 1 — The crawler ran but produced 0 posts

First check the Apify Key-Value Store for debug artifacts. The `default_handler`
automatically saves a screenshot and HTML dump when `posts` is empty:

- Key: `DEBUG_{path_slug}_posts_empty_screenshot` → PNG screenshot of the page
- Key: `DEBUG_{path_slug}_posts_empty_html` → Full HTML source

Locally: check `storage/key_value_stores/default/` for files matching `DEBUG_*`.

Common causes visible in the screenshot/HTML:
| What you see | Cause |
|---|---|
| Login page / Instagram sign-in prompt | Threads is requiring auth; crawler has no session |
| Cloudflare challenge / CAPTCHA | IP blocked or bot detection triggered |
| Blank/empty page | Page did not load in time; increase `wait_for_timeout` |
| Normal-looking page | Parsing logic broke; continue to Step 2 |

### Step 2 — Page loaded correctly but parser extracted wrong/empty data

Re-run with `"includeRawText": true` in the Actor input. The dataset output will
include a `raw_visible_text` field.

Use it to write a regression test **without opening a browser**:

```bash
# 1. Save the raw_visible_text to a fixture file
#    (copy from storage/datasets/default/000000001.json)
# 2. Create tests/fixtures/<account>_<page>_body.txt

# 3. Write a failing test in tests/test_routes.py that reproduces the bug
# 4. Fix routes.py until the test passes
# 5. Commit both the fixture and the fix together
python -m pytest tests/test_routes.py -v
```

### Step 3 — post_url is missing from results

`post_url` comes exclusively from the DOM path (`_extract_dom_posts`).
The text path cannot produce it.

If `post_url` is consistently `None`:
- The JS `evaluate()` block is failing to find matching `a[href]` elements
- Check the `postUrlPattern` regex in `_extract_dom_posts` — Threads may have
  changed its URL structure (e.g. `threads.com` vs `threads.net`)
- Inspect the saved HTML (Step 1) to verify the DOM structure

### Step 4 — Replies scraping fails but profile/posts are fine

Replies are scraped by navigating to `/@{username}/replies` in the same browser
session. This is wrapped in `try/except` so a failure here does **not** discard
the already-scraped profile and posts data.

Check `DEBUG_*replies_failed*` keys in the Key-Value Store for a screenshot/HTML
of the replies page at the time of failure.

---

## Testing

### Running Tests
```bash
# Requires .venv to be set up (see below)
.venv/Scripts/python.exe -m pytest tests/ -v

# Full verification (lint + type check + tests)
powershell -ExecutionPolicy Bypass -File scripts/verify.ps1
```

### Setting Up the Virtual Environment
```bash
py -3.12 -m venv .venv
.venv/Scripts/pip.exe install -r requirements.txt -r requirements-dev.txt
```

### Test Structure

```
tests/
├── fixtures/                          # Real captured Threads page body text
│   └── largitdata_profile_body.txt    # Captured 2026-06-13 from @largitdata
└── test_routes.py                     # Snapshot + unit tests for routes.py
```

**Snapshot tests** (top of `test_routes.py`) use real fixture data and verify
that the parser extracts the expected values. These catch regressions in parsing
logic and also serve as runnable documentation of what Threads pages actually look
like.

**Unit tests** (bottom of `test_routes.py`) test individual parsing rules in
isolation (time format detection, metric line detection, language filters, etc.).

### Updating Fixtures After a Threads Layout Change

When Threads changes their page format and the crawler output looks wrong:

1. Run the actor with `"includeRawText": true`
2. Copy `raw_visible_text` from the dataset output to a new fixture file:
   `tests/fixtures/<account>_<page>_body.txt`
3. Write a **failing** test that reproduces the wrong behaviour
4. Fix `routes.py` until the test passes
5. Commit: fixture file + code fix + updated/new test together

> The fixture files represent "ground truth" snapshots of what Threads actually
> sends. Keeping them in git means any team member (or AI agent) can reproduce
> a past parsing failure without access to the live site.

---

## Input Modes Quick Reference

| `mode` | Target field | URL pattern | Notes |
|---|---|---|---|
| `profile` | `accounts` / `bulkAccounts` | `/@{username}` | Also scrapes `/replies` page |
| `tag` | `keywordsOrTags` / `bulkKeywordsOrTags` | `/search?q={tag}&serp_type=tags` | |
| `search` | `keywordsOrTags` / `bulkKeywordsOrTags` | `/search?q={kw}&serp_type=default` | `searchSort=profiles` returns profiles, not posts |
| `thread` | `threadUrls` | full post URL | Scrapes a single post and its replies |
| `feed` | `feedUrls` | any Threads URL | Generic fallback mode |

---

## Local Development Checklist

- [ ] `.venv` created with Python 3.12 (`py -3.12 -m venv .venv`)
- [ ] Dependencies installed (`pip install -r requirements.txt -r requirements-dev.txt`)
- [ ] `storage/key_value_stores/default/INPUT.json` contains test input
- [ ] `apify run` → check `storage/datasets/default/` for output
- [ ] `pytest` passes before committing

> **Reminder:** `storage/` is in `.gitignore`. Data from local runs is never
> committed. Only `tests/fixtures/` (hand-curated snapshots) is committed.
