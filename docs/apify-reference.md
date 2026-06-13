# Apify Platform Reference

Detailed reference for Apify-specific schemas, configurations, and patterns.
Read this when you need to create or modify input/output schemas, dataset schemas,
key-value store schemas, standby mode, or README structure.

---

## Actor Input Schema

The input schema defines the input parameters for an Actor displayed in Apify Console.

### Structure

```json
{
    "title": "<INPUT-SCHEMA-TITLE>",
    "type": "object",
    "schemaVersion": 1,
    "properties": {
        /* define input fields here */
    },
    "required": []
}
```

### Example

```json
{
    "title": "E-commerce Product Scraper Input",
    "type": "object",
    "schemaVersion": 1,
    "properties": {
        "startUrls": {
            "title": "Start URLs",
            "type": "array",
            "description": "URLs to start scraping from",
            "editor": "requestListSources",
            "default": [{ "url": "https://example.com/category" }]
        },
        "maxRequestsPerCrawl": {
            "title": "Max Requests per Crawl",
            "type": "integer",
            "description": "Maximum number of pages to scrape (0 = unlimited)",
            "default": 1000,
            "minimum": 0
        },
        "proxyConfiguration": {
            "title": "Proxy Configuration",
            "type": "object",
            "description": "Proxy settings for anti-bot protection",
            "editor": "proxy",
            "default": { "useApifyProxy": false }
        },
        "locale": {
            "title": "Locale",
            "type": "string",
            "default": "cs",
            "enum": ["cs", "en", "de", "sk"],
            "enumTitles": ["Czech", "English", "German", "Slovak"]
        }
    },
    "required": ["startUrls"]
}
```

---

## Actor Output Schema

Specifies where an Actor stores its output. Used by Apify Console to display results.

### Structure

```json
{
    "actorOutputSchemaVersion": 1,
    "title": "<OUTPUT-SCHEMA-TITLE>",
    "properties": {
        "dataset": {
            "type": "string",
            "title": "Dataset",
            "template": "{{links.apiDefaultDatasetUrl}}/items"
        }
    }
}
```

### Template Variables

- `links.apiDefaultDatasetUrl` → `https://api.apify.com/v2/datasets/:id`
- `links.apiDefaultKeyValueStoreUrl` → `https://api.apify.com/v2/key-value-stores/:id`
- `links.publicRunUrl` → `https://console.apify.com/view/runs/:runId`
- `links.consoleRunUrl` → `https://console.apify.com/actors/runs/:runId`
- `links.containerRunUrl` → `https://<containerId>.runs.apify.net/`
- `run.defaultDatasetId`, `run.defaultKeyValueStoreId`

---

## Dataset Schema (`dataset_schema.json`)

Defines how output data is displayed in the Output tab in Apify Console.
Reference it in `.actor/actor.json` via `"storages": { "dataset": "./dataset_schema.json" }`.

### Structure

```json
{
    "actorSpecification": 1,
    "fields": {},
    "views": {
        "overview": {
            "title": "Overview",
            "transformation": {
                "fields": ["field1", "field2"],
                "unwind": [],
                "flatten": [],
                "omit": [],
                "limit": null,
                "desc": false
            },
            "display": {
                "component": "table",
                "properties": {
                    "field1": { "label": "Column Header", "format": "text" }
                }
            }
        }
    }
}
```

**Display formats:** `text` | `number` | `date` | `link` | `boolean` | `image` | `array` | `object`

---

## Key-Value Store Schema (`key_value_store_schema.json`)

Organises KV store keys into logical groups for display in Apify Console.
Reference it via `"storages": { "keyValueStore": "./key_value_store_schema.json" }`.

### Structure

```json
{
    "actorKeyValueStoreSchemaVersion": 1,
    "title": "Key-Value Store Schema",
    "collections": {
        "images": {
            "title": "Images",
            "description": "Images stored by the Actor",
            "keyPrefix": "image-",
            "contentTypes": ["image/jpeg"]
        },
        "config": {
            "title": "Config",
            "key": "CONFIG",
            "contentTypes": ["application/json"]
        }
    }
}
```

- Use `key` for a single specific key, `keyPrefix` for a group of keys (mutually exclusive).

---

## Graceful Abort Handling

Handle the `aborting` event to terminate quickly and minimise costs.

```python
import asyncio

async def on_aborting() -> None:
    await asyncio.sleep(1)  # allow Crawlee state persistence
    await Actor.exit()

Actor.on('aborting', on_aborting)
```

---

## Standby Mode

Check `.actor/actor.json` for `usesStandbyMode`. If `true`:
- **Never disable** without explicit permission
- **Always implement** the readiness probe handler

```python
from http.server import SimpleHTTPRequestHandler

class GetHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if 'x-apify-container-server-readiness-probe' in self.headers:
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'Readiness probe OK')
            return
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'Actor is ready')
```

---

## README Structure

**Always generate README.md** — it is the Actor's Apify Store landing page.

Include these sections in order:
1. **What does [Actor] do?** — what it extracts, link to target site, Apify advantages
2. **Why use [Actor]?** — business use cases
3. **How to use** — numbered step-by-step
4. **Input** — describe fields, reference the Input tab
5. **Output** — simplified JSON example, mention download formats
6. **Data table** — main output fields in a table
7. **Pricing / Cost estimation** — set expectations on cost
8. **Tips / Advanced options** — optimisation hints
9. **FAQ, disclaimers, support** — legality disclaimer, known limits, Issues link

Best practices:
- SEO-friendly headings (e.g. "How to scrape [site] data")
- Front-load the value proposition (first 25% matters most)
- Include a 1-2 item JSON output example
- Reference: [instagram-scraper](https://apify.com/apify/instagram-scraper), [crawler-google-places](https://apify.com/compass/crawler-google-places)

---

## MCP Tools (if configured)

- `search-apify-docs` — search documentation
- `fetch-apify-docs` — get full doc pages
- Otherwise: `@https://mcp.apify.com/`

## Full Documentation

- [docs.apify.com/llms.txt](https://docs.apify.com/llms.txt) — quick reference
- [docs.apify.com/llms-full.txt](https://docs.apify.com/llms-full.txt) — complete docs
- [crawlee.dev](https://crawlee.dev) — Crawlee documentation
- [whitepaper.actor](https://raw.githubusercontent.com/apify/actor-whitepaper/refs/heads/master/README.md) — complete Actor specification
