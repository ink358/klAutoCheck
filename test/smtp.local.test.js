'use strict';
/* 本地假 SMTP 服务器：验证 sendMail 完整对话框（不入库，仅开发用） */
const net = require('net');
const { sendMail } = require('../src/notify/smtp');

const server = net.createServer((socket) => {
  let inData = false;
  socket.setEncoding('utf8');
  socket.write('220 fake.local ESMTP\r\n');
  socket.on('data', (chunk) => {
    for (const rawLine of chunk.split('\r\n')) {
      if (!rawLine) continue;
      const line = rawLine.toUpperCase();
      // base64 用户名/密码区分大小写，必须用原始行比对
      if (inData) {
        if (rawLine === '.') {
          inData = false;
          socket.write('250 OK queued\r\n');
        }
        continue;
      }
      if (line.startsWith('EHLO')) socket.write('250-fake.local\r\n250 8BITMIME\r\n');
      else if (line.startsWith('AUTH LOGIN')) socket.write('334 VXNlcm5hbWU6\r\n');
      else if (rawLine === Buffer.from('test@qq.com').toString('base64')) socket.write('334 UGFzc3dvcmQ6\r\n');
      else if (rawLine === Buffer.from('fakepass').toString('base64')) socket.write('235 ok\r\n');
      else if (line.startsWith('MAIL FROM')) socket.write('250 ok\r\n');
      else if (line.startsWith('RCPT TO')) socket.write('250 ok\r\n');
      else if (line.startsWith('DATA')) { inData = true; socket.write('354 go\r\n'); }
      else if (line.startsWith('QUIT')) { socket.write('221 bye\r\n'); socket.end(); }
      else socket.write('250 ok\r\n');
    }
  });
});

server.listen(2525, '127.0.0.1', async () => {
  try {
    await sendMail({
      smtpServer: '127.0.0.1',
      smtpPort: 2525,
      user: 'test@qq.com',
      pass: 'fakepass',
      from: 'KlAutoCheck <test@qq.com>',
      to: ['me@example.com'],
      subject: 'KlAutoCheck 每日任务报告 测试',
      text: '【测试账号】签到 ✔\n当前积分 12345',
    });
    console.log('SMTP 对话测试 PASS（服务器收到完整流程）');
    process.exit(0);
  } catch (err) {
    console.error('SMTP 测试 FAIL:', err.message);
    process.exit(1);
  } finally {
    setTimeout(() => process.exit(1), 5000).unref();
  }
});
