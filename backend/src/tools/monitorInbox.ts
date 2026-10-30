import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";

type CliOptions = {
  limit: number;
  sinceHours: number;
  unseenOnly: boolean;
  writeDoc: boolean;
  draftReplies: boolean;
  mailbox: string;
  useOllama: boolean;
  ollamaModel: string;
  sampleFile: string | null;
};

type InboxMessage = {
  uid: number;
  source: "imap" | "sample";
  subject: string;
  from: string;
  fromEmail: string;
  receivedAt: string;
  snippet: string;
  themes: string[];
  nextAction: string;
  draftReply?: string;
  replyDraftWritten?: boolean;
  leadScore: number;
  urgency: "low" | "medium" | "high";
  winningAngle: string;
};

type NormalizedMessageInput = {
  uid: number;
  source: "imap" | "sample";
  subject: string;
  fromName: string;
  fromEmail: string;
  receivedAt: string;
  body: string;
};

type SampleJsonMessage = {
  uid?: number;
  subject?: string;
  from?: string | { name?: string; email?: string };
  fromEmail?: string;
  receivedAt?: string;
  body?: string;
  text?: string;
  snippet?: string;
};

type OllamaLeadAnalysis = {
  themes?: string[] | string;
  nextAction?: string;
  draftReply?: string;
  leadScore?: number | string;
  urgency?: string;
  winningAngle?: string;
};

const backendDir = process.cwd();
const rootDir = path.resolve(backendDir, "..");
const salesDir = path.resolve(rootDir, "sales");
const logsDir = path.resolve(salesDir, "logs");
const digestsDir = path.resolve(logsDir, "inbox-digests");
const repliesDir = path.resolve(logsDir, "reply-drafts");
const sentRepliesDir = path.resolve(logsDir, "reply-sent");

const loadEnv = () => {
  const candidates = [path.resolve(backendDir, ".env"), path.resolve(rootDir, ".env")];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate, override: false });
    }
  }
};

const ensureDir = (dirPath: string) => {
  fs.mkdirSync(dirPath, { recursive: true });
};

const nowStamp = () => {
  const now = new Date();
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
};

const parseArgs = (argv: string[]): CliOptions => {
  const options: CliOptions = {
    limit: 20,
    sinceHours: 72,
    unseenOnly: false,
    writeDoc: false,
    draftReplies: false,
    mailbox: process.env.IMAP_MAILBOX?.trim() || "INBOX",
    useOllama: false,
    ollamaModel: process.env.OLLAMA_MODEL?.trim() || "qwen3:4b",
    sampleFile: null,
  };

  for (const arg of argv) {
    if (arg === "--unseen") {
      options.unseenOnly = true;
      continue;
    }

    if (arg === "--write-doc") {
      options.writeDoc = true;
      continue;
    }

    if (arg === "--draft-replies") {
      options.draftReplies = true;
      continue;
    }

    if (arg === "--use-ollama") {
      options.useOllama = true;
      continue;
    }

    if (arg.startsWith("--limit=")) {
      const value = Number(arg.slice("--limit=".length));
      if (Number.isInteger(value) && value > 0) {
        options.limit = value;
      }
      continue;
    }

    if (arg.startsWith("--since-hours=")) {
      const value = Number(arg.slice("--since-hours=".length));
      if (Number.isFinite(value) && value > 0) {
        options.sinceHours = value;
      }
      continue;
    }

    if (arg.startsWith("--mailbox=")) {
      const mailbox = arg.slice("--mailbox=".length).trim();
      if (mailbox) {
        options.mailbox = mailbox;
      }
      continue;
    }

    if (arg.startsWith("--ollama-model=")) {
      const model = arg.slice("--ollama-model=".length).trim();
      if (model) {
        options.ollamaModel = model;
      }
      continue;
    }

    if (arg.startsWith("--sample-file=")) {
      const sampleFile = arg.slice("--sample-file=".length).trim();
      if (sampleFile) {
        options.sampleFile = sampleFile;
      }
    }
  }

  return options;
};

const appendLog = (logPath: string, payload: Record<string, unknown>) => {
  fs.appendFileSync(logPath, `${JSON.stringify(payload)}\n`, "utf8");
};

const buildDraftFileName = (message: Pick<InboxMessage, "uid" | "fromEmail">) =>
  `${String(message.uid).padStart(6, "0")}-${(message.fromEmail || "reply").replace(/[^a-z0-9._-]+/gi, "-")}.md`;

const requireImapConfig = () => {
  const requiredKeys = ["IMAP_HOST", "IMAP_PORT", "IMAP_USER", "IMAP_PASS"] as const;
  const missing = requiredKeys.filter((key) => !process.env[key]?.trim());

  if (missing.length > 0) {
    throw new Error(`Missing IMAP config: ${missing.join(", ")}`);
  }
};

const normalizeWhitespace = (value: string) =>
  value
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

const makeSnippet = (value: string, maxLength = 380) => {
  const normalized = normalizeWhitespace(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
};

const pickAddress = (entry?: { name?: string | null; address?: string | null } | null) => ({
  name: entry?.name?.trim() || "",
  email: entry?.address?.trim().toLowerCase() || "",
});

const classifyThemes = (subject: string, text: string) => {
  const haystack = `${subject}\n${text}`.toLowerCase();
  const themes: string[] = [];

  const rules: Array<{ theme: string; patterns: RegExp[] }> = [
    { theme: "pricing", patterns: [/цена/, /стоим/, /кп\b/, /коммерческ/, /бюджет/, /услови/] },
    { theme: "demo", patterns: [/демо/, /созвон/, /встреч/, /показат/, /презент/] },
    { theme: "security", patterns: [/безопас/, /доступ/, /otp/, /токен/, /сесси/] },
    { theme: "timeline", patterns: [/срок/, /когда/, /запуск/, /внедрен/, /недел/, /дней/] },
    { theme: "docs", patterns: [/договор/, /счет/, /акт/, /документ/, /закрывающ/, /оплат/] },
    { theme: "objection", patterns: [/дорого/, /подумаем/, /неактуал/, /позже/, /сравнив/] },
  ];

  for (const rule of rules) {
    if (rule.patterns.some((pattern) => pattern.test(haystack))) {
      themes.push(rule.theme);
    }
  }

  return themes.length > 0 ? themes : ["general"];
};

const buildNextAction = (themes: string[]) => {
  if (themes.includes("pricing")) {
    return "Ответить пакетами Pilot / Growth / Enterprise и сразу привязать цену к их сценарию запуска.";
  }

  if (themes.includes("demo")) {
    return "Предложить 20-минутное живое демо с разбором их потока заявок.";
  }

  if (themes.includes("docs")) {
    return "Подтвердить готовность отправить счет, договор и сценарий закрывающих документов.";
  }

  if (themes.includes("security")) {
    return "Дожать через аргумент про управляемый доступ, OTP и контроль контактов.";
  }

  if (themes.includes("timeline")) {
    return "Зафиксировать пилот 10-14 рабочих дней и ограниченный стартовый контур.";
  }

  return "Сделать персональный follow-up и довести до демо или КП.";
};

const buildReplyDraft = (message: Pick<InboxMessage, "from" | "themes">) => {
  const parts: string[] = [
    `Здравствуйте${message.from ? `, ${message.from}` : ""}.`,
    "",
    "Спасибо за ответ и интерес к ARTUR PRO.",
  ];

  if (message.themes.includes("pricing")) {
    parts.push(
      "По стоимости сейчас логично отталкиваться от трех форматов:",
      "- Pilot Launch: от 249 000 ₽ за быстрый запуск пилота на одном сценарии.",
      "- Growth: от 390 000 ₽, если нужен смешанный поток и адаптация под процессы.",
      "- White-Label Enterprise: от 690 000 ₽ для многорегионального и более глубокого контура."
    );
  }

  if (message.themes.includes("timeline")) {
    parts.push("", "По срокам пилотный запуск обычно укладывается в 10-14 рабочих дней после фиксации сценария и доступа к брендингу.");
  }

  if (message.themes.includes("security")) {
    parts.push(
      "",
      "Сильная часть продукта сейчас - это не просто прием заявок, а управляемый доступ: OTP-вход, отзыв сессий, контроль контактов и защищенный этап подтверждения сделки."
    );
  }

  if (message.themes.includes("docs")) {
    parts.push(
      "",
      "По документам можем отдельно подготовить счет, договор и описать логику закрывающих документов под ваш процесс."
    );
  }

  parts.push(
    "",
    "Если удобно, предлагаю короткий созвон на 20 минут: покажу живой контур и сразу скажу, какой пакет лучше подойдет под ваш поток.",
    "",
    "С уважением,",
    "ARTUR PRO"
  );

  return parts.join("\n");
};

const clampLeadScore = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

const inferLeadScore = (themes: string[]) => {
  let score = 54;

  if (themes.includes("pricing")) {
    score += 18;
  }

  if (themes.includes("demo")) {
    score += 16;
  }

  if (themes.includes("docs")) {
    score += 14;
  }

  if (themes.includes("timeline")) {
    score += 8;
  }

  if (themes.includes("objection")) {
    score -= 12;
  }

  return clampLeadScore(score);
};

const inferUrgency = (themes: string[]): "low" | "medium" | "high" => {
  if (themes.includes("pricing") || themes.includes("docs") || themes.includes("timeline")) {
    return "high";
  }

  if (themes.includes("demo") || themes.includes("security")) {
    return "medium";
  }

  return "low";
};

const inferWinningAngle = (themes: string[]) => {
  if (themes.includes("pricing")) {
    return "Привязать стоимость к быстрому пилоту и потерям от ручной диспетчеризации.";
  }

  if (themes.includes("docs")) {
    return "Снять юридическое возражение: счет, договор и закрывающие можно встроить в их процесс.";
  }

  if (themes.includes("security")) {
    return "Подавать продукт как защищенный операционный контур, а не просто бота.";
  }

  if (themes.includes("demo")) {
    return "Не продавать в переписке: увести в короткое живое демо.";
  }

  return "Давить на экономию времени диспетчера и контроль сделки до оплаты.";
};

const isSystemMailbox = (email: string, subject: string) => {
  const haystack = `${email}\n${subject}`.toLowerCase();
  return (
    haystack.includes("mailer-daemon") ||
    haystack.includes("postmaster") ||
    haystack.includes("no-reply") ||
    haystack.includes("noreply") ||
    haystack.includes("delivery status notification") ||
    haystack.includes("undeliver") ||
    haystack.includes("bounce")
  );
};

const isNotificationMailbox = (email: string) => {
  const value = email.toLowerCase();
  return (
    value === "notifications@avito.ru" ||
    value === "messages@avito.ru" ||
    value.endsWith("@news.ozon.ru") ||
    value.endsWith("@emails.tinkoff.ru")
  );
};

const countKeywordMatches = (haystack: string, keywords: string[]) =>
  keywords.reduce((count, keyword) => count + (haystack.includes(keyword) ? 1 : 0), 0);

const hasRelevantProductSignal = (subject: string, body: string) => {
  const haystack = `${subject}\n${body}`.toLowerCase();
  const brandKeywords = ["artur pro"];
  const workflowKeywords = [
    "telegram bot",
    "telegram",
    "dispatch",
    "dispatcher",
    "automation",
    "workflow",
    "бот",
    "телеграм",
    "диспетчер",
    "заявк",
    "автоматизац",
    "заказ",
    "демо",
    "пилот",
    "оплат",
    "контакт",
  ];
  const transportKeywords = [
    "transport",
    "charter",
    "coach",
    "fleet",
    "carrier",
    "bus",
    "перевоз",
    "логист",
    "груз",
    "рейс",
    "парк",
  ];

  if (brandKeywords.some((keyword) => haystack.includes(keyword))) {
    return true;
  }

  return countKeywordMatches(haystack, workflowKeywords) >= 1 && countKeywordMatches(haystack, transportKeywords) >= 1;
};

const isTrackedLeadEmail = (email: string, trackedLeadEmails: Set<string>) => trackedLeadEmails.has(email.toLowerCase());

const collectHandledReplyDraftFiles = () => {
  const handled = new Set<string>();

  if (fs.existsSync(sentRepliesDir)) {
    for (const entry of fs.readdirSync(sentRepliesDir)) {
      handled.add(entry.trim().toLowerCase());
    }
  }

  if (!fs.existsSync(logsDir)) {
    return handled;
  }

  for (const entry of fs.readdirSync(logsDir)) {
    if (!/^reply-send-.*\.jsonl$/i.test(entry)) {
      continue;
    }

    const fullPath = path.resolve(logsDir, entry);
    const lines = fs.readFileSync(fullPath, "utf8").split(/\r?\n/).filter(Boolean);

    for (const line of lines) {
      try {
        const payload = JSON.parse(line) as { type?: string; fileName?: string };
        if (payload.type === "sent" && payload.fileName) {
          handled.add(payload.fileName.trim().toLowerCase());
        }
      } catch {
        continue;
      }
    }
  }

  return handled;
};

const collectTrackedLeadEmails = () => {
  const tracked = new Set<string>();

  if (!fs.existsSync(logsDir)) {
    return tracked;
  }

  for (const entry of fs.readdirSync(logsDir)) {
    if (!/^(campaign|reply-send)-.*\.jsonl$/i.test(entry)) {
      continue;
    }

    const fullPath = path.resolve(logsDir, entry);
    const lines = fs.readFileSync(fullPath, "utf8").split(/\r?\n/).filter(Boolean);

    for (const line of lines) {
      try {
        const payload = JSON.parse(line) as { type?: string; email?: string; to?: string };
        if (payload.type !== "sent") {
          continue;
        }

        const email = String(payload.email ?? payload.to ?? "")
          .trim()
          .toLowerCase();

        if (email) {
          tracked.add(email);
        }
      } catch {
        continue;
      }
    }
  }

  return tracked;
};

const sanitizeThemes = (value: unknown, fallback: string[]) => {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,\n]/g)
      : [];

  const normalized = rawValues
    .map((item) => String(item).trim().toLowerCase())
    .filter(Boolean)
    .map((item) => item.replace(/\s+/g, "-"));

  return normalized.length > 0 ? Array.from(new Set(normalized)).slice(0, 6) : fallback;
};

const sanitizeUrgency = (value: unknown, fallback: "low" | "medium" | "high") => {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();

  if (["high", "urgent", "critical", "высокая", "высокий"].includes(normalized)) {
    return "high";
  }

  if (["medium", "normal", "средняя", "средний"].includes(normalized)) {
    return "medium";
  }

  if (["low", "низкая", "низкий"].includes(normalized)) {
    return "low";
  }

  return fallback;
};

const sanitizeText = (value: unknown, fallback: string) => {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = normalizeWhitespace(value);
  return normalized || fallback;
};

const sanitizeJsonCandidate = (value: string) => {
  const trimmed = value.trim();
  const withoutFence = trimmed.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");

  if (start === -1 || end === -1 || end < start) {
    return withoutFence;
  }

  return withoutFence.slice(start, end + 1);
};

const callOllamaLeadAssist = async (message: NormalizedMessageInput, options: CliOptions): Promise<OllamaLeadAnalysis | null> => {
  const baseUrl = process.env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434";
  const timeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS ?? "120000");
  const keepAlive = process.env.OLLAMA_KEEP_ALIVE?.trim() || "30m";
  const bodyPreview = normalizeWhitespace(message.body).slice(0, 5000);
  const prompt = [
    "Ты senior sales-ассистент по B2B-продажам для продукта ARTUR PRO.",
    "Нужно оценить входящее письмо и помочь дожать до демо, КП или оплаты.",
    "Верни только JSON без markdown и комментариев.",
    "Структура JSON:",
    '{"themes":["pricing"],"leadScore":78,"urgency":"high","nextAction":"...","winningAngle":"...","draftReply":"..."}',
    "Правила:",
    "- themes: массив коротких английских тегов, например pricing, demo, security, timeline, docs, objection, general",
    "- leadScore: число от 0 до 100",
    "- urgency: только low, medium или high",
    "- nextAction: 1 короткое действие для менеджера",
    "- winningAngle: 1 короткий угол дожима",
    "- draftReply: готовый ответ на русском, 120-220 слов, уверенный и коммерческий",
    "",
    `Subject: ${message.subject || "(без темы)"}`,
    `From: ${message.fromName || message.fromEmail || "unknown"}`,
    "Body:",
    bodyPreview || "(пустое письмо)",
  ].join("\n");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: options.ollamaModel,
        prompt,
        stream: false,
        keep_alive: keepAlive,
        options: {
          temperature: 0.2,
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Ollama responded with ${response.status}`);
    }

    const payload = (await response.json()) as { response?: string };
    const raw = typeof payload.response === "string" ? payload.response : "";
    if (!raw.trim()) {
      return null;
    }

    return JSON.parse(sanitizeJsonCandidate(raw)) as OllamaLeadAnalysis;
  } finally {
    clearTimeout(timeout);
  }
};

const buildInboxMessage = async (
  message: NormalizedMessageInput,
  options: CliOptions,
  trackedLeadEmails: Set<string>
): Promise<InboxMessage> => {
  if (isSystemMailbox(message.fromEmail, message.subject)) {
    return {
      uid: message.uid,
      source: message.source,
      subject: message.subject,
      from: message.fromName,
      fromEmail: message.fromEmail,
      receivedAt: message.receivedAt,
      snippet: makeSnippet(message.body),
      themes: ["system"],
      nextAction: "Не отвечать автоматически. Проверить статус доставки и при необходимости перестроить очередь исходящих писем.",
      draftReply: undefined,
      leadScore: 0,
      urgency: "low",
      winningAngle: "Это системное письмо, а не живой лид. Полезно для контроля доставляемости и лимитов SMTP.",
    } satisfies InboxMessage;
  }

  if (isNotificationMailbox(message.fromEmail)) {
    return {
      uid: message.uid,
      source: message.source,
      subject: message.subject,
      from: message.fromName,
      fromEmail: message.fromEmail,
      receivedAt: message.receivedAt,
      snippet: makeSnippet(message.body),
      themes: ["system"],
      nextAction: "Не отвечать автоматически. Если это relay- или marketplace-уведомление, открыть первоисточник и отвечать только вручную по ситуации.",
      draftReply: undefined,
      leadScore: 0,
      urgency: "low",
      winningAngle: "Это служебное уведомление или relay-канал, а не прямой диалог с лидом.",
    } satisfies InboxMessage;
  }

  const heuristicThemes = classifyThemes(message.subject, message.body);
  const heuristicNextAction = buildNextAction(heuristicThemes);
  const heuristicUrgency = inferUrgency(heuristicThemes);
  const heuristicLeadScore = inferLeadScore(heuristicThemes);
  const heuristicWinningAngle = inferWinningAngle(heuristicThemes);

  let themes = heuristicThemes;
  let nextAction = heuristicNextAction;
  let urgency = heuristicUrgency;
  let leadScore = heuristicLeadScore;
  let winningAngle = heuristicWinningAngle;
  let draftReply =
    options.draftReplies
      ? buildReplyDraft({
          from: message.fromName,
          themes: heuristicThemes,
        })
      : undefined;

  if (options.useOllama) {
    try {
      const modelResult = await callOllamaLeadAssist(message, options);
      if (modelResult) {
        themes = sanitizeThemes(modelResult.themes, heuristicThemes);
        nextAction = sanitizeText(modelResult.nextAction, buildNextAction(themes));
        urgency = sanitizeUrgency(modelResult.urgency, inferUrgency(themes));
        leadScore = clampLeadScore(Number(modelResult.leadScore ?? inferLeadScore(themes)));
        winningAngle = sanitizeText(modelResult.winningAngle, inferWinningAngle(themes));

        if (options.draftReplies) {
          draftReply = sanitizeText(
            modelResult.draftReply,
            buildReplyDraft({
              from: message.fromName,
              themes,
            })
          );
        }
      }
    } catch (error) {
      console.warn(`Ollama fallback for message ${message.uid}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const senderTracked = isTrackedLeadEmail(message.fromEmail, trackedLeadEmails);
  const productSignalFound = hasRelevantProductSignal(message.subject, message.body);

  if (!senderTracked && !productSignalFound) {
    return {
      uid: message.uid,
      source: message.source,
      subject: message.subject,
      from: message.fromName,
      fromEmail: message.fromEmail,
      receivedAt: message.receivedAt,
      snippet: makeSnippet(message.body),
      themes: ["general"],
      nextAction: "Проверить вручную: отправитель не из CRM/outreach-базы и в письме нет явного продуктового контекста.",
      draftReply: undefined,
      leadScore: 12,
      urgency: "low",
      winningAngle: "Лучше не автоматизировать ответ на несвязанное или малоконтекстное письмо.",
    } satisfies InboxMessage;
  }

  return {
    uid: message.uid,
    source: message.source,
    subject: message.subject,
    from: message.fromName,
    fromEmail: message.fromEmail,
    receivedAt: message.receivedAt,
    snippet: makeSnippet(message.body),
    themes,
    nextAction,
    draftReply,
    leadScore,
    urgency,
    winningAngle,
  } satisfies InboxMessage;
};

const formatMarkdownDigest = (items: InboxMessage[], options: CliOptions) => {
  const lines: string[] = [
    "# Inbox Monitor Digest",
    "",
    `Generated at: ${new Date().toISOString()}`,
    `Mailbox: ${options.mailbox}`,
    `Window: last ${options.sinceHours} hours`,
    `Messages: ${items.length}`,
    `Analysis: ${options.useOllama ? `heuristics + Ollama (${options.ollamaModel})` : "heuristics only"}`,
    "",
  ];

  for (const item of items) {
    lines.push(`## ${item.subject || "(без темы)"}`);
    lines.push(`- UID: ${item.uid}`);
    lines.push(`- Source: ${item.source}`);
    lines.push(`- From: ${item.fromEmail || item.from || "unknown"}`);
    lines.push(`- Received: ${item.receivedAt}`);
    lines.push(`- Themes: ${item.themes.join(", ")}`);
    lines.push(`- Lead score: ${item.leadScore}`);
    lines.push(`- Urgency: ${item.urgency}`);
    lines.push(`- Winning angle: ${item.winningAngle}`);
    lines.push(`- Next action: ${item.nextAction}`);
    lines.push(`- Snippet: ${item.snippet}`);
    if (item.replyDraftWritten) {
      lines.push("- Reply draft: generated");
    }
    lines.push("");
  }

  return lines.join("\n");
};

const connectClient = () => {
  requireImapConfig();

  const port = Number(process.env.IMAP_PORT);
  return new ImapFlow({
    host: process.env.IMAP_HOST?.trim() as string,
    port,
    secure: (process.env.IMAP_SECURE ?? "").toLowerCase() === "true" || port === 993,
    auth: {
      user: process.env.IMAP_USER?.trim() as string,
      pass: process.env.IMAP_PASS?.trim() as string,
    },
    logger: false,
  });
};

const resolveUserPath = (targetPath: string) => {
  if (path.isAbsolute(targetPath)) {
    return targetPath;
  }

  const candidates = [
    path.resolve(backendDir, targetPath),
    path.resolve(rootDir, targetPath),
  ];

  const resolved = candidates.find((candidate) => fs.existsSync(candidate));
  return resolved ?? path.resolve(backendDir, targetPath);
};

const parsePlainTextSample = (content: string): NormalizedMessageInput[] => {
  const sections = content.split(/\r?\n\r?\n/);
  const headerBlock = sections.shift() ?? "";
  const body = sections.join("\n\n").trim();
  const subjectMatch = headerBlock.match(/^Subject:\s*(.+)$/im);
  const fromMatch = headerBlock.match(/^From:\s*(.+)$/im);
  const receivedAtMatch = headerBlock.match(/^Received:\s*(.+)$/im);
  const rawFrom = fromMatch?.[1]?.trim() ?? "";
  const emailMatch = rawFrom.match(/<([^>]+)>/);

  return [
    {
      uid: 900001,
      source: "sample",
      subject: subjectMatch?.[1]?.trim() ?? "Sample lead",
      fromName: rawFrom.replace(/<[^>]+>/g, "").trim(),
      fromEmail: emailMatch?.[1]?.trim().toLowerCase() ?? "",
      receivedAt: receivedAtMatch?.[1]?.trim() || new Date().toISOString(),
      body,
    },
  ];
};

const coerceSampleMessages = (payload: unknown): NormalizedMessageInput[] => {
  const items = Array.isArray(payload) ? payload : [payload];

  return items.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }

    const sample = entry as SampleJsonMessage;
    const fromValue = sample.from;
    const fromName =
      typeof fromValue === "string"
        ? fromValue
        : typeof fromValue === "object" && fromValue
          ? fromValue.name?.trim() || ""
          : "";
    const fromEmail =
      sample.fromEmail?.trim().toLowerCase() ||
      (typeof fromValue === "object" && fromValue?.email ? fromValue.email.trim().toLowerCase() : "");
    const body = sample.body ?? sample.text ?? sample.snippet ?? "";

    return [
      {
        uid: Number(sample.uid ?? 900001 + index),
        source: "sample" as const,
        subject: sample.subject?.trim() || `Sample lead ${index + 1}`,
        fromName,
        fromEmail,
        receivedAt: sample.receivedAt?.trim() || new Date().toISOString(),
        body,
      },
    ];
  });
};

const loadSampleMessages = async (sampleFile: string) => {
  const resolvedPath = resolveUserPath(sampleFile);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Sample file not found: ${resolvedPath}`);
  }

  const extension = path.extname(resolvedPath).toLowerCase();

  if (extension === ".eml") {
    const parsed = (await simpleParser(fs.readFileSync(resolvedPath))) as ParsedMail;
    const from = parsed.from?.value[0];
    return [
      {
        uid: 900001,
        source: "sample" as const,
        subject: parsed.subject?.trim() || "Sample lead",
        fromName: from?.name?.trim() || "",
        fromEmail: from?.address?.trim().toLowerCase() || "",
        receivedAt: parsed.date?.toISOString() || new Date().toISOString(),
        body: parsed.text || (typeof parsed.html === "string" ? parsed.html : ""),
      },
    ];
  }

  const content = fs.readFileSync(resolvedPath, "utf8");

  if (extension === ".json") {
    return coerceSampleMessages(JSON.parse(content));
  }

  return parsePlainTextSample(content);
};

const fetchImapMessages = async (client: ImapFlow, options: CliOptions): Promise<NormalizedMessageInput[]> => {
  const lock = await client.getMailboxLock(options.mailbox);

  try {
    const sinceDate = new Date(Date.now() - options.sinceHours * 60 * 60 * 1000);
    const searchQuery: Record<string, unknown> = { since: sinceDate };

    if (options.unseenOnly) {
      searchQuery.seen = false;
    }

    const uidsRaw = await client.search(searchQuery as never);
    const selectedUids = (Array.isArray(uidsRaw) ? uidsRaw : []).sort((a, b) => b - a).slice(0, options.limit);
    const items: NormalizedMessageInput[] = [];

    for await (const message of client.fetch(selectedUids, {
      uid: true,
      envelope: true,
      source: true,
      internalDate: true,
    })) {
      if (!message.source) {
        continue;
      }

      const parsed = (await simpleParser(message.source)) as ParsedMail;
      const body = parsed.text || (typeof parsed.html === "string" ? parsed.html : "");
      const fromValue = Array.isArray(message.envelope?.from) ? message.envelope.from[0] : undefined;
      const from = pickAddress(fromValue);

      items.push({
        uid: message.uid,
        source: "imap",
        subject: message.envelope?.subject?.trim() || parsed.subject?.trim() || "",
        fromName: from.name,
        fromEmail: from.email,
        receivedAt: new Date(message.internalDate ?? Date.now()).toISOString(),
        body,
      });
    }

    return items;
  } finally {
    lock.release();
  }
};

const shouldWriteReplyDraft = (
  message: InboxMessage,
  sourceBody: string,
  trackedLeadEmails: Set<string>,
  handledDraftFiles: Set<string>
) => {
  if (!message.draftReply || !message.fromEmail) {
    return false;
  }

  if (isNotificationMailbox(message.fromEmail)) {
    return false;
  }

  const fileName = buildDraftFileName(message).toLowerCase();
  if (handledDraftFiles.has(fileName)) {
    return false;
  }

  if (isTrackedLeadEmail(message.fromEmail, trackedLeadEmails)) {
    return true;
  }

  if (message.leadScore < 70) {
    return false;
  }

  return hasRelevantProductSignal(message.subject, sourceBody);
};

const writeReplyDraft = (
  message: InboxMessage,
  sourceBody: string,
  trackedLeadEmails: Set<string>,
  handledDraftFiles: Set<string>
) => {
  if (!shouldWriteReplyDraft(message, sourceBody, trackedLeadEmails, handledDraftFiles)) {
    return false;
  }

  if (!message.draftReply) {
    return false;
  }

  const safeName = buildDraftFileName(message);
  const payload = [
    `To: ${message.fromEmail}`,
    `Subject: Re: ${message.subject || "ARTUR PRO"}`,
    `Generated: ${new Date().toISOString()}`,
    "",
    message.draftReply,
    "",
  ].join("\n");
  fs.writeFileSync(path.resolve(repliesDir, safeName), payload, "utf8");
  return true;
};

const main = async () => {
  loadEnv();
  ensureDir(logsDir);
  ensureDir(digestsDir);
  ensureDir(repliesDir);

  const options = parseArgs(process.argv.slice(2));
  const logPath = path.resolve(logsDir, `inbox-monitor-${nowStamp()}.jsonl`);
  const trackedLeadEmails = options.draftReplies ? collectTrackedLeadEmails() : new Set<string>();
  const handledDraftFiles = options.draftReplies ? collectHandledReplyDraftFiles() : new Set<string>();

  appendLog(logPath, {
    type: "start",
    at: new Date().toISOString(),
    options,
  });

  const rawMessages = options.sampleFile
    ? await loadSampleMessages(options.sampleFile)
    : await (async () => {
        const client = connectClient();
        await client.connect();

        try {
          return await fetchImapMessages(client, options);
        } finally {
          await client.logout();
        }
      })();

  const selectedMessages = rawMessages.slice(0, options.limit);
  const messages: InboxMessage[] = [];

  for (const rawMessage of selectedMessages) {
    const item = await buildInboxMessage(rawMessage, options, trackedLeadEmails);
    item.replyDraftWritten = writeReplyDraft(item, rawMessage.body, trackedLeadEmails, handledDraftFiles);
    messages.push(item);

    appendLog(logPath, {
      type: "message",
      at: new Date().toISOString(),
      uid: item.uid,
      source: item.source,
      subject: item.subject,
      from: item.fromEmail,
      themes: item.themes,
      leadScore: item.leadScore,
      urgency: item.urgency,
      winningAngle: item.winningAngle,
      nextAction: item.nextAction,
    });
  }

  if (options.writeDoc) {
    const digestPath = path.resolve(digestsDir, `digest-${nowStamp()}.md`);
    fs.writeFileSync(digestPath, formatMarkdownDigest(messages, options), "utf8");
    console.log(`Digest: ${digestPath}`);
  }

  console.log(`Messages scanned: ${messages.length}`);
  console.log(`Analysis mode: ${options.useOllama ? `heuristics + Ollama (${options.ollamaModel})` : "heuristics only"}`);
  console.log(`Log file: ${logPath}`);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
