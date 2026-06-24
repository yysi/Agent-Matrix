#!/bin/bash
# 审查阶段 - 使用 Claude (免费 DeepSeek v4) 做代码审查
# 用法: ./review.sh "文件路径"

FILE="${1:?请提供文件路径}"

echo "🔍 架构师审查: $FILE"

# 使用 Claude (免费模型，做审查)
claude "作为代码审查者，请审查以下文件：$FILE

审查要点：
1. 代码质量
2. 安全性
3. 性能
4. 可维护性
5. 是否符合设计文档

输出审查报告"

echo "✅ 审查完成"
