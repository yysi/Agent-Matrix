#!/bin/bash
# NVIDIA API 测试/使用脚本
# 用法: ./nvidia.sh "模型名" "提示词"

MODEL="${1:-llama-3.1-8b-instruct}"
PROMPT="${2:-你好，请介绍一下你自己}"

echo "🚀 NVIDIA API 测试"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "模型: $MODEL"
echo "提示: $PROMPT"
echo ""

# 检查是否有 NVIDIA API Key
if [ -z "$NVIDIA_API_KEY" ]; then
    echo "⚠️  未设置 NVIDIA_API_KEY"
    echo ""
    echo "获取免费 API Key:"
    echo "1. 访问 https://build.nvidia.com"
    echo "2. 注册/登录"
    echo "3. 创建 API Key"
    echo "4. 设置环境变量:"
    echo "   export NVIDIA_API_KEY='your-key-here'"
    echo ""
    echo "或者添加到 ~/.zshrc:"
    echo "   echo 'export NVIDIA_API_KEY=\"your-key\"' >> ~/.zshrc"
    exit 1
fi

# 使用 curl 测试
echo "📡 调用 NVIDIA API..."
echo ""

curl -s -X POST "https://integrate.api.nvidia.com/v1/chat/completions" \
  -H "Authorization: Bearer $NVIDIA_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"$MODEL\",
    \"messages\": [{\"role\": \"user\", \"content\": \"$PROMPT\"}],
    \"temperature\": 0.7,
    \"max_tokens\": 1024
  }" | jq -r '.choices[0].message.content' 2>/dev/null || echo "API 调用失败"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ 测试完成"
