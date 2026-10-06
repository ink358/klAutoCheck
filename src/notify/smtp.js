'use strict';

/**
 * 零依赖 SMTP 客户端：支持 465 直连 SSL 与 STARTTLS。
 * 仅实现发信所需的最小命令集。
 */

const net = require('net');
const tls = require('tls');
const { redact } = require('../redact');

class SmtpClient {
  constructor({ host, port, timeout = 30000 }) {
    this.host = host;
    this.port = port;
    this.timeout = timeout;
    this.secure = port === 465;
    this.socket = null;
    this.buffer = '';
    this.waiter = null;
  }

  _readResponse() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        reject(new Error('SMTP 响应超时'));
      }, this.timeout);
      this.waiter = {
        onLine: () => {},
        onDone: (code, lines) => {
          clearTimeout(timer);
          resolve({ code, lines });
        },
        onError: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      };
      this._checkBuffer();
    });
  }

  _checkBuffer() {
    if (!this.waiter) return;
    let idx;
    let complete = null;
    while ((idx = this.buffer.indexOf('\r\n')) !== -1) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      if (/^\d{3}-/.test(line)) continue; // 多行中间行
      const m = line.match(/^(\d{3})[ ]/);
      if (m) {
        complete = parseInt(m[1], 10);
        break;
      }
    }
    if (complete != null) {
      const waiter = this.waiter;
      this.waiter = null;
      waiter.onDone(complete);
    }
  }

  connect() {
    return new Promise((resolve, reject) => {
      const onError = (err) => reject(new Error(`SMTP 连接失败: ${err.message}`));
      if (this.secure) {
        this.socket = tls.connect({ host: this.host, port: this.port, rejectUnauthorized: false });
      } else {
        this.socket = net.connect({ host: this.host, port: this.port });
      }
      this.socket.setEncoding('utf8');
      this.socket.setTimeout(this.timeout);
      this.socket.once('error', onError);
      this.socket.once('timeout', () => {
        this.socket.destroy();
        reject(new Error('SMTP 连接超时'));
      });
      this.socket.on('data', (chunk) => {
        this.buffer += chunk;
        this._checkBuffer();
      });
      this.socket.once('secureConnect', () => {});
      // 等待 220 问候
      this._readResponse()
        .then((resp) => {
          if (resp.code === 220) resolve();
          else reject(new Error(`SMTP 问候异常（代码 ${resp.code}）`));
        })
        .catch(reject);
    });
  }

  async command(cmd, expect = 250) {
    if (cmd && !cmd.endsWith('\r\n')) cmd += '\r\n';
    if (cmd) this.socket.write(cmd);
    const resp = await this._readResponse();
    if (expect && resp.code !== expect) {
      throw new Error(`SMTP 命令被拒绝（代码 ${resp.code}，期望 ${expect}）`);
    }
    return resp;
  }
}

// STARTTLS 升级后重新挂载数据监听
function s_bindData(client) {
  client.socket.on('data', (chunk) => {
    client.buffer += chunk;
    client._checkBuffer();
  });
  client.socket.setEncoding('utf8');
}

async function sendMail({ smtpServer, smtpPort, user, pass, from, to, subject, text }) {
  const port = Number(smtpPort) || 465;
  const client = new SmtpClient({ host: smtpServer, port });
  await client.connect();

  if (!client.secure) {
    await client.command('EHLO klautocheck\r\n');
    try {
      await client.command('STARTTLS\r\n', 220);
      client.socket.removeAllListeners('data');
      const upgraded = await new Promise((resolve, reject) => {
        const s = tls.connect({ socket: client.socket, rejectUnauthorized: false }, () => resolve(s));
        s.once('error', (err) => reject(new Error(`STARTTLS 升级失败: ${err.message}`)));
      });
      client.socket = upgraded;
      s_bindData(client);
      await client.command('EHLO klautocheck\r\n');
    } catch (err) {
      // 服务器不支持 STARTTLS（或升级失败）时按原连接继续，后续步骤若连接已坏会自然报错
      console.error(`STARTTLS 不可用，尝试继续: ${redact(err.message)}`);
    }
  }

  await client.command(`EHLO klautocheck\r\n`);
  // AUTH LOGIN
  await client.command('AUTH LOGIN\r\n', 334);
  await client.command(Buffer.from(user).toString('base64') + '\r\n', 334);
  await client.command(Buffer.from(pass).toString('base64') + '\r\n', 235);

  const fromAddr = extractAddr(from || user);
  await client.command(`MAIL FROM:<${fromAddr}>\r\n`);
  for (const rcpt of to) {
    await client.command(`RCPT TO:<${extractAddr(rcpt)}>\r\n`);
  }
  await client.command('DATA\r\n', 354);

  const headers = [
    `From: ${from || user}`,
    `To: ${to.join(', ')}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
  ].join('\r\n');
  const body = Buffer.from(text, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
  const dotStuffed = (headers + body).replace(/\r\n\./g, '\r\n..');
  await client.command(dotStuffed + '\r\n.\r\n');
  client.command('QUIT\r\n', 0).catch(() => {});
  client.socket.end();
}

function extractAddr(s) {
  const m = String(s).match(/<([^>]+)>/);
  return m ? m[1] : String(s).trim();
}

function encodeHeader(s) {
  return `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
}

module.exports = { sendMail };
