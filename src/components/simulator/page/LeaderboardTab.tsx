import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, Eye, Link2, LogOut, Pencil, Play, Square, Trophy } from "lucide-react";
import { useAuth } from "../../../hooks/useAuth";
import { useBazaarPrices } from "../../../hooks/useBazaarPrices";
import { checkSubmission, clampCycles, DEFAULT_CYCLES, MAX_CYCLES, MIN_CYCLES, submissionFile, submissionFromScenario, type CellKind, type RunKind } from "../../../leaderboard/rules";
import { EVERY, TIERS, type TierId } from "../../../leaderboard/tiers";
import { WALL_MS_BACKSTOP } from "../../../leaderboard/verify";
import { DESCRIPTION_MAX, localKindSummary, TIER_LABEL, TITLE_MAX, userName } from "../../../leaderboard/view";
import { LocalTestPool, randomSeeds } from "../../../leaderboard/worker/pool";
import { flowLink, flowShareLink, submitFlow } from "../../../services/flowsService";
import { defaultGameData, type ProfileMode, type Scenario } from "../../../simulator";
import { Avatar } from "../../flows/FlowControls";
import { StatusBox } from "../../flows/FlowDetailSections";
import { FlowMarkdown } from "../../flows/FlowMarkdown";
import { DiscordIcon, useToast } from "../../ui";
import { Card, LinkButton } from "../../ui/Card";
import { KitButton, KitInput, KitLabel, KitTextarea, Pill } from "../../ui/kit";
import { Dropdown, MenuItem } from "../../ui/Popover";
import { surface } from "../../ui/surface";
import { NumberInput } from "../controls";
import { KindTestCard, type TestState } from "../SubmitFlowDialog";
import { clearSubmitDraft, loadSubmitDraft, saveSubmitDraft } from "../submitDraft";
import { useLeaderboardRules } from "./useLeaderboardRules";

// The simulator's Leaderboard tab: everything about getting a flow on the leaderboard in one place
// (docs/design-system patterns: a results tab of Cards). Left: the board's rules (status, Apply,
// Watch from nothing) and the local test. Right: the submission (login, title, description,
// cycles, readiness, Submit). The Share menu's "Submit…" and the command bar's Submit button open
// this tab. The old SubmitFlowDialog body (SubmitFlowPanel) stays for its SSR tests.

const DATA = defaultGameData();
/** Local test options (remembered in localStorage). The server runs 5 secret seeds at every tier and frequency. */
type TestBoards = "both" | "ironman" | "normal";
interface TestOptions {
  seeds: number;
  tier: TierId;
  /** Online every N cycles; null = the rules' frequency. */
  every: number | null;
  boards: TestBoards;
}
const TEST_OPTIONS_KEY = "skyshards-leaderboard-test";
const SEED_CHOICES = [1, 3, 5, 10] as const;
const DEFAULT_TEST: TestOptions = { seeds: 3, tier: "max", every: null, boards: "both" };
function loadTestOptions(): TestOptions {
  try {
    const v = JSON.parse(localStorage.getItem(TEST_OPTIONS_KEY) ?? "null") as Partial<TestOptions> | null;
    if (!v) return DEFAULT_TEST;
    return {
      seeds: SEED_CHOICES.includes(v.seeds as (typeof SEED_CHOICES)[number]) ? (v.seeds as number) : DEFAULT_TEST.seeds,
      tier: TIERS.includes(v.tier as TierId) ? (v.tier as TierId) : "max",
      every: typeof v.every === "number" && EVERY.includes(v.every) ? v.every : null,
      boards: v.boards === "ironman" || v.boards === "normal" ? v.boards : "both",
    };
  } catch {
    return DEFAULT_TEST;
  }
}
const BOARD_LABEL: Record<TestBoards, string> = { both: "Every board", ironman: "Ironman only", normal: "Normal only" };
const TEST_CELL_KINDS: Record<RunKind, CellKind[]> = { ironman: ["ironman", "ironman_kit"], normal: ["normal"] };

/** The last local test, kept while the page is open (switching tabs or watching from nothing keeps it). */
let lastTest: { key: string; test: TestState } | null = null;
const testKey = (payload: string, cycles: number) => `${cycles}|${payload}`;

export const LeaderboardTab: React.FC<{
  scenario: Scenario;
  onChange: (sc: Scenario) => void;
  profile: ProfileMode;
  /** Show "from nothing" (the builder, then the flow), online every N cycles. */
  onWatchFromNothing?: (every: number) => void;
  /** A from-nothing preview is open or being prepared. */
  watching?: boolean;
}> = ({ scenario, onChange, profile, onWatchFromNothing, watching }) => {
  const { toast } = useToast();
  const rules = useLeaderboardRules(scenario, onChange, profile);
  const { user, loading: authLoading, banned, login, logout } = useAuth();
  const bazaar = useBazaarPrices(false);

  // Entry fields, kept in sessionStorage across the Discord login redirect.
  const [draft] = useState(loadSubmitDraft);
  const [title, setTitle] = useState(draft?.title ?? "");
  const [description, setDescription] = useState(draft?.description ?? "");
  const [preview, setPreview] = useState(false);
  const [cycles, setCycles] = useState(draft && Number.isFinite(draft.cycles) ? clampCycles(draft.cycles) : DEFAULT_CYCLES);
  const [submitted, setSubmitted] = useState<{ id: string; status: string } | null>(null);
  useEffect(() => {
    if (!submitted) saveSubmitDraft({ title, description, cycles });
  }, [title, description, cycles, submitted]);

  const submission = useMemo(() => submissionFromScenario(scenario), [scenario]);
  const submissionJson = useMemo(() => JSON.stringify(submission), [submission]);
  const check = useMemo(() => checkSubmission(submission, DATA), [submission]);

  // ---- Local test (every board, like the server) -------------------------------------------
  const [test, setTest] = useState<TestState | null>(() => (lastTest && !lastTest.test.running ? lastTest.test : null));
  // The flow the test ran on: a later edit makes the result stale (shown, but marked).
  const [testedKey, setTestedKey] = useState<string | null>(() => lastTest?.key ?? null);
  useEffect(() => {
    if (test && !test.running && testedKey) lastTest = { key: testedKey, test };
  }, [test, testedKey]);
  const [opts, setOpts] = useState<TestOptions>(() => (typeof localStorage === "undefined" ? DEFAULT_TEST : loadTestOptions()));
  const setOpt = <K extends keyof TestOptions>(k: K, v: TestOptions[K]) =>
    setOpts((o) => {
      const next = { ...o, [k]: v };
      try {
        localStorage.setItem(TEST_OPTIONS_KEY, JSON.stringify(next));
      } catch {
        // Private mode: options just aren't remembered.
      }
      return next;
    });
  const testEvery = opts.every ?? rules.every;
  const serverLike = opts.seeds >= 3 && opts.tier === "max" && opts.boards === "both";
  const pool = useRef<LocalTestPool | null>(null);
  useEffect(() => () => pool.current?.cancel(), []);
  const stale = !!test && !test.running && testedKey !== testKey(submissionJson, test.cycles);
  const runTest = async () => {
    pool.current?.cancel();
    const p = new LocalTestPool();
    pool.current = p;
    const kinds: RunKind[] = opts.boards === "both" ? ["ironman", "normal"] : [opts.boards];
    const seeds = kinds.map(() => randomSeeds(opts.seeds));
    const len = clampCycles(cycles);
    const every = testEvery;
    const tier = opts.tier;
    setTestedKey(testKey(submissionJson, len));
    setTest({ running: true, every, cycles: len, tier, kinds: kinds.map((runKind, i) => ({ runKind, progress: seeds[i].map(() => 0), outcomes: seeds[i].map(() => undefined) })), error: null });
    const patch = (k: number, f: (t: TestState["kinds"][number]) => TestState["kinds"][number]) => setTest((t) => (t ? { ...t, kinds: t.kinds.map((x, j) => (j === k ? f(x) : x)) } : t));
    try {
      for (const [k, runKind] of kinds.entries()) {
        await p.run(
          { submission, runKind, tier, every, cycles: len, wallMs: WALL_MS_BACKSTOP },
          seeds[k],
          {
            onProgress: (i, f) => patch(k, (t) => ({ ...t, progress: t.progress.map((x, j) => (j === i ? f : x)) })),
            onSeed: (i, o) => patch(k, (t) => ({ ...t, outcomes: t.outcomes.map((x, j) => (j === i ? o : x)) })),
          },
          runKind === "ironman" ? [true] : []
        );
      }
      setTest((t) => (t ? { ...t, running: false } : t));
    } catch (e) {
      if (e instanceof Error && e.message === "cancelled") return;
      setTest((t) => (t ? { ...t, running: false, error: e instanceof Error ? e.message : String(e) } : t));
    }
  };
  const stopTest = () => {
    pool.current?.cancel();
    setTest((t) => (t ? { ...t, running: false, error: "Stopped." } : t));
  };
  const cards = useMemo(
    () => (test ? test.kinds.flatMap((k) => TEST_CELL_KINDS[k.runKind].map((kind) => ({ test: k, kind, summary: localKindSummary(DATA, k.outcomes, kind, bazaar.quotes ?? {}, bazaar.pricing) }))) : []),
    [test, bazaar.quotes, bazaar.pricing]
  );
  const tested = !!test && !test.running && !test.error && cards.length > 0 && cards.every((c) => c.summary.failed.length === 0);
  const testFailed = cards.some((c) => c.summary.failed.length > 0);

  // ---- Submit --------------------------------------------------------------------------------
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<{ message: string; errors: string[] } | null>(null);
  const titleOk = title.trim().length > 0 && title.trim().length <= TITLE_MAX;
  const canSubmit = !!user && check.ok && titleOk && description.length <= DESCRIPTION_MAX && !submitting;
  const startLogin = () => {
    // Come back to this tab after the Discord redirect (the page reads the flag).
    saveSubmitDraft({ title, description, cycles, reopen: true });
    login("/simulator");
  };
  const submit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await submitFlow({ title: title.trim(), description, cycles: clampCycles(cycles), payload: submissionFile(submission) });
      setSubmitted(res);
      clearSubmitDraft();
      toast({ title: "Submitted", description: "The server is verifying your flow now.", variant: "success" });
    } catch (e) {
      const errors = e && typeof e === "object" && "errors" in e && Array.isArray((e as { errors: unknown }).errors) ? (e as { errors: string[] }).errors : [];
      setSubmitError({ message: e instanceof Error ? e.message : String(e), errors });
    } finally {
      setSubmitting(false);
    }
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Link copied", variant: "success" });
    } catch {
      toast({ title: "Could not copy", description: text, variant: "warning" });
    }
  };

  const apply = () => {
    const before = rules.apply();
    toast({
      id: "simulator-rules-applied",
      title: `Applied the ${rules.board} rules`,
      description: `Online every ${rules.every} cycle${rules.every === 1 ? "" : "s"}, a new random seed. Your flows are unchanged.`,
      variant: "success",
      duration: 6000,
      action: { label: "Undo", onClick: () => onChange(before) },
    });
  };

  const noPrices = !bazaar.prices;
  const plots = check.plots;

  return (
    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]" data-testid="leaderboard-tab">
      <div className="min-w-0 space-y-5">
        {/* The board's rules */}
        <Card
          title="Leaderboard rules"
          meta={`${rules.board} board`}
          hint={
            <>
              <p>
                The server measures every flow with wiki-maximum player stats, default advanced settings, an empty starting inventory and the player online every N
                cycles, on every board. These rules follow the Ironman / Normal switch at the top.
              </p>
              <p className="mt-2">
                <b>Ironman</b> is ranked from nothing: the site&apos;s builder makes your flow&apos;s starting items first, then your flow runs from exactly those.
                Ironman runs get unlimited Dead Plants and Fermento. <b>Normal</b> buys what it&apos;s short of on the Bazaar.
              </p>
            </>
          }
          hintWidth={340}
          actions={
            rules.on ? (
              <Pill tone="emerald">
                <Check /> Matching
              </Pill>
            ) : (
              <Pill tone="amber">
                {rules.differences.length} difference{rules.differences.length === 1 ? "" : "s"}
              </Pill>
            )
          }
          label="Leaderboard rules"
        >
          <div data-testid="leaderboard-rules">
            {rules.on ? (
              <p className="mb-3 text-[12px] text-slate-400">Your simulator runs under the server&apos;s set-up, so the numbers at the top are comparable to the {rules.board} board.</p>
            ) : (
              <ul className="mb-3 list-disc space-y-0.5 pl-5 text-[12.5px] text-amber-200/90" data-testid="rules-diff">
                {rules.differences.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12.5px] text-slate-400">Online every</span>
              <Dropdown label="Online every" button={<span className="tabular-nums">{`${rules.every} cycle${rules.every === 1 ? "" : "s"}`}</span>} width={160}>
                {(close) =>
                  EVERY.map((n) => (
                    <MenuItem
                      key={n}
                      checked={n === rules.every}
                      onSelect={() => {
                        rules.setEvery(n);
                        close();
                      }}
                    >
                      {n} cycle{n === 1 ? "" : "s"}
                    </MenuItem>
                  ))
                }
              </Dropdown>
              <span className="flex-1" />
              <KitButton onClick={apply} title={rules.differences.length ? `Changes: ${rules.differences.join("; ")}` : "Already under the rules; re-rolls the seed"}>
                <Trophy /> Apply {rules.board} rules
              </KitButton>
              {rules.kind !== "normal" && onWatchFromNothing && (
                <KitButton onClick={() => onWatchFromNothing(rules.every)} disabled={watching} title="Watch the site's builder make this flow's starting items, then your flow run from exactly those. Your flows stay as they are.">
                  <Eye /> Watch from nothing
                </KitButton>
              )}
            </div>
          </div>
        </Card>

        {/* Local test */}
        <Card
          title="Test like the server"
          meta={serverLike ? "Same set-up as the server, in this browser" : "Custom set-up: the server's numbers will differ"}
          hint={
            <>
              Runs your flow the way the server does: Ironman (with the starting items, then from nothing: the builder makes them first), then Normal, in this browser.
              The server ranks at max stats with 5 secret seeds at every online frequency; change the options to check a lower stat tier, another frequency or more
              seeds. Your seeds are random, so numbers differ a little from the server&apos;s.
              {noPrices ? " No Bazaar prices are cached: switch the simulator to Normal once to fetch them, or the Normal number counts items as unpriced." : ""}
            </>
          }
          hintWidth={340}
          actions={
            test?.running ? (
              <KitButton variant="danger" onClick={stopTest}>
                <Square /> Stop
              </KitButton>
            ) : (
              <KitButton variant="accent" onClick={() => void runTest()} disabled={!check.ok} title={!check.ok ? "Fix the flow's errors first (see Submit)" : undefined}>
                <Play /> {test ? "Test again" : "Run test"}
              </KitButton>
            )
          }
        >
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="test-options">
            <Option label="Seeds" value={`${opts.seeds}`} title="More seeds = a steadier average and a better read on the spread (the server rejects a spread over its limit on Normal)">
              {(close) =>
                SEED_CHOICES.map((n) => (
                  <MenuItem key={n} checked={opts.seeds === n} onSelect={() => (setOpt("seeds", n), close())} hint={n === 5 ? "Like the server" : n >= 10 ? "Slower" : undefined}>
                    {n} seed{n === 1 ? "" : "s"}
                  </MenuItem>
                ))
              }
            </Option>
            <Option label="Stats" value={TIER_LABEL[opts.tier]} title="Player-stat tier the run uses (the server ranks at Max and also measures the other tiers)">
              {(close) =>
                TIERS.map((tier) => (
                  <MenuItem key={tier} checked={opts.tier === tier} onSelect={() => (setOpt("tier", tier), close())} hint={tier === "max" ? "The ranking" : undefined}>
                    {TIER_LABEL[tier]}
                  </MenuItem>
                ))
              }
            </Option>
            <Option label="Online every" value={`${testEvery} cycle${testEvery === 1 ? "" : "s"}`} title="Online frequency of the test (defaults to the one in Leaderboard rules)">
              {(close) => (
                <>
                  <MenuItem checked={opts.every === null} onSelect={() => (setOpt("every", null), close())} hint={`Currently ${rules.every}`}>
                    Same as the rules
                  </MenuItem>
                  {EVERY.map((n) => (
                    <MenuItem key={n} checked={opts.every === n} onSelect={() => (setOpt("every", n), close())}>
                      {n} cycle{n === 1 ? "" : "s"}
                    </MenuItem>
                  ))}
                </>
              )}
            </Option>
            <Option label="Boards" value={BOARD_LABEL[opts.boards]} title="Which boards to run (Ironman gives both from nothing and with the starting items)">
              {(close) =>
                (["both", "ironman", "normal"] as const).map((b) => (
                  <MenuItem key={b} checked={opts.boards === b} onSelect={() => (setOpt("boards", b), close())}>
                    {BOARD_LABEL[b]}
                  </MenuItem>
                ))
              }
            </Option>
            <span className="text-[12px] tabular-nums text-slate-500">{clampCycles(cycles).toLocaleString("en-US")} cycles (from Submit)</span>
            {!serverLike && (
              <LinkButton onClick={() => (setOpts(DEFAULT_TEST), localStorage.removeItem(TEST_OPTIONS_KEY))} className="ml-auto">
                Reset to server set-up
              </LinkButton>
            )}
          </div>
          {test ? (
            <div className="space-y-2" data-testid="seed-test">
              {(test.tier ?? "max") !== "max" || test.every !== rules.every ? (
                <p className="text-[12px] text-slate-500">
                  Tested at {TIER_LABEL[test.tier ?? "max"]} stats, online every {test.every} cycle{test.every === 1 ? "" : "s"}.
                </p>
              ) : null}
              <div className={`grid grid-cols-1 gap-2 ${cards.length > 2 ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
                {cards.map((c) => (
                  <KindTestCard
                    key={c.kind}
                    test={c.test}
                    kind={c.kind}
                    summary={c.summary}
                    noPrices={noPrices}
                    kitPerDay={cards.find((x) => x.kind === "ironman_kit")?.summary.profitPerDay ?? null}
                    onWatch={onWatchFromNothing ? () => onWatchFromNothing(test.every) : undefined}
                  />
                ))}
              </div>
              {testFailed && <p className="text-[12px] text-red-300">A failed seed makes the server reject the submission.</p>}
              {test.error && <p className="text-[12px] text-red-300">{test.error}</p>}
              {stale && <p className="text-[12px] text-amber-200/90">The flow changed since this test. Test again for current numbers.</p>}
            </div>
          ) : (
            <div className="grid place-items-center rounded-lg border border-dashed border-slate-700/60 px-6 py-6 text-center">
              <div className="text-[13px] text-slate-300">Not tested yet</div>
              <p className="mt-1 max-w-sm text-[12px] text-slate-500">Run the test to see what each board will measure: from nothing, with the starting items, and Normal.</p>
            </div>
          )}
        </Card>
      </div>

      {/* Submit */}
      <Card title="Submit to the leaderboard" label="Submit to the leaderboard" hint="Your plots with every step, layout, exit, policy override and script. The server sets everything else (empty starting inventory, default advanced settings, its own stat tiers and secret seeds) at every online frequency. Your flow goes on every board: Ironman from nothing, Ironman with the starting items, and Normal." hintWidth={340} className="xl:sticky xl:top-[calc(var(--sim-sticky,150px)+12px)]">
        {submitted ? (
          <div className="space-y-3">
            <p className="flex items-start gap-2 text-[13px] text-emerald-200">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> &quot;{title.trim()}&quot; is in the queue for every board. It goes live when the server has simulated it.
            </p>
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <a href={`/flows/${submitted.id}`} className="break-all text-slate-200 underline decoration-slate-600 underline-offset-[3px] hover:decoration-slate-300">
                {flowLink(submitted.id)}
              </a>
              <KitButton onClick={() => void copy(flowShareLink(submitted.id))}>
                <Link2 /> Copy link
              </KitButton>
            </div>
            <StatusBox id={submitted.id} initial={submitted.status} />
            <p className="text-[12px] text-slate-500">You can leave this page: the server finishes the verification on its own.</p>
            <LinkButton
              onClick={() => {
                setSubmitted(null);
                setTitle("");
                setDescription("");
              }}
            >
              Submit another flow
            </LinkButton>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[12px] text-slate-400">
              {plots} plot{plots === 1 ? "" : "s"} · {Math.ceil(check.bytes / 1024)} KB · goes on every board
            </p>

            {/* Account */}
            {authLoading ? (
              <p className="text-[12px] text-slate-500">Checking your login…</p>
            ) : user ? (
              <div className={`flex items-center gap-2 px-3 py-2 text-[12.5px] ${surface.well}`}>
                <Avatar id={user.id} avatar={user.avatar} size={22} />
                <span className="min-w-0 truncate text-slate-400">
                  Logged in as <b className="font-semibold text-slate-100">{userName(user)}</b>
                </span>
                <KitButton variant="ghost" className="ml-auto" onClick={logout}>
                  <LogOut /> Log out
                </KitButton>
              </div>
            ) : (
              <div className={`space-y-2 px-3 py-2.5 ${surface.well}`} data-testid="login-required">
                <p className="text-[12.5px] text-slate-200">Log in with Discord to submit. Your entry is kept while you log in.</p>
                {banned && <p className="text-[12px] text-red-300">This account is banned from the leaderboard.</p>}
              </div>
            )}

            <label className="block space-y-1">
              <span className="flex justify-between text-[12px] text-slate-400">
                Title
                <span className={`tabular-nums ${title.length > TITLE_MAX ? "text-red-300" : "text-slate-600"}`}>
                  {title.length} / {TITLE_MAX}
                </span>
              </span>
              <KitInput className="w-full" maxLength={TITLE_MAX} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Chloronite farm, easy to run" aria-label="Title" />
            </label>

            <div className="space-y-1">
              <div className="flex items-center justify-between text-[12px] text-slate-400">
                <span>
                  Description <span className="text-slate-600">optional · Markdown</span>
                </span>
                <LinkButton onClick={() => setPreview((p) => !p)} aria-pressed={preview} className="inline-flex items-center gap-1">
                  {preview ? <Pencil className="h-3 w-3" /> : <Eye className="h-3 w-3" />} {preview ? "Edit" : "Preview"}
                </LinkButton>
              </div>
              {preview ? (
                <div className={`min-h-[7rem] p-3 ${surface.well}`}>{description.trim() ? <FlowMarkdown text={description} /> : <span className="text-[12px] text-slate-500">Nothing to preview.</span>}</div>
              ) : (
                <KitTextarea className="h-28 w-full" maxLength={DESCRIPTION_MAX} value={description} onChange={(e) => setDescription(e.target.value)} aria-label="Description" placeholder="How it works, when to log in, what to watch out for…" />
              )}
              <div className="flex justify-between gap-3 text-[11px] text-slate-600">
                <span data-testid="newline-hint">Leave an empty line for a new paragraph; end a line with \ to break it.</span>
                <span className="shrink-0 tabular-nums">
                  {description.length} / {DESCRIPTION_MAX}
                </span>
              </div>
            </div>

            <label className="flex items-center gap-2 text-[12px] text-slate-400" title="The score averages a secret window just after this length.">
              Cycles
              <NumberInput
                integer
                step={500}
                min={MIN_CYCLES}
                max={MAX_CYCLES}
                value={cycles}
                onChange={setCycles}
                aria-label="Cycles"
                className="h-8 w-24 rounded-lg border border-slate-700/60 bg-slate-950/50 px-2.5 text-right text-[13px] tabular-nums text-slate-100 focus:border-emerald-500/60 focus:outline-none"
              />
              <span className="text-slate-600 tabular-nums">
                {MIN_CYCLES.toLocaleString("en-US")}–{MAX_CYCLES.toLocaleString("en-US")}
              </span>
            </label>

            {/* Readiness */}
            <div className="space-y-1 pt-1">
              <KitLabel>Ready?</KitLabel>
              <Ready ok={check.ok} label={check.ok ? "The flow is valid" : "The flow has errors"} />
              {check.errors.length > 0 && (
                <ul className="space-y-0.5 pl-6 text-[12px] text-red-300" data-testid="submit-errors">
                  {check.errors.map((e, i) => (
                    <li key={i} className="break-words">
                      {e}
                    </li>
                  ))}
                </ul>
              )}
              {check.warnings.length > 0 && (
                <details className="group pl-6 text-[12px] text-amber-200/90">
                  <summary className="cursor-pointer list-none text-amber-200 hover:text-amber-100 [&::-webkit-details-marker]:hidden">
                    {check.warnings.length} warning{check.warnings.length === 1 ? "" : "s"} (won&apos;t block submitting) <span className="text-slate-500 group-open:hidden">· show</span>
                  </summary>
                  <ul className="mt-1 space-y-1">
                    {check.warnings.map((e, i) => (
                      <li key={i} className="break-words">
                        {e}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <Ready ok={rules.on} warn label={rules.on ? `Under the ${rules.board} rules` : `Not under the ${rules.board} rules (your numbers may differ from the server's)`} />
              <Ready ok={tested} warn={!testFailed} muted={!test} label={tested ? (stale ? "Tested (before your last change)" : "Tested locally") : testFailed ? "A test seed failed" : "Not tested locally (optional)"} />
              <Ready ok={titleOk} muted={!title} label={titleOk ? "Has a title" : "Needs a title"} />
            </div>

            {submitError && (
              <div className="space-y-1 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-200" role="alert">
                <div className="break-words font-medium">{submitError.message}</div>
                {submitError.errors.length > 1 && (
                  <ul className="list-disc pl-5">
                    {submitError.errors.map((e, i) => (
                      <li key={i} className="break-words">
                        {e}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {!user && !authLoading ? (
              <button
                type="button"
                onClick={startLogin}
                className="flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-[#5865F2] text-[13.5px] font-semibold text-white transition-[background-color,transform] duration-150 ease-snappy hover:bg-[#4752c4] active:scale-[0.98]"
              >
                <DiscordIcon className="h-4 w-4" /> Log in with Discord to submit
              </button>
            ) : (
              <KitButton variant="primary" size="md" className="h-10 w-full text-[13.5px]" onClick={() => void submit()} disabled={!canSubmit} title={!check.ok ? "Fix the errors above first" : !titleOk ? "Give it a title" : undefined}>
                <Trophy /> {submitting ? "Submitting…" : "Submit to leaderboard"}
              </KitButton>
            )}
          </div>
        )}
      </Card>
    </div>
  );
};

/** A labelled option that opens a menu ("Seeds [3 ▾]"). */
const Option: React.FC<{ label: string; value: string; title?: string; children: (close: () => void) => React.ReactNode }> = ({ label, value, title, children }) => (
  <span className="inline-flex items-center gap-1.5 text-[12px] text-slate-500" title={title}>
    {label}
    <Dropdown label={label} button={<span className="tabular-nums">{value}</span>} width={200}>
      {children}
    </Dropdown>
  </span>
);

/** One readiness line: a tick, a warning or a cross. */
const Ready: React.FC<{ ok: boolean; warn?: boolean; muted?: boolean; label: string }> = ({ ok, warn, muted, label }) => (
  <div className={`flex items-start gap-2 text-[12.5px] ${ok ? "text-emerald-300" : muted ? "text-slate-500" : warn ? "text-amber-200" : "text-red-300"}`}>
    {ok ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : warn || muted ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-80" /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
    <span>{label}</span>
  </div>
);
