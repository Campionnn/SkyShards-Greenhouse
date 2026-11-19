// Copies the built share renderer (dist-share/, from `pnpm build:share`) into the sibling SkyShards-API
// checkout at tools/share-render/, replacing what was there (node_modules is kept).
//
// Usage: pnpm build:share && pnpm sync:share

import { cpSync, existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(repoRoot, "dist-share");
const target = resolve(repoRoot, "../SkyShards-API/tools/share-render");

if (!existsSync(resolve(source, "share-render.mjs"))) {
  console.error("sync-share-render: dist-share/ not built; run `pnpm build:share` first.");
  process.exit(1);
}
if (!existsSync(resolve(repoRoot, "../SkyShards-API"))) {
  console.error("sync-share-render: SkyShards-API checkout not found next to this repo.");
  process.exit(1);
}
if (existsSync(target)) for (const f of readdirSync(target)) if (f !== "node_modules") rmSync(resolve(target, f), { recursive: true, force: true });
cpSync(source, target, { recursive: true });
console.log(`sync-share-render: -> ${target} (render ${readFileSync(resolve(source, "RENDER_VERSION"), "utf8").trim()})`);
