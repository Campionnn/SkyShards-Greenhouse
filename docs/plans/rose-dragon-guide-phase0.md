> **Historical.** This is the Phase 0 validation record for the first Guide. The current design (v2: sequential login projection, dashboard UI) and its validation are in [rose-dragon-guide.md](<rose-dragon-guide.md>).

# Rose Dragon Guide — Phase 0 findings

Status: **original inventory-plus-farm-only gate failed (86.33%); the revised model was
revalidated at 99.86% and passes; phases 1–4 not started.**

The implementation gate in the [approved plan](<rose-dragon-guide.md#L153-L171>) requires at least 90% farm agreement and verified paid `onStart` transitions. The measured, deduplicated agreement is **619/717 = 86.33%**. Payment is verified, but agreement fails. No guide route, UI, forecast library, generator metadata or generated guide definition has been implemented. The simulator engine, generator and shipped flows are unchanged.

## Scope and reproducible artifacts

All executable spike files are local-only under the already-ignored tools directory:

- [Replay/payment probe](<../../tools/rose-dragon/guide-phase0.ts>): real-engine farm-change replay, paid-placement proof, physical-state instrumentation controls, ordering/memory counterfactuals, and history coverage check.
- [Replay results](<../../tools/rose-dragon/cache/guide-phase0.json>): exact settings, per-inventory/per-run totals, representative mismatches and gate result.
- [Browser harness](<../../tools/rose-dragon/guide-phase0-browser.html>) and [browser worker](<../../tools/rose-dragon/guide-phase0-browser.worker.ts>): real browser module workers, single-cycle stepping, persisted-variable inspection at changes and 16 ms cooperative slices.
- [Chrome DevTools runner](<../../tools/rose-dragon/guide-phase0-cdp.mjs>) and [browser measurements](<../../tools/rose-dragon/cache/guide-phase0-browser.json>): isolated headless Chrome benchmark and machine-specific measurements.
- [Local Vite configuration](<../../tools/rose-dragon/guide-phase0.vite.config.mjs>): TS transforms without application deployment/close-bundle plugins for CLI validation.

Commands run from the repository root:

```powershell
$vn = (Get-ChildItem node_modules/.pnpm/vite-node@*/node_modules/vite-node/vite-node.mjs).FullName
pnpm exec tsc -p tools/rose-dragon/tsconfig.json
node $vn --config tools/rose-dragon/guide-phase0.vite.config.mjs tools/rose-dragon/guide-phase0.ts --seeds 1-4 --json tools/rose-dragon/cache/guide-phase0.json
# An unmet gate deliberately sets process.exitCode = 2 (the harness reported exit 1).

node $vn --config tools/rose-dragon/guide-phase0.vite.config.mjs tools/rose-dragon/check-supplies.ts
node $vn --config tools/rose-dragon/guide-phase0.vite.config.mjs tools/rose-dragon/regression.ts

# In separate processes; the CDP runner closes this isolated Chrome when done:
pnpm exec vite --host 127.0.0.1 --port 5199 --strictPort
$profile = Join-Path $env:TEMP 'skyshards-guide-phase0-chrome'
& 'C:\Program Files\Google\Chrome\Application\chrome.exe' --headless=new --disable-gpu --no-first-run --no-default-browser-check --remote-debugging-port=9223 --user-data-dir=$profile about:blank
node tools/rose-dragon/guide-phase0-cdp.mjs
```

The temporary Vite server and isolated Chrome were stopped after measurement. Tool files are ignored and are not deliverables available in a fresh checkout; this report preserves the findings.

## Replay method

- Eight existing inventory fixtures × seeds 1–4 = **32 complete runs**.
- Production default stats and policies, online every cycle; normal real-engine RNG and `run(state, 1)` stepping. `ROSE_PRESET` and `ONLINE_EVERY` environment overrides were checked absent. Seed varies per run; the cached settings object shows the defaults before that override. For future reruns the CLI now serializes the actual first-run settings, including environment overrides, rather than an independent defaults object.
- **Finite, explicitly purchased stock:** 5,000 Dead Plants and 5,000 Fermento per run. No unlimited-supply setting or free-import stock is introduced.
- In a cloned copy of the shipped scripts, capture inventory, all current farms and diagnostic facts immediately **before** each `tend`/`finish` decision. Compare only decisions that change the farm ID.
- Rebuild the proposed check-in exactly as specified: each farm's `startIndex`, the captured inventory, complete setup layouts and fresh/empty target cells; run all `onStart` hooks and compare the destination of the deciding plot. Do not add crop stages, missing cells or history to the baseline input.
- Deduplicate persisted probe logs by plot and per-script serial. Cross-check the count against actual non-skipped flow histories: **717 farm changes recorded / 717 actual**. Four same-farm refreshes are excluded, because the selected metric compares farm identities. This is an aggregate count check, not an event-by-event bijection proof; multiple changes inside one call could in principle offset a missed record.

**Correction to the preliminary result:** initialization and the first cycle both have cycle number 0, and script logs persist. The original scan counted 84 initialization decisions twice, producing 703/801 = 87.77%. The final 619/717 = 86.33% result removes those duplicates; the 98 mismatches are unchanged. Use the final result, not the preliminary number.

### Results

| Metric | Result |
|---|---:|
| Overall farm agreement | **619/717 (86.33%)** |
| Non-Done farm agreement | **523/621 (84.22%)** |
| Done decisions | 96/96 (100%) |
| Completed runs with all legendary inventory goals met | 32/32 |
| Script halts / incomplete runs | 0 |
| Debt events | 0 |
| Deduplicated recorded / actual farm changes | 717/717 |
| Same-farm refreshes excluded | 4 |
| Replay wall time (excluding initial instrumentation control) | 70.95 s |
| Implementation gate | **FAIL** |

| Inventory fixture | Matched / changes | Agreement |
|---|---:|---:|
| empty | 105/127 | 82.68% |
| commons | 107/122 | 87.70% |
| rares | 96/114 | 84.21% |
| halfLegendary | 105/124 | 84.68% |
| devGlassDone | 83/97 | 85.57% |
| aloeOnly | 68/76 | 89.47% |
| allDone | 12/12 | 100% |
| epics | 43/45 | 95.56% |

These are correlated transitions from 32 runs, not 717 independent random players/check-ins. Stay-only cycles are not sampled. The metric tests the plan's resynchronization method at actual farm changes, not whole-guide accuracy or future forecast calibration.

## What the 98 mismatches show

Classification is precedence-based: first an ordering counterfactual, then remembered `builtOnce`, then observed leave reasons / plant-state candidates. It is **not** an exhaustive causal proof or a disjoint set of underlying mechanics.

| Diagnostic category | Count | Evidence / interpretation |
|---|---:|---|
| Replaying earlier plots | 32 | Disabling other plots' `onStart` restores the actual destination for the deciding plot. The baseline re-decides plots that may already have harvested, switched and spent stock earlier in that real login. |
| Missing/depleted layout inputs | 19 | The actual leave reason is `short …`; the reconstructed complete layout cannot see those gaps. |
| Shellfruit priming/pop | 20 | Actual reason `shellfruit popped`. Real primed Blastberries can be broken and Shellfruit harvested before deciding; rebuilt placed Blastberries do not have that priming history. |
| Other special-farm state candidates | 26 | Residual mismatches while on Jellybean, Devourer, Aloe or Shellfruit farms. Stored examples include `satisfied jelly` and `rebuild devourer`. This is a coarse farm-ID grouping, not 26 confirmed single-mechanic causes. |
| Other unmodelled state / decision-cache candidate | 1 | Actual `satisfied blast-cheese`, short layout, expected hub; both fresh counterfactuals stay on Blast-Cheese. Not isolated to a specific cause. |

Representative examples are preserved with inventory and farm snapshots in the [replay results](<../../tools/rose-dragon/cache/guide-phase0.json#L127-L1759>):

- Empty, seed 1, cycle 5, Plot 3: Commons → Soggybud in the real run, Commons in the baseline; target-only replay gives Soggybud.
- Empty, seed 1, cycle 54, Plot 3: Blast-Cheese → Shellfruit-Cheese due to missing inputs; complete-layout replay stays on Blast-Cheese.
- Shellfruit examples explicitly record `shellfruit popped`; the live harvest changes inventory inside `tend`, after the input snapshot.
- Empty, seed 1, cycle 156, Plot 3: Jellybean → Chorus after special handling; the pre-handling inventory/farm-only replay stays on Jellybean.

The target-only counterfactual agrees on **651/717 (90.79%)**, but only **555/621 (89.37%)** excluding Done. It is an ablation, **not** an approved replacement: suppressing other plots' decisions independently does not prove that three proposed farms remain jointly affordable or mutually consistent.

Seeding the historical shared `builtOnce` record on top of target-only replay also gives **651/717**, no additional improvement in this sample. No mismatch was assigned to the near-grown-target candidate. Neither result proves that `once` memory or maturing targets are irrelevant: stay cycles and broader settings/history were not covered.

## Paid `onStart` proof

A synthetic farm contains one Dead Plant, one Fermento and one Ashwreath. Starting stock is 7 / 5 / 3 respectively.

| Path | Remaining stock | Paid placement ledger | Debt |
|---|---|---|---:|
| Initial setup directly on farm | 7 / 5 / 3 | Empty | 0 |
| Empty hub → `plot.goto("paid")` in `onStart` | 6 / 4 / 2 | One of each | 0 |

**PASS:** existing-farm setup is free; a newly entered farm in `onStart` consumes inventory. Production engine code was not changed. Existing supply checks also confirm empty imported inventory reaches the supply warning, while explicit 250 Dead Plants / 50 Fermento starts farming.

## Actual browser Web Worker throughput

Environment: Windows, isolated headless **Chrome 154.0.8037.98**, `hardwareConcurrency = 8`. The real module worker runs the shipped flow from empty mutation inventory, with finite 5,000/5,000 supplies and production default settings. It advances one cycle at a time, reads persisted variables and clones inventory at observed end-of-cycle farm changes, and yields between roughly 16 ms slices.

| Measurement | Result |
|---|---:|
| Single worker, seeds 1–4 | 4 runs / 6.482 s = **0.617 seeds/s** |
| Six-worker pool, seeds 1–24 | 24 runs / 9.084 s = **2.642 seeds/s** |
| Observed throughput ratio (different seed sets; one trial) | **4.28×** |
| Completion / debt | All 28 benchmark tasks completed / 0 debt |
| Estimated Quick (24) | **9.08 s**, directly measured |
| Estimated Normal (50) | **18.93 s**, linear extrapolation |
| Estimated Thorough (100) | **37.85 s**, linear extrapolation |

Batch wall time includes worker startup and the benchmark's module loading. The pool is capped at `min(6, hardwareConcurrency − 1)` (six here). The benchmark reports the count of inspected variable rows, not the number of inspector calls. A “transition” in its output means a cycle in which any ending farm index changed, not every individual plot transition.

This validates actual browser-worker feasibility, not final production latency. No guide metadata, medoid/edit-distance aggregation, UI rendering, caching, cancellation stress test, mobile device measurement, or full production per-transition recorder exists yet. Forecast times at 50/100 seeds are estimates, not measurements; partway check-ins and different player settings were not benchmarked. The single and pool cases use different seed sets in one sequential-then-pool trial, so the throughput ratio is not a replicated equal-workload speedup estimate.

After the independent review, the local browser harness was hardened to reject incomplete runs/nonzero debt, resolve flow-load/JSON errors, handle unavailable hardware concurrency, and bound CDP waiting at 180 s. The existing timing cache predates those orchestration guards, but its 28 returned tasks were independently confirmed complete with zero debt; the engine workload itself is unchanged. The [orchestration check](<../../tools/rose-dragon/guide-phase0-browser-check.mjs>) exercises these guards without pretending to be another real-browser performance measurement.

## Equivalence evidence and verification

### What equivalence was actually checked

For supplied-empty seeds 1 and 2, the original shipped scripts and the instrumented clones were compared **at every cycle**, through completion: exact serialized cycle, inventory, game RNG, physical plot states, flow runners/history and summary. They match. Script variables/logs intentionally differ because the probe adds diagnostics. The signature omits elapsed seconds, next plant ID, ledger/debt-episode internals and script RNG/halts; it is not full-state byte equality.

This is **probe non-interference evidence**, not the planned generator before/after proof. No generator or shipped JSON was changed or regenerated. The 8 inventories × seeds 1–100 baseline was stopped partway after the gate failed; there is no completed 800-run byte-identical before/after evidence.

### Checks run

| Check | Result |
|---|---|
| `pnpm test` | **PASS — 37 files, 661 tests.** Existing SSR-test stderr includes caught `localStorage is not defined` messages; no test failed. |
| `pnpm exec tsc -b` | **PASS** |
| `pnpm exec tsc -p tools/rose-dragon/tsconfig.json` | **PASS** |
| Scoped eslint (`src/pages`, simulator engine/UI, hooks, services) | **PASS** |
| Existing supply checks | **PASS — empty and explicit supplied startup** |
| Existing regression suite | **PASS — 76 checks, 0 failures, 61 completion runs** (focused mechanics, supplies, partial inventory, random inventories, every-1/every-6 schedules) |
| Replay script | Measurements complete, **intentional nonzero exit for failed gate** |
| Actual browser worker benchmark | **PASS**, single and pool measured |
| Browser orchestration/error-path checks after hardening | **PASS — 8 checks** (success, unavailable hardware, fetch, HTTP, JSON, worker error, incomplete run and debt); CDP syntax check also passes |
| `pnpm build` | **FAIL in the existing build environment**; investigated, not fixed |
| `/guide` browser/SSR, generator regeneration and full 800-run equivalence | **Not performed: phases 1–4 held** |
| Existing `/simulator` interactive browser smoke | **Not performed in this spike**; importer and engine exercised by regressions |

The original build failure is **esbuild `vite:esbuild-transpile` / `renderChunk`: deleting a temporary file is denied by Windows** (`remove …\\Temp\\esbuild-…: Access is denied`). A temporary in-memory diagnostic plugin exposed that original render error. The application close-bundle plugins then attempt to read the absent `dist/index.html` and report `ENOENT`, masking the original error. The normal build failed twice and the diagnostic run reproduced the same original failure. No build configuration or dependency was changed to bypass it.

## Proposed fixes — require approval, not implemented

1. **First correct the resynchronization/ordering model.** Define a canonical check-in boundary and test joint plot recommendations there. Avoid treating a mid-login snapshot, where earlier plots already spent stock, as permission to run those decisions again. Preserve shared inventory accounting; the target-only ablation is useful evidence but not a ready-to-ship coordinated guide algorithm.
2. **Represent exceptional current-farm facts.** A minimal missing-input/readiness/special-handling checklist could distinguish depleted layouts, primed Shellfruit Blastberries, Jellybean/Aloe harvest readiness and Devourer survivor state without asking for every crop stage. This changes the approved inventory-plus-farm-only input model and needs explicit approval.
3. **Alternative if inputs must remain unchanged:** present the current-farm special actions and completeness checks as conditional instructions, and label the decision as assumption-based rather than “exact now.” Do not silently convert the exact decision into a Monte Carlo majority or lower the 90% gate. Revised behavior and success criteria would need approval and a new validation spike.
4. **Retain conservative handling of missing history.** `builtOnce` history may be carried over from guide check-ins later if a script-readable input is approved, but this sample does not support it as the primary fix. External farm changes still invalidate that history.
5. **Revalidate before phases 1–4.** Check stays as well as changes, disjoint seed ranges, realistic supplies, partially depleted farms, different schedules/settings, and special-state fixtures. Report overall and non-Done agreement separately and prove consistent three-plot affordability. Isolate the remaining cache/unmodelled-state mismatch instead of treating the coarse residual labels as proven causes.

**Decision (original model):** stop here under the requested gate. The next implementation step
needed human approval of a revised resynchronization/input model, followed by another Phase 0
validation. The confirmed design was not weakened or silently changed.

## Revised model revalidation

The user approved the revised model: keep the inventory-plus-farm check-in, add a **minimal
exceptional current-farm facts** panel, and avoid replaying earlier plots' spending. The
implementation is the local-only [revised replay spike](<../../tools/rose-dragon/guide-phase0-revised.ts>)
with results in [the observable-model report](<../../tools/rose-dragon/cache/guide-phase0-revised-observable.json>).

### What changed, precisely

- **The same 32 runs, the same decision points, the same denominators.** The probe still fires
  immediately before the real `tend`/`finish` on the same cloned shipped scripts, so the
  reference is unchanged and the original 717 farm changes remain the separate baseline.
- **Facts are observable only.** The check-in now carries, per plot: missing layout cells,
  standing targets with kind/row/col/**stage**/**fullyGrown**, primed Blastberry cells, and one
  Devourer refresh bit. Held/locked effect sets are **not** read from the oracle; effects are
  rebuilt from the present layout with the real `recomputeEffects`/`effectiveList`, under the
  stated assumption that a fully grown plant latches the effects its current neighbours give it.
- **Only the deciding plot is asked.** `callHook("onStart", [], plotId)` runs the selected
  plot's shipped hook; the other two plots supply scheduling context (their farm IDs) but are
  not re-run, so no earlier plot re-spends the shared inventory inside one recommendation.
- **Bootstrap.** The real `engine.initState` runs on a clone whose per-plot `onStart` body is
  emptied (declaration order and function IDs verified unchanged via `compile(...).funcs`), the
  original sources are restored, and the shipped hook is called once at cycle 0 through the
  existing internal script runtime. This is an **internal startup dependency, not a public
  resumption API**, and no `runTopLevel` or scope reset is performed.

### Results

| Metric | Original model | Revised model |
|---|---:|---:|
| Farm-change agreement | 619/717 (86.33%) | **716/717 (99.86%)** |
| Non-Done farm-change agreement | 523/621 (84.22%) | **620/621 (99.84%)** |
| Done decisions | 96/96 | 96/96 |
| All decisions (superset denominator) | — | 12,872/12,894 (99.83%) |
| Recorded / actual farm changes | 717/717 aggregate | **717/717 per run** |
| Same-farm refreshes excluded | 4 | 4 |
| Debt events / projection debt | 0 | 0 |
| Paid-transition proof | PASS | PASS |
| Instrumentation equivalence | PASS | PASS |
| Gate | FAIL | **PASS** |

Per-inventory change agreement in the revised run: empty 127/127, commons 122/122,
rares 114/114, halfLegendary 123/124, devGlassDone 97/97, aloeOnly 76/76, allDone 12/12,
epics 45/45. The single remaining mismatch is one decision in halfLegendary seed 4; it is
retained in the report rather than rounded away.

**Re-run against the shipped flow.** The gate above was first measured before the generator gained
its `guide` decision record. It was re-run on the **current** shipped
[rose-dragon.flows.json](<../../public/greenhouse/flows/rose-dragon.flows.json>) and reproduces
exactly: gate **PASS**, 716/717 (99.8605%) farm changes, 620/621 (99.84%) excluding Done, 96 Done
decisions, 0 debt and 0 joint debt, payment **PASS**, transition coverage 717/717, instrumentation
equivalent, 0 failures. The generator non-interference proof on the same artifact is also clean:
structural equality outside `plots[i].script.source`, 0 unexplained script changes, and 48 runs with
byte-identical physical state. So the validated numbers describe the bytes that actually ship.

### Bootstrap identity fixture

[The fixture](<../../tools/rose-dragon/guide-phase0-bootstrap.ts>) compares the suppressed-init
plus restored-hook bootstrap against a plain `engine.initState` for the **full state** (plots,
plants, flows/history, inventory, ledger, debts, summary, RNG, and script state), reporting a
structural diff at the first differing path.

| Variant | Result |
|---|---|
| Faithful cycle context (matches ordinary init's `uniqueCropCount 0` / baseline `cycleSeconds`) | **Identical**, 7 fixtures × 2 seeds |
| Actual spike bootstrap (recomputes unique crops and cycle length before `ctx`) | **Identical**, same 14 comparisons |
| Blindness control (`hub` vs `supplies` scenario) | Differs as expected |

Fixtures cover the free hub and supplies steps, the first **paid** placed layout
(`glasscorn` on plot 1), Shellfruit, Devourer, Jellybean and allDone. Ordinary `initState`
builds its `onStart` cycle context with `uniqueCropCount: 0` and the baseline
`CYCLE_BASELINE_SECONDS`, while the spike's bootstrap passes the recomputed values; for this
flow the difference changes no state, but it is a real semantic difference and is the reason
the bootstrap is classified as an internal dependency.

### Still not proven

- The fixture proves **bootstrap identity**, not reconstruction of a mid-session physical
  snapshot (plants at stage 0 with arbitrary hole/blocker/origin combinations).
- Agreement is measured at actual farm changes only; **stay** cycles are not sampled, so the
  destination label does not by itself prove the recommended *action* (what to place, what to
  harvest, in what order) is correct.
- The effect model is an **inference** from the present layout, not the plant's true latch
  history; it is separately named and scored.
- The ordered joint-transaction check proves only that reconstructed startup hooks on all three
  plots incur **zero failed spends**. It is not agreement with the player's real joint next
  farm, and it is not the common post-harvest boundary.
- The synthetic paid proof is an exact-stock fixture, not a production payment integration test.
- Off-target special spawns, same-kind natural inputs that survive a step change, and
  dead/root blockers are not yet covered by dedicated physical fixtures.
