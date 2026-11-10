import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ClipboardCopy, Download } from "lucide-react";
import { useDesigner } from "../../context";
import { KitButton, Segmented } from "../ui/kit";
import { Popover } from "../ui/Popover";
import { useToast } from "../ui/toastContext";
import { captureGridAsGif, captureGridAsPng, copyBlobToClipboard, downloadBlob, type ExportOptions } from "../../utilities/gridExport";
import { focusSettled, imagesReady } from "./actionsModel";

export type ExportFormat = "png" | "gif";

interface ExportState {
  phase: "rendering" | "ready" | "error";
  /** 0–100 (GIF only). */
  progress: number;
  blob?: Blob;
  url?: string;
  error?: string;
}

interface ExportPanelProps {
  initial: ExportFormat;
  /** The `[data-grid-container]` element to capture. */
  gridEl: () => HTMLElement | null;
  options: () => ExportOptions;
  /** The crops a GIF animates. */
  cropIds: () => string[];
  onDone: () => void;
}

/**
 * Export image (D08–D10): a live preview of the exact image, a PNG | GIF switch, Copy and Download side by
 * side; the GIF's progress in the same box. The image is the one the old PNG / GIF buttons made (2×, the
 * "Greenhouse Designer" watermark, the target and input lists, no trash badge). A list highlight is
 * dropped before the capture, so the image isn't faded.
 */
export const ExportPanel: React.FC<ExportPanelProps> = ({ initial, gridEl, options, cropIds, onDone }) => {
  const { placementFocus } = useDesigner();
  const { toast } = useToast();
  const [fmt, setFmt] = useState<ExportFormat>(initial);
  const [state, setState] = useState<ExportState>({ phase: "rendering", progress: 0 });
  const live = useRef({ gridEl, options, cropIds, placementFocus, toast });
  useLayoutEffect(() => {
    live.current = { gridEl, options, cropIds, placementFocus, toast };
  });

  useEffect(() => {
    let alive = true;
    void (async () => {
      const { gridEl, options, cropIds, placementFocus, toast } = live.current;
      const el = gridEl();
      if (!el) {
        setState({ phase: "error", progress: 0, error: "Grid element not found" });
        toast({ title: "Export failed", description: "Grid element not found", variant: "error", duration: 3000 });
        return;
      }
      setState({ phase: "rendering", progress: 0 });
      // Always settle: the click that opened this may itself have just unpinned a highlight (its
      // mousedown counts as "elsewhere"), so the grid can still be fading back even with nothing active.
      placementFocus.clear();
      await focusSettled();
      await imagesReady(el);
      try {
        const r =
          fmt === "png"
            ? await captureGridAsPng(el, options())
            : await captureGridAsGif(el, options(), cropIds(), (p) => {
                if (alive) setState((s) => ({ ...s, progress: p }));
              });
        if (alive) setState({ phase: "ready", progress: 100, blob: r.blob, url: r.dataUrl });
      } catch (err) {
        console.error("Export failed:", err);
        const msg = err instanceof Error ? err.message : "Failed to capture grid";
        if (alive) setState({ phase: "error", progress: 0, error: msg });
        toast({ title: "Export failed", description: msg, variant: "error", duration: 5000 });
      }
    })();
    return () => {
      alive = false;
    };
  }, [fmt]);

  const download = () => {
    if (!state.blob) return;
    const filename = `SkyShards-designer-${Date.now()}.${fmt}`;
    downloadBlob(state.blob, filename);
    toast({ title: fmt === "gif" ? "GIF Downloaded!" : "Downloaded!", description: `Saved as ${filename}`, variant: "success", duration: 3000 });
    onDone();
  };
  const copy = async () => {
    if (!state.blob) return;
    if (await copyBlobToClipboard(state.blob)) {
      toast({ title: "Copied to clipboard!", description: "PNG image copied successfully", variant: "success", duration: 3000 });
      onDone();
    } else {
      // Falls back to a download.
      toast({ title: "Clipboard not supported", description: "Downloading image instead...", variant: "warning", duration: 3000 });
      download();
    }
  };
  const ready = state.phase === "ready";

  return (
    <div className="flex flex-col gap-3 p-2">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <span className="text-body font-semibold text-fg">Export image</span>
        <Segmented
          label="Format"
          value={fmt}
          onChange={setFmt}
          options={[
            { value: "png", label: "PNG" },
            { value: "gif", label: "GIF", title: "Animated crops move, 1 frame a second" },
          ]}
        />
      </div>
      {/* A definite height (the window's, less the rest of the panel, at most 400px) with the image contained
          inside it: the whole image shows, lists included, and the buttons stay on screen. */}
      <div className="relative h-[min(400px,calc(100dvh-15.5rem))] min-h-40 shrink-0 overflow-hidden rounded-control border border-line bg-surface-well">
        {ready && state.url ? (
          <img src={state.url} alt={`Preview of the ${fmt.toUpperCase()} image`} className="kit-fade-in absolute inset-2 size-[calc(100%-1rem)] object-contain" />
        ) : state.phase === "error" ? (
          <p role="alert" className="absolute inset-0 grid place-items-center px-4 text-center text-secondary text-problem">
            {state.error}
          </p>
        ) : (
          <div role="status" className="absolute inset-x-0 top-1/2 mx-auto w-44 -translate-y-1/2 space-y-2 text-center">
            <p className="text-secondary text-fg-muted">
              Rendering {fmt.toUpperCase()}…{fmt === "gif" && <span className="tabular-nums"> {Math.round(state.progress)}%</span>}
            </p>
            {fmt === "gif" && (
              <div
                role="progressbar"
                aria-label="GIF progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(state.progress)}
                className="h-1 overflow-hidden rounded-full bg-surface-hover"
              >
                <div className="h-full origin-left bg-fg-muted transition-transform duration-(--duration-ink)" style={{ transform: `scaleX(${state.progress / 100})` }} />
              </div>
            )}
          </div>
        )}
      </div>
      <div className="grid shrink-0 grid-cols-2 gap-2">
        <KitButton size="md" disabled={!ready || fmt === "gif"} title={fmt === "gif" ? "Browsers can't copy a GIF: download it" : "Copy the PNG to paste it in Discord"} onClick={() => void copy()}>
          <ClipboardCopy /> Copy
        </KitButton>
        <KitButton size="md" disabled={!ready} onClick={download}>
          <Download /> Download
        </KitButton>
      </div>
      {/* Two lines for either format, so switching PNG ↔ GIF never changes the panel's height (it stays where it was placed). */}
      <p className="min-h-8 shrink-0 text-meta text-fg-meta">{fmt === "gif" ? "Browsers can't copy a GIF: download it, then drop it in Discord." : "Copy, then paste it straight into Discord."}</p>
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
  <Popover anchor={anchor} open={open} onClose={onClose} label="Export image" width={340} side="right" beside={beside}>
    <ExportPanel key={panel.initial} {...panel} />
  </Popover>
);
