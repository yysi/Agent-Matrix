const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { AGENT_PROFILES, ROLE_DEFINITIONS } = require('../config/profiles');

class AgentRegistry {
  constructor() {
    this.agents = new Map();
    this.roles = new Map();
    this.customRoles = {};
    this.configPath = path.join(__dirname, '..', 'config', 'agents.json');
    this.loadConfig();
    this.loadCustomRoles();
  }

  // 加载配置
  loadConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
        this.agents = new Map(Object.entries(data.agents || {}));
        this.roles = new Map(Object.entries(data.roles || {}));
      }
    } catch (error) {
      console.error('Failed to load agent config:', error);
    }
  }

  // 保存配置
  saveConfig() {
    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    const data = {
      agents: Object.fromEntries(this.agents),
      roles: Object.fromEntries(this.roles),
      lastUpdated: new Date().toISOString()
    };
    
    fs.writeFileSync(this.configPath, JSON.stringify(data, null, 2));
  }

  // 扫描系统中可用的 CLI 工具
  scanAvailableTools() {
    const tools = [];
    const checkCommands = [
      'claude', 'hermes', 'mimo', 'agent-browser', 
      'codex', 'gemini', 'goose'
    ];

    for (const cmd of checkCommands) {
      try {
        const result = execSync(`which ${cmd} 2>/dev/null`, { encoding: 'utf8' }).trim();
        if (result) {
          const profile = AGENT_PROFILES[cmd];
          // 只注册已知的 AI Agent（不在 AGENT_PROFILES 中的跳过）
          if (profile) {
            tools.push({
              command: cmd,
              path: result,
              profile
            });
          }
        }
      } catch (error) {
        // 工具不存在，跳过
      }
    }

    return tools;
  }

  // 为未知工具生成特征
  generateProfile(command) {
    return {
      name: command,
      type: 'unknown',
      capabilities: ['general'],
      strengths: ['待分析'],
      recommendedRoles: ['assistant'],
      cost: 'unknown',
      model: 'Unknown'
    };
  }

  // 自动检测并注册 Agents
  discoverAgents() {
    const tools = this.scanAvailableTools();
    const discovered = [];

    for (const tool of tools) {
      if (!this.agents.has(tool.command)) {
        const agent = {
          id: tool.command,
          command: tool.command,
          path: tool.path,
          profile: tool.profile,
          role: tool.profile.recommendedRoles[0] || 'assistant',
          status: 'idle',
          currentTask: null,
          discoveredAt: new Date().toISOString()
        };
        
        this.agents.set(tool.command, agent);
        discovered.push(agent);
      }
    }

    this.saveConfig();
    return discovered;
  }

  // 获取所有 Agents
  getAllAgents() {
    return Array.from(this.agents.values());
  }

  // 获取单个 Agent
  getAgent(id) {
    return this.agents.get(id);
  }

  // 更新 Agent 角色
  updateAgentRole(agentId, newRole) {
    const agent = this.agents.get(agentId);
    if (!agent) return null;

    agent.role = newRole;
    agent.roleUpdatedAt = new Date().toISOString();
    this.saveConfig();
    return agent;
  }

  // 删除 Agent
  removeAgent(agentId) {
    const deleted = this.agents.delete(agentId);
    if (deleted) {
      this.saveConfig();
    }
    return deleted;
  }

  // ============ 角色 CRUD ============

  getMergedRoleDefs() {
    return { ...ROLE_DEFINITIONS, ...this.customRoles };
  }

  getRoleDefinition(roleId) {
    return this.customRoles[roleId] || ROLE_DEFINITIONS[roleId] || null;
  }

  getAllRoles() {
    const merged = this.getMergedRoleDefs();
    return Object.entries(merged).map(([id, def]) => ({
      id,
      ...def,
      builtin: !!ROLE_DEFINITIONS[id]
    }));
  }

  addRole(roleId, def) {
    if (ROLE_DEFINITIONS[roleId]) return { error: 'Cannot override built-in role' };
    if (this.customRoles[roleId]) return { error: 'Role already exists' };
    this.customRoles[roleId] = {
      name: def.name || roleId,
      icon: def.icon || '🎭',
      description: def.description || '',
      requiredCapabilities: def.requiredCapabilities || [],
      preferredCapabilities: def.preferredCapabilities || []
    };
    this.saveCustomRoles();
    return { success: true, role: { id: roleId, ...this.customRoles[roleId], builtin: false } };
  }

  updateRole(roleId, def) {
    if (ROLE_DEFINITIONS[roleId]) return { error: 'Cannot modify built-in role' };
    if (!this.customRoles[roleId]) return { error: 'Role not found' };
    if (def.name !== undefined) this.customRoles[roleId].name = def.name;
    if (def.icon !== undefined) this.customRoles[roleId].icon = def.icon;
    if (def.description !== undefined) this.customRoles[roleId].description = def.description;
    if (def.requiredCapabilities) this.customRoles[roleId].requiredCapabilities = def.requiredCapabilities;
    if (def.preferredCapabilities) this.customRoles[roleId].preferredCapabilities = def.preferredCapabilities;
    this.saveCustomRoles();
    return { success: true, role: { id: roleId, ...this.customRoles[roleId], builtin: false } };
  }

  deleteRole(roleId) {
    if (ROLE_DEFINITIONS[roleId]) return { error: 'Cannot delete built-in role' };
    if (!this.customRoles[roleId]) return { error: 'Role not found' };
    delete this.customRoles[roleId];
    this.saveCustomRoles();
    return { success: true };
  }

  saveCustomRoles() {
    const dir = path.dirname(this.configPath);
    const rolesPath = path.join(dir, 'roles.json');
    fs.writeFileSync(rolesPath, JSON.stringify(this.customRoles, null, 2));
  }

  loadCustomRoles() {
    const dir = path.dirname(this.configPath);
    const rolesPath = path.join(dir, 'roles.json');
    try {
      if (fs.existsSync(rolesPath)) {
        this.customRoles = JSON.parse(fs.readFileSync(rolesPath, 'utf8'));
      }
    } catch (e) {
      console.error('Failed to load custom roles:', e.message);
    }
  }

  // 根据能力推荐角色
  recommendRole(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) return null;

    const profile = agent.profile;
    const capabilities = profile.capabilities || [];
    const merged = this.getMergedRoleDefs();
    
    let bestRole = null;
    let bestScore = 0;

    for (const [roleId, roleDef] of Object.entries(merged)) {
      let score = 0;
      const required = roleDef.requiredCapabilities || [];
      const preferred = roleDef.preferredCapabilities || [];
      
      const hasRequired = required.some(cap => capabilities.includes(cap));
      if (!hasRequired) continue;
      
      for (const cap of capabilities) {
        if (required.includes(cap)) score += 2;
        if (preferred.includes(cap)) score += 1;
      }
      
      if (score > bestScore) {
        bestScore = score;
        bestRole = roleId;
      }
    }

    return bestRole || 'assistant';
  }

  updateAllRecommendations() {
    const updates = [];
    
    for (const [agentId, agent] of this.agents) {
      const recommendedRole = this.recommendRole(agentId);
      if (recommendedRole !== agent.role) {
        agent.recommendedRole = recommendedRole;
        updates.push({
          agentId,
          currentRole: agent.role,
          recommendedRole
        });
      }
    }
    
    return updates;
  }

  registerBuiltin(agentId, profile, role) {
    if (this.agents.has(agentId)) return this.agents.get(agentId);
    const agent = {
      id: agentId,
      command: agentId,
      path: '(built-in)',
      profile,
      role: role || profile.recommendedRoles[0] || 'assistant',
      status: 'idle',
      currentTask: null,
      customPrompt: profile.customPrompt || '',
      discoveredAt: new Date().toISOString()
    };
    this.agents.set(agentId, agent);
    this.saveConfig();
    return agent;
  }

  // 注册自定义 Agent（通过 UI/API）
  registerAgent(data) {
    const agentId = data.id || data.command;
    if (this.agents.has(agentId)) return { error: 'Agent already exists' };

    const agent = {
      id: agentId,
      command: data.command,
      path: data.path || data.command,
      profile: {
        name: data.name || data.command,
        type: 'custom',
        capabilities: data.capabilities || ['general'],
        strengths: data.strengths || [],
        recommendedRoles: data.recommendedRoles || ['assistant'],
        cost: data.cost || 'unknown',
        model: data.model || 'Custom',
        emoji: data.emoji || '🔧',
        customPrompt: data.customPrompt || ''
      },
      role: data.role || 'assistant',
      status: 'idle',
      currentTask: null,
      customPrompt: data.customPrompt || '',
      discoveredAt: new Date().toISOString(),
      isCustom: true
    };
    this.agents.set(agentId, agent);
    this.saveConfig();
    return { success: true, agent };
  }

  getStats() {
    const allAgents = this.getAllAgents();
    const roleCount = {};
    
    for (const agent of allAgents) {
      roleCount[agent.role] = (roleCount[agent.role] || 0) + 1;
    }
    
    return {
      totalAgents: allAgents.length,
      roleDistribution: roleCount,
      availableRoles: Object.keys(this.getMergedRoleDefs()).length
    };
  }
}

module.exports = { AgentRegistry, ROLE_DEFINITIONS, AGENT_PROFILES };
