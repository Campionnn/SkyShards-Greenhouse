import React, { useMemo, useState } from "react";
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, WandSparkles } from "lucide-react";
import { CropImage } from "../shared";
import type { GreenhouseDataJSON } from "../../services/greenhouseDataService";
import { collectExpandablePaths, getRecipeSource } from "../../wiki/recipes";
import { ItemLink } from "./ItemLink";
import { formatName, getRarityColor } from "./format";

interface RecipeTreeProps {
  id: string;
  data: GreenhouseDataJSON;
}

/**
 * Crafting tree without quantities. Shows the direct ingredients; each
 * ingredient expands to its own ingredients, down to base crops. The root's
 * special-spawn note is left to the caller (the Special Condition card).
 * Render with key={id} so the expansion state resets per item.
 */
export const RecipeTree: React.FC<RecipeTreeProps> = ({ id, data }) => {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const root = getRecipeSource(data, id);
  const allPaths = useMemo(() => collectExpandablePaths(data, id), [data, id]);
  const allExpanded = allPaths.length > 0 && allPaths.every((path) => expanded.has(path));

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  if (root.ingredients.length === 0) return null;

  return (
    <div className="space-y-3">
      {allPaths.length > 0 && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setExpanded(allExpanded ? new Set() : new Set(allPaths))}
            className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium text-slate-300 bg-slate-700/40 border border-slate-600/40 hover:bg-slate-700/70 hover:text-slate-100 transition-colors cursor-pointer"
          >
            {allExpanded ? <ChevronsDownUp className="w-3.5 h-3.5" /> : <ChevronsUpDown className="w-3.5 h-3.5" />}
            {allExpanded ? "Collapse all" : "Expand all"}
          </button>
        </div>
      )}

      <ul role="tree" aria-label="Crafting tree" className="space-y-0.5">
        {root.ingredients.map((child) => (
          <TreeNode
            key={child}
            id={child}
            path={`${id}/${child}`}
            ancestors={[id]}
            data={data}
            expanded={expanded}
            onToggle={toggle}
          />
        ))}
      </ul>
    </div>
  );
};

interface TreeNodeProps {
  id: string;
  path: string;
  ancestors: string[];
  data: GreenhouseDataJSON;
  expanded: Set<string>;
  onToggle: (path: string) => void;
}

const TreeNode: React.FC<TreeNodeProps> = ({ id, path, ancestors, data, expanded, onToggle }) => {
  const source = getRecipeSource(data, id);
  // A cycle would recurse forever; the data has none, but don't trust it.
  const children = source.ingredients.filter((child) => !ancestors.includes(child));
  const canExpand = children.length > 0;
  const isOpen = canExpand && expanded.has(path);
  const mutation = data.mutations[id];
  const name = nameOf(data, id);

  return (
    <li role="treeitem" aria-expanded={canExpand ? isOpen : undefined}>
      <div className="flex items-center gap-1 min-h-8">
        {canExpand ? (
          <button
            type="button"
            onClick={() => onToggle(path)}
            className="flex items-center justify-center w-6 h-6 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-700/60 transition-colors cursor-pointer flex-shrink-0"
            aria-label={`${isOpen ? "Collapse" : "Expand"} ${name}`}
          >
            <ChevronRight className={`w-4 h-4 transition-transform duration-150 ${isOpen ? "rotate-90" : ""}`} />
          </button>
        ) : (
          <span className="w-6 flex-shrink-0" aria-hidden />
        )}
        <ItemLink id={id} className="flex items-center gap-2 min-w-0 px-1.5 py-0.5 rounded-md hover:bg-slate-700/40 transition-colors">
          <CropImage cropId={id} cropName={name} width={22} height={22} showFallback={false} />
          <span className={`text-sm truncate ${getRarityColor(mutation?.rarity)}`}>{name}</span>
        </ItemLink>
        {!canExpand && source.note && (
          <span title={source.note} className="ml-1 flex items-center gap-1 text-[11px] text-amber-400/90 cursor-help">
            <WandSparkles className="w-3 h-3" />
            special
          </span>
        )}
        {!canExpand && !source.note && !mutation && (
          <span className="ml-1 text-[11px] text-slate-500">base crop</span>
        )}
      </div>

      {isOpen && (
        <div className="ml-3 pl-3 border-l border-slate-600/40">
          {source.note && <p className="py-1 text-xs text-amber-300/80">{source.note}</p>}
          <ul role="group" className="space-y-0.5">
            {children.map((child) => (
              <TreeNode
                key={child}
                id={child}
                path={`${path}/${child}`}
                ancestors={[...ancestors, id]}
                data={data}
                expanded={expanded}
                onToggle={onToggle}
              />
            ))}
          </ul>
        </div>
      )}
    </li>
  );
};

function nameOf(data: GreenhouseDataJSON, id: string): string {
  return data.mutations[id]?.name ?? data.crops[id]?.name ?? formatName(id);
}
