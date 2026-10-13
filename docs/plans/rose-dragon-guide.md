# Rose Dragon Guide (`/guide`)

Status: **implemented (v2 revamp).** The page is live at `/guide`. The first version's history is
in [the Phase 0 findings](<rose-dragon-guide-phase0.md>). v2 replaced the first version's library
and UI. The page uses the same look as the Simulator and Designer (slate panels, emerald accent,
the shared `SegmentedControl` / `SectionLabel` / `InfoHint`, and the app's modal style).

## The problem

The Rose Dragon flow is a script that reacts to random spawns, so following one simulator run step
by step quickly drifts from the game. Players want instructions that start from what they actually
have: what to build on each plot, what it costs, what to do while there, and when to move on. They
also want to see the farm they're switching to.

## The page

A three-plot dashboard, readable at a glance and stacked on phones.

1. **Header.** The Simulator's header row: icon, "Rose Dragon Guide", an info hint with the three
   steps (harvest and update stock, do the plots left to right, open the plan) and how the cards
   are worked out, and a settings button that shows the schedule in real hours ("Online every 8
   hours").
2. **What you own.** One panel that changes with the player, so there are never two buttons doing
   the same thing:
   - **Nothing entered yet:** the panel itself is the prompt ("Start by entering what you own", why
     it matters, and one **Enter what I own** button). Until then the cards only use farms that
     cost nothing.
   - **Afterwards:** Dead Plant and Fermento chips (greyed at 0), goal progress (`n/5 Rose Dragon
     legendaries`, counting every 9 Aloe fragments as one Aloe), and two buttons for the two
     different jobs: **Add a harvest** (primary, the thing you do every visit) and **Edit totals**
     (to correct a number). Once every goal item is owned, only Edit totals remains.

   The inventory dialog opens in the mode of the button that opened it, with a matching title:
   - **Add a harvest:** type what you just got and it's added on top. The items your plots grow are
     listed first. "I have more now" on a supplies card and "I'm back: next check-in" open this.
   - **Edit totals / Enter what you own:** absolute amounts. A first entry has no mode switch;
     afterwards a switch between the two modes is at the top.

   Both group items as supplies, goal (with fragments: 9 = 1 Aloe), then common → epic, with
   search and an "only what I have" filter.
3. **Forecast strip.** One line: `~20d 20h to Done (p10–p90) · ~N visits · Farm 20 more Dead Plant
   within 1d 4h / your Dead Plants and Fermento should last`. While runs are simulating, it shows "Calculating the forecast…" and a progress bar ("Simulated 5 of 12 runs", sweeping until the first run lands). Once early numbers appear, they are marked "still calculating" until every run is in. Expanding it shows:
   - **The plan:** one lane per plot, farms as blocks on a real time axis, taken from the medoid
     run. Each block is a button that shows its timing below the chart (touch friendly).
   - **Dead Plants & Fermento to Done:** needed (90th percentile) / you own / still to farm. These are farmed separately, never bought.
   - A note when the plan's first real farm on a plot differs from today's card. Zero-length
     entries are skipped. Harvests are random, so the cards are what to follow.

   Once every goal item is owned, the strip and the cards are replaced by one "You have
   everything for the Rose Dragon" panel.
4. **Plot cards** (one per plot):
   - **Confirm first.** The card's action button ("Did it: Plot 1 is on Commons farm" / "Done with
     Plot 2", or the supplies buttons) sits directly under the plot header. It is at the same
     height on all three cards and never moves when a fold opens, a section appears or another
     card changes. The plot then shows "Done this visit" with **Undo** (also at the top), which
     survives a reload, and the next plot is highlighted "Next up".
   - **Headline and reason** under the button: "Switch to Commons farm. The plot was free, and this
     is the most useful farm your stock can pay for." / "Keep Rares. … Keep it until you have 20
     Chloronite".
   - The **destination drawn as the real layout**, in the Simulator's plot style: crop and ground
     images centred in each cell, dashed target cells with faded mutation icons, and placements from
     the inventory marked by a thin gold edge and a gold corner, so the crop stays visible. Hovering
     a cell (tapping on touch) shows a card with its name, rarity, position and what to do with it
     ("Place this from your inventory", "Target cell: … spawns here", its requirements). Below it:
     "Grows: …" and "Now on Empty farmland · Not right?", which opens the farm gallery.
   - **Steps:**
     - clear the old farm;
     - harvest now: what the script harvests, plus targets the player marked fully grown;
     - place from your inventory (item chips);
     - plant for free (collapsed; "31 base crops and 6 fire");
     - can't afford yet;
     - progress bars toward the hold targets (with a note when an earlier plot's placements
       already lowered them);
     - "while you're here" tips and an "every visit" list.
   - **Zombud farms** have a "Zombuds harvested this visit" counter. Each harvest adds the farm's
     ring yield (4) in Zombuds and takes the same number of Dead Plants, which the player places
     again.
   - **Plots waiting on supplies.** Such a plot says exactly how many more it needs ("Needs 8 more Dead Plant: Zombud
     is the next farm…"; Dead Plants and Fermento have to be farmed separately) and offers **I have more now** or **Skip Plot N for now**, so the visit can
     always be finished. An empty plot that would start a farm if it had more supplies says so too.
   - **Devourer farms** have one checkbox ("A Devourer was harvested here, or a plant decayed,
     since it was built"), which triggers the rebuild. The old "What's on the plot" facts dialog
     was removed: players rarely used it. The facts the Guide still keeps come from confirming
     plots: inputs it couldn't afford stay marked missing for the next visit.
5. When every plot is done: **"I'm back: next check-in"**, which opens the inventory to add
   harvests.

Mobile and accessibility: 16px inputs on phones, `touch-action: manipulation`, native `<dialog>`
(Escape, backdrop click, body scroll lock, full-screen sheet under 640px using `100dvh` and the
bottom safe area), tap-to-pin cell tooltips and `prefers-reduced-motion`. These live in
`src/components/guide/guide.css`. Destructive actions (Start over) take a second click
(`ConfirmButton`: "Click again to confirm"), like the Designer's Clear all, never a browser popup.

## How the decisions are made

`projectLogin` (`src/guide/project.ts`):

1. `engine.initState` on the check-in's scenario, **with the scripts detached**. Each plot is
   built on the farm the player reported. Setup is free and takes no decision.
2. Attach the shipped scripts, create fresh script state (optionally seeding
   `shared.builtOnce` from earlier check-ins) and run their top-level code.
3. Prime every Blastberry. A placed one primes at the first tick after placing, so a farm built at
   an earlier visit is always primed by now. (Asking the player to tap each primed Blastberry left
   the Shellfruit farm stuck forever when nobody did.) Then apply the facts: remove missing inputs,
   add standing targets at their stage (watered, with effects latched from the current neighbours
   when fully grown), and flag a Devourer refresh.
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

- `confirmPlot(state, outcome, extras)` puts the plot on `outcome.to`, marks it `acted` and applies
  only deterministic stock changes, recorded as a signed `delta`:
  - minus `outcome.spent`;
  - plus `outcome.selfFunded`: items the same session harvested and placed straight back, e.g.
    6 popped Shellfruit into Phantomleaf + Timestalk. Each harvested plant gives at least one of
    its own item, so without this the stock would go to 0 and then double when the player adds
    the harvest;
  - plus any Zombud harvests counted on the card.

  It **never adds ordinary harvests**: they are random, so the player enters them. The facts that
  are still true stay: inputs it couldn't afford become `missing`, and growing targets stay on a
  farm that stays.
- `undoPlot(state, plotId)` reverses exactly that `delta` and restores the previous plot input.
  Confirmations are part of the stored state, so Undo works after a reload. `skipPlot` marks a
  plot done for this visit without changing anything.
- `startNewCheckIn` clears `acted` and the confirmations, and flags carried facts as
  `factsFromEarlier`.
- `setFarm` (the gallery) resets facts and `acted`. Facts are cleared when empty, so "nothing
  reported" is always `undefined`, never an empty claim.
- **Check-in interval.** `checkEvery` is in real hours. `schedule.ts` converts it to the
  simulator's `everyN` cycles with the player's real cycle length: `cycleSeconds` for their stats,
  8 typical unique crop groups standing plus Flora. With the Guide's default stats a cycle is about
  2.4 h, so the default "every 8 hours" is every 3 cycles. (The first version divided by the 4-hour
  baseline, so "every 4 hours" simulated a visit much more often than that.)
- **Default stats.** A new player (and Start over) gets `GUIDE_DEFAULT_STATS` (`schedule.ts`): a
  mid-game player, not the Simulator's maxed defaults. Flora 0, Crop Growth 100, Growth Speed
  upgrade tier 4, Plant Yield 0.10, Bioanalysis 0, Mining Fortune 1000, Farming Fortune 1500,
  Evergreen Chip 0.20. A saved player keeps their own stats; a stat missing from an old save is
  filled from these.
- **Number fields** keep what is typed and commit on blur or Enter, so typing "24" can't pass
  through "2 → 4 h → 44", and a lone "-" can't zero an item.
- **Persistence.** `skyshards-guide-state` stores `{ version: 3, inventory, plots, settings,
  memory, checkEvery, confirmations, precision }`. It is saved at once on every confirm, undo and
  dialog close, debounced while typing, and flushed on `pagehide`. `restoreState` migrates
  version 2, and drops v1 saves and any farm the flow no longer has.

## The forecast

- `runOne` starts from the same login projection, then calls `engine.run(state, 1)` until every
  plot is Done or 3,000 cycles have run. When any plot sits on the `supplies` step, the run adds
  the top-up that step's label asks for (250 Dead Plant, 50 Fermento) and tracks how low the stock
  would have gone without it. `supplyNeed` = owned − lowest point.
- `summarise` uses completed runs only. If none finished, `seconds` is `null` and the strip says
  so instead of showing the cap. The supplies list is needed (p90) / owned / still to farm / "within" (the
  median time until the owned stock would first run out).
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
- `src/components/guide/`: `FarmPicture`, `PlotCard`, `FarmGallery`,
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

## Playtest

A Playwright playtest played 9 simulated visits plus edge cases. It reported 23 issues; all the
ones accepted are fixed above. They are re-checked by `tmp/playtest/verify_fixes.mjs`: 33/33 pass,
with no page errors. Not changed, by decision:

- The Aloe break stage (10) is the shipped script's `KNOBS.aloeStage`. The Guide repeats the flow;
  changing it is a flow change.
- The flow's own choices are left as they are, though worth raising with the flow: two Commons
  farms on visit 1, stepping back down a tier, and dropping Zombud/Cheesebite at zero supplies.

## Open points

- Without the facts dialog, a player can't report a missing input or a growing target by hand.
  If that turns out to matter, add it back as a mode on the plot card's picture rather than a
  separate dialog.
- Per-plot cycle timing within a login (Plot 1 decides before Plot 2 harvests) can't be planned
  up front. The plot-by-plot confirm and correct handles it.
