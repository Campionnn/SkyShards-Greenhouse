import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { FlowViewer } from "../../../hooks/useFlowViewer";
import { floatingLayers, focusablesIn } from "../../ui/contextMenuContext";
import { cn } from "../../ui/cn";
import { IconButton } from "../../ui/kit";
import { BodyPortal } from "../../ui/Portal";
import { StatsForm } from "../FlowControls";
import { statsSummaryLong } from "./statsSummary";

/**
 * "Your stats" in a side drawer (a bottom sheet under 768px): the whole shared form (F110–F124).
 * A modal dialog: focus moves in, Tab stays inside, Escape or the backdrop closes it, and focus
 * goes back to whatever opened it. Nested dialogs (import, per-crop, prices) are native modal
 * <dialog>s in the top layer, so their Escape closes them first.
 */
export const StatsDrawer: React.FC<{ viewer: FlowViewer; open: boolean; onClose: () => void; footer?: React.ReactNode }> = ({ viewer, open, onClose, footer }) =>
  open ? <DrawerBody viewer={viewer} onClose={onClose} footer={footer} /> : null;

const DrawerBody: React.FC<{ viewer: FlowViewer; onClose: () => void; footer?: React.ReactNode }> = ({ viewer, onClose, footer }) => {
  const panel = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  useLayoutEffect(() => {
    closeRef.current = onClose;
  });
  const [phone] = useState(() => typeof window !== "undefined" && window.matchMedia?.("(max-width: 767px)").matches === true);

  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    el.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      // A native dialog opened from the drawer (import, per-crop, prices) handles its own Escape.
      if (e.key !== "Escape" || e.defaultPrevented || floatingLayers.length || document.querySelector("dialog[open]")) return;
      e.preventDefault();
      closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const el = panel.current;
    if (e.key !== "Tab" || !el || !el.contains(e.target as Node)) return;
    const controls = focusablesIn(el);
    if (!controls.length) return;
    const at = controls.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey && at <= 0) {
      e.preventDefault();
      controls[controls.length - 1].focus();
    } else if (!e.shiftKey && (at === -1 || at === controls.length - 1)) {
      e.preventDefault();
      controls[0].focus();
    }
  };

  return (
    <BodyPortal>
      <div className="fixed inset-0 z-(--z-drawer)" data-testid="stats-drawer">
        <div aria-hidden className="kit-fade-in absolute inset-0 bg-surface-page/70" onClick={onClose} />
        <aside
          ref={panel}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby="stats-drawer-title"
          onKeyDown={onKeyDown}
          className={cn(
            "absolute flex flex-col border-line-strong bg-surface-panel outline-none",
            // Phone: a bottom sheet docked above Mediavine's adhesion ad (`--ad-bottom`), so its footer stays tappable.
            phone ? "kit-rise-in inset-x-0 max-h-[calc(90dvh-var(--ad-bottom,0px))] rounded-t-container border-t" : "sim-drawer-in inset-y-0 right-0 w-[min(460px,100%)] border-l",
          )}
          style={phone ? { bottom: "var(--ad-bottom, 0px)" } : undefined}
        >
          <header className="flex items-center gap-2 border-b border-line py-3 pr-3 pl-4">
            <h2 id="stats-drawer-title" className="shrink-0 text-title text-fg">
              Your stats
            </h2>
            <span className="min-w-0 truncate text-secondary tabular-nums text-fg-meta" title={statsSummaryLong(viewer)}>
              {statsSummaryLong(viewer)}
            </span>
            <IconButton size="md" className="ml-auto" aria-label="Close" title="Close (Esc)" onClick={onClose}>
              <X />
            </IconButton>
          </header>
          <div className="scrollbar-dark min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
            <StatsForm viewer={viewer} />
          </div>
          {footer && <div className="border-t border-line p-3">{footer}</div>}
        </aside>
      </div>
    </BodyPortal>
  );
};
