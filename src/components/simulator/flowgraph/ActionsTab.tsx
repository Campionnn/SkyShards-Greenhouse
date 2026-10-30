import React from "react";
import { RotateCcw, X } from "lucide-react";
import type { Policies, PolicyOverrides } from "../../../simulator";
import { ACTION_FIELDS, labelOf, type Field } from "./InspectorFields";
import { IconButton, KitLabel } from "../../ui/kit";
import { Dropdown, MenuItem, MenuLabel, MenuSeparator } from "./InspectorPopover";
import { RiseScope, useRiseIn } from "./InspectorMotion";

// What the player does while a step (or a whole plot) is active. Overrides come first, in colour,
// each with its own value menu and a reset; everything else is listed below under "Inherited" in
// muted text with the value it actually inherits. Clicking an inherited row overrides it.

export const ActionsTab: React.FC<{
  value: PolicyOverrides | undefined;
  onChange: (p: PolicyOverrides | undefined) => void;
  /** The effective policies this level inherits (scenario defaults, then the plot's overrides for a step). */
  inherited: Policies;
  /** Text above the list. */
  hint?: React.ReactNode;
  /** Where inherited values come from, for the reset tooltip ("the plot", "the scenario"). */
  inheritsFrom?: string;
}> = ({ value, onChange, inherited, hint, inheritsFrom = "the plot" }) => {
  const v = value ?? {};
  const commit = (next: PolicyOverrides) => onChange(Object.keys(next).length ? next : undefined);
  const set = (f: Field, choice: string | undefined) => commit(f.set(v, choice));
  const overridden = ACTION_FIELDS.filter((f) => f.get(v) !== undefined);
  const rest = ACTION_FIELDS.filter((f) => f.get(v) === undefined);
  const sections = [...new Set(rest.map((f) => f.section))];

  return (
    <RiseScope>
      {hint && <p className="mb-3 text-[12px] leading-relaxed text-slate-500">{hint}</p>}
      {overridden.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <KitLabel
            actions={
              overridden.length > 1 ? (
                <button type="button" onClick={() => onChange(undefined)} className="flex cursor-pointer items-center gap-1 text-[11px] text-slate-500 transition-colors duration-150 hover:text-slate-200">
                  <RotateCcw className="h-3 w-3" /> Reset all
                </button>
              ) : undefined
            }
          >
            Overridden here
          </KitLabel>
          {overridden.map((f) => (
            <OverrideRow key={f.id} field={f} value={f.get(v)!} inherited={f.effective(inherited)} inheritsFrom={inheritsFrom} onChange={(c) => set(f, c)} />
          ))}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-slate-700/70 px-3 py-3 text-center text-[12px] text-slate-500">Nothing overridden: everything below is inherited from {inheritsFrom}.</p>
      )}
      <KitLabel className="mt-5 mb-2">Inherited</KitLabel>
      <div className="flex flex-col gap-3">
        {sections.map((s) => (
          <div key={s} className="rounded-xl border border-slate-700/50 bg-slate-800/30 px-1 py-1">
            <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium text-slate-500">{s}</div>
            {rest
              .filter((f) => f.section === s)
              .map((f) => (
                <InheritedRow key={f.id} field={f} value={f.effective(inherited)} onChange={(c) => set(f, c)} />
              ))}
          </div>
        ))}
        {sections.length === 0 && <p className="text-[12px] text-slate-500">Every action is overridden here.</p>}
      </div>
    </RiseScope>
  );
};

const OverrideRow: React.FC<{ field: Field; value: string; inherited: string; inheritsFrom: string; onChange: (v: string | undefined) => void }> = ({
  field,
  value,
  inherited,
  inheritsFrom,
  onChange,
}) => {
  const rise = useRiseIn();
  return (
    <div className={`flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-slate-800/50 py-2 pr-1.5 pl-3 ${rise}`}>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" aria-hidden />
      <span className="min-w-0 flex-1 text-[12.5px] text-slate-200" title={field.help}>
        {field.label}
        {inherited !== value && <span className="block text-[11px] text-slate-500">otherwise {labelOf(field, inherited)}</span>}
      </span>
      <Dropdown
        label={`${field.label}: ${labelOf(field, value)}`}
        look="plain"
        align="end"
        width={250}
        className="flex h-7 max-w-[60%] items-center gap-1 rounded-lg px-2 text-[12.5px] font-medium text-emerald-300 transition-colors duration-150 hover:bg-emerald-500/10"
        button={<span className="truncate">{labelOf(field, value)}</span>}
      >
        {(close) => <ValueMenu field={field} value={value} inherited={inherited} onPick={(c) => (onChange(c), close())} />}
      </Dropdown>
      <IconButton aria-label={`Reset to inherited (${labelOf(field, inherited)} from ${inheritsFrom})`} onClick={() => onChange(undefined)} className="text-slate-500">
        <X />
      </IconButton>
    </div>
  );
};

const InheritedRow: React.FC<{ field: Field; value: string; onChange: (v: string) => void }> = ({ field, value, onChange }) => (
  <Dropdown
    label={`${field.label}: ${labelOf(field, value)} (inherited). Override`}
    title={field.help ? `${field.help}\n\nClick to override.` : "Click to override"}
    look="plain"
    chevron={false}
    align="end"
    width={250}
    className="group/inh flex w-full items-center gap-3 rounded-lg px-2.5 py-[7px] text-left text-[12.5px] transition-colors duration-150 hover:bg-slate-700/40"
    button={
      <>
        <span className="min-w-0 flex-1 text-slate-400 group-hover/inh:text-slate-200">{field.label}</span>
        <span className="max-w-[55%] text-right text-slate-500">{labelOf(field, value)}</span>
      </>
    }
  >
    {(close) => <ValueMenu field={field} value={value} inherited={value} onPick={(c) => (c !== undefined && onChange(c), close())} overrideOnly />}
  </Dropdown>
);

const ValueMenu: React.FC<{ field: Field; value: string; inherited: string; onPick: (v: string | undefined) => void; overrideOnly?: boolean }> = ({
  field,
  value,
  inherited,
  onPick,
  overrideOnly,
}) => (
  <>
    <MenuLabel>{overrideOnly ? "Override with" : field.label}</MenuLabel>
    {field.options.map((o) => (
      <MenuItem key={o.value} checked={!overrideOnly && o.value === value} hint={o.value === inherited ? "the inherited value" : undefined} onSelect={() => onPick(o.value)}>
        {o.label}
      </MenuItem>
    ))}
    {!overrideOnly && (
      <>
        <MenuSeparator />
        <MenuItem icon={<RotateCcw />} onSelect={() => onPick(undefined)}>
          Inherit ({labelOf(field, inherited)})
        </MenuItem>
      </>
    )}
  </>
);
