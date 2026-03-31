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

### 取得 API Keys
1. **FinMind**（台股）：註冊 [FinMind](https://finmindtrade.com/) 帳號，於會員中心取得 Token
2. **Finnhub**（美股）：註冊 [Finnhub](https://finnhub.io/) 帳號，Dashboard 取得 API Key
3. **NewsAPI**：註冊 [NewsAPI](https://newsapi.org/) 帳號，取得 API Key

將上述 Keys 填入 VS Code 設定：
```json
"stockHeatmap.apiKey": "your_finnhub_key",
"stockHeatmap.finmindToken": "your_finmind_token",
"stockHeatmap.newsApiKey": "your_newsapi_key"
```

### 快速入門

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

#### 安裝步驟
1. **下載安裝**
   - Windows: 從 [Ollama 官網](https://ollama.ai/download) 下載安裝程式
   - macOS: `brew install ollama`
   - Linux: `curl -fsSL https://ollama.com/install.sh | sh`

2. **啟動服務**（Windows/macOS 安裝後會自動啟動）
   ```bash
   # 手動啟動
   ollama serve
   
   # 設定開機自動啟動（Linux/macOS）
   sudo systemctl enable ollama
   sudo systemctl start ollama
   ```

#### 模型管理
```bash
# 下載模型（建議至少 16GB RAM）
ollama pull mistral:7b         # 輕量級（7B 參數）
ollama pull llama3:8b          # 平衡型（8B 參數）
ollama pull llama3:70b         # 高精度（需 32GB+ RAM）

# 查看已安裝模型
ollama list

# 移除模型
ollama rm mistral:7b

# 執行對話測試
ollama run mistral:7b "你好，我是誰？"
```

#### 多節點部署（分散式運算）
1. 在每台機器上安裝 Ollama
2. 設定環境變數（每台機器不同 port）
   ```bash
   # 節點1（主機）
   export OLLAMA_HOST=0.0.0.0:11434
   
   # 節點2
   export OLLAMA_HOST=0.0.0.0:11435
   ```
3. 在插件設定中指定多個端點：
   ```json
   "stockHeatmap.llm.ollamaEndpoints": [
     {
       "id": "node1",
       "label": "主節點",
       "model": "mistral:7b",
       "baseUrl": "http://192.168.1.100:11434",
       "priority": 1
     },
     {
       "id": "node2",
       "label": "備援節點",
       "model": "mistral:7b",
       "baseUrl": "http://192.168.1.101:11435",
       "priority": 2
     }
   ]
   ```

#### 效能調校
- **GPU 加速**（需安裝 CUDA/cuDNN）
  ```bash
  # Linux 安裝 CUDA 版本
  curl -fsSL https://ollama.com/install.sh | FORCE_CUDA=1 sh
  ```
  
- **記憶體優化**（在 ~/.ollama/config.json）
  ```json
  {
    "num_ctx": 4096,  # 上下文長度
    "num_gpu_layers": 20,  # 使用 GPU 層數
    "main_gpu": 0,    # 主 GPU 編號
    "low_vram": false # 低 VRAM 模式
  }
  ```
  
- **監控指令**
  ```bash
  # 查看運作狀態
  ollama ps
  
  # 監看日誌
  journalctl -u ollama -f  # Linux
  ```

---

## 疑難排解

### 常見錯誤
| 錯誤代碼 | 可能原因 | 解決方案 |
|----------|----------|----------|
| `ERR_MARKET_DATA` | 市場資料獲取失敗 | 1. 檢查 API Key 是否正確<br>2. 確認網路連線<br>3. 檢查資料源服務狀態 |
| `ERR_LLM_UNAVAILABLE` | LLM 服務不可用 | 1. 檢查 Ollama 是否運行<br>2. 確認 API Endpoint 可連線<br>3. 檢查模型名稱是否正確 |
| `WARN_CACHE_EXPIRED` | 快取過期 | 等待自動刷新或手動重試 |
| `ERR_INVALID_SYMBOL` | 股票代碼無效 | 確認代碼格式：台股為數字（如 2330），美股為大寫字母（如 AAPL） |

### 效能問題
- **K線圖載入慢**：減少顯示的資料點數量（切換時間週期）
- **LLM 回應延遲**：改用本地 Ollama 模型或調整 `stockHeatmap.llm.timeout` 設定
- **高記憶體使用**：關閉不需要的 Dashboard 分頁，或減少自選股數量

## 進階設定

### 自訂技術指標
在設定中新增自訂指標（範例：威廉指標）：
```json
"stockHeatmap.technicalIndicators": [
  {
    "name": "WILLR",
    "params": {"period": 14},
    "thresholds": {"overbought": -20, "oversold": -80}
  }
]
```

### LLM 合併策略
支援三種 LLM 結果合併策略：
- `majority`：多數決（預設）
- `weighted`：加權平均（需設定權重）
- `priority`：優先採用最高優先級節點

設定範例：
```json
"stockHeatmap.llm.mergeStrategy": "weighted",
"stockHeatmap.llm.ollamaEndpoints": [
  {
    "id": "ollama-1",
    "priority": 1,
    "weight": 0.6
  },
  {
    "id": "openai-gpt4",
    "priority": 2,
    "weight": 0.4
  }
]
```

## 建置需求

| 工具 | 版本 |
|---|---|
| Docker Desktop | 20.10+ |
| VS Code | 1.85+ |
| Node.js（容器內） | 20 (Alpine) |
