@echo off
cd /d %~dp0
set PLAYWRIGHT_BROWSERS_PATH=%cd%\pw-browsers
if not exist node_modules (
  echo Первый запуск: установка зависимостей...
  call npm install
  call npx playwright install chromium
)
start "" http://localhost:8317
node server.mjs
pause
