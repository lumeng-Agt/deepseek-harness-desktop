@echo off
rem DeepSeek Harness Desktop installer
setlocal EnableExtensions
set "ROOT=%~dp0"
cd /d "%ROOT%"
echo ============================================
echo   DeepSeek Harness Desktop installer
echo ============================================
echo.

rem Check Node.js
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js was not found. Install it from https://nodejs.org/
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm was not found. Reinstall Node.js or fix PATH.
  pause
  exit /b 1
)

for /f "delims=. tokens=1" %%v in ('node -p "process.versions.node"') do set "NODE_MAJOR=%%v"
if not defined NODE_MAJOR set "NODE_MAJOR=0"
if %NODE_MAJOR% LSS 22 (
  echo [ERROR] Node.js 22 or newer is required for packaging. Current version:
  node --version
  pause
  exit /b 1
)

rem Check DSH
where dsh >nul 2>&1
if errorlevel 1 (
  echo [INFO] DSH was not found. Installing @deepseek-ai/dsh globally ...
  call npm install -g @deepseek-ai/dsh
  if errorlevel 1 (
    echo [ERROR] DSH installation failed.
    pause
    exit /b 1
  )
)

where dsh >nul 2>&1
if errorlevel 1 (
  echo [ERROR] DSH is still unavailable after installation.
  pause
  exit /b 1
)

echo [1/3] Installing dependencies ...
call npm ci
if errorlevel 1 (
  echo [ERROR] Dependency installation failed.
  pause
  exit /b 1
)

echo [2/3] Running checks ...
call npm run check
if errorlevel 1 (
  echo [ERROR] Source checks failed.
  pause
  exit /b 1
)
call npm test
if errorlevel 1 (
  echo [ERROR] Tests failed.
  pause
  exit /b 1
)

echo [3/3] Packaging the application ...
call npm run pack
if errorlevel 1 (
  echo [ERROR] Packaging failed. See the message above.
  pause
  exit /b 1
)

set "APP=%ROOT%release\DeepSeek Harness Desktop-win32-x64\DeepSeek Harness Desktop.exe"
if exist "%APP%" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\create-shortcut.ps1" -TargetPath "%APP%" -ShortcutName "DeepSeek Harness Desktop.lnk"
  if errorlevel 1 echo [INFO] Could not create the desktop shortcut, but packaging succeeded.
)

echo.
echo Done. Application: release\DeepSeek Harness Desktop-win32-x64\DeepSeek Harness Desktop.exe
echo A desktop shortcut was created if the operation succeeded.
echo.
pause
