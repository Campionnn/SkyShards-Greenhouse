/**
 * Solver-free regressions against the exported flow, the UI importer and the real engine.
 * Run from the repository root:
 *   node <vite-node> tools/rose-dragon/regression.ts [rose-dragon.flows.json]
 *   node <vite-node> tools/rose-dragon/regression.ts --only focused
 *   node <vite-node> tools/rose-dragon/regression.ts --only supplied,schedules
 * Defaults: focused checks; supplied empty seeds 1-10; every-1/every-6 schedules,
 * all named inventories + random1..4, seeds 11-12. --max defaults to 3000.
 * Broad runs retain no events and advance in batches. Only focused Noctilume
 * target-blocker and natural Devourer survivor proofs retain events one cycle at a time.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { importFlows } from "../../src/components/simulator/scenarioEdit";
import { sanityCheck } from "../../src/simulator/analysis/sanityCheck";
import { isFreePlacedItem } from "../../src/simulator/config";
import { resolveLayout } from "../../src/simulator/flow/layout";
import type { FlowStep } from "../../src/simulator/flow/types";
import { validateScenario } from "../../src/simulator/flow/validate";
import { footprint, footprintFits, ringCells } from "../../src/simulator/grid/cells";
import { defaultSettings } from "../../src/simulator/scenario";
import type { ResolvedLayout } from "../../src/simulator/sim/context";
import { buildOccupancy, insertPlant, newPlant, removePlant } from "../../src/simulator/sim/plants";
import type { Scenario, SimulationState, TimedEvent } from "../../src/simulator/sim/state";
import { INVENTORIES, randomInventory } from "./inventories";
import { allFinished, engine, FREE_STOCK, goalMet, LEGENDARY_GOAL, makeScenario } from "./sim";

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => {
  const at = args.indexOf(`--${name}`);
  if (at < 0) return fallback;
  assert(args[at + 1] && !args[at + 1].startsWith("--"), `--${name} needs a value`);
  return args[at + 1];
};
const file = args[0] && !args[0].startsWith("--") ? args[0] : "rose-dragon.flows.json";
const groups = option("only", "focused,supplied,schedules").split(",");
assert(groups.every((g) => ["focused", "supplied", "schedules"].includes(g)), "--only accepts focused,supplied,schedules");
const maxCycles = Number(option("max", "3000"));
assert(Number.isSafeInteger(maxCycles) && maxCycles > 0, "--max must be a positive integer");
const text = readFileSync(file, "utf8");
const supplied = { dead_plant: 250, fermento: 50 };
let passed = 0;
const failures: string[] = [];
const reports: RunReport[] = [];

function check(name: string, body: () => void): void {
  try {
    body();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${name}: ${message}`);
    console.error(`FAIL ${name}: ${message}`);
  }
}

/** Import exactly as the simulator page does; explicitly override the harness schedule. */
function scenario(inventory: Record<string, number>, seed: number, onlineEvery = 3, defaults = false): Scenario {
  const base = defaults
    ? { plots: [], startingInventory: { ...inventory }, settings: defaultSettings() }
    : makeScenario([], inventory, seed);
  base.settings.seed = seed;
  if (!defaults) base.settings.activity = { kind: "everyN", n: onlineEvery, offset: 0 };
  return importFlows(base, text);
}

const imported = scenario({}, 1);
function layout(step: FlowStep): ResolvedLayout {
  const { resolved, issues } = resolveLayout(step.layout, engine.data);
  assert.deepEqual(issues, [], `invalid layout in ${step.id}`);
  return resolved;
}
function paidPlants(resolved: ResolvedLayout): ResolvedLayout["plants"] {
  return resolved.plants.filter((p) => p.origin === "placed" && !isFreePlacedItem(p.kindId));
}
function costOf(resolved: ResolvedLayout): Record<string, number> {
  const cost: Record<string, number> = {};
  for (const p of paidPlants(resolved)) cost[p.kindId] = (cost[p.kindId] ?? 0) + 1;
  return cost;
}
function stepId(state: SimulationState, plotId: number): string {
  const runner = state.flows.find((f) => f.plotId === plotId)!;
  return state.scenario.plots.find((p) => p.id === plotId)!.flow.steps[runner.stepIndex].id;
}
function completed(state: SimulationState): boolean {
  return goalMet(state) && allFinished(state) && state.flows.every((f) => stepId(state, f.plotId) === "done");
}
function visited(state: SimulationState): Set<string> {
  return new Set(state.flows.flatMap((f) => f.history.filter((h) => !h.skipped).map((h) => h.stepId)));
}
function consumed(state: SimulationState, item: string): number {
  return state.ledger[item]?.consumed ?? 0;
}
function paidConsumption(state: SimulationState): Record<string, number> {
  return Object.fromEntries(Object.entries(state.summary.placedItems).filter(([, qty]) => qty > 0));
}

// Puffercloud is a Devourer dependency in the current recipes/layouts. Include
// actual layout uses because an effect input can be useful outside its recipe graph.
const pufferConsumers = [...new Set(imported.plots.flatMap((p) => p.flow.steps
  .filter((s) => paidPlants(layout(s)).some((d) => d.kindId === "puffercloud"))
  .map((s) => s.id)))].sort();
const pufferRecipeConsumers = engine.data.mutationIds.filter((id) => engine.data.mutations[id].requirements.some((r) => r.crop === "puffercloud"));
const pufferOnlyForDevourer = pufferConsumers.length > 0 && pufferConsumers.every((id) => /^devourer(?:-|$)/.test(id))
  && pufferRecipeConsumers.every((id) => id === "devourer");
console.log(`Flow ${file}; max ${maxCycles} cycles; groups ${groups.join(",")}`);
console.log(`Puffercloud consumers: layouts=${JSON.stringify(pufferConsumers)} recipes=${JSON.stringify(pufferRecipeConsumers)}; Devourer-only=${pufferOnlyForDevourer}`);

function assertPartialSkips(state: SimulationState, inventoryName: string): void {
  const ran = visited(state);
  if (inventoryName === "allDone") {
    assert.deepEqual(paidConsumption(state), {}, "allDone spent mutation items or purchased supplies");
    assert.equal(state.summary.debtEvents, 0, "allDone attempted an uncovered spend");
    assert([...ran].every((id) => id === "hub" || id === "done"), `allDone visited farms: ${[...ran]}`);
  }
  if (inventoryName === "devGlassDone") {
    const forbidden = ["devourer", "devourer-grow", "glasscorn", "zombud", ...(pufferOnlyForDevourer ? ["puffer"] : [])];
    assert(forbidden.every((id) => !ran.has(id)), `irrelevant devGlassDone farms: ${forbidden.filter((id) => ran.has(id))}`);
  }
  if (inventoryName === "aloeOnly") {
    assert.equal(consumed(state, "fermento"), 0, "aloeOnly spent Fermento");
    const unwanted = state.scenario.plots.flatMap((p) => p.flow.steps
      .filter((s) => ran.has(s.id) && layout(s).slots.some((t) => engine.data.mutations[t.mutationId].rarity === "legendary" && t.mutationId !== "all_in_aloe"))
      .map((s) => s.id));
    assert.deepEqual([...new Set(unwanted)], [], "aloeOnly visited a non-Aloe legendary farm");
  }
}

interface RunReport {
  name: string;
  seed: number;
  onlineEvery: number;
  cycles: number;
  days: number;
  goal: boolean;
  done: boolean;
  consumed: Record<string, number>;
  remaining: Record<string, number>;
  debt: number;
}
function runCase(name: string, inventory: Record<string, number>, seed: number, onlineEvery: number): void {
  let state = engine.initState(scenario(inventory, seed, onlineEvery)).state;
  while (state.cycle < maxCycles && !completed(state)) {
    state = engine.run(state, Math.min(12, maxCycles - state.cycle), { retainEvents: "none" }).state;
  }
  const report: RunReport = {
    name, seed, onlineEvery, cycles: state.cycle, days: +(state.elapsedSeconds / 86400).toFixed(2),
    goal: goalMet(state), done: completed(state),
    consumed: { dead_plant: consumed(state, "dead_plant"), fermento: consumed(state, "fermento") },
    remaining: { dead_plant: state.inventory.dead_plant ?? 0, fermento: state.inventory.fermento ?? 0 },
    debt: state.summary.debtEvents,
  };
  reports.push(report);
  console.log(`  ${JSON.stringify(report)}`);
  assert(completed(state) && state.cycle < maxCycles,
    `goal+done not reached before ${maxCycles}; missing=${JSON.stringify(Object.fromEntries(Object.entries(LEGENDARY_GOAL).filter(([id, qty]) => (state.inventory[id] ?? 0) < qty)))} steps=${JSON.stringify(state.flows.map((f) => [f.plotId, stepId(state, f.plotId)]))}`);
  assert.equal(state.summary.debtEvents, 0, "completion run attempted to spend missing inputs");
  assertPartialSkips(state, name);
}

/**
 * Inherited target blockers (old Jellybeans, unwatered Soggybuds) on the Noctilume
 * anchors. The real hub enters the farm directly (no scrub step, so no base crops on
 * the target cells); the simulator's default `clearTargetBlockers` player action breaks
 * them in the entry session. Paid inputs are spent exactly once. Plot 2 is isolated so
 * no other plot spends the exact inventory.
 */
function noctBlockers(kind: "magic_jellybean" | "soggybud", stage: number, onlineEvery: number): void {
  const original = imported.plots.find((p) => p.id === 2)!;
  const main = original.flow.steps.find((s) => s.id === "noct-flesh");
  assert(main, "export must contain noct-flesh");
  assert(!original.flow.steps.some((s) => s.id === "noct-flesh-prepare"), "the potato scrub step should be gone (the simulator clears target blockers)");
  assert(main.policies?.clearTargetBlockers !== false, "Noct farm must not disable clearTargetBlockers");
  const mainLayout = layout(main);
  const cost = costOf(mainLayout);
  assert(Object.keys(cost).length > 0, "Noct farm needs physical paid inputs for this proof");
  const anchors = mainLayout.slots.filter((s) => s.mutationId === "noctilume");
  assert.equal(anchors.length, 2, "expected both Noctilume anchors");
  assert.equal(original.flow.steps[original.flow.startIndex].id, "hub", "Noct proof must initialize the real hub");
  const sc = scenario(cost, 1, onlineEvery);
  sc.plots = sc.plots.filter((p) => p.id === 2);
  let state = engine.initState(sc).state;
  assert.equal(stepId(state, 2), "hub");
  assert.deepEqual(paidConsumption(state), {}, "hub init must not spend or grant farm inputs");
  const plot = state.plots[0];
  const injectedIds: number[] = [];
  for (const anchor of anchors) {
    const p = newPlant(state, engine.data, sc.settings.config, kind, anchor.row, anchor.col, "spawned", state.cycle);
    assert(footprint(p.row, p.col, p.size).every((cell) => buildOccupancy(plot)[cell] === null), "injected blocker must not overlap setup plants");
    p.stage = stage;
    insertPlant(plot, p);
    injectedIds.push(p.id);
  }
  const events: TimedEvent[] = [];
  const deadline = 2 * onlineEvery + 4;
  while (state.cycle < deadline && stepId(state, 2) === "hub") {
    const batch = engine.run(state, 1, { retainEvents: "all" });
    state = batch.state;
    events.push(...batch.events);
  }
  assert.equal(stepId(state, 2), "noct-flesh", "hub must enter the Noct farm directly");
  const entering = events.findIndex((e) => e.kind === "stepChanged" && e.toStep === "noct-flesh");
  assert(entering >= 0, "missing farm entry event");
  assert(injectedIds.every((id) => !state.plots[0].plants.some((p) => p.id === id)), "a blocker was left on a Noctilume anchor");
  for (const id of injectedIds) {
    const removed = events.findIndex((e) => (e.kind === "destroyed" || e.kind === "harvested") && e.plantId === id);
    assert(removed > entering, `blocker ${id} must be removed in the entry session`);
    assert.equal(events[removed].cycle, events[entering].cycle, `blocker ${id} must be removed in the same session as the step change`);
  }
  const occ = buildOccupancy(state.plots[0]);
  for (const a of anchors) assert(footprint(a.row, a.col, a.size).every((c) => occ[c] === null || occ[c]!.kindId === "noctilume"), "Noctilume anchor not free after entry");
  assert.deepEqual(paidConsumption(state), cost, "farm entry must pay the exact input cost once");
  assert.equal(state.summary.debtEvents, 0, "farm entry attempted an uncovered spend");
  console.log(`  Noct ${kind} stage=${stage} onlineEvery=${onlineEvery} cycle=${state.cycle} removed=${injectedIds.length} cost=${JSON.stringify(cost)}`);
}

check("actual UI import and validation", () => {
  assert.deepEqual(imported.startingInventory, {}, "flows import must not inject supplies");
  assert.equal(imported.plots.length, 3);
  const issues = validateScenario(imported, engine.data);
  assert.deepEqual(issues.filter((i) => i.level === "error"), [], "export has validation errors");
  console.log(`  validation: 0 errors, ${issues.filter((i) => i.level === "warning").length} warnings`);
});
check("initial hub grants no paid setup", () => {
  for (const plot of imported.plots) {
    const start = plot.flow.steps[plot.flow.startIndex];
    assert.equal(start.id, "hub", `Plot ${plot.id} starts at a paid farm`);
    assert.deepEqual(paidPlants(layout(start)), [], `Plot ${plot.id} hub has free setup inputs`);
  }
  const { state } = engine.initState(imported);
  assert.deepEqual(paidConsumption(state), {});
  assert(state.plots.every((p) => p.plants.every((plant) => plant.origin === "planted" || isFreePlacedItem(plant.kindId))), "initial state granted a mutation or bought supply");
});

/** Verify real physical footprints; occupancy alone is not productive capacity. */
function physicalFootprints(): void {
  let total = 0;
  for (const plot of imported.plots) for (const step of plot.flow.steps) {
    const resolved = layout(step);
    const occupied = new Map<number, string>();
    for (const [kind, entries] of [["input", resolved.plants], ["target", resolved.slots]] as const) {
      for (const entry of entries) {
        const label = `${kind} ${entry.row},${entry.col}`;
        assert(footprintFits(entry.row, entry.col, entry.size), `Plot ${plot.id}/${step.id}: ${label} hangs off the grid`);
        for (const cell of footprint(entry.row, entry.col, entry.size)) {
          assert(!occupied.has(cell), `Plot ${plot.id}/${step.id}: ${label} overlaps ${occupied.get(cell)} at cell ${cell}`);
          occupied.set(cell, label);
        }
      }
    }
    total++;
  }
  assert(total > 0, "no physical layouts were inspected");
  console.log(`  ${total} disjoint footprint layouts`);
}

/**
 * Static geometry/recipe proof, explicitly NOT an affordability proof: initialize
 * each production layout alone so the real diagnostics inspect its ground and
 * physical plants. Free setup and disabled exits are deliberate only here.
 */
function targetFeasibility(): void {
  let farms = 0;
  let targets = 0;
  for (const plot of imported.plots) for (const step of plot.flow.steps) {
    if (/-(?:prepare|pick|pop|grow)$/.test(step.id) || ["hub", "done", "supplies"].includes(step.id)) continue;
    const resolved = layout(step);
    if (!resolved.slots.length) continue;
    const sc = makeScenario([{ id: plot.id, flow: {
      steps: [{ ...step, exits: [] }], startIndex: 0, loop: false,
    } }], FREE_STOCK, 1);
    const state = engine.initState(sc).state;
    for (const target of resolved.slots) {
      const diagnostic = sanityCheck(state, engine.data, plot.id, target.row, target.col).entries.find((e) => e.mutationId === target.mutationId);
      assert(diagnostic?.canSpawn && diagnostic.chance > 0,
        `Plot ${plot.id}/${step.id}: target ${target.mutationId} ${target.row},${target.col} cannot spawn: ${JSON.stringify(diagnostic?.blockers)}`);
      targets++;
    }
    farms++;
  }
  assert(targets > 0, "no production target anchors were inspected");
  console.log(`  ${targets} production target anchors across ${farms} layouts are physically feasible (static proof; not affordability)`);
}

/**
 * Start the real Plot 2 hub with only the exact eight paid supports; no injected
 * target, patched data, modified exits or forced spawn rate. Preserve survivors
 * while roots grow. Event-order slicing deliberately includes the spawn cycle
 * and excludes any legitimate post-harvest re-entry in the harvest session.
 */
function devourerSurvivors(onlineEvery: number): void {
  const production = imported.plots.flatMap((p) => p.flow.steps
    .filter((s) => layout(s).slots.some((t) => t.mutationId === "devourer"))
    .map((s) => ({ plotId: p.id, step: s })));
  assert.equal(production.length, 1, "Devourer must have one production step, not a destructive grow helper");
  const { plotId, step } = production[0];
  assert.equal(plotId, 2);
  assert.equal(step.id, "devourer");
  assert(!imported.plots.some((p) => p.flow.steps.some((s) => s.id === "devourer-grow")), "Devourer grow helper must be removed");
  assert.equal(step.policies?.replaceDecayed, false, "single-step Devourer must not upkeep eaten supports");
  const resolved = layout(step);
  const anchors = resolved.slots.filter((t) => t.mutationId === "devourer");
  assert.equal(anchors.length, 1, "Devourer safety depends on exactly one target");
  const anchor = anchors[0];
  assert.equal(anchor.size, 1, "Devourer safety depends on a one-cell footprint");
  const cost = costOf(resolved);
  assert.deepEqual(cost, { puffercloud: 4, zombud: 4 }, "Devourer must cost exactly four Puffercloud and four Zombud");
  assert.deepEqual(Object.fromEntries(engine.data.mutations.devourer.requirements.map((r) => [r.crop, r.count])),
    { puffercloud: 4, zombud: 4 }, "Devourer recipe changed; revisit the complete eight-neighbour safety assumption");
  // Spawn requirements use the eight-way ring, NOT the four cardinal effect neighbours.
  const ring = ringCells(anchor.row, anchor.col, anchor.size);
  assert.equal(ring.length, 8, "Devourer target must have a complete eight-way requirement ring");
  let rootedLosses = 0;
  for (const seed of [1, 2, 3, 4]) {
    const sc = scenario(cost, seed, onlineEvery);
    sc.plots = sc.plots.filter((p) => p.id === plotId);
    let state = engine.initState(sc).state;
    assert.equal(stepId(state, plotId), "hub", "Devourer proof must initialize the real hub");
    const entry = engine.run(state, 1, { retainEvents: "all" });
    state = entry.state;
    assert.equal(stepId(state, plotId), "devourer", "exact supports must select Devourer directly from the real hub");
    assert.deepEqual(paidConsumption(state), cost, "hub-to-farm entry must pay exactly once");
    const supports = state.plots[0].plants.filter((p) => p.origin === "placed" && !isFreePlacedItem(p.kindId));
    assert.equal(supports.length, 8);
    const supportIds = new Set(supports.map((p) => p.id));
    const occupancy = buildOccupancy(state.plots[0]);
    assert(ring.every((cell) => {
      const p = occupancy[cell];
      return p && supportIds.has(p.id) && p.size === 1;
    }), "all eight requirement cells must contain the eight paid support IDs");
    assert.deepEqual(Object.fromEntries(["puffercloud", "zombud"].map((id) => [id, ring.filter((cell) => occupancy[cell]?.kindId === id).length])), cost);
    const complete = sanityCheck(state, engine.data, plotId, anchor.row, anchor.col).entries.find((e) => e.mutationId === "devourer");
    assert(complete?.canSpawn && complete.chance > 0, "complete paid ring must physically permit a Devourer spawn");
    for (const support of supports) {
      const missing = structuredClone(state);
      const plant = missing.plots[0].plants.find((p) => p.id === support.id)!;
      removePlant(missing.plots[0], plant);
      const diagnostic = sanityCheck(missing, engine.data, plotId, anchor.row, anchor.col).entries.find((e) => e.mutationId === "devourer");
      assert(diagnostic && !diagnostic.canSpawn && diagnostic.chance === 0 && diagnostic.blockers.some((b) => b.kind === "requirement" && b.crop === support.kindId && b.have === 3 && b.needed === 4),
        `missing ${support.kindId} ${support.id} must prevent another Devourer, not leave a spare requirement`);
    }
    const events: TimedEvent[] = [...entry.events];
    let spawnedId: number | undefined;
    let spawnIndex = -1;
    let harvestIndex = -1;
    const deadline = Math.min(maxCycles, 600);
    while (state.cycle < deadline && harvestIndex < 0) {
      const batch = engine.run(state, 1, { retainEvents: "all" });
      state = batch.state;
      for (const event of batch.events) {
        const index = events.length;
        events.push(event);
        if (spawnedId === undefined && event.kind === "spawned" && event.mutationId === "devourer") {
          spawnedId = event.plantId;
          spawnIndex = index;
        }
        if (event.kind === "harvested" && event.kindId === "devourer" && event.origin === "spawned" && event.plantId === spawnedId) harvestIndex = index;
      }
      assert.equal(state.summary.debtEvents, 0, `Devourer exact-stock proof hit debt at cycle ${state.cycle}`);
      assert.deepEqual(paidConsumption(state), cost, `Devourer exact-stock proof spent more than its initial ring at cycle ${state.cycle}`);
      // Once the first target is standing, a layoutShort pending exit must not
      // be latched offline and later clear supports (or the growing Devourer).
      if (spawnedId !== undefined && harvestIndex < 0) {
        assert.equal(stepId(state, plotId), "devourer", "left Devourer while the natural target was growing");
        assert(!state.flows[0].pendingTransition, "latched a stale transition while a natural Devourer was growing");
        assert(state.plots[0].plants.some((p) => p.id === spawnedId), "natural Devourer disappeared before its actual harvest");
      }
    }
    assert(spawnedId !== undefined && spawnIndex >= 0, `no natural Devourer spawn within ${deadline} cycles`);
    assert(harvestIndex > spawnIndex, `natural Devourer did not survive to a real harvest within ${deadline} cycles`);
    const growing = events.slice(spawnIndex, harvestIndex + 1);
    assert(!growing.some((e) => e.kind === "stepChanged"), "a step change ran between natural Devourer spawn and first harvest");
    assert(!growing.some((e) => e.kind === "placed" && e.origin === "placed" && !isFreePlacedItem(e.kindId)), "paid support was re-placed while Devourer was growing");
    assert(!growing.some((e) => e.kind === "debt" || e.kind === "borrowed"), "missing input was spent while Devourer was growing");
    for (const id of supportIds) {
      assert(!growing.some((e) => e.kind === "destroyed" && e.plantId === id && e.by === "step change"), `surviving support ${id} was cleared by a growing-step transition`);
    }
    const lostSupports = growing.filter((e) => "plantId" in e && supportIds.has(e.plantId)
      && ["destroyed", "removed", "decayed", "harvested"].includes(e.kind));
    assert(lostSupports.every((e) => e.kind === "decayed" || (e.kind === "destroyed" && e.by === "devourer root")), "a paid survivor was removed while growing for a reason other than natural roots/decay");
    const eaten = lostSupports.filter((e) => e.kind === "destroyed" && e.by === "devourer root").length;
    rootedLosses += eaten;
    const harvest = events[harvestIndex];
    assert(harvest.kind === "harvested");
    // The session may clear supports AFTER harvest when it legitimately leaves
    // the farm. Reconstruct standing IDs at the harvest event, not end-of-cycle.
    const missingAtHarvest = new Set(events.slice(0, harvestIndex + 1)
      .filter((e) => "plantId" in e && supportIds.has(e.plantId) && ["destroyed", "removed", "decayed", "harvested"].includes(e.kind))
      .map((e) => "plantId" in e ? e.plantId : -1));
    console.log(`  Devourer onlineEvery=${onlineEvery} seed=${seed} spawnCycle=${events[spawnIndex].cycle} harvestCycle=${harvest.cycle} rootEatenPaid=${eaten} survivorIdsAtHarvest=${supports.length - missingAtHarvest.size} items=${harvest.drops.devourer ?? 0} paidOnce=8 debt=0`);
  }
  assert(rootedLosses > 0, "seed coverage never exercised roots eating a paid support; increase focused seeds");
}

if (groups.includes("focused")) {
  check("Soggybud single owner Plot 3 / twelve targets", () => {
    const owners = imported.plots.flatMap((p) => p.flow.steps
      .filter((s) => layout(s).slots.some((t) => t.mutationId === "soggybud"))
      .map((s) => ({ plotId: p.id, stepId: s.id, slots: layout(s).slots.filter((t) => t.mutationId === "soggybud") })));
    assert.equal(owners.length, 1, "Soggybud must have exactly one production owner");
    assert.equal(owners[0].plotId, 3);
    assert.equal(owners[0].stepId, "soggybud");
    assert.equal(owners[0].slots.length, 12);
  });
  check("disjoint physical footprints", physicalFootprints);
  check("all production target anchors physically feasible", targetFeasibility);
  for (const onlineEvery of [1, 6]) check(`natural Devourer survivor ring / online every ${onlineEvery}`, () => devourerSurvivors(onlineEvery));
  check("default settings / missing purchased supplies", () => {
    const sc = scenario({}, 12345, 1, true);
    const state = engine.run(engine.initState(sc).state, 60, { retainEvents: "none" }).state;
    assert(state.flows.every((f) => stepId(state, f.plotId) === "supplies"), `missing-supply startup stalled at ${state.flows.map((f) => stepId(state, f.plotId))}`);
    assert.deepEqual(paidConsumption(state), {});
  });
  check("default settings / supplied startup", () => {
    const sc = scenario(supplied, 12345, 1, true);
    const state = engine.run(engine.initState(sc).state, 60, { retainEvents: "none" }).state;
    assert(visited(state).has("commons"), "supplied startup never built Commons");
    assert(consumed(state, "dead_plant") > 0, "supplied startup did not pay for Dead Plants");
  });
  for (const name of ["allDone", "devGlassDone", "aloeOnly"]) {
    check(`partial inventory ${name}`, () => runCase(name, { ...FREE_STOCK, ...INVENTORIES[name] }, 1, 3));
  }
  for (const [kind, stage] of [["magic_jellybean", 1], ["magic_jellybean", 36], ["soggybud", 3]] as const) for (const onlineEvery of [1, 6]) {
    check(`Noct inherited ${kind} stage ${stage} / online every ${onlineEvery}`, () => noctBlockers(kind, stage, onlineEvery));
  }
}
if (groups.includes("supplied")) {
  for (let seed = 1; seed <= 10; seed++) check(`supplied empty seed ${seed}`, () => runCase("supplied-empty", supplied, seed, 3));
}
if (groups.includes("schedules")) {
  const inventories = { ...INVENTORIES, ...Object.fromEntries([1, 2, 3, 4].map((n) => [`random${n}`, randomInventory(n)])) };
  for (const onlineEvery of [1, 6]) for (const [name, inventory] of Object.entries(inventories)) for (const seed of [11, 12]) {
    check(`every ${onlineEvery} / ${name} / seed ${seed}`, () => runCase(name, { ...FREE_STOCK, ...inventory }, seed, onlineEvery));
  }
}
console.log(`\n${passed} passed; ${failures.length} failed; ${reports.length} completion runs`);
if (reports.length) {
  const realistic = reports.filter((r) => r.name === "supplied-empty");
  if (realistic.length) console.log(`Supplied-empty consumption: ${JSON.stringify({
    runs: realistic.length,
    deadPlant: realistic.map((r) => r.consumed.dead_plant),
    fermento: realistic.map((r) => r.consumed.fermento),
    maxDeadPlant: Math.max(...realistic.map((r) => r.consumed.dead_plant)),
    maxFermento: Math.max(...realistic.map((r) => r.consumed.fermento)),
  })}`);
}
if (failures.length) {
  for (const failure of failures) console.error(`  ${failure}`);
  process.exitCode = 1;
}
