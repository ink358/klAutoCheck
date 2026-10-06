'use strict';

/**
 * 统一通知出口：Telegram / Server酱 / PushPlus / 邮箱
 * 任一渠道配置了凭据就发送；单个渠道失败不影响其他渠道，且失败信息脱敏。
 */

const { redact } = require('../redact');

async function sendTelegram(cfg, title, content) {
  const url = `https://api.telegram.org/bot${cfg.botToken}/sendMessage`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: cfg.chatId,
      text: `*${title}*\n${content}`,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Telegram 返回 ${resp.status}: ${redact(body).slice(0, 200)}`);
  }
}

async function sendServerchan(cfg, title, content) {
  const url = `https://sctapi.ftqq.com/${encodeURIComponent(cfg.sendKey)}.send`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ title, desp: content }).toString(),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Server酱 返回 ${resp.status}: ${redact(body).slice(0, 200)}`);
  }
}

async function sendPushplus(cfg, title, content) {
  const resp = await fetch('https://www.pushplus.plus/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: cfg.token, title, content, template: 'txt' }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`PushPlus 返回 ${resp.status}: ${redact(body).slice(0, 200)}`);
  }
  const data = await resp.json().catch(() => ({}));
  if (data && data.code !== 200) {
    throw new Error(`PushPlus 返回码 ${data.code}: ${redact(String(data.msg || '')).slice(0, 200)}`);
  }
}

async function sendMail(cfg, title, content) {
  const { sendMail: smtpSend } = require('./smtp');
  const to = String(cfg.mailTo)
    .split(/[,;，；\s]+/)
    .filter(Boolean);
  if (to.length === 0) throw new Error('邮箱通知缺少收件人 mail_to');
  await smtpSend({
    smtpServer: cfg.smtpServer,
    smtpPort: cfg.smtpPort,
    user: cfg.user,
    pass: cfg.pass,
    from: cfg.from || cfg.user,
    to,
    subject: title,
    text: content,
  });
}

/** 向所有已配置渠道发送，返回各渠道结果 [{ channel, ok, error }] */
async function sendAll(notifyCfg, title, content) {
  const channels = [];
  if (notifyCfg.telegram && notifyCfg.telegram.botToken && notifyCfg.telegram.chatId) {
    channels.push(['Telegram', sendTelegram, notifyCfg.telegram]);
  }
  if (notifyCfg.serverchan && notifyCfg.serverchan.sendKey) {
    channels.push(['Server酱', sendServerchan, notifyCfg.serverchan]);
  }
  if (notifyCfg.pushplus && notifyCfg.pushplus.token) {
    channels.push(['PushPlus', sendPushplus, notifyCfg.pushplus]);
  }
  if (notifyCfg.mail && notifyCfg.mail.user && notifyCfg.mail.pass && notifyCfg.mail.mailTo) {
    channels.push(['邮箱', sendMail, notifyCfg.mail]);
  }

  const results = await Promise.all(
    channels.map(async ([name, fn, cfg]) => {
      try {
        await fn(cfg, title, content);
        return { channel: name, ok: true };
      } catch (err) {
        return { channel: name, ok: false, error: redact(err.message || String(err)) };
      }
    })
  );
  return results;
}

function listConfiguredChannels(notifyCfg) {
  const names = [];
  if (notifyCfg.telegram && notifyCfg.telegram.botToken && notifyCfg.telegram.chatId) names.push('Telegram');
  if (notifyCfg.serverchan && notifyCfg.serverchan.sendKey) names.push('Server酱');
  if (notifyCfg.pushplus && notifyCfg.pushplus.token) names.push('PushPlus');
  if (notifyCfg.mail && notifyCfg.mail.user && notifyCfg.mail.pass && notifyCfg.mail.mailTo) names.push('邮箱');
  return names;
}

module.exports = { sendAll, listConfiguredChannels };
