import React, { useEffect, useRef, useState } from "react";
import { FileJson, X } from "lucide-react";
import type { Scenario } from "../../../simulator";
import { useToast } from "../../ui";
import { KitButton, KitTextarea } from "../../ui/kit";
import { importFlows } from "../scenarioEdit";
/** Pick a flows JSON file or paste it, then replace the plots (with Undo). */
export const ImportDialog: React.FC<{ scenario: Scenario; onChange: (sc: Scenario) => void; onClose: () => void }> = ({ scenario, onChange, onClose }) => {
  const { toast } = useToast();
  const [json, setJson] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const readId = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pickFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    const id = ++readId.current;
    setReading(true);
    try {
      const text = await file.text();
      if (id !== readId.current) return;
      setJson(text.replace(/^\uFEFF/, ""));
      setFileName(file.name);
    } catch {
      if (id === readId.current) toast({ title: "Could not read file", description: "Try selecting the JSON file again, or paste its contents.", variant: "error" });
    } finally {
      if (id === readId.current) setReading(false);
    }
  };

  const load = () => {
    try {
      const next = importFlows(scenario, json);
      const before = scenario;
      onChange(next);
      onClose();
      toast({
        id: "simulator-flows-imported",
        title: `Imported ${next.plots.length} plot${next.plots.length > 1 ? "s" : ""}`,
        description:
          next.settings !== before.settings || next.startingInventory !== before.startingInventory
            ? "Replaced your plots and applied the included setup. Omitted settings are unchanged."
            : "Replaced your plots; your player settings and inventory are unchanged.",
        variant: "success",
        duration: 6000,
        action: { label: "Undo", onClick: () => onChange(before) },
      });
    } catch (err) {
      toast({ title: "Import failed", description: err instanceof Error ? err.message : String(err), variant: "error" });
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm kit-fade-in" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Import flows" className="w-full max-w-lg rounded-xl border border-slate-600/40 bg-slate-900 shadow-2xl kit-pop-in">
        <div className="flex items-center justify-between border-b border-slate-700/60 px-4 py-3">
          <h2 className="text-[14px] font-semibold text-slate-100">Import flows</h2>
          <button type="button" className="cursor-pointer rounded-lg p-1 text-slate-400 hover:bg-slate-700/50 hover:text-slate-100" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3 p-4">
          <p className="text-[12px] text-slate-400">
            Replaces your plots and any setup sections included in the file. Settings and starting inventory left out of the file stay as they are.
          </p>
          <input
            type="file"
            accept=".json,application/json"
            onChange={pickFile}
            disabled={reading}
            className="w-full text-[12.5px] text-slate-300 file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-slate-700 file:px-3 file:py-1.5 file:text-[12px] file:text-slate-100"
          />
          <p className="text-[11.5px] text-slate-500" role="status">
            {reading ? "Reading file…" : fileName ? `Loaded ${fileName}.` : "Or paste exported flows JSON:"}
          </p>
          <KitTextarea
            className="h-32 w-full font-mono text-[12px]"
            aria-label="Flows JSON"
            placeholder="Paste exported flows JSON"
            value={json}
            disabled={reading}
            onChange={(e) => {
              setJson(e.target.value);
              setFileName(null);
            }}
          />
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-700/60 px-4 py-3">
          <KitButton variant="ghost" onClick={onClose}>
            Cancel
          </KitButton>
          <KitButton variant="primary" onClick={load} disabled={reading || !json.trim()}>
            <FileJson /> Import
          </KitButton>
        </div>
      </div>
    </div>
  );
};
