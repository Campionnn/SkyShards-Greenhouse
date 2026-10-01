// Copy the canonical game data from the sibling SkyShards-API checkout into
// public/greenhouse/data.json, byte for byte. src/simulator/data/data.test.ts
// fails if the two copies drift apart.
//
// Usage: pnpm sync:data

import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(repoRoot, "../SkyShards-API/data.json");
const target = resolve(repoRoot, "public/greenhouse/data.json");

if (!existsSync(source)) {
  console.error(`sync-data: source not found: ${source}`);
  console.error("Check out SkyShards-API next to this repo, then run `pnpm sync:data` again.");
  process.exit(1);
}

const next = readFileSync(source);
try {
  JSON.parse(next.toString("utf8"));
} catch (err) {
  console.error(`sync-data: ${source} is not valid JSON, nothing copied: ${err.message}`);
  process.exit(1);
}

const prev = existsSync(target) ? readFileSync(target) : null;
copyFileSync(source, target);

const lf = (buf) => buf.toString("utf8").replace(/\r\n/g, "\n");
const status =
  prev === null
    ? "created"
    : prev.equals(next)
      ? "already up to date"
      : lf(prev) === lf(next)
        ? "updated (line endings only)"
        : "updated";

console.log(`sync-data: ${source}`);
console.log(`        -> ${relative(repoRoot, target)} (${next.length} bytes, ${status})`);
