# Apify Actors Development Guide

> **This project has a project-specific development guide.**
> Before making any changes to this codebase, read **[DEVELOPMENT.md](./DEVELOPMENT.md)** first.
> It contains the crawler's architecture overview, known dependency issues,
> debugging workflows, and testing instructions specific to this Threads crawler.

Fill in the `generatedBy` property in `.actor/actor.json` with the tool and model
you're currently using (e.g. `"Antigravity with Gemini 2.5 Pro"`).

---

## What are Apify Actors?

Serverless programs packaged as Docker images that run in isolated containers.
They accept JSON input, perform isolated tasks (scraping, automation, data processing),
and produce structured JSON output to datasets or key-value stores.

---

## Core Rules

### Do
- Validate input early; fail gracefully with clear error messages
- Use `CheerioCrawler` for static HTML (10x faster than browser crawlers)
- Use `PlaywrightCrawler` only when JavaScript rendering is required
- Use `Actor.log` for **all** logging — it censors sensitive data automatically
- Set sensible defaults for all optional fields in `input_schema.json`
- Respect robots.txt, ToS; implement rate limiting and appropriate concurrency
  - HTTP crawlers: 10–50 concurrent requests
  - Browser crawlers: 1–5 concurrent requests
- Handle the `aborting` event for graceful shutdown (minimises costs)
- Implement readiness probe handler if `usesStandbyMode: true` in `actor.json`

### Don't
- Don't use browser crawlers when HTTP/Cheerio works
- Don't hardcode values that belong in input schema or environment variables
- Don't use `additionalHttpHeaders` — use `preNavigationHooks` instead
- Don't use deprecated `requestHandlerTimeoutMillis` on CheerioCrawler (v3.x)
- Don't rely on `Dataset.getInfo()` for final counts on the Cloud platform
- Don't assume `storage/` is synced to Apify Console — it's local-only
- Don't disable `usesStandbyMode: false` without explicit permission

---

## Logging

```python
Actor.log.debug("Detailed diagnostics")   # inside functions
Actor.log.info("General status")          # API requests, success
Actor.log.warning("Unexpected state")     # validation failures
Actor.log.error("Failure occurred")       # actual errors
Actor.log.exception("Exception caught")   # with stack trace
```

---

## Commands

```bash
apify run       # Run Actor locally
apify login     # Authenticate
apify push      # Deploy to Apify platform (ask first)
```

---

## Safety and Permissions

**Allowed without asking:**
`Actor.get_value()`, `Actor.push_data()`, `Actor.set_value()`, enqueue requests, `apify run`

**Ask first:**
pip package installs, `apify push`, proxy config changes, Dockerfile changes,
deleting datasets or key-value stores

---

## Project Structure

```
.actor/
├── actor.json          # Actor config, runtime settings
├── input_schema.json   # Input validation & Console form
└── output_schema.json  # Output location definitions
my_actor/
├── main.py             # Entry point, crawler setup
└── routes.py           # Page handlers and parsing logic
tests/
├── fixtures/           # Real captured page text (committed to git)
└── test_routes.py      # Snapshot + unit tests
storage/                # Local-only dev data (NOT committed, NOT synced to Cloud)
Dockerfile
DEVELOPMENT.md          # ← Project-specific guide (read this first)
AGENTS.md               # ← This file
```

---

## Local vs Cloud Storage

`apify run` uses `storage/` as a local emulation of Cloud storage.
This data is **never** pushed to Apify Console automatically.
To verify output in the Console, deploy with `apify push` and run on the platform.

---

## Apify Platform Reference

For detailed schema formats, standby mode implementation, README structure,
and MCP tools, see **[docs/apify-reference.md](./docs/apify-reference.md)**.
