#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { AGENT_PROFILES, ROLES } = require('../config/profiles');

// 配置文件路径
const CONFIG_DIR = path.join(__dirname, '..', 'config');
const AGENTS_CONFIG = path.join(CONFIG_DIR, 'agents.json');

// 确保配置目录存在
if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

// 扫描可用工具 - 只扫描真正的 AI Agent
function scanTools() {
  const tools = [];
  const commands = [
    'claude', 'hermes', 'mimo', 'agent-browser',
    'codex', 'gemini', 'goose'
  ];

  for (const cmd of commands) {
    try {
      const result = execSync(`which ${cmd} 2>/dev/null`, { encoding: 'utf8' }).trim();
      if (result) {
        const profile = AGENT_PROFILES[cmd];
          // 只注册已知的 AI Agent
          if (profile) {
            tools.push({
              command: cmd,
              path: result,
              profile
            });
          }
      }
    } catch (error) {
      // 工具不存在
    }
  }

  return tools;
}

// 加载配置
function loadConfig() {
  try {
    if (fs.existsSync(AGENTS_CONFIG)) {
      return JSON.parse(fs.readFileSync(AGENTS_CONFIG, 'utf8'));
    }
  } catch (error) {
    console.error('Failed to load config:', error);
  }
  return { agents: {} };
}

// 保存配置
function saveConfig(config) {
  fs.writeFileSync(AGENTS_CONFIG, JSON.stringify(config, null, 2));
}

// 发现并注册 Agents
function discover() {
  console.log('🔍 扫描系统 Agent 工具...\n');
  
  const tools = scanTools();
  const config = loadConfig();
  
  let newCount = 0;
  
  for (const tool of tools) {
    if (!config.agents[tool.command]) {
      config.agents[tool.command] = {
        id: tool.command,
        command: tool.command,
        path: tool.path,
        profile: tool.profile,
        role: tool.profile.recommendedRoles[0] || 'assistant',
        status: 'idle',
        discoveredAt: new Date().toISOString()
      };
      newCount++;
      console.log(`  ✅ 发现: ${tool.profile.name} (${tool.command})`);
    }
  }
  
  saveConfig(config);
  
  console.log(`\n📊 扫描完成:`);
  console.log(`   总计: ${tools.length} 个工具`);
  console.log(`   新增: ${newCount} 个`);
  console.log(`   已注册: ${Object.keys(config.agents).length} 个`);
  
  return config.agents;
}

// 导出
module.exports = { discover, scanTools, loadConfig, saveConfig, AGENT_PROFILES, ROLES };

// 命令行执行
if (require.main === module) {
  discover();
}
