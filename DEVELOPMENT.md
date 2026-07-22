# Threads Crawler — Development Guide (Node.js Edition)

This file captures project-specific architecture knowledge, debugging workflows, and Node.js specific setups.

**Always read this file before making changes to `src/routes.ts`.**

---

## Architecture Overview

The crawler uses a **dual-path parsing strategy** to extract posts.

### Path 1: Text Parsing (`_parse_posts` in `src/routes.ts`)
- Source: `body.innerText()` — the raw visible text of the full page.
- Extracts posts by recognizing structural patterns in the text:
  author → time → content → metrics (likes/replies/reposts/shares).
- **Advantage**: Simple, fast, no DOM dependency.
- **Failure mode**: Breaks silently when Threads changes UI labels or text layout.

### Path 2: DOM Parsing (`_extract_dom_posts` in `src/routes.ts`)
- Source: `page.evaluate(...)` — JavaScript executed in the browser context.
- Finds post URLs by querying `a[href]` elements matching the Threads post URL pattern, then walks up the DOM tree to extract the surrounding card text.
- **Advantage**: Captures `post_url` which the text path cannot.
- **Failure mode**: Breaks when Threads changes DOM structure or CSS classes.

### Merge Strategy
In all modes (`profile`, `search`, `tag`, `thread`, `feed`), both paths run when text and DOM posts exist, and results are merged (`_merge_text_posts_with_dom_posts`), matching by author + timestamp + fuzzy text similarity to enrich text-path posts with their `post_url`.

---

## Parsing Rules — Critical Details

### Stop Markers (`GLOBAL_STOP_MARKERS`)
The parser stops consuming lines when it hits a stop marker.
Both English AND Chinese variants must be present to prevent login-wall text leaking.
Current markers are:
* "Log in"
* "Log in or sign up for Threads"
* "登入或註冊 Threads"
* "登入"
* "登录或注册 Threads"
* "登录"

### Profile Tab Labels (`PROFILE_TABS`)
`{"Threads", "Replies", "Media", "Reposts", "串文", "影音內容", "轉發"}` — Marks the boundary between profile header and post list.

---

## Setup & Running

### Installation
Ensure Node.js (version 18 or 20+) is installed. Run:
```bash
npm install
npx camoufox-js fetch
```

### Running the Crawler Locally
```bash
apify run
```

### Running Tests
```bash
# Run unit tests on static fixtures
npm test

# Run live integration test on live website
npm run test:live
```

---

## Testing Structure

```
tests/
├── fixtures/                          # Real captured Threads page body text
│   └── largitdata_profile_body.txt    # Captured @largitdata profile page text
├── routes.test.ts                     # Jest/Vitest unit tests for routes.ts
└── live.test.ts                       # Jest/Vitest integration test for live website
```
