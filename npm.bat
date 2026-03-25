@echo off
setlocal EnableDelayedExpansion

:: ============================================================
::  npm.bat  —  在 Docker 容器內執行 npm 指令
::  用法：npm.bat <npm 指令及參數>
::  範例：npm.bat install
::         npm.bat run compile
::         npm.bat run watch
::         npm.bat run lint
::         npm.bat package
:: ============================================================

:: ── 0. 確認 Docker 存在 ─────────────────────────────────────
where docker >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Docker 未安裝或未在 PATH 中，請先安裝 Docker Desktop。
    exit /b 1
)

:: ── 1. 若未提供參數，顯示使用說明 ──────────────────────────
if "%~1"=="" (
    echo.
    echo 用法：npm.bat ^<npm 指令^>
    echo.
    echo 常用指令：
    echo   npm.bat install            ^← 安裝 / 更新依賴
    echo   npm.bat run compile        ^← 編譯 TypeScript
    echo   npm.bat run watch          ^← 監看模式編譯
    echo   npm.bat run lint           ^← ESLint 檢查
    echo   npm.bat package            ^← 打包 .vsix
    echo.
    exit /b 0
)

:: ── 2. 確認 dev image 存在；若不存在則先 build ──────────────
docker image inspect heatmap-vscode-dev:latest >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [INFO] 尚未建置 dev 映像，正在建置中（首次需要幾分鐘）...
    docker compose build dev
    if %ERRORLEVEL% NEQ 0 (
        echo [ERROR] dev 映像建置失敗！
        exit /b 1
    )
)

:: ── 3. 在容器內執行指定 npm 指令 ────────────────────────────
echo [INFO] 執行：npm %*
echo.
docker compose run -T --rm dev npm %*

endlocal
