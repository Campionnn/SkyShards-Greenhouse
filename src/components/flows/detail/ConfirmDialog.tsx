import React, { useEffect, useId, useRef } from "react";
import { KitButton } from "../../ui/kit";
import { DialogFrame, ModalDialog } from "../../ui/ModalDialog";

/**
 * A modal "are you sure" step for actions that can't be undone (copied from flowsAdminDialogs so
 * the detail page doesn't import a page module; both can move to components/ui later). Enter
 * submits; while `busy` the confirm button spins and closing is ignored, so a double click can't
 * send the action twice.
 */
export const ConfirmDialog: React.FC<{
  title: React.ReactNode;
  children: React.ReactNode;
  confirmLabel: React.ReactNode;
  tone?: "go" | "problem";
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}> = ({ title, children, confirmLabel, tone = "go", busy, onConfirm, onClose }) => {
  const id = useId();
  const titleId = `${id}-title`;
  const formId = `${id}-form`;
  const cancel = useRef<HTMLButtonElement>(null);
  // ModalDialog's showModal runs after child effects and would leave focus on Close.
  useEffect(() => {
    const t = window.setTimeout(() => cancel.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, []);
  const close = () => {
    if (!busy) onClose();
  };
  return (
    <ModalDialog labelledBy={titleId} onClose={close} maxWidth="max-w-md">
      <DialogFrame
        id={titleId}
        title={title}
        onClose={close}
        footer={
          <>
            <KitButton ref={cancel} variant="ghost" size="md" onClick={close} disabled={busy}>
              Cancel
            </KitButton>
            <KitButton type="submit" form={formId} variant={tone === "problem" ? "danger" : "primary"} size="md" loading={busy}>
              {confirmLabel}
            </KitButton>
          </>
        }
      >
        <form
          id={formId}
          className="space-y-3 text-body text-fg-body"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) onConfirm();
          }}
        >
          {children}
        </form>
      </DialogFrame>
    </ModalDialog>
  );
};
