import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(scriptDir, "../dist");

const exists = async (filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const resolveSpecifier = async (filePath, specifier) => {
  if (!specifier.startsWith(".") || path.extname(specifier)) {
    return specifier;
  }

  const absoluteCandidate = path.resolve(path.dirname(filePath), specifier);
  if (await exists(`${absoluteCandidate}.js`)) {
    return `${specifier}.js`;
  }

  if (await exists(path.join(absoluteCandidate, "index.js"))) {
    return `${specifier}/index.js`;
  }

  return specifier;
};

const rewriteImports = async (filePath) => {
  const source = await fs.readFile(filePath, "utf8");
  const matches = Array.from(
    source.matchAll(/(?<prefix>\bfrom\s*["']|\bimport\s*\(\s*["'])(?<specifier>\.{1,2}\/[^"']+)(?<suffix>["'])/g)
  );

  if (matches.length === 0) {
    return;
  }

  let nextSource = source;
  for (const match of matches) {
    const prefix = match.groups?.prefix;
    const specifier = match.groups?.specifier;
    const suffix = match.groups?.suffix;
    if (!prefix || !specifier || !suffix) {
      continue;
    }

    const resolvedSpecifier = await resolveSpecifier(filePath, specifier);
    if (resolvedSpecifier === specifier) {
      continue;
    }

    nextSource = nextSource.replace(`${prefix}${specifier}${suffix}`, `${prefix}${resolvedSpecifier}${suffix}`);
  }

  if (nextSource !== source) {
    await fs.writeFile(filePath, nextSource, "utf8");
  }
};

const walk = async (directory) => {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(entryPath);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".js")) {
      await rewriteImports(entryPath);
    }
  }
};

await walk(distDir);
