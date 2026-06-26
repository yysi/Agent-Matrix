// 连接 WebSocket
const socket = io();

// DOM 元素
const agentsGrid = document.getElementById('agents-grid');
const rolesGrid = document.getElementById('roles-grid');
const tasksList = document.getElementById('tasks-list');
const logsContainer = document.getElementById('logs-container');
const connectionStatus = document.getElementById('connection-status');
const chatMessages = document.getElementById('chat-messages');
const chatParticipants = document.getElementById('chat-participants');
const messageInput = document.getElementById('message-input');

// 数据存储
let agents = [];
let tasks = [];
let roles = [];
let stats = {};
let chatData = [];
let participants = [];
let currentChannel = 'general';
let agentCollaboration = {}; // { agentId: true/false }

// ============ WebSocket 事件 ============

socket.on('connect', () => {
  connectionStatus.textContent = '● 已连接';
  connectionStatus.className = 'connection connected';
});

socket.on('disconnect', () => {
  connectionStatus.textContent = '● 已断开';
  connectionStatus.className = 'connection disconnected';
});

socket.on('init', (data) => {
  agents = data.agents;
  tasks = data.tasks;
  roles = data.roles || [];
  stats = data.stats || {};
  renderAll();
  setTimeout(() => { loadParticipants(); loadMessages(); }, 100);
});

socket.on('agent-updated', (agent) => {
  const index = agents.findIndex(a => a.id === agent.id);
  if (index !== -1) agents[index] = agent;
  else agents.push(agent);
  renderAgents();
});

socket.on('agent-discovered', (agent) => {
  if (!agents.find(a => a.id === agent.id)) {
    agents.push(agent);
    renderAgents();
    loadParticipants();
    showToast(`发现新 Agent: ${agent.name}`);
  }
});

socket.on('agent-removed', (agentId) => {
  agents = agents.filter(a => a.id !== agentId);
  renderAgents();
});

socket.on('agents-discovered', (data) => {
  agents = data.agents;
  renderAgents();
  loadParticipants();
  showToast(`扫描完成，发现 ${data.discovered} 个新 Agent`);
});

// Agent 思考中
socket.on('agent-thinking', (data) => {
  showThinkingIndicator(data.agentId, data.agentName);
});

// 聊天消息
socket.on('chat-message', (message) => {
  if (message.channel === currentChannel) {
    // 移除该 Agent 的思考中状态
    removeThinkingIndicator(message.senderId);
    chatData.push(message);
    renderMessages();
  }
});

socket.on('task-updated', (task) => {
  const index = tasks.findIndex(t => t.id === task.id);
  if (index !== -1) tasks[index] = task;
  else tasks.push(task);
  renderTasks();
});

socket.on('task-created', (task) => {
  tasks.push(task);
  renderTasks();
});

socket.on('task-deleted', (taskId) => {
  tasks = tasks.filter(t => t.id !== taskId);
  renderTasks();
});

socket.on('tasks-cleared', () => {
  tasks = [];
  renderTasks();
});

socket.on('task-log', (data) => {
  const task = tasks.find(t => t.id === data.taskId);
  if (task) {
    task.logs.push(data.log);
    renderLogs(task.logs);
  }
});

socket.on('agent-collaboration', (data) => {
  agentCollaboration[data.agentId] = data.enabled;
  renderAgents();
});

socket.on('roles-updated', () => {
  fetch('/api/roles').then(r => r.json()).then(d => { roles = d; renderRoles(); });
});

// ============ 渲染函数 ============

function renderAll() {
  renderAgents();
  renderRoles();
  renderTasks();
  updateStats();
}

function updateStats() {
  document.getElementById('agent-count').textContent = agents.length;
  document.getElementById('task-count').textContent = tasks.length;
}

// --- Agent 卡片 ---
function renderAgents() {
  if (!agents || agents.length === 0) {
    agentsGrid.innerHTML = '<div class="empty-state"><div class="empty-icon">🤖</div><p>暂无 Agent</p><span class="empty-hint">点击 "扫描" 发现系统中可用的 AI 工具</span></div>';
    return;
  }
  const enabled = (id) => agentCollaboration[id] !== false; // 默认 true
  agentsGrid.innerHTML = agents.map(agent => {
    const isEnabled = enabled(agent.id);
    return `
    <div class="agent-card ${agent.status} ${isEnabled ? '' : 'disabled'}">
      <div class="agent-avatar">${getAgentIcon(agent.id)}</div>
<div class="agent-info">
        <div class="agent-name">
          ${agent.name}
        </div>
        <div class="agent-meta">
          ${roleObj ? roleObj.icon + ' ' + roleObj.name : agent.role} · ${agent.model || '-'}
        </div>
        ${agent.profile?.capabilities ? `<div class="agent-caps">${agent.profile.capabilities.map(cap => `<span class="cap-tag">${cap}</span>`).join('')}</div>` : ''}
        <div id="test-result-${agent.id}" class="test-result"></div>
      </div>
      <div class="agent-right">
        <select class="agent-role-select" onchange="changeAgentRole('${agent.id}', this.value)">
          ${roles.map(r => `<option value="${r.id}" ${agent.role === r.id ? 'selected' : ''}>${r.icon} ${r.name}</option>`).join('')}
        </select>
        <button class="btn btn-sm btn-ghost" onclick="testAgent('${agent.id}')" title="测试连通性" style="font-size:14px">🔌</button>
        <button class="btn btn-sm btn-ghost" onclick="removeAgent('${agent.id}')" title="删除 Agent" style="font-size:14px;color:#f85149">✕</button>
        <span class="agent-status-dot ${agent.status}" id="status-${agent.id}"></span>
      </div>
    </div>`;
  }).join('');
  updateStats();
}

/** 切换单个 Agent 的协同状态 */
async function toggleAgentCollaboration(agentId) {
  try {
    const res = await fetch(`/api/agents/${agentId}/collaboration`, { method: 'POST' });
    const data = await res.json();
    agentCollaboration[agentId] = data.enabled;
    renderAgents();
    showToast(`${data.enabled ? '已开启' : '已关闭'} ${agents.find(a => a.id === agentId)?.name || agentId} 的协同`);
  } catch (e) {
    showToast('操作失败', 'error');
  }
}

// --- 角色卡片 ---
function renderRoles() {
  rolesGrid.innerHTML = roles.map(role => `
    <div class="role-card${role.builtin ? '' : ' custom'}" onclick="selectRole('${role.id}', this)">
      <div class="role-icon">${role.icon}</div>
      <div class="role-name">${role.name}</div>
      <div class="role-desc">${role.description}</div>
      ${role.builtin ? '' : `
      <div class="role-actions">
        <button class="btn btn-sm btn-ghost" onclick="event.stopPropagation();editRole('${role.id}')">✏️</button>
        <button class="btn btn-sm btn-ghost" onclick="event.stopPropagation();deleteRole('${role.id}')">🗑️</button>
      </div>`}
    </div>
  `).join('');
}

// --- 任务列表 ---
function renderTasks() {
  if (!tasks || tasks.length === 0) {
    tasksList.innerHTML = '<div class="empty-state"><div class="empty-icon">📝</div><p>暂无任务</p></div>';
    return;
  }
  tasksList.innerHTML = tasks.map(task => `
    <div class="task-card">
      <div class="task-header">
        <div class="task-title">
          <span class="task-name">${escapeHtml(task.name)}</span>
          <span class="task-status ${task.status}">${getStatusText(task.status)}</span>
        </div>
        <div class="task-controls">${renderTaskControls(task)}</div>
      </div>
      <div class="task-progress">
        <div class="progress-bar"><div class="progress-fill" style="width: ${task.progress}%"></div></div>
        <div class="progress-text">${task.progress}%</div>
      </div>
      <div class="task-phases">${renderPhases(task.phases)}</div>
      <div class="task-meta">
        <span class="task-time">${formatTime(task.createdAt)}</span>
      </div>
    </div>
  `).join('');
  updateStats();
}

function renderTaskControls(task) {
  switch (task.status) {
    case 'pending':
      return `<button class="btn btn-primary btn-sm" onclick="executeTask('${task.id}')">▶ 执行</button>
              <button class="btn btn-danger btn-sm" onclick="deleteTask('${task.id}')">✕</button>`;
    case 'running':
      return `<button class="btn btn-warning btn-sm" onclick="pauseTask('${task.id}')">⏸</button>
              <button class="btn btn-danger btn-sm" onclick="cancelTask('${task.id}')">⏹</button>`;
    case 'paused':
      return `<button class="btn btn-primary btn-sm" onclick="resumeTask('${task.id}')">▶</button>
              <button class="btn btn-danger btn-sm" onclick="cancelTask('${task.id}')">⏹</button>`;
    default:
      return `<button class="btn btn-secondary btn-sm" onclick="retryTask('${task.id}')">🔄</button>
              <button class="btn btn-danger btn-sm" onclick="deleteTask('${task.id}')">✕</button>`;
  }
}

function renderPhases(phases) {
  if (!phases) return '';
  const names = { research: '研究', design: '设计', implement: '实现', review: '审查' };
  return Object.entries(phases).map(([key, phase]) =>
    `<div class="phase ${phase.status}">${names[key] || key}</div>`
  ).join('');
}

function renderLogs(logs) {
  if (!logs || logs.length === 0) {
    logsContainer.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><p>暂无日志</p></div>';
    return;
  }
  logsContainer.innerHTML = logs.map(log => `
    <div class="log-entry">
      <span class="log-time">${formatTime(log.timestamp)}</span>
      <span class="log-phase ${log.phase}">${log.phase}</span>
      <span class="log-message">${escapeHtml(log.message)}</span>
    </div>
  `).join('');
  logsContainer.scrollTop = logsContainer.scrollHeight;
}

// ============ 多类型消息渲染 ============

function renderMessages() {
  if (!chatData || chatData.length === 0) {
    chatMessages.innerHTML = '<div class="empty-state"><div class="empty-icon">💬</div><p>暂无消息</p><span class="empty-hint">输入指令开始与 Agent 团队对话</span></div>';
    return;
  }
  chatMessages.innerHTML = chatData.map(msg => `
    <div class="chat-message ${msg.senderId === 'admin' ? 'admin' : ''} ${msg.outputType === 'thinking' ? 'thinking' : ''}"
         data-msg-id="${msg.id}">
      <div class="message-avatar">${msg.senderId === 'admin' ? '👑' : getRoleIcon(msg.senderRole)}</div>
      <div class="message-content">
        <div class="message-header">
          <span class="message-sender">${msg.senderId === 'admin' ? '管理员' : msg.senderName}</span>
          ${msg.senderId !== 'admin' ? `<span class="message-role ${msg.senderRole}">${getRoleName(msg.senderRole)}</span>` : ''}
          <span class="message-type">${getMessageTypeIcon(msg.type)}</span>
          <span class="message-time">${formatTime(msg.timestamp)}</span>
        </div>
        <div class="message-body">
          ${renderMessageContent(msg)}
        </div>
      </div>
    </div>
  `).join('');
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

/**
 * 根据 outputType 渲染不同的消息内容
 */
function renderMessageContent(msg) {
  switch (msg.outputType) {
    case 'url': return renderUrlCard(msg);
    case 'code': return renderCodeBlock(msg);
    case 'command': return renderCommandBlock(msg);
    case 'file': return renderFileCard(msg);
    case 'image': return renderImage(msg);
    case 'browser-screenshot': return renderBrowserScreenshot(msg);
    case 'browser-snapshot': return renderBrowserSnapshot(msg);
    case 'task-result': return renderTaskResult(msg);
    case 'thinking': return renderThinking(msg);
    default: return renderText(msg);
  }
}

// ---- 文本渲染 ----
function renderText(msg) {
  // 自动检测内容中的 URL
  const urlRegex = /(https?:\/\/[^\s<]+)/g;
  const content = escapeHtml(msg.content).replace(urlRegex, url =>
    `<a href="${url}" target="_blank" class="inline-url" onclick="event.stopPropagation()">${url}</a>`
  );
  return `<div class="message-text">${content}</div>`;
}

// ---- URL 卡片渲染 ----
function renderUrlCard(msg) {
  const url = msg.outputMeta?.url || msg.content.trim();
  const title = msg.outputMeta?.title || url;
  const desc = msg.outputMeta?.description || '';
  const domain = extractDomain(url);

  return `
    <div class="message-url-card" onclick="window.open('${escapeHtml(url)}', '_blank')">
      <div class="url-card-icon">
        <img src="https://www.google.com/s2/favicons?domain=${escapeHtml(domain)}&sz=64"
             onerror="this.style.display='none'" alt="">
        <span class="url-domain">${escapeHtml(domain)}</span>
      </div>
      <div class="url-card-content">
        <div class="url-card-title">${escapeHtml(title)}</div>
        ${desc ? `<div class="url-card-desc">${escapeHtml(desc.substring(0, 120))}</div>` : ''}
        <div class="url-card-link">${escapeHtml(url.substring(0, 80))}</div>
      </div>
      <span class="url-card-arrow">↗</span>
    </div>
  `;
}

// ---- 代码块渲染 ----
function renderCodeBlock(msg) {
  const code = msg.outputMeta?.code || msg.content;
  const lang = msg.outputMeta?.language || '';
  const filename = msg.outputMeta?.filename || '';
  const cleanCode = extractCodeFromBlock(code);

  return `
    <div class="message-code-wrapper">
      <div class="code-header">
        <span class="code-lang">${lang || 'text'}</span>
        ${filename ? `<span class="code-filename">${escapeHtml(filename)}</span>` : ''}
        <div class="code-actions">
          <button class="code-btn" onclick="copyCode(this)" data-code="${escapeHtml(cleanCode)}">📋 复制</button>
          ${isRunnable(lang, cleanCode) ? `<button class="code-btn code-run" onclick="runCode(this)" data-code="${escapeHtml(cleanCode)}" data-lang="${lang}">▶ 运行</button>` : ''}
        </div>
      </div>
      <pre class="message-code-block"><code class="code-${lang}">${escapeHtml(cleanCode)}</code></pre>
    </div>
  `;
}

// ---- 命令块渲染 ----
function renderCommandBlock(msg) {
  const cmd = msg.outputMeta?.command || msg.content.trim();
  const desc = msg.outputMeta?.description || '';

  return `
    <div class="message-command-block">
      <div class="command-header">
        <span class="command-icon">⌨️</span>
        <span class="command-label">可执行命令</span>
        <button class="code-btn command-run" onclick="executeCommand(this)" data-command="${escapeHtml(cmd)}">▶ 运行</button>
        <button class="code-btn" onclick="copyCode(this)" data-code="${escapeHtml(cmd)}">📋 复制</button>
      </div>
      <pre class="command-text">$ ${escapeHtml(cmd)}</pre>
      ${desc ? `<div class="command-desc">${escapeHtml(desc)}</div>` : ''}
    </div>
  `;
}

// ---- 文件卡片渲染 ----
function renderFileCard(msg) {
  const filePath = msg.outputMeta?.filePath || msg.content.trim();
  const fileType = msg.outputMeta?.fileType || 'unknown';
  const size = msg.outputMeta?.size || 0;
  const sizeText = size > 1024 ? `${(size / 1024).toFixed(1)} KB` : `${size} B`;
  const fileIcon = getFileIcon(fileType);

  return `
    <div class="message-file-card" onclick="openFile('${escapeHtml(filePath)}')">
      <span class="file-icon">${fileIcon}</span>
      <div class="file-info">
        <span class="file-path">${escapeHtml(filePath)}</span>
        <span class="file-meta">
          <span class="file-type-badge">.${escapeHtml(fileType)}</span>
          ${size > 0 ? `<span class="file-size">${sizeText}</span>` : ''}
        </span>
      </div>
      <span class="file-open-btn">📂 打开</span>
    </div>
  `;
}

// ---- 图片渲染 ----
function renderImage(msg) {
  const src = msg.outputMeta?.src || msg.content;
  const alt = msg.outputMeta?.alt || '';

  return `<div class="message-image-wrapper"><img class="message-image" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy"></div>`;
}

// ---- 浏览器截图渲染 ----
function renderBrowserScreenshot(msg) {
  const screenshotBase64 = msg.outputMeta?.screenshotBase64;
  const url = msg.outputMeta?.url || '';
  const ts = msg.outputMeta?.timestamp || '';

  if (!screenshotBase64) {
    return `<div class="message-text">📸 ${escapeHtml(msg.content)}</div>`;
  }

  return `
    <div class="message-browser-screenshot">
      <div class="screenshot-header">
        <span class="screenshot-icon">📸</span>
        <span class="screenshot-label">页面截图</span>
        ${url ? `<a href="${escapeHtml(url)}" target="_blank" class="screenshot-url">${escapeHtml(url)}</a>` : ''}
        <span class="screenshot-time">${formatTime(ts)}</span>
      </div>
      <div class="screenshot-image-wrapper">
        <img class="screenshot-image" src="data:image/png;base64,${screenshotBase64}"
             alt="Page screenshot" loading="lazy">
      </div>
    </div>
  `;
}

// ---- 浏览器快照渲染 ----
function renderBrowserSnapshot(msg) {
  const title = msg.outputMeta?.title || '页面快照';
  const url = msg.outputMeta?.url || '';
  const summary = msg.outputMeta?.summary || msg.content;
  const urls = msg.outputMeta?.urls || [];

  return `
    <div class="message-browser-snapshot">
      <div class="snapshot-header">
        <span class="snapshot-icon">🌐</span>
        <span class="snapshot-title">${escapeHtml(title)}</span>
        ${url ? `<a href="${escapeHtml(url)}" target="_blank" class="snapshot-url">${escapeHtml(url)}</a>` : ''}
      </div>
      <div class="snapshot-summary">${escapeHtml(summary.substring(0, 300))}</div>
      ${urls.length > 0 ? `
        <div class="snapshot-links">
          ${urls.map(u => `<a href="${escapeHtml(u)}" target="_blank" class="snapshot-link">🔗 ${escapeHtml(u)}</a>`).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

// ---- 任务结果渲染 ----
function renderTaskResult(msg) {
  const phases = msg.outputMeta?.phases || [];
  const artifacts = msg.outputMeta?.artifacts || [];
  const summary = msg.outputMeta?.summary || msg.content;

  return `
    <div class="message-task-result">
      <div class="task-result-summary">${escapeHtml(summary)}</div>
      ${phases.length > 0 ? `
        <div class="task-result-phases">
          ${phases.map(p => `<span class="result-phase ${p.status}">${p.name}: ${p.status}</span>`).join('')}
        </div>
      ` : ''}
      ${artifacts.length > 0 ? `
        <div class="task-result-artifacts">
          <div class="artifacts-title">📦 产出物</div>
          ${artifacts.map(a => renderFileCard(a)).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

// ---- 思考中动画 ----
function renderThinking(msg) {
  return `
    <div class="thinking-indicator">
      <span class="thinking-dot"></span>
      <span class="thinking-dot"></span>
      <span class="thinking-dot"></span>
      <span class="thinking-text">思考中...</span>
    </div>
  `;
}

// ============ 讨论相关 UI ============

// 思考中状态显示
function showThinkingIndicator(agentId, agentName) {
  const existing = document.querySelector(`.thinking-message[data-agent="${agentId}"]`);
  if (existing) return;

  const thinkingMsg = {
    id: `thinking-${agentId}`,
    senderId: agentId,
    senderName: agentName,
    senderRole: 'assistant',
    content: '思考中...',
    outputType: 'thinking',
    outputMeta: { agentId },
    type: 'discussion',
    channel: currentChannel,
    timestamp: new Date().toISOString()
  };

  chatData.push(thinkingMsg);
  renderMessages();
}

function removeThinkingIndicator(agentId) {
  chatData = chatData.filter(m => !(m.id === `thinking-${agentId}`));
  renderMessages();
}

// ============ 聊天功能 ============

async function loadParticipants() {
  try {
    const res = await fetch('/api/chat/participants');
    participants = await res.json();
    renderParticipants();
  } catch (e) { console.error(e); }
}

async function loadMessages() {
  try {
    const res = await fetch(`/api/chat/messages/${currentChannel}`);
    chatData = await res.json();
    renderMessages();
  } catch (e) { console.error(e); }
}

function renderParticipants() {
  if (!participants || participants.length === 0) {
    chatParticipants.innerHTML = '<span class="empty-hint" style="padding: 8px">暂无在线 Agent</span>';
    return;
  }
  chatParticipants.innerHTML = participants.map(p => `
    <div class="participant">
      <span class="participant-icon">${getRoleIcon(p.role)}</span>
      <span class="participant-name">${escapeHtml(p.name)}</span>
      <span class="participant-status ${p.status === 'online' ? '' : 'offline'}"></span>
    </div>
  `).join('');
}

function sendAdminMessage() {
  const content = messageInput.value.trim();
  const type = document.getElementById('message-type').value;
  if (!content) return;

  // 管理员消息发送到服务器
  fetch('/api/chat/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      senderId: 'admin',
      content,
      type,
      channel: currentChannel
    })
  }).then(res => res.json()).then(result => {
    if (result.error) showToast(`发送失败: ${result.error}`, 'error');
    else messageInput.value = '';
  }).catch(() => showToast('发送失败', 'error'));
}

function sendMessage() {
  sendAdminMessage();
}

function switchChannel(channel) {
  currentChannel = channel;
  // 更新 tab 样式
  document.querySelectorAll('#channel-tabs .tab').forEach(t => t.classList.remove('active'));
  const tab = document.querySelector(`#channel-tabs .tab[data-channel="${channel}"]`);
  if (tab) tab.classList.add('active');
  loadMessages();
}

function switchPanel(panel) {
  document.querySelectorAll('.sidebar-tabs .tab').forEach(t => t.classList.remove('active'));
  const tab = document.querySelector(`.sidebar-tabs .tab[data-panel="${panel}"]`);
  if (tab) tab.classList.add('active');
  document.querySelectorAll('.sidebar-content').forEach(c => c.classList.remove('active'));
  const content = document.getElementById(`panel-${panel}`);
  if (content) content.classList.add('active');
}

function handleKeyPress(event) {
  if (event.key === 'Enter') sendMessage();
}

function showChannelModal() {
  const name = prompt('频道名称:');
  if (name) {
    const desc = prompt('频道描述（可选）:') || '';
    fetch('/api/chat/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description: desc })
    }).then(r => r.json()).then(() => {
      // 添加新频道 tab
      const tabs = document.getElementById('channel-tabs');
      const btn = document.createElement('button');
      btn.className = 'tab active';
      btn.setAttribute('data-channel', name);
      btn.textContent = `💬 ${name}`;
      btn.onclick = () => switchChannel(name);
      tabs.appendChild(btn);
      switchChannel(name);
    });
  }
}

// ============ 任务控制 ============

async function executeTask(taskId) { await fetch(`/api/tasks/${taskId}/execute`, { method: 'POST' }); }
async function pauseTask(taskId) { await fetch(`/api/tasks/${taskId}/pause`, { method: 'POST' }); }
async function resumeTask(taskId) { await fetch(`/api/tasks/${taskId}/resume`, { method: 'POST' }); }
async function cancelTask(taskId) { if (confirm('确定终止？')) await fetch(`/api/tasks/${taskId}/cancel`, { method: 'POST' }); }
async function deleteTask(taskId) { if (confirm('确定删除？')) await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' }); }
async function retryTask(taskId) {
  const task = tasks.find(t => t.id === taskId);
  if (task) {
    task.status = 'pending';
    task.progress = 0;
    if (task.phases) Object.values(task.phases).forEach(p => p.status = 'pending');
    renderTasks();
    await fetch(`/api/tasks/${taskId}/execute`, { method: 'POST' });
  }
}
async function clearAllTasks() { if (confirm('确定清空？')) await fetch('/api/tasks', { method: 'DELETE' }); }

// ============ Agent 管理 ============

async function discoverAgents() { socket.emit('discover-agents'); }

async function testAgent(agentId) {
  const el = document.getElementById(`test-result-${agentId}`);
  const statusEl = document.getElementById(`status-${agentId}`);
  el.innerHTML = '<span style="font-size:11px;color:#d29922">测试中...</span>';
  statusEl.className = 'agent-status-dot busy';
  try {
    const res = await fetch(`/api/agents/${agentId}/test`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      el.innerHTML = `<span style="font-size:11px;color:#3fb950">✓ ${(data.elapsed/1000).toFixed(1)}s</span>`;
      statusEl.className = 'agent-status-dot idle';
    } else {
      el.innerHTML = `<span style="font-size:11px;color:#f85149">✗ ${data.error || 'no response'}</span>`;
      statusEl.className = 'agent-status-dot error';
    }
  } catch (e) {
    el.innerHTML = `<span style="font-size:11px;color:#f85149">✗ 请求失败</span>`;
    statusEl.className = 'agent-status-dot error';
  }
  setTimeout(() => { el.innerHTML = ''; }, 5000);
}

async function testAllAgents() {
  showToast('正在测试所有 Agent...');
  // 触发所有 agent 的测试按钮
  for (const agent of agents) {
    await testAgent(agent.id);
  }
  showToast('测试完成');
}

async function recommendRoles() {
  const res = await fetch('/api/agents/recommend-all', { method: 'POST' });
  const data = await res.json();
  showToast(data.updates?.length ? `更新 ${data.updates.length} 个推荐` : '已是最佳角色');
}

async function changeAgentRole(agentId, role) {
  await fetch(`/api/agents/${agentId}/role`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role })
  });
  showToast('角色已更新');
}

async function removeAgent(agentId) {
  const agent = agents.find(a => a.id === agentId);
  if (!agent) return;
  if (confirm(`确定移除 ${agent.name}？`)) {
    const res = await fetch(`/api/agents/${agentId}`, { method: 'DELETE' });
    if (res.ok) showToast(`已移除 ${agent.name}`);
  }
}

function selectRole(roleId, el) {
  document.querySelectorAll('.role-card').forEach(c => c.classList.remove('selected'));
  if (el) el.classList.add('selected');
}

// ============ 角色 CRUD ============

function showRoleModal(editId) {
  document.getElementById('role-edit-id').value = editId || '';
  document.getElementById('role-modal-title').textContent = editId ? '编辑角色' : '新建角色';
  document.getElementById('role-id').disabled = !!editId;
  document.getElementById('role-id').value = editId || '';
  document.getElementById('role-name').value = '';
  document.getElementById('role-icon').value = '🎭';
  document.getElementById('role-desc').value = '';
  if (editId) {
    const role = roles.find(r => r.id === editId);
    if (role) {
      document.getElementById('role-name').value = role.name;
      document.getElementById('role-icon').value = role.icon;
      document.getElementById('role-desc').value = role.description || '';
    }
  }
  document.getElementById('role-modal').classList.add('active');
}

function hideRoleModal() {
  document.getElementById('role-modal').classList.remove('active');
}

document.getElementById('role-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const editId = document.getElementById('role-edit-id').value;
  const id = document.getElementById('role-id').value.trim();
  const name = document.getElementById('role-name').value.trim();
  const icon = document.getElementById('role-icon').value.trim() || '🎭';
  const description = document.getElementById('role-desc').value.trim();

  if (editId) {
    const res = await fetch(`/api/roles/${editId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, icon, description })
    });
    const data = await res.json();
    if (data.error) return showToast(data.error, 'error');
    showToast('角色已更新');
  } else {
    const res = await fetch('/api/roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name, icon, description })
    });
    const data = await res.json();
    if (data.error) return showToast(data.error, 'error');
    showToast('角色已创建');
  }
  hideRoleModal();
});

async function editRole(roleId) {
  showRoleModal(roleId);
}

// ====== Agent Modal ======
function showAgentModal() {
  const roleSelect = document.getElementById('agent-role');
  roleSelect.innerHTML = '';
  roleSelect.innerHTML = '<option value="assistant">🤖 助手</option>';
  const roleList = Array.isArray(roles) ? roles : [];
  for (const r of roleList) {
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = `${r.icon || '🎭'} ${r.name || r.id}`;
    roleSelect.appendChild(opt);
  }
  document.getElementById('agent-form').reset();
  document.getElementById('agent-modal').classList.add('active');
  document.getElementById('agent-command').focus();
}

function hideAgentModal() {
  document.getElementById('agent-modal').classList.remove('active');
}

document.getElementById('agent-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const command = document.getElementById('agent-command').value.trim();
  if (!command) return showToast('请输入命令', 'error');

  const payload = {
    command,
    name: document.getElementById('agent-name').value.trim() || command,
    role: document.getElementById('agent-role').value,
    customPrompt: document.getElementById('agent-prompt').value.trim(),
    emoji: document.getElementById('agent-emoji').value.trim() || '🔧'
  };

  const res = await fetch('/api/agents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (data.error) return showToast(data.error, 'error');
  showToast(`Agent ${payload.name} 已添加`);
  hideAgentModal();
});

async function deleteRole(roleId) {
  if (!confirm(`确定删除角色「${roleId}」？`)) return;
  const res = await fetch(`/api/roles/${roleId}`, { method: 'DELETE' });
  const data = await res.json();
  if (data.error) return showToast(data.error, 'error');
  showToast('角色已删除');
}

// ============ 模态框 ============

function showNewTaskModal() { document.getElementById('new-task-modal').classList.add('active'); }
function hideNewTaskModal() { document.getElementById('new-task-modal').classList.remove('active'); }

document.getElementById('new-task-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('task-name').value;
  const requirement = document.getElementById('task-requirement').value;
  try {
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, requirement })
    });
    const task = await res.json();
    await fetch(`/api/tasks/${task.id}/execute`, { method: 'POST' });
    hideNewTaskModal();
    document.getElementById('new-task-form').reset();
  } catch (e) { alert('创建失败'); }
});

// ============ 可交互操作 ============

// 复制代码
function copyCode(btn) {
  const code = btn.dataset.code;
  navigator.clipboard.writeText(code).then(() => {
    btn.textContent = '✅ 已复制';
    setTimeout(() => { btn.textContent = '📋 复制'; }, 2000);
  }).catch(() => {
    // fallback
    const textarea = document.createElement('textarea');
    textarea.value = code;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    btn.textContent = '✅ 已复制';
    setTimeout(() => { btn.textContent = '📋 复制'; }, 2000);
  });
}

// 运行代码
function runCode(btn) {
  const code = btn.dataset.code;
  const lang = btn.dataset.lang || 'javascript';

  // 发送代码到后端执行
  let command = code;
  if (lang === 'javascript' || lang === 'js') {
    command = `node -e "${code.replace(/"/g, '\\"').replace(/`/g, '\\`')}"`;
  } else if (lang === 'python' || lang === 'py') {
    command = `python3 -c "${code.replace(/"/g, '\\"').replace(/`/g, '\\`')}"`;
  } else if (lang === 'bash' || lang === 'sh') {
    command = code;
  } else {
    showToast('暂不支持运行此语言', 'error');
    return;
  }

  fetch('/api/execute/command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, timeout: 15000 })
  }).then(r => r.json()).then(result => {
    showToast(`运行结果:\n${result.output || '(无输出)'}`);
  }).catch(() => showToast('执行失败', 'error'));
}

// 执行命令
function executeCommand(btn) {
  const command = btn.dataset.command;
  if (!command) return;

  fetch('/api/execute/command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, timeout: 15000 })
  }).then(r => r.json()).then(result => {
    showToast(`命令执行完成\n${result.output || '(无输出)'}`);
  }).catch(() => showToast('执行失败', 'error'));
}

// 打开文件
function openFile(filePath) {
  // 尝试用 open 命令在 Finder 中打开
  fetch('/api/execute/command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: `open "${filePath}"`, timeout: 5000 })
  }).catch(() => showToast('无法打开文件', 'error'));
}

// ============ 工具函数 ============

function getAgentIcon(id) {
  const icons = { claude: '🤖', hermes: '⚡', mimo: '🎯', 'agent-browser': '🌐', aria: '👑', researcher: '🔬', architect: '📐', developer: '💻', fast: '⚡', analyst: '📊', operator: '🔧', assistant: '🤖', tester: '🧪', commander: '👑' };
  return icons[id] || '🤖';
}

function getRoleIcon(role) {
  return getAgentIcon(role);
}

function getRoleName(role) {
  const names = { researcher: '研究员', architect: '架构师', developer: '开发者', fast: '快枪手', tester: '测试员', analyst: '分析师', operator: '运维', assistant: '助手', commander: '指挥官' };
  return names[role] || role;
}

function getMessageTypeIcon(type) {
  const types = { discussion: '💬', question: '❓', report: '📊', task: '📋', answer: '✅', alert: '⚠️' };
  return types[type] || '💬';
}

function getStatusText(status) {
  const texts = { idle: '空闲', busy: '忙碌', error: '错误', pending: '等待中', running: '运行中', paused: '已暂停', completed: '已完成', failed: '失败', cancelled: '已终止' };
  return texts[status] || status;
}

function getCostText(cost) {
  const texts = { 'free': '免费', 'free-trial': '免费(限时)', 'free-limited': '免费(限额)', 'free-tier': '免费额度', 'paid': '付费', 'unknown': '未知' };
  return texts[cost] || cost;
}

function getFileIcon(ext) {
  const icons = { js: '📜', jsx: '⚛️', ts: '📘', tsx: '⚛️', py: '🐍', html: '🌐', css: '🎨', json: '📋', md: '📝', txt: '📄', png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', pdf: '📕' };
  return icons[ext] || '📄';
}

function extractDomain(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

function extractCodeFromBlock(text) {
  const match = text.match(/```(?:\w+)?\n?([\s\S]*?)```/);
  return match ? match[1].trim() : text;
}

function isRunnable(lang, code) {
  const runnableLangs = ['javascript', 'js', 'python', 'py', 'bash', 'sh', 'shell'];
  return runnableLangs.includes(lang) || runnableLangs.includes(detectLangFromCode(code));
}

function detectLangFromCode(code) {
  if (code.startsWith('#!')) return 'bash';
  if (/^import |^export |^const |^let |^function |^class |=>/.test(code)) return 'javascript';
  if (/^def |^import os|^from |^print\(/.test(code)) return 'python';
  if (/^<html|^<!DOCTYPE/i.test(code)) return 'html';
  return '';
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toast.style.whiteSpace = 'pre-wrap';
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// 协奏开关
function toggleCollaboration(enabled) {
  fetch('/api/collaboration', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled })
  }).then(r => r.json()).then(d => {
    if (d.error) return showToast(d.error, 'error');
    showToast(enabled ? '协奏模式已开启' : '协奏模式已关闭', 'info');
  }).catch(() => {});
}

// 初始加载
fetch('/api/agents').then(r => r.json()).then(d => { agents = d; renderAgents(); }).catch(() => {});
fetch('/api/tasks').then(r => r.json()).then(d => { tasks = d; renderTasks(); }).catch(() => {});
fetch('/api/roles').then(r => r.json()).then(d => { roles = d; renderRoles(); }).catch(() => {});
fetch('/api/collaboration').then(r => r.json()).then(d => {
  document.getElementById('collab-toggle').checked = d.enabled;
}).catch(() => {});
