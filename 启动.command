#!/bin/bash
# Agent Matrix - 桌面启动器
# 双击即可运行

cd ~/Desktop/AgentMatrix

echo "🚀 启动 Agent Matrix..."
echo ""

# 检查依赖
if [ ! -d "node_modules" ]; then
    echo "📦 安装依赖..."
    npm install
    echo ""
fi

# 启动服务器
echo "✅ 服务器启动中..."
echo "🌐 访问地址: http://localhost:3000"
echo ""
echo "按 Ctrl+C 停止"
echo ""

npm start
