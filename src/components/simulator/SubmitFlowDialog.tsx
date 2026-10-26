import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Dices, Eye, Link2, LogOut, Pencil, Send, Trophy } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { useBazaarPrices } from "../../hooks/useBazaarPrices";
import { useProfileMode } from "../../hooks/useProfileMode";
import { applyRules, checkSubmission, clampCycles, DEFAULT_CYCLES, MAX_CYCLES, MIN_CYCLES, ruleDifferences, RUN_KIND_BOARD, RUN_KINDS, submissionFile, submissionFromScenario, type RunKind } from "../../leaderboard/rules";
import { nearestEvery } from "../../leaderboard/tiers";
import { WALL_MS_BACKSTOP } from "../../leaderboard/verify";
import {
  cantStartText,
  DESCRIPTION_MAX,
  kitSummaryText,
  localKindSummary,
  OUTLIER_RATIO,
  ratioText,
  RUN_KIND_LABEL,
  scenarioRunKind,
  starvedList,
  starvedText,
  startItemsText,
  STALL_CELLS,
  TITLE_MAX,
  upkeepText,
  usedUpLines,
  userName,
  type LocalKindSummary,
} from "../../leaderboard/view";
import { LocalTestPool, randomSeeds, type SeedOutcome } from "../../leaderboard/worker/pool";
import { flowLink, submitFlow } from "../../services/flowsService";
import { defaultGameData, type Scenario } from "../../simulator";
import { Avatar } from "../flows/FlowControls";
import { StatusBox } from "../flows/FlowDetailSections";
import { FlowMarkdown } from "../flows/FlowMarkdown";
import { DialogFrame, ModalDialog } from "../ui/ModalDialog";
import { DiscordIcon, useToast } from "../ui";
import { CheckboxField, NumberInput } from "./controls";
import { formatCoins, nameOf } from "./format";
import { buttonClass, inputClass } from "./styles";
import { clearSubmitDraft, loadSubmitDraft, saveSubmitDraft } from "./submitDraft";

const DATA = defaultGameData();
/** Seeds per run kind in the local test (the server uses 5 at the max tier). */
const TEST_SEEDS = 3;
/** The server's wall-clock backstop (the deciding cap is the deterministic script step cap, applied by runOnce). */
const WALL_MS = WALL_MS_BACKSTOP;

type Props = { scenario: Scenario; onChange: (sc: Scenario) => void; onClose: () => void };

export const SubmitFlowDialog: React.FC<Props> = (props) => (
  <ModalDialog labelledBy="submit-flow-title" onClose={props.onClose} maxWidth="max-w-2xl">
    <SubmitFlowPanel {...props} />
  </ModalDialog>
);

const Section: React.FC<{ title: React.ReactNode; children: React.ReactNode }> = ({ title, children }) => (
  <section className="space-y-2">
    <h3 className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{title}</h3>
    {children}
  </section>
);

const DISCORD_BUTTON = "px-3 py-1.5 rounded-md text-xs font-medium bg-[#5865F2]/80 hover:bg-[#5865F2] text-white flex items-center gap-1.5 cursor-pointer";

const LoginBox: React.FC<{ onLogin: () => void }> = ({ onLogin }) => {
  const { user, loading, banned, logout } = useAuth();
  if (loading) return <p className="text-xs text-slate-400">Checking your login...</p>;
  if (user)
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Avatar id={user.id} avatar={user.avatar} size={24} />
        <span className="text-slate-200">
          Logged in as <b>{userName(user)}</b>
        </span>
        <button type="button" className={`${buttonClass.neutral} ml-auto`} onClick={logout}>
          <LogOut className="w-3.5 h-3.5" /> Log out
        </button>
      </div>
    );
  return (
    <div className="rounded-md border border-[#5865F2]/50 bg-[#5865F2]/10 p-2.5 space-y-2" data-testid="login-required">
      <p className="text-xs text-slate-100">
        <b>You need to log in with Discord to submit.</b>
      </p>
      {banned && <p className="text-xs text-red-300">This account is banned from the leaderboard.</p>}
      <button type="button" className={DISCORD_BUTTON} onClick={onLogin}>
        <DiscordIcon className="w-4 h-4" /> Log in with Discord
      </button>
      <p className="text-[11px] text-slate-400">Only your Discord name and avatar are used (the account must be at least 30 days old). Your flows stay in this browser until you submit.</p>
    </div>
  );
};

/** One run kind of the local test. */
export interface KindTest {
  runKind: RunKind;
  progress: number[];
  outcomes: (SeedOutcome | undefined)[];
}

export interface TestState {
  running: boolean;
  every: number;
  cycles: number;
  kinds: KindTest[];
  error: string | null;
}

/** What one run kind of the test found (the server builds its cell the same way). */
export const KindTestCard: React.FC<{ test: KindTest; summary: LocalKindSummary; noPrices: boolean }> = ({ test, summary, noPrices }) => {
  const board = RUN_KIND_BOARD[test.runKind];
  const running = summary.done < summary.total;
  const progress = test.progress.reduce((s, x) => s + x, 0) / Math.max(1, test.progress.length);
  const cell = summary.cell;
  const starved = cell ? starvedList(cell.starved).slice(0, 3) : [];
  const used = cell ? usedUpLines(cell.usedUp) : [];
  return (
    <div className="space-y-1.5 rounded-md border border-slate-700/60 bg-slate-900/40 p-2.5 text-xs" data-testid={`test-${test.runKind}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium text-slate-200">{RUN_KIND_LABEL[test.runKind]}</span>
        {running ? (
          <span className="text-[11px] text-slate-500 tabular-nums">
            {summary.done}/{summary.total} seeds
          </span>
        ) : summary.cantStart ? (
          <span className="text-sm font-semibold text-slate-400" title={summary.profitPerDay !== null ? `${formatCoins(summary.profitPerDay)} / day, but it isn't ranked on this board` : undefined}>
            Can't start
          </span>
        ) : summary.profitPerDay !== null ? (
          <span className={`text-sm font-semibold tabular-nums ${summary.profitPerDay < 0 ? "text-red-300" : "text-amber-300"}`}>
            {formatCoins(summary.profitPerDay)}
            <span className="ml-1 text-[11px] font-normal text-slate-500">/ day{board === "normal" && noPrices ? " (no prices)" : ""}</span>
          </span>
        ) : (
          <span className="text-red-300">—</span>
        )}
      </div>
      {running && (
        <div className="h-1.5 overflow-hidden rounded bg-slate-700/60">
          <div className="h-full bg-emerald-500/60 transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
      {summary.failed.map((f) => (
        <p key={f.seed} className="break-words text-red-300">
          Seed {f.seed} failed: {f.error}
        </p>
      ))}
      {summary.ratio !== null && (
        <p className={summary.ratio > OUTLIER_RATIO ? "flex items-start gap-1 text-red-300" : "text-slate-400"}>
          {summary.ratio > OUTLIER_RATIO && <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />}
          Spread (best / median): {ratioText(summary.ratio)}
          {summary.ratio > OUTLIER_RATIO ? `: over ${OUTLIER_RATIO}×, the server would reject this as inconsistent across seeds.` : ""}
        </p>
      )}
      {summary.cantStart && (
        <p className="text-amber-200" data-testid="test-cant-start">
          Can't start from nothing: {cantStartText(summary.cantStart).replace(/^Never/, "never")}. It is listed apart on the "from nothing" board and ranked on "with
          starting items".
        </p>
      )}
      {cell && test.runKind === "borrow" && (
        <div className="space-y-0.5 text-slate-400">
          <p className="text-slate-200">{kitSummaryText(cell)}</p>
          <p>
            To start with: <span className="text-slate-200">{startItemsText(cell.startItems)}</span>
          </p>
          <p>
            Then per day: <span className={upkeepText(cell.upkeep) === "None" ? "text-emerald-300" : "text-amber-300"}>{upkeepText(cell.upkeep) === "None" ? "nothing" : upkeepText(cell.upkeep)}</span>
          </p>
          {used.length > 0 && <p>Used up once: {used.map((u) => `${u.units.toLocaleString("en-US")} ${nameOf(u.item)}`).join(", ")}</p>}
        </div>
      )}
      {cell?.slowing && <p className="text-orange-200">Production falls off at the end of the run; the server scores it at its last-20% rate.</p>}
      {starved.length > 0 && (
        <ul className="space-y-0.5">
          {starved.map((e) => (
            <li key={`${e.plot}|${e.step}|${e.item}`} className={e.cells >= STALL_CELLS ? "text-amber-300" : "text-slate-400"}>
              {starvedText(e)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

/** The dialog body (no portal), so SSR tests can render it. `initialTest` shows a finished test (SSR tests). */
export const SubmitFlowPanel: React.FC<Props & { initialTest?: TestState }> = ({ scenario, onChange, onClose, initialTest }) => {
  const { toast } = useToast();
  const { user, loading: authLoading, login } = useAuth();
  const [profile] = useProfileMode();
  const bazaar = useBazaarPrices(false);
  // Restored from the draft (kept across the Discord login redirect), else the defaults.
  const [draft] = useState(loadSubmitDraft);
  const [title, setTitle] = useState(draft?.title ?? "");
  const [description, setDescription] = useState(draft?.description ?? "");
  const [preview, setPreview] = useState(false);
  const [cycles, setCycles] = useState(draft && Number.isFinite(draft.cycles) ? clampCycles(draft.cycles) : DEFAULT_CYCLES);
  const [testNormal, setTestNormal] = useState(false);
  const [test, setTest] = useState<TestState | null>(initialTest ?? null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<{ message: string; errors: string[] } | null>(null);
  const [submitted, setSubmitted] = useState<{ id: string; status: string } | null>(null);
  const pool = useRef<LocalTestPool | null>(null);
  useEffect(() => () => pool.current?.cancel(), []);
  useEffect(() => {
    if (!submitted) saveSubmitDraft({ title, description, cycles });
  }, [title, description, cycles, submitted]);
  const startLogin = () => {
    saveSubmitDraft({ title, description, cycles, reopen: true });
    login("/simulator");
  };

  // The rules to compare with and apply: the run kind the simulator looks like now.
  const [rulesKind, setRulesKind] = useState<RunKind>(() => scenarioRunKind({ ...scenario.settings, profile }));
  const every = scenario.settings.activity.kind === "everyN" ? nearestEvery(scenario.settings.activity.n) : 1;
  const submission = useMemo(() => submissionFromScenario(scenario), [scenario]);
  const check = useMemo(() => checkSubmission(submission, DATA), [submission]);
  // The profile is site-wide (not in the scenario), so the diff compares everything else.
  const differences = useMemo(() => {
    const withKind: Scenario = { ...scenario, settings: { ...scenario.settings } };
    if (rulesKind === "normal") withKind.settings.profile = "normal";
    else delete withKind.settings.profile;
    return ruleDifferences(withKind, rulesKind);
  }, [scenario, rulesKind]);

  const apply = () => {
    const before = scenario;
    const ruled = applyRules(scenario, rulesKind, every, Math.floor(Math.random() * 2 ** 31));
    const next: Scenario = { ...ruled, settings: { ...ruled.settings } };
    if (scenario.settings.profile) next.settings.profile = scenario.settings.profile;
    else delete next.settings.profile;
    onChange(next);
    toast({
      id: "simulator-rules-applied",
      title: "Applied the leaderboard rules",
      description: `${RUN_KIND_LABEL[rulesKind]} board, online every ${every} cycle${every === 1 ? "" : "s"}, a new random seed.`,
      variant: "success",
      duration: 6000,
      action: { label: "Undo", onClick: () => onChange(before) },
    });
  };

  const runTest = async () => {
    pool.current?.cancel();
    const p = new LocalTestPool();
    pool.current = p;
    const kinds = RUN_KINDS.filter((k) => k !== "normal" || testNormal);
    const seeds = kinds.map(() => randomSeeds(TEST_SEEDS));
    const len = clampCycles(cycles);
    setTest({ running: true, every, cycles: len, kinds: kinds.map((runKind, i) => ({ runKind, progress: seeds[i].map(() => 0), outcomes: seeds[i].map(() => undefined) })), error: null });
    const patch = (k: number, f: (t: KindTest) => KindTest) => setTest((t) => (t ? { ...t, kinds: t.kinds.map((x, j) => (j === k ? f(x) : x)) } : t));
    try {
      // One kind after the other: each already uses every worker the machine has.
      for (const [k, runKind] of kinds.entries()) {
        await p.run({ submission, runKind, tier: "max", every, cycles: len, wallMs: WALL_MS }, seeds[k], {
          onProgress: (i, f) => patch(k, (t) => ({ ...t, progress: t.progress.map((x, j) => (j === i ? f : x)) })),
          onSeed: (i, o) => patch(k, (t) => ({ ...t, outcomes: t.outcomes.map((x, j) => (j === i ? o : x)) })),
        });
      }
      setTest((t) => (t ? { ...t, running: false } : t));
    } catch (e) {
      if (e instanceof Error && e.message === "cancelled") return;
      setTest((t) => (t ? { ...t, running: false, error: e instanceof Error ? e.message : String(e) } : t));
    }
  };

  const summaries = useMemo(
    () => (test ? test.kinds.map((k) => localKindSummary(DATA, k.outcomes, RUN_KIND_BOARD[k.runKind], bazaar.quotes ?? {}, bazaar.pricing)) : []),
    [test, bazaar.quotes, bazaar.pricing]
  );

  const titleOk = title.trim().length > 0 && title.trim().length <= TITLE_MAX;
  const canSubmit = !!user && check.ok && titleOk && description.length <= DESCRIPTION_MAX && !submitting;
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

  if (submitted)
    return (
      <DialogFrame
        id="submit-flow-title"
        title={
          <>
            <Trophy className="w-4 h-4 text-amber-300" /> Submitted
          </>
        }
        onClose={onClose}
        footer={
          <button type="button" className={buttonClass.neutral} onClick={onClose}>
            Close
          </button>
        }
      >
        <div className="flex items-start gap-2 text-sm text-emerald-200">
          <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" /> "{title.trim()}" is in the queue. It goes live when the server has simulated it.
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <a href={`/flows/${submitted.id}`} className="text-emerald-300 hover:underline break-all">
            {flowLink(submitted.id)}
          </a>
          <button type="button" className={buttonClass.neutral} onClick={() => copy(flowLink(submitted.id))}>
            <Link2 className="w-3.5 h-3.5" /> Copy link
          </button>
        </div>
        <StatusBox id={submitted.id} initial={submitted.status} />
        <p className="text-[11px] text-slate-400 leading-relaxed">
          You can close this window, or the tab: the server finishes the verification on its own. Check on it any time from the link above.
        </p>
      </DialogFrame>
    );

  const noPrices = !bazaar.prices;
  return (
    <DialogFrame
      id="submit-flow-title"
      title={
        <>
          <Trophy className="w-4 h-4 text-amber-300" /> Submit to the leaderboard
        </>
      }
      onClose={onClose}
      footer={
        <>
          {!user && !authLoading && <span className="text-[11px] text-slate-400 mr-auto self-center">Your entry is kept while you log in.</span>}
          <button type="button" className={buttonClass.neutral} onClick={onClose}>
            Cancel
          </button>
          {!user && !authLoading ? (
            <button type="button" className={DISCORD_BUTTON} onClick={startLogin}>
              <DiscordIcon className="w-3.5 h-3.5" /> Log in to submit
            </button>
          ) : (
            <button type="button" className={buttonClass.primary} onClick={submit} disabled={!canSubmit} title={!check.ok ? "Fix the errors above first" : !titleOk ? "Give it a title" : undefined}>
              <Send className="w-3.5 h-3.5" /> {submitting ? "Submitting..." : "Submit"}
            </button>
          )}
        </>
      }
    >
      <Section title="Account">
        <LoginBox onLogin={startLogin} />
      </Section>

      <Section title="What gets submitted">
        <p className="text-xs text-slate-400 leading-relaxed">
          Your {check.plots} plot{check.plots === 1 ? "" : "s"} with every step, layout, exit, policy override and script ({Math.ceil(check.bytes / 1024)} KB). The server sets
          everything else: empty starting inventory, default advanced settings, its own stat tiers and secret seeds, at every online frequency.
        </p>
        <p className="text-xs text-slate-400 leading-relaxed">
          Every flow goes on all three boards: <span className="text-slate-300">Ironman · from nothing</span>, <span className="text-slate-300">Ironman · with starting items</span>{" "}
          (it may borrow what it needs to get going; the page lists those items and any upkeep) and <span className="text-slate-300">Normal</span>.
        </p>
        {check.errors.length > 0 && (
          <ul className="rounded-md bg-red-500/10 border border-red-500/30 px-2 py-1.5 text-xs text-red-200 space-y-1" data-testid="submit-errors">
            {check.errors.map((e, i) => (
              <li key={i} className="break-words">
                {e}
              </li>
            ))}
          </ul>
        )}
        {check.warnings.length > 0 && (
          <ul className="rounded-md bg-amber-500/10 border border-amber-500/30 px-2 py-1.5 text-xs text-amber-200 space-y-1">
            {check.warnings.map((e, i) => (
              <li key={i} className="break-words">
                {e}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400" role="group" aria-label="Rules to compare with">
          <span>Compare with</span>
          {RUN_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={rulesKind === k}
              onClick={() => setRulesKind(k)}
              className={`rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                rulesKind === k ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-200" : "border-slate-600/40 text-slate-400 hover:bg-slate-700/50 hover:text-slate-200"
              }`}
            >
              {RUN_KIND_LABEL[k]}
            </button>
          ))}
        </div>
        {differences.length > 0 ? (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-100 space-y-1.5">
            <div>Your simulator settings differ from the {RUN_KIND_LABEL[rulesKind]} rules, so what you see locally may differ from the server:</div>
            <ul className="list-disc pl-5 text-amber-200/90">
              {differences.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
            <button type="button" className={buttonClass.neutral} onClick={apply}>
              <Trophy className="w-3.5 h-3.5" /> Apply the rules here
            </button>
          </div>
        ) : (
          <p className="text-xs text-emerald-300/90 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" /> Your settings match the {RUN_KIND_LABEL[rulesKind]} rules.
          </p>
        )}
        {(profile === "normal") !== (rulesKind === "normal") && (
          <p className="text-[11px] text-slate-400">The simulator is in {profile === "normal" ? "Normal" : "Ironman"} mode; switch it with the toggle at the top of the page to run it like the {RUN_KIND_LABEL[rulesKind]} board.</p>
        )}
      </Section>

      <Section title="Entry">
        <label className="block space-y-1 text-xs text-slate-300">
          <span className="flex justify-between">
            <span>Title</span>
            <span className={title.length > TITLE_MAX ? "text-red-300" : "text-slate-500"}>
              {title.length} / {TITLE_MAX}
            </span>
          </span>
          <input className={`${inputClass} w-full text-sm py-1.5`} maxLength={TITLE_MAX} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Chloronite farm easy to use" />
        </label>
        <div className="space-y-1 text-xs text-slate-300">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>Description (optional; Markdown: **bold**, *italic*, lists, ### headings; no links or images)</span>
            <button type="button" className={buttonClass.neutral} onClick={() => setPreview((p) => !p)} aria-pressed={preview}>
              {preview ? <Pencil className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />} {preview ? "Edit" : "Preview"}
            </button>
          </div>
          {preview ? (
            <div className="min-h-[7rem] rounded-md border border-slate-700 bg-slate-900/40 p-3">{description.trim() ? <FlowMarkdown text={description} /> : <span className="text-slate-500">Nothing to preview.</span>}</div>
          ) : (
            <textarea className={`${inputClass} w-full h-28`} maxLength={DESCRIPTION_MAX} value={description} onChange={(e) => setDescription(e.target.value)} aria-label="Description" placeholder="How it works, when to log in, what to watch out for..." />
          )}
          <div className="flex items-start justify-between gap-3 text-[11px] text-slate-500">
            <span data-testid="newline-hint">
              <b className="font-medium text-slate-400">New lines:</b> pressing Enter once joins the lines back together. Leave an empty line to start a new paragraph, or end a line with a backslash (\) to break
              it there. Check with Preview.
            </span>
            <span className="flex-shrink-0">
              {description.length} / {DESCRIPTION_MAX}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-300">
          <label className="flex items-center gap-2">
            <span>Cycles</span>
            <NumberInput className={`${inputClass} w-24 text-right`} value={cycles} min={MIN_CYCLES} max={MAX_CYCLES} integer step={500} onChange={setCycles} aria-label="Cycles" />
            <span className="text-[11px] text-slate-500">
              {MIN_CYCLES.toLocaleString()}-{MAX_CYCLES.toLocaleString()}
            </span>
          </label>
          <span className="text-[11px] text-slate-500" data-testid="cycles-hint">
            The score averages a secret window just after this length.
          </span>
        </div>
      </Section>

      <Section title="Test locally">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button type="button" className={buttonClass.neutral} onClick={() => void runTest()} disabled={!check.ok || test?.running}>
            <Dices className="w-3.5 h-3.5" /> {test?.running ? "Testing..." : `Test with ${TEST_SEEDS} random seeds per board`}
          </button>
          <CheckboxField label="Normal too" checked={testNormal} onChange={setTestNormal} title={noPrices ? "Priced with Bazaar prices; none are cached yet" : "Priced with your cached Bazaar prices"} />
        </div>
        <p className="text-[11px] text-slate-500">
          From nothing and with starting items{testNormal ? ", then Normal" : ""}: max stats, online every {every} cycle{every === 1 ? "" : "s"}, {clampCycles(cycles).toLocaleString()} cycles plus the end
          window, in this browser.
          {testNormal && noPrices ? " No Bazaar prices are cached: open the simulator in Normal mode once to fetch them, or the Normal number counts items as unpriced." : ""}
        </p>
        {test && (
          <div className="space-y-2" data-testid="seed-test">
            <div className={`grid grid-cols-1 gap-2 ${test.kinds.length > 2 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
              {test.kinds.map((k, i) => (
                <KindTestCard key={k.runKind} test={k} summary={summaries[i]} noPrices={noPrices} />
              ))}
            </div>
            {summaries.some((s) => s.failed.length > 0) && <p className="text-xs text-red-300">A failed seed makes the server reject the submission.</p>}
            {test.error && <p className="text-xs text-red-300">{test.error}</p>}
            <p className="text-[11px] text-slate-500">Your seeds are random; the server uses secret seeds of its own, so its numbers will differ a little.</p>
          </div>
        )}
      </Section>

      {submitError && (
        <div className="rounded-md bg-red-500/10 border border-red-500/30 px-2 py-1.5 text-xs text-red-200 space-y-1" role="alert">
          <div className="font-medium break-words">{submitError.message}</div>
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
    </DialogFrame>
  );
};
