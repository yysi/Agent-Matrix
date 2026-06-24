const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const { exec, execSync } = require('child_process');
const { AgentRegistry } = require('./agent-registry');
const { AgentChat } = require('../core/chat');
const { callAgent, OUTPUT_TYPES } = require('../core/agent-executor');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;
const DATA_DIR = path.join(__dirname, '..', 'data');
const LOGS_DIR = path.join(__dirname, '..', 'logs');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

const agentRegistry = new AgentRegistry();
const agentChat = new AgentChat();

const discoveredAgents = agentRegistry.discoverAgents();
console.log(`发现 ${discoveredAgents.length} 个新 Agent`);

const tasks = new Map();

function syncAgentsFromRegistry() {
  const registryAgents = agentRegistry.getAllAgents();
  for (const agent of registryAgents) {
    agents.set(agent.id, {
      id: agent.id,
      name: agent.profile.name,
      tool: agent.command,
      role: agent.role,
      status: agent.status || 'idle',
      model: agent.profile.model,
      currentTask: agent.currentTask,
      profile: agent.profile
    });
    agentChat.addParticipant(agent.id);
  }
}

const agents = new Map();
syncAgentsFromRegistry();

// 注册内置 AI 指挥官
const { AGENT_PROFILES } = require('../config/profiles');
const ariaProfile = AGENT_PROFILES.aria;
agentRegistry.registerBuiltin('aria', ariaProfile, 'commander');
agents.set('aria', {
  id: 'aria',
  name: ariaProfile.name,
  tool: 'aria',
  role: 'commander',
  status: 'idle',
  model: ariaProfile.model,
  currentTask: null,
  profile: ariaProfile
});
agentChat.addParticipant('aria');
console.log('👑 Aria (AI Commander) registered');

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/api/agents', (req, res) => {
  res.json(Array.from(agents.values()));
});

app.get('/api/roles', (req, res) => {
  res.json(agentRegistry.getAllRoles());
});

app.post('/api/roles', (req, res) => {
  const { id, name, icon, description } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'id and name required' });
  const result = agentRegistry.addRole(id, { name, icon, description });
  if (result.error) return res.status(409).json(result);
  io.emit('roles-updated');
  res.json(result);
});

app.put('/api/roles/:id', (req, res) => {
  const { name, icon, description } = req.body;
  const result = agentRegistry.updateRole(req.params.id, { name, icon, description });
  if (result.error) return res.status(400).json(result);
  io.emit('roles-updated');
  res.json(result);
});

app.delete('/api/roles/:id', (req, res) => {
  const result = agentRegistry.deleteRole(req.params.id);
  if (result.error) return res.status(400).json(result);
  io.emit('roles-updated');
  res.json(result);
});

app.get('/api/agents/stats', (req, res) => {
  res.json(agentRegistry.getStats());
});

// ============ 每个 Agent 独立协同开关 ============

/** 获取所有 Agent 的协同状态 */
app.get('/api/agents/collaboration', (req, res) => {
  const disabled = agentChat.getDisabledAgents();
  const participants = agentChat.getParticipants();
  const states = {};
  for (const p of participants) {
    states[p.id] = !disabled.includes(p.id);
  }
  res.json(states);
});

/** 切换单个 Agent 的协同状态 */
app.post('/api/agents/:id/collaboration', (req, res) => {
  const enabled = agentChat.toggleAgent(req.params.id);
  io.emit('agent-collaboration', { agentId: req.params.id, enabled });
  res.json({ agentId: req.params.id, enabled });
});

app.post('/api/agents/discover', (req, res) => {
  const discovered = agentRegistry.discoverAgents();
  syncAgentsFromRegistry();

  for (const agent of discovered) {
    io.emit('agent-discovered', {
      id: agent.id,
      name: agent.profile.name,
      tool: agent.command,
      role: agent.role,
      status: 'idle',
      model: agent.profile.model,
      profile: agent.profile
    });
  }

  res.json({ discovered: discovered.length, agents: discovered });
});

// 注册自定义 Agent
app.post('/api/agents', (req, res) => {
  const { command, name, role, customPrompt, model, emoji } = req.body;
  if (!command) return res.status(400).json({ error: 'command required' });
  const result = agentRegistry.registerAgent({
    id: command,
    command,
    name: name || command,
    role: role || 'assistant',
    customPrompt: customPrompt || '',
    model: model || 'Custom',
    emoji: emoji || '🔧',
    capabilities: ['general'],
    strengths: ['自定义工具'],
    cost: 'unknown'
  });
  if (result.error) return res.status(409).json(result);

  const agent = result.agent;
  agents.set(agent.id, {
    id: agent.id,
    name: agent.profile.name,
    tool: agent.command,
    role: agent.role,
    status: 'idle',
    model: agent.profile.model,
    currentTask: null,
    profile: agent.profile
  });
  agentChat.addParticipant(agent.id);
  io.emit('agent-discovered', {
    id: agent.id,
    name: agent.profile.name,
    tool: agent.command,
    role: agent.role,
    status: 'idle',
    model: agent.profile.model,
    profile: agent.profile
  });
  res.json(result);
});

app.put('/api/agents/:id/role', (req, res) => {
  const { role } = req.body;
  if (!role) return res.status(400).json({ error: 'Role is required' });

  const agent = agentRegistry.updateAgentRole(req.params.id, role);

  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  const memAgent = agents.get(req.params.id);
  if (memAgent) {
    memAgent.role = role;
  }

  io.emit('agent-updated', memAgent || agent);
  res.json(agent);
});

app.delete('/api/agents/:id', (req, res) => {
  const deleted = agentRegistry.removeAgent(req.params.id);

  if (deleted) {
    agents.delete(req.params.id);
    io.emit('agent-removed', req.params.id);
  }

  res.json({ success: deleted });
});

app.get('/api/agents/:id/recommend', (req, res) => {
  const recommendedRole = agentRegistry.recommendRole(req.params.id);
  res.json({ agentId: req.params.id, recommendedRole });
});

app.post('/api/agents/recommend-all', (req, res) => {
  const updates = agentRegistry.updateAllRecommendations();
  res.json({ updates });
});

// 测试 Agent 连通性
app.post('/api/agents/:id/test', async (req, res) => {
  const agent = agents.get(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const startTime = Date.now();
  try {
    const { callAgent } = require('../core/agent-executor');
    const testPrompt = '回复"在线"两个字即可。';
    const timeout = agent.tool === 'mimo' ? 60000 : 30000;
    const result = await callAgent(agent.tool || agent.id, testPrompt, { timeout });
    const elapsed = Date.now() - startTime;
    // 清理 claude 的 stdin warning
    const clean = result.content.replace(/Warning:.*?proceeding without it\./g, '').trim();
    res.json({
      success: !result.error,
      content: clean || result.content,
      elapsed,
      error: result.error
    });
  } catch (err) {
    res.json({ success: false, error: err.message, elapsed: Date.now() - startTime });
  }
});

// 一键测试所有 Agent
app.post('/api/agents/test-all', async (req, res) => {
  const { callAgent } = require('../core/agent-executor');
  const results = [];
  for (const [id, agent] of agents) {
    const startTime = Date.now();
    try {
      const testPrompt = '用一句话简单回复，表明你在线即可。';
      const result = await callAgent(agent.tool || id, testPrompt, { timeout: 30000 });
      results.push({
        id,
        name: agent.name,
        success: !result.error,
        content: result.content,
        elapsed: Date.now() - startTime,
        error: result.error
      });
    } catch (err) {
      results.push({ id, name: agent.name, success: false, error: err.message, elapsed: Date.now() - startTime });
    }
  }
  res.json(results);
});

// ============ 聊天 API ============

app.get('/api/chat/participants', (req, res) => {
  res.json(agentChat.getParticipants());
});

app.get('/api/chat/messages/:channel', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const messages = agentChat.getChannelMessages(req.params.channel, limit);
  res.json(messages);
});

app.post('/api/chat/messages', async (req, res) => {
  const { senderId, content, type, channel } = req.body;
  if (!senderId || !content) return res.status(400).json({ error: 'senderId and content required' });

  let result;

  if (senderId === 'admin') {
    result = {
      success: true,
      message: {
        id: `msg-${Date.now()}`,
        senderId: 'admin',
        senderName: '管理员',
        senderRole: 'admin',
        content,
        type,
        outputType: 'text',
        outputMeta: {},
        channel: channel || 'general',
        timestamp: new Date().toISOString(),
        reactions: [],
        replies: []
      }
    };
    agentChat.messages.push(result.message);
    agentChat.saveChat();
  } else {
    if (!agentChat.participants.has(senderId)) {
      agentChat.addParticipant(senderId);
    }
    result = agentChat.sendMessage(senderId, content, type, channel);
  }

  if (result.success) {
    io.emit('chat-message', result.message);

    // 管理员消息 → 触发多 Agent 实时回复（routeToAgents 内部会过滤被禁用的 Agent）
    if (senderId === 'admin') {
      setImmediate(async () => {
        await triggerRealDiscussion(result.message);
      });
    }
  }

  res.json(result);
});

/**
 * 触发多 Agent 实时讨论
 * - 先广播所有参与 Agent 的思考中状态
 * - 并发调用 Agent，每完成一个立即推送到前端
 */
async function triggerRealDiscussion(originalMessage) {
  try {
    const targetAgents = agentChat.routeToAgents(originalMessage.content, originalMessage.senderId);

    // 广播所有 Agent 的思考中状态
    for (const agent of targetAgents) {
      io.emit('agent-thinking', {
        agentId: agent.id,
        agentName: agent.name
      });
    }

    // 每完成一个 Agent 立即回调推送
    const replies = await agentChat.startDiscussion(originalMessage, (message) => {
      io.emit('chat-message', message);
    });
  } catch (err) {
    console.error('[Discussion] Error:', err.message);
  }
}

app.post('/api/chat/channels', (req, res) => {
  const { name, description, allowedRoles } = req.body;
  if (!name) return res.status(400).json({ error: 'Channel name required' });
  const channel = agentChat.createChannel(name, description, allowedRoles);
  res.json(channel);
});

// ============ 任务 API ============

app.get('/api/tasks', (req, res) => {
  res.json(Array.from(tasks.values()));
});

app.post('/api/tasks', (req, res) => {
  const { name, requirement } = req.body;
  if (!name || !requirement) return res.status(400).json({ error: 'Name and requirement required' });

  const taskId = `task-${Date.now()}`;
  const task = {
    id: taskId,
    name,
    requirement,
    status: 'pending',
    progress: 0,
    phases: {
      research: { status: 'pending', agent: 'researcher' },
      design: { status: 'pending', agent: 'architect' },
      implement: { status: 'pending', agent: 'developer' },
      review: { status: 'pending', agent: 'architect' }
    },
    createdAt: new Date().toISOString(),
    logs: []
  };
  tasks.set(taskId, task);
  io.emit('task-created', task);
  res.json(task);
});

app.post('/api/tasks/:id/execute', async (req, res) => {
  const task = tasks.get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  task.status = 'running';
  task.paused = false;
  io.emit('task-updated', task);

  setImmediate(() => executeWorkflow(task));
  res.json(task);
});

app.post('/api/tasks/:id/pause', (req, res) => {
  const task = tasks.get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  task.paused = true;
  io.emit('task-updated', task);
  res.json(task);
});

app.post('/api/tasks/:id/resume', (req, res) => {
  const task = tasks.get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  task.paused = false;
  io.emit('task-updated', task);
  res.json(task);
});

app.post('/api/tasks/:id/cancel', (req, res) => {
  const task = tasks.get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  task.status = 'cancelled';
  task.cancelled = true;

  for (const [phaseName, phase] of Object.entries(task.phases)) {
    if (phase.status === 'running') {
      const agent = agents.get(phase.agent);
      if (agent) {
        agent.status = 'idle';
        agent.currentTask = null;
        io.emit('agent-updated', agent);
      }
    }
  }

  addLog(task, 'system', 'cancelled', '任务已终止');
  io.emit('task-updated', task);
  res.json(task);
});

app.delete('/api/tasks/:id', (req, res) => {
  const task = tasks.get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  tasks.delete(req.params.id);
  io.emit('task-deleted', req.params.id);
  res.json({ success: true });
});

app.delete('/api/tasks', (req, res) => {
  tasks.clear();
  io.emit('tasks-cleared');
  res.json({ success: true });
});

app.get('/api/tasks/:id/logs', (req, res) => {
  const task = tasks.get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task.logs);
});

app.post('/api/agents/:id/status', (req, res) => {
  const agent = agents.get(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  agent.status = req.body.status;
  agent.currentTask = req.body.taskId || null;
  io.emit('agent-updated', agent);
  res.json(agent);
});

// ============ 命令执行 API（白名单模式） ============

const ALLOWED_COMMANDS = [
  'npm', 'pnpm', 'yarn', 'node', 'python3', 'python',
  'git', 'docker', 'ls', 'cat', 'pwd', 'echo', 'date',
  'whoami', 'uname', 'which', 'open', 'code', 'curl', 'wget',
  'mkdir', 'touch', 'cp', 'mv', 'rm', 'chmod', 'head', 'tail',
  'grep', 'sort', 'wc', 'find', 'du', 'df', 'ps', 'top'
];

function isCommandAllowed(command) {
  const cmdName = command.trim().split(/\s+/)[0];
  return ALLOWED_COMMANDS.includes(cmdName);
}

app.post('/api/execute/command', async (req, res) => {
  const { command, timeout } = req.body;
  if (!command) return res.status(400).json({ error: 'No command provided' });

  if (!isCommandAllowed(command)) {
    return res.status(403).json({ error: 'Command not in whitelist', allowed: ALLOWED_COMMANDS });
  }

  try {
    const maxTime = Math.min(timeout || 30000, 120000);
    const output = execSync(command, { timeout: maxTime, encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 });
    res.json({ success: true, output: output.trim(), exitCode: 0 });
  } catch (err) {
    res.json({
      success: true,
      output: (err.stdout || '') + (err.stderr ? '\n' + err.stderr : ''),
      exitCode: err.status || 1
    });
  }
});

app.post('/api/execute/browser', async (req, res) => {
  const { action, prompt } = req.body;
  if (!action || !prompt) return res.status(400).json({ error: 'Action and prompt required' });

  const { BROWSER_ACTIONS } = require('../core/agent-executor');
  const actionConfig = BROWSER_ACTIONS[action] || BROWSER_ACTIONS.default;

  try {
    const cmd = actionConfig.template
      .replace('{prompt}', prompt.replace(/"/g, '\\"'))
      .replace('{query}', encodeURIComponent(prompt));

    const output = execSync(cmd, { timeout: 60000, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    res.json({ success: true, output: output.trim() });
  } catch (err) {
    res.json({
      success: true,
      output: (err.stdout || err.message || '').trim(),
      exitCode: err.status || 1
    });
  }
});

// WebSocket
io.on('connection', (socket) => {
  console.log('Client connected');

  socket.emit('init', {
    agents: Array.from(agents.values()),
    tasks: Array.from(tasks.values()),
    roles: agentRegistry.getAllRoles(),
    stats: agentRegistry.getStats()
  });

  socket.on('discover-agents', () => {
    const discovered = agentRegistry.discoverAgents();
    syncAgentsFromRegistry();
    // 统一用复数事件名
    io.emit('agents-discovered', {
      discovered: discovered.length,
      agents: Array.from(agents.values())
    });
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

// 工作流执行
async function executeWorkflow(task) {
  const phases = ['research', 'design', 'implement', 'review'];

  for (const phase of phases) {
    if (task.cancelled) {
      addLog(task, 'system', 'info', '任务已终止，停止执行');
      return;
    }

    if (task.paused) {
      await new Promise((resolve) => {
        const check = setInterval(() => {
          if (!task.paused || task.cancelled) {
            clearInterval(check);
            resolve();
          }
        }, 500);
      });
    }

    if (task.cancelled) {
      addLog(task, 'system', 'info', '任务已终止，停止执行');
      return;
    }

    const phaseInfo = task.phases[phase];
    const agentId = phaseInfo.agent;
    const agent = agents.get(agentId);

    if (!agent) {
      phaseInfo.status = 'failed';
      addLog(task, phase, 'failed', `Agent "${agentId}" 未找到`);
      continue;
    }

    if (agent.status === 'busy') {
      phaseInfo.status = 'failed';
      addLog(task, phase, 'failed', `Agent "${agent.name}" 正忙`);
      continue;
    }

    phaseInfo.status = 'running';
    agent.status = 'busy';
    agent.currentTask = task.id;
    io.emit('task-updated', task);
    io.emit('agent-updated', agent);

    addLog(task, phase, 'started', `开始 ${phase} 阶段`);

    try {
      const scriptPath = path.join(__dirname, '..', 'scripts', `${phase}.sh`);
      const result = await executeScript(scriptPath, task.requirement);

      phaseInfo.status = 'completed';
      addLog(task, phase, 'completed', `完成 ${phase} 阶段`);
    } catch (error) {
      phaseInfo.status = 'failed';
      addLog(task, phase, 'failed', `失败: ${error.message}`);
    }

    const completedPhases = phases.filter(p => task.phases[p].status === 'completed').length;
    task.progress = Math.round((completedPhases / phases.length) * 100);

    agent.status = 'idle';
    agent.currentTask = null;
    io.emit('task-updated', task);
    io.emit('agent-updated', agent);
  }

  task.status = task.progress === 100 ? 'completed' : 'failed';
  io.emit('task-updated', task);
}

function executeScript(scriptPath, arg) {
  return new Promise((resolve, reject) => {
    const safeArg = (arg || '').replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
    exec(`bash "${scriptPath}" "${safeArg}"`, { timeout: 60000 }, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

function addLog(task, phase, type, message) {
  task.logs.push({
    timestamp: new Date().toISOString(),
    phase,
    type,
    message
  });
  io.emit('task-log', { taskId: task.id, log: task.logs[task.logs.length - 1] });
}

server.listen(PORT, () => {
  console.log(`🚀 Agent Matrix Dashboard running at http://localhost:${PORT}`);
});
