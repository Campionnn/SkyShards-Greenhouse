import { useState } from "react";
import type { Scenario } from "../../../simulator";
import { useToast } from "../../ui";
import { FlowExportDialog } from "../FlowExportDialog";
import { exportFlows, type FlowExportOptions } from "../scenarioEdit";
import { ImportDialog } from "./ImportDialog";
import { SavedFlowsDialog } from "./SavedFlowsDialog";

// Save / Load (this browser) and Export / Import (files), reachable from the command bar's Flows menu and the drawer's Scenario tab. One
// hook owns the dialogs; the page renders `dialogs` once. Submitting to the leaderboard is the
// page's Leaderboard tab (LeaderboardTab.tsx), not a dialog.

export function useShare(scenario: Scenario, onChange: (sc: Scenario) => void) {
  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [saved, setSaved] = useState<null | "save" | "load">(null);

  const exportJson = async (options: FlowExportOptions, fileName: string) => {
    const text = JSON.stringify(exportFlows(scenario, options), null, 2);
    const blob = new Blob([text], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(a.href);
    setExporting(false);
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      // Download still works when clipboard access is unavailable or denied.
    }
    toast({
      title: "Flows exported",
      description: `${copied ? "Downloaded and copied." : "Downloaded."} ${Object.values(options).some(Boolean) ? "Includes your selected setup sections." : "Only flows are included; settings and starting inventory are left out."}`,
      variant: "success",
    });
  };

  const dialogs = (
    <>
      {exporting && <FlowExportDialog onClose={() => setExporting(false)} onExport={exportJson} />}
      {importing && <ImportDialog scenario={scenario} onChange={onChange} onClose={() => setImporting(false)} />}
      {saved && <SavedFlowsDialog scenario={scenario} onChange={onChange} focus={saved} onClose={() => setSaved(null)} />}
    </>
  );
  return { openExport: () => setExporting(true), openImport: () => setImporting(true), openSave: () => setSaved("save"), openLoad: () => setSaved("load"), dialogs };
}
