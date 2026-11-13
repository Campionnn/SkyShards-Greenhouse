import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, X } from "lucide-react";
import { IconButton, Kbd, KitInput } from "../ui/kit";
import { LinkButton } from "../ui/Card";
import { cn } from "../ui/cn";
import { surface } from "../ui/surface";
import { wikiPath } from "../../wiki/slugs";
import { ItemIcon } from "./ItemIcon";
import { searchGrouped } from "./navModel";
import type { WikiData } from "./useWikiData";

// The wiki's one search (research/wiki-v2: C's typeahead + B's grouped results): a field with a list under
// it, grouped like the index (Base crops, Common … Legendary), names starting with the text first, the match
// in bold. ↑↓ move, Enter opens, Escape clears; "/" focuses it from anywhere on the page. Every result is an
// option of a combobox (aria-activedescendant); a pick navigates with the router, so Back works.

export const WikiSearch: React.FC<{ wiki: WikiData; className?: string; inputClassName?: string }> = ({ wiki, className, inputClassName }) => {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const groups = useMemo(() => searchGrouped(wiki.index.entries, q), [wiki.index.entries, q]);
  const flat = groups.flatMap((g) => g.entries);
  useEffect(() => setAt(0), [q]);

  // "/" focuses the search (not while typing somewhere else). One search per page, so one listener.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable))) return;
      e.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (id: string | null) => {
    setQ("");
    setOpen(false);
    input.current?.blur();
    navigate(id ? wikiPath(id) : "/wiki");
  };
  const term = q.trim();
  const show = open && term.length > 0;
  const mark = (name: string) => {
    const i = name.toLowerCase().indexOf(term.toLowerCase());
    if (i < 0 || !term) return name;
    return (
      <>
        {name.slice(0, i)}
        <b className="font-semibold text-fg">{name.slice(i, i + term.length)}</b>
        {name.slice(i + term.length)}
      </>
    );
  };

  return (
    <div className={cn("relative min-w-0", className)}>
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-meta" />
      <KitInput
        ref={input}
        type="search"
        role="combobox"
        aria-expanded={show}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={show && flat[at] ? `${listId}-${flat[at].id}` : undefined}
        aria-label="Search crops & mutations"
        placeholder="Search crops & mutations"
        autoComplete="off"
        spellCheck={false}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setAt((a) => Math.min(flat.length - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setAt((a) => Math.max(0, a - 1));
          } else if (e.key === "Enter" && show && flat[at]) {
            e.preventDefault();
            go(flat[at].id);
          } else if (e.key === "Escape" && q) {
            // Clears the text only; a second Escape reaches whatever is underneath.
            e.preventDefault();
            e.stopPropagation();
            setQ("");
          }
        }}
        className={cn("h-9 w-full pr-9 pl-8 pointer-coarse:h-11 [&::-webkit-search-cancel-button]:hidden", !q && "pointer-coarse:pr-2", inputClassName)}
      />
      {!q && (
        <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 max-sm:hidden pointer-coarse:hidden">
          <Kbd>/</Kbd>
        </span>
      )}
      {q && (
        <IconButton
          aria-label="Clear the search"
          className="absolute top-1/2 right-1 -translate-y-1/2 pointer-coarse:right-0 pointer-coarse:size-11"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setQ("");
            input.current?.focus();
          }}
        >
          <X />
        </IconButton>
      )}
      {show && (
        <div
          id={listId}
          role="listbox"
          aria-label="Matching crops and mutations"
          className={cn(surface.raised, "kit-pop-in scrollbar-dark absolute inset-x-0 top-full z-(--z-popover) mt-1 max-h-[min(26rem,60dvh)] overflow-y-auto overscroll-contain p-1")}
        >
          {groups.length ? (
            groups.map((g) => (
              <div key={g.key} role="group" aria-label={g.title}>
                <div aria-hidden className="px-2 pt-1.5 pb-0.5 text-label uppercase text-fg-meta">
                  {g.title}
                </div>
                {g.entries.map((e) => {
                  const i = flat.indexOf(e);
                  return (
                    <div
                      key={e.id}
                      id={`${listId}-${e.id}`}
                      role="option"
                      aria-selected={i === at}
                      onMouseDown={(ev) => ev.preventDefault()}
                      onMouseEnter={() => setAt(i)}
                      onClick={() => go(e.id)}
                      className={cn("flex h-9 min-w-0 cursor-pointer items-center gap-2.5 rounded-control px-2 text-body text-fg-body pointer-coarse:h-11", i === at && "bg-surface-hover")}
                    >
                      <ItemIcon id={e.id} name={e.name} size={24} />
                      <span className="min-w-0 flex-1 truncate" title={e.name}>
                        {mark(e.name)}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))
          ) : (
            <div className="px-2 py-3 text-body text-fg-muted">
              No crop or mutation matches “{term}”.{" "}
              <LinkButton onMouseDown={(ev) => ev.preventDefault()} onClick={() => go(null)}>
                Browse all
              </LinkButton>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
