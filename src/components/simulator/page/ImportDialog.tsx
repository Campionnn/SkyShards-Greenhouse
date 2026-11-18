import React, { useRef, useState } from "react";
import { FileJson, Upload } from "lucide-react";
import type { Scenario } from "../../../simulator";
import { cn, useToast } from "../../ui";
import { KitButton, KitTextarea } from "../../ui/kit";
import { DialogFrame, ModalDialog } from "../../ui/ModalDialog";
import { dragHasFiles, pickFlowsFile, readFlowsFile, useFlowsImport } from "./flowsImport";

/** Pick or drop a flows JSON file, or paste it, then replace the plots (with Undo). A kit ModalDialog:
 *  Escape, backdrop click and the close button dismiss it, and focus returns to the trigger. */
export const ImportDialog: React.FC<{ scenario: Scenario; onChange: (sc: Scenario) => void; onClose: () => void }> = ({ scenario, onChange, onClose }) => {
  const { toast } = useToast();
  const importText = useFlowsImport(scenario, onChange);
  const [json, setJson] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [over, setOver] = useState(false);
  const readId = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const depth = useRef(0);

  const readFile = async (file: File) => {
    const id = ++readId.current;
    setReading(true);
    try {
      const text = await readFlowsFile(file);
      if (id !== readId.current) return;
      setJson(text);
      setFileName(file.name);
    } catch {
      if (id === readId.current) toast({ title: "Could not read file", description: "Try selecting the JSON file again, or paste its contents.", variant: "error" });
    } finally {
      if (id === readId.current) setReading(false);
    }
  };

  const pickFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) void readFile(file);
  };

  const load = () => {
    if (importText(json, fileName ?? undefined)) onClose();
  };

  const dropProps = {
    onDragEnter: (e: React.DragEvent) => {
      if (!dragHasFiles(e)) return;
      depth.current += 1;
      setOver(true);
    },
    onDragOver: (e: React.DragEvent) => {
      if (!dragHasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!dragHasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    },
    onDrop: (e: React.DragEvent) => {
      if (!dragHasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setOver(false);
      const file = pickFlowsFile(e.dataTransfer.files);
      if (file && !reading) void readFile(file);
    },
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
          <input ref={input} type="file" accept=".json,application/json" onChange={pickFile} disabled={reading} className="sr-only" tabIndex={-1} aria-hidden />
          <button
            type="button"
            {...dropProps}
            onClick={() => input.current?.click()}
            disabled={reading}
            className={cn(
              "focus-ring flex w-full cursor-pointer flex-col items-center gap-2 rounded-container border border-dashed px-4 py-5 text-center",
              "transition-[background-color,border-color] duration-(--duration-hover) ease-snappy disabled:cursor-wait disabled:opacity-60",
              over
                ? "border-go bg-go/10"
                : fileName
                  ? "border-go/40 bg-go/5 hover:border-go/60"
                  : "border-line-control bg-surface-well hover:border-go/50 hover:bg-surface-hover"
            )}
          >
            <span
              className={cn(
                "flex size-9 items-center justify-center rounded-control border transition-colors duration-(--duration-hover)",
                over || fileName ? "border-go/35 bg-go/10 text-go-fg" : "border-line-strong bg-surface-control text-fg-muted"
              )}
            >
              {fileName && !over ? <FileJson className="size-4" aria-hidden /> : <Upload className="size-4" aria-hidden />}
            </span>
            <span className="min-w-0 max-w-full">
              <span className="block truncate text-body font-medium text-fg" title={fileName ?? undefined}>
                {reading ? "Reading file…" : over ? "Drop to load this file" : fileName ?? "Drop a flows file here"}
              </span>
              <span className="block text-secondary text-fg-muted">
                {fileName && !over ? "Ready to import · click to choose another" : "or click to choose a .json file"}
              </span>
            </span>
          </button>
          <p className="text-secondary text-fg-meta">
            Or paste exported flows JSON:
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
