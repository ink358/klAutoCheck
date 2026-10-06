'use strict';

/**
 * 每日签到任务：其乐没有独立的签到接口，"签到"即每日访问。
 * 流程：个人页（读积分） -> 我的动态页 -> 随机帖子 -> 回个人页（读积分对比）
 */

const { fetchText, sleep, randomDelay } = require('../http');
const { redact } = require('../redact');

const BASE = 'https://keylol.com';

function extractUsername(html) {
  // 个人页 <h2 class="mbn">用户名</h2>
  const m = html.match(/<h2[^>]*class="mbn"[^>]*>([\s\S]*?)<\/h2>/);
  if (m) return m[1].replace(/<[^>]+>/g, '').trim();
  return '';
}

function extractCredit(html) {
  // Discuz 个人页积分格式：<em>12345</em> 积分（蒸汽同理）
  const results = {};
  for (const name of ['积分', '蒸汽']) {
    const re = new RegExp(`<em[^>]*>([\\d,\\s]+)</em>\\s*(?:<a[^>]*>)?\\s*${name}`);
    const m = html.match(re);
    if (m) results[name] = parseInt(m[1].replace(/[, ]/g, ''), 10);
  }
  return results;
}

function isLoggedOut(html) {
  // 退出链接消失而登录表单出现 => Cookie 失效
  const hasLogin = /(?:member\.php\?mod=logging|logging\.php\?action=login)/.test(html);
  const hasLogout = /action=logout/.test(html);
  return hasLogin && !hasLogout;
}

async function getOwnUid(cookie, userAgent) {
  const { text } = await fetchText(`${BASE}/forum.php?mod=guide&view=my`, { cookie, userAgent });
  const m = text.match(/space-uid-(\d+)/);
  return m ? m[1] : null;
}

async function visitProfile(cookie, userAgent, url) {
  const { text } = await fetchText(url, { cookie, userAgent });
  if (isLoggedOut(text)) {
    const err = new Error('Cookie 已失效（页面显示未登录），请重新抓取 Cookie 并更新 Secret');
    err.code = 'COOKIE_EXPIRED';
    throw err;
  }
  return { username: extractUsername(text), credit: extractCredit(text) };
}

async function run(account, ctx) {
  const { cookie, userPage } = account;
  const { userAgent, log } = ctx;
  const result = { task: 'checkin', ok: false, steps: [], creditBefore: null, creditAfter: null, username: '' };

  try {
    // 确定个人页地址
    let profileUrl = userPage;
    if (!profileUrl) {
      const uid = await getOwnUid(cookie, userAgent);
      if (!uid) {
        result.error = '无法从"我的"页面解析用户 UID，请确认 Cookie 有效';
        return result;
      }
      profileUrl = `${BASE}/space-uid-${uid}.html`;
    }
    result.steps.push(`个人页 ${redact(profileUrl)}`);

    const before = await visitProfile(cookie, userAgent, profileUrl);
    result.username = before.username || account.name;
    result.creditBefore = before.credit;

    await sleep(2000 + Math.random() * 3000);

    // 每日访问：我的动态页
    await fetchText(`${BASE}/forum.php?mod=guide&view=my`, { cookie, userAgent });
    result.steps.push('访问"我的动态"页 ✔');
    await sleep(2000 + Math.random() * 3000);

    // 随机帖子
    const tid = 300000 + Math.floor(Math.random() * 431528);
    await fetchText(`${BASE}/t${tid}-1-1`, { cookie, userAgent });
    result.steps.push(`访问随机帖子 tid=${tid} ✔`);
    await sleep(2000 + Math.random() * 3000);

    const after = await visitProfile(cookie, userAgent, profileUrl);
    result.creditAfter = after.credit;
    result.steps.push('回访个人页 ✔');
    result.ok = true;

    log(`签到完成：${result.username || '未知用户'}`);
  } catch (err) {
    result.error = err.message;
  }
  return result;
}

module.exports = { run, extractCredit };
