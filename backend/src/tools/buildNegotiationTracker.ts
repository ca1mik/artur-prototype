import fs from "node:fs";
import path from "node:path";

type SourceRecipient = {
  slug?: string;
  companyName?: string;
  city?: string;
  segment?: string;
  email?: string;
  fitReason?: string;
};

type TrackerRow = {
  email: string;
  companyName: string;
  city: string;
  segment: string;
  firstSentAt?: string;
  lastSentAt?: string;
  sentCount: number;
  inboundReplyAt?: string;
  inboundReplySubject?: string;
  inboundReplyCount: number;
  followUpSentAt?: string;
  followUpCount: number;
  pendingReplyCount: number;
  pendingReplyAt?: string;
  bounceAt?: string;
  bounceReason?: string;
  lastActivityAt?: string;
  status: string;
  nextAction: string;
  notes: Set<string>;
  campaignTags: Set<string>;
  sourceFiles: Set<string>;
};

type CampaignStartLog = {
  type?: string;
  filters?: {
    campaignTag?: string;
    sourcePath?: string;
  };
};

type CampaignSentLog = {
  type?: string;
  at?: string;
  email?: string;
  subject?: string;
  slug?: string;
};

type ReplySentLog = {
  type?: string;
  at?: string;
  to?: string;
  subject?: string;
  fileName?: string;
};

type InboxMessageLog = {
  type?: string;
  at?: string;
  from?: string;
  fromEmail?: string;
  subject?: string;
};

type PendingReplyFile = {
  createdAt?: string;
  replies?: Array<{
    fileName?: string;
    to?: string;
    subject?: string;
  }>;
};

const backendDir = process.cwd();
const rootDir = path.resolve(backendDir, "..");
const salesDir = path.resolve(rootDir, "sales");
const logsDir = path.resolve(salesDir, "logs");

const titleCase = (value: string) =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const humanizeDomain = (email: string) => {
  const domain = email.split("@")[1] ?? "";
  const head = domain.split(".")[0] ?? domain;
  return titleCase(head.replace(/[-_]+/g, " "));
};

const emailSyntaxOk = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const normalizeEmail = (value: string) => value.trim().toLowerCase();

const buildReplyKey = (email: string, subject?: string) => `${normalizeEmail(email)}::${(subject ?? "").trim().toLowerCase()}`;

const asArray = <T>(value: T | T[] | undefined): T[] => (Array.isArray(value) ? value : value ? [value] : []);

const safeReadJson = <T>(filePath: string): T | null => {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
};

const readJsonLines = (filePath: string) =>
  fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((item): item is Record<string, unknown> => Boolean(item));

const listFiles = (dirPath: string, pattern: RegExp) => {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  return fs
    .readdirSync(dirPath)
    .filter((entry) => pattern.test(entry))
    .map((entry) => path.resolve(dirPath, entry));
};

const pickLater = (current: string | undefined, next: string | undefined) => {
  if (!next) {
    return current;
  }

  if (!current) {
    return next;
  }

  return new Date(next).getTime() >= new Date(current).getTime() ? next : current;
};

const pickEarlier = (current: string | undefined, next: string | undefined) => {
  if (!next) {
    return current;
  }

  if (!current) {
    return next;
  }

  return new Date(next).getTime() <= new Date(current).getTime() ? next : current;
};

const isSystemMailbox = (email: string) => {
  const value = normalizeEmail(email);
  return (
    value.includes("no-reply") ||
    value.includes("noreply") ||
    value.includes("mailer-daemon") ||
    value.includes("postmaster") ||
    value === "notifications@avito.ru" ||
    value === "messages@avito.ru" ||
    value === "inform@emails.tinkoff.ru" ||
    value === "mailer@sender.ozon.ru" ||
    value === "ozonabroad@news.ozon.ru" ||
    value.endsWith("@twitch.tv")
  );
};

const isLowIntentSubject = (subject: string) => {
  const haystack = subject.toLowerCase();
  return (
    haystack.includes("delivery status notification") ||
    haystack.includes("начинает трансляцию") ||
    haystack.includes("ведет трансляцию") ||
    haystack.includes("важное из постановления") ||
    haystack.includes("автопубликация не сработала")
  );
};

const formatTimestamp = (value?: string) => {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const pad = (part: number) => part.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const csvEscape = (value: string) => `"${value.replaceAll("\"", "\"\"")}"`;

const mdEscape = (value: string) => value.replaceAll("|", "\\|").replaceAll("\n", "<br/>");

const isFollowUpCampaignTag = (value: string) => /follow-?up/i.test(value);

const parseDigestTimestamp = (filePath: string) => {
  const match = path.basename(filePath).match(/digest-(\d{8})-(\d{6})\.md$/i);
  if (!match) {
    return undefined;
  }

  const [, datePart, timePart] = match;
  const iso = `${datePart.slice(0, 4)}-${datePart.slice(4, 6)}-${datePart.slice(6, 8)}T${timePart.slice(0, 2)}:${timePart.slice(2, 4)}:${timePart.slice(4, 6)}+03:00`;
  return new Date(iso).toISOString();
};

const ensureRow = (rows: Map<string, TrackerRow>, email: string, defaults?: Partial<TrackerRow>) => {
  const key = normalizeEmail(email);
  const existing = rows.get(key);
  if (existing) {
    return existing;
  }

  const row: TrackerRow = {
    email: key,
    companyName: defaults?.companyName?.trim() || humanizeDomain(key),
    city: defaults?.city?.trim() || "",
    segment: defaults?.segment?.trim() || "",
    sentCount: 0,
    inboundReplyCount: 0,
    followUpCount: 0,
    pendingReplyCount: 0,
    status: "new",
    nextAction: "Review manually",
    notes: new Set<string>(),
    campaignTags: new Set<string>(),
    sourceFiles: new Set<string>(),
  };

  rows.set(key, row);
  return row;
};

const loadSourceRecipients = () => {
  const recipients = new Map<string, Partial<TrackerRow>>();

  for (const filePath of listFiles(salesDir, /^outreach.*\.json$/i)) {
    const payload = safeReadJson<SourceRecipient[]>(filePath);
    if (!payload) {
      continue;
    }

    for (const item of payload) {
      const email = item.email?.trim();
      if (!email || !emailSyntaxOk(email)) {
        continue;
      }

      recipients.set(normalizeEmail(email), {
        companyName: item.companyName?.trim() || humanizeDomain(email),
        city: item.city?.trim() || "",
        segment: item.segment?.trim() || "",
        sourceFiles: new Set([path.relative(rootDir, filePath)]),
      });
    }
  }

  return recipients;
};

const applyStatus = (row: TrackerRow) => {
  if (row.inboundReplyAt && row.followUpCount > 0) {
    row.status = "negotiation";
    row.nextAction = "Wait for response to follow-up, then push to demo call";
    return;
  }

  if (row.pendingReplyCount > 0) {
    row.status = "reply_pending";
    row.nextAction = "Send the pending reply and move the lead to demo scheduling";
    return;
  }

  if (row.inboundReplyAt) {
    row.status = "reply_received";
    row.nextAction = "Prepare a tailored reply and propose demo or pilot";
    return;
  }

  if (row.bounceAt) {
    row.status = "delivery_issue";
    row.nextAction = "Find alternate contact or switch channel";
    return;
  }

  if (row.followUpCount > 0) {
    row.status = "follow_up_sent";
    row.nextAction = "Monitor inbox and prepare demo materials";
    return;
  }

  if (row.sentCount > 0) {
    row.status = "outreach_sent";
    row.nextAction = "Monitor inbox and send follow-up if silent";
    return;
  }

  row.status = "new";
  row.nextAction = "Review manually";
};

const main = () => {
  const sourceRecipients = loadSourceRecipients();
  const rows = new Map<string, TrackerRow>();
  const sentReplyFiles = new Set<string>();
  const sentReplyKeys = new Set<string>();

  for (const [email, defaults] of sourceRecipients.entries()) {
    const row = ensureRow(rows, email, defaults);
    for (const sourceFile of defaults.sourceFiles ?? []) {
      row.sourceFiles.add(sourceFile);
    }
  }

  for (const filePath of listFiles(logsDir, /^campaign-.*\.jsonl$/i).filter((item) => !item.endsWith("-dry-run.jsonl"))) {
    const lines = readJsonLines(filePath);
    const startLog = lines.find((line) => line.type === "start") as CampaignStartLog | undefined;
    const campaignTag = startLog?.filters?.campaignTag?.trim() || path.basename(filePath, ".jsonl");
    const sourcePath = startLog?.filters?.sourcePath?.trim();

    for (const line of lines) {
      const payload = line as CampaignSentLog;
      if (payload.type !== "sent" || !payload.email) {
        continue;
      }

      const email = normalizeEmail(payload.email);
      const row = ensureRow(rows, email, sourceRecipients.get(email));
      row.firstSentAt = pickEarlier(row.firstSentAt, payload.at);
      row.lastSentAt = pickLater(row.lastSentAt, payload.at);
      row.lastActivityAt = pickLater(row.lastActivityAt, payload.at);
      row.sentCount += 1;
      row.campaignTags.add(campaignTag);
      if (isFollowUpCampaignTag(campaignTag)) {
        row.followUpCount += 1;
        row.followUpSentAt = pickLater(row.followUpSentAt, payload.at);
        row.notes.add("Campaign follow-up sent");
      } else {
        row.notes.add("Outbound outreach sent");
      }
      if (sourcePath) {
        row.sourceFiles.add(sourcePath);
      }
    }
  }

  for (const filePath of listFiles(logsDir, /^reply-send-.*\.jsonl$/i).filter((item) => !item.endsWith("-dry-run.jsonl"))) {
    const lines = readJsonLines(filePath);
    for (const line of lines) {
      const payload = line as ReplySentLog;
      if (payload.type !== "sent" || !payload.to) {
        continue;
      }

      const email = normalizeEmail(payload.to);
      if (payload.fileName?.trim()) {
        sentReplyFiles.add(payload.fileName.trim().toLowerCase());
      }
      sentReplyKeys.add(buildReplyKey(email, payload.subject));
      const row = ensureRow(rows, email, sourceRecipients.get(email));
      row.followUpCount += 1;
      row.followUpSentAt = pickLater(row.followUpSentAt, payload.at);
      row.lastActivityAt = pickLater(row.lastActivityAt, payload.at);
      row.notes.add("Manual follow-up sent");
    }
  }

  for (const filePath of listFiles(path.resolve(logsDir, "pending-replies"), /^reply-pending-.*\.json$/i)) {
    const payload = safeReadJson<PendingReplyFile>(filePath);
    if (!payload?.replies) {
      continue;
    }

    for (const reply of payload.replies) {
      if (!reply.to || !emailSyntaxOk(reply.to)) {
        continue;
      }

      const email = normalizeEmail(reply.to);
      const replyFileName = reply.fileName?.trim().toLowerCase();
      const replyKey = buildReplyKey(email, reply.subject);
      if ((replyFileName && sentReplyFiles.has(replyFileName)) || sentReplyKeys.has(replyKey)) {
        continue;
      }

      const row = ensureRow(rows, email, sourceRecipients.get(email));
      row.pendingReplyCount += 1;
      row.pendingReplyAt = pickLater(row.pendingReplyAt, payload.createdAt);
      row.lastActivityAt = pickLater(row.lastActivityAt, payload.createdAt);
      row.notes.add("Pending reply queue");
    }
  }

  for (const filePath of listFiles(logsDir, /^inbox-monitor-.*\.jsonl$/i)) {
    const lines = readJsonLines(filePath);
    for (const line of lines) {
      const payload = line as InboxMessageLog;
      if (payload.type !== "message") {
        continue;
      }

      const email = normalizeEmail(String(payload.fromEmail ?? payload.from ?? ""));
      const subject = String(payload.subject ?? "").trim();
      if (!email || !emailSyntaxOk(email)) {
        continue;
      }

      if (!rows.has(email)) {
        continue;
      }

      if (isSystemMailbox(email) || isLowIntentSubject(subject)) {
        continue;
      }

      const row = ensureRow(rows, email, sourceRecipients.get(email));
      row.inboundReplyCount += 1;
      row.inboundReplyAt = pickLater(row.inboundReplyAt, payload.at);
      row.inboundReplySubject = row.inboundReplyAt === payload.at ? subject : row.inboundReplySubject;
      row.lastActivityAt = pickLater(row.lastActivityAt, payload.at);
      row.notes.add("Inbound human reply detected");
    }
  }

  for (const filePath of listFiles(path.resolve(logsDir, "inbox-digests"), /^digest-.*\.md$/i)) {
    const content = fs.readFileSync(filePath, "utf8");
    const digestAt = parseDigestTimestamp(filePath);
    const emailMatches = [...content.matchAll(/получателю\s+([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/giu)];

    for (const match of emailMatches) {
      const email = normalizeEmail(match[1] ?? "");
      if (!emailSyntaxOk(email)) {
        continue;
      }

      if (!rows.has(email)) {
        continue;
      }

      const row = ensureRow(rows, email, sourceRecipients.get(email));
      row.bounceAt = pickLater(row.bounceAt, digestAt);
      row.lastActivityAt = pickLater(row.lastActivityAt, digestAt);
      const snippet = content.slice(match.index ?? 0, (match.index ?? 0) + 400);
      row.bounceReason = /550 relay not permitted/i.test(snippet) ? "550 relay not permitted" : row.bounceReason || "Delivery status notification";
      row.notes.add("Digest reported delivery issue");
    }
  }

  const allRows = [...rows.values()].map((row) => {
    if (!row.lastActivityAt) {
      row.lastActivityAt =
        row.bounceAt ||
        row.followUpSentAt ||
        row.inboundReplyAt ||
        row.pendingReplyAt ||
        row.lastSentAt ||
        row.firstSentAt;
    }
    applyStatus(row);
    return row;
  });

  const statusPriority: Record<string, number> = {
    negotiation: 0,
    reply_pending: 1,
    reply_received: 2,
    delivery_issue: 3,
    follow_up_sent: 4,
    outreach_sent: 5,
    new: 6,
  };

  allRows.sort((left, right) => {
    const statusDelta = (statusPriority[left.status] ?? 99) - (statusPriority[right.status] ?? 99);
    if (statusDelta !== 0) {
      return statusDelta;
    }

    const leftTime = left.lastActivityAt ? new Date(left.lastActivityAt).getTime() : 0;
    const rightTime = right.lastActivityAt ? new Date(right.lastActivityAt).getTime() : 0;
    if (leftTime !== rightTime) {
      return rightTime - leftTime;
    }

    return left.companyName.localeCompare(right.companyName);
  });

  const summary = allRows.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {});

  const dateStamp = new Date().toISOString().slice(0, 10);
  const csvPath = path.resolve(salesDir, "NEGOTIATION_TRACKER_LATEST.csv");
  const mdPath = path.resolve(salesDir, "NEGOTIATION_TRACKER_LATEST.md");
  const datedCsvPath = path.resolve(salesDir, `NEGOTIATION_TRACKER_${dateStamp}.csv`);
  const datedMdPath = path.resolve(salesDir, `NEGOTIATION_TRACKER_${dateStamp}.md`);

  const csvHeaders = [
    "status",
    "companyName",
    "email",
    "city",
    "segment",
    "firstSentAt",
    "lastSentAt",
    "sentCount",
    "inboundReplyAt",
    "inboundReplySubject",
    "followUpSentAt",
    "followUpCount",
    "pendingReplyAt",
    "pendingReplyCount",
    "bounceAt",
    "bounceReason",
    "lastActivityAt",
    "nextAction",
    "campaignTags",
    "sourceFiles",
    "notes",
  ];

  const csvLines = [
    csvHeaders.join(","),
    ...allRows.map((row) =>
      [
        row.status,
        row.companyName,
        row.email,
        row.city,
        row.segment,
        formatTimestamp(row.firstSentAt),
        formatTimestamp(row.lastSentAt),
        String(row.sentCount),
        formatTimestamp(row.inboundReplyAt),
        row.inboundReplySubject ?? "",
        formatTimestamp(row.followUpSentAt),
        String(row.followUpCount),
        formatTimestamp(row.pendingReplyAt),
        String(row.pendingReplyCount),
        formatTimestamp(row.bounceAt),
        row.bounceReason ?? "",
        formatTimestamp(row.lastActivityAt),
        row.nextAction,
        [...row.campaignTags].join("; "),
        [...row.sourceFiles].join("; "),
        [...row.notes].join("; "),
      ]
        .map((value) => csvEscape(value))
        .join(",")
    ),
  ].join("\n");

  const activeRows = allRows.filter((row) => ["negotiation", "reply_pending", "reply_received", "delivery_issue"].includes(row.status));
  const renderTable = (rowsToRender: TrackerRow[]) => {
    const header = [
      "| Status | Company | Email | Last touch | Sent | Reply | Follow-up | Bounce | Next action |",
      "| --- | --- | --- | --- | ---: | --- | --- | --- | --- |",
    ];

    const body = rowsToRender.map(
      (row) =>
        `| ${mdEscape(row.status)} | ${mdEscape(row.companyName)} | ${mdEscape(row.email)} | ${mdEscape(formatTimestamp(row.lastActivityAt))} | ${row.sentCount} | ${mdEscape(formatTimestamp(row.inboundReplyAt))} | ${mdEscape(formatTimestamp(row.followUpSentAt) || formatTimestamp(row.pendingReplyAt))} | ${mdEscape(formatTimestamp(row.bounceAt))} | ${mdEscape(row.nextAction)} |`
    );

    return [...header, ...body].join("\n");
  };

  const mdLines = [
    "# Negotiation Tracker",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Summary",
    "",
    `- Total leads in tracker: ${allRows.length}`,
    `- Negotiation: ${summary.negotiation ?? 0}`,
    `- Reply pending: ${summary.reply_pending ?? 0}`,
    `- Reply received: ${summary.reply_received ?? 0}`,
    `- Delivery issue: ${summary.delivery_issue ?? 0}`,
    `- Follow-up sent: ${summary.follow_up_sent ?? 0}`,
    `- Outreach sent: ${summary.outreach_sent ?? 0}`,
    "",
    "## Active Replies And Negotiations",
    "",
    activeRows.length > 0 ? renderTable(activeRows) : "_No active reply threads yet._",
    "",
    "## Full Tracker",
    "",
    renderTable(allRows),
    "",
  ].join("\n");

  fs.writeFileSync(csvPath, csvLines, "utf8");
  fs.writeFileSync(datedCsvPath, csvLines, "utf8");
  fs.writeFileSync(mdPath, mdLines, "utf8");
  fs.writeFileSync(datedMdPath, mdLines, "utf8");

  console.log(`Tracker rows: ${allRows.length}`);
  console.log(`CSV: ${csvPath}`);
  console.log(`Markdown: ${mdPath}`);
};

main();
