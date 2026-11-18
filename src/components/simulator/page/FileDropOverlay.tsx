import React from "react";
import { FileJson } from "lucide-react";
import { BodyPortal } from "../../ui";

/**
 * Shown while a file is dragged over the simulator page: the page recedes behind a scrim and a
 * dashed go-coloured frame says what dropping does. Purely visual (pointer-events: none); the drop
 * itself is handled by `useFileDrop` on the window.
 */
export const FileDropOverlay: React.FC<{ active: boolean }> = ({ active }) =>
  active ? (
    <BodyPortal>
      <div
        className="pointer-events-none fixed inset-0 z-(--z-popover) flex p-3 kit-fade-in sm:p-6 bg-surface-page/80 backdrop-blur-sm"
        style={{ bottom: "var(--ad-bottom, 0px)" }}
        role="status"
        aria-live="polite"
      >
        <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-container border-2 border-dashed border-go/60 bg-go/5 px-6 text-center">
          <div className="kit-pop-in flex flex-col items-center gap-4">
            <span className="flex size-14 items-center justify-center rounded-container border border-go/35 bg-go/10 text-go-fg">
              <FileJson className="size-7" aria-hidden />
            </span>
            <div className="space-y-1">
              <p className="text-title text-fg">Drop to import flows</p>
              <p className="text-secondary text-fg-muted">Replaces your plots with the ones in the file. You can undo it.</p>
            </div>
            <p className="text-meta text-fg-meta">Exported flows .json</p>
          </div>
        </div>
      </div>
    </BodyPortal>
  ) : null;
