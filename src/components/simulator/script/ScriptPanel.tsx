import React, { useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, PauseCircle, Pencil } from "lucide-react";
import { inspectScriptVariables, type InspectedVariable, type Scenario, type ScriptHalt, type ScriptMetric, type SimulationState } from "../../../simulator";
import { KitButton, KitInput } from "../../ui/kit";
import { ResultCard } from "../page/ResultCard";
import { getScript, haltText, scriptLabel, scriptTargetLabel, type ScriptTarget } from "./scriptEdit";


/** Banner shown under the run controls when a script stopped the run. */
export const ScriptHaltBanner: React.FC<{ halt: ScriptHalt; onEdit: () => void }> = ({ halt, onEdit }) => (
  <div
    role="status"
    className={`flex flex-wrap items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-[12.5px] ${
      halt.kind === "error" ? "border-red-400/25 bg-red-500/[0.06] text-red-100" : "border-sky-400/25 bg-sky-500/[0.06] text-sky-100"
    }`}
  >
    {halt.kind === "error" ? <AlertTriangle className="h-4 w-4 shrink-0 text-red-300" /> : <PauseCircle className="h-4 w-4 shrink-0 text-sky-300" />}
    <span className="flex-1 min-w-[200px] break-words">
      {haltText(halt)}
      {halt.kind === "error" ? " Fix the script to continue (Back / Undo still work)." : " Run or Step continues."}
    </span>
    {halt.kind === "error" && (
      <KitButton onClick={onEdit}>
        <Pencil /> Open the script
      </KitButton>
    )}
  </div>
);

const Sparkline: React.FC<{ metric: ScriptMetric }> = ({ metric }) => {
  const pts = metric.history;
  if (pts.length < 2) return null;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const W = 120;
  const H = 24;
  const d = pts
    .map(([x, y], i) => `${i ? "L" : "M"}${(((x - x0) / Math.max(1, x1 - x0)) * W).toFixed(1)},${(H - 2 - ((y - y0) / (y1 - y0 || 1)) * (H - 4)).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={W} height={H} className="flex-shrink-0" aria-hidden>
      <path d={d} fill="none" stroke="rgb(56 189 248)" strokeWidth={1.5} />
    </svg>
  );
};

const ValueTree: React.FC<{ value: unknown; depth?: number }> = ({ value, depth = 0 }) => {
  if (value === null || typeof value !== "object") {
    return <span className="text-slate-200 break-all">{value === undefined ? "undefined" : typeof value === "string" ? (value.startsWith("[") ? value : JSON.stringify(value)) : String(value)}</span>;
  }
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value);
  if (entries.length === 0) return <span className="text-slate-500">{Array.isArray(value) ? "[]" : "{}"}</span>;
  return (
    <ul className={depth ? "pl-3 border-l border-slate-700/60" : ""}>
      {entries.map(([k, v]) => (
        <li key={k}>
          <span className="text-slate-400">{k}: </span>
          <ValueTree value={v} depth={depth + 1} />
        </li>
      ))}
    </ul>
  );
};

const VariableRow: React.FC<{ v: InspectedVariable }> = ({ v }) => {
  const [open, setOpen] = useState(false);
  const expandable = v.value !== null && typeof v.value === "object";
  return (
    <li className="font-mono text-[11px]">
      <button type="button" className={`flex w-full text-left gap-1 ${expandable ? "cursor-pointer" : "cursor-default"}`} onClick={() => expandable && setOpen((o) => !o)}>
        <span className="w-3 flex-shrink-0 text-slate-500">{expandable ? open ? <ChevronDown className="w-3 h-3 mt-0.5" /> : <ChevronRight className="w-3 h-3 mt-0.5" /> : null}</span>
        <span className="text-sky-300 flex-shrink-0">{v.name}</span>
        <span className="text-slate-500">=</span>
        {!open && <span className="text-slate-300 truncate">{v.text}</span>}
      </button>
      {open && (
        <div className="pl-4 py-0.5">
          <ValueTree value={v.value} />
        </div>
      )}
    </li>
  );
};

/** Scripts on the page: which scripts run, the variable inspector, metrics and the script console. */
export const ScriptPanel: React.FC<{
  scenario: Scenario;
  state: SimulationState | null;
  onEdit: (target: ScriptTarget) => void;
  className?: string;
}> = ({ scenario, state, onEdit, className }) => {
  const [filter, setFilter] = useState("");
  const [logScript, setLogScript] = useState("all");
  const vars = useMemo(() => (state ? inspectScriptVariables(state) : []), [state]);
  const ss = state?.scripts;
  const targets: ScriptTarget[] = ["controller", ...scenario.plots.map((p) => p.id)];
  const grouped = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const map = new Map<string, InspectedVariable[]>();
    for (const v of vars) {
      if (q && !v.name.toLowerCase().includes(q) && !v.text.toLowerCase().includes(q)) continue;
      const list = map.get(v.script) ?? [];
      list.push(v);
      map.set(v.script, list);
    }
    return [...map.entries()];
  }, [vars, filter]);
  const logs = (ss?.logs ?? []).filter((l) => logScript === "all" || l.script === logScript).slice(-150).reverse();
  const metrics = Object.entries(ss?.metrics ?? {});

  return (
    <ResultCard
      title="Scripts"
      className={className}
      hint="Code that controls the simulation, on top of the flows. Variables and console update after each Step or Run."
      meta={`${targets.filter((t) => getScript(scenario, t)?.source.trim()).length} of ${targets.length} written`}
    >
      <div className="mb-4 flex flex-wrap gap-1.5">
        {targets.map((t) => {
          const s = getScript(scenario, t);
          const has = !!s?.source.trim();
          return (
            <KitButton key={String(t)} onClick={() => onEdit(t)} title={has ? "Edit this script" : "Write a script"}>
              <Pencil />
              {scriptTargetLabel(t)}
              <span className={`text-[11px] tabular-nums ${has && s?.enabled !== false ? "text-sky-300" : "text-slate-500"}`}>
                {has ? (s?.enabled === false ? "off" : `${s!.source.split("\n").length} lines`) : "none"}
              </span>
            </KitButton>
          );
        })}
      </div>

      {!ss ? (
        <p className="text-[12.5px] text-slate-500">
          No scripts in this scenario. Write one to break mutations at a stage, drive the step flow from code, keep variables, or coordinate the three plots.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div className="min-w-0">
            <SubHead actions={<KitInput className="h-7 w-36 text-[12px]" placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter variables" />}>Variables</SubHead>
            {grouped.length === 0 ? (
              <p className="text-xs text-slate-500">{vars.length ? "Nothing matches." : "No top-level variables yet."}</p>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto scrollbar-dark pr-1">
                {grouped.map(([script, list]) => (
                  <div key={script}>
                    <div className="mb-0.5 text-[11px] text-slate-500">{scriptLabel(script)}</div>
                    <ul className="space-y-0.5">
                      {list.map((v) => (
                        <VariableRow key={`${script}.${v.name}`} v={v} />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
            {metrics.length > 0 && (
              <>
                <SubHead className="mt-4">Metrics</SubHead>
                <ul className="space-y-1">
                  {metrics.map(([name, m]) => (
                    <li key={name} className="flex items-center gap-2 text-xs">
                      <span className="text-slate-300 flex-1 min-w-0 truncate" title={name}>
                        {name}
                      </span>
                      <Sparkline metric={m} />
                      <span className="w-20 text-right font-mono tabular-nums text-slate-100">{Number.isInteger(m.value) ? m.value : m.value.toFixed(3)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <div className="min-w-0">
            <SubHead
              actions={
                <select
                  className="h-7 cursor-pointer rounded-lg border border-slate-700/60 bg-slate-950/50 px-2 text-[12px] text-slate-200 focus:border-emerald-500/60 focus:outline-none"
                  value={logScript}
                  onChange={(e) => setLogScript(e.target.value)}
                  aria-label="Console filter"
                >
                  <option value="all">All scripts</option>
                  <option value="global">Controller</option>
                  {scenario.plots.map((p) => (
                    <option key={p.id} value={`plot:${p.id}`}>
                      Plot {p.id}
                    </option>
                  ))}
                </select>
              }
            >
              Console
            </SubHead>
            {logs.length === 0 ? (
              <p className="text-xs text-slate-500">Nothing logged yet. Use log(...) and warn(...).</p>
            ) : (
              <ol className="space-y-0.5 max-h-80 overflow-y-auto scrollbar-dark pr-1 font-mono text-[11px]">
                {logs.map((l, i) => (
                  <li
                    key={i}
                    className={`flex gap-2 ${l.level === "error" ? "text-red-300" : l.level === "warn" ? "text-amber-200" : "text-slate-300"}`}
                  >
                    <span className="text-slate-500 flex-shrink-0 w-12 text-right">{l.cycle}</span>
                    <span className="text-slate-500 flex-shrink-0 w-14">{scriptLabel(l.script)}</span>
                    <span className="break-words min-w-0 whitespace-pre-wrap">{l.text}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
    </ResultCard>
  );
};

/** A sub-heading inside the Scripts card (Variables, Metrics, Console). */
const SubHead: React.FC<{ children: React.ReactNode; actions?: React.ReactNode; className?: string }> = ({ children, actions, className = "" }) => (
  <div className={`mb-2 flex min-h-7 items-center justify-between gap-2 ${className}`}>
    <h4 className="text-[12px] font-semibold text-slate-300">{children}</h4>
    {actions}
  </div>
);