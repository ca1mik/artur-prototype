import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import nodemailer from "nodemailer";

type Segment = string;

type Recipient = {
  slug: string;
  companyName: string;
  city?: string;
  segment: Segment;
  email?: string;
  telegram?: string;
  fitReason: string;
};

type CliOptions = {
  dryRun: boolean;
  limit?: number;
  only?: string[];
  segment?: Segment;
  allowResend: boolean;
  sourcePath?: string;
  templatePath?: string;
  subjectTemplate?: string;
  campaignTag?: string;
};

const rootDir = path.resolve(process.cwd(), "..");
const salesDir = path.resolve(rootDir, "sales");
const logsDir = path.resolve(salesDir, "logs");
const previewsDir = path.resolve(logsDir, "previews");
const recipientsPath = path.resolve(salesDir, "outreach-recipients.json");
const pendingDir = path.resolve(logsDir, "pending-campaigns");
const templatePath = path.resolve(salesDir, "email-template.txt");
const defaultAttachmentPath = path.resolve(salesDir, "KP_ARTUR_PRO_2026-05-16.md");

const loadEnv = () => {
  const candidates = [path.resolve(process.cwd(), ".env"), path.resolve(rootDir, ".env")];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate, override: false });
    }
  }
};

const parseArgs = (argv: string[]): CliOptions => {
  const options: CliOptions = { dryRun: false, allowResend: false };

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
      continue;
    }

    if (arg.startsWith("--segment=")) {
      const value = arg.slice("--segment=".length).trim() as Segment;
      if (["passenger", "cargo", "enterprise"].includes(value)) {
        options.segment = value;
      }
      continue;
    }

    if (arg === "--allow-resend") {
      options.allowResend = true;
      continue;
    }

    if (arg.startsWith("--source=")) {
      const value = arg.slice("--source=".length).trim();
      if (value) {
        options.sourcePath = value;
      }
      continue;
    }

    if (arg.startsWith("--template=")) {
      const value = arg.slice("--template=".length).trim();
      if (value) {
        options.templatePath = value;
      }
      continue;
    }

    if (arg.startsWith("--subject-template=")) {
      const value = arg.slice("--subject-template=".length).trim();
      if (value) {
        options.subjectTemplate = value;
      }
      continue;
    }

    if (arg.startsWith("--campaign-tag=")) {
      const value = arg.slice("--campaign-tag=".length).trim();
      if (value) {
        options.campaignTag = value;
      }
    }
  }

  return options;
};

const readJson = <T>(filePath: string): T => JSON.parse(fs.readFileSync(filePath, "utf8")) as T;

const readTemplate = (filePath: string) => fs.readFileSync(filePath, "utf8");

const ensureDir = (dirPath: string) => {
  fs.mkdirSync(dirPath, { recursive: true });
};

const nowStamp = () => {
  const now = new Date();
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
};

const emailSyntaxOk = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const subjectBySegment = (recipient: Recipient) => {
  if (recipient.segment === "passenger") {
    return `Готовый контур для заявок и перевозчиков для ${recipient.companyName}`;
  }

  if (recipient.segment === "cargo") {
    return `Готовый цифровой контур для грузовых заявок для ${recipient.companyName}`;
  }

  return `White-label платформа перевозок для ${recipient.companyName}`;
};

const sanitizeTag = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "");

const compactLines = (value: string) =>
  value
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line, index, lines) => !(line === "" && lines[index - 1] === ""))
    .join("\n")
    .trim();

const toHtml = (text: string) => {
  const lines = text.split(/\r?\n/);
  const html: string[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (listItems.length === 0) {
      return;
    }

    html.push(`<ul>${listItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`);
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      flushList();
      continue;
    }

    if (line.startsWith("- ")) {
      listItems.push(line.slice(2));
      continue;
    }

    flushList();
    html.push(`<p>${escapeHtml(line)}</p>`);
  }

  flushList();
  return `<html><body style="font-family:Arial,sans-serif;line-height:1.55;color:#1d1814;">${html.join("")}</body></html>`;
};

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const renderStringTemplate = (template: string, recipient: Recipient) => {
  const replacements: Record<string, string> = {
    companyName: recipient.companyName,
    fitReason: recipient.fitReason,
    senderName: process.env.CAMPAIGN_SENDER_NAME?.trim() || process.env.SMTP_FROM_NAME?.trim() || "ARTUR PRO",
    senderPhone: process.env.CAMPAIGN_SENDER_PHONE?.trim() || "",
    senderTelegram: process.env.CAMPAIGN_SENDER_TELEGRAM?.trim() || "",
    replyToLine: process.env.SMTP_REPLY_TO?.trim() ? `Reply-to: ${process.env.SMTP_REPLY_TO?.trim()}` : "",
    demoLine: process.env.CAMPAIGN_DEMO_URL?.trim() ? `Демо: ${process.env.CAMPAIGN_DEMO_URL?.trim()}` : "",
  };

  return template.replaceAll(/\{\{(\w+)\}\}/g, (_match, key: string) => replacements[key] ?? "");
};

const renderTemplate = (template: string, recipient: Recipient) => {
  const rendered = renderStringTemplate(template, recipient);
  return compactLines(rendered);
};

const pickRecipients = (options: CliOptions) => {
  const sourcePayload = readJson<Recipient[] | { recipients?: Recipient[] }>(loadRecipientsSource(options));
  const rawRecipients = Array.isArray(sourcePayload) ? sourcePayload : sourcePayload.recipients ?? [];
  const previouslySent = options.allowResend ? new Set<string>() : collectPreviouslySentEmails();
  const seen = new Set<string>();

  let recipients = rawRecipients.filter((recipient) => {
    const email = recipient.email?.trim().toLowerCase();
    if (!email || !emailSyntaxOk(email) || seen.has(email) || previouslySent.has(email)) {
      return false;
    }
    seen.add(email);
    return true;
  });

  if (options.segment) {
    recipients = recipients.filter((recipient) => recipient.segment === options.segment);
  }

  if (options.only && options.only.length > 0) {
    const only = new Set(options.only);
    recipients = recipients.filter((recipient) => only.has(recipient.slug.toLowerCase()) || only.has((recipient.email ?? "").toLowerCase()));
  }

  if (options.limit) {
    recipients = recipients.slice(0, options.limit);
  }

  return recipients;
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
    pool: true,
    maxConnections: 1,
    maxMessages: 100,
  });
};

const createAttachment = () => {
  if ((process.env.CAMPAIGN_ATTACH_KP ?? "").toLowerCase() !== "true") {
    return undefined;
  }

  if (!fs.existsSync(defaultAttachmentPath)) {
    return undefined;
  }

  return [
    {
      filename: path.basename(defaultAttachmentPath),
      path: defaultAttachmentPath,
      contentType: "text/markdown; charset=utf-8",
    },
  ];
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const appendLog = (logPath: string, payload: Record<string, unknown>) => {
  fs.appendFileSync(logPath, `${JSON.stringify(payload)}\n`, "utf8");
};

const isDailyLimitError = (error: unknown) => {
  const text = error instanceof Error ? error.message : String(error);
  return /daily user sending limit exceeded/i.test(text);
};

const loadRecipientsSource = (options: CliOptions) => {
  if (!options.sourcePath) {
    return recipientsPath;
  }

  return path.isAbsolute(options.sourcePath)
    ? options.sourcePath
    : path.resolve(rootDir, options.sourcePath);
};

const loadTemplateSource = (options: CliOptions) => {
  if (!options.templatePath) {
    return templatePath;
  }

  return path.isAbsolute(options.templatePath)
    ? options.templatePath
    : path.resolve(rootDir, options.templatePath);
};

const buildCampaignFileName = (options: CliOptions, suffix: string) => {
  const tag = options.campaignTag ? `${sanitizeTag(options.campaignTag)}-` : "";
  return `campaign-${tag}${nowStamp()}${suffix}`;
};

const resolveSubject = (recipient: Recipient, options: CliOptions) => {
  if (options.subjectTemplate?.trim()) {
    return compactLines(renderStringTemplate(options.subjectTemplate.trim(), recipient)).replace(/\r?\n+/g, " ");
  }

  return subjectBySegment(recipient);
};

const collectPreviouslySentEmails = () => {
  const sent = new Set<string>();

  if (!fs.existsSync(logsDir)) {
    return sent;
  }

  for (const entry of fs.readdirSync(logsDir)) {
    if (!/^campaign-.*\.jsonl$/i.test(entry)) {
      continue;
    }

    const fullPath = path.resolve(logsDir, entry);
    const lines = fs.readFileSync(fullPath, "utf8").split(/\r?\n/).filter(Boolean);

    for (const line of lines) {
      try {
        const payload = JSON.parse(line) as { type?: string; email?: string };
        if (payload.type === "sent" && payload.email) {
          sent.add(payload.email.trim().toLowerCase());
        }
      } catch {
        continue;
      }
    }
  }

  return sent;
};

const writePendingQueue = (pendingRecipients: Recipient[], reason: string) => {
  ensureDir(pendingDir);
  const filePath = path.resolve(pendingDir, `campaign-pending-${nowStamp()}.json`);
  fs.writeFileSync(
    filePath,
    JSON.stringify(
      {
        reason,
        createdAt: new Date().toISOString(),
        count: pendingRecipients.length,
        recipients: pendingRecipients,
      },
      null,
      2
    ),
    "utf8"
  );
  return filePath;
};

const main = async () => {
  loadEnv();
  ensureDir(logsDir);
  ensureDir(previewsDir);
  ensureDir(pendingDir);

  const options = parseArgs(process.argv.slice(2));
  const recipients = pickRecipients(options);
  const template = readTemplate(loadTemplateSource(options));
  const logPath = path.resolve(logsDir, buildCampaignFileName(options, options.dryRun ? "-dry-run.jsonl" : ".jsonl"));

  if (recipients.length === 0) {
    console.log("No recipients matched the current filters.");
    return;
  }

  appendLog(logPath, {
    type: "start",
    at: new Date().toISOString(),
    dryRun: options.dryRun,
    count: recipients.length,
    filters: options,
  });

  console.log(`Recipients: ${recipients.length}`);
  console.log(`Log file: ${logPath}`);

  if (options.dryRun) {
    for (const recipient of recipients) {
      const subject = resolveSubject(recipient, options);
      const text = renderTemplate(template, recipient);
      const previewPrefix = options.campaignTag ? `${sanitizeTag(options.campaignTag)}-` : "";
      const previewPath = path.resolve(previewsDir, `${previewPrefix}${recipient.slug}.txt`);
      fs.writeFileSync(previewPath, `TO: ${recipient.email}\nSUBJECT: ${subject}\n\n${text}\n`, "utf8");
      appendLog(logPath, {
        type: "preview",
        at: new Date().toISOString(),
        slug: recipient.slug,
        email: recipient.email,
        subject,
        text,
        previewPath,
      });
      console.log(`PREVIEW ${recipient.email} :: ${subject}`);
    }
    return;
  }

  const transporter = buildTransporter();
  await transporter.verify();

  const attachments = createAttachment();
  const delayMs = Number(process.env.CAMPAIGN_DELAY_MS ?? "2000");
  const fromName = process.env.SMTP_FROM_NAME?.trim() || "ARTUR PRO";
  const fromEmail = process.env.SMTP_FROM_EMAIL?.trim() as string;
  const replyTo = process.env.SMTP_REPLY_TO?.trim() || undefined;

  for (const [index, recipient] of recipients.entries()) {
    const subject = resolveSubject(recipient, options);
    const text = renderTemplate(template, recipient);
    const html = toHtml(text);

    try {
      const result = await transporter.sendMail({
        from: `${fromName} <${fromEmail}>`,
        to: recipient.email,
        replyTo,
        subject,
        text,
        html,
        attachments,
      });

      appendLog(logPath, {
        type: "sent",
        at: new Date().toISOString(),
        slug: recipient.slug,
        email: recipient.email,
        subject,
        messageId: result.messageId,
        response: result.response,
      });

      console.log(`SENT ${recipient.email} :: ${result.messageId}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      appendLog(logPath, {
        type: "error",
        at: new Date().toISOString(),
        slug: recipient.slug,
        email: recipient.email,
        subject,
        error: errorMessage,
      });

      console.error(`FAILED ${recipient.email} :: ${errorMessage}`);

      if (isDailyLimitError(error)) {
        const pendingRecipients = recipients.slice(index);
        const pendingPath = writePendingQueue(pendingRecipients, errorMessage);
        appendLog(logPath, {
          type: "paused",
          at: new Date().toISOString(),
          reason: "daily_limit",
          pendingPath,
          pendingCount: pendingRecipients.length,
        });
        console.error(`Campaign paused. Pending queue saved to ${pendingPath}`);
        break;
      }
    }

    if (delayMs > 0) {
      await wait(delayMs);
    }
  }

  await transporter.close();
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
