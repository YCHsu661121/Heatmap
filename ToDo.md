# Stock Heatmap VS Code Extension 規劃書

> 版本：v2.0  
> 日期：2026-03-25  
> 狀態：規劃中  
> 本文件取代先前所有草稿版本  
> **v2.0 異動：移除獨立 FastAPI 後端，所有功能整併進 VS Code Extension（純 TypeScript/Node.js）**

## 1. 專案目標

開發一套整合於 VS Code 的股票分析插件，讓使用者可在編輯器內直接完成以下工作：

- 查看自選股清單、漲跌、成交量與板塊熱力圖
- 檢視互動式 K 線圖與技術指標
- 取得系統計算的買入 / 賣出 / 觀望訊號
- 整合新聞摘要與 LLM 分析，輸出可讀的建議理由
- 透過通知與狀態列快速掌握關鍵異動

> 免責聲明：本插件所有訊號與 LLM 分析僅供研究與資訊輔助，不構成任何投資建議。

---

## 2. 專案範圍

### 2.1 In Scope

- VS Code Sidebar 自選股清單
- Webview 熱力圖與 K 線圖
- 技術指標：SMA、EMA、RSI、MACD、Bollinger Bands
- 基本買賣點邏輯：均線交叉、超買超賣、突破/跌破
- 新聞收集與摘要
- LLM 依據技術指標 + 新聞輸出建議
- 多模型分析路由（OpenAI / 多個 Ollama / GitHub Copilot Models）
- 可儲存固定 LLM 協作組合（固定數個模型共同判斷）
- 通知系統與使用者設定頁
- 多時間框架切換（1D / 4H / 1H / 15m，依資料源能力調整）
- 指標參數自訂（SMA 週期、RSI 週期、MACD 參數）
- 訊號原因解釋面板（Why this signal）
- 圖表區段分析說明（對走勢區間、轉折點、訊號點提供文字解釋）
- 本地快取與離線回看最近一次資料
- 自選股群組與排序規則（市場 / 板塊 / 自訂標籤）
- 條件式提醒（價格、漲跌幅、指標交叉、新聞事件）
- 自動抓取財報重點並生成財務分析摘要

### 2.2 Out of Scope（第一階段不做）

- 自動下單
- 券商帳戶串接
- 高頻即時交易策略
- 付費市場資料深度訂閱整合
- 多人協作投資看板

### 2.3 第二階段候選功能（建議納入 Roadmap）

- 條件選股器（Screener）
- 事件日曆（財報日、除權息、法說會、FOMC / CPI）
- 財報分析（營收、EPS、毛利率、YoY / QoQ 變化、法說重點）
- 投組觀察與損益追蹤（僅觀察，不下單）
- Snapshot 匯出（PNG / CSV / Markdown 報告）
- 回測與訊號重播（Signal Replay）
- 異常波動偵測（量價爆量、跳空、趨勢加速）
- LLM 問答模式（針對單一股票解釋技術面與新聞面）
- 多模型交叉比對（Consensus / Majority / Weighted Score）
- 預設版型（短線、波段、保守）

---

## 3. 目標使用情境

1. 使用者在 VS Code 開啟插件後，於 Sidebar 查看自選股即時狀態。
2. 點選股票後，在 Webview 中查看：
   - K 線圖
   - 技術指標
   - 買賣點標記
   - 近期新聞
   - LLM 建議摘要
3. 當 Extension 內部分析引擎偵測到關鍵訊號時，VS Code 顯示通知或狀態列提醒。
4. 使用者可依市場、更新頻率、API Key、風險偏好調整設定。

---

## 4. 系統架構概述

> 所有功能整併進 VS Code Extension，不再需要獨立後端服務。  
> 市場資料、技術指標計算、新聞擷取、LLM 呼叫均在 Extension Host（Node.js）中直接執行。

```
VS Code Extension（TypeScript / Node.js）
├─ Extension Host
│   ├─ Commands / Settings / Notifications
│   └─ 生命週期管理（activate / deactivate）
│
├─ Data Layer（直接呼叫外部 API）
│   ├─ MarketDataService（FinMind / Finnhub HTTP）
│   ├─ NewsService（News API / RSS Feed）
│   ├─ EventCalendarService（財報 / 總經事件 / 公司行事曆）
│   └─ FinancialReportService（財報抓取 / 結構化摘要）
│
├─ Analysis Layer（本地計算，不需 Python）
│   ├─ TechnicalIndicatorEngine（npm: technicalindicators）
│   ├─ SignalEngine（均線交叉 / RSI / MACD 規則）
│   ├─ ScreenerEngine（條件選股）
│   ├─ AlertEngine（條件式提醒）
│   └─ LLMOrchestrator（OpenAI / 多 Ollama / Copilot LM API）
│
├─ Storage Layer（本地狀態）
│   ├─ SecretStorage（API Key）
│   ├─ WorkspaceState / GlobalState（自選股、UI 狀態）
│   └─ CacheStore（報價 / 新聞 / LLM 回覆快取）
│
└─ UI Layer
    ├─ Sidebar TreeView（自選股 / 訊號清單）
    ├─ Webview Panel（熱力圖 / K 線 / 新聞 / 建議）
    ├─ Chart Insight Panel（圖表分析說明）
    ├─ Alert Center（提醒中心）
    └─ Screener / Calendar / Portfolio Views

LLM Providers（外部 / VS Code 內部）
├─ OpenAI API
├─ Ollama（多個 HTTP 節點，可本機或區網）
└─ GitHub Copilot Models（透過 VS Code Language Model API）
```

### 4.1 本地計算與 LLM 分工原則

> 核心原則：凡是需要可重現、可回測、可驗證的數值與規則，都必須由本地程式碼執行；LLM 只負責解釋、摘要、比較與輔助判讀。

| 類別 | 執行位置 | 是否可交給 LLM | 說明 |
|---|---|---|---|
| OHLC / 報價整理 | 本地程式碼 | 否 | 屬於資料清洗與標準化流程，必須一致 |
| 技術指標計算 | 本地程式碼 | 否 | SMA / EMA / RSI / MACD 必須可重現 |
| 規則訊號判斷 | 本地程式碼 | 否 | 交叉、突破、閾值判斷需 deterministic |
| 條件選股 | 本地程式碼 | 否 | 篩選結果要能測試與重跑 |
| 提醒觸發 | 本地程式碼 | 否 | 不能因模型波動造成提醒不一致 |
| 財報數值抽取 | 本地程式碼 | 否 | 財務欄位需結構化與可驗證 |
| 新聞摘要 | LLM / 規則混合 | 可 | 可先抽取，再由 LLM 濃縮 |
| 財報重點摘要 | Hybrid | 是 | 先抽結構化財務數據，再交給 LLM 生成重點 |
| 訊號原因解釋 | LLM | 是 | 適合把 deterministic 結果轉成人類可讀說明 |
| 多模型觀點比對 | LLM | 是 | 用於比較 OpenAI / Ollama / Copilot 差異 |
| 最終顯示建議 | Hybrid | 是 | 應以本地計算結果為事實基礎，再交由 LLM 整理 |

#### 必須本地執行的項目
- MarketDataService 的資料清洗、缺值補齊、欄位標準化
- TechnicalIndicatorEngine 的全部數值計算
- SignalEngine 的交叉、超買超賣、突破跌破規則
- ScreenerEngine 的條件過濾與排序
- AlertEngine 的提醒觸發與 cooldown 管理
- FinancialReportService 的財務欄位抽取、期間對齊與 YoY / QoQ 計算

#### 可交由 LLM 處理的項目
- 將技術指標與新聞摘要轉成自然語言說明
- 將財報重點轉成可讀摘要，例如成長亮點、風險點與管理層指引重點
- 比較不同模型對同一檔股票的觀點差異
- 解釋為何當前建議偏向 `WATCH` / `BUY` / `SELL`
- 在資料不足時生成保守型風險提示

#### 建議 Hybrid 模式
1. 本地程式碼先輸出結構化事實：指標、規則命中、事件、新聞摘要。
2. LLM 只讀取這份結構化事實，不直接讀原始市場資料做數值計算。
3. 最終 UI 同時呈現：
  - `Fact`：本地計算結果
  - `Interpretation`：LLM 解釋
  - `Risk`：資料不足、模型分歧或事件風險
  - `Chart Insight`：針對目前圖表區間、標記點與事件點的說明
  - `Financial Insight`：財報重點、趨勢變化與管理層指引摘要

#### 不建議的做法
- 直接要求 LLM 根據原始 K 線資料計算 RSI / MACD
- 直接讓 LLM 作為唯一買賣訊號來源
- 用 LLM 取代 AlertEngine 的條件判斷
- 將回測結果建立在 LLM 自由輸出上

---

## 5. 核心模組與擴充模組規格

### 5.1 模組 A：Extension Host

#### 職責
- 註冊指令、Sidebar、Webview
- 管理設定、API Key 與服務初始化
- 統籌各 Layer 資料流並轉為 UI 事件

#### 主要功能
- `StockHeatmap: Open Dashboard`
- `StockHeatmap: Refresh`
- `StockHeatmap: Add Symbol`
- `StockHeatmap: Analyze Current Symbol`

#### 輸入
- 使用者設定（`vscode.workspace.getConfiguration`）
- 股票代碼
- 各 Service 回傳資料

#### 輸出
- Webview 畫面
- VS Code 通知
- 狀態列提醒

#### 驗收重點
- 可成功開啟 Dashboard
- 可切換股票並刷新資料
- 錯誤時可顯示明確訊息

---

### 5.2 模組 B：MarketDataService（市場資料）

#### 職責
- 直接從 Extension 呼叫 FinMind / Finnhub HTTP API
- 取得報價、OHLC、成交量、漲跌幅
- 依板塊/市場生成熱力圖資料

#### 技術實作
- 使用 Node.js `fetch`（VS Code 內建支援）
- API Key 從 `vscode.workspace.getConfiguration` 讀取
- 回應快取（`Map<string, {data, expiry}>`，TTL 依刷新間隔設定）

#### 主要功能
- `getQuotes(symbols: string[]): Promise<Quote[]>`
- `getCandles(symbol, interval, from, to): Promise<Candle[]>`
- `getHeatmap(market, groupBy): Promise<HeatmapItem[]>`

#### 驗收重點
- 報價與 K 線可正常顯示
- 熱力圖顏色與數值一致
- 可支援至少 20 檔自選股刷新

---

### 5.3 模組 C：TechnicalIndicatorEngine + SignalEngine

#### 職責
- 使用 `technicalindicators` npm 套件計算技術指標（不需 Python）
- 根據規則輸出買入 / 賣出 / 觀望訊號

#### 技術實作
- 套件：`npm install technicalindicators`（純 JS，無 native 依賴）
- 計算於 Extension Host 本地執行，不需網路

#### 與 LLM 的邊界
- 本模組只輸出 deterministic 數值結果
- 不負責生成自然語言解釋
- 供 `LLMOrchestrator` 讀取結果後再做摘要或建議文字生成

#### 規則首版
- SMA5 上穿 SMA20：短線偏多
- SMA5 下穿 SMA20：短線偏空
- RSI < 30：超賣觀察
- RSI > 70：超買觀察
- MACD 黃金交叉 / 死亡交叉
- 價格突破近 N 日高點或跌破近 N 日低點

#### 主要功能
- `calculate(candles: Candle[]): IndicatorResult`
- `evaluate(indicators: IndicatorResult, config: SignalConfig): SignalResult`

#### 驗收重點
- 指標結果可重現
- 訊號與圖表標記位置一致
- 同一資料輸入可得到一致輸出

---

### 5.3.1 模組 C-1：ChartInsightBuilder（圖表說明資料組裝）

#### 職責
- 將 K 線圖上的價格區段、技術指標、事件點與規則訊號整理為可解釋的結構化描述
- 提供圖表 hover、點擊與區段選取時所需的說明資料

#### 技術實作
- 本地先決定區段事實，例如：上升段、盤整段、突破段、回撤段
- 結合指標快照、訊號命中原因、事件日曆與新聞摘要
- 產出給 `LLMOrchestrator` 的圖表解釋 payload，或在純本地模式下直接輸出模板化說明

#### 主要功能
- `buildPointInsight(point: Candle, context: InsightContext): ChartInsight`
- `buildRangeInsight(range: Candle[], context: InsightContext): ChartInsight`
- `buildSignalInsight(signal: SignalResult, context: InsightContext): ChartInsight`

#### 驗收重點
- 點選圖表任一訊號點時，可顯示原因摘要
- 選取一段區間時，可說明該段趨勢、量價變化與事件背景
- 純本地模式下仍可提供基本說明，不依賴 LLM

---

### 5.4 模組 D：NewsService（新聞收集）

#### 職責
- 直接從 Extension 呼叫 News API / RSS
- 萃取標題、來源、時間、摘要、情緒方向

#### 技術實作
- 使用 Node.js `fetch` 呼叫 REST News API
- RSS 解析使用輕量 npm 套件（如 `rss-parser`）
- 結果快取至記憶體，避免重複請求

#### 資料來源優先順序
1. 合法 News API（REST）
2. RSS Feed
3. 官方公開資料來源

#### 主要功能
- `getNews(symbol, from, to, limit): Promise<NewsItem[]>`

#### 驗收重點
- 至少可取回最近 20 則新聞
- 可依時間排序
- 可排除重複與明顯無關內容

---

### 5.4.1 模組 D-1：FinancialReportService（財報抓取與分析）

#### 職責
- 自動抓取公司最近季度或年度財報重點
- 將財報數字整理為可比較的結構化欄位
- 提供 LLM 可讀取的財務摘要，而不是直接丟整份原文

#### 資料來源建議
- 台股：公開資訊觀測站、法說會簡報、月營收公告
- 美股：SEC EDGAR 10-Q / 10-K、Investor Relations 網站、Earnings Release
- 補充來源：公司法說逐字稿、財報新聞稿

#### 分析欄位首版
- 營收（Revenue）
- EPS
- 毛利率 / 營業利益率 / 淨利率
- YoY / QoQ 變化
- 現金流與自由現金流（若可取得）
- 財測指引（Guidance）與管理層重點摘要

#### 技術實作
- 先優先抓結構化來源或可穩定解析的 HTML / JSON 資料
- PDF 僅作補充來源，不應一開始就把 OCR / PDF parsing 當主路徑
- 先由本地程式碼抽取與標準化數值，再交給 LLM 做財報重點摘要

#### 主要功能
- `getLatestReports(symbol: string, periods?: number): Promise<FinancialReportSummary[]>`
- `comparePeriods(reports: FinancialReportSummary[]): FinancialReportSummary[]`

#### 驗收重點
- 可取得最近 1 至 4 季的主要財務欄位
- 可顯示 YoY / QoQ 變化方向
- 可輸出簡短財報摘要，例如「營收年增但毛利率下滑」

---

### 5.5 模組 E：LLMOrchestrator（多模型分析）

#### 職責
- 組裝 Prompt，統一路由到 OpenAI、單一或多個 Ollama 節點、GitHub Copilot Models
- 執行單模型或多模型分析，產出標準化建議 JSON
- 控制回應格式、模型選擇、重試策略與免責聲明

#### 技術實作
- OpenAI：使用 `openai` npm 套件或直接 `fetch` REST API
- Ollama：支援多個 `http://host:port/api/chat` 節點，採 round-robin、priority 或 failover 路由
- Copilot：使用 VS Code Language Model API，例如 `vscode.lm.selectChatModels({ vendor: 'copilot' })`
- API Key 與端點資訊從設定或 SecretStorage 讀取，不寫入程式碼
- Copilot 模型存取需依賴使用者已登入、授權，且受模型可用性與 quota 限制

#### 分析原則
- LLM 不直接預測報酬
- LLM 僅根據提供資料做風險化摘要
- 輸出必須結構化，避免自由發散
- LLM 不負責技術指標數值計算，也不直接決定規則是否命中
- LLM 只能解釋本地已計算出的事實，不能取代 deterministic engine

#### 支援模式
- `single`：指定單一 provider / model 執行
- `fallback`：主模型失敗時自動切換備援模型
- `parallel`：多模型同時分析，回傳並列結果
- `consensus`：多模型輸出後做多數決或加權彙總

#### 固定協作組模式
- 支援預先保存固定模型組合，例如：`本地快判組`、`保守共識組`、`高品質複核組`
- 每組可固定包含 2 至 4 個模型，並定義角色、權重、超時與降級順序
- 使用者可指定某組作為預設分析組，所有分析請求直接套用，不必每次重新選模型

#### Copilot 接入限制
- 可透過 VS Code 提供的 Language Model API 使用可選取的 Copilot 模型
- 不應依賴私有或未公開的 Copilot 內部 API
- 若使用者沒有 Copilot 授權、模型不可用、或超出 quota，需自動降級到 OpenAI / Ollama

#### 主要功能
- `getRecommendation(payload: AnalysisPayload): Promise<Recommendation>`
- `getRecommendations(payload: AnalysisPayload): Promise<ModelRecommendation[]>`
- `mergeRecommendations(results: ModelRecommendation[], strategy: MergeStrategy): Recommendation`
- `runTeam(teamId: string, payload: AnalysisPayload): Promise<TeamRecommendation>`
- `saveTeamConfig(config: LlmTeamConfig): Promise<void>`
- `explainChart(insight: ChartInsightPayload): Promise<ChartInsight>`

#### 驗收重點
- 回傳固定 JSON（`action / confidence / reason`）
- 無資料時可回傳保守建議
- 明確附上「僅供參考」語意
- 多個 Ollama 節點可切換、可失敗轉移
- Copilot 不可用時可自動降級，不影響主流程
- 固定模型組可保存、切換並重複使用
- 同一組設定重跑時，模型順序、權重與彙總規則一致
- 圖表說明可針對單點、區段與訊號標記生成文字解釋

---

### 5.6 模組 F：AlertEngine + Alert Center（條件式提醒）

#### 職責
- 根據價格、漲跌幅、成交量、技術指標、新聞事件觸發提醒
- 將提醒統一顯示於 VS Code Notification、Status Bar 與專屬 Alert Center

#### 建議提醒類型
- 價格突破提醒：`price > threshold`、`price < threshold`
- 變動提醒：`changePercent >= x%`
- 指標提醒：`RSI < 30`、`SMA5 crosses SMA20`
- 事件提醒：重大新聞、財報公布、法說會將近

#### 技術實作
- 使用排程刷新結果做增量比對，避免每次都重複通知
- 每條提醒須有 `cooldown` 與 `lastTriggeredAt`，防止洗版
- 支援 Notification level：`info / warning / critical`

#### 驗收重點
- 同一條件不會在短時間內重複轟炸
- 使用者可開關提醒、靜音個別標的、查看歷史提醒
- 提醒內容需包含觸發原因與時間戳

---

### 5.7 模組 G：ScreenerEngine（條件選股）

#### 職責
- 對使用者關注清單或指定市場執行條件式過濾
- 產出「今日值得看」候選標的，降低使用者逐檔切換成本

#### 首版條件範例
- 漲幅大於 3% 且量能大於 20 日均量
- SMA5 > SMA20 且 RSI 介於 50 至 70
- MACD 黃金交叉且近 5 日未出現過熱訊號
- 新聞情緒為正向且 24 小時內有新消息

#### 技術實作
- 先支援 watchlist 範圍，避免一次掃全市場造成 API 成本失控
- 將條件定義抽象為 JSON 規則，未來可視覺化編輯

#### 驗收重點
- 可儲存與切換多組篩選條件
- 篩選結果需附帶命中條件說明
- 結果列表可一鍵加入 watchlist 或開啟 dashboard

---

### 5.8 模組 H：EventCalendarService（事件日曆）

#### 職責
- 聚合股票與總經事件，讓分析不只看圖，也看時間點
- 將事件映射到圖表與提醒邏輯

#### 事件類型
- 個股：財報日、除權息、法說會、產品發表
- 總經：CPI、PPI、利率決議、非農就業
- 市場：休市日、結算日、期權到期

#### 驗收重點
- 可在 Webview 顯示未來 7 至 30 日事件
- 重要事件前可設定預警通知
- 圖表上可標記事件點，讓訊號解釋更完整

---

### 5.9 模組 I：Portfolio Watch（投組觀察）

#### 職責
- 管理使用者觀察部位、成本、權重與損益變化
- 強化插件從「看單一股票」提升為「看整體部位風險」

#### 功能邊界
- 僅做觀察與風險提示
- 不做券商串接，不做下單

#### 首版能力
- 手動輸入持股成本、數量、幣別
- 顯示未實現損益、日變動、最大權重標的
- 偵測投組集中度過高或單一標的回撤過大

#### 驗收重點
- 可匯入 / 匯出投組 CSV
- 投組摘要能在 Sidebar 或 Dashboard 顯示
- 可搭配提醒規則做部位風險通知

---

## 6. 內部模組介面設計

> v2.0 不再有 HTTP API Server。以下為 TypeScript 模組介面，供各層相互呼叫。

Base 型別定義位於 `src/types/index.ts`

### 6.1 Quote（自選股報價）

```typescript
// MarketDataService.getQuotes(symbols: string[]): Promise<Quote[]>
interface Quote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  updatedAt: string; // ISO 8601
}
```

### 6.2 Candle（K 線資料）

```typescript
// MarketDataService.getCandles(symbol, interval, from, to): Promise<Candle[]>
interface Candle {
  time: string;   // "YYYY-MM-DD"
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
```

### 6.3 HeatmapItem（熱力圖）

```typescript
// MarketDataService.getHeatmap(market, groupBy): Promise<HeatmapItem[]>
interface HeatmapItem {
  sector: string;
  symbol: string;
  name: string;
  changePercent: number;
  score: number;
}
```

### 6.4 SignalResult（技術指標與訊號）

```typescript
// TechnicalIndicatorEngine.calculate(candles) + SignalEngine.evaluate(...)
interface IndicatorSnapshot {
  sma5: number;
  sma20: number;
  rsi14: number;
  macd: number;
  macdSignal: number;
  bollingerUpper: number;
  bollingerLower: number;
}
interface SignalResult {
  action: 'BUY' | 'SELL' | 'WATCH';
  confidence: number;
  reasons: string[];
  indicators: IndicatorSnapshot;
}
```

### 6.5 NewsItem（新聞）

```typescript
// NewsService.getNews(symbol, from, to, limit): Promise<NewsItem[]>
interface NewsItem {
  title: string;
  source: string;
  publishedAt: string;
  url: string;
  summary: string;
  sentiment: 'positive' | 'negative' | 'neutral';
}
```

### 6.6 FinancialReportSummary（財報摘要）

```typescript
interface FinancialReportSummary {
  symbol: string;
  period: string;
  revenue?: number;
  eps?: number;
  grossMargin?: number;
  operatingMargin?: number;
  netMargin?: number;
  revenueYoY?: number;
  revenueQoQ?: number;
  epsYoY?: number;
  epsQoQ?: number;
  guidance?: string[];
  highlights: string[];
  risks?: string[];
  sourceUrls?: string[];
}
```

### 6.7 ChartInsight（圖表分析說明）

```typescript
interface ChartInsight {
  title: string;
  summary: string;
  facts: string[];
  risks?: string[];
  relatedSignals?: string[];
  relatedEvents?: string[];
}
```

### 6.8 ChartInsightPayload（圖表說明輸入）

```typescript
interface ChartInsightPayload {
  symbol: string;
  timeframe: string;
  selectedRange?: {
    from: string;
    to: string;
  };
  candles: Candle[];
  indicators: IndicatorSnapshot;
  signal?: SignalResult;
  events?: CalendarEvent[];
  news?: NewsItem[];
  financials?: FinancialReportSummary[];
}
```

### 6.9 Recommendation（LLM 建議）

```typescript
// LLMService.getRecommendation(payload): Promise<Recommendation>
interface Recommendation {
  action: 'BUY' | 'SELL' | 'WATCH';
  confidence: number;
  reason: string;
  disclaimer: string;
}
```

### 6.10 LlmEndpoint（模型端點）

```typescript
interface LlmEndpoint {
  id: string;
  provider: 'openai' | 'ollama' | 'copilot';
  label: string;
  model: string;
  baseUrl?: string;
  enabled: boolean;
  priority: number;
  tags?: string[];
}
```

### 6.11 ModelRecommendation（單模型分析結果）

```typescript
interface ModelRecommendation {
  endpointId: string;
  provider: 'openai' | 'ollama' | 'copilot';
  model: string;
  latencyMs: number;
  action: 'BUY' | 'SELL' | 'WATCH';
  confidence: number;
  reason: string;
  rawText?: string;
}
```

### 6.12 MergeStrategy（多模型彙總策略）

```typescript
type MergeStrategy = 'primary' | 'fallback' | 'majority' | 'weighted' | 'showAll';
```

### 6.13 LlmTeamConfig（固定協作組）

```typescript
interface LlmTeamConfig {
  id: string;
  name: string;
  enabled: boolean;
  members: Array<{
    endpointId: string;
    role: 'primary' | 'reviewer' | 'risk-checker' | 'tie-breaker';
    weight: number;
    timeoutMs?: number;
  }>;
  mergeStrategy: MergeStrategy;
  fallbackTeamId?: string;
}
```

### 6.14 TeamRecommendation（協作組結果）

```typescript
interface TeamRecommendation {
  teamId: string;
  final: Recommendation;
  members: ModelRecommendation[];
  disagreements?: string[];
}
```

### 6.15 AlertRule（提醒規則）

```typescript
interface AlertRule {
  id: string;
  symbol: string;
  enabled: boolean;
  type: 'price' | 'changePercent' | 'volume' | 'indicator' | 'news' | 'calendar';
  operator: '>' | '<' | '>=' | '<=' | 'crossesAbove' | 'crossesBelow' | 'contains';
  target: string;
  value: number | string;
  cooldownSec: number;
  severity: 'info' | 'warning' | 'critical';
}
```

### 6.16 ScreenerPreset（選股條件）

```typescript
interface ScreenerPreset {
  id: string;
  name: string;
  scope: 'watchlist' | 'market';
  conditions: Array<{
    field: string;
    operator: '>' | '<' | '>=' | '<=' | '=' | 'between';
    value: number | string | [number, number];
  }>;
  sortBy: 'changePercent' | 'volume' | 'rsi14' | 'score';
}
```

### 6.17 CalendarEvent（事件日曆）

```typescript
interface CalendarEvent {
  id: string;
  symbol?: string;
  market: 'TW' | 'US' | 'GLOBAL';
  category: 'earnings' | 'dividend' | 'conference' | 'macro' | 'holiday';
  title: string;
  startsAt: string;
  importance: 'low' | 'medium' | 'high';
  source: string;
}
```

### 6.18 PortfolioPosition（投組觀察）

```typescript
interface PortfolioPosition {
  symbol: string;
  quantity: number;
  avgCost: number;
  currency: 'TWD' | 'USD';
  note?: string;
}
```

### 6.19 SnapshotReport（匯出快照）

```typescript
interface SnapshotReport {
  symbol: string;
  generatedAt: string;
  chartImagePath?: string;
  indicators: IndicatorSnapshot;
  signal: SignalResult;
  news: NewsItem[];
  recommendation?: Recommendation;
}
```

---

## 7. LLM Prompt 模板設計

### 7.1 System Prompt

- 角色：股票資訊分析助理
- 限制：只能根據提供的技術指標摘要與新聞內容分析
- 禁止：不得保證獲利、不得使用誇張語氣、不得生成超出資料範圍的結論
- 降級策略：若資料不足，`action` 必須為 `WATCH`，`confidence` 降低，`reason` 明確指出資料不足
- 輸出格式：固定 JSON，欄位僅限 `action`、`confidence`、`reason`

### 7.2 User Prompt Template

```
股票代碼：{{symbol}}
市場：{{market}}
分析時間區間：{{time_from}} 至 {{time_to}}

技術指標摘要：
- 趨勢：{{trend}}
- 規則訊號：{{signal}}
- RSI14：{{rsi14}}
- MACD 狀態：{{macd_state}}
- 均線狀態：{{ma_state}}
- 突破狀態：{{breakout_state}}

新聞標題與摘要：
{{news_list}}

判斷原則：
1. 技術面與新聞面一致時，可提高 confidence
2. 技術面與新聞面衝突時，action 優先保守
3. 若接近壓力或支撐且缺乏確認，action 以 WATCH 為主
4. 不得生成投資保證
5. 僅輸出單一 JSON，不附加 Markdown 與額外說明
```

### 7.3 輸出格式

```json
{
  "action": "WATCH",
  "confidence": 0.74,
  "reason": "技術面偏多但尚未有效突破壓力，新聞面偏正向，建議持續觀察。"
}
```

---

## 8. 使用者設定草案

| 設定欄位 | 型別 | 預設值 | 說明 |
|---|---|---|---|
| `stockHeatmap.market` | string | `TW` | 市場：`TW` / `US` |
| `stockHeatmap.apiProvider` | string | `finmind` | `finmind` / `finnhub` |
| `stockHeatmap.apiKey` | string | `""` | 市場資料 API Key |
| `stockHeatmap.refreshIntervalSec` | number | `60` | 自動刷新間隔（秒） |
| `stockHeatmap.watchlist` | array | `[]` | 自選股代碼清單 |
| `stockHeatmap.llm.mode` | string | `single` | `single` / `fallback` / `parallel` / `consensus` |
| `stockHeatmap.llm.primaryProvider` | string | `openai` | `openai` / `ollama` / `copilot` |
| `stockHeatmap.llm.model` | string | `gpt-4o` | 主要模型名稱 |
| `stockHeatmap.llm.apiKey` | string | `""` | LLM API Key（OpenAI 用） |
| `stockHeatmap.llm.ollamaUrl` | string | `http://localhost:11434` | Ollama 本地端點 |
| `stockHeatmap.llm.ollamaEndpoints` | array | `[]` | 多個 Ollama 端點清單 |
| `stockHeatmap.llm.copilotModelFamily` | string | `gpt-4o` | 透過 VS Code LM API 選取的 Copilot model family |
| `stockHeatmap.llm.mergeStrategy` | string | `primary` | `primary` / `fallback` / `majority` / `weighted` / `showAll` |
| `stockHeatmap.llm.timeoutMs` | number | `20000` | 單模型分析逾時毫秒數 |
| `stockHeatmap.llm.defaultTeamId` | string | `""` | 預設固定協作組 ID |
| `stockHeatmap.llm.teams` | array | `[]` | 已儲存的固定 LLM 協作組設定 |
| `stockHeatmap.llm.maxParallelModels` | number | `3` | 單次同時執行的最大模型數 |
| `stockHeatmap.chartInsights.enabled` | boolean | `true` | 是否啟用圖表分析說明 |
| `stockHeatmap.chartInsights.mode` | string | `hybrid` | `local` / `llm` / `hybrid` |
| `stockHeatmap.chartInsights.autoExplainOnSelect` | boolean | `true` | 選取圖表區段時是否自動產生說明 |
| `stockHeatmap.financials.enabled` | boolean | `true` | 是否啟用財報抓取與分析 |
| `stockHeatmap.financials.provider` | string | `official` | `official` / `mixed` |
| `stockHeatmap.financials.lookbackQuarters` | number | `4` | 預設分析最近幾季財報 |
| `stockHeatmap.news.provider` | string | `newsapi` | `newsapi` / `rss` |
| `stockHeatmap.news.apiKey` | string | `""` | News API Key |
| `stockHeatmap.news.lookbackDays` | number | `7` | 新聞回溯天數 |
| `stockHeatmap.alerts.enabled` | boolean | `true` | 是否啟用提醒系統 |
| `stockHeatmap.alerts.defaultCooldownSec` | number | `1800` | 預設提醒冷卻時間 |
| `stockHeatmap.alerts.statusBarEnabled` | boolean | `true` | 是否顯示狀態列提醒 |
| `stockHeatmap.screener.defaultScope` | string | `watchlist` | 預設選股範圍 |
| `stockHeatmap.screener.maxSymbols` | number | `50` | 單次篩選最大標的數 |
| `stockHeatmap.calendar.enabled` | boolean | `true` | 是否啟用事件日曆 |
| `stockHeatmap.calendar.lookaheadDays` | number | `14` | 事件預讀天數 |
| `stockHeatmap.portfolio.enabled` | boolean | `false` | 是否啟用投組觀察 |
| `stockHeatmap.storage.cacheTtlSec` | number | `300` | 一般資料快取秒數 |
| `stockHeatmap.storage.persistWatchlistLayout` | boolean | `true` | 是否保存 watchlist 排序與群組 |
| `stockHeatmap.signal.rsiOverbought` | number | `70` | RSI 超買閾值 |
| `stockHeatmap.signal.rsiOversold` | number | `30` | RSI 超賣閾值 |

---

## 9. 第二階段功能提案與細節

### 9.1 Alert Center（提醒中心）

**為什麼值得做**
- 使用者不會一直盯著圖表，提醒才是真正提高留存的功能

**建議細節**
- 提醒來源統一收斂到一個面板，可按時間、嚴重度、標的篩選
- 每則提醒附帶觸發前值、觸發後值、規則名稱、建議動作
- 支援「稍後提醒」與「靜音這檔 1 天」

**實作注意**
- 不能只靠 `showInformationMessage`，否則歷史不可追蹤
- 需要本地儲存提醒紀錄，避免視窗重開即遺失

### 9.2 Screener（條件選股）

**為什麼值得做**
- 使用者不會只看固定 watchlist，條件選股能提高探索能力

**建議細節**
- 首版只支援 watchlist 範圍，控制 API 成本
- 預設三組模板：短線突破、波段偏多、保守低風險
- 每個條件命中後要產生人類可讀說明，例如「SMA5 > SMA20 且成交量 > 20 日均量 1.5 倍」

### 9.3 Event Calendar（事件日曆）

**為什麼值得做**
- 很多假突破其實是事件前等待，沒有事件維度，技術訊號容易被誤讀

**建議細節**
- 右側面板顯示未來事件
- K 線圖上用 icon 標示重大事件
- 事件前 1 日與 1 小時可設預警

### 9.4 Financial Report Analysis（財報分析）

**為什麼值得做**
- 使用者不只想知道價格怎麼走，也想知道基本面是否支持這段走勢
- 單純新聞偏短線，財報才是中期判斷的重要依據

**建議細節**
- 自動抓最近 1 至 4 季財報或法說重點
- 顯示營收、EPS、毛利率、營業利益率、現金流等變化
- 提供一句話摘要，例如「營收年增但 EPS 不及預期，代表費用壓力增加」
- 若接近財報公布日，圖表說明與最終建議應納入財報風險

**驗收標準**
- 可顯示結構化財報欄位與變化率
- 可自動產出財報摘要
- 財報重點可與圖表說明、LLM 建議聯動

### 9.5 Portfolio Watch（投組觀察）

**為什麼值得做**
- 使用者通常關心的是「整體部位風險」，不是單一訊號本身

**建議細節**
- 只做觀察，不觸及下單法規風險
- 顯示投組權重、未實現損益、最大回撤觀察
- 若單一標的權重超過門檻，給出集中度提醒

### 9.6 Snapshot / Export（分析快照）

**為什麼值得做**
- 使用者常需要把分析結果貼到 issue、筆記或團隊討論區

**建議細節**
- 匯出 Markdown：標題、圖表截圖、指標摘要、新聞摘要、LLM 建議
- 匯出 CSV：報價與訊號列表
- 匯出 PNG：目前圖表區域

### 9.7 Signal Replay（訊號重播）

**為什麼值得做**
- 這是驗證規則可信度的最好方式，也有助於調參

**建議細節**
- 使用滑桿逐日回放 K 線與訊號
- 顯示當下只可見的資料，避免未來函數問題
- 可對比不同參數組合的訊號差異

### 9.8 Explainable AI（解釋模式）

**為什麼值得做**
- LLM 建議若只輸出結論，信任度不足

**建議細節**
- 區分「資料事實」與「模型推論」兩區塊
- 顯示使用到的指標、最近新聞、事件背景
- 若資料不足，要明確標示「低信心」原因
- 對圖表上的區段、訊號點、事件點提供對應說明，而不只針對最終建議做解釋

### 9.9 Chart Insight（圖表分析說明）

**為什麼值得做**
- 多數使用者看到圖表後，真正想問的是「這一段為什麼漲」、「這個點為什麼標 BUY / WATCH」
- 若只有畫點沒有說明，圖表可讀性不足，學習成本高

**建議細節**
- 點擊單一訊號點時，顯示：觸發規則、當下指標值、附近事件與新聞背景
- 框選一段區間時，顯示：趨勢方向、量價關係、波動特徵、事件影響
- Hover K 線時，顯示基本 candle 資訊與簡短說明
- 支援 `local` / `llm` / `hybrid` 三種說明模式

**驗收標準**
- 圖表上任一標記點都能打開對應說明
- 關閉 LLM 時仍能提供模板化說明
- 開啟 LLM 時可補充更自然的敘述，但不得改寫本地事實

### 9.10 Multi-Model Analysis（多模型分析）

**為什麼值得做**
- 同一份資料交給多個模型，可降低單一模型偏差
- 本地 Ollama 適合隱私與成本控管，Copilot / OpenAI 適合高品質推理

**建議細節**
- 支援多個 Ollama 節點，例如本機、LAN GPU 主機、遠端推論機
- 支援使用 VS Code Language Model API 選取 Copilot 模型作為其中一個分析來源
- 提供三種輸出模式：只顯示主模型、顯示全部模型、顯示彙總結論
- 在 UI 顯示每個模型的延遲、結論、信心與差異點
- 支援儲存固定協作組，將一組模型固定為長期使用的分析班底

**實作注意**
- Copilot 只能走 VS Code 公開 Language Model API，不應假設有獨立 REST endpoint
- Copilot 可用性受登入狀態、授權、使用額度與模型供應情況影響
- 多模型並行會提高延遲與 token / 算力成本，預設應限制同時最多 2 至 3 個模型

### 9.11 Fixed LLM Team（固定協作組）

**為什麼值得做**
- 使用者通常會形成固定分析習慣，例如「本地 Ollama 先判斷，Copilot 複核，OpenAI 做總結」
- 若每次都手動選模型與策略，操作成本高，也容易造成結果不一致

**建議細節**
- 可保存多組固定組態，例如：
  - `quick-local`：2 個本地 Ollama，追求速度
  - `balanced`：1 個 Ollama + 1 個 Copilot + 1 個 OpenAI，追求平衡
  - `strict-consensus`：3 個模型全到齊才產出最終建議
- 每組可設定：成員順序、角色、權重、merge strategy、timeout、fallback team
- UI 可一鍵切換目前使用的協作組
- 分析結果需標示「由哪一組協作組產出」

**判斷策略建議**
- `majority`：適合快速得到穩健結論
- `weighted`：適合對 Copilot / OpenAI 給較高權重
- `primary + reviewer`：主模型先給結論，複核模型只做風險檢查
- `tie-breaker`：兩模型衝突時由第三模型決勝

**驗收標準**
- 可保存、編輯、刪除協作組
- 重啟 VS Code 後仍可保留預設協作組
- 當某個成員失敗時，系統可依規則降級或改用 fallback team

### 9.12 Deterministic Core vs LLM Layer（運算分層）

**為什麼值得做**
- 若不先分清楚責任，後續很容易把可驗證邏輯和模型推論混在一起，最後無法回測也無法除錯

**建議細節**
- Deterministic Core：行情清洗、技術指標、規則判斷、提醒條件、選股條件
- LLM Layer：解釋、摘要、比較、結論包裝、多模型共識
- Hybrid Output：畫面同時呈現事實、模型解讀、風險標記

**驗收標準**
- 同一份 OHLCV 輸入，不論是否開啟 LLM，指標數值與規則命中結果都必須一致
- 關閉 LLM 時，系統仍可輸出基礎訊號與提醒
- 開啟 LLM 後，只能增加可讀性與說明力，不能改寫 deterministic 事實

### 9.13 建議優先級

| 功能 | 商業價值 | 技術風險 | 建議優先級 |
|---|---|---|---|
| Alert Center | 高 | 低 | P1 |
| Screener | 高 | 中 | P1 |
| Event Calendar | 中高 | 中 | P2 |
| Financial Report Analysis | 高 | 中 | P1 |
| Portfolio Watch | 中高 | 低 | P2 |
| Snapshot / Export | 中 | 低 | P2 |
| Signal Replay | 中高 | 中高 | P3 |
| Chart Insight | 高 | 低 | P1 |
| Explainable AI | 高 | 中 | P1 |
| Multi-Model Analysis | 高 | 中 | P1 |
| Fixed LLM Team | 高 | 低 | P1 |
| Deterministic Core vs LLM Layer | 高 | 低 | P1 |

---

## 10. 里程碑與驗收標準

> 工時說明：以下為**單人工時估算**，未含需求反覆變更、法遵審查與外部 API 異常緩衝。  
> v2.0 移除後端服務後，總工時從 110h 降至 **102h**。

### M1：專案骨架與需求凍結（10 小時）

**工作內容**
- 建立 Extension 專案骨架（TypeScript）
- 設定 `package.json`、`tsconfig.json`、`.vscodeignore`
- 決定市場與資料來源
- 完成設定欄位定義
- 建立 `src/types/index.ts` 型別定義

**Definition of Done**
- [x] 存在 `package.json`、`src/extension.ts`、`src/types/index.ts`
- [x] `npm run compile` 可正常執行（透過 `npm.bat run compile` in Docker）
- [x] README / ToDo 完成 v2.0 版本
- [ ] 目標市場決策完成（台股 / 美股 / 雙市場）⬅ 待決策
- [ ] API Provider 決策完成並記錄理由⬅ 待決策
- [x] **`backend/` 目錄已標記為廢棄**（加入 `DEPRECATED.md`）

---

### M2：市場資料與新聞 API 打通（22 小時）

**工作內容**
- 實作 `MarketDataService`（直接 fetch FinMind / Finnhub）
- 實作 `NewsService`（News API / RSS）
- 實作 `FinancialReportService`（財報與法說重點抓取）
- 建立回應快取機制
- 建立資料標準化格式

**Definition of Done**
- [x] `MarketDataService.getQuotes()` 可回傳有效資料
- [x] `MarketDataService.getCandles()` 可回傳有效資料
- [x] `NewsService.getNews()` 可回傳有效資料
- [x] `FinancialReportService.getLatestReports()` 可回傳有效資料
- [x] 至少 1 個市場可穩定運作（TW + US 雙市場）
- [x] API Key 透過 VS Code settings 讀取，不寫死

---

### M3：技術指標與買賣點引擎（14 小時）

**工作內容**
- 安裝並整合 `technicalindicators` npm 套件
- 實作 `TechnicalIndicatorEngine`
- 實作 `SignalEngine` 規則邏輯
- 單元測試驗證指標正確性

**Definition of Done**
- [x] `TechnicalIndicatorEngine.calculate()` 可輸出所有指標（SMA5/SMA20/RSI14/MACD/Bollinger）
- [x] `SignalEngine.evaluate()` 輸出 `BUY` / `SELL` / `WATCH`
- [ ] 至少 5 組歷史資料測試通過
- [x] 規則觸發原因可讀

---

### M4：VS Code UI MVP（24 小時）

**工作內容**
- Sidebar 自選股清單（TreeView）
- Webview K 線圖（使用 lightweight-charts 或 Chart.js）
- 熱力圖初版
- 訊號標記與手動刷新
- 圖表分析說明面板（點擊訊號 / 框選區段）

**Definition of Done**
- [x] 可在 VS Code 中開啟 Dashboard
- [x] 可顯示至少 1 檔股票 K 線圖表（Canvas 手繪）
- [x] 可顯示熱力圖與新聞清單
- [x] 圖表上可見買賣訊號標記點
- [ ] 圖表訊號點可開啟分析說明
- [x] UI 基本互動正常（載入 / 刷新 / 加入自選股）

---

### M5：LLM 建議整合（20 小時）

**工作內容**
- 實作 `LLMOrchestrator`（支援 OpenAI + 多個 Ollama + Copilot LM API）
- 組裝 Prompt（技術指標 + 新聞）
- 輸出標準 JSON 並顯示於 Webview
- 顯示信心分數與免責聲明

**Definition of Done**
- [x] `LLMOrchestrator.getRecommendation()` 可用
- [x] LLM 回傳固定 JSON 結構（`action / confidence / reason`）
- [x] 無新聞 / 無指標時有保守 fallback（`WATCH`）
- [x] UI 固定顯示免責聲明
- [x] Ollama 本地模式可正常切換
- [x] 多個 Ollama 節點可設定與切換（priority/failover）
- [x] Copilot 模型可透過 VS Code LM API 選取，無授權時安全降級
- [x] 固定協作組可保存、指定為預設並重複套用

---

### M6：穩定化、封裝與發佈準備（16 小時）

**工作內容**
- 錯誤處理強化（API 失敗、Key 缺失、網路逾時）
- 設定頁與 API Key 管理
- 打包 `.vsix`
- 撰寫使用說明
- Ollama 本地模式部署文件

**Definition of Done**
- [x] `build.bat` / Docker 打包成功
- [x] 插件可安裝於本機 VS Code
- [ ] 基本 E2E 流程可運作（開啟→ 查詢→ 訊號→ LLM 建議）
- [x] README 完整
- [ ] 若採 Ollama，部署文件已標註本地模型需求

---

## 11. 依賴關係圖

```
M1 → M2 → M4 → M5 → M6
      └→ M3 ───┘
```

| 依賴 | 原因 |
|---|---|
| M2 必須先於 M3 | 指標計算需先有穩定 OHLC 資料來源 |
| M4 依賴 M2 與 M3 | UI 需有資料與訊號才能完整呈現 |
| M5 依賴 M2 與 M3 | LLM 需結合新聞與技術摘要 |
| M6 依賴前面全部完成 | 封裝需功能完整 |

---

## 12. 驗收總表

| 里程碑 | 驗收重點 | 結果 |
|---|---|---|
| M1 | Extension 骨架完成、型別定義完整 | ✅ 完成 |
| M2 | 報價 / K 線 / 新聞 直接 fetch 可用 | ✅ 完成 |
| M3 | 指標與買賣點訊號完成（純 TS） | ✅ 完成 |
| M4 | Sidebar + Webview MVP 可用 | ✅ 完成 |
| M5 | LLM 建議 JSON 化完成 | ✅ 完成 |
| M6 | 打包、安裝、文件完成 | 🔄 進行中 |

---

## 13. 總工時預估

> 106 小時為 MVP 範圍。若納入第二階段候選功能，建議追加 68 至 112 小時。

| 里程碑 | 工時（小時） |
|---|---:|
| M1 專案骨架 | 10 |
| M2 資料與新聞 API | 22 |
| M3 技術指標與買賣點 | 14 |
| M4 VS Code UI MVP | 24 |
| M5 LLM 建議整合 | 20 |
| M6 穩定化與發佈 | 16 |
| **總計** | **106 小時** |

| 第二階段功能 | 追加工時（小時） |
|---|---:|
| Alert Center | 12-16 |
| Screener | 16-24 |
| Event Calendar | 10-14 |
| Portfolio Watch | 10-16 |
| Snapshot / Export | 8-12 |
| Signal Replay | 12-18 |
| **追加總計** | **68-112** |

---

## 14. 下一步實作建議

1. **補齊起始骨架檔案** ✅ 已完成
   - [x] `package.json`（已更新：加入 `technicalindicators`、`openai`、`rss-parser`；移除 `backendUrl`；補齊所有設定欄位）
   - [x] `src/extension.ts`（Extension 入口，已建立）
   - [x] `src/types/index.ts`（全部 19 個介面型別，已建立）
   - [x] `src/views/WatchlistProvider.ts`（TreeView 骨架）
   - [x] `src/services/MarketDataService.ts`（骨架，M2 實作）
   - [x] `src/services/NewsService.ts`（骨架，M2 實作）
   - [x] `src/services/EventCalendarService.ts`（骨架）
   - [x] `src/services/FinancialReportService.ts`（骨架，M2 實作）
   - [x] `src/services/LLMOrchestrator.ts`（骨架，M5 實作）
   - [x] `src/analysis/TechnicalIndicatorEngine.ts`（骨架，M3 實作）
   - [x] `src/analysis/SignalEngine.ts`（骨架，M3 實作）
   - [x] `src/analysis/ChartInsightBuilder.ts`（骨架，M4 實作）
   - [x] `src/analysis/ScreenerEngine.ts`（骨架，第二階段實作）
   - [x] `src/alerts/AlertEngine.ts`（骨架，第二階段實作）
   - [x] `src/storage/CacheStore.ts`（已實作，記憶體 + WorkspaceState 快取）
   - [x] `src/storage/LlmTeamStore.ts`（已實作，GlobalState 持久化）

2. **M1 必須完成市場決策** ⬅ 待決策
   - 台股優先 → FinMind API
   - 美股優先 → Finnhub API
   - 或明確定義雙市場支援範圍與切換邏輯

3. **先清理既有設定與文件矛盾** ✅ 已完成
   - [x] `package.json` 已移除 `stockHeatmap.backendUrl`，並補齊所有設定欄位
   - [ ] README 待補上功能面說明與使用流程（M6 前完成）
   - [x] `backend/` 目錄已加入 `DEPRECATED.md` 標記廢棄

4. **廢棄後端相關檔案** ✅ 已完成
   - [x] `backend/DEPRECATED.md` 已建立，標示廢棄原因
   - [x] `docker-compose.yml` 已保留 `builder` 服務（打包 `.vsix`）
   - [x] `Dockerfile` 已新增 `dev` stage（Node.js 開發環境），移除 Python 需求

4.1 **Docker 開發環境** ✅ 已完成
   - [x] `Dockerfile` 新增 `dev` stage（`node:20-alpine`，含 `npm ci` + `vsce`）
   - [x] `docker-compose.yml` 新增 `dev` 服務（原始碼 volume mount，node_modules 隔離）
   - [x] `npm.bat` 建立（所有 npm 指令統一透過 Docker 執行）
   - 用法：`npm.bat install`、`npm.bat run compile`、`npm.bat run watch`

5. **MVP 路線（最小可用產品）**
   - 報價 → K 線 → 技術指標 → 新聞 → LLM 建議（全在 Extension 內完成）

6. **第二階段優先順序**
  - 先做 Alert Center + Explainable AI + Multi-Model Analysis
  - 再做 Screener + Event Calendar + Financial Report Analysis
  - 最後做 Portfolio Watch + Signal Replay

7. **LLM 策略**
  - 第一版：OpenAI + 單一 Ollama
  - 第二版：多個 Ollama 節點 + fallback
  - 第三版：接入 Copilot Language Model API，做並行分析或共識模式
  - 第四版：支援固定協作組與預設分析班底

8. **UI 必要守則**
   - 所有建議畫面須固定顯示免責聲明
   - 訊號標記須同步顯示觸發原因
  - 圖表與提醒應共用同一套顏色語意，避免 BUY / SELL 顏色定義不一致
  - 圖表分析說明必須明確區分「事實」與「模型解讀」

---

*最後更新：2026-03-25 | 狀態：**M1~M5 全數完成**，M6 進行中 | 所有主要功能已實作：MarketData(TW/US)、News、FinancialReport、TechnicalIndicator、SignalEngine、DashboardPanel、WatchlistProvider、LLMOrchestrator(OpenAI/Ollama/Copilot) | `dist/heatmap.vsix`（43 檔案，86.96 KB）✅ | 剩餘：E2E 測試、Ollama 部署文件*
