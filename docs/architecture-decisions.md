# 系統架構與技術決策紀錄 (Architecture Decision Records - ADR)

本文件紀錄 Threads 爬蟲專案的核心技術選型決策與背後原因，供未來的開發團隊與 AI 助理參考。

---

## ADR 1: 選擇 Playwright 作為網頁驅動引擎

### 狀態
已通過 (Accepted)

### 背景與問題 (Context)
Threads 是 Meta 旗下的社交平台，其網頁端為現代 Single Page Application (SPA)，且有極其嚴格的機器人流量阻擋與防爬蟲機制。我們需要決定使用何種技術獲取 Threads 的資料。

### 被評估的替代方案
1. **靜態 HTML 爬取 (如 Cheerio, Requests, BeautifulSoup)**：
   * *優點*：速度極快（省 CPU/記憶體），成本低。
   * *缺點*：無法執行 JavaScript。Threads 頁面在初始化時僅有空白的 React 框架載入碼，所有貼文均為非同步渲染。因此此方案**完全無法獲取資料**。
2. **其他瀏覽器自動化工具 (如 Selenium, Puppeteer)**：
   * *優點*：均支援 JS 渲染與 DOM 操作。
   * *缺點*：Selenium 執行速度較慢且配置繁瑣；Puppeteer 的 Python 生態系支援度不如 Playwright，且較難與特定的防偵測瀏覽器核心（如 Camoufox）進行原生整合。

### 決定原因 (Decision Drivers)
我們最終選擇 **Playwright (Python)**，基於以下原因：

1. **必須執行 JavaScript 渲染**：Threads 的貼文內容與互動數據（讚數、回覆數）皆是在前端經由 JS 非同步載入，必須透過 Playwright 啟動真實的無頭瀏覽器（Headless Browser）才能在 DOM 中渲染出可爬取的文字。
2. **與 Camoufox（防偵測瀏覽器）深度整合**：為了繞過 Threads 對於自動化工具的偵測，專案採用了 `camoufox` 瀏覽器核心。Camoufox 專門偽裝了瀏覽器特徵碼（Fingerprints），且其 Python API 是專門針對 Playwright 進行設計與封裝的，兩者必須搭配使用。
3. **複雜的 DOM 互動需求**：
   * **滾動加載 (Infinite Scroll)**：Threads 首頁與個人主頁採用無限滾動加載，需要 Playwright 來模擬滾動事件。
   * **點擊展開 (Expand Text)**：長貼文會被前端截斷，需要 Playwright 尋找「更多/顯示更多」按鈕並執行非同步點擊（`click()`），以展開完整內容。
4. **與 Crawlee 框架的相容性**：爬蟲基於 Crawlee 框架建置，該框架提供了開箱即用的 `PlaywrightCrawler`，在請求管理、自動重試與併發控制上非常成熟。

---

## ADR 2: 每日 GitHub Actions 活體測試監控

### 狀態
已通過 (Accepted)

### 背景與問題 (Context)
由於 Threads 沒有公開且穩定的 API，爬蟲必須解析前端網頁 DOM。Meta 頻繁更改其前端代碼混淆方式、類名（Class Names）與 URL 路由，導致爬蟲常在無預警的情況下失效。我們需要一種機制，能在爬蟲影響生產環境數據前，主動發現 Threads 的改版。

### 決定
引入每日執行的 GitHub Actions 活體整合測試（Live Integration Test）：
* 每天定時執行 `.github/workflows/live_check.yml`。
* 執行測試 `tests/test_live.py`，直接連線至線上的 Threads 個人主頁，測試解析邏輯與 URL 提取是否正常。
* **效益**：
  1. **零成本防禦**：免除資料庫與伺服器開銷，利用 GitHub Actions 免費額度。
  2. **主動警報**：一旦改版，GitHub 將主動發送郵件給開發者，縮短問題修復的反應時間。
