'use strict';

/**
 * 配置加载与解析
 *
 * 优先级：--config 参数 > KL_CONFIG_FILE > KL_CONFIG > KL_COOKIES/KL_COOKIE + 独立环境变量
 *
 * 支持的 INI 格式（以 KL_CONFIG 为例）：
 *
 *   # ===== 通知配置（全局）=====
 *   [telegram]
 *   bot_token = 123456:ABC
 *   chat_id = 10086
 *
 *   [serverchan]
 *   sendkey = SCTxxxx
 *
 *   [pushplus]
 *   token = xxx
 *
 *   [mail]
 *   smtp_server = smtp.qq.com
 *   smtp_port = 465
 *   user = x@qq.com
 *   pass = 授权码
 *   mail_to = me@example.com
 *
 *   # ===== 账号 =====
 *   [account]
 *   name = 主账号
 *   cookie = xxx; yyy
 *   tasks = checkin,wheel
 *   wheel_times = 1
 *
 * 规则：
 *   - 键名不区分大小写，= 和 : 都可以，# 开头是注释，行尾 # 注释 也可以
 *   - [account] 出现几次就是几个账号
 *   - 只有一个账号时可以直接写 cookie = xxx，不用 [account] 段
 *   - 多账号无段时可用 cookies = cookie1 && cookie2
 *   - 账号字段：name / cookie / cookies / tasks / wheel_times / lottery_id / user_page
 */

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const KNOWN_ACCOUNT_KEYS = new Set(['name', 'cookie', 'cookies', 'tasks', 'wheel_times', 'lottery_id', 'user_page']);

function parseIni(text) {
  const globals = {};   // 顶层键值
  const sections = [];  // { name, items }
  let current = null;

  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    // 行尾注释（保守起见只裁 # ）
    const hashIdx = line.indexOf(' #');
    if (hashIdx > -1) line = line.slice(0, hashIdx).trim();
    if (!line) continue;

    const secMatch = line.match(/^\[(.+)\]$/);
    if (secMatch) {
      current = { name: secMatch[1].trim().toLowerCase(), items: {} };
      sections.push(current);
      continue;
    }

    const sepIdx = findSepIndex(line);
    if (sepIdx === -1) continue; // 无法解析的行直接忽略
    const key = line.slice(0, sepIdx).trim().toLowerCase();
    const value = line.slice(sepIdx + 1).trim();
    if (!key) continue;
    const bucket = current ? current.items : globals;
    if (!(key in bucket)) bucket[key] = value;
  }
  return { globals, sections };
}

function findSepIndex(line) {
  const eq = line.indexOf('=');
  const colon = line.indexOf(':');
  if (eq === -1 && colon === -1) return -1;
  if (eq === -1) return colon;
  if (colon === -1) return eq;
  return Math.min(eq, colon);
}

function splitList(value) {
  return String(value || '')
    .split(/[,;，；\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 从 INI 文本构建配置对象 */
function buildFromIni(text) {
  const { globals, sections } = parseIni(text);
  const config = {
    userAgent: globals.user_agent || globals.ua || DEFAULT_UA,
    accounts: [],
    notify: {},
  };

  const accountBlocks = [];
  for (const sec of sections) {
    if (sec.name === 'account') accountBlocks.push(sec.items);
    else if (sec.name === 'telegram') config.notify.telegram = normalizeTelegram(sec.items);
    else if (sec.name === 'serverchan' || sec.name === 'server酱') config.notify.serverchan = normalizeServerchan(sec.items);
    else if (sec.name === 'pushplus') config.notify.pushplus = normalizePushplus(sec.items);
    else if (sec.name === 'mail' || sec.name === 'email' || sec.name === 'smtp') config.notify.mail = normalizeMail(sec.items);
  }

  // 全局任务设置
  const globalTasks = globals.tasks ? splitList(globals.tasks) : ['checkin', 'wheel'];
  const globalWheelTimes = clampInt(globals.wheel_times, 1, 3, 1);
  const globalLotteryId = intOr(globals.lottery_id, 46);

  // [account] 段
  for (const items of accountBlocks) {
    const cookies = expandCookies(items);
    for (const c of cookies) {
      config.accounts.push(makeAccount(c, items, globalTasks, globalWheelTimes, globalLotteryId, config.accounts.length));
    }
  }

  // 无 [account] 段时：顶层裸 cookie / cookies
  if (config.accounts.length === 0 && (globals.cookie || globals.cookies)) {
    for (const c of expandCookies(globals)) {
      config.accounts.push(makeAccount(c, globals, globalTasks, globalWheelTimes, globalLotteryId, config.accounts.length));
    }
  }

  return config;
}

function expandCookies(items) {
  const list = [];
  if (items.cookies) {
    // cookies = c1 && c2
    for (const c of String(items.cookies).split('&&')) {
      const v = c.trim();
      if (v) list.push(v);
    }
  } else if (items.cookie) {
    list.push(String(items.cookie).trim());
  }
  return list;
}

function makeAccount(cookie, overrides, globalTasks, globalWheelTimes, globalLotteryId, index) {
  const tasks = overrides.tasks ? splitList(overrides.tasks) : globalTasks;
  return {
    name: overrides.name || `账号${index + 1}`,
    cookie,
    tasks,
    wheelTimes: clampInt(overrides.wheel_times, 1, 3, globalWheelTimes),
    lotteryId: intOr(overrides.lottery_id, globalLotteryId),
    userPage: overrides.user_page || '',
  };
}

function normalizeTelegram(items) {
  const cfg = { botToken: items.bot_token || '', chatId: items.chat_id || '' };
  return fillIfEmpty(cfg, {
    botToken: process.env.TG_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TG_CHAT_ID || process.env.TELEGRAM_CHAT_ID,
  });
}

function normalizeServerchan(items) {
  const cfg = { sendKey: items.sendkey || items.send_key || '' };
  return fillIfEmpty(cfg, { sendKey: process.env.SCT_SENDKEY || process.env.SERVERCHAN_SENDKEY });
}

function normalizePushplus(items) {
  const cfg = { token: items.token || '' };
  return fillIfEmpty(cfg, { token: process.env.PUSHPLUS_TOKEN });
}

function normalizeMail(items) {
  const cfg = {
    smtpServer: items.smtp_server || 'smtp.qq.com',
    smtpPort: intOr(items.smtp_port, 465),
    user: items.user || items.mail_user || '',
    pass: items.pass || items.mail_pass || '',
    from: items.from || items.mail_from || '',
    mailTo: items.mail_to || '',
  };
  return fillIfEmpty(cfg, {
    smtpServer: process.env.SMTP_SERVER,
    smtpPort: process.env.SMTP_PORT,
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
    from: process.env.MAIL_FROM,
    mailTo: process.env.MAIL_TO,
  });
}

function fillIfEmpty(target, sources) {
  for (const [k, v] of Object.entries(sources)) {
    if (v != null && v !== '' && !target[k]) target[k] = v;
  }
  return target;
}

function clampInt(value, min, max, fallback) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function intOr(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? fallback : n;
}

/** KL_COOKIES 行格式：cookie | 备注 | tasks | wheel_times */
function accountsFromCookieLines(raw) {
  const accounts = [];
  for (const line of String(raw).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split('|').map((s) => s.trim());
    if (!parts[0]) continue;
    const acc = {
      name: parts[1] || '',
      cookie: parts[0],
      tasks: parts[2] ? splitList(parts[2]) : ['checkin', 'wheel'],
      wheelTimes: clampInt(parts[3], 1, 3, 1),
      lotteryId: 46,
      userPage: '',
    };
    accounts.push(acc);
  }
  return accounts;
}

function applyEnvGlobals(config) {
  if (process.env.KL_USER_AGENT || process.env.KL_UA) {
    config.userAgent = process.env.KL_USER_AGENT || process.env.KL_UA;
  }
  return config;
}

/** 加载配置，返回 { config, source }；configFile 为 --config 指定的本地文件路径 */
function loadConfig(configFile = null) {
  // 1) --config 文件
  if (configFile) {
    const fs = require('fs');
    const text = fs.readFileSync(configFile, 'utf8');
    return { config: applyEnvGlobals(buildFromIni(text)), source: `file: ${configFile}` };
  }

  // 2) KL_CONFIG_FILE
  if (process.env.KL_CONFIG_FILE) {
    const fs = require('fs');
    const text = fs.readFileSync(process.env.KL_CONFIG_FILE, 'utf8');
    return { config: applyEnvGlobals(buildFromIni(text)), source: 'KL_CONFIG_FILE' };
  }

  // 3) KL_CONFIG
  if (process.env.KL_CONFIG && process.env.KL_CONFIG.trim()) {
    return { config: applyEnvGlobals(buildFromIni(process.env.KL_CONFIG)), source: 'KL_CONFIG' };
  }

  // 4) 拆分的 secrets
  const config = { userAgent: process.env.KL_USER_AGENT || process.env.KL_UA || DEFAULT_UA, accounts: [], notify: {} };
  const cookieLines = process.env.KL_COOKIES || '';
  if (cookieLines.trim()) {
    config.accounts.push(...accountsFromCookieLines(cookieLines));
  }
  if (process.env.KL_COOKIE) {
    config.accounts.push({
      name: '',
      cookie: process.env.KL_COOKIE.trim(),
      tasks: ['checkin', 'wheel'],
      wheelTimes: 1,
      lotteryId: 46,
      userPage: '',
    });
  }
  if (process.env.TG_BOT_TOKEN && process.env.TG_CHAT_ID) {
    config.notify.telegram = { botToken: process.env.TG_BOT_TOKEN, chatId: process.env.TG_CHAT_ID };
  }
  if (process.env.SCT_SENDKEY) config.notify.serverchan = { sendKey: process.env.SCT_SENDKEY };
  if (process.env.PUSHPLUS_TOKEN) config.notify.pushplus = { token: process.env.PUSHPLUS_TOKEN };
  if (process.env.MAIL_USER && process.env.MAIL_PASS && process.env.MAIL_TO) {
    config.notify.mail = {
      smtpServer: process.env.SMTP_SERVER || 'smtp.qq.com',
      smtpPort: intOr(process.env.SMTP_PORT, 465),
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASS,
      from: process.env.MAIL_FROM || process.env.MAIL_USER,
      mailTo: process.env.MAIL_TO,
    };
  }
  return { config, source: 'split secrets / env' };
}

module.exports = { loadConfig, DEFAULT_UA, KNOWN_ACCOUNT_KEYS };
