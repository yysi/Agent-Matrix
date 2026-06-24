#!/bin/bash
# 设计阶段 - 使用 Claude (DeepSeek v4) 做架构设计
# 用法: ./design.sh "需求描述"

REQUIREMENT="${1:?请提供需求描述}"

echo "📐 架构师启动: $REQUIREMENT"
echo "📁 输出目录: design/"

# 使用 Claude (免费 DeepSeek v4)
claude "作为架构师，请为以下需求设计技术方案：$REQUIREMENT

输出格式：
1. 架构图 (ASCII)
2. 模块划分
3. 接口定义
4. 数据流

保存到 design/ 目录"

echo "✅ 设计完成"
