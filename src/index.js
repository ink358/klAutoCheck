#!/usr/bin/env node
'use strict';

/**
 * KlAutoCheck —— 其乐（keylol.com）每日任务自动化
 *
 * 用法：
 *   node src/index.js                      # 读取 KL_CONFIG / KL_COOKIES 等环境变量运行
 *   node src/index.js --config my.ini      # 本地配置文件运行（调试用）
 *   node src/index.js --dry-run            # 只校验配置，不访问其乐、不发通知
 *   node src/index.js --tasks checkin      # 只跑指定任务（checkin / wheel）
 */

const { loadConfig } = require('./config');
const { collectFromConfig, registerSecret, redact, redactError } = require('./redact');
const checkin = require('./tasks/checkin');
const wheel = require('./tasks/wheel');
const notify = require('./notify');

const TASKS = { checkin, wheel };

function nowBeijing() {
  return new Date(Date.now() + (8 * 60 + new Date().getTimezoneOffset()) * 60000)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 16);
}

function parseArgs(argv) {
  const args = { tasksFilter: null, dryRun: false, config: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--tasks') args.tasksFilter = (argv[++i] || '').split(',').filter(Boolean);
    else if (argv[i] === '--dry-run') args.dryRun = true;
    else if (argv[i] === '--config') args.config = argv[++i] || null;
  }
  return args;
}

function maskAccountName(account, idx) {
  return account.name || `账号${idx + 1}`;
}

function validate(config) {
  const problems = [];
  if (config.accounts.length === 0) {
    problems.push('没有找到任何账号：请配置 KL_CONFIG（推荐）或 KL_COOKIES');
  } else {
    config.accounts.forEach((acc, i) => {
      if (!acc.cookie) problems.push(`账号 ${i + 1} 缺少 cookie`);
      const unknown = acc.tasks.filter((t) => !TASKS[t]);
      if (unknown.length) problems.push(`账号 ${i + 1} 包含未知任务: ${unknown.join(',')}`);
    });
  }
  const channels = notify.listConfiguredChannels(config.notify);
  if (channels.length === 0) {
    problems.push('未配置任何通知渠道（telegram / serverchan / pushplus / mail 至少配一个）');
  }
  return { problems, channels };
}

function formatResults(results) {
  const lines = [];
  for (const r of results) {
    const title = `【${r.account}】`;
    if (!r.results || r.results.length === 0) {
      lines.push(`${title} 没有执行任何任务`);
      continue;
    }
    for (const t of r.results) {
      if (t.task === 'checkin') {
        if (t.ok) {
          const cb = t.creditBefore && (t.creditBefore['积分'] ?? t.creditBefore['蒸汽']);
          const ca = t.creditAfter && (t.creditAfter['积分'] ?? t.creditAfter['蒸汽']);
          const creditTxt =
            cb != null && ca != null ? `积分 ${cb} -> ${ca}` : cb != null ? `当前积分 ${cb}` : '';
          lines.push(`${title} 签到 ✔  ${t.username ? t.username + ' ' : ''}${creditTxt}`);
        } else {
          lines.push(`${title} 签到 ✘  ${t.error || '未知错误'}`);
        }
      } else if (t.task === 'wheel') {
        if (t.ok) {
          lines.push(`${title} 转盘 ✔  ${t.rolls.join(' / ') || '未执行抽奖'}`);
        } else {
          lines.push(`${title} 转盘 ✘  ${t.error || '未知错误'}`);
        }
      }
    }
  }
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let config;
  try {
    const loaded = loadConfig(args.config);
    config = loaded.config;
    console.log(`配置来源: ${loaded.source}`);
  } catch (err) {
    console.error(`加载配置失败: ${redactError(err)}`);
    process.exit(2);
  }

  // 注册所有敏感值供脱敏器使用（必须在任何输出/错误前完成）
  collectFromConfig(config);
  for (const acc of config.accounts) registerSecret(acc.cookie);

  if (args.tasksFilter) {
    for (const acc of config.accounts) {
      acc.tasks = acc.tasks.filter((t) => args.tasksFilter.includes(t));
    }
  }

  const { problems, channels } = validate(config);
  console.log(`账号数量: ${config.accounts.length}，通知渠道: ${channels.join('、') || '无'}`);

  if (args.dryRun) {
    config.accounts.forEach((acc, i) => {
      const cookieLen = (acc.cookie || '').length;
      console.log(`  账号${i + 1}: ${maskAccountName(acc, i)} | cookie ${cookieLen} 字符 | 任务: ${acc.tasks.join(',')} | 转盘次数: ${acc.wheelTimes}`);
    });
    if (problems.length) {
      console.log('配置问题:');
      for (const p of problems) console.log(`  - ${redact(p)}`);
      process.exit(1);
    }
    console.log('dry-run 校验通过（未访问其乐、未发送通知）');
    return;
  }

  if (problems.length) {
    console.error('配置错误:');
    for (const p of problems) console.error(`  - ${redact(p)}`);
    process.exit(2);
  }

  const ctx = { userAgent: config.userAgent, log: (msg) => console.log(`  ${redact(msg)}`) };
  const allResults = [];
  let hasFailure = false;

  for (let i = 0; i < config.accounts.length; i++) {
    const acc = config.accounts[i];
    const accountName = maskAccountName(acc, i);
    console.log(`\n========== ${accountName} ==========`);

    // 随机延迟，避免整点准时请求
    const delayMs = 1000 + Math.floor(Math.random() * 5000);
    console.log(`  等待 ${(delayMs / 1000).toFixed(1)}s 后开始…`);
    await new Promise((r) => setTimeout(r, delayMs));

    const taskResults = [];
    for (const taskName of acc.tasks) {
      const task = TASKS[taskName];
      if (!task) continue;
      console.log(`  执行任务: ${taskName}`);
      try {
        const r = await task.run(acc, ctx);
        taskResults.push(r);
        if (!r.ok) hasFailure = true;
      } catch (err) {
        hasFailure = true;
        taskResults.push({ task: taskName, ok: false, error: redactError(err) });
      }
    }
    allResults.push({ account: accountName, results: taskResults });
  }

  const report = formatResults(allResults);
  console.log('\n========== 运行结果 ==========');
  console.log(report);

  const title = `KlAutoCheck 每日任务报告 ${nowBeijing()}`;
  const content = `运行时间：${nowBeijing()}（北京时间）\n\n${report}\n\n${
    hasFailure ? '⚠ 存在失败项：如提示 Cookie 失效，请重新抓取并更新 KL_CONFIG Secret。' : '✔ 全部任务执行完成'
  }`;

  console.log('\n发送通知…');
  const notifyResults = await notify.sendAll(config.notify, title, content);
  for (const r of notifyResults) {
    console.log(`  ${r.channel}: ${r.ok ? '✔ 已发送' : '✘ ' + r.error}`);
  }

  process.exit(hasFailure ? 1 : 0);
}

main().catch((err) => {
  console.error(`运行异常: ${redactError(err)}`);
  process.exit(3);
});
