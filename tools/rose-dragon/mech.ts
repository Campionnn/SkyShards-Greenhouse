// Mechanic experiments (scratch). Usage: node vite-node tools/rose-dragon/mech.ts <name>
import { encode, fromAscii, render } from "./layouts";
import { makeScenario, runUntil, FREE_STOCK } from "./sim";
import type { FlowStep } from "../../src/simulator/flow/types";

const name = process.argv[2];

function report(steps: FlowStep[], inv: Record<string, number>, seeds: number[], max: number, stop: (inv: Record<string, number>) => boolean) {
  for (const seed of seeds) {
    const sc = makeScenario([{ id: 1, flow: { steps, loop: false, startIndex: 0 } }], { ...FREE_STOCK, ...inv }, seed);
    const r = runUntil(sc, { maxCycles: max, chunk: 1, stop: (s) => stop(s.inventory) });
    const s = r.state.summary;
    console.log(`seed ${seed}: ${r.cycles}c placed ${JSON.stringify(s.placedItems)} harvested ${JSON.stringify(s.harvested)} destroyed ${JSON.stringify(s.destroyed)}`);
    console.log("   history", JSON.stringify(r.history[1]));
  }
}

const empty = encode({ inputs: [], targets: [] });

if (name === "shell") {
  // Blastberries in row 0 (not touching each other), turtlellinis in row 1 between them.
  const l = fromAscii(["B.B.B.B.B.", ".T.T.T.T.."], { T: "turtlellini", B: "blastberry" });
  console.log(render(l));
  const steps: FlowStep[] = [
    { id: "arm", label: "arm", layout: { code: encode(l) }, exits: [{ when: [{ kind: "cycles", n: 1 }] }] },
    { id: "pop", label: "pop", layout: { code: empty }, fullClear: true, exits: [] },
  ];
  report(steps, { turtlellini: 20, blastberry: 20 }, [1], 9, () => false);
}

if (name === "jelly") {
  // break jellies early with a full clear at stage 48
  const code = "M9MprTE0rNFDAomJSYmJEJZjkmMimWKYAAA";
  const steps: FlowStep[] = [
    { id: "grow", label: "grow", layout: { code }, exits: [{ when: [{ kind: "targetsFilled", count: 0 }, { kind: "lowestStageAtLeast", mutationId: "magic_jellybean", stage: 48 }] }] },
    { id: "pop", label: "pop", layout: { code: empty }, fullClear: true, exits: [] },
  ];
  report(steps, { duskbloom: 30 }, [1, 2, 3], 200, (inv) => (inv.magic_jellybean ?? 0) > 0);
}
