import { unstable_noStore as noStore } from "next/cache";

import { rejectDepositAction, verifyDepositAction } from "./deposit-actions";
import { getAdminDashboardData } from "../lib/adminApi";

type DashboardData = Awaited<ReturnType<typeof getAdminDashboardData>>;
type DashboardCarrier = DashboardData["allCarriers"][number];

const vehicleLabels: Record<string, string> = {
  CAR: "Легковой",
  MINIVAN: "Минивэн",
  MINIBUS: "Микроавтобус",
  BUS: "Автобус",
  GAZELLE: "Газель",
  TRUCK: "Грузовик",
  TRAILER: "Фура",
  SPECIAL: "Спецтехника",
};

const orderStatusLabels: Record<string, string> = {
  AWAITING_DEPOSIT: "Ждет депозит",
  NEW: "Новая",
  ACCEPTED: "Принята",
  IN_PROGRESS: "В работе",
  COMPLETED: "Завершена",
  CANCELLED: "Отменена",
};

const depositStatusLabels: Record<string, string> = {
  PENDING_PAYMENT: "Ждем оплату",
  PENDING_VERIFICATION: "Нужна проверка",
  PAID: "Оплачено",
  REJECTED: "Отклонено",
};

const carrierStatusLabels: Record<string, string> = {
  PENDING_APPROVAL: "На модерации",
  APPROVED: "Одобрен",
  REJECTED: "Отклонен",
  BANNED: "Заблокирован",
};

const rubles = new Intl.NumberFormat("ru-RU");

const formatMoney = (value: number) => `${rubles.format(value)} ₽`;
const formatNumber = (value: number) => rubles.format(value);
const formatDateTime = (value: string) => new Date(value).toLocaleString("ru-RU");
const toVehicleLabel = (value?: string | null) => (value ? vehicleLabels[value] ?? value : "Не указан");
const toTelegramLabel = (value?: bigint | number | string | null) => (value !== undefined && value !== null ? `ID ${String(value)}` : "Не указан");
const toCarrierLabel = (order: DashboardData["orderHistory"][number]) =>
  order.carrier?.fullName?.trim() || toTelegramLabel(order.carrier?.user.telegramId);

const regionHeatmapAnchors: Record<string, { x: number; y: number }> = {
  "\u041a\u0430\u0437\u0430\u043d\u044c": { x: 280, y: 235 },
  "\u0418\u043d\u043d\u043e\u043f\u043e\u043b\u0438\u0441": { x: 330, y: 215 },
  "\u0423\u0444\u0430": { x: 630, y: 260 },
  "\u0421\u0442\u0435\u0440\u043b\u0438\u0442\u0430\u043c\u0430\u043a": { x: 660, y: 335 },
  "\u0421\u0430\u043b\u0430\u0432\u0430\u0442": { x: 705, y: 360 },
  "\u0421\u0430\u043c\u0430\u0440\u0430": { x: 430, y: 185 },
  "\u0422\u043e\u043b\u044c\u044f\u0442\u0442\u0438": { x: 500, y: 150 },
  "\u0423\u043b\u044c\u044f\u043d\u043e\u0432\u0441\u043a": { x: 205, y: 160 },
};

const getCarrierBaseRegion = (carrier: DashboardCarrier) =>
  carrier.region?.name ?? carrier.carrierRegions[0]?.region.name ?? "\u0411\u0435\u0437 \u0440\u0435\u0433\u0438\u043e\u043d\u0430";

const getCarrierCoverageRegions = (carrier: DashboardCarrier) =>
  Array.from(
    new Set([carrier.region?.name, ...carrier.carrierRegions.map((item) => item.region.name)].filter(Boolean))
  ) as string[];

const getCarrierActiveVehicles = (carrier: DashboardCarrier) => {
  const activeVehicles = carrier.vehicles.filter((vehicle) => vehicle.isActive).length;
  if (activeVehicles > 0) {
    return activeVehicles;
  }

  return Math.max(carrier.vehicles.length, 1);
};

const buildInsights = (data: Awaited<ReturnType<typeof getAdminDashboardData>>) => {
  const insights: string[] = [];

  if (data.mode === "fallback") {
    insights.push("Витрина уже готова к показу: если backend не поднят, экран автоматически переключается на качественные демо-данные.");
  }

  if (data.overview.orders.new > 0) {
    insights.push(
      `Сейчас в системе ${formatNumber(data.overview.orders.new)} новых заявок. Это хороший маркер для оффера про ускорение подтверждения и снижение ручной диспетчеризации.`
    );
  }

  if (data.overview.orders.depositPendingVerification > 0) {
    insights.push(
      `${formatNumber(data.overview.orders.depositPendingVerification)} сделки ждут проверки платежки. Это прямой аргумент про защиту выручки и контроль доступа к контактам.`
    );
  }

  if (data.overview.carriers.pending > 0) {
    insights.push(
      `${formatNumber(data.overview.carriers.pending)} перевозчиков ждут модерации. На продаже это сильный аргумент про контроль допуска, качества парка и регионального покрытия.`
    );
  }

  if (data.overview.orders.averagePrice > 0) {
    insights.push(
      `Средний чек уже выглядит бизнесово: ${formatMoney(data.overview.orders.averagePrice)}. На встрече можно уверенно говорить не про "бота", а про выручку и оборот.`
    );
  }

  if (data.overview.security.activeMobileSessions > 0) {
    insights.push(
      `Безопасность теперь продается как часть оффера: ${formatNumber(data.overview.security.activeMobileSessions)} активных мобильных сессий уже идут через OTP-вход, refresh-ротацию и отзыв доступа по logout.`
    );
  }

  if (insights.length === 0) {
    insights.push("Контур ровный: критических перекосов по заказам и перевозчикам не видно.");
  }

  return insights;
};

export default async function Home() {
  noStore();

  const data = await getAdminDashboardData();
  const live = data.mode === "live";
  const insights = buildInsights(data);
  const allCarriers = data.allCarriers;
  const totalActiveFleet = allCarriers.reduce((sum, carrier) => sum + getCarrierActiveVehicles(carrier), 0);
  const depositQueueAmount = Math.round(
    data.depositPendingOrders.reduce((sum, order) => sum + (order.depositAmount ?? Math.round(order.price * 0.1)), 0)
  );
  const projectedCommissionVolume = Math.round(data.overview.orders.grossVolume * 0.1);
  const simplifiedTaxReserve = Math.round(projectedCommissionVolume * 0.06);
  const multiRegionCarriers = allCarriers.filter((carrier) => getCarrierCoverageRegions(carrier).length > 1).length;
  const baseRegionSummary = Array.from(
    allCarriers.reduce<
      Map<
        string,
        {
          name: string;
          carriers: number;
          approved: number;
          pending: number;
          vehicles: number;
          multiRegion: number;
        }
      >
    >((map, carrier) => {
      const baseRegion = getCarrierBaseRegion(carrier);
      const current = map.get(baseRegion) ?? {
        name: baseRegion,
        carriers: 0,
        approved: 0,
        pending: 0,
        vehicles: 0,
        multiRegion: 0,
      };

      current.carriers += 1;
      current.vehicles += getCarrierActiveVehicles(carrier);
      current.approved += carrier.status === "APPROVED" ? 1 : 0;
      current.pending += carrier.status === "PENDING_APPROVAL" ? 1 : 0;
      current.multiRegion += getCarrierCoverageRegions(carrier).length > 1 ? 1 : 0;
      map.set(baseRegion, current);
      return map;
    }, new Map())
      .values()
  ).sort((left, right) => right.carriers - left.carriers || right.vehicles - left.vehicles);
  const heatmapPoints = baseRegionSummary
    .map((item) => ({ ...item, anchor: regionHeatmapAnchors[item.name] }))
    .filter((item): item is typeof item & { anchor: { x: number; y: number } } => Boolean(item.anchor));
  const operationsCards = [
    {
      value: formatMoney(depositQueueAmount),
      label: "manual deposit queue",
      detail: `${formatNumber(data.depositPendingOrders.length)} deals need payment verification before contacts unlock`,
    },
    {
      value: formatMoney(projectedCommissionVolume),
      label: "10% commission potential",
      detail: "quick estimate from current GMV to show platform economics on the call",
    },
    {
      value: formatMoney(simplifiedTaxReserve),
      label: "reserve at 6%",
      detail: "rough planning figure from the commission scenario, useful for weekly cash control",
    },
    {
      value: `${formatNumber(totalActiveFleet)} / ${formatNumber(allCarriers.length)}`,
      label: "active fleet / carriers",
      detail: `${formatNumber(multiRegionCarriers)} carriers already cover more than one region`,
    },
  ];

  const heroMetrics = [
    {
      value: formatNumber(data.overview.orders.total),
      label: "заявок в контуре",
      detail: `${formatNumber(data.overview.orders.new)} новых и ${formatNumber(data.overview.orders.inProgress)} активных прямо сейчас`,
    },
    {
      value: formatNumber(data.overview.carriers.approved),
      label: "активных перевозчиков",
      detail: `${formatNumber(data.overview.carriers.pending)} ждут допуск и подключение к потоку`,
    },
    {
      value: formatMoney(data.overview.orders.grossVolume),
      label: "валовый объем заявок",
      detail: `средний чек ${formatMoney(data.overview.orders.averagePrice)}`,
    },
    {
      value: formatNumber(data.overview.catalog.pricingRules),
      label: "тарифных правил",
      detail: `${formatNumber(data.overview.catalog.regions)} регионов и ${formatNumber(data.overview.catalog.categories)} категорий`,
    },
    {
      value: formatNumber(data.overview.security.protectedDevices),
      label: "защищенных устройств",
      detail: `${formatNumber(data.overview.security.activeMobileSessions)} активных mobile-сессий и OTP-вход`,
    },
  ];

  const capabilityCards = [
    {
      eyebrow: "Канал продаж",
      title: "Telegram-бот принимает заявки без диспетчерского хаоса",
      text: "Заказчик оставляет маршрут, дату, пассажиров или груз, а система сразу собирает полную карточку заказа.",
    },
    {
      eyebrow: "Исполнители",
      title: "Перевозчики подключаются, проходят модерацию и ведут свой парк",
      text: "Регистрация, рабочие регионы, несколько единиц транспорта, фото и управление доступностью уже предусмотрены.",
    },
    {
      eyebrow: "Монетизация",
      title: "Тарифы, рекомендованная цена и встречные предложения в одном контуре",
      text: "Система помогает держать маржинальность и не терять сделку, когда цена требует переговоров.",
    },
    {
      eyebrow: "Контроль",
      title: "Владелец видит спрос, статус рейсов и здоровье платформы",
      text: "Админ-панель собирает управленческую картину по заказам, перевозчикам, тарифам и техническому состоянию.",
    },
    {
      eyebrow: "Security",
      title: "OTP-вход, отзыв сессий и защищенные устройства уже встроены в мобильный контур",
      text: "Это снимает главный страх покупателя: доступ к заказам, телефонам и рейсам больше не держится на одном вечном токене или доверии к номеру телефона.",
    },
  ];

  const useCases = [
    {
      title: "Корпоративная развозка",
      text: "Для компаний, которые возят сотрудников, делегации и клиентов между офисами, производствами, отелями и аэропортами.",
      bullets: ["Единый входящий канал", "Контроль допуска перевозчиков", "Повторяемая тарифная сетка"],
    },
    {
      title: "Межгород и трансферы",
      text: "Для парков и диспетчерских, где критична скорость подтверждения, фиксация подачи и прозрачность статусов.",
      bullets: ["Подтверждение без ручных таблиц", "Статусы рейса в реальном времени", "История по каждому заказу"],
    },
    {
      title: "Грузовые заявки",
      text: "Для региональных логистов и перевозчиков, у которых заявки приходят в Telegram, WhatsApp и по телефону, а потом теряются между людьми.",
      bullets: ["Карточка груза и маршрута", "Отбор подходящего транспорта", "Контроль цены и исполнителя"],
    },
  ];

  const rolloutSteps = [
    {
      step: "01",
      title: "Брендируем и настраиваем контур",
      text: "Под клиента меняются логика входа, тексты, регионы, тарифные правила, роли и правила допуска перевозчиков.",
    },
    {
      step: "02",
      title: "Запускаем пилот на живом потоке",
      text: "Сначала один регион или одно направление: корпоративка, межгород или грузовые заявки.",
    },
    {
      step: "03",
      title: "Подключаем парк и диспетчеров",
      text: "Перевозчики проходят онбординг, добавляют транспорт, а менеджмент начинает видеть реальные показатели и узкие места.",
    },
    {
      step: "04",
      title: "Масштабируем в white-label продукт",
      text: "После пилота контур расширяется на новые регионы, дополнительные категории и отдельные кабинеты под клиентов или франшизу.",
    },
  ];

  const packageCards = [
    {
      title: "Pilot Launch",
      price: "249 000 ₽",
      badge: "быстрый вход",
      points: [
        "1 регион и 1 основной сценарий продаж",
        "Брендирование Telegram-бота и админ-панели",
        "Настройка тарифов, ролей и модерации",
        "Запуск за 10-14 рабочих дней",
      ],
    },
    {
      title: "Growth",
      price: "390 000 ₽",
      badge: "оптимум",
      points: [
        "До 3 регионов и смешанный поток: пассажиры + груз",
        "Доработка ролей, статусов и экранов под операционку клиента",
        "Поддержка внедрения и обучение команды",
        "Рекомендованный формат для большинства региональных компаний",
      ],
    },
    {
      title: "White-Label Enterprise",
      price: "от 690 000 ₽",
      badge: "стратегический оффер",
      points: [
        "Полный white-label и кастомные сценарии",
        "Многорегиональная структура и отдельные бизнес-юниты",
        "Приоритетная доработка и техническое сопровождение",
        "Подходит сетям, крупным перевозчикам и логистическим группам",
      ],
    },
  ];

  const conservativeRecoveredOrders = Math.max(2, Math.min(12, Math.round(data.overview.orders.new * 0.35)));
  const conservativeMonthlyRecoveredRevenue =
    conservativeRecoveredOrders * Math.max(data.overview.orders.averagePrice, 12000);
  const conservativeDispatchHoursSaved = Math.max(24, Math.round(data.overview.orders.total * 1.4));
  const pilotPaybackMonths = Math.max(
    1,
    Math.min(6, Math.ceil(249000 / Math.max(conservativeMonthlyRecoveredRevenue, 80000)))
  );
  const securityReadinessScore = Math.min(
    97,
    58 +
      (data.overview.security.otpEnabled ? 14 : 0) +
      Math.min(10, data.overview.security.protectedDevices * 2) +
      Math.min(8, data.overview.security.activeMobileSessions) +
      Math.min(7, data.overview.security.revokedSessionsLast24h + Math.round(data.overview.security.challengesLast24h / 10))
  );

  const investmentCards = [
    {
      value: formatMoney(conservativeMonthlyRecoveredRevenue),
      label: "консервативно возвращаемой выручки",
      detail: `если перестать терять хотя бы ${formatNumber(conservativeRecoveredOrders)} входящих заказа в месяц`,
    },
    {
      value: `${formatNumber(conservativeDispatchHoursSaved)} ч`,
      label: "ручной операционки можно снять",
      detail: "за счет одного канала заявок, статусов и управляемого доступа перевозчиков",
    },
    {
      value: `${pilotPaybackMonths} мес.`,
      label: "окупаемость пилота",
      detail: "при спокойном сценарии без агрессивного масштабирования в новые регионы",
    },
    {
      value: `${securityReadinessScore}/100`,
      label: "уровень buyer confidence",
      detail: "OTP-вход, отзыв сессий, защита устройств и white-label mobile app уже встроены",
    },
  ];

  const dealRoomPoints = [
    "Брендированный Telegram-бот, mobile app и admin-панель без ощущения самописного MVP.",
    "Настроенные роли, тарифы, регионы, статусы заявок и модерация перевозчиков под сценарий клиента.",
    "Security-слой, который можно продавать отдельно как premium value: OTP, revocable sessions, biometric lock.",
    "Пилот за 10-14 рабочих дней и понятный путь от одного региона к полноценному white-label запуску.",
  ];

  const buyerProof = [
    "Покупателю не нужно финансировать долгую разработку с нуля: он видит готовый контур и платит за скорость выхода.",
    "В демо уже можно показать живую ленту заявок, тарифы, парк перевозчиков, статусы рейсов и защищенный mobile-flow.",
    "Коммерческий разговор легко уводится из плоскости цены бота в плоскость управляемого и защищенного канала продаж.",
  ];

  return (
    <main className="shell">
      <section className="hero">
        <div className="hero-copy card">
          <div className="hero-topline">
            <span className="eyebrow">ARTUR PRO / Sales-ready transport platform</span>
            <span className={`live-badge ${live ? "live-badge-online" : "live-badge-offline"}`}>
              <span className="live-dot" />
              {live ? "Подключено к backend" : "Демо-режим для показов"}
            </span>
          </div>

          <h1>Платформа для перевозок, которую можно продавать владельцам парков уже сейчас.</h1>

          <p className="hero-lead">
            ARTUR PRO превращает Telegram в рабочий канал продаж: заявки, парк перевозчиков, модерация, тарифный движок, торг и админ-контур
            для собственника собираются в один продукт без ощущения "самодельного бота".
          </p>

          <div className="hero-actions">
            <a className="primary-action" href="#live-feed">
              Показать живой контур
            </a>
            <a className="secondary-action" href="#offer">
              Открыть оффер для клиента
            </a>
          </div>

          <div className="pill-row">
            <span className="pill">Telegram-бот для заказчиков</span>
            <span className="pill">Кабинет перевозчика и парк</span>
            <span className="pill">Тарифы и рекомендованная цена</span>
            <span className="pill">Контроль статусов и GMV</span>
          </div>
        </div>

        <aside className="proof-panel card card-dark">
          <div className="panel-head">
            <div>
              <span className="eyebrow eyebrow-light">Панель собственника</span>
              <h2>Продукт выглядит как рабочая система, а не как идея.</h2>
            </div>
            <strong>{live ? "Live mode" : "Showcase mode"}</strong>
          </div>

          {!live && data.fallbackReason ? (
            <p className="mode-note">Демо-данные включены, потому что live-контур сейчас недоступен: {data.fallbackReason}</p>
          ) : null}

          <div className="metric-grid">
            {heroMetrics.map((metric) => (
              <article key={metric.label} className="metric-card">
                <strong>{metric.value}</strong>
                <span>{metric.label}</span>
                <p>{metric.detail}</p>
              </article>
            ))}
          </div>
        </aside>
      </section>

      <section className="split-grid">
        <article className="card">
          <div className="section-headline">
            <div>
              <span className="section-kicker">Почему это продается</span>
              <h2>Сильный оффер строится не вокруг "бота", а вокруг контроля выручки и исполнения.</h2>
            </div>
          </div>

          <div className="insight-list">
            {insights.map((insight) => (
              <p key={insight}>{insight}</p>
            ))}
          </div>
        </article>

        <article className="card accent-card">
          <div className="section-headline">
            <div>
              <span className="section-kicker">Что покупает клиент</span>
              <h2>Не разработку с нуля, а готовый цифровой контур перевозок.</h2>
            </div>
          </div>

          <ul className="plain-list">
            <li>Прием заявок без потерь в Telegram и без переписки по разным чатам.</li>
            <li>Подключение перевозчиков, модерация и управление несколькими машинами.</li>
            <li>Тарифная логика, рекомендованная цена, встречные предложения и контроль среднего чека.</li>
            <li>Панель руководителя с показателями, историей заявок и операционной картиной.</li>
          </ul>
        </article>
      </section>

      <section className="section-block">
        <div className="section-headline">
          <div>
            <span className="section-kicker">Что уже внутри продукта</span>
            <h2>Ключевые модули, которые помогают закрывать сделку быстрее.</h2>
          </div>
        </div>

        <div className="feature-grid">
          {capabilityCards.map((item) => (
            <article key={item.title} className="card feature-card">
              <span className="section-kicker">{item.eyebrow}</span>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section-block">
        <div className="section-headline">
          <div>
            <span className="section-kicker">Кому это нужно</span>
            <h2>Три сегмента, где продукт особенно легко упаковать и продать.</h2>
          </div>
        </div>

        <div className="usecase-grid">
          {useCases.map((item) => (
            <article key={item.title} className="card">
              <h3>{item.title}</h3>
              <p>{item.text}</p>
              <ul className="plain-list">
                {item.bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section id="live-feed" className="section-block">
        <div className="section-headline">
          <div>
            <span className="section-kicker">Живой контур</span>
            <h2>Экран, который можно открывать на созвоне и использовать как продающее демо.</h2>
          </div>
        </div>

        <div className="dashboard-grid">
          <article className="card">
            <div className="card-head">
              <div>
                <span className="section-kicker">Заказы</span>
                <h3>Последние заявки</h3>
              </div>
              <code className="chip">GET /admin/orders/recent</code>
            </div>

            <div className="stack-list">
              {data.recentOrders.map((order) => (
                <article key={order.id} className="feed-card">
                  <div className="feed-row">
                    <strong>#{order.id}</strong>
                    <span className={`status-chip status-order-${order.status.toLowerCase()}`}>
                      {orderStatusLabels[order.status] ?? order.status}
                    </span>
                  </div>
                  <h4>
                    {order.routeFrom} → {order.routeTo}
                  </h4>
                  <p>
                    {toVehicleLabel(order.vehicleType)} · {order.category.name} · {order.region.name}
                  </p>
                  <div className="feed-meta">
                    <span>Цена: {formatMoney(order.price)}</span>
                    <span>Дата: {formatDateTime(order.date)}</span>
                    <span>Заказчик: {order.customer.name}</span>
                  </div>
                </article>
              ))}
            </div>
          </article>

          <article className="card">
            <div className="card-head">
              <div>
                <span className="section-kicker">Deal Control</span>
                <h3>Платежки на проверке</h3>
              </div>
              <code className="chip">GET /admin/orders/deposit-pending</code>
            </div>

            <div className="stack-list">
              {data.depositPendingOrders.length === 0 ? (
                <article className="feed-card">
                  <h4>Очередь пустая</h4>
                  <p>Сделок, которые ждут проверки 10% депозита, сейчас нет.</p>
                </article>
              ) : (
                data.depositPendingOrders.map((order) => (
                  <article key={`deposit-${order.id}`} className="feed-card">
                    <div className="feed-row">
                      <strong>#{order.id}</strong>
                      <span className="status-chip status-order-awaiting_deposit">
                        {depositStatusLabels[order.depositStatus ?? ""] ?? order.status}
                      </span>
                    </div>
                    <h4>
                      {order.routeFrom} → {order.routeTo}
                    </h4>
                    <p>
                      {toVehicleLabel(order.vehicleType)} · {order.category.name} · {order.region.name}
                    </p>
                    <div className="feed-meta">
                      <span>Депозит: {formatMoney(order.depositAmount ?? 0)}</span>
                      <span>Подача: {order.pickupEtaText ?? "не указана"}</span>
                      <span>Заказчик: {order.customer.name}</span>
                      <span>Исполнитель: {toCarrierLabel(order)}</span>
                    </div>
                  </article>
                ))
              )}
            </div>
          </article>

          <article className="card">
            <div className="card-head">
              <div>
                <span className="section-kicker">Модерация</span>
                <h3>Перевозчики в ожидании</h3>
              </div>
              <code className="chip">GET /admin/carriers/pending</code>
            </div>

            <div className="stack-list">
              {data.pendingCarriers.map((carrier) => (
                <article key={carrier.id} className="feed-card">
                  <div className="feed-row">
                    <strong>#{carrier.id}</strong>
                    <span className="status-chip status-carrier-pending">
                      {carrierStatusLabels[carrier.status] ?? carrier.status}
                    </span>
                  </div>
                  <h4>{carrier.fullName ?? `Перевозчик ${carrier.id}`}</h4>
                  <p>
                    {toVehicleLabel(carrier.vehicleType)} · {carrier.brand ?? "Марка не указана"} · {carrier.plateNumber ?? "Номер не указан"}
                  </p>
                  <div className="feed-meta">
                    <span>Телефон: {carrier.user.phone ?? "не указан"}</span>
                    <span>Регион: {carrier.region?.name ?? carrier.carrierRegions[0]?.region.name ?? "не указан"}</span>
                    <span>Машин в парке: {formatNumber(carrier.vehicles.length)}</span>
                  </div>
                </article>
              ))}
            </div>
          </article>

          <article className="card history-card">
            <div className="card-head">
              <div>
                <span className="section-kicker">История</span>
                <h3>Лента заявок и исполнителей</h3>
              </div>
              <code className="chip">GET /admin/orders/history</code>
            </div>

            <div className="stack-list">
              {data.orderHistory.map((order) => (
                <article key={`history-${order.id}`} className="feed-card">
                  <div className="feed-row">
                    <strong>#{order.id}</strong>
                    <span className={`status-chip status-order-${order.status.toLowerCase()}`}>
                      {orderStatusLabels[order.status] ?? order.status}
                    </span>
                  </div>
                  <h4>
                    {order.routeFrom} → {order.routeTo}
                  </h4>
                  <p>
                    {toVehicleLabel(order.vehicleType)} · {order.category.name} · {order.region.name}
                  </p>
                  <div className="feed-meta">
                    <span>Исполнитель: {toCarrierLabel(order)}</span>
                    <span>Заказчик: {order.customer.name}</span>
                    <span>Цена: {formatMoney(order.price)}</span>
                    <span>Подача: {order.pickupEtaText ?? "не указана"}</span>
                    <span>Создана: {formatDateTime(order.createdAt)}</span>
                    <span>Рейс: {formatDateTime(order.date)}</span>
                  </div>
                </article>
              ))}
            </div>
          </article>
        </div>
      </section>

      <section className="section-block">
        <div className="section-headline">
          <div>
            <span className="section-kicker">Ops Room</span>
            <h2>Операционный контур: комиссия, резерв и загрузка парка без ручных таблиц.</h2>
          </div>
        </div>

        <div className="score-grid">
          {operationsCards.map((item) => (
            <article key={item.label} className="card score-card">
              <strong>{item.value}</strong>
              <span>{item.label}</span>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="carrier-heatmap" className="section-block">
        <div className="section-headline">
          <div>
            <span className="section-kicker">Carrier Heatmap</span>
            <h2>Тепловая карта базирования перевозчиков для админ-панели.</h2>
          </div>
        </div>

        <div className="dashboard-grid">
          <article className="card map-card">
            <div className="card-head">
              <div>
                <span className="section-kicker">Base geography</span>
                <h3>Где реально стоит парк</h3>
              </div>
              <code className="chip">GET /admin/carriers</code>
            </div>

            <div className="heatmap-shell">
              <svg className="carrier-map" viewBox="0 0 920 520" role="img" aria-label="Carrier base heatmap">
                <defs>
                  <linearGradient id="heatmap-bg" x1="0%" x2="100%" y1="0%" y2="100%">
                    <stop offset="0%" stopColor="rgba(255,255,255,0.96)" />
                    <stop offset="100%" stopColor="rgba(244,227,201,0.94)" />
                  </linearGradient>
                </defs>
                <rect x="10" y="10" width="900" height="500" rx="36" fill="url(#heatmap-bg)" />
                <path
                  d="M150 145 C250 105, 345 120, 430 185 S600 245, 715 345"
                  fill="none"
                  stroke="rgba(184, 115, 42, 0.18)"
                  strokeWidth="16"
                  strokeLinecap="round"
                />
                <path
                  d="M280 235 C340 225, 460 210, 630 260"
                  fill="none"
                  stroke="rgba(31, 24, 19, 0.08)"
                  strokeWidth="8"
                  strokeLinecap="round"
                />
                {heatmapPoints.map((point) => {
                  const radius = 20 + Math.min(42, point.carriers * 9 + point.vehicles * 3);
                  return (
                    <g key={point.name}>
                      <circle className="heatmap-glow" cx={point.anchor.x} cy={point.anchor.y} r={radius} />
                      <circle className="heatmap-core" cx={point.anchor.x} cy={point.anchor.y} r={12 + point.carriers * 2} />
                      <text className="heatmap-label" x={point.anchor.x} y={point.anchor.y - radius - 10}>
                        {point.name}
                      </text>
                      <text className="heatmap-badge" x={point.anchor.x} y={point.anchor.y + 6}>
                        {point.carriers}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>

            <div className="heatmap-legend">
              <span className="chip">circle size = carriers + active vehicles</span>
              <span className="chip">badge = carriers in base region</span>
              <span className="chip">current mode = base region, not live GPS</span>
            </div>

            <p className="map-hint">
              Сейчас карта строится по базовому региону перевозчика. Если дальше привяжем мобильную геопозицию или
              телематику, этот же экран можно перевести в live-tracking без переделки админки.
            </p>
          </article>

          <article className="card">
            <div className="card-head">
              <div>
                <span className="section-kicker">Coverage desk</span>
                <h3>Горячие точки по базе</h3>
              </div>
              <span className="pill">{formatNumber(baseRegionSummary.length)} base regions</span>
            </div>

            <div className="stack-list">
              {baseRegionSummary.slice(0, 6).map((region) => (
                <article key={region.name} className="feed-card">
                  <div className="feed-row">
                    <strong>{region.name}</strong>
                    <span className="status-chip status-order-new">{formatNumber(region.carriers)} carriers</span>
                  </div>
                  <p>
                    База: {formatNumber(region.carriers)} перевозчиков, активный парк: {formatNumber(region.vehicles)}
                  </p>
                  <div className="feed-meta">
                    <span>Approved: {formatNumber(region.approved)}</span>
                    <span>Pending: {formatNumber(region.pending)}</span>
                    <span>Multi-region: {formatNumber(region.multiRegion)}</span>
                  </div>
                </article>
              ))}
            </div>
          </article>
        </div>
      </section>

      <section className="section-block">
        <div className="section-headline">
          <div>
            <span className="section-kicker">Как внедрять</span>
            <h2>Простой путь от демо до первых оплаченных запусков.</h2>
          </div>
        </div>

        <div className="process-grid">
          {rolloutSteps.map((item) => (
            <article key={item.step} className="card process-card">
              <span className="process-step">{item.step}</span>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="pricing" className="section-block">
        <div className="section-headline">
          <div>
            <span className="section-kicker">Тарифный слой</span>
            <h2>Правила расчета, которые помогают аргументировать цену клиенту и держать маржу.</h2>
          </div>
          <code className="chip">GET /admin/pricing</code>
        </div>

        <div className="pricing-grid">
          {data.pricingRules.map((rule) => (
            <article key={rule.id} className="pricing-card">
              <span>{toVehicleLabel(rule.vehicleType)}</span>
              <strong>{formatMoney(rule.minPrice)}</strong>
              <p>Минимальный порог</p>
              <dl>
                <div>
                  <dt>База</dt>
                  <dd>{formatMoney(rule.basePrice)}</dd>
                </div>
                <div>
                  <dt>За км</dt>
                  <dd>{formatMoney(rule.pricePerKm)}</dd>
                </div>
                <div>
                  <dt>За час</dt>
                  <dd>{formatMoney(rule.pricePerHour)}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </section>

      <section id="offer" className="section-block">
        <div className="section-headline">
          <div>
            <span className="section-kicker">Рекомендованный оффер</span>
            <h2>Три пакета, которые можно использовать в КП уже сегодня.</h2>
          </div>
        </div>

        <div className="package-grid">
          {packageCards.map((item) => (
            <article key={item.title} className="card package-card">
              <div className="package-head">
                <span className="pill">{item.badge}</span>
                <strong>{item.price}</strong>
              </div>
              <h3>{item.title}</h3>
              <ul className="plain-list">
                {item.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section id="investment-case" className="section-block">
        <div className="section-headline">
          <div>
            <span className="section-kicker">Investment Case</span>
            <h2>Блок, который помогает клиенту увидеть не стоимость разработки, а возврат денег и скорости.</h2>
          </div>
        </div>

        <div className="score-grid">
          {investmentCards.map((item) => (
            <article key={item.label} className="card score-card">
              <strong>{item.value}</strong>
              <span>{item.label}</span>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="split-grid">
        <article className="card accent-card">
          <div className="section-headline">
            <div>
              <span className="section-kicker">Deal Room</span>
              <h2>Что именно получает покупатель после оплаты и за что ему легко платить уже сейчас.</h2>
            </div>
          </div>

          <ul className="plain-list">
            {dealRoomPoints.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>

        <article className="card">
          <div className="section-headline">
            <div>
              <span className="section-kicker">Buyer Proof</span>
              <h2>Тезисы, которыми можно дожимать сделку после демо и во втором касании.</h2>
            </div>
          </div>

          <div className="insight-list">
            {buyerProof.map((item) => (
              <p key={item}>{item}</p>
            ))}
          </div>
        </article>
      </section>

      <section className="section-block">
        <div className="section-headline">
          <div>
            <span className="section-kicker">Deposit Desk</span>
            <h2>Очередь проверки платежек с прямым действием из админки.</h2>
          </div>
          <code className="chip">POST /admin/orders/:id/deposit/*</code>
        </div>

        <div className="dashboard-grid">
          {data.depositPendingOrders.length === 0 ? (
            <article className="card">
              <h3>Очередь пустая</h3>
              <p>Сделок на ручной контроль депозита сейчас нет.</p>
            </article>
          ) : (
            data.depositPendingOrders.map((order) => {
              const verifyAction = verifyDepositAction.bind(null, order.id);
              const rejectAction = rejectDepositAction.bind(null, order.id);

              return (
                <article key={`desk-${order.id}`} className="card">
                  <div className="card-head">
                    <div>
                      <span className="section-kicker">Order #{order.id}</span>
                      <h3>{order.routeFrom} {"->"} {order.routeTo}</h3>
                    </div>
                    <span className="status-chip status-order-awaiting_deposit">
                      {depositStatusLabels[order.depositStatus ?? ""] ?? order.status}
                    </span>
                  </div>

                  <div className="feed-meta">
                    <span>Deposit: {formatMoney(order.depositAmount ?? 0)}</span>
                    <span>Ref: {order.depositReference ?? "not set"}</span>
                    <span>Customer: {order.customer.name}</span>
                    <span>Carrier: {toCarrierLabel(order)}</span>
                  </div>

                  <p>
                    {toVehicleLabel(order.vehicleType)} · {order.category.name} · {order.region.name}
                  </p>

                  {live ? (
                    <form className="moderation-form">
                      <label className="moderation-label">
                        <span>Комментарий для команды</span>
                        <textarea
                          name="note"
                          rows={3}
                          className="moderation-input"
                          placeholder="Например: платежка сверена, контакты можно открыть."
                        />
                      </label>
                      <div className="moderation-actions">
                        <button type="submit" formAction={verifyAction} className="moderation-button">
                          Подтвердить
                        </button>
                        <button
                          type="submit"
                          formAction={rejectAction}
                          className="moderation-button moderation-button-danger"
                        >
                          Отклонить
                        </button>
                      </div>
                    </form>
                  ) : (
                    <p className="moderation-hint">
                      Live-мутaции отключены в fallback-режиме. Для реальной проверки поднимите backend с `ADMIN_SECRET`.
                      {data.fallbackReason ? ` Причина: ${data.fallbackReason}.` : ""}
                    </p>
                  )}
                </article>
              );
            })
          )}
        </div>
      </section>

      <section className="system-grid">
        <article className="card">
          <div className="card-head">
            <div>
              <span className="section-kicker">System health</span>
              <h3>Технический контур</h3>
            </div>
            <code className="chip">{data.baseUrl}</code>
          </div>

          <div className="health-list">
            <div className="health-row">
              <span>Telegram</span>
              <strong>{data.overview.health.telegramEnabled ? "Включен" : "Выключен"}</strong>
            </div>
            <div className="health-row">
              <span>Webhook</span>
              <strong>{data.overview.health.useWebhook ? "Активен" : "Polling"}</strong>
            </div>
            <div className="health-row">
              <span>Redis Queue</span>
              <strong>{data.overview.health.useRedisQueue ? "Подключена" : "Не используется"}</strong>
            </div>
            <div className="health-row">
              <span>Клиенты</span>
              <strong>{formatNumber(data.overview.catalog.customers)}</strong>
            </div>
            <div className="health-row">
              <span>OTP-вход</span>
              <strong>{data.overview.security.otpEnabled ? "Активен" : "Выключен"}</strong>
            </div>
            <div className="health-row">
              <span>Mobile sessions</span>
              <strong>{formatNumber(data.overview.security.activeMobileSessions)}</strong>
            </div>
            <div className="health-row">
              <span>Protected devices</span>
              <strong>{formatNumber(data.overview.security.protectedDevices)}</strong>
            </div>
            <div className="health-row">
              <span>Обновлено</span>
              <strong>{formatDateTime(data.overview.generatedAt)}</strong>
            </div>
          </div>
        </article>

        <article className="card">
          <div className="card-head">
            <div>
              <span className="section-kicker">Admin API</span>
              <h3>Контрольные точки</h3>
            </div>
          </div>

          <div className="endpoint-cloud">
            {[
              "GET /admin/overview",
              "GET /admin/orders",
              "GET /admin/orders/recent",
              "GET /admin/orders/history",
              "GET /admin/orders/deposit-pending",
              "GET /admin/carriers",
              "GET /admin/carriers/pending",
              "POST /mobile/auth/challenge",
              "POST /mobile/auth/verify",
              "POST /mobile/auth/refresh",
              "GET /admin/pricing",
              "POST /admin/carriers/:id/approve",
              "POST /admin/carriers/:id/reject",
              "POST /admin/orders/:id/deposit/verify",
              "POST /admin/orders/:id/deposit/reject",
            ].map((endpoint) => (
              <code key={endpoint} className="endpoint-pill">
                {endpoint}
              </code>
            ))}
          </div>
        </article>
      </section>

      <section className="split-grid">
        <article className="card accent-card">
          <div className="section-headline">
            <div>
              <span className="section-kicker">Security Center</span>
              <h2>Контур выглядит дороже, когда безопасность встроена в сам продукт, а не обещается на словах.</h2>
            </div>
          </div>

          <ul className="plain-list">
            <li>OTP-вход по challenge/verify вместо мгновенной сессии по номеру телефона.</li>
            <li>Короткий access token: {formatNumber(data.overview.security.accessTokenTtlMinutes)} минут.</li>
            <li>Refresh token с ротацией и серверным отзывом: {formatNumber(data.overview.security.refreshTokenTtlHours)} часов.</li>
            <li>{formatNumber(data.overview.security.challengesLast24h)} проверок входа за последние 24 часа.</li>
            <li>{formatNumber(data.overview.security.revokedSessionsLast24h)} отзывов сессий за последние 24 часа.</li>
          </ul>
        </article>

        <article className="card">
          <div className="section-headline">
            <div>
              <span className="section-kicker">Sales Angle</span>
              <h2>Этим блоком можно закрывать возражение “а что по безопасности и доступам?”.</h2>
            </div>
          </div>

          <div className="insight-list">
            <p>Покупатель видит, что продукт уже умеет контролировать доступ к телефонам, заказам и парку, а не просто собирает заявки.</p>
            <p>Для крупных клиентов это переводит разговор из “сколько стоит бот” в “сколько стоит защищенный операционный контур”.</p>
            <p>На продаже можно уверенно говорить про white-label mobile app, revocable sessions, device protection и управляемый доступ исполнителей.</p>
          </div>
        </article>
      </section>

      <section className="cta-banner card card-dark">
        <div>
          <span className="eyebrow eyebrow-light">Продажа и запуск</span>
          <h2>ARTUR PRO уже можно упаковывать как готовый продукт для транспортных компаний.</h2>
        </div>
        <p>
          На созвоне эту витрину можно показывать как реальную систему, а в коммерческом предложении продавать не "разработку", а готовый контур
          приема, маршрутизации и контроля перевозок.
        </p>
      </section>
    </main>
  );
}
