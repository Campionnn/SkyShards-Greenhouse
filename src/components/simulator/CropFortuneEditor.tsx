import React, { useState } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { FORTUNE_CROPS, type CropFortune, type FarmingToolStats, type FortuneCrop, type PlayerStats } from "../../simulator";
import { InfoHint, SectionLabel } from "../ui";
import { DialogFrame, ModalDialog } from "../ui/ModalDialog";
import { NumberInput } from "./controls";
import { nameOf } from "./format";
import { buttonClass, inputClass } from "./styles";

// Per-crop Farming Fortune and farming tools for the Player tab (economy/fortune.ts).

const cropLabel = (c: FortuneCrop) => nameOf(c);

/** Drops zero entries so an all-zero record leaves the per-crop path off (byte-identical runs). */
function cleanFortune(f: CropFortune): CropFortune {
  const out: CropFortune = {};
  for (const c of FORTUNE_CROPS) if (f[c]) out[c] = f[c];
  return out;
}

/** "Wheat 310, Carrot 120" for a collapsed tool row. */
function fortuneSummary(f: CropFortune): string {
  const parts = FORTUNE_CROPS.filter((c) => f[c]).map((c) => `${cropLabel(c)} ${f[c]}`);
  return parts.length ? parts.join(", ") : "no fortune set";
}

/** 13 crop inputs in a compact two-column grid. */
const CropFortuneGrid: React.FC<{ value: CropFortune; onChange?: (v: CropFortune) => void; label: string }> = ({ value, onChange, label }) => (
  <div className="grid grid-cols-2 gap-x-3 gap-y-1">
    {FORTUNE_CROPS.map((c) => (
      <label key={c} className="flex items-center justify-between gap-2 text-[11px] text-slate-300 min-w-0">
        <span className="truncate">{cropLabel(c)}</span>
        {onChange ? (
          <NumberInput
            className={`${inputClass} w-16 text-right flex-shrink-0`}
            aria-label={`${label}: ${cropLabel(c)}`}
            value={value[c] ?? 0}
            min={0}
            max={5000}
            onChange={(v) => onChange(cleanFortune({ ...value, [c]: v }))}
          />
        ) : (
          <span className="tabular-nums text-slate-200">{value[c] ?? 0}</span>
        )}
      </label>
    ))}
  </div>
);

const ToolRow: React.FC<{
  tool: FarmingToolStats;
  index: number;
  onChange?: (t: FarmingToolStats) => void;
  onRemove?: () => void;
}> = ({ tool, index, onChange, onRemove }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded border border-slate-700/60 bg-slate-800/30 p-1.5">
      <div className="flex items-center gap-1.5">
        <button className={buttonClass.icon} onClick={() => setOpen(!open)} aria-expanded={open} title={open ? "Hide per-crop fortune" : "Edit per-crop fortune"}>
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
        {onChange ? (
          <input
            className={`${inputClass} flex-1`}
            aria-label={`Tool ${index + 1} name`}
            placeholder={`Tool ${index + 1}`}
            value={tool.name}
            onChange={(e) => onChange({ ...tool, name: e.target.value })}
          />
        ) : (
          <span className="flex-1 min-w-0 truncate text-xs text-slate-200">{tool.name || `Tool ${index + 1}`}</span>
        )}
        {onRemove && (
          <button className={buttonClass.icon} onClick={onRemove} title="Remove tool">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {open ? (
        <div className="mt-1.5">
          <CropFortuneGrid value={tool.fortune} label={tool.name || `Tool ${index + 1}`} onChange={onChange && ((fortune) => onChange({ ...tool, fortune }))} />
        </div>
      ) : (
        <div className="mt-0.5 pl-7 text-[11px] text-slate-500 truncate" title={fortuneSummary(tool.fortune)}>
          {fortuneSummary(tool.fortune)}
        </div>
      )}
    </div>
  );
};

/**
 * The Player tab's one-line summary of crop fortune and tools, with an Edit button that opens the
 * full editor in a modal (13 crop inputs plus a tool list don't fit the settings column).
 */
export const CropFortuneSummary: React.FC<{
  stats: PlayerStats;
  onChange?: (next: PlayerStats) => void;
}> = ({ stats, onChange }) => {
  const [open, setOpen] = useState(false);
  const cropCount = FORTUNE_CROPS.filter((c) => stats.cropFortune?.[c]).length;
  const toolCount = stats.tools?.length ?? 0;
  const text = [cropCount ? `${cropCount} crop bonus${cropCount === 1 ? "" : "es"}` : "", toolCount ? `${toolCount} tool${toolCount === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ") || "none set";
  return (
    <div className="flex items-center justify-between gap-2 pt-1 text-xs" data-testid="crop-fortune-summary">
      <span className="flex min-w-0 items-center gap-1 text-slate-300">
        Crop fortune &amp; tools
        <InfoHint title="Per-crop Farming Fortune and tools" width={280}>
          Crop bonus on top of Farming Fortune (Wheat Fortune, Mushroom Fortune, ...) and your farming tools. Every harvest uses the tool that earns the most on
          it.
        </InfoHint>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <span className="text-slate-500">{text}</span>
        <button type="button" className={buttonClass.neutral} onClick={() => setOpen(true)}>
          {onChange ? "Edit" : "View"}
        </button>
      </span>
      {open && (
        <ModalDialog labelledBy="crop-fortune-title" onClose={() => setOpen(false)} maxWidth="max-w-xl">
          <DialogFrame
            id="crop-fortune-title"
            title="Crop fortune & tools"
            onClose={() => setOpen(false)}
            footer={
              <button type="button" className={buttonClass.primary} onClick={() => setOpen(false)}>
                Done
              </button>
            }
          >
            <CropFortuneEditor stats={stats} onChange={onChange} />
          </DialogFrame>
        </ModalDialog>
      )}
    </div>
  );
};

/**
 * Crop-specific fortune and the tool list. `onChange` gets the new stats; without it the editor is
 * read-only. Empty records/lists are removed so a scenario without them simulates as before.
 */
export const CropFortuneEditor: React.FC<{
  stats: PlayerStats;
  onChange?: (next: PlayerStats) => void;
}> = ({ stats, onChange }) => {
  const crop = stats.cropFortune ?? {};
  const tools = stats.tools ?? [];
  // Empty values remove the key entirely (no `undefined` left behind), as in a save without them.
  const setCrop = (cropFortune: CropFortune) => {
    const next: PlayerStats = { ...stats, cropFortune };
    if (!Object.keys(cropFortune).length) delete next.cropFortune;
    onChange?.(next);
  };
  const setTools = (list: FarmingToolStats[]) => {
    const next: PlayerStats = { ...stats, tools: list };
    if (!list.length) delete next.tools;
    onChange?.(next);
  };
  const cropCount = FORTUNE_CROPS.filter((c) => crop[c]).length;

  return (
    <div className="space-y-2 pt-1">
      <div>
        <SectionLabel>
          <span className="flex items-center gap-1">
            Crop Fortune
            <InfoHint title="Per-crop Farming Fortune" width={280}>
              Crop bonus on top of Farming Fortune: Wheat Fortune, Mushroom Fortune and so on. A crop's drops get Farming Fortune + its crop value + the held tool's
              fortune on it. Mushroom covers red and brown mushrooms; Wheat covers seeds. Mutation items are never scaled by fortune.
            </InfoHint>
          </span>
        </SectionLabel>
        <p className="mb-1 text-[11px] text-slate-400">Crop bonus on top of Farming Fortune {cropCount ? `(${cropCount} set)` : "(none)"}</p>
        <CropFortuneGrid value={crop} label="Crop fortune" onChange={onChange && setCrop} />
      </div>
      <div>
        <SectionLabel>
          <span className="flex items-center gap-1">
            Farming tools
            <InfoHint title="Farming tools" width={280}>
              Each tool's Farming Fortune on each crop while held (its general and crop-specific fortune together). Every harvest uses the tool that makes that
              harvest worth the most coins; ties go to the first listed. No tools: no tool term (put tool fortune in Farming Fortune instead).
            </InfoHint>
          </span>
        </SectionLabel>
        {tools.length === 0 && <div className="text-[11px] text-slate-500 mb-1">No tools.</div>}
        <div className="space-y-1.5">
          {tools.map((tool, i) => (
            <ToolRow
              key={i}
              tool={tool}
              index={i}
              onChange={onChange && ((t) => setTools(tools.map((x, k) => (k === i ? t : x))))}
              onRemove={onChange && (() => setTools(tools.filter((_, k) => k !== i)))}
            />
          ))}
        </div>
        {onChange && (
          <button className={`${buttonClass.neutral} mt-1.5`} onClick={() => setTools([...tools, { name: `Tool ${tools.length + 1}`, fortune: {} }])}>
            <Plus className="w-3.5 h-3.5" /> Add tool
          </button>
        )}
      </div>
    </div>
  );
};
