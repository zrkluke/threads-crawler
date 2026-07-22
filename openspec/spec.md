# OpenSpec Specification: Threads Crawler Core Refactoring & Quality Enhancement

## Document Status
- **Status**: Complete
- **Target Version**: 1.1.0
- **Goal**: Resolve performance bottlenecks, misclassifications, security leaks, and magic delays identified by code-review-roasted audit. All spec items verified.

---

## Technical Specifications & Action Items

### Spec-1: Correct Traditional / Simplified Chinese Marker Set
- **Location**: [src/routes.ts](file:///c:/PythonSideProjects/Apify爬蟲/threads-crawler/src/routes.ts#L43-L45)
- **Problem**: `SIMPLIFIED_CHINESE_MARKERS` accidentally contained Traditional Chinese characters (e.g. `說`, `這`, `對`, `開`, `時`, `問題`), causing legitimate Traditional Chinese posts containing these characters to be wrongly filtered out when `postLanguageFilter` is set to `traditionalChinese`.
- **Requirement**: Purge all Traditional Chinese characters from `SIMPLIFIED_CHINESE_MARKERS`, keeping strictly Simplified Chinese simplified glyphs.

### Spec-2: Optimize DOM Post Extraction & Eliminate $O(N \cdot D)$ DOM Cloning
- **Location**: [src/routes.ts](file:///c:/PythonSideProjects/Apify爬蟲/threads-crawler/src/routes.ts#L523-L610)
- **Problem**: `_extract_dom_posts` iterated over all links and performed up to 10 ancestor DOM cloning operations (`node.cloneNode(true)`) with inner selector queries per link, causing severe CPU spikes and browser lag on large pages.
- **Requirement**: Query container elements (such as `[role="article"]` or card wrapper elements) directly, matching post links inside cards efficiently without redundant recursive DOM cloning.

### Spec-3: Replace Magic `waitForTimeout(8000)` Delays with Smart Loading Rules
- **Location**: [src/main.ts](file:///c:/PythonSideProjects/Apify爬蟲/threads-crawler/src/main.ts#L362)
- **Problem**: Hardcoded `waitForTimeout(8000)` and `waitForTimeout(1000)` force the crawler to idle for 8+ seconds per page regardless of actual network or DOM render status.
- **Requirement**: Replace fixed 8-second sleeps with dynamic DOM locator waiting (e.g., waiting for post elements or `domcontentloaded`) with a smaller fallback timeout.

### Spec-4: Sanitize Sensitive Telegram Credentials in Exception Logging
- **Location**: [src/main.ts](file:///c:/PythonSideProjects/Apify爬蟲/threads-crawler/src/main.ts#L293)
- **Problem**: `_send_telegram_notifications` logged raw `e.message` or `e.stack` on network errors, potentially leaking the secret Telegram Bot Token URL parameters into standard output / Actor logs.
- **Requirement**: Mask the Telegram bot token in error log messages (replace token with `***`).

### Spec-5: Normalize Threads Base Domain URL Configuration
- **Location**: [src/main.ts](file:///c:/PythonSideProjects/Apify爬蟲/threads-crawler/src/main.ts#L23)
- **Problem**: `THREADS_BASE_URL` was `https://www.threads.com`, whereas Threads canonical domain is `https://www.threads.net`. Mixed domain references cause unnecessary HTTP 301 redirects and cookie scope mismatches.
- **Requirement**: Standardize all canonical base URLs to `https://www.threads.net`.
