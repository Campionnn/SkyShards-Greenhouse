import React, { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Ban, Eye, EyeOff, Gauge, Lock, RefreshCw, ShieldCheck, Trash2, Undo2 } from "lucide-react";
import { Badge } from "../components/flows/FlowControls";
import { Card } from "../components/ui/Card";
import { cn } from "../components/ui/cn";
import { KitButton, KitInput, TabPanel, Tabs } from "../components/ui/kit";
import { surface } from "../components/ui/surface";
import { useToast } from "../components/ui/toastContext";
import type { AdminFlowRow, AdminStatusFilter } from "../leaderboard/api";
import { boardsText as boardNames, formatDate } from "../leaderboard/view";
import { adminBan, adminDelete, adminHide, adminListFlows, adminSetSubmissionLimit, adminUnban, adminUnhide, clearAdminKey, getAdminKey, hiddenReasonLabel, setAdminKey, verifyAdminKey } from "../services/adminService";
import { BanDialog, ConfirmDialog, LimitDialog, Who } from "./flowsAdminDialogs";

/**
 * /flows/admin: the leaderboard moderation queue (docs/plans/flow-leaderboard.md §8 Phase 3). Reached
 * by URL only; the admin key is checked with the API and kept in sessionStorage. The status filter
 * is `?status=` (omitted for the default, Reported; `all` for All).
 */

const FILTERS: { value: AdminStatusFilter; label: string }[] = [
  { value: "", label: "All" },
  { value: "reported", label: "Reported" },
  { value: "hidden", label: "Hidden" },
  { value: "pending", label: "Pending" },
  { value: "rejected", label: "Rejected" },
  { value: "live", label: "Live" },
];

/** `?status=` ↔ filter. "" (All) is written as `all`; anything unknown falls back to the default. */
const statusFromUrl = (raw: string | null, fallback: AdminStatusFilter): AdminStatusFilter => {
  if (raw === null) return fallback;
  if (raw === "all" || raw === "") return "";
  return FILTERS.find((f) => f.value === raw)?.value ?? fallback;
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const AdminKeyForm: React.FC<{ onUnlocked: (key: string) => void }> = ({ onUnlocked }) => {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await verifyAdminKey(key);
      setAdminKey(key.trim());
      onUnlocked(key.trim());
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Admin key" className="max-w-sm">
      <form onSubmit={submit} className="space-y-3">
        <p className="text-secondary text-fg-muted">Moderation needs the API's admin key. It is kept for this tab only.</p>
        <KitInput type="password" autoComplete="current-password" className="w-full" placeholder="Admin key" aria-label="Admin key" value={key} onChange={(e) => setKey(e.target.value)} />
        {error && (
          <div className="break-words text-secondary text-problem" role="alert">
            {error}
          </div>
        )}
        {/* Disabled: the kit's 40% primary, still a visible green button. */}
        <KitButton type="submit" variant="primary" size="md" disabled={busy || !key.trim()}>
          <ShieldCheck /> {busy ? "Checking..." : "Unlock"}
        </KitButton>
      </form>
    </Card>
  );
};

const statusTone = (s: string) => (s === "live" ? "new" : s === "rejected" ? "danger" : s === "hidden" ? "stale" : "pending");

const StatusCell: React.FC<{ row: AdminFlowRow }> = ({ row }) => {
  const why = row.status === "hidden" ? hiddenReasonLabel(row.hidden_reason) : null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge tone={statusTone(row.status)}>{row.status}</Badge>
      {why && (
        <Badge tone={row.hidden_reason === "ban" ? "danger" : "estimated"} title={row.prev_status ? `Was ${row.prev_status} before` : undefined}>
          {why}
        </Badge>
      )}
      {row.author_banned_at !== null && row.hidden_reason !== "ban" && <Badge tone="danger">author banned</Badge>}
    </span>
  );
};

const authorName = (row: AdminFlowRow) => row.author_global_name || row.author_username || "unknown";

/** The snowflake id never splits mid-number: the line wraps at the "·" and the id truncates (with a title) if it alone doesn't fit. */
const Author: React.FC<{ row: AdminFlowRow }> = ({ row }) => (
  <div className="min-w-0">
    <div className="break-words text-fg-body">{authorName(row)}</div>
    <div className="flex min-w-0 flex-wrap gap-x-1 text-meta tabular-nums text-fg-meta">
      {row.author_username && row.author_global_name ? <span className="min-w-0 break-words">@{row.author_username} ·</span> : null}
      <span className="max-w-full truncate whitespace-nowrap" title={row.owner_id}>
        {row.owner_id}
      </span>
    </div>
    {row.author_submission_limit !== null && (
      <div className="mt-0.5">
        <Badge tone="new" title="This author's own submission limit (set by an admin)">
          {row.author_submission_limit} / day
        </Badge>
      </div>
    )}
  </div>
);

const boardsText = (row: AdminFlowRow) => boardNames(row.boards);

const Reports: React.FC<{ row: AdminFlowRow }> = ({ row }) =>
  row.reports.some((r) => r.reason) ? (
    <ul className="mt-1 space-y-0.5 text-meta text-fg-muted">
      {row.reports
        .filter((r) => r.reason)
        .slice(0, 5)
        .map((r, i) => (
          <li key={i} className="break-words">
            “{r.reason}”
          </li>
        ))}
    </ul>
  ) : null;

const ReportCount: React.FC<{ n: number }> = ({ n }) => <span className={cn("tabular-nums", n ? "font-semibold text-warn" : "text-fg-meta")}>{n}</span>;

type Action = "hide" | "unhide" | "delete" | "ban" | "unban" | "limit";
type Act = (row: AdminFlowRow, action: Action) => void;

/** `compact`: a tight 2-column block for the table's actions column; otherwise 2 columns on phones, one row from `sm`. */
const Actions: React.FC<{ row: AdminFlowRow; busy: boolean; act: Act; compact?: boolean }> = ({ row, busy, act, compact }) => {
  const size = compact ? "sm" : "md";
  return (
    <div className={cn("grid grid-cols-2", compact ? "gap-1 [&>button]:px-2" : "gap-1.5 sm:grid-cols-5")}>
      {row.status === "hidden" ? (
        <KitButton size={size} disabled={busy} onClick={() => act(row, "unhide")}>
          <Eye /> Unhide
        </KitButton>
      ) : (
        <KitButton size={size} disabled={busy} onClick={() => act(row, "hide")}>
          <EyeOff /> Hide
        </KitButton>
      )}
      <KitButton size={size} variant="danger" disabled={busy} onClick={() => act(row, "delete")}>
        <Trash2 /> Delete
      </KitButton>
      <KitButton size={size} variant="danger" disabled={busy || !row.owner_id} onClick={() => act(row, "ban")} title="Ban the author: hides all their entries">
        <Ban /> Ban
      </KitButton>
      <KitButton size={size} disabled={busy || !row.owner_id} onClick={() => act(row, "unban")} title="Lift a ban on the author: restores the entries the ban hid">
        <Undo2 /> Unban
      </KitButton>
      <KitButton
        size={size}
        className={compact ? "col-span-2" : "col-span-2 sm:col-span-1"}
        disabled={busy || !row.owner_id}
        onClick={() => act(row, "limit")}
        title="Set how many flows the author may submit per 24 hours"
      >
        <Gauge /> Limit
      </KitButton>
    </div>
  );
};

const Title: React.FC<{ row: AdminFlowRow; className?: string }> = ({ row, className }) => (
  <Link
    to={`/flows/${row.id}`}
    className={cn(
      "focus-ring rounded-inner break-words font-semibold text-fg underline-offset-[3px] decoration-fg-meta transition-colors duration-(--duration-hover) hover:text-select-fg hover:underline",
      className,
    )}
  >
    {row.title}
  </Link>
);

const TH = "py-2 pr-3 text-label font-semibold uppercase text-fg-meta";

export const AdminTable: React.FC<{ rows: AdminFlowRow[]; busy: string | null; act: Act }> = ({ rows, busy, act }) => (
  <div className="hidden overflow-x-auto lg:block">
    <table className="w-full text-secondary" data-testid="admin-table">
      <thead>
        <tr className="whitespace-nowrap border-b border-line text-left">
          <th className={TH}>Flow</th>
          <th className={TH}>Author</th>
          <th className={TH}>Status</th>
          <th className={cn(TH, "text-right")}>Reports</th>
          <th className={cn(TH, "pr-2")}>Actions</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className="border-b border-line align-top transition-colors duration-(--duration-hover) hover:bg-surface-hover/40">
            <td className="min-w-[14rem] py-2 pr-3">
              <Title row={row} className="text-body" />
              <div className="mt-0.5 flex flex-wrap gap-x-2 text-meta text-fg-muted">
                <span className="font-mono text-fg-meta">{row.id}</span>
                <span>{boardsText(row)}</span>
                <span>
                  {row.plots} plot{row.plots === 1 ? "" : "s"} · {row.cycles.toLocaleString()} cycles
                </span>
                <span>{formatDate(row.created_at)}</span>
              </div>
              {row.reject_reason && <div className="mt-1 break-words text-meta text-problem">Rejected: {row.reject_reason}</div>}
              <Reports row={row} />
            </td>
            <td className="w-[11rem] max-w-[11rem] py-2 pr-3">
              <Author row={row} />
            </td>
            <td className="w-[7rem] py-2 pr-3">
              <StatusCell row={row} />
            </td>
            <td className="py-2 pr-3 text-right">
              <ReportCount n={row.report_count} />
            </td>
            <td className="w-[11rem] py-1.5 pr-2">
              <Actions row={row} busy={busy === row.id} act={act} compact />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const CardFact: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="min-w-0">
    <div className="text-label uppercase text-fg-meta">{label}</div>
    <div className="break-words text-fg-body">{children}</div>
  </div>
);

export const AdminCards: React.FC<{ rows: AdminFlowRow[]; busy: string | null; act: Act }> = ({ rows, busy, act }) => (
  <ul className="space-y-2 lg:hidden" data-testid="admin-cards">
    {rows.map((row) => (
      <li key={row.id} className={cn(surface.card, "space-y-2 p-3 text-secondary")}>
        <div className="min-w-0">
          <Title row={row} className="text-body" />
          <div className="font-mono text-meta text-fg-meta">{row.id}</div>
        </div>
        <StatusCell row={row} />
        <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">
          <CardFact label="Author">
            <Author row={row} />
          </CardFact>
          <CardFact label="Reports">
            <ReportCount n={row.report_count} />
          </CardFact>
          <CardFact label="Boards">{boardsText(row)}</CardFact>
          <CardFact label="Plots · cycles">
            <span className="tabular-nums">
              {row.plots} · {row.cycles.toLocaleString()}
            </span>
          </CardFact>
          <CardFact label="Submitted">{formatDate(row.created_at)}</CardFact>
        </div>
        {row.reject_reason && <div className="break-words text-meta text-problem">Rejected: {row.reject_reason}</div>}
        <Reports row={row} />
        <Actions row={row} busy={busy === row.id} act={act} />
      </li>
    ))}
  </ul>
);

const DONE: Record<string, string> = { hide: "Hidden", unhide: "Unhidden", delete: "Deleted", ban: "Author banned", unban: "Author unbanned", limit: "Submission limit set" };

/** The actions that ask first, in a dialog. */
type Asking = { row: AdminFlowRow; action: "delete" | "ban" | "unban" | "limit" };

export const AdminQueue: React.FC<{ onLock: () => void; initialFilter?: AdminStatusFilter }> = ({ onLock, initialFilter = "reported" }) => {
  const { toast } = useToast();
  const [search, setSearch] = useSearchParams();
  const filter = statusFromUrl(search.get("status"), initialFilter);
  const setFilter = useCallback(
    (v: AdminStatusFilter) =>
      setSearch(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (v === initialFilter) next.delete("status");
          else next.set("status", v || "all");
          return next;
        },
        { replace: true },
      ),
    [setSearch, initialFilter],
  );
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<{ key: string; rows?: AdminFlowRow[]; error?: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [asking, setAsking] = useState<Asking | null>(null);
  const key = `${filter}|${reload}`;
  const loading = !result || result.key !== key;

  useEffect(() => {
    let live = true;
    adminListFlows(filter)
      .then((rows) => live && setResult({ key, rows }))
      .catch((e: unknown) => {
        if (!live) return;
        setResult({ key, error: message(e) });
        // The key was wrong after all (cleared by adminService): back to the form.
        if (!getAdminKey()) onLock();
      });
    return () => {
      live = false;
    };
  }, [key, filter, onLock]);

  const refresh = useCallback(() => setReload((n) => n + 1), []);

  /** Runs one action (already confirmed), toasts the outcome and refreshes the list. */
  const run = async (row: AdminFlowRow, action: Action, opts: { reason?: string; limit?: number | null } = {}) => {
    const who = `${authorName(row)} (${row.owner_id})`;
    setBusy(row.id);
    try {
      let description = action === "ban" || action === "unban" ? who : row.title;
      if (action === "hide") await adminHide(row.id);
      else if (action === "unhide") await adminUnhide(row.id);
      else if (action === "delete") await adminDelete(row.id);
      else if (action === "ban") await adminBan(row.owner_id, opts.reason ?? "");
      else if (action === "limit") {
        const r = await adminSetSubmissionLimit(row.owner_id, opts.limit ?? null);
        description = `${who}: ${r.effectiveLimit} per 24 h${r.limit === null ? " (default)" : ""} · ${r.used24h} used`;
      } else await adminUnban(row.owner_id);
      toast({ title: DONE[action], description, variant: "success" });
    } catch (e) {
      toast({ title: `Could not ${action}`, description: message(e), variant: "error" });
      if (!getAdminKey()) onLock();
    } finally {
      setBusy(null);
      setAsking(null);
      refresh();
    }
  };

  const act: Act = (row, action) => {
    if (action === "hide" || action === "unhide") void run(row, action);
    else setAsking({ row, action });
  };

  const close = () => setAsking(null);
  const askBusy = asking !== null && busy === asking.row.id;

  const rows = result?.rows ?? [];
  return (
    <>
      <section className={cn(surface.card, "flex flex-wrap items-center gap-x-3 gap-y-2 px-2 py-2 sm:px-4")}>
        <Tabs<AdminStatusFilter> label="Status" idPrefix="admin-status" scroll className="min-w-0 max-w-full border-b-0" value={filter} onChange={setFilter} items={FILTERS} />
        <KitButton size="md" onClick={refresh} disabled={loading}>
          <RefreshCw className={loading ? "animate-spin motion-reduce:animate-pulse" : undefined} /> Refresh
        </KitButton>
        <span className="text-secondary tabular-nums text-fg-meta" aria-live="polite">
          {!loading && !result?.error ? `${rows.length} entr${rows.length === 1 ? "y" : "ies"}` : ""}
        </span>
        <KitButton size="md" className="ml-auto" onClick={onLock}>
          <Lock /> Lock
        </KitButton>
      </section>
      <TabPanel idPrefix="admin-status" value={filter} className={cn(surface.card, "p-2 sm:p-4")}>
        {loading && rows.length === 0 ? (
          <div className="py-10 text-center text-secondary text-fg-muted">Loading...</div>
        ) : result?.error && !loading ? (
          <div className="break-words py-8 text-center text-secondary text-problem" role="alert">
            Could not load the queue: {result.error}
          </div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-secondary text-fg-muted">Nothing here.</div>
        ) : (
          <div className={loading ? "opacity-60 transition-opacity duration-(--duration-hover)" : undefined}>
            <AdminTable rows={rows} busy={busy} act={act} />
            <AdminCards rows={rows} busy={busy} act={act} />
          </div>
        )}
      </TabPanel>
      {asking?.action === "delete" && (
        <ConfirmDialog title="Delete flow" confirmLabel={<><Trash2 /> Delete</>} tone="problem" busy={askBusy} onConfirm={() => void run(asking.row, "delete")} onClose={close}>
          <p>
            Delete “<b className="break-words font-semibold text-fg">{asking.row.title}</b>” for good? This can't be undone.
          </p>
        </ConfirmDialog>
      )}
      {asking?.action === "ban" && (
        <BanDialog name={authorName(asking.row)} id={asking.row.owner_id} busy={askBusy} onConfirm={(reason) => void run(asking.row, "ban", { reason })} onClose={close} />
      )}
      {asking?.action === "unban" && (
        <ConfirmDialog title="Unban author" confirmLabel={<><Undo2 /> Unban</>} busy={askBusy} onConfirm={() => void run(asking.row, "unban")} onClose={close}>
          <p>
            Unban <Who name={authorName(asking.row)} id={asking.row.owner_id} />? Entries hidden by the ban come back.
          </p>
        </ConfirmDialog>
      )}
      {asking?.action === "limit" && (
        <LimitDialog
          name={authorName(asking.row)}
          id={asking.row.owner_id}
          current={asking.row.author_submission_limit}
          busy={askBusy}
          onConfirm={(limit) => void run(asking.row, "limit", { limit })}
          onClose={close}
        />
      )}
    </>
  );
};

export const FlowsAdminPage: React.FC = () => {
  const [key, setKey] = useState<string | null>(() => getAdminKey());
  const lock = useCallback(() => {
    clearAdminKey();
    setKey(null);
  }, []);
  return (
    <div className="w-full space-y-4 py-3 sm:py-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-title text-fg">Leaderboard moderation</h1>
        <Link to="/flows" className="focus-ring rounded-inner text-secondary text-fg-muted transition-colors duration-(--duration-hover) hover:text-fg">
          Back to the leaderboard
        </Link>
      </div>
      {key ? <AdminQueue onLock={lock} /> : <AdminKeyForm onUnlocked={setKey} />}
    </div>
  );
};
