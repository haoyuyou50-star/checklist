#!/bin/bash
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "未找到 Node.js，请先安装：https://nodejs.org/"; read -r; exit 1; }
[ -d node_modules/puppeteer-core ] || { echo "首次运行，正在安装依赖..."; npm install || { read -r; exit 1; }; }
node tools/render.mjs "$@"
echo; read -r -p "按回车关闭"
