import React from "react";
import { EFFORT_WEIGHTS, type RunSummary } from "../../simulator";
import { effortResult } from "../../leaderboard/result";
import { EFFORT_LABEL, effortLevel } from "../flows/flowsDisplay";
import { formatCount, formatRate } from "./format";
import { ResultCard } from "./page/ResultCard";

/** "Watering 1, Harvests 1, ..." in the engine's order, for the help text. */
const WEIGHT_LIST = Object.entries(EFFORT_WEIGHTS)
  .map(([k, w]) => `${EFFORT_LABEL[k] ?? k} ${w}`)
  .join(", ");

/** One slate ramp, heaviest share lightest. Kinds past the ramp are summed into "Other". */
const RAMP = ["#e2e8f0", "#94a3b8", "#64748b", "#475569", "#334155"];

/**
 * How much work the run takes per login: the same effort numbers the leaderboard ranks by
 * (`RunSummary.effort`, priced into per-login rates by `effortResult`), so a flow's effort can be
 * read here before it is submitted. Follows the run live, like the other report panels.
 */
export const EffortPanel: React.FC<{ summary: RunSummary; className?: string }> = ({ summary, className }) => {
  const effort = effortResult(summary.effort);
  const none = effort.sessions === 0;
  const level = effortLevel(none ? null : effort.avg);

  const kinds = Object.entries(effort.byKind)
    .map(([k, n]) => ({ k, label: EFFORT_LABEL[k] ?? k, n: n ?? 0, w: (n ?? 0) * (EFFORT_WEIGHTS[k as keyof typeof EFFORT_WEIGHTS] ?? 1) }))
    .filter((r) => r.n > 0)
    .sort((a, b) => b.w - a.w);
  const total = kinds.reduce((s, r) => s + r.w, 0);
  const shown = kinds.length > RAMP.length ? kinds.slice(0, RAMP.length - 1) : kinds;
  const rest = kinds.slice(shown.length);
  const segments = [
    ...shown,
    ...(rest.length ? [{ k: "other", label: "Other", n: rest.reduce((s, r) => s + r.n, 0), w: rest.reduce((s, r) => s + r.w, 0), of: rest.map((r) => r.label).join(", ") }] : []),
  ];

  return (
    <ResultCard
      title="Effort"
      className={className}
      hint={
        <>
          <p>How much work the player does each time they log in. The leaderboard shows the same numbers.</p>
          <p>
            A weighted count of what the player does while online: {WEIGHT_LIST}. Watering a plot counts once per login, however many plants need it. A step change
            counts on top of what it places and breaks, and its ground comes with it. Something put down and broken again in the same login (a crop replanted, then
            cleared by a step change) counts for neither. Average per login and the heaviest login so far.
          </p>
        </>
      }
      hintTitle="How effort is counted"
      hintWidth={340}
      meta={none ? undefined : `${formatCount(effort.sessions)} logins`}
    >
      {none ? (
        <p className="text-[12.5px] text-slate-500">No logins yet. Run the simulation, or check the online schedule in Settings.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-x-7 gap-y-2">
            <div>
              <div className="text-[22px] font-semibold leading-none tabular-nums text-slate-50">{effort.avg.toFixed(effort.avg < 10 ? 1 : 0)}</div>
              <div className="mt-1.5 text-[11px] text-slate-500">avg per login</div>
            </div>
            <div>
              <div className="text-[22px] font-semibold leading-none tabular-nums text-slate-50">{formatCount(effort.peak)}</div>
              <div className="mt-1.5 text-[11px] text-slate-500">heaviest login</div>
            </div>
            <span className="ml-auto pb-px text-[12px] font-semibold text-slate-200" title="The leaderboard's effort level for this average">
              {level.label}
            </span>
          </div>
          {segments.length > 0 ? (
            <>
              <div className="mt-3.5 mb-2.5 flex h-1.5 gap-0.5 overflow-hidden rounded-full" aria-hidden>
                {segments.map((s, i) => (
                  <span key={s.k} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(s.w / total) * 100}%`, background: RAMP[i] }} />
                ))}
              </div>
              <ul className="flex flex-wrap gap-x-3.5 gap-y-1 text-[11.5px] text-slate-500" aria-label="Effort by action, per login">
                {segments.map((s, i) => (
                  <li
                    key={s.k}
                    className="flex items-center gap-1.5"
                    title={`${"of" in s ? `${s.of}: ` : `${s.label}: `}${formatRate(s.n)} per login, ${Math.round((s.w / total) * 100)}% of the work`}
                  >
                    <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: RAMP[i] }} aria-hidden />
                    {s.label} <span className="tabular-nums text-slate-300">{formatRate(s.n)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-3 text-[12px] text-slate-500">No actions recorded.</p>
          )}
        </>
      )}
    </ResultCard>
  );
};
