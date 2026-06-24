#!/bin/bash
# 实现阶段 - 使用 Hermes (付费 DeepSeek v4) 写核心代码
# 用法: ./implement.sh "模块名"

MODULE="${1:?请提供模块名}"

echo "💻 开发者启动: $MODULE"
echo "📁 工作目录: implement/"

# 使用 Hermes (付费模型，处理复杂逻辑)
hermes "实现模块: $MODULE

要求：
1. 读取 design/ 目录下的设计文档
2. 实现核心功能
3. 编写单元测试
4. 代码要健壮、可维护

输出文件到 implement/ 目录"

echo "✅ 实现完成"
