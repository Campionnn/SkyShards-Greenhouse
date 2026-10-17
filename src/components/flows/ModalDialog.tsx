import React, { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { buttonClass } from "../simulator/styles";
import { Portal } from "../ui";

/**
 * A native modal `<dialog>` in a portal (Escape, inert background, backdrop click closes), like
 * FlowExportDialog. The body is passed as children so SSR tests can render it without the portal.
 */
export const ModalDialog: React.FC<{ labelledBy: string; onClose: () => void; maxWidth?: string; children: React.ReactNode }> = ({ labelledBy, onClose, maxWidth = "max-w-lg", children }) => {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
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
    <Portal>
      <dialog
        ref={dialog}
        aria-labelledby={labelledBy}
        className={`fixed inset-0 m-auto w-[calc(100%-1rem)] sm:w-[calc(100%-2rem)] ${maxWidth} max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] p-0 rounded-xl border border-slate-700 bg-slate-900 text-slate-200 shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm`}
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
        {children}
      </dialog>
    </Portal>
  );
};

/** Header / scrolling body / footer layout for a dialog body. */
export const DialogFrame: React.FC<{ id: string; title: React.ReactNode; onClose: () => void; footer?: React.ReactNode; children: React.ReactNode }> = ({ id, title, onClose, footer, children }) => (
  <div className="flex flex-col max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)]">
    <div className="flex items-center justify-between gap-3 border-b border-slate-700 px-4 py-3 sm:px-5">
      <h2 id={id} className="text-base font-semibold text-slate-100 flex items-center gap-2 min-w-0">
        {title}
      </h2>
      <button type="button" className={`${buttonClass.icon} p-2`} onClick={onClose} aria-label="Close">
        <X className="w-4 h-4" />
      </button>
    </div>
    <div className="min-h-0 overflow-y-auto px-4 py-4 sm:px-5 space-y-4">{children}</div>
    {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-700 px-4 py-3 sm:px-5">{footer}</div>}
  </div>
);
