import { PrismaClient, type Prisma } from "@prisma/client";

const prismaQueryLoggingEnabled = process.env.PRISMA_LOG_QUERIES === "true";
const prismaLogs: Prisma.LogDefinition[] = [
  { emit: "event", level: "error" },
  { emit: "event", level: "warn" },
];

if (prismaQueryLoggingEnabled) {
  prismaLogs.unshift({ emit: "event", level: "query" });
}

export const prisma = new PrismaClient<Prisma.PrismaClientOptions, "query" | "warn" | "error">({
  log: prismaLogs,
});

if (prismaQueryLoggingEnabled) {
  prisma.$on("query", (event) => {
    // eslint-disable-next-line no-console
    console.debug(`Prisma query: ${event.query} ${event.params}`);
  });
}

prisma.$on("warn", (event) => {
  // eslint-disable-next-line no-console
  console.warn(`Prisma warning: ${event.message}`);
});

prisma.$on("error", (event) => {
  // eslint-disable-next-line no-console
  console.error(`Prisma error: ${event.message}`);
});
