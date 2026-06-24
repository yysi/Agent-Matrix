# Hacker News Daily — 每日热门文章 Markdown 报告生成器

自动抓取 Hacker News 热门文章并生成 Markdown 格式的每日报告。

## 功能特性

- 使用 Algolia API 一次请求获取所有热门文章
- 按分数降序排列，支持自定义文章数量
- 生成美观的 Markdown 报告，包含统计摘要
- 支持命令行参数配置
- 完善的错误处理和重试机制
- 可选的缓存机制（默认关闭）

## 安装

```bash
# 安装依赖
pip install -r requirements.txt

# 或直接安装 requests
pip install requests>=2.28.0
```

## 使用方法

### 基本用法

```bash
# 默认生成 Top 30 热门文章报告
python hn_daily.py

# 指定输出文件
python hn_daily.py --output ~/Desktop/hn_report.md

# 只获取 Top 10 文章
python hn_daily.py --limit 10
```

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--output`, `-o` | 输出 Markdown 文件路径 | `hn_daily_report.md` |
| `--limit`, `-l` | 文章数量 | `30` |
| `--no-cache` | 忽略缓存，强制从 API 拉取 | `False` |
| `--verbose`, `-v` | 输出调试日志 | `False` |

### 示例

```bash
# 生成今日 Top 20 报告到桌面
python hn_daily.py --limit 20 --output ~/Desktop/hn_$(date +%Y-%m-%d).md

# 调试模式，查看详细日志
python hn_daily.py --verbose --limit 5

# 强制刷新缓存
pythonhn_daily.py --no-cache
```

## 输出格式

生成的 Markdown 报告包含：

```markdown
# Hacker News 每日热门 — 2026-06-24

**统计摘要** | 共 30 篇文章 | 最高分 1284 | 平均分 356

| # | 标题 | 分数 | 评论 | 链接 |
|---|------|------|------|------|
| 1 | How X works | 1284 | 342 | [link](...) |
| 2 | Y analysis | 921  | 187 | [link](...) |

---
*报告生成时间: 2026-06-24 08:00 UTC*
```

## 自动化部署

### 使用 crontab（Linux/macOS）

```bash
# 编辑 crontab
crontab -e

# 添加以下行（每天早上 8 点执行）
0 8 * * * cd /path/to/AgentMatrix && python3 hn_daily.py --output /path/to/reports/hn_$(date +\%Y-\%m-\%d).md
```

### 使用 launchd（macOS）

创建 `~/Library/LaunchAgents/com.hn.daily.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.hn.daily</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/python3</string>
        <string>/path/to/AgentMatrix/hn_daily.py</string>
        <string>--output</string>
        <string>/path/to/reports/hn_report.md</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>8</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
</dict>
</plist>
```

加载服务：

```bash
launchctl load ~/Library/LaunchAgents/com.hn.daily.plist
```

## 配置说明

### API 限制

- 使用 Algolia API，每日限制 10,000 次请求
- 每次运行只消耗 1 次请求，完全够用
- 无需 API 密钥

### 缓存机制

- 默认关闭缓存（每日一次请求不需要）
- 如需启用，移除 `--no-cache` 参数
- 缓存位置：`~/.cache/hn_daily/topstories_cache.json`
- 缓存有效期：1 小时

### 错误处理

- 网络超时：自动重试 3 次，指数退避
- API 错误：区分可重试（5xx）和不可重试（4xx）错误
- 优雅降级：部分失败时输出剩余数据，完全失败时保持上次报告

## 退出码

- `0`：成功
- `1`：部分失败（网络错误但有部分数据）
- `2`：完全失败（无法获取任何数据）

## 依赖

- Python 3.7+
- requests >= 2.28.0

## 许可证

MIT