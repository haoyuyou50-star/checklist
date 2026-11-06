@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js not found. Please install it from https://nodejs.org/ & pause & exit /b 1)
if not exist node_modules\puppeteer-core (echo First run: installing dependencies... & call npm install || (pause & exit /b 1))
node tools\render.mjs %*
pause
