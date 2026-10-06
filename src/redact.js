'use strict';

/**
 * 全局脱敏器：收集所有敏感字符串（cookie、token、密码等），
 * 任何将要输出到日志 / 通知 / 错误信息里的文本都必须先经过 redact()。
 */

const secrets = new Set();

function collect(value) {
  if (typeof value === 'string' && value.length >= 6) {
    secrets.add(value.trim());
  }
}

function registerSecret(value) {
  if (!value) return;
  if (typeof value === 'string') {
    // cookie 整串注册，同时按 ; 拆出的每个键值对也注册
    collect(value);
    for (const part of value.split(';')) {
      const kv = part.trim();
      if (kv.includes('=')) collect(kv);
    }
  }
}

/** 从配置对象里递归收集所有敏感字段的值 */
function collectFromConfig(obj) {
  if (obj == null || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    for (const v of obj) collectFromConfig(v);
    return;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') {
      if (isSensitiveKeyName(k)) registerSecret(v);
    } else {
      collectFromConfig(v);
    }
  }
}

const SENSITIVE_KEY_NAMES = new Set([
  'cookie', 'cookies', 'pass', 'password', 'token', 'apikey',
  'bottoken', 'sendkey', 'secret', 'authorization', 'auth', 'mailpass',
]);

function isSensitiveKeyName(key) {
  const norm = String(key).toLowerCase().replace(/[_\-]/g, '');
  return SENSITIVE_KEY_NAMES.has(norm);
}

/** 通用模式兜底：即使某个敏感串没注册到，也按常见键值格式打码 */
const GENERIC_PATTERNS = [
  /(cookie\s*[=:]\s*)([^\s&;#"']{8,})/gi,
  /(token\s*[=:]\s*)([^\s&;#"']{8,})/gi,
  /(sendkey\s*[=:]\s*)([^\s&;#"']{8,})/gi,
  /(pass(word)?\s*[=:]\s*)([^\s&;#"']{8,})/gi,
  /(api[_-]?key\s*[=:]\s*)([^\s&;#"']{8,})/gi,
  /(bot[_-]?token\s*[=:]\s*)([^\s&;#"']{8,})/gi,
  /([a-z0-9_]*sess(\.sig)?[=:])[^\s&;#"']{6,}/gi,
];

function redact(text) {
  if (text == null) return '';
  let out = String(text);
  for (const s of secrets) {
    if (s.length >= 8) {
      // 分隔成片段打码，避免长短不一导致的边界问题
      out = out.split(s).join('***');
    }
  }
  for (const re of GENERIC_PATTERNS) {
    out = out.replace(re, (_m, p1) => `${p1}***`);
  }
  // 无键名的裸 sess 值（如 gld:sess=xxx 形式之外的散落 token）
  out = out.replace(/\b([A-Za-z0-9_]*sess[A-Za-z0-9_.]*=)[A-Za-z0-9%+/=_-]{8,}/g, '$1***');
  return out;
}

function redactError(err) {
  if (!err) return 'unknown error';
  const msg = err && err.message ? err.message : String(err);
  return redact(msg);
}

module.exports = { registerSecret, collectFromConfig, redact, redactError, isSensitiveKeyName };
