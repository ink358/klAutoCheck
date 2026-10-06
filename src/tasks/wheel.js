'use strict';

/**
 * 转盘任务（蒸汽消消乐）：plugin.php?id=steamcn_lottery:view&lottery_id=N
 * 第一次 GET 页面抓取 hash，之后带 hash&roll 抽奖，返回 JSON。
 * 参与条件（每天 3 次，早 8 点重置）：每次消耗 2 蒸汽、公开绑定 Steam、
 * 进阶会员（2 级）及以上、发帖数（主题+回帖）不低于 50。
 */

const { fetchText, sleep } = require('../http');

const BASE = 'https://keylol.com';

const ROLL_LIST = [
  '我全都要（充值卡一份）',
  '都行（返还1蒸汽）',
  '可以（返还1蒸汽）',
  '随你（返还1蒸汽）',
  '没关系（返还1蒸汽）',
  '要放下（返还1蒸汽）',
  '会忍耐（返还1蒸汽）',
  '看淡了（返还1蒸汽）',
  '就这样吧（返还1蒸汽）',
  '一切随缘（返还1蒸汽）',
  '大彻大悟（返还9蒸汽）',
  '任务1',
  '任务2',
  '任务3',
  '任务4',
];

function pageUrl(lotteryId) {
  return `${BASE}/plugin.php?id=steamcn_lottery:view&lottery_id=${lotteryId}`;
}

/** 请求一次：无 hash 时抓页面找 hash；有 hash 时执行抽奖 */
async function rollOnce(cookie, userAgent, lotteryId, hash) {
  let url = pageUrl(lotteryId);
  if (hash) {
    url += `&hash=${hash}&roll&_=${Date.now()}`;
  }
  const { text } = await fetchText(url, { cookie, userAgent });

  if (
    text.includes('需要先登录') || text.includes('需要先登錄') ||
    /<title>[^<]*提示信息/.test(text) ||
    (text.includes('member.php?mod=logging') && !text.includes('action=logout'))
  ) {
    return { kind: 'cookie_expired', message: 'Cookie 已失效，请重新抓取并更新 Secret' };
  }
  if (text.includes('不可参加') || text.includes('不可參加')) {
    return {
      kind: 'not_eligible',
      message: '该账号不满足参与条件（需 2 级及以上会员、发帖≥50、公开绑定 Steam，且消耗 2 蒸汽/次）',
    };
  }
  const hashMatch = text.match(/steamcn_lottery:view&lottery_id=\d+&hash=([^&"' ]+)&roll/);
  if (hashMatch) {
    return { kind: 'hash', hash: hashMatch[1] };
  }
  // 抽奖返回 JSON：{"id":7,"msg":"","good":1}
  try {
    const data = JSON.parse(text);
    if (typeof data.id === 'number' && data.id >= 0) {
      const prize = data.good ? ROLL_LIST[data.id] || `未知奖品 #${data.id}` : '未中奖';
      return { kind: 'result', message: prize };
    }
    return { kind: 'not_eligible', message: '转盘返回不可参与' };
  } catch (e) {
    if (text.includes('转盘')) {
      return { kind: 'need_manual', message: '页面异常：建议先在浏览器里手动转一次，再重新抓取 Cookie' };
    }
    return { kind: 'error', message: '响应格式无法识别（已脱敏），请查看运行日志' };
  }
}

async function run(account, ctx) {
  const { cookie, wheelTimes, lotteryId } = account;
  const { userAgent, log } = ctx;
  const result = { task: 'wheel', ok: false, rolls: [], hashOk: false };

  try {
    const first = await rollOnce(cookie, userAgent, lotteryId, null);
    if (first.kind === 'cookie_expired') {
      result.error = first.message;
      return result;
    }
    if (first.kind === 'not_eligible') {
      result.error = first.message;
      return result;
    }
    if (first.kind !== 'hash') {
      result.error = first.message || '无法获取转盘 hash';
      return result;
    }

    result.hashOk = true;
    for (let i = 0; i < wheelTimes; i++) {
      await sleep(500 + Math.random() * 1500);
      const r = await rollOnce(cookie, userAgent, lotteryId, first.hash);
      if (r.kind === 'result') {
        result.rolls.push(r.message);
        log(`转盘第 ${i + 1} 次：${r.message}`);
      } else if (r.kind === 'not_eligible') {
        // 今日次数用完等情况
        result.rolls.push('今日已无可抽次数或条件不满足');
        break;
      } else {
        result.rolls.push(`异常：${r.message}`);
        break;
      }
    }
    result.ok = true;
  } catch (err) {
    result.error = err.message;
  }
  return result;
}

module.exports = { run };
