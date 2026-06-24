#!/usr/bin/env node

/**
 * Agent 状态查看模块
 * 显示所有已注册 Agent 的状态信息
 */

const fs = require('fs');
const path = require('path');
const { loadConfig, ROLES } = require('./discover');

// 配置文件路径
const CONFIG_DIR = path.join(__dirname, '..', 'config');
const AGENTS_CONFIG = path.join(CONFIG_DIR, 'agents.json');

// 颜色定义
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  purple: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m'
};

// 状态颜色
const statusColors = {
  idle: colors.green,
  busy: colors.yellow,
  error: colors.red,
  offline: colors.gray
};

// 状态文本
const statusText = {
  idle: '空闲',
  busy: '忙碌',
  error: '错误',
  offline: '离线'
};

// 显示状态
function showStatus() {
  console.log('');
  console.log(`${colors.purple}╔═══════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.purple}║           🤖 Agent Matrix 状态                   ║${colors.reset}`);
  console.log(`${colors.purple}╚═══════════════════════════════════════════════════╝${colors.reset}`);
  console.log('');

  const config = loadConfig();
  const agents = config.agents || {};

  if (Object.keys(agents).length === 0) {
    console.log(`${colors.yellow}⚠️  暂无已注册的 Agent${colors.reset}`);
    console.log(`${colors.gray}   运行 'node core/discover.js' 扫描可用工具${colors.reset}`);
    return;
  }

  // 按角色分组
  const grouped = {};
  for (const [id, agent] of Object.entries(agents)) {
    const role = agent.role || 'assistant';
    if (!grouped[role]) grouped[role] = [];
    grouped[role].push(agent);
  }

  // 显示统计
  console.log(`${colors.cyan}📊 统计信息:${colors.reset}`);
  console.log(`   总计: ${Object.keys(agents).length} 个 Agent`);
  console.log(`   角色: ${Object.keys(grouped).length} 个`);
  console.log('');

  // 显示每个角色的 Agent
  for (const [role, roleAgents] of Object.entries(grouped)) {
    const roleInfo = ROLES[role] || { name: role, icon: '❓' };
    
    console.log(`${colors.blue}${roleInfo.icon} ${roleInfo.name}${colors.reset}`);
    console.log(`${colors.gray}   ${'─'.repeat(40)}${colors.reset}`);
    
    for (const agent of roleAgents) {
      const statusColor = statusColors[agent.status] || colors.gray;
      const status = statusText[agent.status] || agent.status;
      
      console.log(`   ${colors.white}${agent.profile.name}${colors.reset}`);
      console.log(`     工具: ${colors.cyan}${agent.command}${colors.reset}`);
      console.log(`     模型: ${colors.gray}${agent.profile.model || '-'}${colors.reset}`);
      console.log(`     成本: ${getCostText(agent.profile.cost)}`);
      console.log(`     状态: ${statusColor}${status}${colors.reset}`);
      console.log('');
    }
  }

  // 显示能力矩阵
  console.log(`${colors.cyan}🎯 能力矩阵:${colors.reset}`);
  console.log(`${colors.gray}   ${'─'.repeat(40)}${colors.reset}`);
  
  for (const [id, agent] of Object.entries(agents)) {
    const caps = agent.profile.capabilities || [];
    console.log(`   ${agent.profile.name}: ${colors.gray}${caps.join(', ')}${colors.reset}`);
  }
  console.log('');
}

// 获取成本文本
function getCostText(cost) {
  const costMap = {
    'free': `${colors.green}免费${colors.reset}`,
    'free-trial': `${colors.green}免费(限时)${colors.reset}`,
    'free-limited': `${colors.green}免费(限额)${colors.reset}`,
    'free-tier': `${colors.green}免费额度${colors.reset}`,
    'paid': `${colors.yellow}付费${colors.reset}`,
    'unknown': `${colors.gray}未知${colors.reset}`
  };
  return costMap[cost] || cost;
}

// 导出
module.exports = { showStatus };

// 命令行执行
if (require.main === module) {
  showStatus();
}
