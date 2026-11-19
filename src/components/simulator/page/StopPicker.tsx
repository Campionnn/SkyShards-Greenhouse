import React, { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { StopFilter } from "../../../simulator/worker/stopFilter";
import { cn } from "../../ui/cn";
import { KitButton, Switch, ToggleChip } from "../../ui/kit";
import { DialogFrame, ModalDialog } from "../../ui/ModalDialog";
import { DEFAULT_FILTER, filterSummary, itemIds, onCount, STOP_CATEGORIES, STOP_PRESETS, withCategory, withItem, type StopCategory } from "./stepBy";

// Which stops Step goes to (Step by: Detail): five categories, each a switch with its own items
// (phases in the order the engine runs them, actions and hooks in groups), plus quick picks, plots
// and skipping phases that changed nothing. Changes apply at once.

const Category: React.FC<{ c: StopCategory; filter: StopFilter; onChange: (f: StopFilter) => void; large?: boolean }> = ({ c, filter, onChange, large }) => {
  const on = filter.kinds.includes(c.kind);
  const all = itemIds(c).length;
  const n = onCount(filter, c);
  const [open, setOpen] = useState(on && n < all);
  const bodyId = useId();
  const off = filter.off?.[c.kind] ?? [];
  let number = 0;
  return (
    <li className="border-b border-line last:border-b-0">
      <div className={cn("flex items-center gap-3 py-2", large && "min-h-14")}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={bodyId}
          className="focus-ring -ml-1 flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-control px-1 py-1 text-left hover:bg-surface-hover/50"
        >
          <ChevronDown aria-hidden className={cn("size-3.5 shrink-0 text-fg-meta transition-transform duration-(--duration-ink) ease-snappy", !open && "-rotate-90")} />
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-2">
              <span className="text-body font-medium text-fg">{c.label}</span>
              <span className="text-meta tabular-nums text-fg-meta">{on ? (n >= all ? `all ${all}` : `${n} of ${all}`) : "off"}</span>
            </span>
            <span className="block text-meta text-fg-meta">{c.hint}</span>
          </span>
        </button>
        <Switch checked={on} label={c.label} onChange={(v) => onChange(withCategory(filter, c.kind, v))} />
      </div>
      {open && (
        <div id={bodyId} className="space-y-2.5 pb-3 pl-6">
          {c.groups.map((g, gi) => (
            <div key={gi} role="group" aria-label={g.label ?? c.label}>
              {g.label && <div className="mb-1 text-label uppercase text-fg-meta">{g.label}</div>}
              <div className="flex flex-wrap gap-1.5">
                {g.items.map((item) => {
                  number += 1;
                  return (
                    <ToggleChip
                      key={item.id}
                      pressed={on && !off.includes(item.id)}
                      onChange={(v) => onChange(withItem(filter, c.kind, item.id, v))}
                      index={c.ordered ? number : undefined}
                      title={item.title}
                      size={large ? "touch" : "sm"}
                    >
                      {item.label}
                    </ToggleChip>
                  );
                })}
              </div>
            </div>
          ))}
          {c.ordered && <p className="text-meta text-fg-meta">Numbered in the order the engine runs them, once per plot.</p>}
        </div>
      )}
    </li>
  );
};

/** The picker's body (also rendered by the SSR test). */
export const StopPickerPanel: React.FC<{ filter: StopFilter; onChange: (f: StopFilter) => void; plotIds: number[]; large?: boolean }> = ({ filter, onChange, plotIds, large }) => {
  const plots = filter.plots ?? [];
  return (
    <div className="space-y-4" data-testid="stop-picker">
      <div>
        <div className="mb-1.5 text-label uppercase text-fg-meta">Quick picks</div>
        <div className="flex flex-wrap gap-1.5">
          {STOP_PRESETS.map((p) => {
            const same = p.filter.kinds.length === filter.kinds.length && p.filter.kinds.every((k) => filter.kinds.includes(k)) && !filter.off;
            return (
              <ToggleChip key={p.label} pressed={same} title={p.title} size={large ? "touch" : "sm"} onChange={() => onChange({ ...filter, kinds: [...p.filter.kinds], off: undefined })}>
                {p.label}
              </ToggleChip>
            );
          })}
        </div>
      </div>

      <ul className="rounded-container border border-line px-3">
        {STOP_CATEGORIES.map((c) => (
          <Category key={c.kind} c={c} filter={filter} onChange={onChange} large={large} />
        ))}
      </ul>

      {plotIds.length > 1 && (
        <div role="group" aria-label="Plots">
          <div className="mb-1.5 text-label uppercase text-fg-meta">Plots</div>
          <div className="flex flex-wrap gap-1.5">
            <ToggleChip pressed={plots.length === 0} size={large ? "touch" : "sm"} onChange={() => onChange({ ...filter, plots: undefined })}>
              All plots
            </ToggleChip>
            {plotIds.map((id) => (
              <ToggleChip
                key={id}
                pressed={plots.includes(id)}
                size={large ? "touch" : "sm"}
                onChange={(v) => {
                  const next = v ? [...plots, id].sort((a, b) => a - b) : plots.filter((x) => x !== id);
                  onChange({ ...filter, plots: next.length && next.length < plotIds.length ? next : undefined });
                }}
              >
                Plot {id}
              </ToggleChip>
            ))}
          </div>
          <p className="mt-1 text-meta text-fg-meta">Selling surplus and controller hooks belong to no plot and always count.</p>
        </div>
      )}

      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-body text-fg-body">Skip phases that changed nothing</div>
          <div className="text-meta text-fg-meta">E.g. Soggybud on a plot without one, or Break roots with no Devourer</div>
        </div>
        <Switch checked={filter.skipIdle === true} label="Skip phases that changed nothing" onChange={(v) => onChange({ ...filter, skipIdle: v || undefined })} />
      </div>
    </div>
  );
};

export const StopPickerDialog: React.FC<{ filter: StopFilter; onChange: (f: StopFilter) => void; plotIds: number[]; onClose: () => void; large?: boolean }> = ({ filter, onChange, plotIds, onClose, large }) => {
  const id = useId();
  return (
    <ModalDialog labelledBy={id} onClose={onClose} maxWidth="max-w-xl">
      <DialogFrame
        id={id}
        title="Step through a cycle"
        onClose={onClose}
        footer={
          <>
            <span className="mr-auto min-w-0 self-center truncate text-secondary text-fg-meta" title={filterSummary(filter)}>
              {filterSummary(filter)}
            </span>
            <KitButton variant="ghost" onClick={() => onChange(DEFAULT_FILTER)}>
              Reset
            </KitButton>
            <KitButton variant="primary" onClick={onClose}>
              Done
            </KitButton>
          </>
        }
      >
        <StopPickerPanel filter={filter} onChange={onChange} plotIds={plotIds} large={large} />
      </DialogFrame>
    </ModalDialog>
  );
};
