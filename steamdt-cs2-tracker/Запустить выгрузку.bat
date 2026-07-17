@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "PLAYWRIGHT_BROWSERS_PATH=%~dp0pw-browsers"
echo ============================================
echo   SteamDT - выгрузка продаж наклеек CS2
echo ============================================
echo.
node scrape.mjs
echo.
echo Готово. Откройте reports\index.html
echo.
pause
