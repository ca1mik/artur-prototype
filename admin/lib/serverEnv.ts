import "server-only";

import fs from "node:fs";
import path from "node:path";

let cachedEnv: Record<string, string> | null = null;

const parseEnvFile = (content: string) => {
  const values: Record<string, string> = {};

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const unquotedValue =
      rawValue.startsWith('"') && rawValue.endsWith('"')
        ? rawValue.slice(1, -1)
        : rawValue.startsWith("'") && rawValue.endsWith("'")
          ? rawValue.slice(1, -1)
          : rawValue;

    values[key] = unquotedValue;
  }

  return values;
};

const readRootEnv = () => {
  if (cachedEnv) {
    return cachedEnv;
  }

  const envCandidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "..", ".env"),
    path.resolve(process.cwd(), "..", "..", ".env"),
  ];

  for (const envPath of envCandidates) {
    if (!fs.existsSync(envPath)) {
      continue;
    }

    cachedEnv = parseEnvFile(fs.readFileSync(envPath, "utf8"));
    return cachedEnv;
  }

  cachedEnv = {};
  return cachedEnv;
};

export const readServerEnv = (key: string) => process.env[key] ?? readRootEnv()[key];
