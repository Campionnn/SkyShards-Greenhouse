import React from "react";
import { CheckSquare, RotateCcw } from "lucide-react";
import { useGridState } from "../../context";
import { KitButton, KitLabel } from "../ui/kit";
import { DialogFrame, ModalDialog } from "../ui/ModalDialog";
import { cn } from "../ui/cn";
import { surface } from "../ui/surface";
import { GridManager } from "./GridManager";
import { ExpansionOptimizer } from "./ExpansionOptimizer";

interface GridManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const Swatch: React.FC<{ className: string; children?: React.ReactNode }> = ({ className, children }) => (
  <span aria-hidden className={cn("inline-grid size-4 place-items-center rounded-inner border text-meta font-bold", className)}>
    {children}
  </span>
);

/** "36 cells": paint the greenhouse's unlocked cells and find the best expansion order (a kit dialog). */
export const GridManagerModal: React.FC<GridManagerModalProps> = ({ isOpen, onClose }) => {
  const { unlockedCells, selectAll, resetToDefault } = useGridState();
  if (!isOpen) return null;
  return (
    <ModalDialog labelledBy="grid-manager-title" onClose={onClose} maxWidth="max-w-4xl">
      <DialogFrame
        id="grid-manager-title"
        title="Grid Manager"
        onClose={onClose}
        footer={
          <KitButton variant="primary" size="md" onClick={onClose}>
            Done
          </KitButton>
        }
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_17rem] lg:gap-6">
          <section className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-body text-fg-muted">
                <b className="font-semibold tabular-nums text-fg">{unlockedCells.size}</b> / 100 cells unlocked
              </span>
              <span className="flex gap-1.5">
                <KitButton onClick={resetToDefault}>
                  <RotateCcw /> Reset
                </KitButton>
                <KitButton variant="accent" onClick={selectAll}>
                  <CheckSquare /> Select all
                </KitButton>
              </span>
            </div>
            <div className="flex justify-center">
              <GridManager size="md" isInteractive />
            </div>
            <div className="flex flex-wrap items-center justify-center gap-4 text-secondary text-fg-muted">
              <span className="flex items-center gap-1.5">
                <Swatch className="border-go bg-go" /> Unlocked
              </span>
              <span className="flex items-center gap-1.5">
                <Swatch className="border-line bg-surface-well" /> Locked
              </span>
              <span className="flex items-center gap-1.5">
                <Swatch className="border-coin bg-coin text-surface-page">1</Swatch> Expansion step
              </span>
            </div>
          </section>
          <div className="min-w-0 space-y-4">
            <ExpansionOptimizer />
            <section className={cn(surface.card, "space-y-2 p-3")}>
              <KitLabel>How it works</KitLabel>
              <ol className="list-decimal space-y-1.5 pl-4 text-secondary text-fg-body">
                <li>Click cells to unlock or lock them, or click and drag to paint several at once.</li>
                <li>The expansion optimizer finds the best order to unlock the rest, by the most Gloomgourd spawns possible.</li>
                <li>Close this to go back to the Calculator and solve.</li>
              </ol>
            </section>
          </div>
        </div>
      </DialogFrame>
    </ModalDialog>
  );
};
