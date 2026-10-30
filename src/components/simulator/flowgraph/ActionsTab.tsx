import React from "react";
import { Check, ChevronDown, Pencil, RotateCcw, X } from "lucide-react";
import type { Policies, PolicyOverrides } from "../../../simulator";
import { useContextMenu } from "../../ui/contextMenuContext";
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
        <p className="rounded-xl border border-dashed border-slate-700/70 px-3 py-3 text-center text-[12px] text-slate-500">Nothing overridden: everything below is inherited from {inheritsFrom}. Click a value to override it.</p>
      )}
      <KitLabel className="mt-5 mb-2">Inherited</KitLabel>
      <div className="flex flex-col gap-3">
        {sections.map((s) => (
          <div key={s} className="@container rounded-xl border border-slate-700/50 bg-slate-800/30 px-1 py-1">
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

/** The value as a select-like field: bordered pill with a chevron (the same look as the Go-to dropdown). */
const ValuePill: React.FC<{ text: string; tone: "override" | "inherited" }> = ({ text, tone }) => (
  <span
    className={`inline-flex h-[26px] max-w-full min-w-0 items-center gap-1.5 rounded-[7px] border pr-1.5 pl-2 text-[12.5px] font-medium transition-colors duration-150 ${
      tone === "override"
        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200 group-hover/row:border-emerald-400/60"
        : "border-slate-600/40 bg-slate-950/50 text-slate-300 group-hover/row:border-slate-500/70 group-hover/row:text-slate-100"
    }`}
  >
    <span className="truncate">{text}</span>
    <ChevronDown className={`h-3 w-3 shrink-0 ${tone === "override" ? "text-emerald-400/80" : "text-slate-500 group-hover/row:text-slate-300"}`} />
  </span>
);

const OverrideRow: React.FC<{ field: Field; value: string; inherited: string; inheritsFrom: string; onChange: (v: string | undefined) => void }> = ({
  field,
  value,
  inherited,
  inheritsFrom,
  onChange,
}) => {
  const rise = useRiseIn();
  const openMenu = useContextMenu();
  return (
    <div
      className={`flex items-center gap-1 rounded-xl border border-emerald-500/20 bg-slate-800/50 pr-1 ${rise}`}
      onContextMenu={(e) =>
        openMenu(e, [
          { heading: field.label },
          ...field.options.map((o) => ({ label: o.label, icon: o.value === value ? <Check className="text-emerald-400" /> : undefined, disabled: o.value === value, onSelect: () => onChange(o.value) })),
          { separator: true },
          { label: `Reset to inherited (${labelOf(field, inherited)})`, icon: <RotateCcw />, title: `Inherit from ${inheritsFrom}`, onSelect: () => onChange(undefined) },
        ])
      }
    >
      <Dropdown
        label={`${field.label}: ${labelOf(field, value)}. Change`}
        title={field.help ? `${field.help}\n\nClick to change.` : "Click to change"}
        look="plain"
        chevron={false}
        align="end"
        width={260}
        className="group/row flex min-w-0 flex-1 items-center gap-2.5 rounded-l-xl py-2 pr-1 pl-3 text-left transition-colors duration-150 hover:bg-slate-700/30"
        button={
          <>
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" aria-hidden />
            <span className="min-w-0 flex-1 text-[12.5px] leading-snug text-slate-100">
              {field.label}
              {inherited !== value && <span className="block text-[11px] text-slate-500">otherwise {labelOf(field, inherited)}</span>}
            </span>
            <span className="flex min-w-0 max-w-[50%] shrink justify-end" title={labelOf(field, value)}>
              <ValuePill text={labelOf(field, value)} tone="override" />
            </span>
          </>
        }
      >
        {(close) => <ValueMenu field={field} value={value} inherited={inherited} onPick={(c) => (onChange(c), close())} />}
      </Dropdown>
      <IconButton aria-label={`Reset to inherited (${labelOf(field, inherited)} from ${inheritsFrom})`} onClick={() => onChange(undefined)} className="text-slate-500 hover:text-slate-200">
        <X />
      </IconButton>
    </div>
  );
};

const InheritedRow: React.FC<{ field: Field; value: string; onChange: (v: string) => void }> = ({ field, value, onChange }) => {
  const openMenu = useContextMenu();
  return (
  <div
    onContextMenu={(e) =>
      openMenu(e, [
        { heading: `Override ${field.label.toLowerCase()}` },
        ...field.options.map((o) => ({ label: o.label, title: o.value === value ? "The inherited value: pins it here" : undefined, icon: o.value === value ? <Check className="text-slate-500" /> : undefined, onSelect: () => onChange(o.value) })),
      ])
    }
  >
  <Dropdown
    label={`${field.label}: ${labelOf(field, value)} (inherited). Override`}
    title={field.help ? `${field.help}\n\nClick to override.` : "Click to override"}
    look="plain"
    chevron={false}
    align="end"
    width={260}
    className="group/row flex w-full items-center gap-2 rounded-lg py-1.5 pr-1.5 pl-2.5 text-left transition-colors duration-150 hover:bg-slate-700/40 aria-expanded:bg-slate-700/40"
    button={
      <>
        <span className="min-w-0 flex-1 text-[12.5px] leading-snug text-slate-400 transition-colors duration-150 group-hover/row:text-slate-100">{field.label}</span>
        <span
          className="hidden shrink-0 items-center gap-1 text-[11px] font-medium text-slate-400 opacity-0 transition-opacity duration-150 group-hover/row:opacity-100 group-focus-visible/row:opacity-100 @[21rem]:flex [@media(hover:none)]:hidden"
          aria-hidden
        >
          <Pencil className="h-3 w-3" /> Override
        </span>
        <span className="flex min-w-0 max-w-[50%] shrink justify-end" title={labelOf(field, value)}>
          <ValuePill text={labelOf(field, value)} tone="inherited" />
        </span>
      </>
    }
  >
    {(close) => <ValueMenu field={field} value={value} inherited={value} onPick={(c) => (c !== undefined && onChange(c), close())} overrideOnly />}
  </Dropdown>
  </div>
  );
};
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
