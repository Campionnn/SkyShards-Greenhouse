import React, { useRef, useState } from "react";
import { FileJson } from "lucide-react";
import type { Scenario } from "../../../simulator";
import { useToast } from "../../ui";
import { KitButton, KitTextarea } from "../../ui/kit";
import { DialogFrame, ModalDialog } from "../../ui/ModalDialog";
import { importFlows } from "../scenarioEdit";

/** Pick a flows JSON file or paste it, then replace the plots (with Undo). A kit ModalDialog: Escape,
 *  backdrop click and the close button dismiss it, and focus returns to the trigger. */
export const ImportDialog: React.FC<{ scenario: Scenario; onChange: (sc: Scenario) => void; onClose: () => void }> = ({ scenario, onChange, onClose }) => {
  const { toast } = useToast();
  const [json, setJson] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const readId = useRef(0);

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
    <ModalDialog labelledBy="import-flows-title" onClose={onClose}>
      <DialogFrame
        id="import-flows-title"
        title="Import flows"
        onClose={onClose}
        footer={
          <>
            <KitButton variant="ghost" onClick={onClose}>
              Cancel
            </KitButton>
            <KitButton variant="primary" onClick={load} disabled={reading || !json.trim()}>
              <FileJson /> Import
            </KitButton>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-secondary text-fg-muted">
            Replaces your plots and any setup sections included in the file. Settings and starting inventory left out of the file stay as they are.
          </p>
          <input
            type="file"
            accept=".json,application/json"
            onChange={pickFile}
            disabled={reading}
            className="focus-ring w-full rounded-control text-body text-fg-body file:mr-3 file:cursor-pointer file:rounded-control file:border-0 file:bg-surface-hover file:px-3 file:py-1.5 file:text-secondary file:text-fg"
          />
          <p className="text-secondary text-fg-meta" role="status">
            {reading ? "Reading file…" : fileName ? `Loaded ${fileName}.` : "Or paste exported flows JSON:"}
          </p>
          <KitTextarea
            className="h-32 w-full font-mono text-secondary"
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
      </DialogFrame>
    </ModalDialog>
  );
};