@echo off
cd /d %~dp0
if not exist node_modules (
  echo First run: installing dependencies...
  call npm install
)
start "" http://localhost:8319
node server.mjs
pause
