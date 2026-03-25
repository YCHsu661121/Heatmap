# Stock Heatmap 架構圖

> 產出者：工程師 #1  
> 範圍：D1 系統總覽圖、D3 建置流程圖  
> 依據檔案：
> - `backend/main.py`
> - `backend/routers/health.py`
> - `docker-compose.yml`
> - `Dockerfile`
> - `build.bat`

---

## D1 — 系統總覽圖

```mermaid
flowchart LR
    U["使用者<br/>VS Code 操作者"]

    subgraph EXT["VS Code Extension（TypeScript）"]
        CMD["Commands<br/>stockHeatmap.openDashboard<br/>stockHeatmap.refresh<br/>stockHeatmap.addSymbol<br/>stockHeatmap.analyzeSymbol"]
        VIEW["Views<br/>Activity Bar: stock-heatmap<br/>Tree Views: watchlist / signals"]
        CFG["VS Code Configuration<br/>market / apiProvider / apiKey / backendUrl / llm.*"]
        ENTRY["Extension Entry<br/>package.json -> main: ./out/extension.js"]
        WEB["Webview / Dashboard<br/>ToDo.md 有規劃，src/ 尚未落地"]
    end

    subgraph API["Backend API（FastAPI / Python）"]
        MAIN["backend/main.py<br/>FastAPI App + CORS + Router 掛載"]
        HEALTH["backend/routers/health.py<br/>GET /api/v1/health"]
        MISS["缺失 Router<br/>watchlist / symbols / heatmap / analysis<br/>已在 main.py import，但工作區不存在"]
    end

    subgraph EXTSVC["外部服務 / 資料來源"]
        MARKET["Market Data<br/>FinMind / Finnhub"]
        LLM["LLM<br/>OpenAI / Ollama"]
        NEWS["News Source<br/>RSS / News API（依 ToDo 規劃）"]
    end

    U --> CMD
    U --> VIEW
    CFG --> ENTRY
    CMD --> ENTRY
    VIEW --> ENTRY
    ENTRY --> WEB

    ENTRY -- "HTTP/JSON\nstockHeatmap.backendUrl" --> MAIN

    MAIN --> HEALTH
    MAIN --> MISS
    MAIN --> MARKET
    MAIN --> LLM
    MAIN --> NEWS
```

### D1 備註
- 系統主幹為：**使用者 → Extension → Backend → 外部服務**
- `backend/main.py` 已啟用 `CORSMiddleware`
- `health.py` 是目前唯一存在的 router 實作
- `watchlist`、`symbols`、`heatmap`、`analysis` 已在 `main.py` 匯入，但工作區缺檔
- Extension 入口目前為 `./out/extension.js`，但 `src/` 尚未落地

---

## D3 — 建置流程圖

```mermaid
flowchart TD
    A["開發者執行<br/>build.bat"]
    B["檢查 Docker 是否存在<br/>where docker"]
    C["建立輸出目錄<br/>dist/"]
    D["docker build --target builder<br/>-t heatmap-vscode-builder"]

    subgraph DF1["Dockerfile / Stage 1: builder"]
        E["FROM node:20-alpine"]
        F["npm install -g @vscode/vsce"]
        G["WORKDIR /workspace"]
        H["COPY package*.json ./"]
        I["RUN npm ci"]
        J["COPY . ."]
        K["RUN npm run compile --if-present"]
        L["RUN vsce package --out /dist/heatmap.vsix"]
    end

    O["docker create --name heatmap-builder-tmp<br/>heatmap-vscode-builder"]
    P["docker cp<br/>container:/dist/heatmap.vsix -> host dist/heatmap.vsix"]
    Q["可選：code --install-extension<br/>dist/heatmap.vsix --force"]

    subgraph DF2["Dockerfile / Stage 2: artifact（未被 build.bat 使用）"]
        M["FROM alpine:3.19"]
        N["COPY --from=builder /dist/heatmap.vsix ./"]
    end

    R1["阻擋點：缺少 package-lock.json<br/>npm ci 會失敗"]
    R2["阻擋點：src/extension.ts 未提供<br/>compile 可能無實質輸出"]
    R3["高風險：.vscodeignore 排除 out 與 dist<br/>打包後 extension 可能缺主程式"]
    R4["已知矛盾：package.json main = ./out/extension.js<br/>先前討論曾提及 ./dist/extension.js"]

    A --> B --> C --> D
    D --> E --> F --> G --> H --> I --> J --> K --> L
    L --> O --> P --> Q

    L -.可另行產出 artifact 映像.-> M
    M --> N

    I -.失敗風險.-> R1
    K -.失敗風險.-> R2
    L -.封裝風險.-> R3
    L -.入口矛盾.-> R4
```

### D3 備註
- `build.bat` 實際只使用 **Stage 1 builder**
- `.vsix` 是由 `builder` 產出後，透過 `docker create` + `docker cp` 複製到主機 `dist/`
- **Stage 2 artifact** 存在於 `Dockerfile`，但**不在 `build.bat` 主流程上**
- `docker-compose.yml` 的 `builder` 服務，本質上也是直接輸出 `.vsix`

---

## 已知風險摘要

1. `package-lock.json` 缺失  
   - `npm ci` 會失敗

2. `.vscodeignore` 排除 `out` 與 `dist`  
   - 打包後可能遺失主程式

3. `src/` 未落地  
   - `tsc` 可能無實質輸出

4. Backend router 不完整  
   - `main.py` 匯入的多數 router 缺失
