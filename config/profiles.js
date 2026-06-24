const AGENT_PROFILES = {
  claude: {
    name: 'Claude Code',
    type: 'ai-assistant',
    capabilities: ['coding', 'analysis', 'review', 'architecture'],
    strengths: ['代码审查', '架构设计', '复杂逻辑', '文档生成'],
    recommendedRoles: ['architect', 'reviewer'],
    cost: 'free-limited',
    model: 'DeepSeek v4',
    emoji: '🤖'
  },
  hermes: {
    name: 'Hermes Agent',
    type: 'ai-assistant',
    capabilities: ['coding', 'reasoning', 'planning'],
    strengths: ['核心开发', '复杂算法', '系统设计'],
    recommendedRoles: ['developer', 'architect'],
    cost: 'paid',
    model: 'DeepSeek v4',
    emoji: '⚡'
  },
  mimo: {
    name: 'MiMo Code',
    type: 'ai-assistant',
    capabilities: ['coding', 'quick-tasks', 'batch'],
    strengths: ['快速原型', '批量处理', '简单任务'],
    recommendedRoles: ['fast', 'assistant'],
    cost: 'free-trial',
    model: 'MiMo',
    emoji: '🎯'
  },
  'agent-browser': {
    name: 'Agent Browser',
    type: 'browser',
    capabilities: ['web-scraping', 'automation', 'testing'],
    strengths: ['网页抓取', 'UI测试', '数据采集'],
    recommendedRoles: ['researcher', 'tester'],
    cost: 'free',
    model: '-',
    emoji: '🌐'
  },
  codex: {
    name: 'OpenAI Codex',
    type: 'ai-assistant',
    capabilities: ['coding', 'reasoning', 'generation'],
    strengths: ['代码生成', '多语言支持', '快速迭代'],
    recommendedRoles: ['developer', 'fast'],
    cost: 'paid',
    model: 'GPT-4',
    emoji: '📝'
  },
  gemini: {
    name: 'Google Gemini',
    type: 'ai-assistant',
    capabilities: ['coding', 'multimodal', 'analysis'],
    strengths: ['多模态理解', '长文档分析', '创意生成'],
    recommendedRoles: ['researcher', 'analyst'],
    cost: 'free-tier',
    model: 'Gemini Pro',
    emoji: '🌟'
  },
  goose: {
    name: 'Block Goose',
    type: 'ai-assistant',
    capabilities: ['coding', 'autonomous', 'multi-step'],
    strengths: ['自主任务', '多步骤执行', '工具调用'],
    recommendedRoles: ['developer', 'operator'],
    cost: 'free',
    model: 'Various',
    emoji: '🦆'
  },
  aria: {
    name: 'Aria',
    type: 'ai-assistant',
    capabilities: ['reasoning', 'planning', 'analysis', 'coordination', 'coding', 'writing'],
    strengths: ['全局协调', '深度分析', '决策建议', '代码审查', '项目管理'],
    recommendedRoles: ['commander', 'architect'],
    cost: 'free',
    model: 'DeepSeek v4 Flash',
    emoji: '👑'
  }
};

const ROLES = {
  researcher: { name: '研究员', icon: '🔬', description: '信息收集、文档检索、竞品分析' },
  architect: { name: '架构师', icon: '📐', description: '系统设计、架构决策、代码审查' },
  developer: { name: '开发者', icon: '💻', description: '核心功能实现、复杂逻辑编写' },
  fast: { name: '快枪手', icon: '⚡', description: '快速原型、批量任务、简单实现' },
  tester: { name: '测试员', icon: '🧪', description: '测试编写、自动化测试、质量保证' },
  analyst: { name: '分析师', icon: '📊', description: '数据分析、报告生成、洞察挖掘' },
  operator: { name: '运维', icon: '🔧', description: '部署、监控、系统维护' },
  assistant: { name: '助手', icon: '🤖', description: '辅助任务、文档整理、格式化' },
  commander: { name: '指挥官', icon: '👑', description: '全局协调、决策建议、项目统筹' }
};

const ROLE_DEFINITIONS = {
  researcher: {
    name: '研究员',
    icon: '🔬',
    description: '负责信息收集、文档检索、竞品分析',
    requiredCapabilities: ['web-scraping', 'analysis'],
    preferredCapabilities: ['research', 'data-collection']
  },
  architect: {
    name: '架构师',
    icon: '📐',
    description: '负责系统设计、架构决策、代码审查',
    requiredCapabilities: ['architecture', 'review'],
    preferredCapabilities: ['planning', 'design']
  },
  developer: {
    name: '开发者',
    icon: '💻',
    description: '负责核心功能实现、复杂逻辑编写',
    requiredCapabilities: ['coding', 'reasoning'],
    preferredCapabilities: ['implementation', 'debugging']
  },
  fast: {
    name: '快枪手',
    icon: '⚡',
    description: '负责快速原型、批量任务、简单实现',
    requiredCapabilities: ['coding', 'quick-tasks'],
    preferredCapabilities: ['batch', 'automation']
  },
  tester: {
    name: '测试员',
    icon: '🧪',
    description: '负责测试编写、自动化测试、质量保证',
    requiredCapabilities: ['testing', 'automation'],
    preferredCapabilities: ['quality', 'validation']
  },
  analyst: {
    name: '分析师',
    icon: '📊',
    description: '负责数据分析、报告生成、洞察挖掘',
    requiredCapabilities: ['analysis', 'data'],
    preferredCapabilities: ['insights', 'reporting']
  },
  operator: {
    name: '运维',
    icon: '🔧',
    description: '负责部署、监控、系统维护',
    requiredCapabilities: ['deployment', 'monitoring'],
    preferredCapabilities: ['devops', 'maintenance']
  },
  assistant: {
    name: '助手',
    icon: '🤖',
    description: '负责辅助任务、文档整理、格式化',
    requiredCapabilities: ['general'],
    preferredCapabilities: ['support', 'documentation']
  },
  commander: {
    name: '指挥官',
    icon: '👑',
    description: '负责全局协调、决策建议、项目统筹',
    requiredCapabilities: ['reasoning', 'planning', 'coordination'],
    preferredCapabilities: ['analysis', 'decision-making']
  }
};

module.exports = { AGENT_PROFILES, ROLES, ROLE_DEFINITIONS };
