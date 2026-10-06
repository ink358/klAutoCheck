'use strict';

/**
 * 每日签到任务：其乐没有独立的签到接口，"签到"即每日访问。
 * 流程：个人页（读积分） -> 我的动态页 -> 随机帖子 -> 回个人页（读积分对比）
 */

const { fetchText, sleep, randomDelay } = require('../http');
const { redact } = require('../redact');

const BASE = 'https://keylol.com';

function extractUsername(html) {
  // 个人页 <h2 class="mbn">用户名(UID: 12345)</h2>，去掉 UID 后缀
  const m = html.match(/<h2[^>]*class="mbn"[^>]*>([\s\S]*?)<\/h2>/);
  if (m) return m[1].replace(/<[^>]+>/g, '').replace(/\(UID:\s*\d+\)/i, '').trim();
  return '';
}

function extractStats(html) {
  // 其乐个人页"统计信息"：<li><em>积分</em>14</li><li><em>体力</em>14 点</li><li><em>蒸汽</em>5 克</li>
  const stats = {};
  const re = /<em[^>]*>(积分|体力|蒸汽|动力|绿意)<\/em>\s*([\d,]+)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    stats[m[1]] = parseInt(m[2].replace(/,/g, ''), 10);
  }
  return stats;
}

/** Discuz 页面内嵌的当前登录用户 UID，最可靠 */
function extractOwnUid(html) {
  const m = html.match(/discuz_uid\s*=\s*'?(\d+)'?/);
  return m ? m[1] : null;
}

function extractTitle(html) {
  const m = html.match(/<title>([^<]*)<\/title>/);
  return m ? m[1].trim() : '(无标题)';
}

/** Discuz 未登录时会返回"提示信息"对话框页（简繁两种标题都覆盖） */
function isGuestPage(html) {
  const title = extractTitle(html);
  if (title.includes('提示信息') || title.includes('提示訊息')) return true;
  return /member\.php\?mod=logging|logging\.php\?action=login/.test(html) && !/action=logout/.test(html);
}

function isLoggedOut(html) {
  return isGuestPage(html);
}

async function getOwnUid(cookie, userAgent, log) {
  const { status, text } = await fetchText(`${BASE}/forum.php?mod=guide&view=my`, { cookie, userAgent });
  log(`我的动态页: HTTP ${status}, ${text.length} 字节, 标题「${extractTitle(text)}」`);
  if (isGuestPage(text)) {
    const err = new Error('Cookie 无效或已失效（服务器返回未登录提示页），请重新抓取 Cookie');
    err.code = 'COOKIE_EXPIRED';
    throw err;
  }
  // 首选页面内嵌的 discuz_uid 变量；其乐的链接均为 suid- 格式
  return extractOwnUid(text);
}

async function visitProfile(cookie, userAgent, url, log) {
  const { status, text } = await fetchText(url, { cookie, userAgent });
  log(`个人页: HTTP ${status}, ${text.length} 字节, 标题「${extractTitle(text)}」`);
  if (isLoggedOut(text)) {
    const err = new Error('Cookie 已失效（页面显示未登录），请重新抓取 Cookie 并更新 Secret');
    err.code = 'COOKIE_EXPIRED';
    throw err;
  }
  return { username: extractUsername(text), stats: extractStats(text) };
}

async function run(account, ctx) {
  const { cookie, userPage } = account;
  const { userAgent, log } = ctx;
  const result = { task: 'checkin', ok: false, steps: [], statsBefore: null, statsAfter: null, username: '' };

  try {
    // 确定个人页地址：其乐的个人页短链是 suid-<uid>
    let profileUrl = userPage;
    if (!profileUrl) {
      const uid = await getOwnUid(cookie, userAgent, log);
      if (!uid) {
        result.error = '无法从"我的"页面解析用户 UID，请确认 Cookie 有效（可查看上方页面标题日志判断登录状态）';
        return result;
      }
      profileUrl = `${BASE}/suid-${uid}`;
    }
    result.steps.push(`个人页 ${redact(profileUrl)}`);

    const before = await visitProfile(cookie, userAgent, profileUrl, log);
    result.username = before.username || account.name;
    result.statsBefore = before.stats;

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

    const after = await visitProfile(cookie, userAgent, profileUrl, log);
    result.statsAfter = after.stats;
    if (!result.username) result.username = after.username;
    result.steps.push('回访个人页 ✔');
    result.ok = true;

    log(`签到完成：${result.username || '未知用户'}`);
  } catch (err) {
    result.error = err.message;
  }
  return result;
}

module.exports = { run, extractStats };
