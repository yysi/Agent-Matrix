#!/usr/bin/env node

/**
 * Agent 执行引擎
 *
 * 核心功能：
 * 1. 安全调用 Agent CLI（带 timeout、并发控制）
 * 2. 解析 CLI 输出，自动检测输出类型
 * 3. 管理 Agent Browser 特殊操作（截图、快照等）
 * 4. 重试与错误处理
 */

  const { exec, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');


// ============ 输出类型常量 ============

const OUTPUT_TYPES = {
  TEXT: 'text',
  URL: 'url',
  CODE: 'code',
  COMMAND: 'command',
  FILE: 'file',
  IMAGE: 'image',
  BROWSER_SCREENSHOT: 'browser-screenshot',
  BROWSER_SNAPSHOT: 'browser-snapshot',
  TASK_RESULT: 'task-result',
  THINKING: 'thinking'
};

// ============ Agent 命令模板 ============

const AGENT_COMMANDS = {
  claude: {
    build: (prompt) => ({
      cmd: `claude -p "${escapeShellArg(prompt)}" --print < /dev/null 2>&1`,
      timeout: 60000
    })
  },
  hermes: {
    build: (prompt) => ({
      cmd: `hermes -z "${escapeShellArg(prompt)}" 2>&1`,
      timeout: 60000
    })
  },
  mimo: {
    build: (prompt) => ({
      cmd: `mimo run "${escapeShellArg(prompt)}" 2>&1`,
      timeout: 60000
    })
  },
  'agent-browser': {
    build: (prompt, action) => {
      const actionCmd = BROWSER_ACTIONS[action] || BROWSER_ACTIONS.default;
      const cmd = actionCmd.template
        .replace('{prompt}', escapeShellArg(prompt))
        .replace('{query}', encodeURIComponent(prompt));
      return {
        cmd,
        timeout: actionCmd.timeout || 60000,
        isBrowserAction: true,
        parseOutput: actionCmd.parseOutput || 'text'
      };
    }
  },
  aria: {
    build: (prompt) => ({
      cmd: `hermes -z "${escapeShellArg(prompt)}" 2>&1`,
      timeout: 120000
    })
  }
};

// ============ 浏览器操作定义 ============

const BROWSER_ACTIONS = {
  // 默认：不是浏览器任务，交给 claude 处理
  default: {
    template: `claude -p "{prompt}" --print < /dev/null 2>&1`,
    timeout: 60000,
    parseOutput: 'text'
  },

  // 打开网页
  open: {
    template: `agent-browser open "{prompt}" --timeout 30000 2>&1`,
    timeout: 35000,
    parseOutput: 'url'
  },

  // 搜索信息（打开 Google 搜索）
  search: {
    template: `agent-browser open "https://www.google.com/search?q={query}" --timeout 30000 2>&1 && agent-browser snapshot 2>&1`,
    timeout: 45000,
    parseOutput: 'snapshot'
  },

  // 截图
  screenshot: {
    template: `agent-browser open "{prompt}" --timeout 30000 2>&1 && sleep 1 && agent-browser screenshot --screenshot-format png 2>&1`,
    timeout: 60000,
    parseOutput: 'screenshot'
  },

  // 页面内容快照
  snapshot: {
    template: `agent-browser open "{prompt}" --timeout 30000 2>&1 && sleep 1 && agent-browser snapshot 2>&1`,
    timeout: 60000,
    parseOutput: 'snapshot'
  },

  // 执行 JavaScript
  eval: {
    template: `agent-browser eval "{prompt}" 2>&1`,
    timeout: 30000,
    parseOutput: 'text'
  },

  // 点击页面元素
  click: {
    template: `agent-browser click "{prompt}" 2>&1`,
    timeout: 15000,
    parseOutput: 'text'
  }
};

// ============ 输出类型检测 ============

/**
 * 智能检测输出类型
 */
function detectOutputType(text, agentId, action) {
  if (!text || text.trim().length === 0) return OUTPUT_TYPES.TEXT;

  const trimmed = text.trim();

  // 1. 如果是 Agent Browser 截图（有 base64 图片特征）
  if (agentId === 'agent-browser' && action === 'screenshot') {
    if (trimmed.includes('PNG') || trimmed.includes('base64') || trimmed.startsWith('\x89PNG')) {
      return OUTPUT_TYPES.BROWSER_SCREENSHOT;
    }
    // 可能截图保存到文件了
    if (/saved to|written to|\.png/i.test(trimmed)) {
      return OUTPUT_TYPES.FILE;
    }
  }

  // 2. Agent Browser 快照
  if (agentId === 'agent-browser' && action === 'snapshot') {
    return OUTPUT_TYPES.BROWSER_SNAPSHOT;
  }

  // 3. Agent Browser 搜索结果
  if (agentId === 'agent-browser' && action === 'search') {
    return OUTPUT_TYPES.BROWSER_SNAPSHOT;
  }

  // 4. Agent Browser 打开 URL
  if (agentId === 'agent-browser' && action === 'open') {
    return OUTPUT_TYPES.URL;
  }

  // 5. 检测 URL（包含 http/https 链接）
  const urls = extractUrls(trimmed);
  if (urls.length > 0 && trimmed.length < 500) {
    return OUTPUT_TYPES.URL;
  }
  if (urls.length > 0 && trimmed.length >= 500) {
    // 包含 URL 的长文本 → 仍然是 text，但 outputMeta 中标记 URL
    return OUTPUT_TYPES.TEXT;
  }

  // 6. 检测代码块
  if (/```[\w]*\n[\s\S]*?```/.test(trimmed)) {
    return OUTPUT_TYPES.CODE;
  }

  // 7. 检测单行代码（带语言标记）
  if (/^(```\w+)$/m.test(trimmed)) {
    return OUTPUT_TYPES.CODE;
  }

  // 8. 检测可执行命令（以命令关键词开头的短文本）
  const commandPattern = /^(npm|pnpm|yarn|node|python|pip|git|docker|curl|wget|cd |ls |cat |echo |mkdir|touch|chmod|bash |sh )/m;
  if (commandPattern.test(trimmed) && trimmed.split('\n').length <= 5) {
    return OUTPUT_TYPES.COMMAND;
  }

  // 9. 检测文件路径
  const filePattern = /^(\/[\w/.\-]+\.[a-z]+|~\/[\w/.\-]+\.[a-z]+)/m;
  if (filePattern.test(trimmed)) {
    return OUTPUT_TYPES.FILE;
  }

  // 默认文本
  return OUTPUT_TYPES.TEXT;
}

/**
 * 从文本中提取所有 URL
 */
function extractUrls(text) {
  const urlRegex = /https?:\/\/[^\s"']+/g;
  const matches = text.match(urlRegex);
  return matches || [];
}

/**
 * 检测代码语言
 */
function detectCodeLanguage(text) {
  const match = text.match(/```(\w+)/);
  if (match) return match[1];

  // 根据内容推断
  if (/import |export |const |let |function |=>|react|vue/i.test(text)) return 'javascript';
  if (/def |class |import os|from |print\(/i.test(text)) return 'python';
  if (/<html|<div|<span|<body|<head/i.test(text)) return 'html';
  if (/{[^}]+:[^}]+}/.test(text) && /"[^"]+":/.test(text)) return 'json';
  if (/^\$|npm|yarn|pnpm/m.test(text)) return 'bash';

  return '';
}

/**
 * 从代码块提取纯代码（去除 ``` 标记）
 */
function extractCodeFromBlock(text) {
  const match = text.match(/```(?:\w+)?\n?([\s\S]*?)```/);
  if (match) return match[1].trim();
  return text;
}

// ============ CLI 执行 ============

// 并发控制
const MAX_CONCURRENT = 2;
let activeCalls = 0;
const pendingQueue = [];

/**
 * 安全地执行 shell 命令
 */
function executeCommand(command, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const child = exec(command, {
      timeout,
      maxBuffer: 10 * 1024 * 1024, // 10MB
      env: { ...process.env, PATH: process.env.PATH }
    }, (error, stdout, stderr) => {
      if (error) {
        // timeout 特别处理
        if (error.killed || error.signal === 'SIGTERM') {
          reject(new Error(`Command timed out after ${timeout}ms`));
        } else {
          // 即使有 error，也可能有部分 stdout
          resolve({ stdout: stdout || '', stderr: stderr || '', exitCode: error.code || 1 });
        }
      } else {
        resolve({ stdout: stdout || '', stderr: stderr || '', exitCode: 0 });
      }
    });
  });
}

/**
 * 执行并控制并发
 */
async function executeWithConcurrency(command, timeout) {
  return new Promise((resolve, reject) => {
    const run = async () => {
      activeCalls++;
      try {
        const result = await executeCommand(command, timeout);
        activeCalls--;
        resolve(result);
      } catch (err) {
        activeCalls--;
        reject(err);
      } finally {
        // 执行等待队列中的下一个
        if (pendingQueue.length > 0) {
          const next = pendingQueue.shift();
          next();
        }
      }
    };

    if (activeCalls < MAX_CONCURRENT) {
      run();
    } else {
      pendingQueue.push(run);
    }
  });
}

// ============ shell 参数转义 ============

function escapeShellArg(arg) {
  if (!arg) return '';
  return arg
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$')
    .replace(/'/g, "'\\''")
    .trim();
}

// ============ Agent Browser 专用解析 ==========

/**
 * 从 Agent Browser 截图输出中提取 base64 图片
 */
function parseScreenshotOutput(stdout) {
  // Agent browser 可能输出 base64 图片数据、文件路径或终端输出
  if (stdout.includes('base64')) {
    const match = stdout.match(/base64,([a-zA-Z0-9+/=]+)/);
    if (match) return { type: 'base64', data: match[1] };
  }

  // 检查 output 里是否有 base64 图片数据
  if (stdout.length > 1000 && /[a-zA-Z0-9+/]{100,}=*/.test(stdout)) {
    // 可能是 base64 编码的图片
    return { type: 'base64', data: stdout.trim() };
  }

  // 检查文件路径（agent-browser 输出格式: "✓ Screenshot saved to /path/to/file.png"）
  const fileMatch = stdout.match(/Screenshot saved to (.+\.png)/i) ||
                    stdout.match(/(\/[\w/.\-]+\.png)/);
  let filePath = null;
  if (fileMatch) {
    filePath = fileMatch[1].trim();
  } else {
    // 尝试从默认截图目录找最新 png
    const screenshotDirs = [
      path.join(os.homedir(), '.agent-browser', 'tmp', 'screenshots'),
      '/tmp'
    ];
    for (const dir of screenshotDirs) {
      try {
        const files = fs.readdirSync(dir).filter(f => f.endsWith('.png')).sort().reverse();
        if (files.length > 0) {
          filePath = path.join(dir, files[0]);
          break;
        }
      } catch (e) { /* 目录不存在，跳过 */ }
    }
  }

  if (filePath) {
    try {
      if (fs.existsSync(filePath)) {
        const imageBuffer = fs.readFileSync(filePath);
        const base64Data = imageBuffer.toString('base64');
        return { type: 'base64', data: base64Data, filePath };
      }
    } catch (err) {
      console.error('Failed to read screenshot file:', err.message);
    }
  }

  return { type: 'text', data: stdout.trim().substring(0, 500) };
}

/**
 * 从快照输出中提取结构化内容
 */
function parseSnapshotOutput(stdout) {
  // Agent browser 快照输出格式多样，提取关键内容
  const lines = stdout.split('\n').filter(l => l.trim());

  // 提取 URL
  const urls = extractUrls(stdout);

  // 提取标题（通常在较前位置）
  let title = '';
  for (const line of lines.slice(0, 20)) {
    if (line.includes('title') || line.includes('Title') || line.includes('TITLE')) {
      title = line.replace(/.*?[:]\s*/, '').trim();
      break;
    }
  }
  if (!title && lines.length > 0) {
    title = lines[0].substring(0, 100);
  }

  // 提取主要内容
  const contentLines = lines.slice(1, 100).filter(l => {
    const trimmed = l.trim();
    return trimmed.length > 20 && !trimmed.startsWith('{') && !trimmed.startsWith('}');
  });

  return {
    title: title || '页面快照',
    urls,
    summary: contentLines.slice(0, 10).join('\n').substring(0, 1000),
    rawLines: lines.length
  };
}

// ============ 主要 API ============

/**
 * 调用 Agent 并获取增强型回复
 *
 * @param {string} agentId - 'claude' | 'hermes' | 'mimo' | 'agent-browser' | 'aria'
 * @param {string} prompt - 要发送的提示词
 * @param {object} options - 可选参数
 * @param {string} options.action - 针对 agent-browser 的动作类型
 * @param {string} options.conversationContext - 对话上下文（可选）
 * @param {number} options.timeout - 自定义超时（毫秒）
 * @returns {Promise<{outputType: string, content: string, outputMeta: object, error: string|null}>}
 */
async function callAgent(agentId, prompt, options = {}) {
  const startTime = Date.now();
  const action = options.action || 'default';

  // 构建命令
  const agentConfig = AGENT_COMMANDS[agentId];
  const hasBuiltinConfig = !!agentConfig;

  let cmdConfig;
  let useGenericCommand = false;

  if (hasBuiltinConfig) {
    cmdConfig = agentConfig.build(prompt, action);
  } else {
    // 未预注册的 agent → 尝试用命令名直接调用
    useGenericCommand = true;
    cmdConfig = {
      cmd: `${escapeShellArg(agentId)} "${escapeShellArg(prompt)}" 2>&1`,
      timeout: 60000
    };
  }

  const timeout = options.timeout || cmdConfig.timeout || 60000;

  try {
    let outputText, outputType, outputMeta;
    const elapsed = Date.now() - startTime;

    let result;
    try {
      result = await executeWithConcurrency(cmdConfig.cmd, timeout);
    } catch (execErr) {
      if (!hasBuiltinConfig && useGenericCommand) {
        // 通用命令也失败了 → 给用户明确的安装提示
        return {
          outputType: OUTPUT_TYPES.TEXT,
          content: `⚠️ 工具 "${agentId}" 调用失败。请确保已安装：which ${agentId}`,
          outputMeta: { error: true, elapsed: Date.now() - startTime },
          error: execErr.message
        };
      }
      throw execErr;
    }
    outputText = result.stdout.trim() || result.stderr.trim() || '(无输出)';

    if (agentId === 'agent-browser') {
      const parsed = await parseBrowserOutput(agentId, action, outputText, prompt);
      outputType = parsed.outputType;
      outputMeta = parsed.outputMeta;
      outputText = parsed.content;
    } else {
      outputType = detectOutputType(outputText, agentId);
      outputMeta = extractOutputMeta(outputText, outputType);
    }

    return {
      outputType,
      content: outputText,
      outputMeta: {
        ...outputMeta,
        agentId,
        action,
        elapsed,
        timestamp: new Date().toISOString()
      },
      error: null
    };
  } catch (err) {
    console.error(`[AgentExecutor] Error calling ${agentId}:`, err.message);

    // 自动重试一次
    if (options.retry !== false) {
      console.log(`[AgentExecutor] Retrying ${agentId}...`);
      return callAgent(agentId, prompt, { ...options, retry: false, timeout: timeout * 1.5 });
    }

    return {
      outputType: OUTPUT_TYPES.TEXT,
      content: `⚠️ Agent "${agentId}" 调用失败: ${err.message}`,
      outputMeta: { error: true, elapsed: Date.now() - startTime },
      error: err.message
    };
  }
}

/**
 * 解析 Agent Browser 的输出
 */
async function parseBrowserOutput(agentId, action, outputText, prompt) {
  switch (action) {
    case 'screenshot': {
      const parsed = parseScreenshotOutput(outputText);
      if (parsed.type === 'base64') {
        return {
          outputType: OUTPUT_TYPES.BROWSER_SCREENSHOT,
          content: '📸 页面截图',
          outputMeta: {
            screenshotBase64: parsed.data,
            url: extractUrls(prompt)[0] || '',
            timestamp: new Date().toISOString()
          }
        };
      }
      if (parsed.type === 'file') {
        return {
          outputType: OUTPUT_TYPES.FILE,
          content: `📸 截图已保存: ${parsed.path}`,
          outputMeta: { filePath: parsed.path, fileType: 'png' }
        };
      }
      return {
        outputType: OUTPUT_TYPES.TEXT,
        content: outputText,
        outputMeta: {}
      };
    }

    case 'search':
    case 'snapshot': {
      const parsed = parseSnapshotOutput(outputText);
      const urls = extractUrls(outputText);
      return {
        outputType: OUTPUT_TYPES.BROWSER_SNAPSHOT,
        content: parsed.summary || outputText.substring(0, 500),
        outputMeta: {
          title: parsed.title,
          url: urls[0] || '',
          urls: urls,
          summary: parsed.summary,
          rawLineCount: parsed.rawLines
        }
      };
    }

    case 'open': {
      const urls = extractUrls(outputText);
      return {
        outputType: OUTPUT_TYPES.URL,
        content: outputText.substring(0, 300),
        outputMeta: {
          url: urls[0] || prompt,
          title: urls[0] ? `已打开: ${urls[0]}` : `打开页面`,
          description: outputText.substring(0, 200)
        }
      };
    }

    default: {
      const type = detectOutputType(outputText, agentId);
      return {
        outputType: type,
        content: outputText,
        outputMeta: extractOutputMeta(outputText, type)
      };
    }
  }
}

/**
 * 提取输出元数据
 */
function extractOutputMeta(text, outputType) {
  const meta = {};

  switch (outputType) {
    case OUTPUT_TYPES.URL: {
      const urls = extractUrls(text);
      meta.url = urls[0] || '';
      meta.title = urls[0] ? `链接: ${urls[0]}` : '';
      meta.description = text.substring(0, 200);
      break;
    }
    case OUTPUT_TYPES.CODE: {
      const code = extractCodeFromBlock(text);
      meta.language = detectCodeLanguage(text);
      meta.code = code;
      meta.filename = meta.language === 'javascript' ? 'script.js'
        : meta.language === 'python' ? 'script.py'
        : meta.language === 'html' ? 'index.html'
        : meta.language === 'bash' ? 'script.sh'
        : 'code.txt';
      break;
    }
    case OUTPUT_TYPES.COMMAND: {
      const firstLine = text.split('\n')[0].replace(/^[\$>\s]*/, '').trim();
      meta.command = firstLine;
      meta.cwd = process.cwd();
      meta.description = text;
      break;
    }
    case OUTPUT_TYPES.FILE: {
      const pathMatch = text.match(/(\/[\w/.\-]+\.[a-z]+)/);
      meta.filePath = pathMatch ? pathMatch[1] : text;
      const ext = meta.filePath.split('.').pop();
      meta.fileType = ext || 'unknown';
      meta.size = fs.existsSync(meta.filePath)
        ? fs.statSync(meta.filePath).size
        : 0;
      break;
    }
  }

  return meta;
}

/**
 * 获取 Agent 的思考中消息
 */
function getThinkingMessage(agentId, action) {
  const nameMap = {
    claude: 'Claude Code',
    hermes: 'Hermes Agent',
    mimo: 'MiMo Code',
    'agent-browser': 'Agent Browser',
    aria: 'Aria'
  };

  const actionText = {
    default: '思考中',
    search: '搜索中',
    screenshot: '截图中',
    snapshot: '获取页面快照',
    open: '打开页面',
    eval: '执行 JavaScript',
    click: '点击元素'
  };

  return {
    senderId: agentId,
    senderName: nameMap[agentId] || agentId,
    content: `${actionText[action] || '处理中'}...`,
    outputType: OUTPUT_TYPES.THINKING,
    outputMeta: { agentId, action, thinking: true }
  };
}

// ============ 导出 ============

module.exports = {
  callAgent,
  detectOutputType,
  extractUrls,
  detectCodeLanguage,
  getThinkingMessage,
  OUTPUT_TYPES,
  BROWSER_ACTIONS,
  AGENT_COMMANDS
};