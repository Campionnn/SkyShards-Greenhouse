import React, { useMemo, useState } from "react";
import { API, HOOKS } from "../../../simulator";
import { inputClass } from "../styles";

/** Searchable script API reference (rendered from the engine's docs table). */
export const ScriptDocs: React.FC<{ kind: "plot" | "controller"; onInsert?: (text: string) => void }> = ({ kind, onInsert }) => {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const match = (...texts: string[]) => !query || texts.some((t) => t.toLowerCase().includes(query));
  const hooks = useMemo(() => HOOKS.filter((h) => h.scope === "both" || h.scope === kind), [kind]);

  return (
    <div className="space-y-3 text-xs">
      <input className={`${inputClass} w-full`} placeholder="Search the reference (e.g. break, stage, step)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the script reference" />

      {!query && (
        <div className="rounded-md bg-slate-700/30 border border-slate-600/30 p-2.5 space-y-1.5 text-slate-300 leading-relaxed">
          <p>
            Scripts are written in a small, safe version of JavaScript: <code>let</code>/<code>const</code>, functions and arrows, <code>if</code>, loops, arrays,
            objects, template strings, destructuring, <code>?.</code> and <code>??</code>. No classes, <code>new</code>, <code>this</code> or <code>async</code>.
          </p>
          <p>
            Top-level code runs <b>once</b>, when the run is set up. Put per-cycle logic in <b>hooks</b>: functions with the names below. Top-level variables keep
            their values between cycles (and survive Back / Undo). <code>shared</code> is one object every script can read and write.
          </p>
          <p>
            The built-in player still does everything it normally does. A script adds to it, or takes over parts with <code>plot.disable(...)</code>,{" "}
            <code>plot.setPolicy(...)</code> and <code>plot.hold()</code>. Actions (break, place, goto...) only work when <code>online</code>; otherwise they return false.
          </p>
          <p>
            {kind === "plot" ? (
              <>
                A <b>plot script</b> has <code>plot</code> (its own plot); its hooks run for that plot only.
              </>
            ) : (
              <>
                The <b>controller script</b> sees every plot through <code>plots</code> and <code>getPlot(id)</code>; it has no <code>plot</code>. Its event hooks get
                every plot's events.
              </>
            )}{" "}
            A runtime error stops the run after the current cycle and shows the line. <code>random()</code> uses the seed, so runs repeat exactly.
          </p>
        </div>
      )}

      {hooks.some((h) => match(h.name, h.when)) && (
        <section>
          <h4 className="text-[11px] font-medium text-slate-400 uppercase tracking-wide mb-1">Hooks, in cycle order</h4>
          <ul className="space-y-1">
            {hooks
              .filter((h) => match(h.name, h.when))
              .map((h) => (
                <li key={h.name} className="rounded bg-slate-800/60 px-2 py-1">
                  <button
                    type="button"
                    className="font-mono text-emerald-300 hover:underline cursor-pointer"
                    title="Insert this hook"
                    onClick={() => onInsert?.(`\nfunction ${h.signature} {\n  \n}\n`)}
                  >
                    function {h.signature}
                  </button>
                  <div className="text-slate-400">{h.when}</div>
                </li>
              ))}
          </ul>
        </section>
      )}

      {API.map((section) => {
        const entries = section.entries.filter((e) => !(kind === "controller" && e.name === "plot" && !section.prefix) && match(e.name, e.signature, e.description));
        if (!entries.length) return null;
        return (
          <section key={section.title}>
            <h4 className="text-[11px] font-medium text-slate-400 uppercase tracking-wide mb-1">{section.title}</h4>
            {section.intro && !query && <p className="text-slate-500 mb-1">{section.intro}</p>}
            <ul className="space-y-1">
              {entries.map((e) => (
                <li key={`${section.title}-${e.name}`} className="rounded bg-slate-800/60 px-2 py-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <code className="text-sky-300 break-all">{e.signature}</code>
                    {e.action && <span className="text-[10px] text-amber-300/90 uppercase tracking-wide">action</span>}
                  </div>
                  <div className="text-slate-400">{e.description}</div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
};
