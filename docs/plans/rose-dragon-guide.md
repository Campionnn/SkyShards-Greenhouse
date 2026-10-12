# Rose Dragon Guide (`/guide`)

Status: **implemented (v2 revamp).** The page is live at `/guide`. The first version's history is
in [the Phase 0 findings](<rose-dragon-guide-phase0.md>). Those findings still explain why the
Guide needs a small "what's on the plot" facts input, but v2 replaced the first version's library
and UI.

## The problem

The Rose Dragon flow is a script that reacts to random spawns, so following one simulator run step
by step quickly drifts from the game. Players want instructions that start from what they actually
have: what to build on each plot, what it costs, what to do while there, and when to move on. They
also want to see the farm they're switching to.

## The page

A three-plot dashboard, readable at a glance and stacked on phones.

1. **Header.** Three numbered hints (harvest and update stock, do the plots left to right, open the
   plan) and a settings button that shows the schedule ("Online every 12 hours").
2. **What you own.** Dead Plant and Fermento chips, goal progress (`n/5 legendaries`) and an
   **Update** button. The button opens the inventory dialog, grouped as supplies, goal (including
   All-in Aloe fragments: 9 = 1 Aloe), then common → epic, with search and an "only what I have"
   filter.
3. **Forecast strip.** One line: `~16d 2h to Done (p10–p90) · ~222 visits · Buy … / supplies
   should last`. Expanding it shows:
   - **The plan:** one lane per plot, farms as blocks on a real time axis, taken from the medoid
     run.
   - **Bought supplies to Done:** needed (90th percentile) / you own / buy.
   - A note when the plan's first farm on a plot differs from today's card. Harvests are random,
     so the cards are what to follow.
4. **Plot cards** (one per plot):
   - **Now** thumbnail. Tapping it opens the farm gallery ("Not on this farm?").
   - The **destination drawn as the real layout:** crop and ground images, dashed target cells
     with faded mutation icons, paid placements outlined in gold. Below it, "Grows: …".
   - **Headline and reason:** "Switch to Commons farm. The plot was free, and this is the most
     useful farm your stock can pay for." / "Keep Rares. … Keep it until you have 20 Chloronite".
   - **Steps:** clear the old farm, place from your inventory (item chips), plant for free
     (collapsed), can't afford yet, harvest now, progress bars toward the hold targets, "while
     you're here" tips, and an "every visit" list.
   - **Confirm** ("Did it: Plot 1 is on Commons farm" / "Done with Plot 2"). The plot then shows
     "Done this visit" with **Undo**, and the next plot is highlighted "Next up".
   - **What's on the plot** opens the facts dialog: tap placed items that are gone, Blastberries
     that are primed, and target cells where something is growing (stage and fully grown). This is
     optional. Without it the card says it assumes the farm is complete.
5. When every plot is done: **"I'm back: next check-in"**, which opens the inventory to add
   harvests.

Mobile and accessibility: 16px inputs, `touch-action: manipulation`, `:active` press feedback,
hover gated behind `(hover: hover) and (pointer: fine)`, native `<dialog>` (Escape, backdrop click,
body scroll lock, full-screen sheet under 640px using `100dvh` and the bottom safe area) and
`prefers-reduced-motion`. These live in `src/components/guide/guide.css`.

## How the decisions are made

`projectLogin` (`src/guide/project.ts`):

1. `engine.initState` on the check-in's scenario, **with the scripts detached**. Each plot is
   built on the farm the player reported. Setup is free and takes no decision.
2. Attach the shipped scripts, create fresh script state (optionally seeding
   `shared.builtOnce` from earlier check-ins) and run their top-level code.
3. Apply the facts: remove missing inputs, add standing targets at their stage (watered, with
   effects latched from the current neighbours when fully grown), set primed Blastberries, and
   flag a Devourer refresh.
4. For each plot not yet done this visit, in `config.plotOrder`, call the shipped `onStart`
   (`if (complete()) return finish(); tend(plot);`) **against the stock the earlier plots left**.

This replaces v1's "one plot in isolation" model and its `onStart` string surgery:

- The three cards form one coherent login. Following them in order can't spend the same stock
  twice, and there is no forced check-in between plots.
- The script source is never edited. A generator change to `onStart`'s body no longer breaks
  the Guide.
- Each outcome is read from the engine's own `placed` and `harvested` events (exact cells, paid or
  free) and the script's `guide` record (`action`, `why`, `waitFor`). Nothing is parsed from
  layout guesses.

### Validation

`tools/rose-dragon/guide-v2-check.ts` follows the Phase 0 method. It probes immediately before
every real `tend`/`finish` in 8 inventory fixtures × seeds 1–4 (32 complete runs), rebuilds the
check-in at that moment (plots that already acted that cycle are marked `acted`) and compares:

| Metric | Result |
|---|---:|
| Per-decision agreement (stays included) | **12,776 / 12,798 (99.83%)** |
| Farm-change agreement | **620 / 621 (99.84%)** |
| Whole login planned up front, per plot | 12,495 / 12,765 (97.88%) |
| Whole login planned up front, all three plots right | 3,990 / 4,255 (93.77%) |
| Projection debt / script halts | 0 / 0 |

The same numbers with and without the carried `builtOnce` memory.

- The 22 per-decision misses are all `shellfruit popped` (Plot 3 on the Shellfruit-Cheese farm),
  `satisfied lonelily` at cycle 0, or one Jellybean stay. These are states where the real session
  harvested or broke something just before deciding.
- "Whole login up front" is lower by design. In the real run, Plot 2 decides after Plot 1's
  session has harvested, and the Guide can't know those random harvests. The cards stay right
  because the player confirms and corrects plot by plot.

## Check-ins: trust and correct

`src/guide/checkin.ts`:

- `confirmPlot(state, outcome)` puts the plot on `outcome.to`, marks it `acted`, clears its facts
  and subtracts `outcome.spent`, which is deterministic. It **never adds harvests**: they are
  random, so the player enters them.
- `undoPlot` returns exactly that spend and the previous plot input.
- `startNewCheckIn` clears `acted` for the next visit. Farms and facts stay.
- `setFarm` (the gallery) resets facts and `acted`. Facts are cleared when empty, so "nothing
  reported" is always `undefined`, never an empty claim.
- Persistence: `skyshards-guide-state` stores `{ version: 2, inventory, plots, settings, memory,
  precision }`. `restoreState` drops v1 saves and any farm the flow no longer has.

## The forecast

- `runOne` starts from the same login projection, then calls `engine.run(state, 1)` until every
  plot is Done or 3,000 cycles have run. When any plot sits on the `supplies` step, the run adds
  the top-up that step's label asks for (250 Dead Plant, 50 Fermento) and tracks how low the stock
  would have gone without it. `supplyNeed` = owned − lowest point.
- `summarise` uses completed runs only. If none finished, `seconds` is `null` and the strip says
  so instead of showing the cap. The shopping list is needed (p90) / owned / buy.
- `buildPlan` is the medoid run (per-plot edit distance), with real start times for each visit and
  the share of runs that visit that farm.
- Precision: quick 12 / normal 32 / thorough 96 seeds. The pool runs `hardwareConcurrency − 1`
  workers (max 6). A new input cancels the previous forecast and terminates and replaces busy
  workers. Finished forecasts are cached by `inputKey`. The strip shows numbers after 3 runs and
  refines them as more land.

## Derived, not hardcoded

| What | Source |
|---|---|
| Farm names | the step's `label` before `:` / `(` (hub = "Empty farmland") |
| Costs | resolved layout: `placed` and not `isFreePlacedItem` (fire is free) |
| Free crops | `planted` + free placed items |
| Products | target cells (`layout.slots`) |
| Goal | the Done step's `inventoryAtLeast` exits |
| Inventory list | supplies + every paid input + every product + goal + fragments |
| Tip thresholds | `KNOBS.jellyStage` / `KNOBS.aloeStage` read from the shipped script |

The tip sentences in `src/guide/tips.ts` are the only authored text. They come from the mechanics
reference: Jellybean and Aloe break stages, the Blastberry priming → Shellfruit pop, Devourer
roots and ring inputs, Glasscorn 7–8, Snoozling 5/10/15, Thunderling at stage 9, Zombud Dead Plants,
Chorus teleports, Cheesebite rats, Noctilume time and Fleshtrap feeding.

## Files

- `src/guide/`: `project.ts` (login projection), `flow.ts` (loader, catalog, item groups),
  `checkin.ts` (state transitions, validation, restore), `forecast.ts`, `aggregate.ts`,
  `explain.ts` (reasons in words), `tips.ts`, `schedule.ts`, `worker/` (protocol, worker, pool).
- `src/components/guide/`: `FarmPicture`, `PlotCard`, `FarmGallery`, `FactsDialog`,
  `InventoryDialog`, `ForecastStrip`, `SettingsDialog`, `primitives`, `format`, `guide.css`.
- `src/pages/GuidePage.tsx`, plus the route in `src/App.tsx` and the nav entry in
  `src/components/layout/Navigation.tsx`.

## Verification

```powershell
pnpm test; pnpm exec tsc -b
pnpm exec eslint src/guide src/components/guide src/pages/GuidePage.tsx src/utilities/localStorageManager.ts
$VN = (Get-ChildItem node_modules/.pnpm/vite-node@*/node_modules/vite-node/vite-node.mjs).FullName
node $VN --config tools/rose-dragon/guide-phase0.vite.config.mjs tools/rose-dragon/guide-v2-check.ts --seeds 1-4
# Headless Chrome with --remote-debugging-port=9224, dev server on 5173:
node tools/rose-dragon/guide-browser-check.mjs
```

The browser check confirms that:

- three cards render, each with a picture;
- the forecast and its three plan lanes appear;
- confirming Plot 1 takes 7 Dead Plants (250 → 243) and Undo restores 250;
- switching to 24-hour check-ins changes the forecast (16d 2h → 23d 6h);
- the page logs no errors.

It also writes desktop, phone, settings and gallery screenshots to `tools/rose-dragon/cache/`.
`tools/rose-dragon/` is gitignored.

`pnpm build` fails in this Windows environment for a reason that predates this work: esbuild
can't delete its temp file, and the `closeBundle` hooks hide that error behind an `ENOENT` for
`dist/index.html`. See the Phase 0 report.

## Open points

- The facts dialog can't yet express an off-layout spawn or a Devourer root. Those are rare, and
  the player can mark the affected inputs as missing.
- Per-plot cycle timing within a login (Plot 1 decides before Plot 2 harvests) can't be planned
  up front. The plot-by-plot confirm and correct handles it.
