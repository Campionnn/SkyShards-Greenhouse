// CodeMirror 6 editor for greenhouse scripts. Loaded lazily (React.lazy in
// ScriptEditor.tsx), so CodeMirror only downloads when a script editor opens.

import React, { useEffect, useRef } from "react";
import { Decoration, drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, type DecorationSet } from "@codemirror/view";
import { EditorState, StateEffect, StateField } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { bracketMatching, foldGutter, indentOnInput } from "@codemirror/language";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type Completion, type CompletionContext } from "@codemirror/autocomplete";
import { linter, lintGutter, type Diagnostic } from "@codemirror/lint";
import { oneDark } from "@codemirror/theme-one-dark";
import { API, defaultGameData, diagnoseScript, HOOKS } from "../../../simulator";

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  kind: "plot" | "controller";
  /** Line (1-based) to mark as the error location. */
  errorLine?: number | null;
  /** Change it to move the cursor to `errorLine`. */
  focusToken?: number;
  minHeight?: number;
}

const data = defaultGameData();
const IDS = [...data.mutationIds, ...data.cropIds];

function completionSource(kind: "plot" | "controller") {
  const globals: Completion[] = [];
  const members: Record<string, Completion[]> = {};
  for (const section of API) {
    for (const e of section.entries) {
      const c: Completion = {
        label: e.name,
        detail: e.signature,
        info: e.action ? `${e.description} (only when the player is online)` : e.description,
        type: e.signature.includes("(") ? "function" : "variable",
      };
      if (!section.prefix) {
        if (e.name === "plot" && kind === "controller") continue;
        globals.push(c);
      } else (members[section.prefix] ??= []).push(c);
    }
  }
  const hooks: Completion[] = HOOKS.map((h) => ({ label: h.name, detail: h.signature, info: h.when, type: "keyword", apply: `function ${h.signature} {\n  \n}` }));
  const plotMembers = members["plot."] ?? [];
  const plantMembers = members["p."] ?? [];
  return (ctx: CompletionContext) => {
    // Inside a string: game ids ("chorus_fruit").
    const str = ctx.matchBefore(/["'`][a-z_]*$/);
    if (str) {
      return {
        from: str.from + 1,
        options: IDS.map((id) => ({ label: id, type: "constant", detail: data.mutations[id]?.name ?? data.crops[id]?.name })),
        validFor: /^[a-z_]*$/,
      };
    }
    const member = ctx.matchBefore(/[A-Za-z_$][\w$.()]*\.[\w$]*$/);
    if (member) {
      const dot = member.text.lastIndexOf(".");
      const obj = member.text.slice(0, dot).split(".").pop() ?? "";
      const isPlot = /^(plot|p\d|plot\d|other|getPlot\(.*\)|plots\[.*\])$/i.test(obj) || /plot/i.test(obj);
      const isPlant = /^(p|q|plant|seed|it|x|e)$/.test(obj) || /plant/i.test(obj);
      const options = isPlot && !isPlant ? plotMembers : isPlant ? plantMembers : [...plotMembers, ...plantMembers];
      return { from: member.from + dot + 1, options, validFor: /^[\w$]*$/ };
    }
    const word = ctx.matchBefore(/[A-Za-z_$][\w$]*$/);
    if (!word && !ctx.explicit) return null;
    const line = ctx.state.doc.lineAt(ctx.pos);
    const atLineStart = /^\s*[\w$]*$/.test(line.text.slice(0, ctx.pos - line.from));
    return { from: word ? word.from : ctx.pos, options: atLineStart ? [...hooks, ...globals] : globals, validFor: /^[\w$]*$/ };
  };
}

function lintSource(kind: "plot" | "controller") {
  return linter(
    (view) => {
      const doc = view.state.doc;
      return diagnoseScript(doc.toString(), kind).map((d): Diagnostic => {
        const line = doc.line(Math.min(Math.max(1, d.line), doc.lines));
        const from = Math.min(line.from + Math.max(0, d.col - 1), line.to);
        return { from, to: Math.min(line.to, from + 1), severity: d.level, message: d.message };
      });
    },
    { delay: 300 }
  );
}

const setErrorLine = StateEffect.define<number | null>();
const errorDeco = Decoration.line({ class: "cm-errorLine" });
const errorLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setErrorLine)) continue;
      const n = e.value;
      deco = n && n >= 1 && n <= tr.state.doc.lines ? Decoration.set([errorDeco.range(tr.state.doc.line(n).from)]) : Decoration.none;
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const theme = EditorView.theme({
  "&": { fontSize: "12.5px", backgroundColor: "rgb(15 23 42 / 0.95)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", lineHeight: "1.55" },
  ".cm-gutters": { backgroundColor: "rgb(15 23 42)", borderRight: "1px solid rgb(51 65 85 / 0.6)" },
  ".cm-errorLine": { backgroundColor: "rgb(239 68 68 / 0.2)" },
  ".cm-completionInfo": { maxWidth: "380px", whiteSpace: "normal" },
});

const CodeEditor: React.FC<CodeEditorProps> = ({ value, onChange, kind, errorLine, focusToken, minHeight = 320 }) => {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          foldGutter(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          highlightActiveLine(),
          javascript(),
          oneDark,
          theme,
          autocompletion({ override: [completionSource(kind)], icons: false }),
          lintSource(kind),
          lintGutter(),
          errorLineField,
          keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
          }),
          EditorView.contentAttributes.of({ "aria-label": "Script code", spellcheck: "false", autocorrect: "off", autocapitalize: "off" }),
          EditorState.tabSize.of(2),
        ],
      }),
    });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
    // The document is created once per kind; later value changes go through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  // Value changes from outside (an example, a revert) replace the document.
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const current = v.state.doc.toString();
    if (current !== value) v.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: setErrorLine.of(errorLine ?? null) });
  }, [errorLine, value]);

  useEffect(() => {
    const v = view.current;
    if (!v || !errorLine || !focusToken) return;
    const doc = v.state.doc;
    const line = doc.line(Math.min(Math.max(1, errorLine), doc.lines));
    v.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
    v.focus();
  }, [focusToken, errorLine]);

  return (
    <div
      ref={host}
      className="rounded-md border border-slate-600/50 overflow-hidden [&_.cm-editor]:min-h-[inherit] [&_.cm-scroller]:min-h-[inherit]"
      style={{ minHeight }}
    />
  );
};

export default CodeEditor;
