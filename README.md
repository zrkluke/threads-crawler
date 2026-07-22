# Threads Crawler

An Apify Actor for scraping Threads pages with Node.js (JavaScript ESM), Crawlee, Playwright, and Camoufox.

The Actor is designed for local development and Apify deployment. It loads dynamic Threads pages in a Camoufox browser, extracts visible profile and post data, and stores structured results in an Apify dataset. It also supports optional session cookie injection to bypass login walls and crawl personalized "For you" feeds.

The browser context defaults to Traditional Chinese / Taiwan signals (`zh-TW`, `Asia/Taipei`, and `Accept-Language: zh-TW`) so Threads search is closer to a Traditional Chinese browsing session.

## Features

- Crawl publicly visible Threads profile pages.
- Batch crawl up to 100 accounts in one run.
- Support Session Cookies to bypass login walls and crawl personalized recommended feeds ("For you" wall).
- Support five crawl modes:
  - Profile pages by username.
  - Tag / topic pages.
  - Keyword search pages.
  - Single thread / post URLs, including replies.
  - Custom Threads feed URLs (defaults to Threads home recommended feed).
- Support username input with or without `@`.
- Support tags with or without `#`.
- Support bulk paste fields for accounts and keywords.
- Support relative date windows such as `7 days`, `1 month`, `24 hours`, `7 天`, or `1 個月`.
- Limit returned posts per account or target with `maxPostsPerAccount`.
- Support absolute `startDate` and `endDate` filters.
- Extract profile metadata when visible:
  - username
  - display name
  - bio
  - external URL
  - follower count
- Extract post data:
  - author
  - relative timestamp
  - best-effort ISO timestamp
  - post text (expanded to complete text automatically)
  - `post_url`
  - visible metrics
- Send clean Telegram reports (without metrics and emojis, showing full text).
- Daily live monitor integration test via GitHub Actions to detect Threads layout changes.

## Session Cookies (Authentication)

To crawl personalized feeds or bypass login walls:
1. Log in to Threads in your browser (e.g., Chrome).
2. Use an extension like `EditThisCookie` or `Cookie-Editor` to export your cookies as a **JSON array**.
3. Paste the JSON array into the `Session cookies` (`cookies`) input field in your Apify Console (or inside your local `INPUT.json`).
4. Set the mode to `feed` and leave the feed URLs empty to crawl your personal recommended feed.

Your cookies are encrypted on Apify and stay private to your run session.

## Input

The Actor input is configured in `.actor/input_schema.json`.

### `mode`

Choose what to crawl:

```json
"profile"
```

Supported values:

- `profile`
- `tag`
- `search`
- `thread`
- `feed`

### Profile Mode

Use `accounts` for structured input:

```json
{
  "mode": "profile",
  "accounts": ["largitdata"],
  "maxPostsPerAccount": 10
}
```

Or use `bulkAccounts`:

```json
{
  "mode": "profile",
  "bulkAccounts": "largitdata\nopenai\nmeta",
  "maxPostsPerAccount": 10
}
```

### Tag / Topic Mode

```json
{
  "mode": "tag",
  "keywordsOrTags": ["AI", "MachineLearning"],
  "maxPostsPerAccount": 10
}
```

### Keyword Search Mode

```json
{
  "mode": "search",
  "keywordsOrTags": ["AI agent", "Crawlee"],
  "searchSort": "latest",
  "maxPostsPerAccount": 10
}
```

`searchSort` maps to Threads search tabs:

- `top` -> `serp_type=default`
- `latest` -> `serp_type=default&filter=recent`
- `profiles` -> `serp_type=default&filter=profiles` and returns profile search results in `profiles`

### Single Thread Mode

```json
{
  "mode": "thread",
  "threadUrls": [
    {
      "url": "https://www.threads.com/@largitdata/post/POST_ID"
    }
  ],
  "maxPostsPerAccount": 10
}
```

### Custom Feed Mode

```json
{
  "mode": "feed",
  "cookies": [ /* JSON cookies from EditThisCookie */ ],
  "maxPostsPerAccount": 10
}
```

*Note: Leaving `feedUrls` empty in `feed` mode will automatically crawl the Threads home feed.*

### Date Filters

```json
{
  "mode": "profile",
  "accounts": ["largitdata"],
  "relativeDate": "7 days"
}
```

You can also use absolute dates:

```json
{
  "mode": "profile",
  "accounts": ["largitdata"],
  "startDate": "2026-05-01",
  "endDate": "2026-05-12"
}
```

Date filtering is best-effort because public Threads pages often expose only relative timestamps.

For `search` and `tag` modes, the Actor defaults to `"relativeDate": "7 days"` when no date filter is provided, so Recent search results do not include old posts that Threads mixes into the page.

### Post Language Filter

By default, extracted posts are filtered to Traditional Chinese after Threads returns the page. This is not a Threads URL parameter.

```json
{
  "mode": "search",
  "keywordsOrTags": ["claude code"],
  "postLanguageFilter": "traditionalChinese"
}
```

Use `"postLanguageFilter": "any"` to keep posts in any language.

## Output

Each dataset item represents one crawled target.

Example shape:

```json
{
  "url": "https://www.threads.com/@largitdata",
  "mode": "profile",
  "target": "largitdata",
  "scraped_at": "2026-05-12T06:44:40.405672+00:00",
  "title": "@largitdata • Threads, Say more",
  "profile": {
    "username": "largitdata",
    "display_name": "largitdata",
    "bio": "...",
    "external_url": "largitdata.com",
    "followers": "4,847 followers"
  },
  "posts": [
    {
      "author": "largitdata",
      "posted_at": "15h",
      "posted_at_iso": "2026-05-11T15:44:40.405672+00:00",
      "post_url": "https://www.threads.com/@largitdata/post/POST_ID",
      "text": "...",
      "metrics": {
        "likes": "10",
        "replies": "1",
        "reposts": "1",
        "shares": "2",
        "views": null,
        "quotes": null,
        "raw": ["10", "1", "1", "2"]
      }
    }
  ]
}
```

Example n8n expression for the latest post URL:

```js
{{ $json.posts?.[0]?.post_url }}
```

## Local Development

Install the Apify CLI:

```bash
npm install -g apify-cli
```

Install dependencies and fetch the Camoufox Firefox binary:

```bash
npm install
npx camoufox-js fetch
```

Run locally:

```bash
apify run
```

Run tests:

```bash
# Run unit tests on static body fixtures
npm test

# Run live layout integration test
npm run test:live
```

Local test input is stored in:

```text
storage/key_value_stores/default/INPUT.json
```

Local dataset output is stored in:

```text
storage/datasets/default/
```

The `storage/` directory is ignored by Git.

## Deploy to Apify

This project is intended to be deployed from GitHub.

1. Push changes to GitHub.
2. Open Apify Console.
3. Create or open the Actor.
4. Link the GitHub repository.
5. Build the Actor from the `main` branch.

You can also deploy directly with:

```bash
apify login
apify push
```

## Tech Stack

- Apify SDK for JavaScript
- Crawlee for JavaScript (Playwright)
- Playwright
- Camoufox-js
- Node.js 22+
