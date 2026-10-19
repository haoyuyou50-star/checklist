@echo off
cd /d "%~dp0"
chcp 65001 >nul
where node >nul 2>nul || (echo 未找到 Node.js，请先安装：https://nodejs.org/ & pause & exit /b 1)
if not exist node_modules\puppeteer-core (echo 首次运行，正在安装依赖... & call npm install || (pause & exit /b 1))
node tools\render.mjs %*
pause
