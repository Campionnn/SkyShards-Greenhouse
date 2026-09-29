// Copy the backend's game data verbatim into the frontend.
//
//   pnpm sync:data                     # from ../SkyShards-API/data.json
//   pnpm sync:data -- path/to/data.json
//
// public/greenhouse/data.json must stay byte-identical to the backend file;
// src/simulator/data/data.test.ts fails when it drifts.

import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(process.argv[2] ?? resolve(root, "../SkyShards-API/data.json"));
const target = resolve(root, "public/greenhouse/data.json");

if (!existsSync(source)) {
  console.error(`sync-data: source not found: ${source}`);
  process.exit(1);
}

const data = JSON.parse(readFileSync(source, "utf8"));
const counts = ["crops", "mutations", "effects"].map((k) => `${Object.keys(data[k] ?? {}).length} ${k}`);

const before = existsSync(target) ? readFileSync(target, "utf8") : null;
copyFileSync(source, target);
const after = readFileSync(target, "utf8");

console.log(`sync-data: ${source} -> ${target}`);
console.log(`sync-data: ${counts.join(", ")}${before === after ? " (unchanged)" : " (updated)"}`);
