import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Copy, Grid3x3, Link2, Search } from "lucide-react";
import { decodeDesign, extractLayoutCode } from "../../../utilities";
import { CropImage } from "../../shared";
import { Kbd } from "../../ui/kit";
import { surface } from "../../ui/surface";
import { nameOf } from "../format";
import { gatherLayoutSources, sourceFromCode, type LayoutSource } from "../layoutSources";
import type { AddMenuRequest, AddStepRequest } from "./context";

// "New step from…": opens where the user asked for it (Shift+A at the mouse, a dropped wire, the
// rail's + button). Searchable, keyboard driven, scales in from its anchor corner.

const SOURCE_TITLE: Record<string, string> = { calculator: "Calculator", designer: "Designer", saved: "Saved layout", link: "Share link" };

interface Item {
  key: string;
  title: string;
  detail: string;
  icon: React.ReactNode;
  group: "new" | "layouts";
  run: () => void;
}

export const AddStepMenu: React.FC<{
  request: AddMenuRequest;
  /** Label of the selected step, offered as "Duplicate". */
  duplicate: { index: number; label: string } | null;
  onAdd: (req: AddStepRequest) => void;
  onClose: () => void;
}> = ({ request, duplicate, onAdd, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; origin: string } | null>(null);
  const sources = useMemo(() => gatherLayoutSources(), []);
  const { screen, ...base } = request;

  // A pasted share link becomes a source too.
  const pasted = useMemo<LayoutSource | null>(() => {
    const t = query.trim();
    if (t.length < 12) return null;
    const code = extractLayoutCode(t);
    try {
      decodeDesign(code);
      return sourceFromCode("link", "link", code, "Pasted share link");
    } catch {
      return null;
    }
  }, [query]);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [
      {
        key: "empty",
        title: "Empty step",
        detail: "Design its layout from scratch",
        icon: <Grid3x3 />,
        group: "new",
        run: () => onAdd({ ...base, label: undefined }),
      },
    ];
    if (duplicate) {
      out.push({
        key: "dup",
        title: `Duplicate "${duplicate.label}"`,
        detail: "Same layout, exits, actions and checked targets",
        icon: <Copy />,
        group: "new",
        run: () => onAdd({ ...base, duplicateOf: duplicate.index }),
      });
    }
    for (const s of pasted ? [pasted, ...sources] : sources) {
      const main = s.preview.targets[0]?.cropId ?? s.preview.inputs[0]?.cropId;
      out.push({
        key: s.key,
        title: s.key === "link" ? "Pasted share link" : `${SOURCE_TITLE[s.from] ?? s.from}: ${s.title}`,
        detail: s.detail,
        icon: main ? <CropImage cropId={main} cropName={nameOf(main)} size="custom" width={20} height={20} showFallback /> : <Link2 />,
        group: "layouts",
        run: () => onAdd({ ...base, layout: { code: s.code }, label: s.name }),
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources, pasted, duplicate]);

  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = pasted ? items : items.filter((it) => words.every((w) => `${it.title} ${it.detail}`.toLowerCase().includes(w)));
  const current = Math.min(active, Math.max(0, shown.length - 1));

  // Keep the menu on screen; scale in from the corner nearest the anchor.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const flipX = screen.x + w + 12 > window.innerWidth;
    const flipY = screen.y + h + 12 > window.innerHeight;
    setPos({
      left: Math.max(8, flipX ? screen.x - w : screen.x),
      top: Math.max(8, flipY ? screen.y - h : screen.y),
      origin: `${flipY ? "bottom" : "top"} ${flipX ? "right" : "left"}`,
    });
  }, [screen.x, screen.y]);

  // Focus once visible (a `visibility: hidden` element can't take focus).
  const placed = pos !== null;
  useEffect(() => {
    if (placed) inputRef.current?.focus({ preventScroll: true });
  }, [placed]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [onClose]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(Math.min(current + 1, shown.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(Math.max(current - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      shown[current]?.run();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  let lastGroup = "";
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Add a step"
      className={`fixed z-[60] w-[min(340px,calc(100vw-16px))] p-1.5 ${surface.raised} kit-pop-in`}
      style={{ left: pos?.left ?? screen.x, top: pos?.top ?? screen.y, transformOrigin: pos?.origin ?? "top left", visibility: pos ? "visible" : "hidden" }}
      onKeyDown={onKeyDown}
    >
      <label className="mb-1 flex h-9 items-center gap-2 rounded-lg border border-slate-700/60 bg-slate-950/60 px-2.5 text-slate-500 transition-colors duration-150 focus-within:border-emerald-500/60">
        <Search className="h-3.5 w-3.5" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          placeholder="New step from… (or paste a share link)"
          className="w-full bg-transparent text-[13px] text-slate-100 placeholder:text-slate-500 outline-none"
          aria-label="Search layouts"
        />
      </label>
      <div className="max-h-[380px] overflow-y-auto overscroll-contain scrollbar-dark" role="listbox">
        {shown.length === 0 && <p className="px-3 py-6 text-center text-xs text-slate-500">Nothing matches. Paste a share link to use it.</p>}
        {shown.map((it, i) => {
          const header = it.group !== lastGroup;
          lastGroup = it.group;
          return (
            <React.Fragment key={it.key}>
              {header && (
                <div className="px-2 pt-2 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-slate-500 first:pt-1">{it.group === "new" ? "New step" : "From a layout"}</div>
              )}
              <button
                type="button"
                role="option"
                aria-selected={i === current}
                onMouseMove={() => i !== current && setActive(i)}
                onClick={it.run}
                className={`flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors duration-150 ${i === current ? "bg-slate-400/10" : ""}`}
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[7px] bg-slate-800 text-slate-400 shadow-[inset_0_0_0_1px_rgba(148,163,184,0.12)] [&>svg]:h-4 [&>svg]:w-4">{it.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-slate-100" title={it.title}>
                    {it.title}
                  </span>
                  <span className="block truncate text-[11.5px] text-slate-500" title={it.detail}>
                    {it.detail}
                  </span>
                </span>
              </button>
            </React.Fragment>
          );
        })}
      </div>
      <div className="mt-1 flex items-center gap-3 border-t border-slate-700/60 px-2 pt-1.5 pb-0.5 text-[11px] text-slate-500">
        <span className="flex items-center gap-1">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> move
        </span>
        <span className="flex items-center gap-1">
          <Kbd>Enter</Kbd> add
        </span>
        <span className="flex items-center gap-1">
          <Kbd>Esc</Kbd> close
        </span>
      </div>
    </div>
  );
};
