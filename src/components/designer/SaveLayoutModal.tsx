import React, { useEffect, useMemo, useRef, useState } from "react";
import { Save, TriangleAlert } from "lucide-react";
import { useDesigner } from "../../context";
import { summarizeTargets } from "../../utilities";
import { DialogFrame, ModalDialog } from "../ui/ModalDialog";
import { KitButton, KitInput, KitLabel, Pill } from "../ui/kit";
import { cn } from "../ui/cn";
import { LayoutPreview } from "./LoadLayoutModal";
import { plural, useNameOf } from "./actionsModel";

interface SaveLayoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (name: string, overwriteId?: string) => void;
  existingLayouts: Array<{ id: string; name: string }>;
}

const MAX_NAME = 50;

/** Save this layout (D56–D61). Mounted fresh on each open, so the name and errors reset. */
export const SaveLayoutModal: React.FC<SaveLayoutModalProps> = (props) => {
  if (!props.isOpen) return null;
  return <SaveLayoutDialog {...props} />;
};

const SaveLayoutDialog: React.FC<SaveLayoutModalProps> = ({ onClose, onSave, existingLayouts }) => {
  const { inputPlacements, targetPlacements, groundTiles } = useDesigner();
  const nameOf = useNameOf();
  // Suggested from the targets ("Chloronite x4, Gloomgourd x2 +1 more"), so saving is one keypress away.
  const [name, setName] = useState(() => summarizeTargets(targetPlacements, nameOf)?.slice(0, MAX_NAME) ?? "");
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  // Focus and select the name after ModalDialog's showModal() (a parent effect that runs after this one).
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const trimmed = name.trim();
  const existing = useMemo(() => existingLayouts.find((l) => l.name === trimmed) ?? null, [existingLayouts, trimmed]);
  // Target mutations with counts, most common first.
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of targetPlacements) m.set(p.cropId, (m.get(p.cropId) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || nameOf(a[0]).localeCompare(nameOf(b[0])));
  }, [targetPlacements, nameOf]);
  const preview = useMemo(() => ({ inputs: inputPlacements, targets: targetPlacements, groundTiles }), [inputPlacements, targetPlacements, groundTiles]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmed) {
      setError("Give the layout a name");
      input.current?.focus();
      return;
    }
    onSave(trimmed, existing?.id);
  };

  return (
    <ModalDialog labelledBy="save-layout-title" onClose={onClose} maxWidth="max-w-lg">
      <DialogFrame
        id="save-layout-title"
        title="Save this layout"
        onClose={onClose}
        footer={
          <>
            <span className="mr-auto self-center text-meta text-fg-meta">Saved in this browser. Open it later from Load.</span>
            <KitButton variant="ghost" size="md" onClick={onClose}>
              Cancel
            </KitButton>
            {/* Stays enabled: a blank name says "Give the layout a name" (D57) instead of a silent no-op. */}
            <KitButton variant="primary" size="md" type="submit" form="save-layout-form">
              <Save /> {existing ? "Overwrite layout" : "Save layout"}
            </KitButton>
          </>
        }
      >
        <form id="save-layout-form" onSubmit={submit} className="space-y-4">
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <LayoutPreview layout={preview} cellSize={12} />
            <div className="w-full min-w-0 flex-1 space-y-3">
              <div>
                <div className="mb-1.5 flex items-baseline justify-between">
                  <label htmlFor="layout-name" className="text-secondary font-medium text-fg-body">
                    Name
                  </label>
                  <span className={cn("text-meta tabular-nums", name.length >= MAX_NAME ? "text-warn" : "text-fg-meta")}>
                    {name.length}/{MAX_NAME}
                  </span>
                </div>
                <KitInput
                  ref={input}
                  id="layout-name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setError("");
                  }}
                  placeholder="e.g. Chloronite farm"
                  maxLength={MAX_NAME}
                  autoComplete="off"
                  invalid={!!error}
                  aria-describedby="layout-name-hint"
                  className={cn("w-full", existing && !error && "border-warn/60 enabled:hover:border-warn")}
                />
                <div id="layout-name-hint" className="mt-1 min-h-5">
                  {error ? (
                    <p role="alert" className="text-secondary text-problem">
                      {error}
                    </p>
                  ) : existing ? (
                    <p className="flex items-start gap-1.5 text-secondary text-warn">
                      <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                      Replaces the saved layout with this name.
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Pill>{plural(targetPlacements.length, "target")}</Pill>
                <Pill>{plural(inputPlacements.length, "input")}</Pill>
                {groundTiles.length > 0 && <Pill>{plural(groundTiles.length, "ground tile")}</Pill>}
              </div>
            </div>
          </div>
          {counts.length > 0 && (
            <div>
              <KitLabel className="mb-1.5">Targets</KitLabel>
              <ul className="scrollbar-dark grid max-h-32 grid-cols-1 gap-x-4 gap-y-1 overflow-y-auto sm:grid-cols-2">
                {counts.map(([id, n]) => (
                  <li key={id} className="flex min-w-0 items-center justify-between gap-2 text-secondary">
                    <span className="truncate text-fg-body" title={nameOf(id)}>
                      {nameOf(id)}
                    </span>
                    <span className="shrink-0 tabular-nums text-fg-meta">×{n}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </form>
      </DialogFrame>
    </ModalDialog>
  );
};
