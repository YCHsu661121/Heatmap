@echo off
setlocal EnableDelayedExpansion

set IMAGE_NAME=heatmap-vscode-builder
set CONTAINER_NAME=heatmap-builder-tmp
set "WORKDIR=%~dp0"
set "WORKDIR=%WORKDIR:~0,-1%"
set OUTPUT_DIR=%WORKDIR%\dist
set VSIX_NAME=heatmap.vsix

echo.
echo =============================================
echo   Heatmap VS Code Extension Builder
echo =============================================
echo.

:: 1. Check Docker
where docker >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker not found. Please install Docker Desktop.
    pause & exit /b 1
)

:: 2. Create output dir
if not exist "%OUTPUT_DIR%" mkdir "%OUTPUT_DIR%"

:: 3. Build Docker image
echo [STEP 1/3] Building Docker image "%IMAGE_NAME%" ...
docker build --target builder -t %IMAGE_NAME% "%WORKDIR%"
if errorlevel 1 (
    echo [ERROR] Docker build failed.
    pause & exit /b 1
)

:: 4. Copy .vsix from container
echo [STEP 2/3] Copying .vsix from container ...
docker rm -f %CONTAINER_NAME% >nul 2>&1
docker create --name %CONTAINER_NAME% %IMAGE_NAME% >nul
if errorlevel 1 (
    echo [ERROR] Failed to create temporary container.
    pause & exit /b 1
)

docker cp %CONTAINER_NAME%:/dist/%VSIX_NAME% "%OUTPUT_DIR%\%VSIX_NAME%"
if errorlevel 1 (
    echo [ERROR] Failed to copy .vsix.
    docker rm -f %CONTAINER_NAME% >nul 2>&1
    pause & exit /b 1
)

docker rm -f %CONTAINER_NAME% >nul 2>&1

:: 5. Done
echo [STEP 3/3] Done!
echo.
echo [OK] .vsix: %OUTPUT_DIR%\%VSIX_NAME%
echo.

:: 6. Offer to install
set /p INSTALL_NOW=Install to VS Code now? (Y/N): 
if /i "!INSTALL_NOW!" NEQ "Y" goto :end

where code >nul 2>&1
if errorlevel 1 goto :no_code

echo [INFO] Installing extension ...
code --install-extension "%OUTPUT_DIR%\%VSIX_NAME%" --force
echo [INFO] Done. Reload VS Code (Ctrl+Shift+P - Reload Window).
goto :end

:no_code
echo [WARN] "code" command not found. Install manually:
echo        code --install-extension "%OUTPUT_DIR%\%VSIX_NAME%"

:end
echo.
pause
endlocal