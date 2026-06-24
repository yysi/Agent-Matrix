#!/bin/bash
# 研究阶段 - 使用 agent-browser 抓取信息
# 用法: ./research.sh "研究主题"

TOPIC="${1:?请提供研究主题}"

echo "🔬 研究员启动: $TOPIC"
echo "📁 输出目录: research/"

# 使用 agent-browser 抓取
if command -v agent-browser &> /dev/null; then
    agent-browser crawl "https://www.google.com/search?q=$TOPIC" --output "research/$TOPIC.md"
else
    echo "⚠️  agent-browser 未安装，使用 mimo 替代"
    mimo "研究主题: $TOPIC。请总结关键信息，保存到 research/$TOPIC.md"
fi

echo "✅ 研究完成"
