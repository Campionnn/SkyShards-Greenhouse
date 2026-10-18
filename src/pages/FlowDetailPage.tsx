import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Activity, ArrowLeft, BarChart3, Clock, Code2, Coins, Eye, EyeOff, FileText, FlaskConical, Flag, Layers, Link2, Pencil, Save, ShieldCheck, Sprout, Trash2, X } from "lucide-react";
import { AuthorLabel, Badge, PriceNote, StatsPanel } from "../components/flows/FlowControls";
import { EffortBreakdown, FlowWalkthrough, FrequencyChart, ItemBreakdown, ReportDialog, SeedTable, SourceBreakdown, StatTile, StatusBox } from "../components/flows/FlowDetailSections";
import { useFlowShape } from "../components/flows/flowsDisplay";
import { FlowMarkdown } from "../components/flows/FlowMarkdown";
import { EffortMeter, LayoutThumb, MutationChip, SplitBar, SplitLegend } from "../components/flows/FlowVisuals";
import { formatCoins, formatRate, nameOf } from "../components/simulator/format";
import { buttonClass, inputClass } from "../components/simulator/styles";
import { InfoHint, Panel, useToast } from "../components/ui";
import { useAuth } from "../hooks/useAuth";
import { useFlowViewer } from "../hooks/useFlowViewer";
import type { FlowDetail } from "../leaderboard/api";
import { valueResult } from "../leaderboard/pricing";
import { cycleHours } from "../leaderboard/tiers";
import {
  BADGE_TITLE,
  BOARD_LABEL,
  DESCRIPTION_MAX,
  earningTargets,
  moneyBySource,
  findCell,
  formatDate,
  itemBreakdown,
  mutationsPerDay,
  percent,
  profitByEvery,
  ratioText,
  revenueSplit,
  slackFrom,
  spreadAt,
  suppliesOf,
  suppliesText,
  TIER_LABEL,
  TITLE_MAX,
  viewerResult,
} from "../leaderboard/view";
import { adminDelete, adminHide, adminUnhide, getAdminKey, hiddenReasonLabel } from "../services/adminService";
import { deleteFlow, flowLink, getFlow, updateFlow } from "../services/flowsService";
import { defaultGameData } from "../simulator";

const DATA = defaultGameData();

const EditForm: React.FC<{ detail: FlowDetail; onSaved: (title: string, description: string) => void; onCancel: () => void }> = ({ detail, onSaved, onCancel }) => {
  const { toast } = useToast();
  const [title, setTitle] = useState(detail.title);
  const [description, setDescription] = useState(detail.description ?? "");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await updateFlow(detail.id, { title: title.trim(), description });
      onSaved(title.trim(), description);
      toast({ title: "Saved", variant: "success" });
    } catch (e) {
      toast({ title: "Could not save", description: e instanceof Error ? e.message : String(e), variant: "error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <label className="block space-y-1 text-xs text-slate-300">
        <span>Title</span>
        <input className={`${inputClass} w-full py-1.5 text-sm`} maxLength={TITLE_MAX} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="block space-y-1 text-xs text-slate-300">
        <span>Description (Markdown, no links or images)</span>
        <textarea className={`${inputClass} h-40 w-full`} maxLength={DESCRIPTION_MAX} value={description} onChange={(e) => setDescription(e.target.value)} />
        <span className="block text-right text-[11px] text-slate-500">
          {description.length} / {DESCRIPTION_MAX}
        </span>
      </label>
      <div className="flex gap-2">
        <button type="button" className={buttonClass.primary} onClick={save} disabled={busy || !title.trim()}>
          <Save className="h-3.5 w-3.5" /> {busy ? "Saving..." : "Save"}
        </button>
        <button type="button" className={buttonClass.neutral} onClick={onCancel}>
          <X className="h-3.5 w-3.5" /> Cancel
        </button>
      </div>
    </div>
  );
};

/** Admin (key in sessionStorage): hidden / report info with Hide, Unhide and Delete. */
export const ModerationBox: React.FC<{ detail: FlowDetail; onReload: () => void }> = ({ detail, onReload }) => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const hidden = detail.hidden ?? detail.status === "hidden";
  const why = hidden ? hiddenReasonLabel(detail.hiddenReason) : null;
  const run = async (action: "hide" | "unhide" | "delete") => {
    if (action === "delete" && !window.confirm(`Delete "${detail.title}" for good? This can't be undone.`)) return;
    setBusy(true);
    try {
      if (action === "hide") await adminHide(detail.id);
      else if (action === "unhide") await adminUnhide(detail.id);
      else await adminDelete(detail.id);
      toast({ title: action === "hide" ? "Hidden" : action === "unhide" ? "Unhidden" : "Deleted", description: detail.title, variant: "success" });
      if (action === "delete") navigate("/flows/admin");
      else onReload();
    } catch (e) {
      toast({ title: `Could not ${action}`, description: e instanceof Error ? e.message : String(e), variant: "error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs" data-testid="moderation-box">
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-amber-400" />
        <span className="font-medium text-slate-200">Moderation</span>
        <Badge tone={detail.status === "live" ? "new" : detail.status === "rejected" ? "danger" : detail.status === "hidden" ? "stale" : "pending"}>{detail.status}</Badge>
        {why && <Badge tone={detail.hiddenReason === "ban" ? "danger" : "estimated"}>{why}</Badge>}
        <span className={detail.reportCount ? "text-amber-300" : "text-slate-400"}>
          {detail.reportCount ?? 0} report{detail.reportCount === 1 ? "" : "s"}
        </span>
        <Link to="/flows/admin" className="text-slate-400 underline-offset-2 hover:text-slate-200 hover:underline">
          Queue
        </Link>
      </div>
      {detail.rejectReason && <div className="break-words text-red-300">Rejected: {detail.rejectReason}</div>}
      <div className="flex flex-wrap gap-2">
        {hidden ? (
          <button type="button" className={buttonClass.neutral} disabled={busy} onClick={() => run("unhide")}>
            <Eye className="h-3.5 w-3.5" /> Unhide
          </button>
        ) : (
          <button type="button" className={buttonClass.neutral} disabled={busy} onClick={() => run("hide")}>
            <EyeOff className="h-3.5 w-3.5" /> Hide
          </button>
        )}
        <button type="button" className={buttonClass.danger} disabled={busy} onClick={() => run("delete")}>
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </button>
      </div>
    </div>
  );
};

const ActionButton: React.FC<{ onClick: () => void; tone?: "primary" | "neutral" | "danger"; children: React.ReactNode }> = ({ onClick, tone = "neutral", children }) => {
  const cls =
    tone === "primary"
      ? "border-emerald-500/50 bg-emerald-500 text-slate-950 hover:bg-emerald-400"
      : tone === "danger"
        ? "border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20"
        : "border-slate-600/50 bg-slate-800/70 text-slate-200 hover:bg-slate-700/70";
  return (
    <button type="button" onClick={onClick} className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-[background-color,transform] duration-150 active:scale-[0.97] ${cls}`}>
      {children}
    </button>
  );
};

export const FlowDetailView: React.FC<{ detail: FlowDetail; onChange: (d: FlowDetail) => void; onReload: () => void }> = ({ detail, onChange, onReload }) => {
  const viewer = useFlowViewer();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const [editing, setEditing] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [now] = useState(() => Date.now());
  const [admin] = useState(() => !!getAdminKey());
  const shape = useFlowShape(detail);
  const owner = !!user && user.id === detail.author.id;
  const boardListed = detail.boards.includes(viewer.board);
  const settings = { quotes: viewer.quotes, pricing: viewer.bazaar.pricing, viewerStats: viewer.viewerStats, useMyStats: true };
  // The viewer's tier, or the max tier standing in while other tiers are still being verified.
  const exact = findCell(detail.cells, viewer.board, viewer.tier, viewer.every);
  const cell = exact ?? findCell(detail.cells, viewer.board, "max", viewer.every);
  const tierShown = exact ? viewer.tier : "max";
  const points = useMemo(
    () => profitByEvery(DATA, detail.cells, viewer.board, tierShown, { quotes: viewer.quotes, pricing: viewer.bazaar.pricing, viewerStats: viewer.viewerStats, useMyStats: true }),
    [detail.cells, viewer.board, tierShown, viewer.quotes, viewer.bazaar.pricing, viewer.viewerStats]
  );
  const forgiving = slackFrom(points, viewer.every);
  const shown = cell ? viewerResult(DATA, cell.median, settings) : null;
  const quotes = viewer.board === "normal" ? viewer.quotes : {};
  const value = shown ? valueResult(DATA, shown.result, viewer.board, quotes, viewer.bazaar.pricing) : null;
  const split = shown ? revenueSplit(DATA, shown.result, viewer.board, quotes, viewer.bazaar.pricing) : null;
  const lines = shown ? itemBreakdown(DATA, shown.result, viewer.board, viewer.quotes, viewer.bazaar.pricing) : [];
  const seeds = (detail.seeds ?? []).filter((s) => s.board === viewer.board && s.tier === tierShown && s.every === viewer.every);
  const spread = cell ? spreadAt(cell.spread, viewer.every) : null;
  const sources = shown ? moneyBySource(DATA, shown.result.bySource, viewer.board, quotes, viewer.bazaar.pricing) : [];
  const earning = earningTargets(DATA, detail.summary?.targets ?? [], shown?.result.bySource, viewer.board, quotes, viewer.bazaar.pricing);
  const firstThumb = detail.summary?.plots.find((p) => p.thumb)?.thumb ?? null;
  const heroLayout = detail.thumb?.layout ?? (firstThumb ? { code: firstThumb } : (detail.payload?.plots?.[0]?.flow.steps[0]?.layout ?? null));
  const supplies = shown ? suppliesText(suppliesOf(shown.result)) : "none";

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(flowLink(detail.id));
      toast({ title: "Link copied", description: flowLink(detail.id), variant: "success" });
    } catch {
      toast({ title: "Could not copy", description: flowLink(detail.id), variant: "warning" });
    }
  };
  const remove = async () => {
    if (!window.confirm(`Delete "${detail.title}" from the leaderboard? This can't be undone.`)) return;
    try {
      await deleteFlow(detail.id);
      toast({ title: "Flow deleted", variant: "success" });
      navigate("/flows");
    } catch (e) {
      toast({ title: "Could not delete", description: e instanceof Error ? e.message : String(e), variant: "error" });
    }
  };

  return (
    <div className="space-y-4 py-2 sm:py-4">
      <Link to="/flows" className="inline-flex items-center gap-1 text-xs text-slate-400 transition-colors hover:text-slate-200">
        <ArrowLeft className="h-3.5 w-3.5" /> Flow rankings
      </Link>

      {/* Hero: the first layout, the title and the headline number. */}
      <section className="relative overflow-hidden rounded-xl border border-slate-600/30 bg-slate-800/40">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(16,185,129,0.10),transparent_55%)]" aria-hidden />
        <div className="relative grid grid-cols-1 gap-5 p-4 sm:p-5 md:grid-cols-[auto_minmax(0,1fr)]">
          <figure className="justify-self-center md:justify-self-start">
            <LayoutThumb layout={heroLayout} cellSize={17} />
            {detail.thumb && (
              <figcaption className="mt-1 text-center text-[11px] text-slate-500">
                Plot {detail.thumb.plot}'s main layout · {percent(detail.thumb.share)} of the time
              </figcaption>
            )}
          </figure>
          <div className="min-w-0 space-y-3">
            {editing ? (
              <EditForm
                detail={detail}
                onCancel={() => setEditing(false)}
                onSaved={(title, description) => {
                  onChange({ ...detail, title, description });
                  setEditing(false);
                }}
              />
            ) : (
              <>
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    {detail.boards.map((b) => (
                      <Badge key={b} tone={b === "normal" ? "pending" : "new"}>
                        {BOARD_LABEL[b]}
                      </Badge>
                    ))}
                    {detail.stale && (
                      <Badge tone="stale" title={BADGE_TITLE.stale}>
                        re-verifying
                      </Badge>
                    )}
                    {shape.scripted && (
                      <Badge tone="violet" icon={<Code2 />}>
                        scripted
                      </Badge>
                    )}
                  </div>
                  <h1 className="break-words text-2xl font-bold tracking-tight text-slate-50">{detail.title}</h1>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                    <AuthorLabel author={detail.author} size={20} />
                    <span className="inline-flex items-center gap-1">
                      <Layers className="h-3 w-3" /> {detail.plots} plot{detail.plots === 1 ? "" : "s"}, {shape.steps} step{shape.steps === 1 ? "" : "s"}
                    </span>
                    <span>{detail.cycles.toLocaleString()} cycles simulated</span>
                    <span>Submitted {formatDate(detail.createdAt)}</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
                  <div>
                    <div className="text-4xl font-bold leading-none tabular-nums text-amber-300">{value ? formatCoins(value.profitPerDay) : "—"}</div>
                    <div className="mt-1 text-xs text-slate-400">
                      coins / day · {BOARD_LABEL[viewer.board]}, {TIER_LABEL[tierShown]} tier, online every {viewer.every}
                      {shown?.scaled ? " · scaled to your yield (est.)" : ""}
                    </div>
                  </div>
                  {shown && (
                    <div className="flex items-center gap-2 pb-1">
                      <EffortMeter avg={shown.result.effort.avg} peak={shown.result.effort.peak} />
                      {forgiving !== null && <span className="text-xs text-slate-400">· {percent(forgiving)} forgiving</span>}
                    </div>
                  )}
                </div>
                {split && value && (
                  <div className="max-w-lg">
                    <SplitBar split={split} fraction={1} className="h-2" />
                    <SplitLegend split={split} className="mt-1.5" />
                  </div>
                )}
                {earning.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] uppercase tracking-wide text-slate-500">Top earners</span>
                    {earning.slice(0, 3).map((t) => (
                      <MutationChip key={t.id} id={t.id} size="md" earning={t.coinsPerDay} />
                    ))}
                    {earning.length > 3 && (
                      <span className="rounded-md border border-slate-700/50 px-1.5 py-0.5 text-xs tabular-nums text-slate-400" title={earning.slice(3).map((t) => nameOf(t.id)).join(", ")}>
                        +{earning.length - 3}
                      </span>
                    )}
                  </div>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  <ActionButton tone="primary" onClick={() => navigate(`/simulator?flow=${encodeURIComponent(detail.id)}`)}>
                    <FlaskConical className="h-3.5 w-3.5" /> Open in simulator
                  </ActionButton>
                  <ActionButton onClick={copyLink}>
                    <Link2 className="h-3.5 w-3.5" /> Copy link
                  </ActionButton>
                  {user && !owner && (
                    <ActionButton onClick={() => setReporting(true)}>
                      <Flag className="h-3.5 w-3.5" /> Report
                    </ActionButton>
                  )}
                  {owner && (
                    <>
                      <ActionButton onClick={() => setEditing(true)}>
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </ActionButton>
                      <ActionButton tone="danger" onClick={remove}>
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </ActionButton>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
        {(owner || admin) && (
          <div className="relative space-y-3 border-t border-slate-700/40 p-4">
            {owner && <StatusBox id={detail.id} initial={detail.status} onLive={onReload} />}
            {admin && <ModerationBox detail={detail} onReload={onReload} />}
          </div>
        )}
      </section>

      {detail.description?.trim() && !editing && (
        <Panel title="Description" icon={<FileText />}>
          <FlowMarkdown text={detail.description} />
        </Panel>
      )}

      <StatsPanel viewer={viewer} defaultOpen={false} />

      {!boardListed && <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">This flow is not entered on the {BOARD_LABEL[viewer.board]} board.</p>}
      {boardListed && !exact && cell && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
          The {TIER_LABEL[viewer.tier]} tier isn't verified yet for this flow; showing the Max tier instead.
        </p>
      )}

      {shown && value && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <StatTile label="Revenue / day" value={formatCoins(value.revenuePerDay)} />
          {viewer.board === "normal" ? (
            <StatTile label="Supplies / day" value={formatCoins(value.boughtPerDay)} sub={value.buildCost > 0 ? `${formatCoins(value.buildCost)} to build once` : undefined} tone="text-sky-200" />
          ) : (
            <StatTile label="Supplies to farm" value={supplies === "none" ? "None" : supplies} sub={supplies === "none" ? undefined : "per day"} tone="text-slate-200" />
          )}
          <StatTile label="Mutations / day" value={formatRate(mutationsPerDay(DATA, shown.result))} />
          <StatTile label="Effort / login" value={`${Math.round(shown.result.effort.avg)}`} sub={`heaviest ${Math.round(shown.result.effort.peak)}`} />
          <StatTile label="Target uptime" value={percent(shown.result.uptime)} tone={shown.result.sustainable ? "text-emerald-300" : "text-amber-300"} sub={shown.result.sustainable ? "sustainable" : "has downtime"} />
          <StatTile
            label="Seed spread"
            value={ratioText(spread)}
            sub={`${cell?.seeds ?? 0} secret seeds`}
            tone={spread !== null && spread > 1.5 ? "text-amber-300" : "text-slate-100"}
            title="Best seed / median seed. Lower is more consistent."
          />
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <Panel title="What you earn" icon={<Coins />} description="Each item the flow produces, per day, at your prices.">
          <ItemBreakdown lines={lines} />
          {value && value.unpriced.length > 0 && <p className="mt-2 text-[11px] text-amber-300">No price for some items; they count as 0.</p>}
        </Panel>
        <Panel title="Where it comes from" icon={<Sprout />} description="Which plants' harvests the money comes from, with what each drops.">
          <SourceBreakdown lines={sources} />
        </Panel>
      </div>

      <Panel
        title="Profit by online frequency"
        icon={<BarChart3 />}
        actions={
          <span className="flex items-center gap-1 text-xs text-slate-300">
            <span className="font-medium text-emerald-300">{forgiving === null ? "n/a" : percent(forgiving)}</span> forgiving
            <InfoHint title="Forgiving" width={300}>
              How much of your profit you keep when you come back later than planned. It compares the points in the shaded Forgiving range (your frequency
              up to twice it) with yours, counting the slightly-late ones the most. 100% means being late costs nothing; a low % means the flow falls
              apart if you miss a login. Shows n/a at 12 cycles (nothing slower was simulated) or with no profit.
            </InfoHint>
          </span>
        }
        description={`How much you make by how often you log in (${TIER_LABEL[tierShown]} tier). Hover a point for its numbers; click one to use that frequency.`}
      >
        <FrequencyChart points={points} selected={viewer.every} hoursPerCycle={cycleHours(viewer.stats)} onSelect={viewer.setEvery} />
      </Panel>

      <Panel title="The flow" icon={<Layers />} description="Every plot, step by step, as the real layouts. Hover a cell to see what it is.">
        <FlowWalkthrough detail={detail} />
      </Panel>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <Panel title="Work per login" icon={<Activity />} description="Weighted by how much work each action is.">
          {shown ? <EffortBreakdown result={shown.result} /> : <p className="text-xs text-slate-500">Not verified at this frequency yet.</p>}
        </Panel>
        {seeds.length > 0 ? (
          <Panel title="Consistency across seeds" icon={<Clock />}>
            <SeedTable seeds={seeds} board={viewer.board} quotes={viewer.quotes} pricing={viewer.bazaar.pricing} />
          </Panel>
        ) : (
          <div />
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
        <PriceNote viewer={viewer} now={now} />
        <span>
          Updated {formatDate(detail.updatedAt)} · engine {detail.engineVersion?.slice(0, 8) || "?"}
        </span>
      </div>

      {reporting && <ReportDialog id={detail.id} onClose={() => setReporting(false)} />}
    </div>
  );
};

export const FlowDetailPage: React.FC = () => {
  const { id = "" } = useParams();
  const [state, setState] = useState<{ id: string; detail?: FlowDetail; error?: string } | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let live = true;
    getFlow(id, { adminKey: getAdminKey() })
      .then((detail) => live && setState({ id, detail }))
      .catch((e: unknown) => live && setState({ id, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      live = false;
    };
  }, [id, reload]);
  const onChange = useCallback((detail: FlowDetail) => setState({ id: detail.id, detail }), []);
  const onReload = useCallback(() => setReload((n) => n + 1), []);

  if (!state || state.id !== id)
    return (
      <div className="space-y-4 py-4" aria-busy>
        <div className="h-4 w-32 animate-pulse rounded bg-slate-700/40" />
        <div className="h-56 animate-pulse rounded-xl border border-slate-700/40 bg-slate-800/40" />
        <span className="sr-only">Loading the flow...</span>
      </div>
    );
  if (state.error || !state.detail)
    return (
      <div className="space-y-3 px-4 py-10 text-center text-sm">
        <div className="text-red-300">Could not load this flow: {state.error}</div>
        <Link to="/flows" className="text-xs text-emerald-300 hover:underline">
          Back to the rankings
        </Link>
      </div>
    );
  return <FlowDetailView detail={state.detail} onChange={onChange} onReload={onReload} />;
};
