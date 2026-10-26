import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Ban, Eye, EyeOff, Gauge, KeyRound, Lock, RefreshCw, ShieldCheck, Trash2, Undo2 } from "lucide-react";
import { Badge } from "../components/flows/FlowControls";
import { buttonClass, inputClass } from "../components/simulator/styles";
import { SegmentedControl, useToast } from "../components/ui";
import type { AdminFlowRow, AdminStatusFilter } from "../leaderboard/api";
import { boardsText as boardNames, formatDate } from "../leaderboard/view";
import { adminBan, adminDelete, adminHide, adminListFlows, adminSetSubmissionLimit, adminUnban, adminUnhide, clearAdminKey, getAdminKey, hiddenReasonLabel, setAdminKey, verifyAdminKey } from "../services/adminService";

/**
 * /flows/admin: the leaderboard moderation queue (docs/plans/flow-leaderboard.md §8 Phase 3). Reached
 * by URL only; the admin key is checked with the API and kept in sessionStorage.
 */

const FILTERS: { value: AdminStatusFilter; label: string }[] = [
  { value: "", label: "All" },
  { value: "reported", label: "Reported" },
  { value: "hidden", label: "Hidden" },
  { value: "pending", label: "Pending" },
  { value: "rejected", label: "Rejected" },
  { value: "live", label: "Live" },
];

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
    <form onSubmit={submit} className="max-w-sm mx-auto bg-slate-800/40 border border-slate-600/30 rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
        <KeyRound className="w-4 h-4 text-amber-400" /> Admin key
      </div>
      <p className="text-xs text-slate-400">Moderation needs the API's admin key. It is kept for this tab only.</p>
      <input type="password" autoComplete="current-password" className={`${inputClass} w-full text-sm py-1.5`} placeholder="Admin key" aria-label="Admin key" value={key} onChange={(e) => setKey(e.target.value)} />
      {error && <div className="text-xs text-red-300 break-words" role="alert">{error}</div>}
      <button type="submit" className={buttonClass.primary} disabled={busy || !key.trim()}>
        <ShieldCheck className="w-3.5 h-3.5" /> {busy ? "Checking..." : "Unlock"}
      </button>
    </form>
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

const Author: React.FC<{ row: AdminFlowRow }> = ({ row }) => (
  <div className="min-w-0">
    <div className="text-slate-200 break-words">{authorName(row)}</div>
    <div className="text-[10px] text-slate-500 tabular-nums break-all">
      {row.author_username && row.author_global_name ? `@${row.author_username} · ` : ""}
      {row.owner_id}
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
    <ul className="mt-1 space-y-0.5 text-[11px] text-slate-400">
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

type Action = "hide" | "unhide" | "delete" | "ban" | "unban" | "limit";
type Act = (row: AdminFlowRow, action: Action) => void;

/** `compact`: a tight 2-column block for the table's actions column; otherwise 2 columns on phones, one row from `sm`. */
const Actions: React.FC<{ row: AdminFlowRow; busy: boolean; act: Act; compact?: boolean }> = ({ row, busy, act, compact }) => (
  <div className={`grid grid-cols-2 [&>button]:justify-center ${compact ? "gap-1 [&>button]:px-2 [&>button]:py-1" : "sm:grid-cols-5 gap-1.5"}`}>
    {row.status === "hidden" ? (
      <button type="button" className={buttonClass.neutral} disabled={busy} onClick={() => act(row, "unhide")}>
        <Eye className="w-3.5 h-3.5" /> Unhide
      </button>
    ) : (
      <button type="button" className={buttonClass.neutral} disabled={busy} onClick={() => act(row, "hide")}>
        <EyeOff className="w-3.5 h-3.5" /> Hide
      </button>
    )}
    <button type="button" className={buttonClass.danger} disabled={busy} onClick={() => act(row, "delete")}>
      <Trash2 className="w-3.5 h-3.5" /> Delete
    </button>
    <button type="button" className={buttonClass.danger} disabled={busy || !row.owner_id} onClick={() => act(row, "ban")} title="Ban the author: hides all their entries">
      <Ban className="w-3.5 h-3.5" /> Ban
    </button>
    <button type="button" className={buttonClass.neutral} disabled={busy || !row.owner_id} onClick={() => act(row, "unban")} title="Lift a ban on the author: restores the entries the ban hid">
      <Undo2 className="w-3.5 h-3.5" /> Unban
    </button>
    <button
      type="button"
      className={`${buttonClass.neutral} ${compact ? "col-span-2" : "col-span-2 sm:col-span-1"}`}
      disabled={busy || !row.owner_id}
      onClick={() => act(row, "limit")}
      title="Set how many flows the author may submit per 24 hours"
    >
      <Gauge className="w-3.5 h-3.5" /> Limit
    </button>
  </div>
);

const Title: React.FC<{ row: AdminFlowRow; className?: string }> = ({ row, className = "" }) => (
  <Link to={`/flows/${row.id}`} className={`text-slate-100 hover:text-emerald-300 font-medium break-words ${className}`}>
    {row.title}
  </Link>
);

export const AdminTable: React.FC<{ rows: AdminFlowRow[]; busy: string | null; act: Act }> = ({ rows, busy, act }) => (
  <div className="hidden lg:block overflow-x-auto">
    <table className="w-full text-xs" data-testid="admin-table">
      <thead>
        <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-700/60 whitespace-nowrap">
          <th className="font-medium py-2 pr-3">Flow</th>
          <th className="font-medium py-2 pr-3">Author</th>
          <th className="font-medium py-2 pr-3">Status</th>
          <th className="font-medium py-2 pr-3 text-right">Reports</th>
          <th className="font-medium py-2 pr-2">Actions</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className="border-b border-slate-700/30 align-top hover:bg-slate-700/20">
            <td className="py-2 pr-3 min-w-[14rem]">
              <Title row={row} />
              <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-slate-400">
                <span className="font-mono text-slate-500">{row.id}</span>
                <span>{boardsText(row)}</span>
                <span>
                  {row.plots} plot{row.plots === 1 ? "" : "s"} · {row.cycles.toLocaleString()} cycles
                </span>
                <span>{formatDate(row.created_at)}</span>
              </div>
              {row.reject_reason && <div className="mt-1 text-[11px] text-red-300 break-words">Rejected: {row.reject_reason}</div>}
              <Reports row={row} />
            </td>
            <td className="py-2 pr-3 w-[11rem] max-w-[11rem]">
              <Author row={row} />
            </td>
            <td className="py-2 pr-3 w-[7rem]">
              <StatusCell row={row} />
            </td>
            <td className={`py-2 pr-3 text-right tabular-nums ${row.report_count ? "text-amber-300 font-medium" : "text-slate-500"}`}>{row.report_count}</td>
            <td className="py-1.5 pr-2 w-[11rem]">
              <Actions row={row} busy={busy === row.id} act={act} compact />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const Fact: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="min-w-0">
    <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
    <div className="text-slate-200 break-words">{children}</div>
  </div>
);

export const AdminCards: React.FC<{ rows: AdminFlowRow[]; busy: string | null; act: Act }> = ({ rows, busy, act }) => (
  <ul className="lg:hidden space-y-2" data-testid="admin-cards">
    {rows.map((row) => (
      <li key={row.id} className="rounded-lg border border-slate-700/60 bg-slate-800/40 p-3 space-y-2 text-xs">
        <div className="min-w-0">
          <Title row={row} className="text-sm" />
          <div className="text-[10px] text-slate-500 font-mono">{row.id}</div>
        </div>
        <StatusCell row={row} />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-2">
          <Fact label="Author">
            <Author row={row} />
          </Fact>
          <Fact label="Reports">
            <span className={row.report_count ? "text-amber-300 font-medium" : "text-slate-400"}>{row.report_count}</span>
          </Fact>
          <Fact label="Boards">{boardsText(row)}</Fact>
          <Fact label="Plots · cycles">
            {row.plots} · {row.cycles.toLocaleString()}
          </Fact>
          <Fact label="Submitted">{formatDate(row.created_at)}</Fact>
        </div>
        {row.reject_reason && <div className="text-[11px] text-red-300 break-words">Rejected: {row.reject_reason}</div>}
        <Reports row={row} />
        <Actions row={row} busy={busy === row.id} act={act} />
      </li>
    ))}
  </ul>
);

const DONE: Record<string, string> = { hide: "Hidden", unhide: "Unhidden", delete: "Deleted", ban: "Author banned", unban: "Author unbanned", limit: "Submission limit set" };

/**
 * Prompts for a submissions-per-24h limit: a whole number, or blank / "default" for the default.
 * Returns undefined when cancelled or invalid.
 */
function promptLimit(who: string, current: number | null): number | null | undefined {
  const r = window.prompt(`Submissions per 24 hours for ${who}.\nEnter a number (e.g. 50), or leave blank for the default.`, current === null ? "" : String(current));
  if (r === null) return undefined;
  const t = r.trim().toLowerCase();
  if (t === "" || t === "default") return null;
  if (!/^\d+$/.test(t)) {
    window.alert("Enter a whole number, or leave it blank for the default.");
    return undefined;
  }
  return Number(t);
}

export const AdminQueue: React.FC<{ onLock: () => void; initialFilter?: AdminStatusFilter }> = ({ onLock, initialFilter = "reported" }) => {
  const { toast } = useToast();
  const [filter, setFilter] = useState<AdminStatusFilter>(initialFilter);
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<{ key: string; rows?: AdminFlowRow[]; error?: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
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

  const act: Act = async (row, action) => {
    const who = `${authorName(row)} (${row.owner_id})`;
    let reason = "";
    if (action === "delete" && !window.confirm(`Delete "${row.title}" for good? This can't be undone.`)) return;
    if (action === "ban") {
      const r = window.prompt(`Ban ${who}? All their entries get hidden.\nReason (optional):`, "");
      if (r === null) return;
      reason = r;
      if (!window.confirm(`Ban ${who}${reason ? ` for "${reason}"` : ""}?`)) return;
    }
    if (action === "unban" && !window.confirm(`Unban ${who}? Entries hidden by the ban come back.`)) return;
    let limit: number | null = null;
    if (action === "limit") {
      const l = promptLimit(who, row.author_submission_limit);
      if (l === undefined) return;
      limit = l;
    }
    setBusy(row.id);
    try {
      let description = action === "ban" || action === "unban" ? who : row.title;
      if (action === "hide") await adminHide(row.id);
      else if (action === "unhide") await adminUnhide(row.id);
      else if (action === "delete") await adminDelete(row.id);
      else if (action === "ban") await adminBan(row.owner_id, reason);
      else if (action === "limit") {
        const r = await adminSetSubmissionLimit(row.owner_id, limit);
        description = `${who}: ${r.effectiveLimit} per 24 h${r.limit === null ? " (default)" : ""} · ${r.used24h} used`;
      } else await adminUnban(row.owner_id);
      toast({ title: DONE[action], description, variant: "success" });
    } catch (e) {
      toast({ title: `Could not ${action}`, description: message(e), variant: "error" });
      if (!getAdminKey()) onLock();
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const rows = result?.rows ?? [];
  return (
    <>
      <section className="bg-slate-800/40 border border-slate-600/30 rounded-lg p-3 sm:p-4 flex flex-wrap items-center gap-2">
        <SegmentedControl<AdminStatusFilter> size="xs" className="flex-wrap [&>button]:flex-none" value={filter} onChange={setFilter} options={FILTERS} />
        <button type="button" className={buttonClass.neutral} onClick={refresh} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
        {!loading && !result?.error && <span className="text-xs text-slate-500">{rows.length} entr{rows.length === 1 ? "y" : "ies"}</span>}
        <button type="button" className={`${buttonClass.neutral} ml-auto`} onClick={onLock}>
          <Lock className="w-3.5 h-3.5" /> Lock
        </button>
      </section>
      <section className="bg-slate-800/40 border border-slate-600/30 rounded-lg p-2 sm:p-4">
        {loading && rows.length === 0 ? (
          <div className="py-10 text-center text-xs text-slate-400">Loading...</div>
        ) : result?.error && !loading ? (
          <div className="py-8 text-center text-xs text-red-300 break-words">Could not load the queue: {result.error}</div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-xs text-slate-400">Nothing here.</div>
        ) : (
          <div className={loading ? "opacity-60 transition-opacity" : ""}>
            <AdminTable rows={rows} busy={busy} act={act} />
            <AdminCards rows={rows} busy={busy} act={act} />
          </div>
        )}
      </section>
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
    <div className="container mx-auto px-2 sm:px-4 py-4 sm:py-6 max-w-screen-2xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-amber-400" />
        <h1 className="text-sm font-medium text-slate-200">Leaderboard moderation</h1>
        <Link to="/flows" className="text-xs text-slate-400 hover:text-slate-200">
          Back to the leaderboard
        </Link>
      </div>
      {key ? <AdminQueue onLock={lock} /> : <AdminKeyForm onUnlocked={setKey} />}
    </div>
  );
};
