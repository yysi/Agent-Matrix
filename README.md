# Agent Matrix 🤖

> 多 Agent 协作平台 — 你电脑上所有 AI Agent 的指挥部

**Agent Matrix** 是一个本地运行的多 Agent 协作系统。它能自动发现你系统中安装的 AI CLI 工具（Claude Code、Hermes、MiMo、Agent Browser 等），让它们在同一个 Web 面板中**真实讨论、协同完成任务**。

## ✨ 特性

| 特性 | 说明 |
|------|------|
| 🧠 **真实 AI 讨论** | 发消息后 Agent 调用其真实 CLI 能力回复（`claude -p`、`hermes -z`、`agent-browser open`），不是模板台词 |
| 🎭 **角色分工** | 架构师、开发者、研究员、快枪手… 每个 Agent 各司其职 |
| 🔌 **Agent Browser 深度集成** | 搜索网页、截图、页面快照、执行 JS — 输出直接渲染在聊天中 |
| 📦 **多类型输出** | URL 卡片、代码块（复制/运行）、可执行命令、文件、截图图片 — 不再是纯文本 |
| 🎛️ **每个 Agent 独立开关** | 关闭某个 Agent 的协同后，它不再参与讨论 |
| 🌐 **Web Dashboard** | 双栏布局（左聊天 + 右侧面板），Socket.IO 实时通信 |
| 🔍 **自动发现** | 扫描系统 PATH，自动注册可用的 AI CLI 工具 |
| 📋 **任务管理** | 创建 → 执行 → 暂停 → 继续 → 终止 → 重试 |

## 🚀 启动

```bash
# 交互式菜单（推荐）
./agent-matrix
# 按 1 启动 Dashboard，浏览器会自动打开

# 或直接启动
npm start
# 访问 http://localhost:3000
```

双击 `启动AgentMatrix.command`（桌面）也可启动。

## 📸 界面预览

```
┌──────────────────────────────────────────────────────┐
│ 🔷 Agent Matrix     🤖 4 Agents  📝 2 Tasks  ● 已连接│
├────────────────────────┬─────────────────────────────┤
│  💬 讨论  📐 架构      │  [Agents] [任务] [角色] [日志]│
│  💻 开发  🔬 研究      │                              │
│                        │  已注册 Agent   [🔍扫描]     │
│  Agent Browser ●       │  ┌────────────────────────┐ │
│  Claude Code   ●      │  │ 🤖 Claude Code  ●      │ │
│  Hermes        ●      │  │ claude·DeepSeek v4·免费 │ │
│  MiMo          ○      │  │ [coding analysis...]   │ │
│                        │  │          [架构师▼] 🔌 ✕│ │
│  ┌─────────────────┐   │  └────────────────────────┘ │
│  │消息区域           │   │  ┌────────────────────────┐ │
│  │URL卡片·代码块·截图│   │  │ 📋 任务列表            │ │
│  └─────────────────┘   │  │                         │ │
│                        │  └────────────────────────┘ │
│  [输入指令，@agent可定向] [发送] │                    │
└────────────────────────┴─────────────────────────────┘
```

## 🎯 使用示例

在你的聊天框输入：

| 输入 | 谁回复 | 效果 |
|------|--------|------|
| `搜索最新的 AI 新闻` | Agent Browser | 打开 Google 搜索并返回快照 |
| `截图 https://example.com` | Agent Browser | 打开网页并截图，内嵌显示图片 |
| `帮我优化这个项目` | Claude | 架构分析 + 代码建议 |
| `@claude 写一个 REST API` | Claude（定向） | 只有 Claude 回复 |
| `用 Python 写一个排序算法` | Claude | 代码块（带复制/运行按钮） |

## 🏗️ 架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Web Dashboard (Browser)                    │
│  多类型渲染（文本/URL/代码/命令/文件/截图） ← Socket.IO      │
└────────────────────┬────────────────────────────────────────┘
                     │ REST API + WebSocket
┌────────────────────▼────────────────────────────────────────┐
│                  Node.js / Express Server                     │
│                                                              │
│  ┌──────────┐  ┌───────────┐  ┌──────────────┐              │
│  │ AgentChat│  │ Agent     │  │ AgentExecutor│              │
│  │ 路由引擎 │  │ Registry  │  │ CLI 调用引擎  │              │
│  │ 上下文   │  │ 发现/角色  │  │ 超时/重试    │              │
│  │ 讨论流   │  │ 持久化    │  │ 输出类型检测  │              │
│  └────┬─────┘  └───────────┘  └──────┬───────┘              │
└───────┼──────────────────────────────┼──────────────────────┘
        │ child_process               │
┌───────▼──────────────────────────────▼──────────────────────┐
│              本地 Agent CLI 工具                              │
│                                                              │
│  claude - DeepSeek v4         (架构/开发/分析)               │
│  hermes - DeepSeek v4         (开发/架构)                    │
│  mimo   - MiMo                (快速原型/批量)                 │
│  agent-browser                (浏览器自动化)                  │
│    ├── open <url>             打开网页                        │
│    ├── screenshot             截图 → base64 内嵌显示          │
│    ├── snapshot               页面快照 → 结构化内容           │
│    ├── eval <js>              执行 JavaScript                 │
│    └── click/type/fill...     页面交互                        │
└──────────────────────────────────────────────────────────────┘
```

## 📁 目录结构

```
AgentMatrix/
├── agent-matrix            # 交互式启动脚本
├── 启动.command             # 桌面双击启动器
├── package.json            # 项目配置
│
├── core/                   # 核心逻辑
│   ├── agent-executor.js   # Agent CLI 调用引擎（新建）
│   │   ├── 多 CLI 调用（claude -p / hermes -z / mimo run）
│   │   ├── 输出类型自动检测（URL/代码/命令/文件/截图）
│   │   ├── Agent Browser 深度集成（截图读取、快照解析）
│   │   ├── 并发控制（最多 2 个同时调用）
│   │   └── 超时与重试
│   ├── chat.js             # 群聊系统
│   │   ├── 真实 AI 驱动的讨论流
│   │   ├── 关键词 + @mention 路由引擎
│   │   ├── 每个 Agent 独立协同开关
│   │   └── 极简 prompt（不包装，直接传用户消息）
│   ├── discover.js         # Agent 发现（只注册已知 AI Agent）
│   └── status.js           # CLI 状态查看
│
├── web/                    # Web Dashboard
│   ├── server.js           # Express 服务器 + Socket.IO
│   │   ├── REST API（Agent/任务/聊天/命令执行）
│   │   ├── WebSocket 实时通信
│   │   └── 命令执行 API（一键运行代码/命令）
│   ├── agent-registry.js   # Agent 注册表（角色分配）
│   └── public/             # 前端文件
│       ├── index.html      # 双栏布局（左聊天 + 右面板）
│       ├── app.js          # 多类型消息渲染器
│       └── styles.css      # 暗色主题
│
├── config/                 # 配置（自动生成）
├── scripts/                # 工作流脚本
├── data/                   # 数据目录
└── logs/                   # 日志目录
```

## 📡 API

### Agent
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/agents` | 获取所有 Agent |
| POST | `/api/agents/discover` | 扫描新 Agent |
| PUT | `/api/agents/:id/role` | 更新角色 |
| DELETE | `/api/agents/:id` | 删除 Agent |
| POST | `/api/agents/:id/collaboration` | 切换协同开关 |

### 聊天
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/chat/messages` | 发送消息（触发 Agent 讨论） |
| GET | `/api/chat/messages/:channel` | 获取频道消息 |
| GET | `/api/chat/participants` | 获取参与者 |

### 其他
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/execute/command` | 一键运行命令 |
| POST | `/api/execute/browser` | 执行浏览器操作 |
| POST | `/api/tasks` | 创建任务 |

## 🖥️ 环境要求

- **macOS / Linux**（Windows 需要 WSL）
- **Node.js >= 18**
- **系统安装至少一个 Agent CLI**（claude、hermes、mimo、agent-browser 等）

## 📄 License

MIT

---

> 💡 **提示**：确保你的 Agent CLI 已加入系统 PATH。启动后在 Dashboard 点击 "🔍 扫描" 即可自动发现。