# Local Runbook

## 1. Prepare env

- Root `.env` should contain `ADMIN_SECRET`, `BOT_TOKEN`, `DATABASE_URL`, `SMTP_*`, `IMAP_*`.
- Backend also reads `backend/.env` if local overrides are needed.

## 2. First-time setup

```powershell
cd backend
npm install
npm run prisma:dbpush
npm run prisma:seed

cd ..\admin
npm install

cd ..\mobile
npm install
```

## 3. Start backend API

```powershell
cd backend
npm run dev:server
```

Checks:

- API health: `http://127.0.0.1:3000/health`
- Admin API base: `http://127.0.0.1:3000/admin`

## 4. Start Telegram bot

```powershell
cd backend
npm run dev
```

Checks:

- Open the bot and send `/start`
- `backend/bot.stderr.log` should stay empty
- `backend/bot.stdout.log` should show `Telegram proxy enabled`

## 5. Start admin panel

```powershell
cd admin
npm run dev -- --hostname 127.0.0.1 --port 3001
```

Open:

- `http://127.0.0.1:3001`

If you want a stable production-like preview instead of dev mode:

```powershell
cd admin
npm run build
npm run start
```

## 6. Start mobile app in browser

```powershell
cd mobile
npm run web:local
```

Open:

- `http://localhost:19006`

Note:

- In this local Windows setup Expo binds on `localhost` / `::1`, so `http://127.0.0.1:19006` may fail even when the app is healthy.

## 7. Mail monitoring loop

```powershell
cd backend
npm run inbox:watch
```

Artifacts:

- digests: `sales/logs/inbox-digests/`
- campaign logs: `sales/logs/`

## 8. What to verify after launch

- Create a customer order in Telegram.
- Confirm that the draft card appears first and prompt messages stay below it.
- Open admin panel and check:
  - `Ops Room`
  - `Carrier Heatmap`
  - `Deposit Desk`
  - pending carriers list
- Check backend health endpoint.
- Check inbox watcher log output.
- Open mobile web on `http://localhost:19006`

## 9. Hard QA run

For a repeatable end-to-end regression pass against a running backend:

```powershell
cd backend
npm run qa:hard -- --base-url=http://127.0.0.1:3000
```

Artifacts:

- hard QA reports: `sales/logs/qa/`

If you want to keep your main local backend untouched, you can also run a second built API on another port and target it:

```powershell
cd backend
npm run build
cmd /c start "" /b cmd /c "cd /d f:\artur_prot\backend && set PORT=3200 && node dist\api\server.js > backend.stdout.log 2> backend.stderr.log"
npm run qa:hard -- --base-url=http://127.0.0.1:3200
```
