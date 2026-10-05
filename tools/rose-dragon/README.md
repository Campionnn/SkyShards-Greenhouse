# Rose Dragon flow

`rose-dragon.flows.json` (repo root) is a 3-plot flow for the Greenhouse simulator that goes
from "all 3 plots unlocked, nothing owned" to owning the Rose Dragon legendaries:
**2 each of All-in Aloe, Devourer, Glasscorn, Phantomleaf and Timestalk**.

## Using it (players)

1. Open `/simulator`, **Scenario › Import flows**, and paste the file.
2. Put what you already own into the **starting inventory** (any mutations, any amounts). The
   flow skips every farm whose products you already have enough of, and every line that
   only leads to legendaries you already own.
3. Settings the flow was built and tested for: Crop Growth 100, Greenhouse Speed 0, Growth
   Speed upgrade tier 5, Plant Yield 0.1, Evergreen 0.3, Bioanalysis 0, Flora 0, Mining
   Fortune 1000, online **every 3 cycles**. Fermento and Dead Plants are assumed bought from
   the bazaar, **not supplied automatically by the simulator**. Add **250 Dead Plants
   and 50 Fermento** to starting inventory before running. Replenish if they run out;
   this is a suggested buffer, not a guarantee for every seed or preset (broad tests use
   5000 each). Import flows does not import inventory or player settings.
4. Run it. Each plot shows the farm it is on (step label). When a plot says
   **"Choose next farm"**, it is idle: nothing it can build is needed right now. Its empty
   farmland still grows Lonelilies. If it says **"OUT OF FERMENTO / DEAD PLANTS"**,
   a needed farm is blocked on purchased supplies. Add those to inventory and restart
   the simulation if you changed starting inventory.

### How each plot decides what to build

Every plot has the same shape:

- **Choose next farm** (the hub). Its exits are checked in order, before anything is built:
  - **Done**, once every Rose Dragon legendary is owned.
  - Otherwise, the first farm in the plot's priority list that is **wanted** and **in stock**:
    - *wanted*: one of its products is below its low mark, and a legendary it leads to is
      still missing;
    - *in stock*: the inventory holds every item the layout places.
  - If none applies, the hub layout (empty farmland) is built and the plot waits.
- **A farm**. Its exits, in order:
  - **Done** when everything is owned;
  - **back to the hub** when every product reaches its high mark (or is no longer needed);
  - *filler farms only* (commons, uncommons, rares, Soggybud): straight to any farm higher
    in the plot's list that is wanted and in stock;
  - **back to the hub** when the layout is missing inputs (eaten, decayed) and the inventory
    can't replace them (`layoutShort`).

The priority lists put the most advanced farm first, so a plot always works on the highest
tier it can, and the three plots spread the tiers between them:

| Plot | Main line | Also helps with |
|---|---|---|
| 1 | Snoozling → Puffercloud / Stoplight Petal / PlantBoy | Glasscorn, Phantomleaf+Timestalk, Startlevine, Blastberry, fillers |
| 2 | Lonelily → Noctilume+Fleshtrap → Thunderling, Zombud → Devourer (keeps the unique-crop strip in column 9) | All-in Aloe, Chorus, Jellybean, fillers |
| 3 | Jellybean → Blastberry+Cheesebite+Turtlellini → Startlevine, Chorus, Shellfruit → Glasscorn, Phantomleaf+Timestalk, All-in Aloe | fillers |

### Marks (when a farm starts and stops)

For every item: **low mark** = the most any single farm layout places of it; **high mark** =
1.5 × what all farms that use it place together. Legendaries: 2. A farm starts when one of its
products is below the low mark and stops once all of them are at the high mark. A product
counts as done early when every legendary it leads to is owned (e.g. Zombud once you own 2
Devourers).

### Special farms

- **Devourer**: inputs are re-placed only while no Devourer is growing
  (`devourer-grow` step: roots destroy inputs, so replacing them would just feed the roots).
  When the roots have eaten more than the inventory can replace, the plot goes back to the
  hub and makes more Zombud/Puffercloud.
- **Magic Jellybean**: grown to stage 36 and then broken (`jelly-pick` puts Sugar Cane on the
  target cells, so the step change harvests the Jellybeans; ×3 drops), instead of waiting
  for stage 120.
- **Shellfruit**: places 6 Turtlellini around 3 Blastberries (`shellfruit`), then clears the
  plot (`shellfruit-pop`). Breaking a primed Blastberry hits its neighbours, and each
  Turtlellini between two Blastberries is hit twice and becomes a Shellfruit (4 per run).
- **All-in Aloe** uses a single target: one harvest at the auto-chosen stage drops several
  aloes (fragments ×yield, 9 fragments = 1 aloe).
- **Phantomleaf + Timestalk / Glasscorn / Devourer** use 1 target each. The inputs stay placed
  and grow the next one after a harvest, and those layouts are solved to put harvest-boost
  effects on the target.

## Changing it (developers)

**Do not edit `rose-dragon.flows.json` by hand.** It is generated:

```
# vite-node runs the TS tools against the real engine
$VN = node_modules/.pnpm/vite-node@*/node_modules/vite-node/vite-node.mjs
node $VN tools/rose-dragon/cli-generate.ts rose-dragon.flows.json   # build the flow
node $VN tools/rose-dragon/test.ts rose-dragon.flows.json --seeds 1-10           # named inventories
node $VN tools/rose-dragon/test.ts rose-dragon.flows.json --seeds 1-4 --random 40 # random inventories
node $VN tools/rose-dragon/inspect.ts rose-dragon.flows.json devGlassDone,aloeOnly  # validation + which farms ran
node $VN tools/rose-dragon/describe.ts rose-dragon.flows.json --layouts            # readable dump
```

| File | What it is |
|---|---|
| `jobs.ts` | **The definition.** Every farm (solver targets or a hand-drawn layout, which plots offer it, special handling) and each plot's priority list. Edit this. |
| `generate.ts` | Turns jobs into flows: solves layouts, computes low/high marks and which legendaries each item leads to, and writes the hub/farm/done steps and their exits. |
| `solver.ts` | Local solver client (`http://127.0.0.1:8765`, `SOLVER_URL` to override): uses the default crop priorities, runs at most 2 solves at a time, and caches every result in `cache/` (delete an entry to re-solve). |
| `layouts.ts` | Share-code encode/decode, `fromAscii` hand layouts, `render` (ASCII), `inputCost`. |
| `sim.ts` | Player preset from the task, scenario builder, run helpers. `ONLINE_EVERY` env var overrides the 3-cycle schedule. |
| `test.ts`, `inventories.ts` | Test harness: runs from the start with each inventory × seed until every plot holds **Done**, then checks the legendaries. Prints days, per-plot busy share and the step timeline (`--verbose`). |
| `inspect.ts`, `describe.ts` | Validation (the same import path as the page) and readable dumps. |
| `explore.ts`, `recipes.ts`, `trial.ts`, `jobtrial.ts`, `mech.ts` | Scratch tools used to measure farm rates and mechanics. |

### Rules that keep it working

- **Every item a farm places must be produced by some farm, or be free** (Fermento, Dead
  Plant: `FREE_ITEMS` in `generate.ts`). Otherwise that farm can never be in stock.
- **The hub exit order is the plot's priority list.** Put higher tiers first. A farm on
  several plots is solved per plot. Plot 2's layouts are solved without column 9 (the
  unique-crop strip).
- **Filler farms** (`filler: true`) must be cheap: they get preempted by anything above
  them. Non-filler farms run until satisfied or short of inputs.
- If Fermento or Dead Plants stop being free, remove them from `FREE_ITEMS` and add farms
  for them (Dead Plants: let crops decay; Fermento: armor drops).
- After any change, regenerate and run `test.ts` (named + `--random`). Every run must print
  `ALL OK`. Watch the `busy` share per plot to see whether a plot sits idle.

### Simulator features this relies on

- `checkOnEntry` exits (the hub and "satisfied" checks skip steps without building them).
- Triggers `inventoryAtLeast` / `inventoryBelow` with nested AND/OR groups.
- `layoutShort` (added for this flow): "the inventory can't fill what this step's layout is
  missing".
- `collectedAtLeast` (added alongside; not used by the current flow): totals collected
  regardless of spending.
- `highestStageBelow`, `lowestStageAtLeast`, `targetsFilled`, `fullClear`, per-step `policies`.

### Measured (seeds 1–10, online every 3 cycles)

| Starting inventory | Average days |
|---|---|
| empty | ~49 |
| some commons | ~48 |
| commons through rares | ~38 |
| one of each legendary | ~46 |
| Devourer + Glasscorn owned | ~37 |
| only the aloe missing | ~29 |
| epics in stock | ~14 |
| everything owned | immediately Done |
| 40 random inventories × 4 seeds | 23–54 (mean ~38), all OK |
