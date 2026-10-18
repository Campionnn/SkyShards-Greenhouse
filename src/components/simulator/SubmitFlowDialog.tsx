import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Dices, Eye, Link2, LogOut, Pencil, Send, Trophy } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { useBazaarPrices } from "../../hooks/useBazaarPrices";
import { useProfileMode } from "../../hooks/useProfileMode";
import { valueResult } from "../../leaderboard/pricing";
import { spreadRatio } from "../../leaderboard/result";
import { applyRules, BOARDS, checkSubmission, clampCycles, DEFAULT_CYCLES, MAX_CYCLES, MIN_CYCLES, ruleDifferences, submissionFile, submissionFromScenario, type Board } from "../../leaderboard/rules";
import { nearestEvery } from "../../leaderboard/tiers";
import { BOARD_LABEL, DESCRIPTION_MAX, effortText, OUTLIER_RATIO, ratioText, TITLE_MAX, userName } from "../../leaderboard/view";
import { LocalTestPool, randomSeeds, type SeedOutcome } from "../../leaderboard/worker/pool";
import { flowLink, submitFlow } from "../../services/flowsService";
import { defaultGameData, type Scenario } from "../../simulator";
import { Avatar } from "../flows/FlowControls";
import { StatusBox } from "../flows/FlowDetailSections";
import { FlowMarkdown } from "../flows/FlowMarkdown";
import { DialogFrame, ModalDialog } from "../flows/ModalDialog";
import { DiscordIcon, useToast } from "../ui";
import { NumberInput } from "./controls";
import { formatCoins } from "./format";
import { buttonClass, inputClass } from "./styles";

const DATA = defaultGameData();
const TEST_SEEDS = 5;
/** The server's per-run cap. */
const WALL_MS = 60_000;

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

const LoginBox: React.FC = () => {
  const { user, loading, banned, login, logout } = useAuth();
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
    <div className="space-y-1.5">
      {banned && <p className="text-xs text-red-300">This account is banned from the leaderboard.</p>}
      <button type="button" className="px-3 py-1.5 rounded-md text-xs font-medium bg-[#5865F2]/80 hover:bg-[#5865F2] text-white flex items-center gap-1.5 cursor-pointer" onClick={() => login("/simulator")}>
        <DiscordIcon className="w-4 h-4" /> Log in with Discord
      </button>
      <p className="text-[11px] text-slate-500">Only your Discord name and avatar are used (the account must be at least 30 days old). Your flows stay in this browser until you submit.</p>
    </div>
  );
};

interface TestState {
  running: boolean;
  board: Board;
  every: number;
  progress: number[];
  outcomes: (SeedOutcome | undefined)[];
  error: string | null;
}

/** The dialog body (no portal), so SSR tests can render it. */
export const SubmitFlowPanel: React.FC<Props> = ({ scenario, onChange, onClose }) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [profile] = useProfileMode();
  const bazaar = useBazaarPrices(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [preview, setPreview] = useState(false);
  const [boards, setBoards] = useState<Board[]>([profile === "normal" ? "normal" : "ironman"]);
  const [cycles, setCycles] = useState(DEFAULT_CYCLES);
  const [test, setTest] = useState<TestState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<{ message: string; errors: string[] } | null>(null);
  const [submitted, setSubmitted] = useState<{ id: string; status: string } | null>(null);
  const pool = useRef<LocalTestPool | null>(null);
  useEffect(() => () => pool.current?.cancel(), []);

  const board: Board = boards[0] ?? "ironman";
  const every = scenario.settings.activity.kind === "everyN" ? nearestEvery(scenario.settings.activity.n) : 1;
  const submission = useMemo(() => submissionFromScenario(scenario), [scenario]);
  const check = useMemo(() => checkSubmission(submission, DATA), [submission]);
  // The profile is site-wide (not in the scenario), so the diff compares everything else.
  const differences = useMemo(() => {
    const withBoard: Scenario = { ...scenario, settings: { ...scenario.settings } };
    if (board === "normal") withBoard.settings.profile = "normal";
    else delete withBoard.settings.profile;
    return ruleDifferences(withBoard, board);
  }, [scenario, board]);

  const apply = () => {
    const before = scenario;
    const ruled = applyRules(scenario, board, every, Math.floor(Math.random() * 2 ** 31));
    const next: Scenario = { ...ruled, settings: { ...ruled.settings } };
    if (scenario.settings.profile) next.settings.profile = scenario.settings.profile;
    else delete next.settings.profile;
    onChange(next);
    toast({
      id: "simulator-rules-applied",
      title: "Applied the leaderboard rules",
      description: `${BOARD_LABEL[board]} board, online every ${every} cycle${every === 1 ? "" : "s"}, a new random seed.`,
      variant: "success",
      duration: 6000,
      action: { label: "Undo", onClick: () => onChange(before) },
    });
  };

  const runTest = () => {
    pool.current?.cancel();
    const p = new LocalTestPool();
    pool.current = p;
    const seeds = randomSeeds(TEST_SEEDS);
    setTest({ running: true, board, every, progress: seeds.map(() => 0), outcomes: seeds.map(() => undefined), error: null });
    p.run({ submission, board, tier: "max", every, cycles: clampCycles(cycles), wallMs: WALL_MS }, seeds, {
      onProgress: (i, f) => setTest((t) => (t ? { ...t, progress: t.progress.map((x, j) => (j === i ? f : x)) } : t)),
      onSeed: (i, o) => setTest((t) => (t ? { ...t, outcomes: t.outcomes.map((x, j) => (j === i ? o : x)) } : t)),
    })
      .then(() => setTest((t) => (t ? { ...t, running: false } : t)))
      .catch((e: unknown) => {
        if (e instanceof Error && e.message === "cancelled") return;
        setTest((t) => (t ? { ...t, running: false, error: e instanceof Error ? e.message : String(e) } : t));
      });
  };

  const testValues = useMemo(() => {
    if (!test) return null;
    const quotes = bazaar.quotes ?? {};
    const rows = test.outcomes.map((o) => (o?.result ? { o, profit: valueResult(DATA, o.result, test.board, test.board === "normal" ? quotes : {}, bazaar.pricing).profitPerDay } : o ? { o, profit: null } : null));
    const profits = rows.filter((r): r is { o: SeedOutcome; profit: number } => !!r && r.o.ok && r.profit !== null).map((r) => r.profit);
    return { rows, ratio: profits.length === test.outcomes.length ? spreadRatio(profits) : null, failed: rows.some((r) => r && !r.o.ok) };
  }, [test, bazaar.quotes, bazaar.pricing]);

  const titleOk = title.trim().length > 0 && title.trim().length <= TITLE_MAX;
  const canSubmit = !!user && check.ok && titleOk && boards.length > 0 && description.length <= DESCRIPTION_MAX && !submitting;
  const submit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await submitFlow({ title: title.trim(), description, boards, cycles: clampCycles(cycles), payload: submissionFile(submission) });
      setSubmitted(res);
      toast({ title: "Submitted", description: "The server is verifying your flow now.", variant: "success" });
    } catch (e) {
      const errors = e && typeof e === "object" && "errors" in e && Array.isArray((e as { errors: unknown }).errors) ? ((e as { errors: string[] }).errors) : [];
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
          {!user && <span className="text-[11px] text-slate-500 mr-auto self-center">Log in to submit.</span>}
          <button type="button" className={buttonClass.neutral} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={buttonClass.primary} onClick={submit} disabled={!canSubmit} title={!check.ok ? "Fix the errors above first" : !titleOk ? "Give it a title" : undefined}>
            <Send className="w-3.5 h-3.5" /> {submitting ? "Submitting..." : "Submit"}
          </button>
        </>
      }
    >
      <Section title="Account">
        <LoginBox />
      </Section>

      <Section title="What gets submitted">
        <p className="text-xs text-slate-400 leading-relaxed">
          Your {check.plots} plot{check.plots === 1 ? "" : "s"} with every step, layout, exit, policy override and script ({Math.ceil(check.bytes / 1024)} KB). The server sets
          everything else: empty starting inventory, default advanced settings, its own stat tiers and secret seeds, at every online frequency.
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
        {differences.length > 0 ? (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-100 space-y-1.5">
            <div>Your simulator settings differ from the {BOARD_LABEL[board]} rules, so what you see locally may differ from the server:</div>
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
            <CheckCircle2 className="w-3.5 h-3.5" /> Your settings match the {BOARD_LABEL[board]} rules.
          </p>
        )}
        {(profile === "normal") !== (board === "normal") && (
          <p className="text-[11px] text-slate-400">The simulator is in {profile === "normal" ? "Normal" : "Ironman"} mode; switch it with the toggle at the top of the page to test the {BOARD_LABEL[board]} board.</p>
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
          <input className={`${inputClass} w-full text-sm py-1.5`} maxLength={TITLE_MAX} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Chloronite engine, low effort" />
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
          <div className="text-right text-[11px] text-slate-500">
            {description.length} / {DESCRIPTION_MAX}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-300">
          <div className="flex items-center gap-3" role="group" aria-label="Boards">
            <span>Boards</span>
            {BOARDS.map((b) => (
              <label key={b} className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  className="accent-emerald-500"
                  checked={boards.includes(b)}
                  onChange={(e) => setBoards((cur) => (e.target.checked ? BOARDS.filter((x) => x === b || cur.includes(x)) : cur.filter((x) => x !== b)))}
                />
                {BOARD_LABEL[b]}
              </label>
            ))}
          </div>
          <label className="flex items-center gap-2">
            <span>Cycles</span>
            <NumberInput className={`${inputClass} w-24 text-right`} value={cycles} min={MIN_CYCLES} max={MAX_CYCLES} integer step={500} onChange={setCycles} aria-label="Cycles" />
            <span className="text-[11px] text-slate-500">
              {MIN_CYCLES.toLocaleString()}-{MAX_CYCLES.toLocaleString()}
            </span>
          </label>
        </div>
        {boards.length === 0 && <p className="text-xs text-red-300">Pick at least one board.</p>}
      </Section>

      <Section title="Test locally">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={buttonClass.neutral} onClick={runTest} disabled={!check.ok || test?.running}>
            <Dices className="w-3.5 h-3.5" /> {test?.running ? "Testing..." : `Test with ${TEST_SEEDS} random seeds`}
          </button>
          <span className="text-[11px] text-slate-500">
            {BOARD_LABEL[board]} rules, max stats, online every {every} cycle{every === 1 ? "" : "s"}, {clampCycles(cycles).toLocaleString()} cycles, in this browser.
          </span>
        </div>
        {test && testValues && (
          <div className="space-y-2" data-testid="seed-test">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-700/60">
                  <th className="font-medium py-1 pr-2">Seed</th>
                  <th className="font-medium py-1 pr-2 text-right">Profit / day</th>
                  <th className="font-medium py-1 text-right">Effort (avg / peak)</th>
                </tr>
              </thead>
              <tbody>
                {test.outcomes.map((o, i) => {
                  const row = testValues.rows[i];
                  return (
                    <tr key={i} className="border-b border-slate-700/30 align-top">
                      <td className="py-1 pr-2 text-slate-400">#{i + 1}</td>
                      {!o ? (
                        <td colSpan={2} className="py-1">
                          <div className="h-1.5 rounded bg-slate-700/60 overflow-hidden mt-1.5">
                            <div className="h-full bg-emerald-500/60 transition-[width]" style={{ width: `${Math.round((test.progress[i] ?? 0) * 100)}%` }} />
                          </div>
                        </td>
                      ) : !o.ok ? (
                        <td colSpan={2} className="py-1 text-red-300 break-words">
                          Failed: {o.error}
                        </td>
                      ) : (
                        <>
                          <td className="py-1 pr-2 text-right tabular-nums text-emerald-300">{row?.profit == null ? "—" : formatCoins(row.profit)}</td>
                          <td className="py-1 text-right tabular-nums text-slate-300">{o.result ? effortText(o.result.effort.avg, o.result.effort.peak) : "—"}</td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {testValues.ratio !== null && (
              <p className={`text-xs ${testValues.ratio > OUTLIER_RATIO ? "text-red-300" : "text-slate-300"}`}>
                Spread (best / median): {ratioText(testValues.ratio)}
                {testValues.ratio > OUTLIER_RATIO && (
                  <span className="flex items-start gap-1 mt-1">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> Over {OUTLIER_RATIO}×: the server would reject this as inconsistent across seeds.
                  </span>
                )}
              </p>
            )}
            {testValues.failed && <p className="text-xs text-red-300">A failed seed makes the server reject the submission.</p>}
            {test.board === "normal" && !bazaar.prices && <p className="text-[11px] text-amber-300">No cached Bazaar prices: open the simulator in Normal mode once to fetch them.</p>}
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
