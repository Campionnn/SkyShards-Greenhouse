# Greenhouse simulator scripting

Scripts give you full control of the simulator from code. They run **on top of** flows and policies: a scenario without scripts behaves exactly as before, and a script only changes what it touches.

Open the editor from the **Scripts** panel on `/simulator` (or **Open the script** on an error banner). Edits are a draft until you click **Apply** (Ctrl+S), which restarts the simulation.

## Where scripts live

| Script | Sees | Typical use |
|---|---|---|
| **Plot script** (one per plot) | `plot` (its own plot), plus everything global | Per-plot rules: "break Jellybeans at stage 36", custom harvesting, step logic |
| **Controller script** (one per scenario) | `plots`, `getPlot(id)`; no `plot` | Coordinating plots: "when plot 1 has 20 Chloronite, move plot 2 on" |

All scripts share one object, `shared`, and can send each other messages with `send(to, msg)` / `onMessage(msg, from)`. Scripts are saved with the scenario and exported in flows files.

## The language

A small, safe JavaScript: `let` / `const` / `var`, functions and arrow functions (defaults, rest parameters), `if` / `else`, `for`, `for...of`, `for...in`, `while`, `do...while`, `switch`, `break` / `continue`, `try` / `catch` / `finally`, `throw`, arrays, objects, template strings, destructuring, spread, `?.`, `??`, `&&=`, `||=`, `??=`, `typeof`, `delete`.

Not supported: classes, `new`, `this`, `async` / `await`, generators, regular expressions, labels, getters / setters. `Math.random` is replaced by `random()`, which uses the run's seed.

Arrays have the usual methods plus `sum(f?)`, `count(f)`, `min(f?)`, `max(f?)`, `first()`, `last()`. Helpers: `range`, `keys`, `values`, `entries`, `fromEntries`, `assign`, `copy`, `str`, `JSON`, `Math`.

## When code runs

**Top-level code runs once**, when the run is set up (after the starting layouts are built). Put per-cycle logic in **hooks**: functions with these names.

| Hook | When |
|---|---|
| `onStart()` | Once, right after the top-level code. |
| `onTick()` | Every cycle, after the game tick (growth, water, spawns, decay), before the player's session. |
| `onSession()` | Online cycles. Plot script: at the start of its plot's session, before the built-in phases. Controller: once before every plot's session. |
| `afterSession()` | Online cycles, at the end of the session (plot script) or after every plot's session (controller). |
| `onCycleEnd()` | Every cycle, last. |
| `onSpawn(e)`, `onFullyGrown(e)`, `onHarvest(e)`, `onDecay(e)`, `onDestroy(e)`, `onPlace(e)`, `onDryOut(e)`, `onStepChange(e)` | When that event happens (`e.plant`, `e.kind`, `e.row`, `e.col`, `e.drops`...). Delivered after the phase that caused it. |
| `onEvent(e)` | Every engine event (`e.type`). |
| `onMessage(msg, from)` | Another script called `send(...)` to this one. |

Per cycle: game tick, then `onTick`, then (online) controller `onSession`, then each plot's session (`onSession`, built-in phases, `afterSession`), then controller `afterSession`, then `onCycleEnd`.

## Variables

Top-level variables keep their values between cycles, and survive Back, Undo and splitting a run. They're stored in the simulation state. They can hold numbers, strings, booleans, `null` / `undefined`, arrays, objects, plots, plants and top-level functions. A function created inside another function can't be kept between cycles. The **Variables** section of the Scripts panel shows every top-level variable and `shared`.

## Online and offline

All player actions (breaking, placing, watering, step changes) only happen when the player is online (`online` is true). Offline, actions do nothing and return `false`. `plot.goto(...)` offline waits for the next session, like a built-in exit. Reading the plots and changing variables always works.

## Built-in behaviour

The built-in player keeps doing everything it normally does. Take it over piece by piece:

- `plot.disable("harvest", "maintain", ...)` switches built-in session phases off (until `plot.enable(...)`). `plot.runPhase("harvest")` runs one when you want it. The phases are `water`, `gates`, `roots`, `harvest`, `baseCrops`, `stepChange`, `harvestAfterStepChange`, `maintain`, `clearTargets` and `fixGround`.
- `plot.setPolicy({ spawnedHarvest: "never", watering: "never", ... })` overrides policies.
- `plot.hold()` keeps the step's own exits from firing; `plot.goto(step)`, `plot.next()` and `plot.restart()` change step from code.
- `plant.protect()` makes the built-in harvest, upkeep and target clearing leave a plant alone.
- `plot.setLayout(...)` uses another layout until the next step change.

## Exit conditions

The flow editor has a **script expression** condition, for example `plot.count("chorus_fruit") >= 4 && shared.ready`. It sees the plot script's variables and functions, and may only read. Scripts can evaluate any flow-editor condition with `plot.check({ kind: "targetsFilled", count: 0 })`, and every condition also has a direct function (`plot.lowestStage(k)`, `plot.stepVisits()`, `plot.decayImminent(n)`...).

## Errors and pausing

A runtime error stops the run after the current cycle. A banner shows the script, hook, line and message, and the editor highlights the line. Back and Undo still work; fix the script and Apply to restart. Every hook call has a step budget (2,000,000 steps), so an endless loop is an error rather than a frozen tab. `pause(reason)` stops the run after the cycle; Run or Step continues. `fail(message)` stops it with an error.

## Determinism

Same scenario and seed, same result, always. `random()`, `randomInt()` and `chance()` draw from a stream of their own, so adding a script that rolls dice doesn't change the game's own spawn rolls.

## Example: the motivating case

```js
// Plot script: break every Magic Jellybean at stage 36 or more.
function onSession() {
  for (const p of plot.spawns("magic_jellybean")) {
    if (p.stage >= 36) p.break(); // harvested: from stage 12 a Jellybean drops
  }
}
```

More examples are in the editor's **Examples** tab (`src/simulator/script/examples.ts`). The full API reference is in its **Reference** tab (`src/simulator/script/docs.ts`).
