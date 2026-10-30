import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

type WatchOptions = {
  intervalMinutes: number;
  stopOnError: boolean;
  maxRuns: number | null;
  passthroughArgs: string[];
};

const backendDir = process.cwd();
const rootDir = path.resolve(backendDir, "..");

const loadEnv = () => {
  const candidates = [path.resolve(backendDir, ".env"), path.resolve(rootDir, ".env")];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate, override: false });
    }
  }
};

const parseArgs = (argv: string[]): WatchOptions => {
  const passthroughArgs: string[] = [];
  let intervalMinutes = Number(process.env.INBOX_MONITOR_INTERVAL_MINUTES ?? "5");
  let stopOnError = false;
  let maxRuns: number | null = null;

  for (const arg of argv) {
    if (arg === "--stop-on-error") {
      stopOnError = true;
      continue;
    }

    if (arg.startsWith("--interval-minutes=")) {
      const value = Number(arg.slice("--interval-minutes=".length));
      if (Number.isFinite(value) && value > 0) {
        intervalMinutes = value;
      }
      continue;
    }

    if (arg.startsWith("--max-runs=")) {
      const value = Number(arg.slice("--max-runs=".length));
      if (Number.isInteger(value) && value > 0) {
        maxRuns = value;
      }
      continue;
    }

    passthroughArgs.push(arg);
  }

  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) {
    intervalMinutes = 5;
  }

  return {
    intervalMinutes,
    stopOnError,
    maxRuns,
    passthroughArgs,
  };
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const runMonitorOnce = (args: string[]) =>
  new Promise<number>((resolve) => {
    const cliPath = path.resolve(backendDir, "node_modules", "tsx", "dist", "cli.mjs");
    const scriptPath = path.resolve(backendDir, "src", "tools", "monitorInbox.ts");
    const child = spawn(process.execPath, [cliPath, scriptPath, ...args], {
      cwd: backendDir,
      stdio: "inherit",
      env: process.env,
    });

    child.on("close", (code) => resolve(code ?? 0));
  });

const main = async () => {
  loadEnv();

  const options = parseArgs(process.argv.slice(2));
  let runCount = 0;

  while (options.maxRuns === null || runCount < options.maxRuns) {
    runCount += 1;
    const startedAt = new Date().toISOString();
    console.log(`[inbox-watch] run ${runCount} started at ${startedAt}`);

    const exitCode = await runMonitorOnce(options.passthroughArgs);
    const endedAt = new Date().toISOString();
    console.log(`[inbox-watch] run ${runCount} finished with code ${exitCode} at ${endedAt}`);

    if (exitCode !== 0 && options.stopOnError) {
      process.exit(exitCode);
    }

    if (options.maxRuns !== null && runCount >= options.maxRuns) {
      break;
    }

    await wait(options.intervalMinutes * 60 * 1000);
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
