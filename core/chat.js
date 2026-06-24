#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { loadConfig, ROLES, AGENT_PROFILES } = require('./discover');
const { callAgent, getThinkingMessage, OUTPUT_TYPES } = require('./agent-executor');

const MESSAGE_TYPES = {
  discussion: '讨论',
  task: '任务',
  question: '提问',
  answer: '回答',
  report: '报告',
  alert: '提醒'
};

function getAllAgentIds() {
  const builtin = Object.keys(AGENT_PROFILES);
  try {
    const cfg = loadConfig();
    return [...new Set([...builtin, ...Object.keys(cfg.agents || {})])];
  } catch { return builtin; }
}
const AI_AGENT_IDS = getAllAgentIds();
const ADMIN_ID = 'admin';

class AgentChat {
  constructor() {
    this.messages = [];
    this.channels = new Map();
    this.participants = new Map();
    this.configPath = path.join(__dirname, '..', 'config', 'chat.json');
    this.activeDiscussions = new Map();
    this.discussionQueue = [];
    this.isProcessingDiscussion = false;
    this.disabledAgents = new Set(); // 被禁用的 Agent ID（不参与协同讨论）
    this.loadChat();
  }

  loadChat() {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
        this.messages = data.messages || [];
        this.channels = new Map(Object.entries(data.channels || {}));
      }
    } catch (error) {
      console.error('Failed to load chat:', error);
    }
  }

  saveChat() {
    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data = {
      messages: this.messages.slice(-500),
      channels: Object.fromEntries(this.channels),
      lastUpdated: new Date().toISOString()
    };
    fs.writeFileSync(this.configPath, JSON.stringify(data, null, 2));
  }

  /** 获取 Agent 的协同状态 */
  isAgentEnabled(agentId) {
    return !this.disabledAgents.has(agentId);
  }

  /** 切换 Agent 的协同状态 */
  toggleAgent(agentId) {
    if (this.disabledAgents.has(agentId)) {
      this.disabledAgents.delete(agentId);
    } else {
      this.disabledAgents.add(agentId);
    }
    return this.isAgentEnabled(agentId);
  }

  /** 获取所有启用的 Agent */
  getEnabledAgents() {
    return this.getParticipants().filter(p => !this.disabledAgents.has(p.id));
  }

  /** 获取所有禁用的 Agent ID */
  getDisabledAgents() {
    return Array.from(this.disabledAgents);
  }

  _isKnownAgent(agentId) {
    if (AI_AGENT_IDS.includes(agentId)) return true;
    try {
      const cfg = loadConfig();
      return !!(cfg.agents && cfg.agents[agentId]);
    } catch { return false; }
  }

  addParticipant(agentId) {
    if (!this._isKnownAgent(agentId)) {
      return null;
    }

    const agentConfig = loadConfig();
    const agent = agentConfig.agents[agentId];
    if (!agent) return null;

    const participant = {
      id: agentId,
      name: agent.profile.name,
      role: agent.role,
      status: 'online',
      joinedAt: new Date().toISOString()
    };

    this.participants.set(agentId, participant);
    return participant;
  }

  sendMessage(senderId, content, type = 'discussion', channel = 'general', outputType = 'text', outputMeta = {}) {
    const sender = this.participants.get(senderId);

    if (senderId === ADMIN_ID) {
      const message = {
        id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        senderId: ADMIN_ID,
        senderName: '管理员',
        senderRole: 'admin',
        content,
        type,
        outputType,
        outputMeta,
        channel: channel || 'general',
        timestamp: new Date().toISOString(),
        reactions: [],
        replies: []
      };
      this.messages.push(message);
      this.saveChat();
      return { success: true, message };
    }

    if (!sender) {
      if (this._isKnownAgent(senderId)) {
        this.addParticipant(senderId);
      } else {
        return { error: 'Participant not found or not an AI agent' };
      }
    }

    const message = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      senderId,
      senderName: sender ? sender.name : senderId,
      senderRole: sender ? sender.role : 'assistant',
      content,
      type,
      outputType: outputType || 'text',
      outputMeta: outputMeta || {},
      channel: channel || 'general',
      timestamp: new Date().toISOString(),
      reactions: [],
      replies: []
    };

    this.messages.push(message);
    this.saveChat();

    return { success: true, message };
  }

  /**
   * 路由到合适的 Agent(s) — 支持多 Agent 同时回复
   */
  routeToAgents(content, senderId) {
    const availableAgents = this.getParticipants().filter(p => p.id !== senderId && !this.disabledAgents.has(p.id));
    if (availableAgents.length === 0) return [];

    // 1. @mention → 定向指定 Agent
    const mentionMatches = content.match(/@(\w[\w-]*)/g);
    if (mentionMatches) {
      const mentioned = [];
      for (const match of mentionMatches) {
        const agentId = match.slice(1);
        const agent = availableAgents.find(a => a.id === agentId);
        if (agent) mentioned.push(agent);
      }
      if (mentioned.length > 0) return mentioned;
    }

    const lowerContent = content.toLowerCase();

    // 2. 纯浏览器任务 → 只路由给 agent-browser
    const browserExclusive = ['截图', 'screenshot', '截屏'];
    for (const kw of browserExclusive) {
      if (lowerContent.includes(kw)) {
        const agent = availableAgents.find(a => a.id === 'agent-browser');
        if (agent) return [agent];
      }
    }

    // 3. 搜索/调研优先路由给 agent-browser + 一个通用 agent
    const browserPriority = ['搜索', '查找', '查一下', '调研', '调查', '网页', '网站', '新闻', '资讯', '最新消息', 'google', '百度', '打开网页', '访问'];
    let hasBrowserPriority = false;
    for (const kw of browserPriority) {
      if (lowerContent.includes(kw)) {
        hasBrowserPriority = true;
        break;
      }
    }

    if (hasBrowserPriority) {
      const selected = [];
      const browserAgent = availableAgents.find(a => a.id === 'agent-browser');
      if (browserAgent) selected.push(browserAgent);
      const others = availableAgents.filter(a => a.id !== 'agent-browser').slice(0, 2);
      selected.push(...others);
      if (selected.length > 0) return selected;
    }

    // 4. 一般讨论 → 所有 Agent 都参与
    return availableAgents;
  }

  buildPrompt(agent, recentMessages, newMessage) {
    if (agent.id === 'agent-browser') {
      const lower = newMessage.content.toLowerCase();
      if (lower.includes('截图') || lower.includes('screenshot')) {
        const url = newMessage.content.replace(/截图|screenshot/gi, '').trim() || 'https://example.com';
        return { action: 'screenshot', text: url };
      }
      if (lower.includes('搜索') || lower.includes('新闻') || lower.includes('查') || lower.includes('搜')) {
        const query = newMessage.content.replace(/搜索|查找|查一下|查|搜一下|搜|最新的|关于/gi, '').trim() || 'technology';
        return { action: 'search', text: query };
      }
      // 一般聊天给角色上下文
      const historyCtx = recentMessages.slice(-3).map(m => {
        if (m.senderId === 'admin') return `用户: ${m.content}`;
        return `${m.senderName}: ${m.content}`;
      }).join(' | ');
      const ctx = `你是Agent Browser（研究员）。对话背景：${historyCtx}。用户最新说：${newMessage.content}。请从研究员角度简要回复。`;
      return { action: 'chat', text: ctx };
    }

    const roleName = ROLES[agent.role]?.name || agent.role;

    const history = recentMessages.slice(-5).map(m => {
      if (m.senderId === 'admin') return `用户: ${m.content}`;
      return `${m.senderName}(${ROLES[m.senderRole]?.name || m.senderRole}): ${m.content}`;
    }).join('\n');

    const teammateList = this.getParticipants().map(p =>
      `- ${p.name}（${ROLES[p.role]?.name || p.role}）`
    ).join('\n');

    const roleFrames = {
      architect: `## 思维方式
1. 先拆解需求，识别核心系统边界
2. 分析技术选型的 trade-off（性能/可维护性/扩展性/成本）
3. 给出分层结构或模块划分建议
4. 指出潜在的技术债务风险

## 表达风格
- 结构清晰，多用「第一、第二、第三」或「方案A/方案B」对比
- 每个结论给出理由（"因为…所以…"）
- 控制篇幅在 3-5 个要点，不要写论文`,

      developer: `## 思维方式
1. 理解需求后直接想「怎么实现」
2. 拆解为具体的数据结构、接口、模块
3. 考虑边界条件和异常处理
4. 关注代码的可测试性和可维护性

## 表达风格
- 直接说「我来实现」/「这里可以用…」
- 给出代码思路或伪代码级别的说明
- 附带工作量估算（"大概 2 小时"、"这个不难"）
- 说话干脆，不绕弯`,

      fast: `## 思维方式
1. 第一反应：「最快出活的方式是什么？」
2. 优先判断能不能用现成方案 / 已有库 / 模板
3. 不纠结完美主义，追求「先跑起来」
4. 对复杂方案主动提出简化建议

## 表达风格
- 话少、快、直接
- 用「搞定」「可以」「没问题」「简化一下」「先上线再说」
- 单次回复不超过 3 句话
- 觉得方案太重就直说：太复杂了，我换个思路`,

      researcher: `## 思维方式
1. 基于数据和信息做判断，不靠直觉
2. 对比多个来源，甄别可靠性
3. 给出事实性结论而不是模糊建议

## 表达风格
- 以「数据显示」「根据…」「研究表明」开头
- 量化优先：带数字、比例、排名
- 如果信息不足直接说「这个需要进一步调研」
- 给出具体的调研来源或方向`,

      tester: `## 思维方式
1. 凡事想「这可能会怎么挂」
2. 列出正常路径、异常路径、边界条件
3. 关注测试覆盖率和自动化可行性
4. 对模糊的需求主动追问

## 表达风格
- 开头先说潜在风险
- 用「如果…就会…」的句式
- 建议具体可执行的测试方案
- 对缺少信息的地方追问：这个场景下的预期行为是什么？`,

      analyst: `## 思维方式
1. 把问题量化：规模、频率、影响范围
2. 横向对比：行业标准 / 竞品 / 历史数据
3. 归因分析：找出根本原因，不只是表象
4. 给出可衡量的指标

## 表达风格
- 数据驱动：用数字说话
- 结构：现状 → 分析 → 结论 → 建议
- 用「从…数据来看」「…的比例是…」
- 如果数据不足，明确说明假设前提`,

      operator: `## 思维方式
1. 先看稳定性：部署、监控、容灾
2. 考虑运维成本：CI/CD、日志、告警
3. 关注可观测性和故障恢复
4. 安全优先：权限、密钥、网络安全

## 表达风格
- 务实、保守、稳妥优先
- 关注「怎么部署」「怎么监控」「出问题了怎么办」
- 给出具体的运维方案和工具推荐
- 遇到激进方案会提醒风险`,

      assistant: `## 思维方式
1. 先理解用户真正想要什么
2. 整理和归纳现有信息
3. 辅助决策：提供选项而不是替人决定
4. 关注文档化和知识沉淀

## 表达风格
- 耐心、详细、有条理
- 多用「我整理了一下」「总结一下」
- 用表格或列表归纳信息
- 说话温和，不强势`,

      commander: `## 思维方式
1. 先理解用户的真实需求和上下文
2. 汇总各角色的观点，做全局判断
3. 给出明确的决策建议或行动方案
4. 协调冲突观点，推动团队前进

## 表达风格
- 全局视角，说话有分量
- 用「我的判断是」「建议优先…」「总结一下各方观点」
- 直接给结论 + 理由，不绕圈子
- 像项目负责人一样说话，既有高度又有落地感`
    };

    const defaultFrame = `## 思维方式
1. 理解问题和上下文
2. 给出专业、具体的建议
3. 结合团队目标

## 表达风格
- 逻辑清晰
- 有实质内容，不说空话`;

    const frame = roleFrames[agent.role] || defaultFrame;

    // 如果有自定义 prompt，用它完全替代角色框架
    const agentConfig = loadConfig();
    const agentData = agentConfig.agents[agent.id];
    const customPrompt = agentData?.customPrompt || '';

    let promptBody;
    if (customPrompt) {
      promptBody = customPrompt;
    } else {
      promptBody = `## 你的角色框架
${frame}

## 重要规则
- 不要重复你或别人说过的话，每次都要根据最新消息给出新的见解
- 如果用户只是打招呼（"在吗""hi""hello"），简单回应后主动问任务方向
- 如果当前没有明确任务，可以主动提议下一步做什么
- 回复要贴合当前最新消息，忽略过时的历史`;
    }

    const fullPrompt = `你是${agent.name}，团队中的【${roleName}】。

## 团队构成
${teammateList}

${promptBody}

## 当前对话
${history}

## 你的回复
${agent.name}（${roleName}）视角：`;
    return { action: 'chat', text: fullPrompt };
  }

  async agentReply(agent, messageContext) {
    const promptData = this.buildPrompt(agent, this.getRecentMessages(), messageContext);
    const prompt = typeof promptData === 'object' && promptData.text ? promptData.text : promptData;
    const action = promptData.action || 'chat';

    try {
      const timeout = agent.id === 'hermes' ? 120000 : 60000;
      const result = await callAgent(agent.id, prompt, {
        timeout,
        action,
        conversationContext: JSON.stringify(messageContext)
      });

      return {
        agent,
        success: !result.error,
        content: result.content,
        outputType: result.outputType,
        outputMeta: result.outputMeta,
        error: result.error
      };
    } catch (err) {
      console.error(`[Chat] Agent ${agent.id} reply error:`, err.message);
      return {
        agent,
        success: false,
        content: `处理请求时遇到了问题。`,
        outputType: 'text',
        outputMeta: {},
        error: err.message
      };
    }
  }

  async startDiscussion(originalMessage, onReply = null) {
    const channel = originalMessage.channel || 'general';
    const targetAgents = this.routeToAgents(originalMessage.content, originalMessage.senderId);
    if (targetAgents.length === 0) return [];

    const discussionId = `disc-${Date.now()}`;
    const allMessages = [];

    // 如果关闭了协同（collaboration），走简单并行回复
    if (!this.collaborationEnabled) {
      return this._simpleParallelReply(targetAgents, originalMessage, channel, onReply, discussionId);
    }

    const commander = targetAgents.find(a => a.role === 'commander' || a.id === 'aria');
    const nonCommander = targetAgents.filter(a => a !== commander);
    const participants = commander ? [commander, ...nonCommander] : targetAgents;

    this.activeDiscussions.set(discussionId, {
      originalMessageId: originalMessage.id,
      agents: participants.map(a => a.id),
      replies: [],
      status: 'running',
      startedAt: new Date().toISOString()
    });

    // =========================================================
    // Phase 1: 指挥官分析任务（仅指挥官发言）
    // =========================================================
    if (commander) {
      const roleName = ROLES[commander.role]?.name || commander.role;
      const memberDescs = nonCommander.map(a =>
        `- ${a.name}（${ROLES[a.role]?.name || a.role}）：${(AGENT_PROFILES[a.id]?.strengths || ['通用能力']).join('、')}`
      ).join('\n');

      const planPrompt = `你是${commander.name}，团队中的【${roleName}】，负责团队协调与任务分配。

## 团队成员
${memberDescs}

## 用户需求
${originalMessage.content}

## 你的任务
作为指挥官，请分析用户需求并给出：
1. **任务拆解**：把整体需求拆成 2-4 个可执行子任务
2. **角色分工**：每个子任务最适合分配给哪位成员（基于他们的角色和技能）
3. **执行优先级**：先做什么后做什么
4. **预期产出**：每个子任务应该输出什么

要求：
- 直接给出计划，不需要征得同意
- 说话要像一个负责的项目负责人
- 标注清楚每个任务由谁负责`;

      try {
        const result = await callAgent(commander.id, planPrompt, { timeout: 60000, retry: false, action: 'chat' });
        if (result && !result.error) {
          const msgResult = this.sendMessage(commander.id, result.content, 'discussion', channel,
            result.outputType, result.outputMeta);
          if (msgResult.success) {
            allMessages.push(msgResult.message);
            if (onReply) onReply(msgResult.message);
          }
        }
      } catch (e) {
        console.error(`[Chat] Commander ${commander.id} failed:`, e.message);
      }
    }

    // =========================================================
    // Phase 2: 瀑布式讨论 — 每人顺序发言，后发言者参考前面所有内容
    // =========================================================
    if (nonCommander.length > 0) {
      const planContent = allMessages.length > 0 ? allMessages[0].content : '（指挥官未输出计划，请自行判断）';

      // 按角色决定发言顺序：架构师→开发者→研究员→其他
      const roleOrder = ['architect', 'developer', 'researcher', 'assistant', 'tester', 'analyst', 'operator', 'fast'];
      const sorted = [...nonCommander].sort((a, b) => {
        const ai = roleOrder.indexOf(a.role);
        const bi = roleOrder.indexOf(b.role);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      });

      for (const agent of sorted) {
        const roleName = ROLES[agent.role]?.name || agent.role;

        // 收集本轮前面已发言队友的内容
        const prevSpeakers = allMessages
          .filter(m => m.senderId !== 'admin')
          .map(m => `【${m.senderName}（${ROLES[m.senderRole]?.name || m.senderRole}）】\n${m.content}`)
          .join('\n\n');

        const teammateList = this.getParticipants().map(p =>
          `- ${p.name}（${ROLES[p.role]?.name || p.role}）`
        ).join('\n');

        const prompt = `你是${agent.name}，团队中的【${roleName}】。

## 团队成员
${teammateList}

## 用户需求
${originalMessage.content}

## 指挥官的计划
${planContent}

## 前面队友的发言
${prevSpeakers || '（你是第一个发言的成员）'}

## 你的任务
现在到你发言了。请阅读以上所有内容，然后：

1. **如果前面队友的观点有遗漏或错误**，请直接指出并补充
2. **如果同意前面的观点**，在此基础上增加你的专业视角
3. **你的发言要针对性回应前面队友** — 直接引用他们的观点，说"同意"或"补充"或"我有不同看法"
4. 最后给出你的专业建议

## 发言要求
- 以"@某某"的方式直接回应特定队友
- 不要对用户说话，要对队友说话
- 每句话都要有实质内容
- 如果你觉得前面已经有人说得够完整了，就说"我同意前面观点，没有补充"`;

        try {
          const result = await callAgent(agent.id, prompt, { timeout: 40000, retry: false, action: 'chat' });
          if (result && !result.error) {
            const content = result.content.trim();
            if (content && !content.includes('没有补充')) {
              const msgResult = this.sendMessage(agent.id, content, 'discussion', channel,
                result.outputType, result.outputMeta);
              if (msgResult.success) {
                allMessages.push(msgResult.message);
                if (onReply) onReply(msgResult.message);
              }
            }
          }
        } catch (e) {
          console.error(`[Chat] Agent ${agent.id} phase2 skip (${e.message})`);
        }
      }
    }

    // =========================================================
    // Phase 3: 指挥官最终总结（综合所有观点）
    // =========================================================
    if (commander) {
      const memberReplies = allMessages
        .filter(m => m.senderId !== commander.id && m.senderId !== 'admin')
        .map(m => `【${m.senderName}（${ROLES[m.senderRole]?.name || m.senderRole}）】\n${m.content}`)
        .join('\n\n');

      if (memberReplies) {
        const finalPrompt = `你是${commander.name}，团队指挥官。

## 原始需求
${originalMessage.content}

## 你的计划
${allMessages.length > 0 ? allMessages[0].content : ''}

## 团队成员讨论汇总
${memberReplies}

## 你的任务
作为指挥官，请阅读以上所有讨论，然后给出完整的总结报告：

1. **最终方案**：综合了哪些人的意见，敲定什么方案
2. **分工指令**：用"@某某：你负责……"的格式直接下达指令
3. **执行时间线**：建议的先做什么、后做什么
4. **待确认**：如果还需要用户决策，列出来

## 要求
- 以指挥官身份下达最终指令
- 直接引用某个队友的具体观点，展示你考虑过了
- 如果成员之间有分歧，给出你的裁决`;

        try {
          const result = await callAgent(commander.id, finalPrompt, { timeout: 60000, retry: false, action: 'chat' });
          if (result && !result.error) {
            const msgResult = this.sendMessage(commander.id, result.content, 'discussion', channel,
              result.outputType, result.outputMeta);
            if (msgResult.success) {
              allMessages.push(msgResult.message);
              if (onReply) onReply(msgResult.message);
            }
          }
        } catch (e) {
          console.error(`[Chat] Commander final failed:`, e.message);
        }
      }
    }

    const discussion = this.activeDiscussions.get(discussionId);
    if (discussion) {
      discussion.status = 'completed';
      discussion.completedAt = new Date().toISOString();
      discussion.totalRounds = allMessages.length;
    }

    return allMessages;
  }

  // 简单并行回复（不启用协同时用）
  async _simpleParallelReply(agents, originalMessage, channel, onReply, discussionId) {
    const allResults = [];
    const round = agents.map(async (agent) => {
      try {
        const promptData = this.buildPrompt(agent, this.getRecentMessages(), originalMessage);
        const prompt = typeof promptData === 'object' && promptData.text ? promptData.text : promptData;
        const action = promptData.action || 'chat';

        const result = await callAgent(agent.id, prompt, { timeout: 40000, retry: false, action });
        if (result && !result.error) {
          const msgResult = this.sendMessage(agent.id, result.content, 'discussion', channel,
            result.outputType, result.outputMeta);
          if (msgResult.success) {
            allResults.push(msgResult.message);
            if (onReply) onReply(msgResult.message);
          }
        }
      } catch (e) {
        console.error(`[Chat] Simple reply ${agent.id} error:`, e.message);
      }
    });
    await Promise.allSettled(round);

    const discussion = this.activeDiscussions.get(discussionId);
    if (discussion) {
      discussion.status = 'completed';
      discussion.completedAt = new Date().toISOString();
    }
    return allResults;
  }

  _getRoleFrame(roleId) {
    const frames = {
      architect: `## 专业视角
- 关注架构合理性、扩展性、技术选型
- 考虑边界和系统间的关系
- 识别潜在的技术债务`,
      developer: `## 专业视角
- 关注实现路径、数据结构和接口
- 考虑代码质量和可测试性
- 估算工作量`,
      researcher: `## 专业视角
- 需要做信息调研和数据分析
- 给出事实性结论
- 如果信息不足，说明需要调研的内容`,
      tester: `## 专业视角
- 关注测试策略和边界条件
- 识别潜在风险
- 给出具体测试方案`,
      analyst: `## 专业视角
- 从数据角度分析问题
- 量化评估方案优劣
- 给出衡量指标`,
      operator: `## 专业视角
- 关注部署、运维、监控
- 评估运行稳定性
- 关注安全和权限`,
      assistant: `## 专业视角
- 辅助决策，提供归纳整理
- 关注文档化和知识沉淀
- 确保信息完整清晰`,
      commander: `## 专业视角
- 全局视野，协调各方
- 推动团队前进
- 做最终决策`,
      fast: `## 专业视角
- 优先快速出活
- 简化方案，降低复杂度
- 用现成方案解决`
    };
    return frames[roleId] || frames.assistant;
  }

  getRecentMessages(count = 10) {
    return this.messages.slice(-count);
  }

  getChannelMessages(channel = 'general', limit = 50) {
    return this.messages
      .filter(m => m.channel === channel)
      .slice(-limit);
  }

  getParticipants() {
    return Array.from(this.participants.values());
  }

  createChannel(name, description, allowedRoles = []) {
    const channel = {
      name,
      description,
      allowedRoles,
      createdAt: new Date().toISOString()
    };
    this.channels.set(name, channel);
    this.saveChat();
    return channel;
  }
}

module.exports = { AgentChat, MESSAGE_TYPES };
