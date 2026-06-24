#!/bin/bash
# 矩阵状态检查

echo "╔═══════════════════════════════════════════╗"
echo "║      多 Agent 矩阵状态                    ║"
echo "╚═══════════════════════════════════════════╝"
echo ""

# 检查各工具
echo "📋 工具状态:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if command -v mimo &> /dev/null; then
    echo "  ✅ mimo (MiMo CLI)     - 免费模型"
else
    echo "  ❌ mimo (MiMo CLI)     - 未安装"
fi

if command -v hermes &> /dev/null; then
    echo "  ✅ hermes (Hermes)      - 付费 DeepSeek v4"
    echo "     └─ NVIDIA API 免费可用"
else
    echo "  ❌ hermes (Hermes)      - 未安装"
fi

if command -v claude &> /dev/null; then
    echo "  ✅ claude (Claude Code) - 免费 DeepSeek v4"
    echo "     └─ NVIDIA API 免费可用"
else
    echo "  ❌ claude (Claude Code) - 未安装"
fi

if command -v agent-browser &> /dev/null; then
    echo "  ✅ agent-browser        - 网页抓取"
else
    echo "  ❌ agent-browser        - 未安装"
fi

echo ""
echo "💰 成本优化策略:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🆓 免费层: NVIDIA API (Llama/Mistral)"
echo "  🆓 免费层: MiMo (限时)"
echo "  💎 付费层: DeepSeek v4 (核心任务)"

echo ""
echo "📁 工作区:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
ls -la /Users/yi/Desktop/claude/ | grep -E "^d" | awk '{print "  📂 "$NF}'

echo ""
echo "🚀 快速命令:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ./scripts/workflow.sh \"需求\"    # 完整流程"
echo "  ./scripts/research.sh \"主题\"    # 仅研究"
echo "  ./scripts/design.sh \"需求\"      # 仅设计"
echo "  ./scripts/implement.sh \"模块\"   # 仅实现"
echo "  ./scripts/review.sh \"文件\"      # 仅审查"
echo "  ./scripts/fast.sh \"任务列表\"    # 批量任务"
echo "  ./scripts/nvidia.sh \"模型\"      # NVIDIA API 测试"
