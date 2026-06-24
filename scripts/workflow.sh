#!/bin/bash
# 完整工作流 - 串联所有阶段
# 用法: ./workflow.sh "项目需求"

PROJECT="${1:?请提供项目需求}"

echo "🚀 启动多 Agent 矩阵工作流"
echo "📁 项目: $PROJECT"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 阶段1: 研究
echo ""
echo "📌 阶段 1/4: 研究"
./scripts/research.sh "$PROJECT"
sleep 1

# 阶段2: 设计
echo ""
echo "📌 阶段 2/4: 设计"
./scripts/design.sh "$PROJECT"
sleep 1

# 阶段3: 实现
echo ""
echo "📌 阶段 3/4: 实现"
./scripts/implement.sh "$PROJECT"
sleep 1

# 阶段4: 审查
echo ""
echo "📌 阶段 4/4: 审查"
./scripts/review.sh "implement/"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ 工作流完成！"
echo "📁 产出目录: research/ design/ implement/"
