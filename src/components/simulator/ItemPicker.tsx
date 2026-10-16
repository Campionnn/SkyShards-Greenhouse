import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { CropImage } from "../shared";
import { formatRarity, getRarityBgColor, getRarityTextColor, RARITY_ORDER } from "../../utilities/rarity";
import { formatCount, itemCategory, nameOf, rarityOf, type ItemCategory } from "./format";
import { inputClass } from "./styles";

// A searchable item picker (image, name, rarity colour) for the inventory's "add items" row.

type Filter = "all" | (typeof RARITY_ORDER)[number] | "crop" | "drop";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  ...RARITY_ORDER.map((r) => ({ key: r as Filter, label: formatRarity(r) })),
  { key: "crop", label: "Crops" },
  { key: "drop", label: "Drops" },
];

/** Display order of the groups when nothing is typed. */
const CATEGORY_ORDER: ItemCategory[] = ["mutation", "crop", "rareCrop", "other"];
const CATEGORY_LABEL: Record<ItemCategory, string> = { mutation: "Mutation", crop: "Crops", rareCrop: "Rare crops", other: "Other drops" };

const textColorOf = (id: string): string => {
  const rarity = rarityOf(id);
  return rarity ? getRarityTextColor(rarity) : "text-slate-200";
};

interface Entry {
  id: string;
  name: string;
  nameLower: string;
  category: ItemCategory;
  rarity: string | undefined;
  /** Lowercase text every search word is matched against. */
  haystack: string;
  group: string;
}

const matchesFilter = (e: Entry, f: Filter): boolean => {
  if (f === "all") return true;
  if (f === "crop") return e.category === "crop";
  if (f === "drop") return e.category === "rareCrop" || e.category === "other";
  return e.rarity === f;
};

export const ItemPicker: React.FC<{
  value: string;
  onChange: (id: string) => void;
  ids: readonly string[];
  /** Amounts currently held, shown beside each item. */
  held?: Record<string, number>;
  disabled?: boolean;
  className?: string;
  /** Called after an item is chosen (e.g. to move focus to the quantity). */
  onPicked?: () => void;
}> = ({ value, onChange, ids, held, disabled = false, className = "", onPicked }) => {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [active, setActive] = useState(0);

  const entries = useMemo<Entry[]>(() => {
    const list = ids.map((id): Entry => {
      const name = nameOf(id);
      const category = itemCategory(id);
      const rarity = rarityOf(id);
      return {
        id,
        name,
        nameLower: name.toLowerCase(),
        category,
        rarity,
        haystack: `${name} ${id.replace(/_/g, " ")} ${rarity ?? ""} ${CATEGORY_LABEL[category]}`.toLowerCase(),
        group: category === "mutation" ? `${formatRarity(rarity ?? "common")} mutations` : CATEGORY_LABEL[category],
      };
    });
    // Stable: keeps the rarity order of `ids` inside each category.
    return list.sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category));
  }, [ids]);

  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const results = useMemo(() => {
    const filtered = entries.filter((e) => matchesFilter(e, filter) && words.every((w) => e.haystack.includes(w)));
    if (!words.length) return filtered;
    // Best matches first: the name starts with the text, then a word in the name does, then the rest.
    const q = words.join(" ");
    const rank = (e: Entry) => (e.nameLower.startsWith(q) ? 0 : e.nameLower.split(" ").some((w) => w.startsWith(words[0])) ? 1 : 2);
    return filtered.map((e, i) => ({ e, i })).sort((a, b) => rank(a.e) - rank(b.e) || a.i - b.i).map((x) => x.e);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, filter, query]);

  const clampedActive = Math.min(active, Math.max(0, results.length - 1));

  useEffect(() => {
    if (!open) return;
    const onDown = (ev: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (open) activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [open, clampedActive, results]);

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
    setQuery("");
    onPicked?.();
  };

  const openList = () => {
    if (disabled) return;
    setOpen(true);
  };

  const onKeyDown = (ev: React.KeyboardEvent<HTMLInputElement>) => {
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      if (!open) openList();
      else setActive(Math.min(clampedActive + 1, results.length - 1));
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      setActive(Math.max(clampedActive - 1, 0));
    } else if (ev.key === "Enter") {
      if (open && results[clampedActive]) {
        ev.preventDefault();
        pick(results[clampedActive].id);
      }
    } else if (ev.key === "Escape") {
      if (open) {
        ev.preventDefault();
        setOpen(false);
        setQuery("");
      }
    }
  };

  let lastGroup = "";
  const counts = (id: string) => held?.[id] ?? 0;

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <div className="relative">
        <span className="absolute left-1.5 top-1/2 -translate-y-1/2 flex items-center pointer-events-none text-slate-500">
          {open ? <Search className="w-3.5 h-3.5" /> : <CropImage cropId={value} cropName={nameOf(value)} size="custom" width={20} height={20} showFallback />}
        </span>
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label="Search items"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          className={`${inputClass} w-full pl-8 pr-14 py-1.5 ${open ? "" : `${textColorOf(value)} cursor-pointer`} disabled:opacity-40`}
          placeholder={open ? `Search ${entries.length} items - name, rarity, crop...` : undefined}
          value={open ? query : nameOf(value)}
          onFocus={(e) => {
            openList();
            e.currentTarget.select();
          }}
          onClick={openList}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            if (!open) openList();
          }}
          onKeyDown={onKeyDown}
        />
        <span className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
          {open && query && (
            <button
              type="button"
              className={buttonIcon}
              aria-label="Clear search"
              title="Clear search"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setQuery("");
                setActive(0);
                inputRef.current?.focus();
              }}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            tabIndex={-1}
            disabled={disabled}
            className={buttonIcon}
            aria-label={open ? "Close item list" : "Open item list"}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => (open ? setOpen(false) : (inputRef.current?.focus(), openList()))}
          >
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        </span>
      </div>

      {open && (
        <div
          className="absolute left-0 right-0 top-full mt-1 z-30 min-w-[18rem] rounded-md border border-slate-600/50 bg-slate-900 shadow-xl shadow-black/50"
          onMouseDown={(e) => {
            // Keep focus in the search box when clicking chips or the scrollbar.
            if ((e.target as HTMLElement).closest("input") === null) e.preventDefault();
          }}
        >
          <div className="flex flex-wrap gap-1 p-2 border-b border-slate-700/60">
            {FILTERS.map((f) => {
              const on = filter === f.key;
              const rarity = (RARITY_ORDER as readonly string[]).includes(f.key) ? f.key : null;
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => {
                    setFilter(f.key);
                    setActive(0);
                  }}
                  aria-pressed={on}
                  className={`px-2 py-0.5 rounded-full border text-[11px] cursor-pointer transition-colors ${
                    on
                      ? rarity
                        ? `${getRarityBgColor(rarity)} ${getRarityTextColor(rarity)}`
                        : "bg-emerald-500/25 text-emerald-300 border-emerald-500/40"
                      : `bg-slate-800/60 border-slate-600/30 hover:bg-slate-700/60 ${rarity ? getRarityTextColor(rarity) : "text-slate-400"}`
                  }`}
                >
                  {f.label}
                </button>
              );
            })}
          </div>

          <div id={listId} role="listbox" className="max-h-72 overflow-y-auto overscroll-contain scrollbar-dark py-1">
            {results.length === 0 && (
              <p className="px-3 py-4 text-center text-xs text-slate-500">
                No item matches{query ? ` "${query}"` : ""}
                {filter !== "all" ? ` in ${FILTERS.find((f) => f.key === filter)?.label}` : ""}.
              </p>
            )}
            {results.map((e, i) => {
              const showHeader = !words.length && e.group !== lastGroup;
              lastGroup = e.group;
              const isActive = i === clampedActive;
              const isValue = e.id === value;
              const n = counts(e.id);
              return (
                <React.Fragment key={e.id}>
                  {showHeader && (
                    <div className="sticky top-0 z-10 bg-slate-900/95 px-3 pt-2 pb-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">{e.group}</div>
                  )}
                  <button
                    type="button"
                    role="option"
                    aria-selected={isValue}
                    ref={isActive ? activeRef : undefined}
                    onMouseMove={() => i !== clampedActive && setActive(i)}
                    onClick={() => pick(e.id)}
                    className={`w-full flex items-center gap-2 px-3 py-1 text-left text-xs cursor-pointer ${isActive ? "bg-slate-700/60" : ""} ${isValue ? "shadow-[inset_2px_0_0] shadow-emerald-400" : ""}`}
                  >
                    <CropImage cropId={e.id} cropName={e.name} size="custom" width={28} height={28} showFallback className="shrink-0" />
                    <span className={`min-w-0 flex-1 truncate ${textColorOf(e.id)}`}>{highlight(e.name, words)}</span>
                    {n !== 0 && (
                      <span className={`tabular-nums text-[10px] ${n < 0 ? "text-red-300" : "text-slate-400"}`} title="Currently held">
                        {formatCount(n)} held
                      </span>
                    )}
                    <span className={`shrink-0 text-[10px] ${e.rarity ? getRarityTextColor(e.rarity) : "text-slate-500"}`}>
                      {e.rarity ? formatRarity(e.rarity) : e.category === "crop" ? "Crop" : e.category === "rareCrop" ? "Rare crop" : "Drop"}
                    </span>
                  </button>
                </React.Fragment>
              );
            })}
          </div>
          <div className="border-t border-slate-700/60 px-3 py-1 text-[10px] text-slate-500">
            {results.length} of {entries.length} · ↑↓ to move · Enter to choose · Esc to close
          </div>
        </div>
      )}
    </div>
  );
};

const buttonIcon = "p-0.5 rounded text-slate-500 hover:text-slate-200 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed";

/** Bold the parts of `text` that the search words matched. */
function highlight(text: string, words: string[]): React.ReactNode {
  if (!words.length) return text;
  const lower = text.toLowerCase();
  const marked = new Array<boolean>(text.length).fill(false);
  for (const w of words) {
    let at = lower.indexOf(w);
    while (at !== -1) {
      for (let k = at; k < at + w.length; k++) marked[k] = true;
      at = lower.indexOf(w, at + w.length);
    }
  }
  const parts: React.ReactNode[] = [];
  let i = 0;
  while (i < text.length) {
    let j = i;
    while (j < text.length && marked[j] === marked[i]) j++;
    const piece = text.slice(i, j);
    parts.push(marked[i] ? <mark key={i} className="bg-transparent text-inherit font-bold underline decoration-emerald-400/70 underline-offset-2">{piece}</mark> : piece);
    i = j;
  }
  return parts;
}
