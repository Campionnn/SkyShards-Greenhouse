// Copies the built verifier (dist-verify/verify.mjs, from `pnpm build:verify`) into the sibling
// SkyShards-API checkout at tools/verify/verify.mjs, where the API runs it as a subprocess.
//
// Usage: pnpm build:verify && pnpm sync:verify

import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(repoRoot, "dist-verify/verify.mjs");
const versionFile = resolve(repoRoot, "dist-verify/ENGINE_VERSION");
const targetDir = resolve(repoRoot, "../SkyShards-API/tools/verify");
const target = resolve(targetDir, "verify.mjs");

if (!existsSync(source)) {
  console.error(`sync-verify: ${source} not found; run \`pnpm build:verify\` first.`);
  process.exit(1);
}
if (!existsSync(resolve(repoRoot, "../SkyShards-API"))) {
  console.error("sync-verify: SkyShards-API checkout not found next to this repo.");
  process.exit(1);
}
mkdirSync(targetDir, { recursive: true });
copyFileSync(source, target);
if (existsSync(versionFile)) copyFileSync(versionFile, resolve(targetDir, "ENGINE_VERSION"));
const version = existsSync(versionFile) ? readFileSync(versionFile, "utf8").trim() : "?";
console.log(`sync-verify: -> ${target} (engine ${version})`);
