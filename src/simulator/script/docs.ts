// The script API reference: hooks, globals, plot and plant members. The docs
// panel and the editor's autocomplete render from this list, and validation
// uses HOOKS to catch misspelled hook names. Keep it in sync with runtime.ts.

export interface HookDoc {
  name: string;
  signature: string;
  when: string;
  /** Which scripts it runs in. */
  scope: "both" | "plot" | "global";
}

/** Hooks, in the order they run within a cycle. */
export const HOOKS: HookDoc[] = [
  { name: "onStart", signature: "onStart()", when: "Once, right after the starting layouts are built (the player is online). Top-level code ran just before it.", scope: "both" },
  { name: "onTick", signature: "onTick()", when: "Every cycle, after every plot's game tick (growth, water, spawns, decay) and before the player's session. Runs online or not; actions only work when `online`.", scope: "both" },
  { name: "onSession", signature: "onSession()", when: "Active cycles only. Plot script: at the start of its plot's player session, before the built-in water / harvest / step change phases. Controller: once, before every plot's session.", scope: "both" },
  { name: "afterSession", signature: "afterSession()", when: "Active cycles only. Plot script: at the end of its plot's session, after every built-in phase. Controller: once, after every plot's session.", scope: "both" },
  { name: "onCycleEnd", signature: "onCycleEnd()", when: "Every cycle, last thing before the clock advances.", scope: "both" },
  { name: "onSpawn", signature: "onSpawn(e)", when: "A mutation spawned. `e.plant` is the new plant.", scope: "both" },
  { name: "onFullyGrown", signature: "onFullyGrown(e)", when: "A plant became fully grown. `e.plant` is the plant.", scope: "both" },
  { name: "onHarvest", signature: "onHarvest(e)", when: "Something was harvested. `e.kind`, `e.drops` (item -> count), `e.coinValue`, `e.origin`.", scope: "both" },
  { name: "onDecay", signature: "onDecay(e)", when: "A plant decayed (it becomes a Dead Plant, or a Dead Plant disappears).", scope: "both" },
  { name: "onDestroy", signature: "onDestroy(e)", when: "A plant was destroyed without drops (`e.by` says why).", scope: "both" },
  { name: "onPlace", signature: "onPlace(e)", when: "A plant or item was placed (layouts, re-placing, or your script).", scope: "both" },
  { name: "onDryOut", signature: "onDryOut(e)", when: "A plant dried out (halted until watered).", scope: "both" },
  { name: "onStepChange", signature: "onStepChange(e)", when: "The plot moved to another step: `e.fromStep`, `e.toStep`, `e.skipped`.", scope: "both" },
  { name: "onEvent", signature: "onEvent(e)", when: "Every engine event, including the ones above (`e.type` names it). Per-plant growth events are included, so keep it cheap.", scope: "both" },
  { name: "onMessage", signature: "onMessage(msg, from)", when: "Another script called `send(...)` to this script. `from` is a plot id or \"controller\".", scope: "both" },
];

export const HOOK_NAMES = HOOKS.map((h) => h.name);

/** Event hooks by engine event kind. */
export const EVENT_HOOKS: Record<string, string> = {
  spawned: "onSpawn",
  fullyGrown: "onFullyGrown",
  harvested: "onHarvest",
  decayed: "onDecay",
  destroyed: "onDestroy",
  placed: "onPlace",
  driedOut: "onDryOut",
  stepChanged: "onStepChange",
};

export interface ApiDoc {
  name: string;
  signature: string;
  description: string;
  /** Changes the plot: only works when the player is online, never in exit conditions. */
  action?: boolean;
}

export interface ApiSection {
  title: string;
  /** Prefix for autocomplete ("plot." members complete after `plot.`). */
  prefix: string;
  intro?: string;
  entries: ApiDoc[];
}

export const API: ApiSection[] = [
  {
    title: "Time and state",
    prefix: "",
    entries: [
      { name: "online", signature: "online", description: "True on active cycles, when the player is online. Actions only work then." },
      { name: "cycle", signature: "cycle", description: "The cycle being simulated (0 = the first)." },
      { name: "cycleSeconds", signature: "cycleSeconds", description: "Length of this cycle in seconds." },
      { name: "elapsed", signature: "elapsed", description: "Simulated seconds when this cycle fires." },
      { name: "day", signature: "day", description: "Whole simulated days so far (elapsed / 86400, rounded down)." },
      { name: "hour", signature: "hour", description: "Hour of day (0-24) when this cycle fires, from the schedule's start time." },
      { name: "shared", signature: "shared", description: "One object every script sees, kept between cycles. Use it to pass data between plots: shared.ready = true." },
      { name: "inventory", signature: "inventory.chloronite / inventory.get(item)", description: "Shared inventory stock (read-only). Missing items read 0. inventory.has(item, n = 1)." },
      { name: "collected", signature: "collected(item)", description: "Collected in total since the run started (starting stock + produced + added). Spending never lowers it." },
      { name: "summary", signature: "summary.profit", description: "A copy of the run summary: profit, coinsPerDay, harvested, spawned, decayed, revenue, costs, uptime..." },
      { name: "plots", signature: "plots", description: "Every plot, in plot order." },
      { name: "getPlot", signature: "getPlot(id)", description: "The plot with that id (1-3), or null." },
      { name: "plot", signature: "plot", description: "In a plot script: this script's plot. Not defined in the controller script (use plots / getPlot)." },
      { name: "stats", signature: "stats", description: "A copy of the player stats (farmingFortune, floraShard, ...)." },
      { name: "config", signature: "config", description: "A copy of the Advanced settings." },
    ],
  },
  {
    title: "Run control and output",
    prefix: "",
    entries: [
      { name: "log", signature: "log(...values)", description: "Write a line to the script console." },
      { name: "warn", signature: "warn(...values)", description: "Write a warning line to the script console." },
      { name: "pause", signature: "pause(reason?)", description: "Stop the run at the end of this cycle (Run continues from there)." },
      { name: "fail", signature: "fail(message)", description: "Stop the run with an error at this line." },
      { name: "metric", signature: "metric(name, value)", description: "Record a number; the Variables panel shows its latest value and a sparkline." },
      { name: "send", signature: "send(to, message)", description: "Deliver a message to another script's onMessage(msg, from) later this cycle. `to`: a plot id or \"controller\"." },
      { name: "random", signature: "random()", description: "Random number in [0, 1) from the run's seed: same seed, same results. Doesn't change the game's own dice." },
      { name: "randomInt", signature: "randomInt(min, max)", description: "Random whole number from min to max (inclusive)." },
      { name: "chance", signature: "chance(p)", description: "True with probability p." },
    ],
  },
  {
    title: "Game data",
    prefix: "",
    entries: [
      { name: "info", signature: "info(kind)", description: "Data for a crop or mutation: name, size, ground, growthStages, rarity, requirements, decayDays, minimumMutations, spawnWeight, requiresWatering, effects." },
      { name: "price", signature: "price(item)", description: "NPC sell price of an item." },
      { name: "MUTATIONS", signature: "MUTATIONS", description: "Every mutation id." },
      { name: "CROPS", signature: "CROPS", description: "Every crop id (base crops plus fire, fermento, dead_plant)." },
    ],
  },
  {
    title: "Helpers",
    prefix: "",
    intro: "Arrays have the usual methods (map, filter, find, some, every, reduce, sort, includes, slice, ...) plus sum(f?), count(f), min(f?), max(f?), first(), last(). Strings and Math work like JavaScript.",
    entries: [
      { name: "range", signature: "range(n) / range(a, b, step?)", description: "Array of numbers: range(3) is [0, 1, 2]." },
      { name: "keys", signature: "keys(obj)", description: "An object's keys (also values(obj), entries(obj), fromEntries(pairs), assign(target, ...sources))." },
      { name: "copy", signature: "copy(value)", description: "Deep copy of an object or array." },
      { name: "str", signature: "str(value)", description: "Readable text for any value (what log prints)." },
      { name: "JSON", signature: "JSON.stringify(v) / JSON.parse(s)", description: "Like JavaScript." },
      { name: "isArray", signature: "isArray(v)", description: "Also isNumber, isString, isFunction, isNaN, isFinite, Number, String, Boolean, parseInt, parseFloat." },
    ],
  },
  {
    title: "Plot: reading",
    prefix: "plot.",
    intro: "A plot object (plot, plots[i], getPlot(id)).",
    entries: [
      { name: "id", signature: "plot.id", description: "Plot number (1-3)." },
      { name: "plants", signature: "plot.plants", description: "Every plant standing on the plot (row by row), including Dead Plants and Devourer roots." },
      { name: "all", signature: "plot.all(kind?)", description: "Plants of that kind (any origin), or every plant. Dead Plants only for \"dead_plant\"." },
      { name: "spawns", signature: "plot.spawns(kind?)", description: "Natural spawns (of that kind)." },
      { name: "count", signature: "plot.count(kind?)", description: "How many plants of that kind stand on the plot (Dead Plants only for \"dead_plant\")." },
      { name: "at", signature: "plot.at(row, col)", description: "The plant covering that cell, or null." },
      { name: "isEmpty", signature: "plot.isEmpty(row, col)", description: "Nothing covers that cell." },
      { name: "ground", signature: "plot.ground(row, col)", description: "Ground block at that cell (\"farmland\", \"end_stone\", ...), or \"air\"." },
      { name: "targets", signature: "plot.targets", description: "Target slots of the current layout: { mutation, row, col, size, filled, plant, status }." },
      { name: "layout", signature: "plot.layout", description: "The current layout: { plants: [{ kind, row, col, size, origin }], targets: [...] }." },
      { name: "spawnChances", signature: "plot.spawnChances(row, col)", description: "What the next spawn roll there could give: [{ mutation, chance }] (the Sanity Check). Costly; don't call it for every cell every cycle." },
      { name: "policies", signature: "plot.policies", description: "The player policies in force (scenario, plot, step and script overrides merged)." },
      { name: "disabled", signature: "plot.disabled", description: "Built-in session phases switched off by scripts." },
      { name: "held", signature: "plot.held", description: "True while plot.hold() keeps the built-in exits from firing." },
    ],
  },
  {
    title: "Plot: flow and conditions",
    prefix: "plot.",
    intro: "Every exit condition from the flow editor is available, so a script can decide anything a flow can.",
    entries: [
      { name: "step", signature: "plot.step", description: "Current step: { id, label, number, index }." },
      { name: "steps", signature: "plot.steps", description: "Every step of the flow: [{ id, label, number, index }]." },
      { name: "cyclesInStep", signature: "plot.cyclesInStep", description: "Cycles since the plot entered the current step." },
      { name: "pending", signature: "plot.pending", description: "Step id of a step change waiting for the player to come online, or null." },
      { name: "finished", signature: "plot.finished", description: "A non-looping flow reached the end of its last step." },
      { name: "stepVisits", signature: "plot.stepVisits(sinceStep?)", description: "Times the plot entered the current step (this visit included), counting back to the last entry into sinceStep or the run start." },
      { name: "spawnedInStep", signature: "plot.spawnedInStep(mutation)", description: "Spawns of that mutation since entering the step." },
      { name: "harvestedInStep", signature: "plot.harvestedInStep(mutation)", description: "Natural spawns of that mutation harvested since entering the step." },
      { name: "decayedInStep", signature: "plot.decayedInStep(kind)", description: "Plants of that kind that decayed since entering the step." },
      { name: "fullyGrownCount", signature: "plot.fullyGrownCount(mutation)", description: "Natural spawns of that mutation standing fully grown." },
      { name: "lowestStage", signature: "plot.lowestStage(kind)", description: "Lowest growth stage among plants of that kind, or null when there are none." },
      { name: "highestStage", signature: "plot.highestStage(kind)", description: "Highest growth stage among plants of that kind, or null." },
      { name: "targetsFilled", signature: "plot.targetsFilled()", description: "Target slots holding their mutation (growing or fully grown)." },
      { name: "allFullyGrown", signature: "plot.allFullyGrown()", description: "Every base crop and natural spawn is fully grown (and there is at least one)." },
      { name: "noneFullyGrown", signature: "plot.noneFullyGrown()", description: "No base crop or natural spawn is fully grown." },
      { name: "decayImminent", signature: "plot.decayImminent(withinCycles)", description: "Some plant would actually decay within that many cycles." },
      { name: "layoutShort", signature: "plot.layoutShort()", description: "The inventory can't fill what the layout is missing." },
      { name: "check", signature: "plot.check(condition)", description: "Evaluate any flow-editor condition exactly as an exit would: plot.check({ kind: \"targetsFilled\", count: 0 }). Groups work too: { kind: \"group\", match: \"any\", of: [...] }." },
      { name: "exitDue", signature: "plot.exitDue()", description: "Step id the built-in exits would move to right now, or null (nothing changes)." },
      { name: "goto", signature: "plot.goto(step)", description: "Change step now (step id, label or step number). Offline it waits for the next session, like a built-in exit.", action: true },
      { name: "next", signature: "plot.next()", description: "Go to the following step (wrapping).", action: true },
      { name: "restart", signature: "plot.restart()", description: "Re-enter the current step (layout re-applied, counters reset).", action: true },
      { name: "hold", signature: "plot.hold(on = true)", description: "Keep the built-in exits from firing until plot.hold(false); a step change you start still happens." },
      { name: "cancelPending", signature: "plot.cancelPending()", description: "Drop a step change that is waiting for the player." },
    ],
  },
  {
    title: "Plot: actions",
    prefix: "plot.",
    intro: "Actions return true when they did something. When the player is offline they do nothing and return false.",
    entries: [
      { name: "place", signature: "plot.place(kind, row, col)", description: "Put a crop or item at the anchor cell. Base crops and fire are free; other items come from the inventory (false when there is none, unless mutation debt is on).", action: true },
      { name: "breakAt", signature: "plot.breakAt(row, col)", description: "Break whatever covers the cell (harvested if it can be).", action: true },
      { name: "harvestAll", signature: "plot.harvestAll(kind?)", description: "Harvest every harvestable spawn and base crop (of that kind). Returns how many.", action: true },
      { name: "breakAll", signature: "plot.breakAll(kind)", description: "Break every plant of that kind (harvested where possible). Returns how many.", action: true },
      { name: "water", signature: "plot.water()", description: "Water every plant to the max (not Soggybud).", action: true },
      { name: "setGround", signature: "plot.setGround(row, col, ground)", description: "Change the ground block at a cell (farmland, sand, soul_sand, mycelium, netherrack, end_stone).", action: true },
      { name: "runPhase", signature: "plot.runPhase(id)", description: "Run one built-in session phase now: water, gates, roots, harvest, baseCrops, stepChange, maintain, clearTargets, fixGround.", action: true },
      { name: "disable", signature: "plot.disable(...phases)", description: "Switch built-in session phases off for this plot (they stay off until enabled). Do their job yourself, or call plot.runPhase(id) when you want it." },
      { name: "enable", signature: "plot.enable(...phases)", description: "Switch built-in phases back on (no arguments: all)." },
      { name: "setPolicy", signature: "plot.setPolicy(overrides)", description: "Override player policies on this plot: plot.setPolicy({ spawnedHarvest: \"never\" }). Kept until resetPolicies()." },
      { name: "resetPolicies", signature: "plot.resetPolicies()", description: "Drop the script's policy overrides." },
      { name: "setLayout", signature: "plot.setLayout(layout)", description: "Use another layout until the next step change and build it now: a share code, a step id/label/number, or { plants: [{ kind, row, col }], targets: [{ mutation, row, col }] }.", action: true },
      { name: "resetLayout", signature: "plot.resetLayout()", description: "Go back to the step's own layout and build it.", action: true },
    ],
  },
  {
    title: "Plant",
    prefix: "p.",
    intro: "A plant object (plot.plants, plot.at, e.plant). It follows the plant while it stands; once it is gone `alive` is false.",
    entries: [
      { name: "kind", signature: "p.kind", description: "Kind id (\"chorus_fruit\", \"wheat\", \"dead_plant\", \"devourer_root\")." },
      { name: "name", signature: "p.name", description: "Display name." },
      { name: "id", signature: "p.id", description: "Unique plant id." },
      { name: "row", signature: "p.row / p.col / p.size", description: "Anchor (top-left) cell and footprint size." },
      { name: "origin", signature: "p.origin", description: "\"spawned\", \"planted\" (base crop) or \"placed\" (item). Also p.spawned / p.planted / p.placed." },
      { name: "stage", signature: "p.stage", description: "Growth stage (p.growthStages is the last one, p.readyStage the fully grown one)." },
      { name: "fullyGrown", signature: "p.fullyGrown", description: "Fully grown." },
      { name: "harvestable", signature: "p.harvestable", description: "Breaking it now gives drops." },
      { name: "water", signature: "p.water", description: "Water level (dried out at -100 or below: p.dry)." },
      { name: "dead", signature: "p.dead", description: "A Dead Plant." },
      { name: "rival", signature: "p.rival", description: "Spawned on a target labelled for another mutation." },
      { name: "decayCycles", signature: "p.decayCycles", description: "Cycles until its decay timer runs out (at today's cycle length), or null if it never decays. p.decaySeconds is the same in seconds." },
      { name: "timesMutated", signature: "p.timesMutated / p.mutatesRemaining", description: "Minimum mutations progress." },
      { name: "effects", signature: "p.effects", description: "Effects it receives now (latched ones: p.lockedEffects)." },
      { name: "gate", signature: "p.asleep / p.ratAlive / p.charge / p.hunger / p.primed", description: "Special-mutation state." },
      { name: "target", signature: "p.target", description: "Mutation the target slot at its anchor is labelled for, or null." },
      { name: "plot", signature: "p.plot", description: "The plot it stands on." },
      { name: "alive", signature: "p.alive", description: "Still standing." },
      { name: "protected", signature: "p.protected", description: "Built-in phases leave it alone (see protect)." },
      { name: "willDecayWithin", signature: "p.willDecayWithin(cycles)", description: "Its timer runs out within that many cycles and its minimum mutations are met." },
      { name: "break", signature: "p.break()", description: "Break it: harvested if harvestable, a Dead Plant is cleared (item back), anything else is destroyed.", action: true },
      { name: "harvest", signature: "p.harvest()", description: "Harvest it if it can be harvested (false otherwise).", action: true },
      { name: "destroy", signature: "p.destroy()", description: "Break it without drops.", action: true },
      { name: "waterIt", signature: "p.waterIt(amount?)", description: "Water it to the max (or add amount).", action: true },
      { name: "wake", signature: "p.wake() / p.vacuum() / p.discharge() / p.feed()", description: "Wake a Snoozling, vacuum a Cheesebite rat, discharge a Thunderling, feed a Fleshtrap.", action: true },
      { name: "protect", signature: "p.protect(on = true)", description: "Built-in harvest, base-crop upkeep, target clearing and layout upkeep leave it alone (a step change still clears it)." },
    ],
  },
];

/** Built-in session phases a script can disable or run. */
export const SCRIPT_PHASES = ["water", "gates", "roots", "harvest", "baseCrops", "stepChange", "harvestAfterStepChange", "maintain", "clearTargets", "fixGround"] as const;
