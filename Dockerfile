# ─────────────────────────────────────────────
# Stage 0 — 開發環境（互動式 npm 指令使用）
# ─────────────────────────────────────────────
FROM node:20-alpine AS dev

WORKDIR /workspace

# 先複製 package*.json，利用 Docker layer cache
COPY package*.json ./

# 安裝全部依賴（含 devDependencies）
RUN npm install

# 安裝 vsce（打包工具）於全域
RUN npm install -g @vscode/vsce

# 原始碼於 runtime 透過 volume mount 掛入，不在此 COPY
# 預設啟動：執行 TypeScript 編譯（可被 docker compose run 覆寫）
CMD ["npm", "run", "compile"]

# ─────────────────────────────────────────────
# Stage 1 — Build VS Code Extension (.vsix)
# ─────────────────────────────────────────────
FROM node:20-alpine AS builder

# 安裝 vsce（VS Code Extension 打包工具）
RUN npm install -g @vscode/vsce

WORKDIR /workspace

# 先複製 package*.json，利用 Docker layer cache
COPY package*.json ./

# 安裝依賴（生產 + 開發）
RUN npm install

# 複製其餘原始碼
COPY . .

# 編譯 TypeScript（若專案有 compile step）
RUN npm run compile --if-present

# 確保輸出目錄存在
RUN mkdir -p /dist

# 打包成 .vsix
RUN vsce package --no-git-tag-version --allow-missing-repository --out /dist/heatmap.vsix


# ─────────────────────────────────────────────
# Stage 2 — 輕量輸出映像（只含 .vsix 成品）
# ─────────────────────────────────────────────
FROM alpine:3.19 AS artifact

WORKDIR /artifact

COPY --from=builder /dist/heatmap.vsix ./

# 預設指令：列出成品
CMD ["ls", "-lh", "/artifact"]
