import React, { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "./cn";
import { IconButton } from "./kit";
import { BodyPortal, PortalHost } from "./Portal";

/**
 * A native modal `<dialog>` in a portal (Escape, inert background, backdrop click closes), like
 * FlowExportDialog. The body is passed as children so SSR tests can render it without the portal.
 * `maxWidth` is a Tailwind max-width class ("max-w-lg").
 */
export const ModalDialog: React.FC<{ labelledBy: string; onClose: () => void; maxWidth?: string; children: React.ReactNode }> = ({ labelledBy, onClose, maxWidth = "max-w-lg", children }) => {
  const dialog = useRef<HTMLDialogElement>(null);
  // Tooltips / popovers inside portal into the dialog: it is in the top layer, above <body>.
  const [host, setHost] = useState<HTMLDialogElement | null>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    setHost(element);
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);
  return (
    <BodyPortal>
      <dialog
        ref={dialog}
        aria-labelledby={labelledBy}
        // Opaque panel (not surface.raised's translucent glass): a dialog is read for a while. The
        // scrim is the page colour at 70%, so the page recedes without a blur pass. Opacity-only
        // entrance: a transform (even an identity one left by an animation) would make the dialog
        // the containing block of the position:fixed hints and popovers inside it, offsetting and
        // clipping them.
        className={cn(
          "fixed inset-0 m-auto max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] rounded-container border border-line-strong bg-surface-panel p-0 text-body text-fg-body shadow-raised kit-fade-in sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100%-2rem)]",
          "backdrop:bg-surface-page/70",
          maxWidth
        )}
        onCancel={(e) => {
          e.preventDefault();
          onClose();
        }}
        onClick={(e) => {
          if (e.target !== e.currentTarget) return;
          const b = e.currentTarget.getBoundingClientRect();
          if (e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom) onClose();
        }}
      >
        <PortalHost container={host}>{children}</PortalHost>
      </dialog>
    </BodyPortal>
  );
};

/** Header / scrolling body / footer layout for a dialog body. */
export const DialogFrame: React.FC<{ id: string; title: React.ReactNode; onClose: () => void; footer?: React.ReactNode; children: React.ReactNode }> = ({ id, title, onClose, footer, children }) => (
  <div className="flex max-h-[calc(100dvh-1rem)] flex-col sm:max-h-[calc(100dvh-2rem)]">
    <div className="flex items-center justify-between gap-3 border-b border-line py-3 pr-3 pl-4 sm:pl-5">
      <h2 id={id} className="flex min-w-0 items-center gap-2 text-title text-fg">
        {title}
      </h2>
      <IconButton size="md" aria-label="Close" title="Close (Esc)" onClick={onClose}>
        <X />
      </IconButton>
    </div>
    <div className="min-h-0 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>
    {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3 sm:px-5">{footer}</div>}
  </div>
);
