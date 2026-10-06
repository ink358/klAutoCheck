# KlAutoCheck

其乐（[keylol.com](https://keylol.com/)）每日任务自动化：**每日签到**、**转盘抽奖（蒸汽消消乐）**，支持**多账号**，任务结果统一推送到 **Telegram / Server酱 / PushPlus / 邮箱**。零依赖，Node.js 直接运行，可在 GitHub Actions 上定时执行，也可以在 Windows / macOS / Linux 本地跑。

> ⚠️ 免责声明：本项目仅供学习交流，自动化任务属于论坛规则的灰色地带，请只用于自己的账号、不要多开小号，遵守 [其乐社区版规](https://keylol.com/)，珍爱账号。

## 功能

| 任务 | 说明 |
|---|---|
| `checkin` | 每日签到：访问个人页 → "我的动态" → 随机帖子 → 回访个人页，报告积分变化 |
| `wheel` | 转盘抽奖：自动抓取 hash 并抽奖（每次消耗 2 蒸汽，每天最多 3 次，需 2 级会员、发帖≥50、公开绑定 Steam） |

其它特性：

- 多账号，每个账号可单独配置执行哪些任务
- 通知渠道可叠加配置，一次运行所有渠道各收到一条汇总报告
- 所有日志与报错自动**脱敏**，Cookie / token / 授权码不会出现在输出里
- 随机延迟 + 请求间隔，模拟真人节奏
- Cookie 失效时推送明确提醒，方便及时更新

## 快速开始（GitHub Actions，推荐）

### 1. 创建仓库

点击页面右上角 **Use this template**（或 Fork 本仓库）。

### 2. 添加 Secret

仓库 → Settings → Secrets and variables → Actions → New repository secret：

- Name：`KL_CONFIG`
- Secret：把下面这段模板填好你的信息后整段粘贴（支持多行）

```ini
# ===== 通知配置（全局，四选一或多选，只配你用的）=====

[telegram]
bot_token = 123456789:AAxxxxxxxxxxxxxxxxxxxx
chat_id = 1008610086

[serverchan]
sendkey = SCT123456XXXXXXXXXXXXXXXX

[pushplus]
token = 你的pushplus_token

[mail]
smtp_server = smtp.qq.com
smtp_port = 465
user = 你的QQ号@qq.com
pass = 邮箱授权码
from = KlAutoCheck <你的QQ号@qq.com>
mail_to = me@example.com

# ===== 账号（[account] 出现几次就是几个账号）=====

[account]
name = 主账号
cookie = 把浏览器里复制的完整Cookie粘到这里
tasks = checkin,wheel
wheel_times = 1

[account]
name = 小号
cookie = 另一个账号的Cookie
tasks = checkin
```

规则：

- 键名不区分大小写，`=` 和 `:` 都行，`#` 开头是注释，行尾 `# 注释` 也可以
- `[account]` 段出现几次就是几个账号，每个账号的 `name / tasks / wheel_times` 可以单独覆盖全局
- 只有一个账号时可以不写 `[account]` 段，直接 `cookie = xxx`；多个账号没有段时也可以写 `cookies = cookie1 && cookie2`
- 通知段只配你用的那个就行，其余段整段删掉

### 3. 抓取 Cookie

1. 用 Chrome/Edge 登录 [keylol.com](https://keylol.com/)
2. 按 `F12` 打开开发者工具 → **Network（网络）** 标签
3. 刷新页面，点击第一个 `forum.php` 请求 → **Headers（标头）** → Request Headers
4. 复制 `cookie:` 后面的**完整一行**（从 Network 面板复制最稳妥，从 Application 面板逐条拼容易漏）
5. 粘贴到 Secret 里 `cookie = ` 后面

> Cookie 里 `;` 分隔符不能丢。折行复制很容易把两条粘成一条，导致登录失败。

### 4. 运行

- 定时：仓库自带的 workflow 每天北京时间 08:30 自动运行（可在 `.github/workflows/daily.yml` 里改 cron，注意 Actions 的 cron 是 **UTC 时间**，且实际触发可能有几分钟延迟）
- 手动：Actions 页面选择 **Daily Check** → Run workflow，可随时手动触发；改完 Secret 后建议先手动跑一次验证
- GitHub 会在仓库 60 天没有任何活动时自动停用定时任务，届时到 Actions 页面重新启用即可（手动跑一次也算活动）

## 本地运行（Windows / macOS / Linux）

需要 Node.js ≥ 18，零依赖无需 `npm install`：

```bash
# 方式一：环境变量
# PowerShell
$env:KL_CONFIG = Get-Content -Raw config.local.ini; node src/index.js
# Git Bash / Linux
KL_CONFIG="$(cat config.local.ini)" node src/index.js

# 方式二：配置文件路径
node src/index.js --config config.local.ini

# 只校验配置格式（不访问其乐、不发通知）
node src/index.js --dry-run

# 只跑签到
node src/index.js --tasks checkin
```

## 通知渠道说明

| 渠道 | 需要的字段 | 获取方式 |
|---|---|---|
| Telegram | `bot_token`、`chat_id` | @BotFather 创建机器人；@userinfobot 查自己的 chat_id |
| Server酱 | `sendkey` | [sct.ftqq.com](https://sct.ftqq.com/) 登录后获取 SendKey |
| PushPlus | `token` | [pushplus.plus](https://www.pushplus.plus/) 微信扫码登录后复制 token |
| 邮箱 | SMTP 相关字段 | QQ 邮箱：设置 → 账户 → 开启 SMTP 服务 → 生成授权码（不是登录密码） |

### 也支持拆分式 Secrets（可选）

不想把所有东西放一个 Secret，可以改用：

| Secret | 说明 |
|---|---|
| `KL_COOKIES` | 多账号，一行一个 Cookie，行尾可用 `\|` 追加：`cookie \| 备注 \| tasks \| wheel_times` |
| `KL_COOKIE` | 单账号 Cookie |
| `TG_BOT_TOKEN` / `TG_CHAT_ID` | Telegram |
| `SCT_SENDKEY` | Server酱 |
| `PUSHPLUS_TOKEN` | PushPlus |
| `MAIL_USER` / `MAIL_PASS` / `MAIL_TO` / `MAIL_FROM` / `SMTP_SERVER` / `SMTP_PORT` | 邮箱 |

两种方式混用也可以，账号会合并、通知凭据互补。

## 账号字段参考

| 字段 | 位置 | 说明 |
|---|---|---|
| `cookie` | 账号 | 必填，浏览器抓取的完整 Cookie |
| `name` | 账号 | 账号备注，出现在报告里，便于区分 |
| `tasks` | 全局 / 账号 | `checkin,wheel`，要执行的任务 |
| `wheel_times` | 全局 / 账号 | 转盘次数 1~3，默认 1（每次消耗 2 蒸汽） |
| `lottery_id` | 全局 / 账号 | 转盘活动 ID，默认 46（蒸汽消消乐），活动换了可改 |
| `user_agent` / `ua` | 全局 | 请求 UA，默认 Windows Chrome；用手机登录抓的 Cookie 就改成手机 UA |
| `user_page` | 账号 | 个人页地址（如 `https://keylol.com/suid-xxxxx`），一般不用填，脚本会自动解析 |

## 常见问题

**提示 Cookie 已失效 / 解析不到用户 UID？**
其乐的登录态会过期（一般几周到几个月）。重新按上面的步骤抓一次 Cookie，更新 `KL_CONFIG` Secret 即可。通知推送里出现失效提醒时请尽快更换。

自查清单：粘贴进 Secret 的 Cookie 里**必须包含形如 `xxxx_auth=...` 的字段**（这是 Discuz 登录态的核心字段）。如果只有 `saltkey` 没有 `_auth`，说明抓取不完整——请改用 **Network 面板复制整行** 的方法，不要用 Console 里 `document.cookie`（其乐的登录 Cookie 是 HttpOnly，`document.cookie` 拿不到），也不要在 Application 面板里逐条手拼。

**转盘提示条件不满足？**
转盘需要：进阶会员（2 级）及以上、发帖数（主题+回帖）≥ 50、公开绑定 Steam 账号，每次抽奖消耗 2 蒸汽，每天最多 3 次（北京时间早 8 点重置）。

**报错信息里会不会泄露我的 Cookie？**
不会。所有输出经过统一脱敏：配置里注册过的 Cookie、token、授权码在日志、报错、推送中一律显示为 `***`。唯一要你自己注意的是**别把 Secret 的内容截图或粘贴到 Issue 里**。

**Actions 定时任务不准点？**
GitHub Actions 的 schedule 本身有几分钟到半小时的抖动，属正常现象。脚本内部还有随机延迟，不会整点准时请求。

## 目录结构

```
├── src/
│   ├── index.js           # 入口：加载配置 → 执行任务 → 汇总 → 通知
│   ├── config.js          # INI 配置解析（KL_CONFIG / KL_COOKIES 双模式）
│   ├── redact.js          # 全局脱敏器
│   ├── http.js            # 请求封装（UA / Cookie / 超时 / 随机延迟）
│   ├── tasks/
│   │   ├── checkin.js     # 每日签到
│   │   └── wheel.js       # 转盘抽奖
│   └── notify/
│       ├── index.js       # 通知统一出口
│       └── smtp.js        # 零依赖 SMTP 客户端（SSL / STARTTLS）
├── .github/workflows/daily.yml
└── config.example.ini
```

## License

MIT
