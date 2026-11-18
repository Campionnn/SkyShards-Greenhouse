import { useCallback, useEffect, useRef, useState } from "react";
import type { Scenario } from "../../../simulator";
import { useToast } from "../../ui";
import { importFlows } from "../scenarioEdit";

/** Reads a dropped / picked file as text, without a byte-order mark. */
export async function readFlowsFile(file: File): Promise<string> {
  return (await file.text()).replace(/^\uFEFF/, "");
}

/** True when a drag carries files from outside the page (not an in-page drag such as a step reorder). */
export function dragHasFiles(e: { dataTransfer: DataTransfer | null }): boolean {
  return !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");
}

/** The first file of a drop that looks like JSON (by name or type); else the first file. */
export function pickFlowsFile(files: FileList | null | undefined): File | null {
  if (!files?.length) return null;
  const all = Array.from(files);
  return all.find((f) => /\.json$/i.test(f.name) || f.type.includes("json")) ?? all[0];
}

/**
 * Replaces the scenario's plots with a flows file (and the setup sections it includes), with an Undo
 * toast. Returns false (after an error toast) when the text is not a valid flows file. Shared by the
 * Import dialog and dropping a file on the simulator page.
 */
export function useFlowsImport(scenario: Scenario, onChange: (sc: Scenario) => void) {
  const { toast } = useToast();
  return useCallback(
    (text: string, fileName?: string): boolean => {
      let next: Scenario;
      try {
        next = importFlows(scenario, text);
      } catch (err) {
        toast({
          id: "simulator-flows-import-failed",
          title: fileName ? `Could not import ${fileName}` : "Import failed",
          description: err instanceof Error ? err.message : String(err),
          variant: "error",
        });
        return false;
      }
      const before = scenario;
      onChange(next);
      const plots = `${next.plots.length} plot${next.plots.length > 1 ? "s" : ""}`;
      toast({
        id: "simulator-flows-imported",
        title: fileName ? `Imported ${fileName}` : `Imported ${plots}`,
        description:
          (fileName ? `${plots}. ` : "") +
          (next.settings !== before.settings || next.startingInventory !== before.startingInventory
            ? "Replaced your plots and applied the included setup. Omitted settings are unchanged."
            : "Replaced your plots; your player settings and inventory are unchanged."),
        variant: "success",
        duration: 6000,
        action: { label: "Undo", onClick: () => onChange(before) },
      });
      return true;
    },
    [scenario, onChange, toast]
  );
}

/**
 * Page-wide file drop: `active` while files are dragged over the window, and `onFile` on drop.
 * Dropping a file anywhere never navigates the tab away. Off while a modal dialog is open (the
 * dialog sits in the top layer above any overlay; the Import dialog has its own drop zone), and
 * a drop a nested zone already handled (`defaultPrevented`) is left alone.
 */
export function useFileDrop(onFile: (file: File) => void, enabled: boolean) {
  const [active, setActive] = useState(false);
  const depth = useRef(0);
  const onFileRef = useRef(onFile);
  useEffect(() => {
    onFileRef.current = onFile;
  }, [onFile]);

  useEffect(() => {
    const blocked = () => !enabled || !!document.querySelector("dialog[open]");
    const reset = () => {
      depth.current = 0;
      setActive(false);
    };
    const enter = (e: DragEvent) => {
      if (!dragHasFiles(e)) return;
      depth.current += 1;
      if (!blocked()) setActive(true);
    };
    const over = (e: DragEvent) => {
      if (!dragHasFiles(e) || e.defaultPrevented) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = blocked() ? "none" : "copy";
    };
    const leave = (e: DragEvent) => {
      if (!dragHasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setActive(false);
    };
    const drop = (e: DragEvent) => {
      if (!dragHasFiles(e)) return;
      const handled = e.defaultPrevented;
      e.preventDefault();
      reset();
      if (handled || blocked()) return;
      const file = pickFlowsFile(e.dataTransfer?.files);
      if (file) onFileRef.current(file);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
      window.removeEventListener("blur", reset);
    };
  }, [enabled]);

  return active;
}
