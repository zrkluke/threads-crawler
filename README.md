# Threads Crawler

An Apify Actor for scraping publicly visible Threads pages with Python, Crawlee, Playwright, and Camoufox.

The Actor is designed for local development and Apify deployment through GitHub. It loads dynamic Threads pages in a Camoufox browser, extracts visible profile and post data, and stores structured results in an Apify dataset.

## Features

- Crawl publicly visible Threads profile pages.
- Batch crawl up to 100 accounts in one run.
- Support five crawl modes:
  - Profile pages by username.
  - Tag / topic pages.
  - Keyword search pages.
  - Single thread / post URLs, including publicly visible replies.
  - Custom Threads feed URLs.
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
- Extract visible post data:
  - author
  - relative timestamp
  - best-effort ISO timestamp
  - post text
  - `post_url` when Threads exposes a public post link in the page
  - visible metrics
- Optional raw visible text output for parser debugging.

## Important Limitations

This Actor does not log in to Threads and does not use a private API token. It only extracts data that Threads renders publicly in the browser.

Because of that:

- Full historical posts may not be available. Threads can show `Log in to see more`.
- Replies are only extracted when they are publicly visible on the loaded page.
- Engagement fields depend on what the public page exposes.
- `likes`, `replies`, `reposts`, `shares`, `views`, and `quotes` are best-effort mappings from visible metric numbers.
- Some metrics may be `null` if Threads does not expose them publicly.
- ISO timestamps are estimated from relative timestamps such as `12h`, `1d`, or `3w` using the scrape time.
- Post URLs are extracted best-effort from public page links. If Threads hides or changes those links, `posts[].post_url` can be empty.
- Permanent IDs and deeper media metadata may require additional parser work.
- Threads page structure can change, which may require selector/parser updates.
- Camoufox reduces common automation fingerprints, but it does not guarantee access or bypass platform limits.

Use this Actor only for public data and make sure your usage complies with applicable laws, Threads terms, and Apify platform rules.

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
  "searchSort": "top",
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
  "feedUrls": [
    {
      "url": "https://www.threads.com/"
    }
  ],
  "maxPostsPerAccount": 10
}
```

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

Create and activate a Python virtual environment:

```bash
python -m venv .venv
.venv\Scripts\activate
```

Install dependencies:

```bash
python -m pip install -r requirements.txt
```

Run locally:

```bash
apify run --purge
```

Local test input is stored in:

```text
storage/key_value_stores/default/INPUT.json
```

Local dataset output is stored in:

```text
storage/datasets/default/
```

The `storage/` and `.venv/` directories are ignored by Git.

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

GitHub deployment is recommended because it keeps version history and makes future parser updates easier to review.

## Tech Stack

- Apify Python SDK
- Crawlee for Python
- Playwright
- Camoufox
- Python 3.12+

## Notes for Future Improvements

- Add deeper scrolling for profiles and feed pages.
- Improve single-thread reply parsing.
- Extract stable post URLs and IDs.
- Map metric numbers to labels more reliably by inspecting DOM structure.
- Add optional authenticated session support for private internal use cases.
- Add tests around parser behavior using saved page text fixtures.
