# The starting-items builder (Leaderboard v3)

`builder.flows.json` is a **frozen copy** of the site's Rose Dragon flow, used by the "from nothing" score
(`docs/plans/leaderboard-v3.md` §3.2, `verify.ts` `runIronman`): the builder makes a flow's starting items (its kit) from
an empty inventory, then the flow runs from exactly those items.

| | |
|---|---|
| Source | `public/greenhouse/flows/rose-dragon.flows.json` |
| Copied from the commit | `5b8e3de3134b80f72d9d99293b5cee58915d8669` ("update default effect weights, show cache warning for effect weight", 2026-10-28), the last commit that changed the file |
| Taken at | `d79732804e46ae742e712e54045084ca199ad4a8` (dev, 2026-10-29), the committed file, not a working copy |
| Format | the same JSON, minified to one line (`JSON.stringify`) |

`builder.ts` `BUILDER_SOURCE` records the same commit.

**Do not update it casually.** It is bundled into the verifier: any change here changes `ENGINE_VERSION`, which
re-verifies every leaderboard entry. To take a newer Rose Dragon flow, copy the committed file at a named commit,
update the table above and `BUILDER_SOURCE`, run the builder tests (`builder.test.ts`) and the v3 acceptance checks,
then rebuild and sync the verifier.

`builderFor(kit)` rewrites each plot script's two generated lines (and nothing else):
- `const D = {...};`: `goal` = the kit, `legendaries` = the kit's legendaries, `low` / `high` raised to at least the kit;
- `const KNOBS = {...};`: `single` without `"jelly"`.
