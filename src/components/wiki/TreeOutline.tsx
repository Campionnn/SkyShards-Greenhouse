import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, CornerLeftUp } from "lucide-react";
import type { GreenhouseDataJSON } from "../../services/greenhouseDataService";
import { Pill } from "../ui/kit";
import { LinkButton } from "../ui/Card";
import { cn } from "../ui/cn";
import { canFold, flattenTree, foldedByDefault, kindOf, nameOf, type TreeNode } from "./articleModel";
import { ItemIcon } from "./ItemIcon";
import { ItemLink } from "./ItemLink";

/**
 * The crafting tree (replaces RecipeTree): every ingredient down to the base crops, with counts. Each mutation
 * is listed in full the first time it appears; a repeat says "see above" (a button that unfolds and focuses
 * the first one) instead of repeating its subtree. By default it shows 2 levels; a folded row says "+N" (how
 * many lines are under it). "Expand all" ↔ "Show 2 levels".
 *
 * Markup: nested lists (the depth is the list nesting, which screen readers announce) with real disclosure
 * buttons (aria-expanded), not role=tree: the tree's arrow-key model would add nothing over Tab here. After
 * "+N" the focus stays on that row's chevron (the "+N" goes away when the row opens).
 *
 * `nodes` comes from treeOutline(data, id); render with key={id} so the folds reset per item.
 */
export const TreeOutline: React.FC<{ data: GreenhouseDataJSON; id: string; nodes: TreeNode[] }> = ({ data, id, nodes }) => {
  const all = useMemo(() => flattenTree(nodes), [nodes]);
  const [folded, setFolded] = useState<Set<string>>(() => foldedByDefault(nodes));
  const [focus, setFocus] = useState<{ path: string; what: "toggle" | "link" } | null>(null);
  const root = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (!focus) return;
    const row = root.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(focus.path)}"]`);
    const el = row?.querySelector<HTMLElement>(focus.what === "toggle" ? "button[aria-expanded]" : "a");
    el?.scrollIntoView({ block: "nearest" });
    el?.focus({ preventScroll: true });
    setFocus(null);
  }, [focus]);
  if (!nodes.length) return null;
  const levels = Math.max(...all.map((n) => n.depth)) + 1;
  const foldable = all.filter(canFold);
  const toggle = (path: string) =>
    setFolded((f) => {
      const next = new Set(f);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  const showFirst = (path: string) => {
    // Unfold every ancestor of the first appearance, then focus its link.
    setFolded((f) => new Set([...f].filter((p) => !path.startsWith(`${p}/`) && p !== path)));
    setFocus({ path, what: "link" });
  };
  const count = (n: TreeNode): number => n.children.reduce((s, c) => s + 1 + count(c), 0);

  const list = (items: TreeNode[], depth: number): React.ReactNode => (
    <ul
      ref={depth === 0 ? root : undefined}
      aria-label={depth === 0 ? `What ${nameOf(data, id)} is made from` : undefined}
      className={cn("min-w-0", depth > 0 && "ml-2 border-l border-line pl-2.5")}
    >
      {items.map((n) => {
        const name = nameOf(data, n.id);
        const isFolded = folded.has(n.path);
        return (
          <li key={n.path} className="min-w-0">
            <div data-path={n.path} className="flex h-7 min-w-0 items-center gap-1 pointer-coarse:h-11">
              {canFold(n) ? (
                <button
                  type="button"
                  aria-expanded={!isFolded}
                  aria-label={`${isFolded ? "Show" : "Hide"} what ${name} is made from`}
                  onClick={() => toggle(n.path)}
                  className="hit-area focus-ring grid size-4 shrink-0 cursor-pointer place-items-center rounded-inner text-fg-meta hover:text-fg"
                >
                  <ChevronDown aria-hidden className={cn("size-3.5 transition-transform duration-(--duration-ink)", isFolded && "-rotate-90")} />
                </button>
              ) : (
                <span aria-hidden className="size-4 shrink-0" />
              )}
              <ItemLink
                id={n.id}
                title={`${name} · ${kindOf(data, n.id)}`}
                className="flex h-7 min-w-0 items-center gap-1.5 px-0.5 hover:underline hover:decoration-fg-meta hover:underline-offset-2 pointer-coarse:h-11"
              >
                <ItemIcon id={n.id} name={name} size={18} />
                <span className="min-w-0 truncate text-body text-fg">{name}</span>
              </ItemLink>
              {n.count != null ? (
                <span className="shrink-0 text-secondary tabular-nums text-fg-muted">×{n.count}</span>
              ) : (
                <Pill className="shrink-0" title="Not placed around it: the special rule uses it">
                  special
                </Pill>
              )}
              {isFolded && (
                <button
                  type="button"
                  onClick={() => {
                    toggle(n.path);
                    setFocus({ path: n.path, what: "toggle" });
                  }}
                  aria-label={`Show ${count(n)} more under ${name}`}
                  title={`Show ${count(n)} more under ${name}`}
                  className="hit-area focus-ring ml-1 shrink-0 cursor-pointer rounded-inner px-1 text-meta tabular-nums text-fg-meta hover:text-fg-body"
                >
                  +{count(n)}
                </button>
              )}
              {n.seeAbove && (
                <button
                  type="button"
                  onClick={() => showFirst(n.seeAbove!)}
                  aria-label={`${name}: its ingredients are listed above`}
                  className="hit-area focus-ring ml-1 inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded-inner text-meta text-fg-meta hover:text-fg-body"
                >
                  <CornerLeftUp aria-hidden className="size-3" /> see above
                </button>
              )}
            </div>
            {canFold(n) && !isFolded && list(n.children, depth + 1)}
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center gap-3 text-secondary">
        <span className="text-fg-meta">
          {levels} level{levels === 1 ? "" : "s"} · {new Set(all.map((n) => n.id)).size} items
        </span>
        {foldable.length > 0 && (
          <LinkButton className="ml-auto" onClick={() => setFolded(folded.size ? new Set() : foldedByDefault(nodes))}>
            {folded.size ? "Expand all" : "Show 2 levels"}
          </LinkButton>
        )}
      </div>
      {list(nodes, 0)}
    </div>
  );
};
