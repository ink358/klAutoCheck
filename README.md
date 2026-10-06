# KlAutoCheck

Forum daily task automation: **scheduled check-in** and **lottery wheel** tasks, **multi-account** support, with unified result notifications to **Telegram / ServerChan / PushPlus / Email**. Zero dependencies, plain Node.js — runs on GitHub Actions on a schedule, or locally on Windows / macOS / Linux.

> ⚠️ Disclaimer: for learning and personal use only. Task automation may fall outside forum rules — use it only on your own account, never run multiple accounts, and respect the community rules of the forums you participate in.

## Features

| Task | Description |
|---|---|
| `checkin` | Daily check-in: visits your profile page → "my posts" feed → a random thread → back to your profile, and reports stat changes (points, stamina, credits) |
| `wheel` | Lottery wheel: automatically grabs the request hash and rolls (consumes 2 credits per roll, up to 3 per day; requires level-2 membership, 50+ posts, and a publicly linked game account) |

Other highlights:

- Multiple accounts, each with its own task list and options
- Stackable notification channels — one run, one summary per channel
- All logs and errors are automatically **redacted**: cookies, tokens and passwords never appear in output
- Random delays and request spacing to mimic human pacing
- Clear "cookie expired" notifications so you know when to re-fetch

## Quick Start (GitHub Actions, recommended)

### 1. Create your repository

Click **Use this template** (or Fork) at the top right of this page.

### 2. Add the Secret

Repository → Settings → Secrets and variables → Actions → New repository secret:

- Name: `KL_CONFIG`
- Secret: fill in the template below and paste the whole thing (multi-line is fine)

```ini
# ===== Notification config (global, configure only what you use) =====

[telegram]
bot_token = 123456789:AAxxxxxxxxxxxxxxxxxxxx
chat_id = 1008610086

[serverchan]
sendkey = SCT123456XXXXXXXXXXXXXXXX

[pushplus]
token = your_pushplus_token

[mail]
smtp_server = smtp.qq.com
smtp_port = 465
user = you@qq.com
pass = your_smtp_auth_code
from = KlAutoCheck <you@qq.com>
mail_to = me@example.com

# ===== Accounts (one [account] block per account) =====

[account]
name = main
cookie = paste_the_full_cookie_line_here
tasks = checkin,wheel
wheel_times = 1

[account]
name = alt
cookie = another_accounts_cookie
tasks = checkin
```

Rules:

- Keys are case-insensitive; `=` and `:` both work; `#` starts a comment (full-line or inline)
- One `[account]` block per account; `name / tasks / wheel_times` can be overridden per account
- With a single account you can skip the `[account]` block and just write `cookie = xxx`; for several accounts without blocks use `cookies = cookie1 && cookie2`
- Only configure the notification channels you actually use and delete the rest

### 3. Grab your Cookie

1. Log in to the forum in Chrome/Edge and make sure your username shows in the top-right corner
2. Press `F12` → **Network** tab → refresh the page
3. Click the first `forum.php` request → **Headers** → scroll to **Request Headers**
4. Copy the **entire line** after `cookie:` (copy from the Network panel — do not rebuild it from the Application panel or `document.cookie`; the login cookies are HttpOnly and would be missed)
5. Paste it after `cookie = ` in the Secret

> The `;` separators must survive copying. Line wraps easily glue two entries together. Make sure the line contains a field ending in `_auth` — that is the actual login credential.

### 4. Run

- Scheduled: the bundled workflow runs daily at 08:30 (UTC+8); edit the cron in `.github/workflows/daily.yml` if needed (note: Actions cron is **UTC**, and scheduled runs can be delayed by minutes)
- Manual: Actions → **Daily Check** → Run workflow — always run once manually after changing Secrets
- GitHub auto-disables scheduled workflows after 60 days without repository activity; re-enable on the Actions page (one manual run counts as activity)

## Local Run (Windows / macOS / Linux)

Requires Node.js ≥ 18. No dependencies, no `npm install` needed:

```bash
# Option 1: environment variable
# PowerShell
$env:KL_CONFIG = Get-Content -Raw config.local.ini; node src/index.js
# Git Bash / Linux
KL_CONFIG="$(cat config.local.ini)" node src/index.js

# Option 2: config file path
node src/index.js --config config.local.ini

# Validate config only (no requests, no notifications)
node src/index.js --dry-run

# Check-in only
node src/index.js --tasks checkin
```

## Notification Channels

| Channel | Required fields | How to get |
|---|---|---|
| Telegram | `bot_token`, `chat_id` | Create a bot via @BotFather; get your chat_id from @userinfobot |
| ServerChan | `sendkey` | Log in at sct.ftqq.com and copy the SendKey |
| PushPlus | `token` | Log in at pushplus.plus (WeChat scan) and copy the token |
| Email | SMTP fields | For QQ Mail: Settings → Account → enable SMTP → generate an auth code (not your login password) |

### Split Secrets (optional)

Prefer separate secrets? Use these instead of (or mixed with) `KL_CONFIG`:

| Secret | Description |
|---|---|
| `KL_COOKIES` | One cookie per line; append extras with `\|`: `cookie \| name \| tasks \| wheel_times` |
| `KL_COOKIE` | Single account cookie |
| `TG_BOT_TOKEN` / `TG_CHAT_ID` | Telegram |
| `SCT_SENDKEY` | ServerChan |
| `PUSHPLUS_TOKEN` | PushPlus |
| `MAIL_USER` / `MAIL_PASS` / `MAIL_TO` / `MAIL_FROM` / `SMTP_SERVER` / `SMTP_PORT` | Email |

Both modes can be mixed: accounts are merged and notification credentials complement each other.

## Account Fields Reference

| Field | Scope | Description |
|---|---|---|
| `cookie` | account | Required, full cookie line copied from the browser |
| `name` | account | Label shown in reports |
| `tasks` | global / account | `checkin,wheel` |
| `wheel_times` | global / account | Rolls per day, 1–3, default 1 (consumes 2 credits each) |
| `lottery_id` | global / account | Lottery activity id, default 46; update it when the activity changes |
| `user_agent` / `ua` | global | Request UA, defaults to Windows Chrome; change it if you grabbed the cookie from a mobile browser |
| `user_page` | account | Profile URL (e.g. short link with your numeric id) — usually auto-detected, no need to set |

## FAQ

**"Cookie invalid / expired" notification?**
Forum login sessions expire after weeks to months. Re-grab the cookie and update the `KL_CONFIG` Secret. Checklist: the pasted cookie **must contain a field ending in `_auth`**; copy the whole line from the **Network panel** (not `document.cookie` — login cookies are HttpOnly; not the Application panel — easy to miss HttpOnly entries); do not log out in that browser afterwards, it invalidates the session.

**Wheel says requirements not met?**
The wheel requires: level-2 membership or above, 50+ posts (threads + replies), a publicly linked game account, and consumes 2 credits per roll. Up to 3 rolls per day, reset at 08:00 (UTC+8).

**Will error messages leak my cookie?**
No. Every output passes a central redactor: registered cookies, tokens and passwords are shown as `***` in logs, errors and notifications. The one thing to avoid yourself: never paste Secret contents into screenshots or Issues.

**Scheduled runs are late?**
GitHub Actions schedules can jitter by minutes up to half an hour — normal. The script also adds internal random delays, so it never fires exactly on the hour.

## Project Layout

```
├── src/
│   ├── index.js           # entry: load config → run tasks → summarize → notify
│   ├── config.js          # INI config parsing (KL_CONFIG / split-secrets modes)
│   ├── redact.js          # global redactor
│   ├── http.js            # request wrapper (UA / cookie / timeout / random delay)
│   ├── tasks/
│   │   ├── checkin.js     # daily check-in
│   │   └── wheel.js       # lottery wheel
│   └── notify/
│       ├── index.js       # notification dispatcher
│       └── smtp.js        # zero-dependency SMTP client (SSL / STARTTLS)
├── .github/workflows/daily.yml
└── config.example.ini
```

## License

MIT
