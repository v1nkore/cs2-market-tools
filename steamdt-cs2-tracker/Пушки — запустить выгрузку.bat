@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "PLAYWRIGHT_BROWSERS_PATH=%~dp0pw-browsers"
echo ============================================
echo   Пушки CS2 — выгрузка продаж за день
echo   (повторяет, пока день не будет собран)
echo ============================================
echo.
for /L %%i in (1,1,10) do (
  node scrape_guns.mjs
)
echo.
echo Готово. Откройте reports_guns\index.html
pause
