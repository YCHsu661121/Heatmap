@echo off
setlocal EnableDelayedExpansion

:: ============================================================
::  build.bat  —  Build VS Code Extension (.vsix) via Docker
::  工作區: d:\Tools\Heatmap
:: ============================================================

set IMAGE_NAME=heatmap-vscode-builder
set CONTAINER_NAME=heatmap-builder-tmp
set OUTPUT_DIR=%~dp0dist
set VSIX_NAME=heatmap.vsix

echo.
echo ╔══════════════════════════════════════════╗
echo ║   Heatmap VS Code Extension Builder     ║
echo ╚══════════════════════════════════════════╝
echo.

:: ── 1. 確認 Docker 存在 ─────────────────────────────────────
where docker >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Docker 未安裝或未在 PATH 中，請先安裝 Docker Desktop。
    pause & exit /b 1
)

:: ── 2. 建立輸出目錄 ─────────────────────────────────────────
if not exist "%OUTPUT_DIR%" (
    mkdir "%OUTPUT_DIR%"
    echo [INFO] 建立輸出目錄: %OUTPUT_DIR%
)

:: ── 3. 建置 Docker 映像（builder stage）─────────────────────
echo [STEP 1/3] 建置 Docker 映像 "%IMAGE_NAME%" ...
docker build --target builder -t %IMAGE_NAME% "%~dp0"
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Docker build 失敗！
    pause & exit /b 1
)

:: ── 4. 執行容器並複製 .vsix ─────────────────────────────────
echo [STEP 2/3] 從容器複製 .vsix 成品 ...

:: 移除舊容器（若存在）
docker rm -f %CONTAINER_NAME% >nul 2>&1

:: 建立不啟動的容器，只用來 cp
docker create --name %CONTAINER_NAME% %IMAGE_NAME% >nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] 無法建立臨時容器！
    pause & exit /b 1
)

docker cp %CONTAINER_NAME%:/dist/%VSIX_NAME% "%OUTPUT_DIR%\%VSIX_NAME%"
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] 複製 .vsix 失敗，請確認 Dockerfile 中路徑正確。
    docker rm -f %CONTAINER_NAME% >nul 2>&1
    pause & exit /b 1
)

:: 清除臨時容器
docker rm -f %CONTAINER_NAME% >nul 2>&1

:: ── 5. 完成報告 ──────────────────────────────────────────────
echo [STEP 3/3] 清理完成！
echo.
echo ✅ 成功！.vsix 位於：
echo    %OUTPUT_DIR%\%VSIX_NAME%
echo.

:: ── 6. 詢問是否自動安裝到本機 VS Code ───────────────────────
set /p INSTALL_NOW=是否立即安裝到 VS Code？(Y/N): 
if /i "!INSTALL_NOW!"=="Y" (
    where code >nul 2>&1
    if %ERRORLEVEL% EQU 0 (
        echo [INFO] 正在安裝延伸模組 ...
        code --install-extension "%OUTPUT_DIR%\%VSIX_NAME%" --force
        echo [INFO] 安裝完成，請重新載入 VS Code 視窗（Ctrl+Shift+P → Reload Window）。
    ) else (
        echo [WARN] 找不到 code 指令，請手動安裝：
        echo        code --install-extension "%OUTPUT_DIR%\%VSIX_NAME%"
    )
)

echo.
pause
endlocal
