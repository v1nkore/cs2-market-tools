@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "PLAYWRIGHT_BROWSERS_PATH=%~dp0pw-browsers"
REM открыть браузер с панелью через 2 секунды (когда сервер поднимется)
start "" /min cmd /c "timeout /t 2 >nul & start "" http://localhost:4317"
echo ============================================
echo   Панель выгрузок: http://localhost:4317
echo   НЕ закрывайте это окно, пока идёт сбор.
echo   Закрытие окна останавливает панель.
echo ============================================
node ui_server.mjs
pause
