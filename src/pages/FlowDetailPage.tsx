import React, { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Ellipsis, Eye, EyeOff, FlaskConical, Flag, Link2, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { AccountControl, AuthorLabel, LikeButton, PriceNote } from "../components/flows/FlowControls";
import { SLOWING_TITLE } from "../components/flows/FlowChips";
import { FlowMarkdown } from "../components/flows/FlowMarkdown";
import { LayoutThumb } from "../components/flows/FlowVisuals";
import { ReportDialog, StatusBox } from "../components/flows/FlowDetailSections";
import { ConfirmDialog } from "../components/flows/detail/ConfirmDialog";
import { DetailTabs } from "../components/flows/detail/DetailTabs";
import { useIsPhone, useMinuteClock, useScrollPadding } from "../components/flows/detail/detailHooks";
import { useDetailModel } from "../components/flows/detail/detailModel";
import { tabFrom, type DetailTab } from "../components/flows/detail/detailText";
import { SummaryStrip } from "../components/flows/detail/SummaryStrip";
import { StatsDrawer } from "../components/flows/stats/StatsDrawer";
import { PlayerImportPanel } from "../components/playerImport/PlayerImportBox";
import { formatCoins } from "../components/simulator/format";
import { useToast } from "../components/ui";
import { LinkButton } from "../components/ui/Card";
import { cn } from "../components/ui/cn";
import { InfoHint } from "../components/ui/InfoHint";
import { IconButton, KitButton, KitInput, KitTextarea, Pill } from "../components/ui/kit";
import { DialogFrame, ModalDialog } from "../components/ui/ModalDialog";
import { MenuItem, MenuSeparator, Popover } from "../components/ui/Popover";
import { useAuth } from "../hooks/useAuth";
import { useFlowLikes, useLikeReplay } from "../hooks/useFlowLikes";
import { useFlowViewer, type FlowViewer } from "../hooks/useFlowViewer";
import type { FlowDetail } from "../leaderboard/api";
import { boardFrom, kitFromBoard, type CellKind } from "../leaderboard/rules";
import { BADGE_TITLE, BOARD_LABEL, CELL_KIND_LABEL, DESCRIPTION_MAX, formatDate, percent, starvedText, TIER_LABEL, TITLE_MAX } from "../leaderboard/view";
import { adminDelete, adminHide, adminUnhide, getAdminKey, hiddenReasonLabel } from "../services/adminService";
import { ApiError } from "../services/authService";
import { deleteFlow, flowShareLink, getFlow, updateFlow } from "../services/flowsService";

// /flows/:id (Flows v2, direction A "Verdict strip"; plan docs/plans/flows-revamp.md, states
// research/flows-v2/mockup/detail-states.md). Header with the action, a summary strip that says
// whose stats the numbers are for, the three board numbers and five facts, then the sections as
// sticky tabs. Phones get a bottom action bar.

const STATUS_TONE = { live: "go", rejected: "problem", hidden: "neutral", pending: "script" } as const;

/** The owner's inline edit form (F68): replaces the title block. */
const EditForm: React.FC<{ detail: FlowDetail; onSaved: (title: string, description: string) => void; onCancel: () => void }> = ({ detail, onSaved, onCancel }) => {
  const { toast } = useToast();
  const [title, setTitle] = useState(detail.title);
  const [description, setDescription] = useState(detail.description ?? "");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (busy || !title.trim()) return;
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
    <form
      className="min-w-0 flex-1 space-y-2.5"
      aria-label="Edit flow"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label className="block space-y-1">
        <span className="flex justify-between text-secondary text-fg-muted">
          Title
          <span className="text-meta tabular-nums text-fg-meta">
            {title.length} / {TITLE_MAX}
          </span>
        </span>
        <KitInput className="w-full" maxLength={TITLE_MAX} value={title} onChange={(e) => setTitle(e.target.value)} invalid={!title.trim()} />
      </label>
      <label className="block space-y-1">
        <span className="flex items-center justify-between gap-2 text-secondary text-fg-muted">
          <span>Description (Markdown, no links or images)</span>
          <span className="text-meta tabular-nums text-fg-meta">
            {description.length} / {DESCRIPTION_MAX}
          </span>
        </span>
        <KitTextarea className="h-32 w-full" maxLength={DESCRIPTION_MAX} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <div className="flex gap-2">
        <KitButton type="submit" variant="primary" size="md" loading={busy} disabled={!title.trim()}>
          Save
        </KitButton>
        <KitButton variant="ghost" size="md" onClick={onCancel} disabled={busy}>
          Cancel
        </KitButton>
      </div>
    </form>
  );
};

/** Admin (key in sessionStorage): hidden / report info with Hide, Unhide and Delete (F71). */
export const ModerationBox: React.FC<{ detail: FlowDetail; onReload: () => void }> = ({ detail, onReload }) => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const hidden = detail.hidden ?? detail.status === "hidden";
  const why = hidden ? hiddenReasonLabel(detail.hiddenReason) : null;
  const run = async (action: "hide" | "unhide" | "delete") => {
    if (busy) return;
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
      setConfirming(false);
    }
  };
  return (
    <section aria-label="Moderation" className="space-y-1.5" data-testid="moderation-box">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-secondary text-fg-muted">
        <span className="font-semibold text-fg">Moderation</span>
        <Pill tone={STATUS_TONE[detail.status as keyof typeof STATUS_TONE] ?? "neutral"}>{detail.status}</Pill>
        {why && <Pill tone={detail.hiddenReason === "ban" ? "problem" : "warn"}>{why}</Pill>}
        <span className={cn("tabular-nums", detail.reportCount ? "text-warn" : undefined)}>
          {detail.reportCount ?? 0} report{detail.reportCount === 1 ? "" : "s"}
        </span>
        <Link to="/flows/admin" className="focus-ring rounded-inner underline decoration-fg-meta underline-offset-[3px] transition-colors duration-(--duration-hover) hover:text-fg">
          Queue
        </Link>
        <span className="ml-auto flex gap-1.5">
          {hidden ? (
            <KitButton disabled={busy} onClick={() => run("unhide")}>
              <Eye /> Unhide
            </KitButton>
          ) : (
            <KitButton disabled={busy} onClick={() => run("hide")}>
              <EyeOff /> Hide
            </KitButton>
          )}
          <KitButton variant="danger" disabled={busy} onClick={() => setConfirming(true)}>
            <Trash2 /> Delete
          </KitButton>
        </span>
      </div>
      {detail.rejectReason && <p className="break-words text-secondary text-problem">Rejected: {detail.rejectReason}</p>}
      {confirming && (
        <ConfirmDialog title="Delete for good?" confirmLabel="Delete" tone="problem" busy={busy} onConfirm={() => run("delete")} onClose={() => setConfirming(false)}>
          <p>"{detail.title}" is removed from the leaderboard with its likes, reports and verification. This can't be undone.</p>
        </ConfirmDialog>
      )}
    </section>
  );
};

/** Badges above the title (F56). */
const Badges: React.FC<{ stale: boolean; scripted: boolean; stall: string | null; stallPlot: number | null; slowing: boolean }> = ({ stale, scripted, stall, stallPlot, slowing }) =>
  stale || scripted || stall || slowing ? (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {stale && <Pill title={BADGE_TITLE.stale}>re-verifying</Pill>}
      {scripted && <Pill tone="script">scripted</Pill>}
      {stall && (
        <Pill tone="warn" title={`${stall}: the stock ran out. Nobody tops it up during a run, so a flow that uses items it doesn't grow stalls unless its own steps make them again.`}>
          Stall · plot {stallPlot}
        </Pill>
      )}
      {slowing && (
        <Pill tone="warn" title={SLOWING_TITLE}>
          Slowing
        </Pill>
      )}
    </span>
  ) : null;

/** Copy link (F66): the API's /share/flow/ID page carries the Discord embed. */
function useCopyLink(id: string) {
  const { toast } = useToast();
  return async () => {
    try {
      await navigator.clipboard.writeText(flowShareLink(id));
      toast({ title: "Link copied", description: "Paste it in Discord for an embed with the flow's stats.", variant: "success" });
    } catch {
      toast({ title: "Could not copy", description: flowShareLink(id), variant: "warning" });
    }
  };
}

/** Secondary actions: Copy link (phone), Report (logged in, not the owner), Edit and Delete (owner). */
const MoreMenu: React.FC<{ size: "md" | "touch"; withCopy: boolean; canReport: boolean; owner: boolean; onCopy: () => void; onReport: () => void; onEdit: () => void; onDelete: () => void }> = ({
  size,
  withCopy,
  canReport,
  owner,
  onCopy,
  onReport,
  onEdit,
  onDelete,
}) => {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  if (!withCopy && !canReport && !owner) return null;
  const pick = (f: () => void) => () => {
    setOpen(false);
    f();
  };
  return (
    <>
      <IconButton ref={setAnchor} variant="neutral" size={size} aria-label="More actions" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Ellipsis />
      </IconButton>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} label="More actions" role="menu" width={240} align="end" className="p-1">
        {withCopy && (
          <MenuItem icon={<Link2 />} hint="Discord embed with the flow's stats" onSelect={pick(onCopy)}>
            Copy link
          </MenuItem>
        )}
        {canReport && (
          <MenuItem icon={<Flag />} onSelect={pick(onReport)}>
            Report…
          </MenuItem>
        )}
        {owner && (
          <>
            {withCopy && <MenuSeparator />}
            <MenuItem icon={<Pencil />} onSelect={pick(onEdit)}>
              Edit title and description
            </MenuItem>
            <MenuItem icon={<Trash2 />} tone="danger" onSelect={pick(onDelete)}>
              Delete…
            </MenuItem>
          </>
        )}
      </Popover>
    </>
  );
};

/** Import from Hypixel straight from the strip (the drawer has the same button). */
const ImportDialog: React.FC<{ viewer: FlowViewer; onClose: () => void }> = ({ viewer, onClose }) => (
  <ModalDialog labelledBy="detail-import-title" onClose={onClose} maxWidth="max-w-xl">
    <DialogFrame id="detail-import-title" title="Import from Hypixel" onClose={onClose}>
      <PlayerImportPanel
        onImport={(patch) => {
          viewer.setStats(patch);
          onClose();
        }}
      />
    </DialogFrame>
  </ModalDialog>
);

/** The ranking's own query (sort, filters, frequency…) when the visitor came from it; else its board. */
function useBackLink(viewer: FlowViewer): string {
  const location = useLocation();
  const state = location.state as { rankingSearch?: unknown } | null;
  if (typeof state?.rankingSearch === "string") return `/flows${state.rankingSearch}`;
  return `/flows?board=${viewer.board}${viewer.board === "ironman" && viewer.kit ? "&kit=1" : ""}`;
}

export const FlowDetailView: React.FC<{ detail: FlowDetail; onChange: (d: FlowDetail) => void; onReload: () => void }> = ({ detail, onChange, onReload }) => {
  // The board, the starting-items switch and the tab live in the URL (?board=&kit=1&tab=; v2's ironman_strict / ironman_borrow too).
  const location = useLocation();
  const [search, setSearch] = useSearchParams();
  const setQuery = (patch: (q: URLSearchParams) => void) =>
    setSearch(
      (cur) => {
        const next = new URLSearchParams(cur);
        patch(next);
        return next;
      },
      // Keep the ranking's state (the back link) across board and tab changes.
      { replace: true, state: location.state },
    );
  const viewer = useFlowViewer({
    available: detail.boards,
    board: boardFrom(search.get("board")),
    onBoard: (b) => setQuery((q) => q.set("board", b)),
    kit: kitFromBoard(search.get("board")) ?? search.get("kit") === "1",
    onKit: (on) =>
      setQuery((q) => {
        q.set("board", "ironman");
        if (on) q.set("kit", "1");
        else q.delete("kit");
      }),
    // The Normal number sits next to the ironman ones, so its prices are needed on every board.
    bazaarAlways: true,
  });
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const phone = useIsPhone();
  const now = useMinuteClock();
  // Focused controls scroll clear of the sticky tabs and the phone's bottom bar.
  useScrollPadding(56, phone ? 84 : 0);
  const [editing, setEditing] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  // Read on every render: locking the admin key in another tab hides the moderation row on the next render.
  const admin = !!getAdminKey();
  const m = useDetailModel(detail, viewer);
  const owner = !!user && user.id === detail.author.id;
  const boardListed = detail.boards.includes(viewer.board);
  const tab = tabFrom(search.get("tab"));
  const setTab = (t: DetailTab) => setQuery((q) => (t === "need" ? q.delete("tab") : q.set("tab", t)));
  const backLink = useBackLink(viewer);
  const simLink = `/simulator?flow=${encodeURIComponent(detail.id)}&board=${viewer.board}${viewer.board === "ironman" && viewer.kit ? "&kit=1" : ""}`;
  const plots = detail.payload?.plots ?? [];
  const steps = plots.reduce((n, p) => n + p.flow.steps.length, 0);
  const scripted = !!detail.payload?.script?.source?.trim() || plots.some((p) => !!p.script?.source.trim());
  const current = m.numbers.find((n) => n.kind === m.kind)?.profitPerDay ?? null;

  const selectKind = (k: CellKind) => {
    if (k === "normal") return viewer.setBoard("normal");
    if (viewer.board !== "ironman") viewer.setBoard("ironman");
    viewer.setKit(k === "ironman_kit");
  };

  const likes = useFlowLikes();
  const liked = likes.isLiked(detail.id, detail.liked ?? false);
  const likeCount = likes.counts[detail.id]?.likes ?? detail.likes ?? 0;
  const likes30d = likes.counts[detail.id]?.likes30d ?? detail.likes30d ?? 0;
  useLikeReplay(
    useCallback(
      (_id: string, ok: boolean, error?: string) =>
        toast(ok ? { title: "Logged in and liked", variant: "success" } : { title: "Logged in, but the like wasn't saved", description: error, variant: "warning" }),
      [toast],
    ),
  );
  const toggleLike = () => {
    likes.toggle(detail.id, !liked).catch((e: unknown) => toast({ title: "Could not save your like", description: e instanceof Error ? e.message : String(e), variant: "error" }));
  };
  const copyLink = useCopyLink(detail.id);
  const remove = async () => {
    if (deleteBusy) return;
    setDeleteBusy(true);
    try {
      await deleteFlow(detail.id);
      toast({ title: "Flow deleted", variant: "success" });
      navigate("/flows");
    } catch (e) {
      toast({ title: "Could not delete", description: e instanceof Error ? e.message : String(e), variant: "error" });
      setDeleteBusy(false);
      setDeleting(false);
    }
  };

  const like =
    detail.status === "live" || detail.hidden ? (
      <LikeButton
        size="md"
        className={phone ? "h-11 px-4" : undefined}
        count={likeCount}
        liked={liked}
        busy={likes.busy(detail.id) || detail.status !== "live"}
        onToggle={owner ? undefined : toggleLike}
        needsLogin={!likes.loggedIn}
        title={owner ? `${likeCount} like${likeCount === 1 ? "" : "s"} (${likes30d} in the last 30 days)` : !user ? "Log in with Discord to like this flow" : undefined}
      />
    ) : null;
  const more = (
    <MoreMenu
      size={phone ? "touch" : "md"}
      withCopy={phone}
      canReport={!!user && !owner}
      owner={owner}
      onCopy={() => void copyLink()}
      onReport={() => setReporting(true)}
      onEdit={() => setEditing(true)}
      onDelete={() => setDeleting(true)}
    />
  );
  const picture = <LayoutThumb layout={m.heroLayout} cellSize={phone ? 8 : 11} />;
  const hero = detail.thumb ? (
    <InfoHint title="Main layout" width={240} label="About this picture" trigger={picture} className="shrink-0 rounded-control">
      Plot {detail.thumb.plot}'s main layout · {percent(detail.thumb.share)} of the time.
    </InfoHint>
  ) : (
    <span className="shrink-0">{picture}</span>
  );

  const titleBlock = editing ? (
    <EditForm
      detail={detail}
      onCancel={() => setEditing(false)}
      onSaved={(title, description) => {
        onChange({ ...detail, title, description });
        setEditing(false);
      }}
    />
  ) : (
    <div className="min-w-0 flex-1 space-y-1.5">
      <Badges stale={detail.stale} scripted={scripted} stall={m.stall ? starvedText(m.stall.top, m.stepName) : null} stallPlot={m.stall?.plot ?? null} slowing={m.slowing} />
      <h1 className="break-words text-hero text-fg">{detail.title}</h1>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-secondary text-fg-meta">
        <span className="text-fg-muted">
          <AuthorLabel author={detail.author} size={18} />
        </span>
        <span className="tabular-nums">
          {detail.plots} plot{detail.plots === 1 ? "" : "s"}, {steps} step{steps === 1 ? "" : "s"}
        </span>
        <span className="tabular-nums">{detail.cycles.toLocaleString("en-US")} cycles simulated</span>
        <span>Submitted {formatDate(detail.createdAt)}</span>
      </div>
      {!phone && detail.description?.trim() && (
        <div>
          <div className="line-clamp-2">
            <FlowMarkdown text={detail.description} />
          </div>
          <LinkButton onClick={() => setTab("flow")}>Read more</LinkButton>
        </div>
      )}
    </div>
  );

  const notes = [
    !boardListed && { text: `This flow is not entered on the ${BOARD_LABEL[viewer.board]} board.`, warn: true },
    boardListed && !m.cell && { text: `The ${CELL_KIND_LABEL[m.kind]} number isn't verified at this frequency yet.`, warn: false },
    viewer.boardForced && { text: `Only entered on the ${BOARD_LABEL[viewer.board]} board, so it's shown with ${BOARD_LABEL[viewer.board]} prices.`, warn: false },
    boardListed && !m.exact && m.cell && { text: `The ${TIER_LABEL[viewer.tier]} tier isn't verified yet for this flow; showing the Max tier instead.`, warn: true },
  ].filter((n): n is { text: string; warn: boolean } => !!n);

  return (
    <div className="mx-auto max-w-[1100px] space-y-4 py-2 sm:py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link to={backLink} className="focus-ring hit-area inline-flex items-center gap-1 rounded-inner text-secondary text-fg-muted transition-colors duration-(--duration-hover) hover:text-fg">
          <ArrowLeft className="size-3.5" /> Flow rankings
        </Link>
        <AccountControl />
      </div>

      {(owner || admin) && (
        <div className="space-y-3 border-y border-line py-2.5">
          {owner && <StatusBox id={detail.id} initial={detail.status} onLive={onReload} />}
          {admin && <ModerationBox detail={detail} onReload={onReload} />}
        </div>
      )}

      <header className="flex items-start gap-4">
        {!phone && !editing && hero}
        {titleBlock}
        {phone && !editing && hero}
        {!phone && !editing && (
          <div className="flex shrink-0 items-center gap-2">
            <KitButton variant="primary" size="md" onClick={() => navigate(simLink)}>
              <FlaskConical /> Open in simulator
            </KitButton>
            {like}
            <IconButton variant="neutral" size="md" aria-label="Copy link" title="Copy link (Discord embed with the flow's stats)" onClick={() => void copyLink()}>
              <Link2 />
            </IconButton>
            {more}
          </div>
        )}
      </header>

      <SummaryStrip viewer={viewer} m={m} phone={phone} onKind={selectKind} onEditStats={() => setStatsOpen(true)} onImport={() => setImporting(true)} />

      {notes.length > 0 && (
        <div className="space-y-1" role="status">
          {notes.map((n) => (
            <p key={n.text} className={cn("text-secondary", n.warn ? "text-warn" : "text-fg-muted")}>
              {n.text}
            </p>
          ))}
        </div>
      )}

      <DetailTabs detail={detail} viewer={viewer} m={m} tab={tab} onTab={setTab} phone={phone} />

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-meta text-fg-meta">
        <PriceNote viewer={viewer} now={now} />
        <span>
          Updated {formatDate(detail.updatedAt)} · engine {detail.engineVersion?.slice(0, 8) || "?"}
        </span>
      </div>

      {phone && (
        <div className="sticky bottom-[var(--ad-bottom,0px)] z-(--z-bar) -mx-1 flex items-center gap-2 border-t border-line bg-surface-panel px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:-mx-2">
          <KitButton variant="primary" size="touch" className="flex-1" onClick={() => navigate(simLink)}>
            <FlaskConical /> Open in simulator
          </KitButton>
          {like}
          {more}
        </div>
      )}

      <StatsDrawer
        viewer={viewer}
        open={statsOpen}
        onClose={() => setStatsOpen(false)}
        footer={
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-secondary text-fg-muted">
              {CELL_KIND_LABEL[m.kind]} <b className="font-semibold tabular-nums text-coin">{current === null ? "—" : formatCoins(current)}</b>/day
            </span>
            <KitButton size="md" onClick={() => setStatsOpen(false)}>
              Done
            </KitButton>
          </div>
        }
      />
      {importing && <ImportDialog viewer={viewer} onClose={() => setImporting(false)} />}
      {reporting && <ReportDialog id={detail.id} onClose={() => setReporting(false)} />}
      {deleting && (
        <ConfirmDialog title="Delete this flow?" confirmLabel="Delete" tone="problem" busy={deleteBusy} onConfirm={() => void remove()} onClose={() => setDeleting(false)}>
          <p>Delete "{detail.title}" from the leaderboard? This can't be undone.</p>
        </ConfirmDialog>
      )}
    </div>
  );
};

/** Loading (F50): the shape of the page. */
const Skeleton: React.FC = () => (
  <div className="mx-auto max-w-[1100px] space-y-4 py-4" aria-busy>
    <div className="h-5 w-32 rounded-control bg-surface-card" />
    <div className="flex gap-4">
      <div className="hidden size-[118px] rounded-container bg-surface-card sm:block" />
      <div className="flex-1 space-y-2 pt-2">
        <div className="h-5 w-48 max-w-full rounded-control bg-surface-card" />
        <div className="h-3 w-72 max-w-full rounded-control bg-surface-card" />
      </div>
    </div>
    <div className="h-52 rounded-container border border-line bg-surface-card" />
    <div className="h-9 border-b border-line" />
    <span className="sr-only">Loading the flow...</span>
  </div>
);

export const FlowDetailPage: React.FC = () => {
  const { id = "" } = useParams();
  const [state, setState] = useState<{ id: string; detail?: FlowDetail; error?: string; notFound?: boolean } | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let live = true;
    getFlow(id, { adminKey: getAdminKey() })
      .then((detail) => live && setState({ id, detail }))
      .catch((e: unknown) => live && setState({ id, error: e instanceof Error ? e.message : String(e), notFound: e instanceof ApiError && e.status === 404 }));
    return () => {
      live = false;
    };
  }, [id, reload]);
  const onChange = useCallback((detail: FlowDetail) => setState({ id: detail.id, detail }), []);
  const onReload = useCallback(() => setReload((n) => n + 1), []);

  if (!state || state.id !== id) return <Skeleton />;
  if (state.error || !state.detail)
    return (
      <div className="mx-auto max-w-[1100px] space-y-6 py-4">
        <Link to="/flows" className="focus-ring hit-area inline-flex items-center gap-1 rounded-inner text-secondary text-fg-muted transition-colors duration-(--duration-hover) hover:text-fg">
          <ArrowLeft className="size-3.5" /> Flow rankings
        </Link>
        <div className="mx-auto max-w-md space-y-3 py-10 text-center" role={state.notFound ? undefined : "alert"}>
          <p className="text-title text-fg">{state.notFound ? "This flow isn't on the leaderboard" : "Could not load this flow"}</p>
          <p className="break-words text-secondary text-fg-muted">{state.notFound ? "It may have been deleted or hidden, or the link is wrong." : state.error}</p>
          <div className="flex flex-wrap justify-center gap-2">
            {!state.notFound && (
              <KitButton
                variant="primary"
                size="md"
                onClick={() => {
                  setState(null);
                  onReload();
                }}
              >
                <RefreshCw /> Try again
              </KitButton>
            )}
            <Link
              to="/flows"
              className="focus-ring inline-flex h-8 items-center rounded-control border border-line-strong bg-surface-control px-3 text-body font-medium text-fg-body transition-colors duration-(--duration-hover) hover:bg-surface-hover"
            >
              Back to the rankings
            </Link>
          </div>
        </div>
      </div>
    );
  return <FlowDetailView detail={state.detail} onChange={onChange} onReload={onReload} />;
};
