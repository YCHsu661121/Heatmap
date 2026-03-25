# Stock Heatmap — VS Code Extension

在 VS Code 內完成股票分析工作：自選股看板、K 線圖、技術指標、買賣訊號、新聞摘要、財報重點，以及多模型 LLM 建議。

> **免責聲明：** 本插件所有訊號與 LLM 分析僅供研究與資訊輔助，不構成任何投資建議。投資有風險，決策前請自行研判。

---

## 功能概覽

| 功能 | 說明 |
|---|---|
| 自選股清單 | Sidebar TreeView，顯示即時報價與漲跌幅，1 分鐘自動刷新 |
| 熱力圖 | 所有自選股漲跌可視化（板塊色塊） |
| K 線圖 | Canvas 手繪 OHLC，支援 1D / 4H / 1H / 15m |
| 技術指標 | SMA5/20、RSI14、MACD（12/26/9）、Bollinger Bands（20,2σ） |
| 買賣訊號 | BUY / SELL / WATCH + 原因條列 + 信心分數 |
| 新聞 | NewsAPI.org → Yahoo Finance RSS → Finnhub 三層 fallback |
| 財報摘要 | 台股：MOPS 月營收；美股：SEC EDGAR XBRL（YoY/QoQ 自動計算） |
| LLM 建議 | OpenAI / Ollama（多節點 failover）/ GitHub Copilot LM API |
| 固定協作組 | 多模型同時分析，支援 majority / weighted merge 策略 |

---

## 安裝

### 方式一：從 `.vsix` 安裝（推薦）

```bash
# 下載最新 dist/heatmap.vsix
code --install-extension dist\heatmap.vsix --force
```

安裝後執行 `Ctrl+Shift+P → Reload Window`。

### 方式二：自行 Build（Docker）

```bat
# Windows 一鍵建置
build.bat
```

或手動：

```bash
docker compose build --no-cache builder
docker compose run --rm builder
# 成品：dist/heatmap.vsix
```

---

## 快速上手

1. 開啟 VS Code，左側 Sidebar 找到 **Stock Heatmap** 圖示
2. 點選「新增股票」（`+` 按鈕），輸入代碼：
   - 台股：`2330`、`2317`
   - 美股：`AAPL`、`NVDA`
3. 點選任一股票，開啟 Dashboard Webview
4. 在 Dashboard 工具列輸入代碼 → 點「載入」
5. 點「LLM 分析」取得 AI 建議

---

## 設定

在 VS Code 設定（`Ctrl+,` → 搜尋 `stockHeatmap`）中調整：

| 設定鍵 | 預設值 | 說明 |
|---|---|---|
| `stockHeatmap.watchlist` | `[]` | 自選股代碼清單 |
| `stockHeatmap.apiKey` | `""` | Finnhub / NewsAPI API Key |
| `stockHeatmap.finmindToken` | `""` | FinMind API Token（台股） |
| `stockHeatmap.llm.mode` | `"copilot"` | LLM 模式（`openai`/`ollama`/`copilot`） |
| `stockHeatmap.llm.ollamaEndpoints` | `[]` | Ollama 節點清單（見下方說明） |
| `stockHeatmap.financials.lookbackQuarters` | `4` | 財報回看期數 |
| `stockHeatmap.storage.cacheTtlSec` | `300` | 快取 TTL（秒） |

### Ollama 節點範例

```json
"stockHeatmap.llm.ollamaEndpoints": [
  {
    "id": "ollama-1",
    "provider": "ollama",
    "label": "本地 Mistral",
    "model": "mistral:7b",
    "baseUrl": "http://localhost:11434",
    "enabled": true,
    "priority": 1,
    "tags": []
  }
]
```

---

## 資料來源

| 市場 | 報價/K線 | 新聞 | 財報 |
|---|---|---|---|
| 台股 | [FinMind](https://finmindtrade.com/) | Yahoo Finance RSS | MOPS（公開資訊觀測站） |
| 美股 | [Finnhub](https://finnhub.io/) | NewsAPI.org / Finnhub | SEC EDGAR XBRL |

---

## 開發環境（Docker）

所有 npm 指令透過 Docker 執行：

```bat
npm.bat install         # 安裝套件（寫入 Docker volume 內的 node_modules）
npm.bat run compile     # TypeScript 編譯
npm.bat run lint        # ESLint 檢查
```

### Ollama 本地部署（AI 問答）

```bash
# 安裝 Ollama
# https://ollama.ai/download

# 拉取模型
ollama pull mistral:7b
# 或
ollama pull llama3:8b

# 啟動（預設 11434 port）
ollama serve
```

---

## 建置需求

| 工具 | 版本 |
|---|---|
| Docker Desktop | 20.10+ |
| VS Code | 1.85+ |
| Node.js（容器內） | 20 (Alpine) |
