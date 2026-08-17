@echo off
rem DSH GUI installer
set "ROOT=%~dp0"
cd /d "%ROOT%"
echo ============================================
echo   DSH GUI installer
echo ============================================
echo.

rem Check Node.js
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js was not found. Install it from https://nodejs.org/
  pause
  exit /b 1
)

rem Check DSH
where dsh >nul 2>&1
if errorlevel 1 (
  echo [INFO] DSH was not found. Installing @deepseek-ai/dsh globally ...
  call npm install -g @deepseek-ai/dsh
)

echo [1/2] Installing dependencies ...
call npm install

echo [2/2] Packaging the application ...
call npm run pack
if errorlevel 1 (
  echo [ERROR] Packaging failed. See the message above.
  pause
  exit /b 1
)

set "APP=%ROOT%release\DeepSeek Harness-win32-x64\DeepSeek Harness.exe"
if exist "%APP%" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\create-shortcut.ps1" -TargetPath "%APP%" -ShortcutName "DeepSeek Harness.lnk"
  if errorlevel 1 echo [INFO] Could not create the desktop shortcut, but packaging succeeded.
)

echo.
echo Done. Application: release\DeepSeek Harness-win32-x64\DeepSeek Harness.exe
echo A desktop shortcut was created if the operation succeeded.
echo.
pause
