# Rose Dragon flow

[rose-dragon.flows.json](<../../rose-dragon.flows.json>) is a three-plot flow for the
Greenhouse simulator, from all three plots unlocked and no mutations owned to
**owning at least 2 each of All-in Aloe, Devourer, Glasscorn, Phantomleaf and Timestalk**.

## Using it (players)

1. Open `/simulator`, choose **Scenario › Import flows**, and paste the exported flow.
2. Enter your owned mutations in **starting inventory**. The flow skips production that
   is already sufficiently stocked or only feeds legendary goals you have completed.
3. Add **250 Dead Plants and 50 Fermento** to starting inventory. These are purchased
   supplies, **not automatically provided or unlimited**. This is a suggested buffer,
   not a guarantee for arbitrary seeds/settings; replenish if needed.
4. Use the tested preset: Crop Growth 100, Greenhouse Speed 0, Growth Speed upgrade
   tier 5, Plant Yield 0.1, Evergreen 0.3, Bioanalysis 0, Flora 0, Mining Fortune 1000,
   online **every 3 cycles**. Flow import does **not** import inventory or settings.
5. Restart/reset after changing starting inventory. Run until every plot says **Done**.

**Choose next farm** means a plot is waiting for needed inputs or work from another
plot. Its empty farmland can still produce Lonelilies. **OUT OF FERMENTO / DEAD
PLANTS** explicitly identifies a purchased-supply shortage; it is not a farming step.

## What the current revision optimizes

The design goal is **time to own every goal legendary**, averaged over the named
starting inventories. Bought supplies are a secondary concern. Cell occupancy is not a goal.
An earlier revision padded empty cells with free crops; it was rejected because it
did not increase useful production, and that padding has been removed.

- **Bottleneck-driven layouts.** Instrumented runs showed the main farms always waited
  on the same few products. Commons waited on Choconut (and Ashwreath). Uncommons
  waited on Duskbloom (and Chocoberry) for 130+ cycles per plot, while its other
  products were already above their stop levels. Snoozling and Thunderling occupied
  Plots 1 and 2 for 80–90 cycles each.
- **Bigger batches where they pay off:** Commons now has 6/8/4/4/6/4/6/6 targets
  (Ash/Choconut/Dust/Gloom/Scour/Shade/Veil/Wither), and Snoozling and Thunderling
  have 4 targets each. Larger Snoozling/Thunderling batches cost more inputs per build
  but halve the time those farms hold a plot.
- **Focus layouts (smarter dispatch).** A job can have *focus variants*: whole-plot
  layouts aimed at the products that usually bind that job. The hub prefers a variant when
  **only its products** are below their low marks. It also falls back to one when the full layout's inputs
  aren't in stock. A family (full job + variants) counts as one consumer for demand
  marks. Current variants:
  - `commons-choconut`: 12 Choconut + 6 Ashwreath, **no bought inputs**.
  - `uncommons-dusk`: 8 Duskbloom + 4 Chocoberry.
  Cut-down variants (fewer targets for fewer inputs) were measured and rejected:
  plot time, not input cost, is the bottleneck, so a smaller layout made the flow
  ~40 cycles slower from empty. Shroom and Cheesebite focus variants showed no
  measurable benefit and were not added.
- **Early Aloe break.** The player's normal Aloe harvest waits for the long-run
  optimum stage (~13–14). Every stage past 4 risks a reset to stage 1. One traced run
  held Plot 3 in Aloe for 228 cycles through more than 20 resets. The goal needs only
  18 fragments, so an `aloe-pick` step breaks the Aloe at stage 10 (none owned) or
  stage 8 (one owned) while the inputs stay standing. A break latched while offline is
  skipped if the Aloe reset meanwhile. Stage pairs 11/9, 10/8, 9/7 and 8/6 all measured
  within noise of each other; 10/8 was chosen.
- **Commons/Uncommons hand over when low marks are met (`yieldWhenLow`).** These
  farms used to run until **every** product reached its high mark. One trace held Plot 1
  in Uncommons for 132 cycles to raise Duskbloom from 32 to 33, while Snoozling's
  inputs were already in stock. Now, once every product is at its low mark, the farm
  hands the plot to an earlier farm in the priority list that is wanted and in stock.
  The same rule for Rares/Blast-Cheese/Soggybud measured no gain and was not added.
- **Startlevine may run on two plots at once.** No flow condition can see another
  plot's step. Restricting Startlevine to one plot measured slower (+2 to +9 cycles), so
  both Plots 1 and 3 keep it. When Glasscorn is the last missing legendary, doubling its
  slowest input helps.
- **All layouts are fresh 300-second local-solver solves** with the default
  priorities and default effect weights (Harvest Boost 0.2, Improved Harvest
  Boost 0.3, Harvest Loss −0.2). Every target anchor is checked with the real
  sanity check.
- **Kept from earlier revisions:** one Soggybud owner (Plot 3, 12 targets); committed
  batches; one-time Noctilume target scrub for inherited Jellybeans; single-step
  survivor-preserving Devourer; on-arrival shortage rechecks; Shellfruit blast layout.

Some layouts intentionally leave cells empty: **Lonelily needs empty neighbours,
Chorus needs teleport landing space, Devourer needs its AIR moat, and Shellfruit needs
its blast geometry.** Elsewhere, empty cells are cells the solver found no useful
requirement or effect for.
### Explored but not shipped (for future work)

Measured against the current flow with the same preset (empty, half-legendary,
Aloe-only, epics, Devourer+Glasscorn-done inventories; 100 seeds each unless noted):

- **Expandable Startlevine (2 → 4 targets, `startWith: 2`).** The generator supports
  starter sub-layouts: it carves the cheapest 2-target subset of the 300 s
  4-target solve and upgrades in place once the extra 2 Blastberry + 6 Cheesebite are
  in stock. An isolated engine check confirmed the upgrade keeps all 13 placed inputs and the
  growing targets, and spends only the difference. Over 300 seeds it is **1–3
  cycles faster** (within noise, never worse). Not promoted at the user's request; re-enable
  by setting Startlevine to 4 targets with `startWith: 2` in jobs.ts.
- **Startlevine 4 targets from the start:** +23 to +31 cycles slower. Building it
  needs 14 Cheesebite at once, which delays the start.
- **Larger Puffercloud/Stoplight Petal/Chorus (4 targets each, expandable from 2):**
  0 to +18 cycles slower (Petal 4 hurt Aloe-only by +18 ± 3).
- **Larger Blast-Cheese (3 Blastberry/4 Cheesebite/2 Turtlellini):** −9 empty/−7
  half-legendary but +8 to +10 on Devourer+Glasscorn-done; over 300 seeds, neutral
  on average. A Cheesebite focus layout on top of it was +27 to +33 slower.
- **Plot specialization** (fixed owners per chain, Commons/Uncommons shared):
  - Full split: −59 to −67 cycles vs the old root, but **+30 to +40 slower** than
    the current flow.
  - Single owners for Glasscorn, Phantomleaf/Timestalk or Aloe: neutral, or slower
    on some inventories.

  Multiple plots running the same job mostly happens for Uncommons and Commons. That
  overlap helps, because those batches gate everything downstream.
## Scheduling and inventory

Every plot starts at a free **hub**, never a paid farm. The hub first checks the overall
legendary goal, then its priority list for the first farm that is **wanted** and
**in stock**. If no farm can start but purchased supplies are the only missing inputs
for a needed farm, the plot shows the supply warning.

- **Low mark:** the most any single consumer job layout places of an item.
- **High mark:** 1.5 times what all consumer jobs place together, rounded up, plus any
  explicit extra buffer. Different plot versions use their maximum cost for marks,
  but their own actual cost for dispatch. Legendary marks are 2.
- **Wanted:** at least one product is below its low mark and still feeds a missing goal.
- **Satisfied:** every product reaches its high mark or no longer feeds a missing goal.

All current jobs are committed batches. The generator retains optional `filler: true`
preemption support for future experiments, but no current job enables it.

Hub order per family: **focused variant -> full job -> fallback variant**. "Focused"
means every other product of the family is at its low mark or obsolete. "Fallback"
means the full job is wanted but its inputs aren't in stock (disable with `fallback: false`).

| Plot | Main responsibilities |
|---|---|
| 1 | Snoozling, Puffercloud, Stoplight Petal, PlantBoy; assists Glasscorn, Phantomleaf/Timestalk, Startlevine and Blastberry |
| 2 | Lonelily, Noctilume/Fleshtrap, Thunderling, Zombud and Devourer; assists Aloe, Chorus and Jellybean; keeps the unique-crop strip in column 9 |
| 3 | Soggybud batches, Jellybean, Blastberry/Cheesebite/Turtlellini, Startlevine, Chorus and Shellfruit; finishes Glasscorn, Phantomleaf/Timestalk and Aloe |

### Special handling

- **Devourer:** `replaceDecayed: false` prevents feeding the roots. The layout is
  refreshed after harvest or a target/input decay, only with no live Devourer. A
  shortage then sends the plot to the hub to make more inputs. The current exact
  four-Puffercloud/four-Zombud ring cannot produce another Devourer after one paid
  input decays, which makes an offline-latched decay refresh safe. Re-audit this
  assumption if the geometry or target count changes.
- **Magic Jellybean:** stage 36, then the picking step places Sugar Cane in target
  cells to break/harvest Jellybeans for the stage-36 multiplier instead of waiting
  for stage 120.
- **Shellfruit:** 6 Turtlellini around 3 Blastberries, then a full-clear blast step;
  double-hit Turtlellini become Shellfruit.
- **Aloe:** a single target; its chosen harvest stage yields fragments, and 9 fragments
  convert to an Aloe.
- **Legendary targets:** one each for Glasscorn, Devourer and Aloe; the combined
  Phantomleaf/Timestalk farm has one of each. A footprint can occupy several cells.

## Changing it (developers)

**Do not hand-edit the generated export.** Edit sources and regenerate. Run from the
repository root in PowerShell:

```powershell
$VN = (Get-ChildItem node_modules/.pnpm/vite-node@*/node_modules/vite-node/vite-node.mjs).FullName
node $VN tools/rose-dragon/cli-generate.ts rose-dragon.flows.json
node $VN tools/rose-dragon/test.ts rose-dragon.flows.json --seeds 1-10 --strict-debt
node $VN tools/rose-dragon/test.ts rose-dragon.flows.json --seeds 11-14 --random 40 --strict-debt
node $VN tools/rose-dragon/regression.ts
node $VN tools/rose-dragon/inspect.ts rose-dragon.flows.json devGlassDone,aloeOnly
node $VN tools/rose-dragon/describe.ts rose-dragon.flows.json --layouts
```

The test CLI accepts `--json <path>` for machine-readable results and `--verbose`
for step timelines; failure sets a nonzero exit status. The regression CLI supports
`--only focused`, `--only supplied,schedules`, and `--max 3000` (the default).

| Source | Responsibility |
|---|---|
| [jobs.ts](<jobs.ts>) | Farm targets/ASCII layouts, focus variants (`focusOf`), eligible plots, special handling, priority lists |
| [generate.ts](<generate.ts>) | Solving, costs/family marks, dependencies, focus dispatch and hub/farm/helper/done steps |
| [layouts.ts](<layouts.ts>) | Encoding, target scrub, cost/count helpers, rendering |
| [solver.ts](<solver.ts>) | Local solver at `http://127.0.0.1:8765` (`SOLVER_URL` override), strictly one request at a time per process (run only one solving process), default priorities and effect weights, SHA1 cache keyed by request + time limit |
| [sim.ts](<sim.ts>) | Real-engine player preset, scenario builder and finite test supplies; `ONLINE_EVERY` schedule override |
| [test.ts](<test.ts>), [test-harness.ts](<test-harness.ts>), [inventories.ts](<inventories.ts>) | CLI, reusable end-to-end runner, named/deterministic random inventories |
| [regression.ts](<regression.ts>) | UI import/setup, partial goals, purchased supplies, physical handoffs and alternate schedules |
| [inspect.ts](<inspect.ts>), [describe.ts](<describe.ts>) | UI-path validation, branch inspection and readable layout dumps |

### Rules that keep it working

- Every paid item must have a producer or be a purchased supply. `FREE_ITEMS` only
  exempts Fermento/Dead Plants from the dependency graph; placement still spends them.
- Start every plot at a free hub: the engine grants initial layout setup for free.
- Keep higher tiers first in each hub. Preserve Plot 2's unique-crop strip.
- Do not pad layouts with crops for occupancy. Occupancy is not a productivity metric,
  and extra neighbours can create incidental competitors.
- Compare candidates by end-to-end completion over **many seeds** (100+ per inventory).
  With 10 seeds, the standard error is about 15–25 cycles, larger than most real
  differences. A layout change also shifts the RNG stream, so "same seed" pairs are
  not variance-reduced.
- Use the real engine, not a solver score, for completion and debt checks. Test both
  high-stock coverage and the recommended finite supply buffer.
- CLI `busy` measures time outside hub/done, **not physical occupancy or productivity**.
- Leave the simulator and game data unchanged when tuning this flow.

## Measured verification

All completion measurements use the real simulator engine, not a solver estimate.
Preset as above, online every 3 cycles, 5,000 of each purchased supply (to isolate
scheduling; realistic 250/50 supply tests are separate). Means are in-game days to
finish all plots over **seeds 1–100 per inventory**. "Previous" is the rejected padded
revision, which had the same production counts as the revision before it.

| Starting inventory | Rejected padded flow | Bigger batches + focus | **Current** (+ Aloe break, hand-over) |
|---|---:|---:|---:|
| Empty mutations | 43.1 (52.9) | 36.9 (60.0) | **34.7** (41.7) |
| Commons stocked | 43.1 (56.9) | 35.6 (46.0) | **33.6** (41.7) |
| Rares stocked | 37.0 (53.4) | 32.1 (45.4) | **30.1** (37.4) |
| Half the legendaries | 40.8 (55.1) | 34.5 (45.7) | **32.1** (40.9) |
| Devourer + Glasscorn complete | 32.6 (50.6) | 28.1 (37.7) | **25.0** (37.7) |
| Only Aloe still needed | 28.5 (40.3) | 23.8 (33.1) | **18.4** (24.0) |
| Epics stocked | 14.7 (37.1) | 14.7 (31.7) | **11.2** (21.4) |
| All goals already owned | 0.3 | 0.3 | 0.3 |

Mean (max) in-game days. In cycles, the average over all eight inventories fell from
**315.1 to 243.4** (−71.7); from empty, 452.7 → 364.1 (±3.6). All 800 runs reached
the goal with zero debt. The early Aloe break was the largest single gain: it removed
the long Aloe-reset tails.

Under the **GUI default settings** (stronger stats, online every cycle, 250 Dead
Plants/50 Fermento, empty inventory, seeds 1–50), the mean is 293.9 cycles vs 318.2
for the intermediate flow (max 372 vs 402). These are not the tuning preset.
- **160 random-inventory runs** (random1–160, seed 21): all goals reached, all plots
  done, zero debt; mean 29.1 days, range 16.0–38.3.
- **Static layout audit:** 337 production target anchors across 37 layouts physically
  feasible; 54 layouts with disjoint input/target footprints.
- **Regression suite (`regression.ts`), all 78 checks pass:**
  - 10 empty-inventory seeds with 250 Dead Plants/50 Fermento: at most **63 Dead
    Plants and 20 Fermento** used.
  - 48 named/random cases at online-every-1 and online-every-6.
  - Focused partial-goal cases (allDone spends nothing; devGlassDone and aloeOnly skip
    irrelevant branches).
  - Default-settings missing-supply notice and supplied startup.
  - Four Noctilume scrub handoffs (stage 1/36 × every 1/6).
  - Eight natural Devourer survivor cases (exact 4 Puffercloud + 4 Zombud ring).
  - UI import validation, no paid initial setup, Soggybud single owner.

The export has **54 steps** (15/19/20 across plots 1/2/3).

```powershell
pnpm exec tsc -p tools/rose-dragon/tsconfig.json
node $VN tools/rose-dragon/regression.ts
```

These are seeded simulator results, not a guarantee for every real-game setup or
arbitrary player settings. In particular, flow import alone does not apply the tested
preset or provide starting supplies.