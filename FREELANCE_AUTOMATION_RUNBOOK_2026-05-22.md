# Freelance Automation Runbook - 2026-05-22

## Что уже готово

- Playwright установлен в `backend`
- Chromium установлен локально
- очередь заявок: [sales/freelance-bids-queue-2026-05-22.json](sales/freelance-bids-queue-2026-05-22.json)
- скрипт подачи: [backend/src/tools/runFreelanceBidAutomation.ts](backend/src/tools/runFreelanceBidAutomation.ts)

## Что нужно от тебя

1. Скопировать [.env.freelance.example](.env.freelance.example) в `.env.freelance`
2. Заполнить логины и пароли для нужных площадок
3. Если на площадке есть 2FA:
   - быть рядом на первом запуске
   - подтвердить вход

Либо можно вообще без паролей в файле:
- запустить ручной режим логина
- самому войти в открывшемся браузере
- дальше сессия сохранится в `sales/browser-profile`

## Команды

Проверить, что все данные на месте:

```powershell
cd backend
npm run freelance:check
```

Проверить в ручном режиме без логинов:

```powershell
cd backend
npm run freelance:check -- --manual-login
```

Подготовить отклики без финального submit:

```powershell
cd backend
npm run freelance:prepare
```

Подготовить отклики и войти руками:

```powershell
cd backend
npm run freelance:prepare -- --manual-login
```

Подготовить только одну площадку:

```powershell
cd backend
npm run freelance:prepare -- --platform=weblancer
```

Реально отправлять:

```powershell
cd backend
npm run freelance:submit
```

Реально отправлять после ручного входа:

```powershell
cd backend
npm run freelance:submit -- --manual-login
```

## Где смотреть результат

- скриншоты и логи: `sales/logs/freelance-bid-bot`
- очередь заявок: `sales/freelance-bids-queue-2026-05-22.json`

## Важный нюанс

Первый безопасный запуск лучше делать через `freelance:prepare`, чтобы убедиться, что формы на площадках поймались корректно.

После этого уже запускать `freelance:submit`.
