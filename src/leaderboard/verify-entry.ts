// Node entry for the bundled verifier (scripts/build-verify.mjs -> dist-verify/verify.mjs).
// Reads one JSON request from stdin, writes one JSON reply to stdout. See cli.ts.
import { main } from "./cli";

main(process.stdin, process.stdout, process.stderr).then(
  (code) => {
    process.exitCode = code;
  },
  (e) => {
    process.stdout.write(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) + "\n");
    process.exitCode = 1;
  }
);
