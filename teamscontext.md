## 主管模式紀錄 2026-03-25 01:22:29

**議題：** 可以加模擬功能嗎 ?

**執行狀態：** 已執行完畢，請查看上方 Agent 執行記錄。

**全員 Review：**
【🏢 主管 (🐙 claude-sonnet-4.6) Review】
## 最終 Review：模擬功能實作成果

---

### 1. 是否符合需求？

**整體符合**，但需區分「已交付」與「尚未落地」。

| 需求面向 | 狀態 | 說明 |
|---------|------|------|
| 資料層抽象化 | ✅ | `IDataProvider` 介面設計完整 |
| 模擬資料產生 | ✅ | GBM 模型、seed 可重現 |
| 模擬播放控制 | ✅ | start / pause / reset / onTick |
| VS Code 指令整合 | ✅ | `heatmap.startSimulation` 可呼叫 |
| 錯誤處理 | ✅ | `onError` 回呼機制完整 |
| **實際可執行** | ⚠️ | `tsconfig.json`、`package-lock.json` 尚缺，`Dockerfile` 無法成功建置 |

---

### 2. 潛在問題與風險

**🔴 高風險**

- **建置系統尚未可用**：`Dockerfile` 執行 `npm ci` 與 `npm run compile` 均會失敗，技術債 TD-03、TD-04 若不補齊，整個 `build.bat` 流程無法走通，等同交付了無法打包的程式碼。

**🟡 中風險**

- **`FIXED_SIMULATION_END_TIME` 硬編碼 2024-12-31**：雖有環境變數覆寫機制，但預設值隨時間老化，若無 CI 定期提醒更新，模擬資料將與現實落差越來越大，影響使用者信任感。

- **`SimulationController` 無播放完成事件**：計時器結束後僅呼叫 `pause()`，呼叫端無法得知播放已完畢，UI 層無法自動重置按鈕狀態。

- **Webview 通訊尚未實作**：`onTick` 目前只輸出至 OutputChannel，K 線圖無法渲染，模擬功能對使用者而言仍不可見。

**🟢 低風險**

- `process.env` 在 VS Code Extension Host 環境可用，但需確認 Webview side 不會誤用同一常數（Webview 為獨立 browser context，無 `process` 物件）。

---

### 3. 建議改進方向

**立即處理（阻擋建置）**

```
TD-03  補 tsconfig.json
TD-04  補 package-lock.json（或改用 npm install 替代 npm ci）
```

**Phase 3 完成前須補齊**

1. **新增 `onComplete` 事件**至 `SimulationController`
```typescript
type CompleteCallback = (symbol: string) => void;
public onComplete(callback: CompleteCallback): void
```

2. **Webview `postMessage` 橋接層**：`onTick` → `panel.webview.postMessage({ type: 'tick', candle })` 才能驅動圖表渲染

**Phase 4 優化**

3. **錨點自動化**：CI pipeline 加入年度自動更新 `FIXED_SIMULATION_END_TIME` 的腳本，避免人工遺忘

4. **TD-01、TD-02 技術債清償**：`start()` 的 `void` 風險與 `createDataProvider()` 的 fallthrough 邏輯

---

### 結論

> 資料層與控制層架構品質良好，可作為後續 Phase 的穩固基礎。
> **但在補齊 `tsconfig.json` 與 `package-lock.json` 之前，本次交付尚不構成可建置狀態。**
> 建議將 TD-03、TD-04 列為下一個 Sprint 的第一優先任務。

---

【👨‍💻 工程師 #1 (🐙 gpt-5.4) Review】
## Review 結論

### 1. 是否符合需求？

**部分符合。**

已完成的方向是正確的，且已把「模擬功能」的核心骨架定義出來，包括：

- `IDataProvider` 抽象介面
- `MockDataGenerator` 模擬資料生成
- `MockDataProvider` 模擬資料提供
- `SimulationController` 播放控制骨架
- `extension.ts` 最小啟動邏輯
- `package.json` 最小宣告

就「**可以加模擬功能嗎**」這個問題來看，答案是 **可以，且方案合理**。

但若以「**目前專案是否已可直接建置、安裝、執行模擬功能**」來看，答案是 **還沒有完全落地**。

---

### 2. 潛在問題或風險

#### (1) 專案仍可能無法實際建置
目前只補了 `package.json`，但建置鏈還缺少關鍵檔案：

- `tsconfig.json`
- `package-lock.json`
- 實際 `src/` 檔案若尚未寫入工作區，則仍不可編譯

尤其 `Dockerfile` 內有：

- `COPY package*.json ./`
- `RUN npm ci`
- `RUN npm run compile --if-present`

若沒有 `package-lock.json`，`npm ci` 通常會失敗。

---

#### (2) `.vscodeignore` 目前會把 `dist` 排除
這是**高風險**問題。

現有 `.vscodeignore` 含：

- `dist`
- `out`

但 `package.json` 的主入口是：

- `./dist/extension.js`

若打包 `.vsix` 時把 `dist` 排除，延伸模組安裝後會找不到主程式。

---

#### (3) `LiveDataProvider` 尚未實作
目前 `heatmap.dataSource=live` 時，仍會 fallback 到 `MockDataProvider`。  
這對 MVP 可接受，但行為上屬於**暫代實作**，不能算完整功能。

---

#### (4) 模擬功能目前只有資料層與控制層，沒有 UI 呈現
目前尚未接上：

- TreeView
- Webview
- K 線圖
- 熱力圖
- 訊號標示

因此目前比較像「**背景模擬引擎骨架**」，不是使用者可直觀看到的完整模擬功能。

---

#### (5) `SimulationController` 仍有技術債
主管已標註的兩點成立：

- `start()` 內仍用 `void this.loadSeriesAndRun(...)`
- `createDataProvider()` 邏輯可讀性仍可再明確

雖不阻擋，但後續最好整理。

---

#### (6) 固定錨點資料會逐年變舊
雖已加上環境變數覆寫機制，但預設仍是固定時間。  
優點是可重現，缺點是模擬資料會與當前市場時間脫節。

---

#### (7) 目前屬「提案式交付」風險
前述內容主要是**提供完整檔案內容**，但若未真的寫入工作區，就不算完成實作。  
這是流程風險，不是設計問題。

---

### 3. 建議的改進方向

#### 優先級 P0：先讓專案能建置
建議立刻補齊：

- `tsconfig.json`
- `package-lock.json`
- 實際 `src/` 檔案落地
- 修正 `.vscodeignore`，**不要排除 `dist`**

---

#### 優先級 P1：讓模擬功能可被看見
下一步應補：

- Webview 面板
- 圖表渲染
- `onTick -> webview.postMessage`
- `heatmap.startSimulation` 啟動後能看到畫面更新

否則只有 Output Channel 訊息，使用價值有限。

---

#### 優先級 P2：補齊最小測試
至少應加：

- `MockDataGenerator` 可重現性測試
- `MockDataProvider.getCandles()` 邊界測試
- `SimulationController` tick / error 測試

---

#### 優先級 P3：整理設定與維護策略
建議把模擬相關設定正式化，例如：

- `heatmap.simulation.endTime`
- `heatmap.simulation.rangeDays`
- `heatmap.simulation.seedMode`

這樣比只靠常數或環境變數更適合 VS Code Extension。

---

## 最終判斷

### 結論
- **需求方向：有符合**
- **工程設計：合理**
- **實際完成度：中等，尚未可直接交付使用**

### 建議評語
這次成果可視為：

- **模擬功能的可行性驗證 + 核心骨架完成**
- **但尚未達到可直接建置與可視化使用的完成品**

若要正式核准上線，建議至少再完成：

1. 建置檔補齊  
2. `.vscodeignore` 修正  
3. Webview / 圖表串接  
4. 基本測試補上  

如需，我可下一步直接整理成一份 **最小可執行 MVP 修補清單**。

---

【👨‍💻 工程師 #2 (🐙 gemini-3-pro-preview) Review】
[Review 失敗: Copilot 模型 "gemini-3-pro-preview" 不可用]

---

## 主管模式紀錄 2026-03-25 03:34:41

**議題：** 直接做到完

**執行狀態：** 已執行完畢，請查看上方 Agent 執行記錄。

**全員 Review：**
【🏢 主管 (🐙 claude-sonnet-4.6) Review】
## 最終 Review：M1-M3 MVP 交付成果

---

### 1. 是否符合需求？

「直接做到完」對應 ToDo.md 定義的 M1+M2+M3，整體評估如下：

| 里程碑 | 項目 | 狀態 | 說明 |
|--------|------|------|------|
| M1 | Extension 骨架 | ✅ | `extension.ts` + `package.json` + `tsconfig.json` 齊備 |
| M1 | Backend 骨架 | ✅ | `main.py` 可啟動，不再崩潰 |
| M2 | 報價 API | ✅ | `/watchlist/quotes` 含 FinMind + mock fallback |
| M2 | K 線 API | ✅ | `/symbols/{symbol}/candles` 含 FinMind + mock fallback |
| M2 | 新聞 API | ❌ | `GET /symbols/{symbol}/news` **完全未實作** |
| M3 | Sidebar TreeView | ✅ | 自選股清單可顯示 |
| M3 | Webview K 線圖 | ✅ | lightweight-charts 渲染 |
| M3 | 熱力圖 | ⚠️ | stub 資料存在，但 Webview **未渲染熱力圖**，僅有 K 線 |
| M3 | 手動刷新 | ✅ | `stockHeatmap.refresh` 可用 |
| M3 | Add Symbol | ✅ | 可新增並立即開圖 |

**結論：M1 完成，M2 缺新聞 API，M3 缺熱力圖渲染。未達完整 M3 DoD。**

---

### 2. 潛在問題與風險

**🔴 高風險**

**R1：`package-lock.json` 仍不存在**
`Dockerfile` 雖已改為 `npm install`，但本機開發環境若執行 `npm ci` 仍會失敗。且沒有 lock file 代表每次建置依賴版本不可重現，生產環境風險高。

```
修正：執行 npm install 一次後將 package-lock.json 納入版控
```

**R2：`backend/routers/symbols.py` FinMind 欄位名稱未驗證**
FinMind API 回傳欄位為 `max`/`min`，但不同 dataset 版本欄位名可能不同，若 API 改版將靜默回傳錯誤資料而非拋出例外。

```python
# 現況（脆弱）
"high": float(row["max"]),
"low":  float(row["min"]),
```

**R3：`analysis.py` Pydantic model `TimeWindow` 欄位命名衝突**
`from_` 搭配 `populate_by_name` 但 request body 的 key 實際應為 `from`，客戶端傳入 `{"from": "..."}` 時 Pydantic v2 行為需要明確設定 `alias`，否則靜默忽略該欄位。

```python
# 需改為
from_: Optional[str] = Field(None, alias="from")
```

---

**🟡 中風險**

**R4：`heatmap.py` 市場篩選邏輯有誤**
```python
(market == "TW" and not row["symbol"].isalpha())
```
台股代碼（如 `2330`）確實非全字母，但此判斷會把所有非純字母代碼都歸為 TW，若未來有 ETF 代碼如 `00878` 或美股含數字代碼時會誤判。建議改用明確白名單或 `symbol.isdigit()` 判斷。

**R5：`DashboardPanel` 未實作熱力圖渲染**
`/api/v1/heatmap` 已存在，但 Webview HTML 完全沒有串接，使用者看不到熱力圖，M3 DoD 未達標。

**R6：Extension `activate()` 中 `void apiClient.getHealth()` 錯誤處理不完整**
目前僅顯示 5 秒 status bar message，若 backend 持續無法連線，之後所有 API 呼叫均會靜默失敗，使用者只看到空白 TreeView，無法得知原因。

---

**🟢 低風險**

**R7：`MockDataGenerator` / `SimulationController`（前一 Sprint 設計）未整合至本次交付**
先前 Sprint 規劃的模擬功能骨架與本次 MVP 架構尚未對接，後續若要整合需確認介面相容性。

**R8：`backend/requirements.txt` 含 `newspaper3k`**
`newspaper3k` 與 Python 3.12 存在相容性問題，新聞模組實作前需先驗證安裝可行性。

---

### 3. 建議改進方向

**立即處理（下一 PR 前必須）**

```
1. 執行 npm install，將 package-lock.json 納入版控
2. 修正 analysis.py TimeWindow 的 Field alias
3. 修正 heatmap.py 市場篩選邏輯
```

**完成 M2 DoD**

```
4. 新增 backend/routers/news.py
   GET /api/v1/symbols/{symbol}/news
   先以 RSS fallback 實作，無來源時回傳空陣列而非 500
```

**完成 M3 DoD**

```
5. DashboardPanel.ts 加入熱力圖區塊
   postMessage type: 'heatmap' → 渲染色塊網格
   可使用純 CSS Grid，不需額外圖表庫
```

**穩健性補強**

```
6. FinMind 欄位存取改用 .get() + 型別防衛
7. backend 連線失敗時 TreeView 顯示明確錯誤 item
8. 驗證 newspaper3k 與當前 Python 版本相容性
```

---

### 總結

> 核心骨架扎實，建置鏈阻擋項已清除，Extension 可安裝執行。
> **但 M2 缺新聞 API、M3 缺熱力圖渲染，`package-lock.json` 未納入版控，`analysis.py` 有靜默 bug。**
> 不構成完整 M3 DoD 交付。建議將 R1-R3 列為下一 Sprint 第一優先，R4-R5 為本 Sprint 補交。

---

【👨‍💻 工程師 #1 (🐙 gpt-5.4) Review】
## Review 結論

### 1. 是否符合需求？

**不完全符合。**

就內容來看，已提出一套相對完整的實作方案，涵蓋：

- Extension 端主要檔案切分
- TreeView / Webview / commands 基本骨架
- Backend stub API 規劃
- 建置阻擋項修正方向

但若以「**直接做到完**」為標準，結果**尚未達成**，原因如下：

- **未實際使用工具改檔**，本輪本質上仍是**提案 / patch 內容**，不是已落地的工作區修改
- 主管要求的 **backend T2-1 ~ T2-6** 並未真正提交完整實作
- 第 1 輪 review 指出的必修項，未看到正式修正版提交
- 專案仍缺少可驗證的最終狀態，例如：
  - backend 是否可成功啟動
  - extension 是否可成功 compile
  - `build.bat` / Docker 是否可跑通
  - VSIX 安裝後是否可開啟 Dashboard 並取到 API 資料

因此結論是：

- **方案完整度：中高**
- **實作完成度：不足**
- **交付狀態：未達「做到完」**

---

### 2. 潛在問題或風險

#### (1) 最大風險：未真正落地
本次看起來沒有實際更新工作區檔案。  
若檔案未寫入，則：

- `src/` 仍不存在
- backend 缺失 router 仍不存在
- build 與 runtime 問題仍原封不動

這是目前最核心風險。

---

#### (2) backend 仍可能無法啟動
主管已明確指出：

- `backend/main.py` import 了不存在的 router

若未真正修正，FastAPI 啟動即失敗，則 extension 的 `apiClient` 也無法正常取數。

---

#### (3) 建置鏈仍未閉合
即使 extension 與 backend 程式碼都補了，仍有以下阻擋項：

- `package-lock.json` 不存在
- `Dockerfile` 還是 `npm ci`
- `.vscodeignore` 若未真的改掉 `out`，打包後 extension 仍會壞

也就是說，**功能提案完整不代表可建置交付**。

---

#### (4) Webview 安全性與生命週期問題
主管指出的問題成立：

- CSP `script-src` 過寬
- Webview resize listener 清理不足

這些不一定立刻壞掉，但會影響安全性與可維護性。

---

#### (5) 型別與 UI 細節風險
像是：

- `TreeView.message` 清除方式
- 空 watchlist 的 placeholder
- SVG 最終檔案內容歧義

都屬於小問題，但代表提交還沒收斂到可 merge 狀態。

---

### 3. 建議的改進方向

#### P0：先把「提案」變成「實際修改」
必須先完成真正落地：

- 實際建立 `src/` 相關檔案
- 實際修改 `.vscodeignore`
- 實際補齊 `backend/routers/*.py`
- 實際修正 `backend/main.py`

沒有這一步，後續 review 都只是紙上作業。

---

#### P1：補齊主管要求的必修項
至少要正式提交以下修正版：

- `DashboardPanel.ts`
  - CSP 收緊為 `https://unpkg.com`
- `extension.ts`
  - `watchlistView.message` 用 `''`
- `media/icon.svg`
  - 只保留單一正確版本
- `HeatmapDataProvider.ts`
  - 補空清單 placeholder

---

#### P2：把 backend stub 完整補上
需補齊並能啟動：

- `backend/routers/watchlist.py`
- `backend/routers/symbols.py`
- `backend/routers/heatmap.py`
- `backend/routers/analysis.py`
- `backend/routers/__init__.py`
- `backend/main.py`

目標至少要做到：

- `/api/v1/health`
- `/api/v1/watchlist/quotes`
- `/api/v1/symbols/{symbol}/candles`
- `/api/v1/heatmap`
- `/api/v1/analysis/recommendation`

都能回合法 JSON。

---

#### P3：修通建置與驗證流程
建議最少完成以下驗證：

1. `npm install`
2. `npm run compile`
3. backend `uvicorn` 可啟動
4. extension 在 VS Code 可執行
5. `build.bat` 或 Docker 至少一條路徑可成功產出 `.vsix`

---

## 最終判斷

### 結論
- **需求符合度：部分符合**
- **主要問題：未真正落地、未完成主管要求修正、backend 仍未補齊**
- **目前狀態：可視為實作方案審查稿，不可視為完成交付**

### 建議評語
這次成果適合當作**下一輪正式實作的藍圖**，但離「直接做到完」還有一段距離。  
若要核准，至少需再看到：

- 實際檔案變更
- backend 可啟動
- extension 可編譯
- 最小端對端流程可跑通

---

【👨‍💻 工程師 #2 (🐙 gemini-3-pro-preview) Review】
[Review 失敗: Copilot 模型 "gemini-3-pro-preview" 不可用]