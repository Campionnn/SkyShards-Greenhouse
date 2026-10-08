import React, { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { BookOpen, Check, Code2, FileCode, RotateCcw, X } from "lucide-react";
import { diagnoseScript, SCRIPT_EXAMPLES, type Scenario, type ScriptHalt } from "../../../simulator";
import { Panel, SectionLabel } from "../../ui";
import { buttonClass } from "../styles";
import { ScriptDocs } from "./ScriptDocs";
import { getScript, scriptTargetLabel, setScript, type ScriptTarget } from "./scriptEdit";

const CodeEditor = lazy(() => import("./CodeEditor"));

const STARTER: Record<"plot" | "controller", string> = {
  plot: `// This plot's script. Top-level code runs once; hooks run every cycle.
// See the reference on the right, or pick an example.

function onSession() {
  // Runs when the player is online, before the built-in harvest and step change.
}
`,
  controller: `// The controller script sees every plot (plots, getPlot(id)) and the shared inventory.
// Use \`shared\` to pass values between scripts.

function afterSession() {
  for (const plot of plots) {
    // ...
  }
}
`,
};

/**
 * Full-screen script editor: CodeMirror (lazy), live lint, the API reference and examples.
 * Edits are a draft until Apply (Ctrl/Cmd+S), since applying restarts the simulation.
 */
export const ScriptEditor: React.FC<{
  scenario: Scenario;
  target: ScriptTarget;
  onTargetChange: (t: ScriptTarget) => void;
  onChange: (sc: Scenario) => void;
  onClose: () => void;
  /** The current run's script error or pause, to mark the line. */
  halt?: ScriptHalt | null;
}> = ({ scenario, target, onTargetChange, onChange, onClose, halt }) => {
  const kind = target === "controller" ? "controller" : "plot";
  const saved = getScript(scenario, target);
  const [draft, setDraft] = useState(saved?.source ?? "");
  const [focusToken, setFocusToken] = useState(0);
  const [tab, setTab] = useState<"docs" | "examples">("docs");
  const dirty = draft !== (saved?.source ?? "");
  const enabled = saved?.enabled !== false;
  const diagnostics = useMemo(() => diagnoseScript(draft, kind), [draft, kind]);
  const errors = diagnostics.filter((d) => d.level === "error");

  // A different script: load its text.
  useEffect(() => {
    setDraft(getScript(scenario, target)?.source ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const haltKey = target === "controller" ? "global" : `plot:${target}`;
  const haltHere = halt && halt.script === haltKey && halt.kind === "error" && !dirty ? halt : null;

  const apply = () => onChange(setScript(scenario, target, { source: draft, enabled }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (dirty) apply();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const close = () => {
    if (dirty && !window.confirm("Discard the changes you haven't applied?")) return;
    onClose();
  };

  const targets: ScriptTarget[] = ["controller", ...scenario.plots.map((p) => p.id)];

  return (
    <Panel
      title="Scripts"
      icon={<Code2 />}
      actions={
        <>
          <button className={buttonClass.neutral} onClick={() => setDraft(saved?.source ?? "")} disabled={!dirty} title="Throw away the changes you haven't applied">
            <RotateCcw className="w-3.5 h-3.5" /> Revert
          </button>
          <button className={buttonClass.primary} onClick={apply} disabled={!dirty} title="Save the script and restart the simulation (Ctrl+S)">
            <Check className="w-3.5 h-3.5" /> {dirty ? "Apply" : "Applied"}
          </button>
          <button className={buttonClass.icon} onClick={close} title="Close" aria-label="Close the script editor">
            <X className="w-4 h-4" />
          </button>
        </>
      }
      description="Control the simulation with code. Scripts run on top of the flows: everything built in keeps working unless a script changes it."
    >
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Which script">
          {targets.map((t) => {
            const s = getScript(scenario, t);
            const has = !!s?.source.trim();
            const active = t === target;
            return (
              <button
                key={String(t)}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  if (t === target) return;
                  if (dirty && !window.confirm("Discard the changes you haven't applied?")) return;
                  onTargetChange(t);
                }}
                className={`px-2.5 py-1.5 rounded-md border text-xs font-medium cursor-pointer transition-colors ${
                  active ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" : "bg-slate-700/30 text-slate-400 border-slate-600/30 hover:text-slate-200"
                }`}
              >
                {scriptTargetLabel(t)}
                {has && <span className={`ml-1.5 inline-block w-1.5 h-1.5 rounded-full align-middle ${s?.enabled === false ? "bg-slate-500" : "bg-emerald-400"}`} />}
              </button>
            );
          })}
        </div>
        <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            className="accent-emerald-500"
            checked={enabled}
            onChange={(e) => onChange(setScript(scenario, target, { source: saved?.source ?? draft, enabled: e.target.checked }))}
            disabled={!saved?.source.trim()}
          />
          Enabled
        </label>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-4">
        <div className="space-y-2 min-w-0">
          {!draft.trim() && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              This {kind === "plot" ? "plot" : "scenario"} has no script yet.
              <button className={buttonClass.neutral} onClick={() => setDraft(STARTER[kind])}>
                <FileCode className="w-3.5 h-3.5" /> Start from a template
              </button>
            </div>
          )}
          <Suspense fallback={<div className="rounded-md border border-slate-600/50 bg-slate-900/80 h-[480px] grid place-items-center text-xs text-slate-500">Loading the editor...</div>}>
            <CodeEditor value={draft} onChange={setDraft} kind={kind} errorLine={haltHere?.line ?? null} focusToken={focusToken} minHeight={480} />
          </Suspense>

          {haltHere && (
            <button
              type="button"
              onClick={() => setFocusToken((n) => n + 1)}
              className="w-full text-left rounded-md bg-red-500/10 border border-red-500/30 px-2.5 py-1.5 text-xs text-red-200 cursor-pointer hover:bg-red-500/15"
            >
              <b>Stopped at cycle {haltHere.cycle}</b>
              {haltHere.line !== undefined && ` (line ${haltHere.line}:${haltHere.col}`}
              {haltHere.hook ? `${haltHere.line !== undefined ? ", " : " ("}in ${haltHere.hook})` : haltHere.line !== undefined ? ")" : ""}: {haltHere.message}
            </button>
          )}
          {diagnostics.length > 0 && (
            <ul className="space-y-1">
              {diagnostics.map((d, i) => (
                <li key={i} className={`text-xs rounded px-2 py-1 ${d.level === "error" ? "bg-red-500/10 text-red-200" : "bg-amber-500/10 text-amber-200"}`}>
                  Line {d.line}: {d.message}
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-slate-500">
            {dirty
              ? errors.length
                ? "Fix the errors, then Apply (Ctrl+S). Applying restarts the simulation."
                : "Not applied yet. Apply (Ctrl+S) to restart the simulation with this script."
              : "Applied. Edits stay a draft until you Apply."}{" "}
            Ctrl+Space completes names; type a quote for mutation ids.
          </p>
        </div>

        <aside className="min-w-0 xl:max-h-[70vh] xl:overflow-y-auto scrollbar-dark pr-1">
          <div className="flex gap-1 mb-2" role="tablist">
            {(["docs", "examples"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`flex-1 px-2 py-1.5 rounded-md border text-xs font-medium cursor-pointer flex items-center justify-center gap-1.5 ${
                  tab === t ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" : "bg-slate-700/30 text-slate-400 border-slate-600/30 hover:text-slate-200"
                }`}
              >
                {t === "docs" ? <BookOpen className="w-3.5 h-3.5" /> : <FileCode className="w-3.5 h-3.5" />}
                {t === "docs" ? "Reference" : "Examples"}
              </button>
            ))}
          </div>
          {tab === "docs" ? (
            <ScriptDocs kind={kind} onInsert={(text) => setDraft((d) => d.replace(/\s*$/, "\n") + text)} />
          ) : (
            <div className="space-y-2">
              <SectionLabel>Load an example</SectionLabel>
              {SCRIPT_EXAMPLES.map((ex) => (
                <div key={ex.id} className="rounded-md bg-slate-700/30 border border-slate-600/30 p-2 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-200 font-medium flex-1">{ex.title}</span>
                    <span className="text-[10px] uppercase tracking-wide text-slate-500">{ex.target === "controller" ? "controller" : "plot"}</span>
                  </div>
                  <p className="text-[11px] text-slate-400">{ex.description}</p>
                  <button
                    className={buttonClass.neutral}
                    onClick={() => {
                      if (draft.trim() && !window.confirm("Replace the code in the editor with this example?")) return;
                      setDraft(ex.source);
                    }}
                  >
                    Use this example
                  </button>
                  {(ex.target === "controller") !== (kind === "controller") && (
                    <p className="text-[11px] text-amber-300/80">Written for {ex.target === "controller" ? "the controller script" : "a plot script"}.</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </Panel>
  );
};
