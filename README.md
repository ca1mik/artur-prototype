# ARTUR PRO

Русскоязычная платформа для управления пассажирскими и грузовыми перевозками: Telegram-бот для заказчиков и перевозчиков, backend на Node.js/TypeScript и премиальная admin-панель на Next.js.

## Что внутри

- `backend/` — API, Telegram-бот, Prisma, сервисы, очереди и правила маршрутизации
- `admin/` — русскоязычная витрина управления заявками, перевозчиками и тарифами
- `mobile/` — Expo / React Native приложение для заказчиков и перевозчиков
- `docker-compose.yml` — контейнерный запуск backend и Redis
- `.env.example` — пример окружения для локального старта

## Текущий стек

- Backend: Node.js + TypeScript + Express
- Telegram Bot: Telegraf
- Mobile: Expo + React Native
- База по умолчанию: SQLite через Prisma
- Очереди и уведомления: Redis при необходимости
- Admin: Next.js App Router

## Быстрый локальный старт

1. Скопируйте `.env.example` в `.env` и заполните `BOT_TOKEN`, `ADMIN_SECRET` и при необходимости `ADMIN_TELEGRAM_ID`.
   Оставляйте `MOBILE_AUTH_DEBUG=false` по умолчанию и включайте его только для локальной отладки OTP.
2. Установите зависимости:

```bash
cd backend
npm install
npm run prisma:seed

cd ../admin
npm install

cd ../mobile
npm install
```

3. Запустите backend:

```bash
cd backend
npm run dev
```

4. Запустите admin-панель:

```bash
cd admin
npm run dev
```

`admin` умеет читать доступ к backend API из корневого `.env`. По умолчанию он использует `ADMIN_SECRET` и адрес `http://127.0.0.1:3000/admin`. При необходимости можно явно задать `ADMIN_API_URL` и `ADMIN_API_SECRET`.

## Контейнерный запуск

Для быстрого запуска backend в контейнере:

```bash
docker compose up --build
```

По умолчанию используется SQLite-файл из `backend/prisma/dev.db`, а Redis подключается только если в `.env` задан `REDIS_URL` и включен `USE_REDIS_QUEUE=true`.

## Полезные команды

### Backend

```bash
npm run build
npm run lint
npm run prisma:seed
npm run dev
```

### Admin

```bash
npm run build
npm run dev
```

### Mobile

```bash
npx tsc --noEmit
npx expo start
npx expo export --platform web
```

## Демо и продажи

- `backend/prisma/seed.ts` теперь поднимает не только справочники, но и демо-заявки, перевозчиков и парк, чтобы продукт можно было сразу показывать на созвоне.
- `admin/` автоматически переключается на качественные демо-данные, если backend недоступен или не настроен `ADMIN_SECRET`.
- Готовые материалы для продаж лежат в папке `sales/`: там можно взять КП, enterprise-security оффер, demo showflow, список лидов и шаблоны первого касания.
- Для почтовой рассылки добавлен CLI-модуль: `cd backend && npm run campaign:preview` для dry-run и `npm run campaign:send` для реальной отправки после заполнения `SMTP_*` в корневом `.env`.

## Mobile и безопасность

- mobile app поддерживает OTP login через `challenge -> verify`;
- access token короткоживущий, refresh token ротируется и может быть отозван на сервере;
- поддержан biometric app lock для повторного доступа к приложению;
- security-метрики показываются в admin-витрине и уже продаются как часть premium оффера.

## Admin API

- `GET /admin/overview`
- `GET /admin/orders`
- `GET /admin/orders/recent`
- `GET /admin/carriers`
- `GET /admin/carriers/pending`
- `POST /admin/carriers/:id/approve`
- `POST /admin/carriers/:id/reject`
- `POST /admin/users/:telegramId/block`
- `GET /admin/pricing`
- `POST /admin/pricing/:vehicleType`

Для доступа используйте заголовок `x-admin-secret`.

## Дальнейшее развитие

- живые таблицы и фильтры в admin-панели
- аналитика по SLA, выручке и конверсии
- рейтинги и отзывы перевозчиков
- встроенный чат и live-tracking
- AI-подсказки для распределения заявок
