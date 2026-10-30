import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import nodemailer from "nodemailer";

type CliOptions = {
  dryRun: boolean;
  limit?: number;
  only?: string[];
};

type InboxLogMessage = {
  type?: string;
  uid?: number;
  from?: string;
  fromEmail?: string;
  subject?: string;
  leadScore?: number;
  themes?: string[];
};

type ReplyDraft = {
  filePath: string;
  fileName: string;
  to: string;
  subject: string;
  body: string;
  leadScore?: number;
  themes?: string[];
};

type ReplyDraftContext = {
  email?: string;
  subject?: string;
  leadScore?: number;
  themes?: string[];
};

const backendDir = process.cwd();
const rootDir = path.resolve(backendDir, "..");
const salesDir = path.resolve(rootDir, "sales");
const logsDir = path.resolve(salesDir, "logs");
const repliesDir = path.resolve(logsDir, "reply-drafts");
const pendingRepliesDir = path.resolve(logsDir, "pending-replies");
const sentRepliesDir = path.resolve(logsDir, "reply-sent");

const loadEnv = () => {
  const candidates = [path.resolve(backendDir, ".env"), path.resolve(rootDir, ".env")];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate, override: false });
    }
  }
};

const parseArgs = (argv: string[]): CliOptions => {
  const options: CliOptions = { dryRun: false };

  for (const arg of argv) {
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg.startsWith("--limit=")) {
      const value = Number(arg.slice("--limit=".length));
      if (Number.isInteger(value) && value > 0) {
        options.limit = value;
      }
      continue;
    }

    if (arg.startsWith("--only=")) {
      options.only = arg
        .slice("--only=".length)
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
    }
  }

  return options;
};

const nowStamp = () => {
  const now = new Date();
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
};

const ensureDir = (dirPath: string) => {
  fs.mkdirSync(dirPath, { recursive: true });
};

const appendLog = (logPath: string, payload: Record<string, unknown>) => {
  fs.appendFileSync(logPath, `${JSON.stringify(payload)}\n`, "utf8");
};

const emailSyntaxOk = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const isDailyLimitError = (error: unknown) => {
  const text = error instanceof Error ? error.message : String(error);
  return /daily user sending limit exceeded/i.test(text);
};

const requireSmtpConfig = () => {
  const requiredKeys = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM_EMAIL"] as const;
  const missing = requiredKeys.filter((key) => !process.env[key]?.trim());

  if (missing.length > 0) {
    throw new Error(`Missing SMTP config: ${missing.join(", ")}`);
  }
};

const buildTransporter = () => {
  requireSmtpConfig();

  const port = Number(process.env.SMTP_PORT);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: (process.env.SMTP_SECURE ?? "").toLowerCase() === "true" || port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
};

const isSystemMailbox = (email: string) => {
  const value = email.toLowerCase();
  return (
    value.includes("mailer-daemon") ||
    value.includes("postmaster") ||
    value.includes("no-reply") ||
    value.includes("noreply")
  );
};

const isRelayMailbox = (email: string) => {
  const value = email.toLowerCase();
  return value === "messages@avito.ru";
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

const isLowIntentSubject = (subject: string) => {
  const haystack = subject.toLowerCase();
  return (
    haystack.includes("delivery status notification") ||
    haystack.includes("ведет трансляцию") ||
    haystack.includes("начинает трансляцию") ||
    haystack.includes("вам пришло новое сообщение") ||
    haystack.includes("награды ждут")
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

const parseUidFromFileName = (filePath: string) => {
  const raw = path.basename(filePath).match(/^(\d+)-/i)?.[1];
  if (!raw) {
    return null;
  }

  const value = Number(raw);
  return Number.isInteger(value) ? value : null;
};

const readInboxLogContext = () => {
  const context = new Map<number, ReplyDraftContext>();

  if (!fs.existsSync(logsDir)) {
    return context;
  }

  for (const entry of fs.readdirSync(logsDir)) {
    if (!/^inbox-monitor-.*\.jsonl$/i.test(entry)) {
      continue;
    }

    const fullPath = path.resolve(logsDir, entry);
    const lines = fs.readFileSync(fullPath, "utf8").split(/\r?\n/).filter(Boolean);

    for (const line of lines) {
      try {
        const payload = JSON.parse(line) as InboxLogMessage;
        const uid = Number(payload.uid);
        if (payload.type !== "message" || !Number.isInteger(uid)) {
          continue;
        }

        const email = String(payload.fromEmail ?? payload.from ?? "")
          .trim()
          .toLowerCase();
        const subject = String(payload.subject ?? "").trim();
        const themes = Array.isArray(payload.themes)
          ? payload.themes.map((item) => String(item).trim().toLowerCase()).filter(Boolean)
          : undefined;

        context.set(uid, {
          email,
          subject,
          leadScore: typeof payload.leadScore === "number" ? payload.leadScore : undefined,
          themes,
        });
      } catch {
        continue;
      }
    }
  }

  return context;
};

const collectPreviouslySentDraftFiles = () => {
  const sent = new Set<string>();

  if (!fs.existsSync(logsDir)) {
    return sent;
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
          sent.add(payload.fileName.trim().toLowerCase());
        }
      } catch {
        continue;
      }
    }
  }

  return sent;
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

        const trackedEmail = String(payload.email ?? payload.to ?? "")
          .trim()
          .toLowerCase();

        if (trackedEmail) {
          tracked.add(trackedEmail);
        }
      } catch {
        continue;
      }
    }
  }

  return tracked;
};

const isActionableLead = (
  email: string,
  subject: string,
  body: string,
  trackedLeadEmails: Set<string>,
  leadScore?: number,
  themes?: string[]
) => {
  if (
    !emailSyntaxOk(email) ||
    isSystemMailbox(email) ||
    isRelayMailbox(email) ||
    isNotificationMailbox(email) ||
    isLowIntentSubject(subject)
  ) {
    return false;
  }

  if (trackedLeadEmails.has(email.toLowerCase())) {
    return true;
  }

  if (typeof leadScore === "number" && leadScore < 70) {
    return false;
  }

  return hasRelevantProductSignal(subject, body);
};

const toHtml = (text: string) =>
  `<html><body style="font-family:Arial,sans-serif;line-height:1.55;color:#1d1814;">${text
    .split(/\r?\n\r?\n/)
    .map((block) => `<p>${block.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replace(/\r?\n/g, "<br/>")}</p>`)
    .join("")}</body></html>`;

const parseDraftFile = (filePath: string, context: Map<number, ReplyDraftContext>): ReplyDraft | null => {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  let to = "";
  let subject = "";
  let bodyStartIndex = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      bodyStartIndex = index + 1;
      break;
    }

    if (line.startsWith("To:")) {
      to = line.slice(3).trim().toLowerCase();
      continue;
    }

    if (line.startsWith("Subject:")) {
      subject = line.slice(8).trim();
    }
  }

  const uid = parseUidFromFileName(filePath);
  const logContext = uid !== null ? context.get(uid) : undefined;

  if (!to && logContext?.email) {
    to = logContext.email.trim().toLowerCase();
  }

  if (!subject && logContext?.subject) {
    subject = `Re: ${logContext.subject}`;
  }

  const body = lines.slice(bodyStartIndex).join("\n").trim();
  if (!to || !body) {
    return null;
  }

  return {
    filePath,
    fileName: path.basename(filePath),
    to,
    subject: subject || "Re: ARTUR PRO",
    body,
    leadScore: logContext?.leadScore,
    themes: logContext?.themes,
  };
};

const collectDrafts = (options: CliOptions) => {
  if (!fs.existsSync(repliesDir)) {
    return [];
  }

  const context = readInboxLogContext();
  const previouslySentDraftFiles = collectPreviouslySentDraftFiles();
  const trackedLeadEmails = collectTrackedLeadEmails();
  const only = options.only ? new Set(options.only) : null;
  let drafts = fs
    .readdirSync(repliesDir)
    .filter((fileName) => fileName.toLowerCase().endsWith(".md"))
    .filter((fileName) => !previouslySentDraftFiles.has(fileName.toLowerCase()))
    .map((fileName) => parseDraftFile(path.resolve(repliesDir, fileName), context))
    .filter((item): item is ReplyDraft => Boolean(item))
    .filter((draft) => emailSyntaxOk(draft.to))
    .filter((draft) => !isSystemMailbox(draft.to))
    .filter((draft) => {
      if (only && (only.has(draft.to) || only.has(draft.fileName.toLowerCase()))) {
        return true;
      }

      return isActionableLead(draft.to, draft.subject, draft.body, trackedLeadEmails, draft.leadScore, draft.themes);
    });

  if (only) {
    drafts = drafts.filter((draft) => only.has(draft.to) || only.has(draft.fileName.toLowerCase()));
  }

  if (options.limit) {
    drafts = drafts.slice(0, options.limit);
  }

  return drafts;
};

const writePendingReplies = (drafts: ReplyDraft[], reason: string) => {
  ensureDir(pendingRepliesDir);
  const filePath = path.resolve(pendingRepliesDir, `reply-pending-${nowStamp()}.json`);
  fs.writeFileSync(
    filePath,
    JSON.stringify(
      {
        reason,
        createdAt: new Date().toISOString(),
        count: drafts.length,
        replies: drafts.map((draft) => ({
          fileName: draft.fileName,
          to: draft.to,
          subject: draft.subject,
        })),
      },
      null,
      2
    ),
    "utf8"
  );
  return filePath;
};

const archiveSentDraft = (draft: ReplyDraft) => {
  ensureDir(sentRepliesDir);
  const targetPath = path.resolve(sentRepliesDir, draft.fileName);
  fs.renameSync(draft.filePath, targetPath);
  return targetPath;
};

const main = async () => {
  loadEnv();
  fs.mkdirSync(logsDir, { recursive: true });
  ensureDir(pendingRepliesDir);
  ensureDir(sentRepliesDir);

  const options = parseArgs(process.argv.slice(2));
  const drafts = collectDrafts(options);
  const logPath = path.resolve(logsDir, `reply-send-${nowStamp()}${options.dryRun ? "-dry-run" : ""}.jsonl`);

  appendLog(logPath, {
    type: "start",
    at: new Date().toISOString(),
    dryRun: options.dryRun,
    count: drafts.length,
  });

  if (drafts.length === 0) {
    console.log("No reply drafts found.");
    return;
  }

  console.log(`Reply drafts: ${drafts.length}`);
  console.log(`Log file: ${logPath}`);

  if (options.dryRun) {
    for (const draft of drafts) {
      appendLog(logPath, {
        type: "preview",
        at: new Date().toISOString(),
        to: draft.to,
        subject: draft.subject,
        fileName: draft.fileName,
      });
      console.log(`PREVIEW ${draft.to} :: ${draft.subject}`);
    }
    return;
  }

  const transporter = buildTransporter();
  await transporter.verify();

  const fromName = process.env.SMTP_FROM_NAME?.trim() || "ARTUR PRO";
  const fromEmail = process.env.SMTP_FROM_EMAIL?.trim() as string;
  const replyTo = process.env.SMTP_REPLY_TO?.trim() || undefined;

  for (const [index, draft] of drafts.entries()) {
    try {
      const result = await transporter.sendMail({
        from: `${fromName} <${fromEmail}>`,
        to: draft.to,
        replyTo,
        subject: draft.subject,
        text: draft.body,
        html: toHtml(draft.body),
      });

      appendLog(logPath, {
        type: "sent",
        at: new Date().toISOString(),
        to: draft.to,
        subject: draft.subject,
        fileName: draft.fileName,
        messageId: result.messageId,
        response: result.response,
      });
      const archivedPath = archiveSentDraft(draft);
      appendLog(logPath, {
        type: "archived",
        at: new Date().toISOString(),
        to: draft.to,
        fileName: draft.fileName,
        archivedPath,
      });

      console.log(`SENT ${draft.to} :: ${result.messageId}`);
    } catch (error) {
      appendLog(logPath, {
        type: "error",
        at: new Date().toISOString(),
        to: draft.to,
        subject: draft.subject,
        fileName: draft.fileName,
        error: error instanceof Error ? error.message : String(error),
      });
      console.error(`FAILED ${draft.to} :: ${error instanceof Error ? error.message : String(error)}`);
      if (isDailyLimitError(error)) {
        const pendingPath = writePendingReplies(drafts.slice(index), error instanceof Error ? error.message : String(error));
        appendLog(logPath, {
          type: "paused",
          at: new Date().toISOString(),
          reason: "daily_limit",
          pendingPath,
          pendingCount: drafts.length - index,
        });
        console.log(`Reply queue paused. Pending replies saved to ${pendingPath}`);
      }
      break;
    }
  }

  await transporter.close();
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
