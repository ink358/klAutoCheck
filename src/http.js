'use strict';

const { redact, redactError } = require('./redact');

/**
 * 极简 HTTP 封装：固定浏览器 UA、带 Cookie、超时控制。
 * 所有错误信息在抛出前统一脱敏。
 */

const DEFAULT_TIMEOUT = 30000;

async function fetchText(url, { cookie, userAgent, headers = {}, timeout = DEFAULT_TIMEOUT } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const resp = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': userAgent,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
    });
    const text = await resp.text();
    return { status: resp.status, url: resp.url, text };
  } catch (err) {
    const reason = err && err.name === 'AbortError' ? `请求超时（${timeout}ms）` : redactError(err);
    const e = new Error(`请求失败: ${redact(url)} -> ${reason}`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 随机延迟 [min,max] 毫秒，模拟真人节奏 */
function randomDelay(min, max) {
  const ms = Math.floor(min + Math.random() * (max - min));
  return sleep(ms).then(() => ms);
}

module.exports = { fetchText, sleep, randomDelay };
