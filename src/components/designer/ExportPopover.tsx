import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ClipboardCopy, Download } from "lucide-react";
import { KitButton } from "../ui/kit";
import { Popover } from "../ui/Popover";
import { useToast } from "../ui/toastContext";
import { copyBlobToClipboard, downloadBlob, renderLayoutImage } from "../../utilities/layoutImageBrowser";
import type { LayoutImageModel } from "../../utilities/layoutImage";

interface ExportState {
  phase: "rendering" | "ready" | "error";
  blob?: Blob;
  url?: string;
  error?: string;
}

interface ExportPanelProps {
  /** The layout to draw (layoutImage.ts): the same picture as the Discord embed of a share link. */
  model: () => LayoutImageModel;
  onDone: () => void;
}

/**
 * Export image: a preview of the exact PNG, Copy and Download. The picture is drawn from the layout's
 * data (layoutImage.ts), not captured from the grid, so a highlight, hover or zoom never shows in it.
 */
export const ExportPanel: React.FC<ExportPanelProps> = ({ model, onDone }) => {
  const { toast } = useToast();
  const [state, setState] = useState<ExportState>({ phase: "rendering" });
  const live = useRef({ model, toast });
  useLayoutEffect(() => {
    live.current = { model, toast };
  });

  useEffect(() => {
    let alive = true;
    let url: string | undefined;
    void (async () => {
      try {
        const r = await renderLayoutImage(live.current.model());
        url = r.url;
        if (alive) setState({ phase: "ready", blob: r.blob, url: r.url });
        else URL.revokeObjectURL(r.url);
      } catch (err) {
        console.error("Export failed:", err);
        const msg = err instanceof Error ? err.message : "Failed to draw the image";
        if (alive) setState({ phase: "error", error: msg });
        live.current.toast({ title: "Export failed", description: msg, variant: "error", duration: 5000 });
      }
    })();
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, []);

  const download = () => {
    if (!state.blob) return;
    const filename = `SkyShards-layout-${Date.now()}.png`;
    downloadBlob(state.blob, filename);
    toast({ title: "Downloaded", description: `Saved as ${filename}`, variant: "success", duration: 3000 });
    onDone();
  };
  const copy = async () => {
    if (!state.blob) return;
    if (await copyBlobToClipboard(state.blob)) {
      toast({ title: "Copied the image", description: "Paste it in Discord", variant: "success", duration: 3000 });
      onDone();
    } else {
      toast({ title: "Can't copy here", description: "Downloading it instead", variant: "warning", duration: 3000 });
      download();
    }
  };
  const ready = state.phase === "ready";

  return (
    <div className="flex flex-col gap-3 p-2">
      <span className="text-body font-semibold text-fg">Export image</span>
      {/* Landscape like the image itself; contained, so the whole picture shows. */}
      <div className="relative aspect-[3/2] shrink-0 overflow-hidden rounded-control border border-line bg-surface-well">
        {ready && state.url ? (
          <img src={state.url} alt="Preview of the layout image" className="kit-fade-in absolute inset-0 size-full object-contain" />
        ) : state.phase === "error" ? (
          <p role="alert" className="absolute inset-0 grid place-items-center px-4 text-center text-secondary text-problem">
            {state.error}
          </p>
        ) : (
          <p role="status" className="absolute inset-0 grid place-items-center text-secondary text-fg-muted">
            Drawing the image…
          </p>
        )}
      </div>
      <div className="grid shrink-0 grid-cols-2 gap-2">
        <KitButton size="md" disabled={!ready} title="Copy the PNG to paste it in Discord" onClick={() => void copy()}>
          <ClipboardCopy /> Copy
        </KitButton>
        <KitButton size="md" disabled={!ready} onClick={download}>
          <Download /> Download
        </KitButton>
      </div>
    </div>
  );
};

/** The Export popover: beside the rail (`beside`) on desktop; under the button where there is no room (the phone toolbar). */
export const ExportPopover: React.FC<ExportPanelProps & { anchor: HTMLElement | null; beside?: HTMLElement | null; open: boolean; onClose: () => void }> = ({
  anchor,
  beside,
  open,
  onClose,
  ...panel
}) => (
  <Popover anchor={anchor} open={open} onClose={onClose} label="Export image" width={380} side="right" beside={beside}>
    <ExportPanel {...panel} />
  </Popover>
);
