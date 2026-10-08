// Example scripts offered in the script editor ("Examples" menu). Each one is
// tested to compile and run (script.test.ts), so they never rot.

export interface ScriptExample {
  id: string;
  title: string;
  description: string;
  /** Where it is meant to go. */
  target: "plot" | "controller";
  source: string;
}

export const SCRIPT_EXAMPLES: ScriptExample[] = [
  {
    id: "break-at-stage",
    title: "Break a mutation at a stage",
    description: "Every session, break (harvest) any Magic Jellybean at stage 36 or more, instead of waiting for stage 120.",
    target: "plot",
    source: `// Break every Magic Jellybean that reached stage 36 or more.
const KIND = "magic_jellybean";
const STAGE = 36;

function onSession() {
  for (const p of plot.spawns(KIND)) {
    if (p.stage >= STAGE) p.break(); // harvested: from stage 12 it drops
  }
}
`,
  },
  {
    id: "counter",
    title: "Variables, logging and metrics",
    description: "Count harvests per kind in a variable, log a summary every 50 cycles and chart the inventory.",
    target: "plot",
    source: `// Variables declared at the top level keep their values between cycles.
let harvests = {};
let sessions = 0;

function onHarvest(e) {
  harvests[e.kind] = (harvests[e.kind] ?? 0) + 1;
}

function onSession() {
  sessions++;
}

function onCycleEnd() {
  metric("chloronite in stock", inventory.chloronite);
  if (cycle % 50 === 49) log(\`cycle \${cycle}: \${sessions} sessions, harvests:\`, harvests);
}
`,
  },
  {
    id: "step-control",
    title: "Step control from code",
    description: "Hold the flow until enough targets are filled, then move on; give up after 200 cycles.",
    target: "plot",
    source: `// Take over when this plot leaves step 1, keeping the flow's other exits.
function afterSession() {
  if (plot.step.number !== 1) return;
  plot.hold(); // the step's own exits don't fire while held
  const filled = plot.targetsFilled();
  if (filled >= plot.targets.length && plot.targets.length > 0) {
    plot.hold(false);
    plot.goto(2); // a step number, id or label
  } else if (plot.cyclesInStep >= 200) {
    warn("Step 1 took too long, moving on anyway");
    plot.hold(false);
    plot.next();
  }
}
`,
  },
  {
    id: "coordinate",
    title: "Coordinate the three plots",
    description: "Controller script: plot 1 farms Chloronite; once there are 20, tell plot 2 to switch to its second step.",
    target: "controller",
    source: `// The controller sees every plot. shared is visible to every script.
shared.chloroniteGoal = 20;

function afterSession() {
  const p2 = getPlot(2);
  if (!p2) return;
  if (inventory.chloronite >= shared.chloroniteGoal && p2.step.number === 1) {
    log("Enough Chloronite, switching plot 2 to step 2");
    p2.goto(2);
  }
  for (const plot of plots) metric(\`plot \${plot.id} plants\`, plot.plants.length);
}
`,
  },
  {
    id: "messages",
    title: "Messages between plots",
    description: "A plot script tells the controller when its targets are all filled; the controller pauses the run the first time.",
    target: "plot",
    source: `// In a plot script. Pair it with a controller script that has:
//   function onMessage(msg, from) { if (msg.type === "full") pause(\`Plot \${from} is full\`); }
let told = false;

function afterSession() {
  const full = plot.targets.length > 0 && plot.targets.every((t) => t.filled);
  if (full && !told) {
    send("controller", { type: "full", cycle });
    told = true;
  }
  if (!full) told = false;
}
`,
  },
  {
    id: "manual-harvest",
    title: "Replace the built-in harvest",
    description: "Switch off the built-in harvest and only harvest spawns that are about to decay or fully grown Chorus Fruit.",
    target: "plot",
    source: `plot.disable("harvest"); // runs once at the start; disabled phases stay off

function onSession() {
  for (const p of plot.spawns()) {
    if (!p.harvestable) continue;
    if (p.kind === "chorus_fruit" || p.willDecayWithin(2)) p.harvest();
  }
}
`,
  },
  {
    id: "place-and-water",
    title: "Place items and water",
    description: "Keep a Fire at (0, 0) and water everything only every 3rd session.",
    target: "plot",
    source: `plot.setPolicy({ watering: "never" });
let n = 0;

function onSession() {
  if (plot.isEmpty(0, 0)) plot.place("fire", 0, 0);
  if (++n % 3 === 0) plot.water();
}
`,
  },
  {
    id: "random-choice",
    title: "Seeded randomness",
    description: "Choose a step at random each time step 1 ends. random() uses the run's seed, so the results repeat.",
    target: "plot",
    source: `function onStepChange(e) {
  if (e.fromStep !== plot.steps[0].id || plot.steps.length < 3) return;
  if (chance(0.5)) plot.goto(3);
}
`,
  },
];
