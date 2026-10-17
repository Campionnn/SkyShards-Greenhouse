import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, FlaskConical, Flag, Link2, Pencil, Save, Trash2, Trophy, X } from "lucide-react";
import { AuthorLabel, Badge, PriceNote, ViewerControls } from "../components/flows/FlowControls";
import { CellNumbers, FrequencyChart, ItemBreakdown, LayoutThumbs, ReportDialog, SeedTable, StatusBox } from "../components/flows/FlowDetailSections";
import { FlowMarkdown } from "../components/flows/FlowMarkdown";
import { buttonClass, inputClass } from "../components/simulator/styles";
import { InfoHint, Panel, useToast } from "../components/ui";
import { useAuth } from "../hooks/useAuth";
import { useFlowViewer } from "../hooks/useFlowViewer";
import type { FlowDetail } from "../leaderboard/api";
import { BADGE_TITLE, BOARD_LABEL, DESCRIPTION_MAX, findCell, TITLE_MAX, formatDate, itemBreakdown, percent, profitByEvery, slackFrom, spreadAt, TIER_LABEL, viewerResult } from "../leaderboard/view";
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
        <input className={`${inputClass} w-full text-sm py-1.5`} maxLength={TITLE_MAX} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="block space-y-1 text-xs text-slate-300">
        <span>Description (Markdown, no links or images)</span>
        <textarea className={`${inputClass} w-full h-40`} maxLength={DESCRIPTION_MAX} value={description} onChange={(e) => setDescription(e.target.value)} />
        <span className="block text-right text-[11px] text-slate-500">
          {description.length} / {DESCRIPTION_MAX}
        </span>
      </label>
      <div className="flex gap-2">
        <button type="button" className={buttonClass.primary} onClick={save} disabled={busy || !title.trim()}>
          <Save className="w-3.5 h-3.5" /> {busy ? "Saving..." : "Save"}
        </button>
        <button type="button" className={buttonClass.neutral} onClick={onCancel}>
          <X className="w-3.5 h-3.5" /> Cancel
        </button>
      </div>
    </div>
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
  const owner = !!user && user.id === detail.author.id;
  const boardListed = detail.boards.includes(viewer.board);
  const settings = { quotes: viewer.quotes, pricing: viewer.bazaar.pricing, viewerStats: viewer.viewerStats, useMyStats: viewer.useMyStats };
  const cell = findCell(detail.cells, viewer.board, viewer.tier, viewer.every);
  const points = useMemo(
    () => profitByEvery(DATA, detail.cells, viewer.board, viewer.tier, { quotes: viewer.quotes, pricing: viewer.bazaar.pricing, viewerStats: viewer.viewerStats, useMyStats: viewer.useMyStats }),
    [detail.cells, viewer.board, viewer.tier, viewer.quotes, viewer.bazaar.pricing, viewer.viewerStats, viewer.useMyStats]
  );
  const forgiving = slackFrom(points, viewer.every);
  const shown = cell ? viewerResult(DATA, cell.median, settings) : null;
  const lines = shown ? itemBreakdown(DATA, shown.result, viewer.board, viewer.quotes, viewer.bazaar.pricing) : [];
  const seeds = (detail.seeds ?? []).filter((s) => s.board === viewer.board && s.tier === viewer.tier && s.every === viewer.every);

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
    <div className="container mx-auto px-2 sm:px-4 py-4 sm:py-6 max-w-screen-2xl space-y-4">
      <Link to="/flows" className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200">
        <ArrowLeft className="w-3.5 h-3.5" /> Flow leaderboard
      </Link>

      <section className="bg-slate-800/40 border border-slate-600/30 rounded-lg p-4 space-y-3">
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
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1 space-y-1.5">
                <h1 className="text-lg font-semibold text-slate-100 break-words flex items-start gap-2">
                  <Trophy className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                  <span className="min-w-0">{detail.title}</span>
                </h1>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                  <AuthorLabel author={detail.author} size={22} />
                  <span>{detail.boards.map((b) => BOARD_LABEL[b]).join(" + ")}</span>
                  <span>
                    {detail.plots} plot{detail.plots === 1 ? "" : "s"}
                  </span>
                  <span>{detail.cycles.toLocaleString()} cycles</span>
                  <span>Submitted {formatDate(detail.createdAt)}</span>
                  {String(detail.updatedAt) !== String(detail.createdAt) && <span>Updated {formatDate(detail.updatedAt)}</span>}
                  {detail.stale && (
                    <Badge tone="stale" title={BADGE_TITLE.stale}>
                      stale
                    </Badge>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={buttonClass.primary} onClick={() => navigate(`/simulator?flow=${encodeURIComponent(detail.id)}`)}>
                  <FlaskConical className="w-3.5 h-3.5" /> Open in simulator
                </button>
                <button type="button" className={buttonClass.neutral} onClick={copyLink}>
                  <Link2 className="w-3.5 h-3.5" /> Copy link
                </button>
                {user && !owner && (
                  <button type="button" className={buttonClass.neutral} onClick={() => setReporting(true)}>
                    <Flag className="w-3.5 h-3.5" /> Report
                  </button>
                )}
                {owner && (
                  <>
                    <button type="button" className={buttonClass.neutral} onClick={() => setEditing(true)}>
                      <Pencil className="w-3.5 h-3.5" /> Edit
                    </button>
                    <button type="button" className={buttonClass.danger} onClick={remove}>
                      <Trash2 className="w-3.5 h-3.5" /> Delete
                    </button>
                  </>
                )}
              </div>
            </div>
            {detail.description?.trim() ? <FlowMarkdown text={detail.description} /> : <p className="text-xs text-slate-500">No description.</p>}
          </>
        )}
        {owner && <StatusBox id={detail.id} initial={detail.status} onLive={onReload} />}
      </section>

      <section className="bg-slate-800/40 border border-slate-600/30 rounded-lg p-3 sm:p-4 space-y-3">
        <ViewerControls viewer={viewer} />
        <PriceNote viewer={viewer} now={now} />
        {!boardListed && <p className="text-xs text-amber-200">This flow is not entered on the {BOARD_LABEL[viewer.board]} board.</p>}
      </section>

      <Panel
        title={`${BOARD_LABEL[viewer.board]} · ${TIER_LABEL[viewer.tier]} tier · online every ${viewer.every} cycle${viewer.every === 1 ? "" : "s"}`}
        actions={shown?.scaled ? <Badge tone="estimated" title={BADGE_TITLE.scaled}>estimated</Badge> : undefined}
      >
        {cell && shown ? (
          <CellNumbers result={shown.result} board={viewer.board} quotes={viewer.quotes} pricing={viewer.bazaar.pricing} seeds={cell.seeds} spread={spreadAt(cell.spread, viewer.every)} />
        ) : (
          <p className="text-xs text-slate-400">{boardListed ? "This cell isn't verified yet. Try the max tier, or check back later." : "No results on this board."}</p>
        )}
      </Panel>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        <Panel
          title="Profit by online frequency"
          actions={
            <span className="flex items-center gap-1 text-xs text-slate-300">
              Forgiving: <span className="text-emerald-300 font-medium">{forgiving === null ? "n/a" : percent(forgiving)}</span>
              <InfoHint title="Forgiving (Slack)" width={300}>
                How much of the profit survives when you log in later than planned: the profit at the next frequencies up to twice yours, relative to
                yours, weighted towards the nearest. 100% = logging in late costs nothing. n/a at 12 cycles (no point beyond it) or with no profit.
              </InfoHint>
            </span>
          }
        >
          <FrequencyChart points={points} selected={viewer.every} onSelect={viewer.setEvery} />
          <p className="text-[11px] text-slate-500 mt-1">Online every N cycles ({TIER_LABEL[viewer.tier]} tier). Click a bar to pick that frequency.</p>
        </Panel>
        <Panel title="Items per day">
          <ItemBreakdown lines={lines} />
        </Panel>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        <Panel title="Starting layouts" description="Each plot's first step. Open it in the simulator for the whole flow.">
          <LayoutThumbs detail={detail} />
        </Panel>
        {seeds.length > 0 && (
          <Panel title="Per-seed results">
            <SeedTable seeds={seeds} board={viewer.board} quotes={viewer.quotes} pricing={viewer.bazaar.pricing} />
          </Panel>
        )}
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
    getFlow(id)
      .then((detail) => live && setState({ id, detail }))
      .catch((e: unknown) => live && setState({ id, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      live = false;
    };
  }, [id, reload]);
  const onChange = useCallback((detail: FlowDetail) => setState({ id: detail.id, detail }), []);
  const onReload = useCallback(() => setReload((n) => n + 1), []);

  if (!state || state.id !== id) return <div className="container mx-auto px-4 py-10 text-center text-xs text-slate-400">Loading the flow...</div>;
  if (state.error || !state.detail)
    return (
      <div className="container mx-auto px-4 py-10 text-center text-sm space-y-3">
        <div className="text-red-300">Could not load this flow: {state.error}</div>
        <Link to="/flows" className="text-emerald-300 hover:underline text-xs">
          Back to the leaderboard
        </Link>
      </div>
    );
  return <FlowDetailView detail={state.detail} onChange={onChange} onReload={onReload} />;
};
