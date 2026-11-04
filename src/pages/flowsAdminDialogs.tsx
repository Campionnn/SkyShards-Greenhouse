import React, { useEffect, useId, useRef, useState } from "react";
import { KitButton, KitInput, KitTextarea } from "../components/ui/kit";
import { DialogFrame, ModalDialog } from "../components/ui/ModalDialog";

/**
 * The /flows/admin dialogs (they replace window.prompt / confirm / alert). Built from the kit's
 * ModalDialog + DialogFrame; `ConfirmDialog` is generic so it can move to components/ui later.
 * Footer: Cancel (ghost) on the left of the confirm button, as components.md "Dialogs" says.
 */

/** Focus `ref` once the dialog is open: ModalDialog's showModal runs after child effects and
 *  would otherwise leave focus on the header's Close button. */
function useFocusOnOpen(ref: React.RefObject<HTMLElement | null>, select = false) {
  useEffect(() => {
    const t = window.setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      if (select && el instanceof HTMLInputElement) el.select();
    }, 0);
    return () => window.clearTimeout(t);
  }, [ref, select]);
}

export interface ConfirmDialogProps {
  title: React.ReactNode;
  /** What happens if the user confirms. */
  children: React.ReactNode;
  confirmLabel: React.ReactNode;
  /** `problem` for destructive actions, `go` for the rest. */
  tone?: "go" | "problem";
  /** The action is running: the confirm button shows a spinner and closing is ignored. */
  busy?: boolean;
  /** Disables the confirm button (e.g. an invalid field). */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  maxWidth?: string;
  /** Focus this on open instead of Cancel (an input in the body). */
  initialFocus?: React.RefObject<HTMLElement | null>;
}

/** A modal "are you sure" step. Enter in the body submits it (it is a form). */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  title,
  children,
  confirmLabel,
  tone = "go",
  busy,
  confirmDisabled,
  onConfirm,
  onClose,
  maxWidth = "max-w-md",
  initialFocus,
}) => {
  const id = useId();
  const titleId = `${id}-title`;
  const formId = `${id}-form`;
  const cancel = useRef<HTMLButtonElement>(null);
  useFocusOnOpen(initialFocus ?? cancel, !!initialFocus);
  const close = () => {
    if (!busy) onClose();
  };
  return (
    <ModalDialog labelledBy={titleId} onClose={close} maxWidth={maxWidth}>
      <DialogFrame
        id={titleId}
        title={title}
        onClose={close}
        footer={
          <>
            <KitButton ref={cancel} variant="ghost" size="md" onClick={close} disabled={busy}>
              Cancel
            </KitButton>
            <KitButton type="submit" form={formId} variant={tone === "problem" ? "danger" : "primary"} size="md" loading={busy} disabled={confirmDisabled}>
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
            if (!busy && !confirmDisabled) onConfirm();
          }}
        >
          {children}
        </form>
      </DialogFrame>
    </ModalDialog>
  );
};

/** "Name (snowflake id)": the id never splits mid-number. */
export const Who: React.FC<{ name: string; id: string }> = ({ name, id }) => (
  <>
    <b className="font-semibold text-fg">{name}</b> <span className="whitespace-nowrap tabular-nums text-fg-muted">({id})</span>
  </>
);

/** The longest ban reason the API keeps (adminService trims to 200). */
const REASON_MAX = 200;

/** Ban the author: an optional reason, then one confirm. */
export const BanDialog: React.FC<{ name: string; id: string; busy?: boolean; onConfirm: (reason: string) => void; onClose: () => void }> = ({ name, id, busy, onConfirm, onClose }) => {
  const [reason, setReason] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  const fieldId = useId();
  return (
    <ConfirmDialog title="Ban author" confirmLabel="Ban" tone="problem" busy={busy} onConfirm={() => onConfirm(reason)} onClose={onClose} initialFocus={field}>
      <p>
        Ban <Who name={name} id={id} />? All their entries get hidden.
      </p>
      <div className="space-y-1">
        <label htmlFor={fieldId} className="block text-secondary text-fg-muted">
          Reason (optional)
        </label>
        <KitTextarea ref={field} id={fieldId} className="block h-20 w-full resize-y" maxLength={REASON_MAX} value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)} />
        <div className="text-right text-meta tabular-nums text-fg-meta">
          {reason.length} / {REASON_MAX}
        </div>
      </div>
    </ConfirmDialog>
  );
};

/** A whole number, `null` for blank / "default", or `undefined` when it is neither. */
function parseLimit(text: string): number | null | undefined {
  const t = text.trim().toLowerCase();
  if (t === "" || t === "default") return null;
  return /^\d+$/.test(t) ? Number(t) : undefined;
}

/** The author's submissions-per-24h limit: a number, or blank / "default" for the default. */
export const LimitDialog: React.FC<{ name: string; id: string; current: number | null; busy?: boolean; onConfirm: (limit: number | null) => void; onClose: () => void }> = ({
  name,
  id,
  current,
  busy,
  onConfirm,
  onClose,
}) => {
  const [text, setText] = useState(current === null ? "" : String(current));
  const [tried, setTried] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const fieldId = useId();
  const parsed = parseLimit(text);
  const invalid = tried && parsed === undefined;
  return (
    <ConfirmDialog
      title="Submission limit"
      confirmLabel="Set limit"
      busy={busy}
      onConfirm={() => {
        setTried(true);
        if (parsed !== undefined) onConfirm(parsed);
        else field.current?.focus();
      }}
      onClose={onClose}
      initialFocus={field}
    >
      <div className="space-y-1.5">
        <label htmlFor={fieldId} className="block">
          Submissions per 24 hours for <Who name={name} id={id} />.
        </label>
        <KitInput
          ref={field}
          id={fieldId}
          inputMode="numeric"
          autoComplete="off"
          className="w-32 text-right tabular-nums"
          placeholder="default"
          value={text}
          disabled={busy}
          invalid={invalid}
          aria-describedby={`${fieldId}-help`}
          onChange={(e) => setText(e.target.value)}
        />
        <p id={`${fieldId}-help`} className={invalid ? "text-secondary text-problem" : "text-secondary text-fg-meta"} role={invalid ? "alert" : undefined}>
          {invalid ? "Enter a whole number, or leave it blank for the default." : "Enter a number (e.g. 50), or leave blank for the default."}
        </p>
      </div>
    </ConfirmDialog>
  );
};
