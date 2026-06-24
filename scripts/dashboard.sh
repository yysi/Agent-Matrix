#!/bin/bash
# 启动 Agent Matrix Dashboard

echo "🚀 启动 Agent Matrix Dashboard"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

cd "$(dirname "$0")/web"

# 检查依赖
if [ ! -d "node_modules" ]; then
    echo "📦 安装依赖..."
    npm install
fi

echo ""
echo "🌐 启动服务器..."
echo "   地址: http://localhost:3000"
echo "   按 Ctrl+C 停止"
echo ""

npm start
