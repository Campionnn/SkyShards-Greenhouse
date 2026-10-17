import React, { useEffect, useMemo, useState } from "react";
import { Flag, Loader2 } from "lucide-react";
import type { FlowDetail, FlowSeedResult, FlowStatusResponse } from "../../leaderboard/api";
import type { RunResult } from "../../leaderboard/result";
import type { Board } from "../../leaderboard/rules";
import { valueResult, type Quotes } from "../../leaderboard/pricing";
import { spreadRatio } from "../../leaderboard/result";
import { BOARD_LABEL, effortText, percent, ratioText, suppliesOf, suppliesText, TIER_LABEL, type FrequencyPoint, type ItemLine } from "../../leaderboard/view";
import type { TierId } from "../../leaderboard/tiers";
import type { BazaarPricing } from "../../simulator";
import { defaultGameData } from "../../simulator";
import { getFlowStatus, reportFlow } from "../../services/flowsService";
import { LayoutPreview } from "../designer";
import { CropImage } from "../shared";
import { Stat } from "../simulator/controls";
import { formatCoins, formatRate, nameOf } from "../simulator/format";
import { layoutToPlacements } from "../simulator/scenarioEdit";
import { buttonClass, inputClass } from "../simulator/styles";
import { SectionLabel, useToast } from "../ui";
import { Badge } from "./FlowControls";
import { DialogFrame, ModalDialog } from "./ModalDialog";

const DATA = defaultGameData();

const EFFORT_LABEL: Record<string, string> = {
  water: "Watering",
  harvest: "Harvests",
  minigame: "Minigame harvests",
  replant: "Replants",
  place: "Placements",
  remove: "Removals",
  replace: "Replacements before decay",
  roots: "Root clearing",
  ground: "Ground fixes",
  gate: "Gate interactions",
  noctilume: "Noctilume time changes",
  stepChange: "Step changes",
  bazaar: "Bazaar visits",
};

/** (a) The chosen cell's numbers. */
export const CellNumbers: React.FC<{
  result: RunResult;
  board: Board;
  quotes: Quotes;
  pricing: BazaarPricing;
  seeds: number;
  spread: number | null;
}> = ({ result, board, quotes, pricing, seeds, spread }) => {
  const v = valueResult(DATA, result, board, board === "normal" ? quotes : {}, pricing);
  const byKind = Object.entries(result.effort.byKind)
    .filter(([, n]) => (n ?? 0) > 0)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
      <div>
        <SectionLabel>Money</SectionLabel>
        <Stat label="Profit / day" value={<span className="text-emerald-300 font-medium">{formatCoins(v.profitPerDay)}</span>} />
        <Stat label="Revenue / day" value={formatCoins(v.revenuePerDay)} />
        {board === "normal" ? (
          <>
            <Stat label="Supplies bought / day" value={formatCoins(v.boughtPerDay)} />
            <Stat label="Setup build cost (once)" value={formatCoins(v.buildCost)} title="Buying the items the first layouts place. Not part of the profit." />
          </>
        ) : (
          <Stat label="Supplies to farm / day" value={suppliesText(suppliesOf(result))} title="Dead Plants and Fermento placed per day (free on the server; you farm them yourself)" />
        )}
        {v.unpriced.length > 0 && <div className="text-[11px] text-amber-300 mt-1">No price for: {v.unpriced.map(nameOf).join(", ")}</div>}
        <div className="mt-3">
          <SectionLabel>Run</SectionLabel>
          <Stat label="Checked-target uptime" value={percent(result.uptime)} />
          <Stat label="Sustainable" value={result.sustainable ? "yes" : "no"} tone={result.sustainable ? "good" : "bad"} />
          <Stat label="Seeds" value={seeds} />
          <Stat label="Seed spread (best / median)" value={ratioText(spread)} tone={spread !== null && spread > 2 ? "bad" : undefined} />
          <Stat label="Simulated" value={`${result.cycles.toLocaleString()} cycles (${result.days.toFixed(1)} days)`} />
        </div>
      </div>
      <div>
        <SectionLabel>Effort per login</SectionLabel>
        <Stat label="Average / heaviest" value={effortText(result.effort.avg, result.effort.peak)} />
        <Stat label="Logins" value={result.effort.sessions.toLocaleString()} />
        {byKind.length > 0 && (
          <ul className="mt-2 space-y-0.5" aria-label="Effort by kind">
            {byKind.map(([k, n]) => (
              <li key={k}>
                <Stat label={EFFORT_LABEL[k] ?? k} value={`${formatRate(n ?? 0)} per login`} tone="muted" />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

/** (b) Profit per day across online frequencies: a plain SVG bar chart. */
export const FrequencyChart: React.FC<{ points: FrequencyPoint[]; selected: number; onSelect?: (every: number) => void }> = ({ points, selected, onSelect }) => {
  const max = Math.max(1, ...points.map((p) => p.profitPerDay ?? 0));
  // A small viewBox keeps the labels readable when the chart shrinks to a phone's width.
  const W = 400;
  const H = 190;
  const pad = { l: 4, r: 4, t: 24, b: 30 };
  const slot = (W - pad.l - pad.r) / points.length;
  const bar = Math.min(48, slot * 0.6);
  const ih = H - pad.t - pad.b;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto max-w-2xl" role="img" aria-label="Profit per day by online frequency">
      <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke="rgb(71 85 105)" strokeWidth={1} />
      {points.map((p, i) => {
        const x = pad.l + slot * i + (slot - bar) / 2;
        const value = p.profitPerDay ?? 0;
        const h = p.profitPerDay === null ? 0 : Math.max(1, (Math.max(0, value) / max) * ih);
        const active = p.every === selected;
        return (
          <g key={p.every} onClick={() => onSelect?.(p.every)} style={{ cursor: onSelect ? "pointer" : undefined }}>
            <title>{`Online every ${p.every} cycle${p.every === 1 ? "" : "s"}: ${p.profitPerDay === null ? "not verified" : `${formatCoins(value)} / day`}`}</title>
            <rect x={pad.l + slot * i} y={pad.t - 16} width={slot} height={H - pad.t + 16} fill="transparent" />
            <rect x={x} y={H - pad.b - h} width={bar} height={h} rx={3} fill={active ? "rgb(52 211 153)" : "rgb(52 211 153 / 0.35)"} />
            <text x={x + bar / 2} y={H - pad.b - h - 6} textAnchor="middle" fontSize={13} fontWeight={active ? 600 : 400} fill={active ? "rgb(209 250 229)" : "rgb(148 163 184)"}>
              {p.profitPerDay === null ? "n/a" : formatCoins(value)}
            </text>
            <text x={x + bar / 2} y={H - pad.b + 18} textAnchor="middle" fontSize={14} fill={active ? "rgb(226 232 240)" : "rgb(100 116 139)"}>
              {p.every}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

/** (c) Per-item breakdown. */
export const ItemBreakdown: React.FC<{ lines: ItemLine[] }> = ({ lines }) => {
  if (!lines.length) return <p className="text-xs text-slate-500">Nothing produced in this cell.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-700/60">
            <th className="font-medium py-1.5 pr-3">Item</th>
            <th className="font-medium py-1.5 pr-3 text-right">Per day</th>
            <th className="font-medium py-1.5 pr-3 text-right">Unit price</th>
            <th className="font-medium py-1.5 text-right">Coins / day</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={`${l.kind}-${l.item}`} className="border-b border-slate-700/30">
              <td className="py-1.5 pr-3">
                <span className="flex items-center gap-2 min-w-0">
                  <CropImage cropId={l.item} cropName={nameOf(l.item)} size="custom" width={20} height={20} showFallback />
                  <span className="text-slate-200 break-words">
                    {nameOf(l.item)}
                    {l.kind === "bought" && <span className="text-slate-500"> (bought)</span>}
                  </span>
                </span>
              </td>
              <td className="py-1.5 pr-3 text-right tabular-nums text-slate-300">{formatRate(l.perDay)}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums text-slate-400">{l.unitPrice === null ? "no price" : formatCoins(l.unitPrice)}</td>
              <td className={`py-1.5 text-right tabular-nums ${l.coinsPerDay < 0 ? "text-red-300" : "text-emerald-300"}`}>{formatCoins(l.coinsPerDay)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/** (d) Each plot's first-step layout. */
export const LayoutThumbs: React.FC<{ detail: FlowDetail }> = ({ detail }) => {
  const plots = useMemo(
    () =>
      (detail.payload?.plots ?? []).map((p) => {
        const step = p.flow.steps[p.flow.startIndex] ?? p.flow.steps[0];
        try {
          const { inputs, targets } = layoutToPlacements(step.layout);
          return { id: p.id, steps: p.flow.steps.length, scripted: !!p.script?.source.trim(), layout: { inputs, targets }, label: step.label };
        } catch {
          return { id: p.id, steps: p.flow.steps.length, scripted: !!p.script?.source.trim(), layout: null, label: step?.label };
        }
      }),
    [detail.payload]
  );
  return (
    <div className="flex flex-wrap gap-4">
      {plots.map((p) => (
        <figure key={p.id} className="space-y-1">
          {p.layout ? <LayoutPreview layout={p.layout} cellSize={14} /> : <div className="w-[150px] h-[150px] grid place-items-center text-[11px] text-slate-500 border border-slate-700 rounded">Layout unreadable</div>}
          <figcaption className="text-[11px] text-slate-400 max-w-[160px] break-words">
            <span className="text-slate-200">Plot {p.id}</span> · {p.steps} step{p.steps === 1 ? "" : "s"}
            {p.scripted ? ", scripted" : ""}
            {p.label ? <div className="text-slate-500">{p.label}</div> : null}
          </figcaption>
        </figure>
      ))}
    </div>
  );
};

/** (e) Per-seed results of the chosen cell. */
export const SeedTable: React.FC<{ seeds: FlowSeedResult[]; board: Board; quotes: Quotes; pricing: BazaarPricing }> = ({ seeds, board, quotes, pricing }) => {
  const rows = seeds
    .slice()
    .sort((a, b) => a.seedIndex - b.seedIndex)
    .map((s) => ({ s, profit: valueResult(DATA, s.result, board, board === "normal" ? quotes : {}, pricing).profitPerDay }));
  const ratio = spreadRatio(rows.map((r) => r.profit));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-700/60">
            <th className="font-medium py-1.5 pr-3">Seed</th>
            <th className="font-medium py-1.5 pr-3 text-right">Profit / day</th>
            <th className="font-medium py-1.5 pr-3 text-right">Uptime</th>
            <th className="font-medium py-1.5 text-right">Effort</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ s, profit }) => (
            <tr key={s.seedIndex} className="border-b border-slate-700/30">
              <td className="py-1.5 pr-3 text-slate-300">#{s.seedIndex + 1}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums text-emerald-300">{formatCoins(profit)}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums text-slate-300">{percent(s.result.uptime)}</td>
              <td className="py-1.5 text-right tabular-nums text-slate-300">{effortText(s.result.effort.avg, s.result.effort.peak)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-slate-500">
        Best / median: <span className={ratio > 2 ? "text-red-300" : "text-slate-300"}>{ratioText(ratio)}</span>. The stored numbers are the median of each item over the seeds.
      </p>
    </div>
  );
};

const JOB_TONE: Record<string, string> = { done: "text-emerald-300", running: "text-blue-300", failed: "text-red-300", queued: "text-slate-400" };

/** Owner: verification progress; polls every 5 s while pending. */
export const StatusBox: React.FC<{ id: string; initial: string; onLive?: () => void }> = ({ id, initial, onLive }) => {
  const [status, setStatus] = useState<FlowStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = (status?.status ?? initial) === "pending";
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = () => {
      getFlowStatus(id)
        .then((s) => {
          if (!live) return;
          setStatus(s);
          setError(null);
          if (s.status === "pending") timer = setTimeout(poll, 5000);
          else if (s.status === "live") onLive?.();
        })
        .catch((e: unknown) => {
          if (!live) return;
          setError(e instanceof Error ? e.message : String(e));
          timer = setTimeout(poll, 5000);
        });
    };
    poll();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
    // onLive is a notification only; re-polling on its identity would restart the loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const s = status?.status ?? initial;
  return (
    <div className="rounded-lg border border-slate-700/60 bg-slate-900/40 p-3 text-xs space-y-2" data-testid="flow-status">
      <div className="flex items-center gap-2">
        <span className="text-slate-300">Verification:</span>
        <Badge tone={s === "live" ? "new" : s === "rejected" ? "danger" : s === "hidden" ? "stale" : "pending"}>{s === "hidden" ? "hidden pending review" : s}</Badge>
        {pending && <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-300" />}
      </div>
      {status?.rejectReason && <div className="text-red-300 break-words">{status.rejectReason}</div>}
      {error && <div className="text-amber-300">Could not refresh the status: {error}</div>}
      {status?.jobs.length ? (
        <ul className="space-y-0.5">
          {status.jobs.map((j, i) => (
            <li key={i} className="flex flex-wrap gap-x-2">
              <span className="text-slate-400">
                {BOARD_LABEL[j.board]} · {TIER_LABEL[j.tier as TierId] ?? j.tier} tier · {j.priority === "A" ? "goes live after this" : "background"}
              </span>
              <span className={JOB_TONE[j.status] ?? "text-slate-300"}>{j.status}</span>
              {j.error && <span className="text-red-300 break-words">{j.error}</span>}
            </li>
          ))}
        </ul>
      ) : null}
      {pending && <p className="text-slate-500">The server simulates every online frequency with 5 secret seeds; this takes a few minutes. You can leave this page.</p>}
    </div>
  );
};

/** The report dialog body (exported for SSR tests). */
export const ReportPanel: React.FC<{ id: string; onClose: () => void }> = ({ id, onClose }) => {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const ok = await reportFlow(id, reason.trim());
      toast({ title: ok ? "Report sent" : "Already reported", description: ok ? "Thanks. A moderator will take a look." : "You reported this flow before.", variant: ok ? "success" : "info" });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <DialogFrame
      id="report-flow-title"
      title={
        <>
          <Flag className="w-4 h-4 text-red-300" /> Report this flow
        </>
      }
      onClose={onClose}
      footer={
        <>
          <button type="button" className={buttonClass.neutral} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={buttonClass.danger} onClick={send} disabled={busy || !reason.trim()}>
            <Flag className="w-3.5 h-3.5" /> {busy ? "Sending..." : "Send report"}
          </button>
        </>
      }
    >
      <label className="block space-y-1 text-xs text-slate-300">
        <span>What's wrong? (offensive text, a copied flow, a broken entry...)</span>
        <textarea className={`${inputClass} w-full h-24`} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        <span className="block text-right text-[11px] text-slate-500">{reason.length} / 200</span>
      </label>
      {error && <p className="text-xs text-red-300">{error}</p>}
    </DialogFrame>
  );
};

export const ReportDialog: React.FC<{ id: string; onClose: () => void }> = ({ id, onClose }) => (
  <ModalDialog labelledBy="report-flow-title" onClose={onClose} maxWidth="max-w-md">
    <ReportPanel id={id} onClose={onClose} />
  </ModalDialog>
);
