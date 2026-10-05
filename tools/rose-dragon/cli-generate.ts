// node <vite-node> tools/rose-dragon/cli-generate.ts [out.json] [--prune]
//   --prune: delete solver cache entries the current jobs don't use.
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { writeFlows } from "./generate";
import { CACHE_PATH, usedCacheFiles } from "./solver";

const args = process.argv.slice(2);
await writeFlows(args.find((a) => !a.startsWith("--")) ?? "rose-dragon.flows.json");
if (args.includes("--prune")) {
  let n = 0;
  for (const f of readdirSync(CACHE_PATH)) if (!usedCacheFiles.has(f)) (rmSync(join(CACHE_PATH, f)), n++);
  console.log(`pruned ${n} unused cache entries, kept ${usedCacheFiles.size}`);
}
