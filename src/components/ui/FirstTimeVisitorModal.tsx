/**
 * First visit to the Calculator (C04): a short welcome with the three ways in. Shown only when
 * nothing is customised and `skyshards-has-visited` is unset (CalculatorPage decides).
 */
import React from "react";
import { useNavigate } from "react-router-dom";
import { DialogFrame, ModalDialog } from "./ModalDialog";
import { KitButton } from "./kit";

interface FirstTimeVisitorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfigureGrid: () => void;
}

const Way: React.FC<{ title: string; text: string; children: React.ReactNode }> = ({ title, text, children }) => (
  <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
    <span className="min-w-0 flex-1 basis-56">
      <span className="block text-body font-medium text-fg">{title}</span>
      <span className="block text-secondary text-fg-muted">{text}</span>
    </span>
    {children}
  </li>
);

export const FirstTimeVisitorModal: React.FC<FirstTimeVisitorModalProps> = ({ isOpen, onClose, onConfigureGrid }) => {
  const navigate = useNavigate();
  if (!isOpen) return null;
  return (
    <ModalDialog labelledBy="first-visit-title" onClose={onClose} maxWidth="max-w-xl">
      <DialogFrame id="first-visit-title" title="Welcome to the Greenhouse Calculator" onClose={onClose}>
        <ul className="divide-y divide-line">
          <Way title="Set up your grid" text="Mark which cells of your greenhouse you've unlocked, so layouts fit.">
            <KitButton
              variant="primary"
              size="md"
              onClick={() => {
                onConfigureGrid();
                onClose();
              }}
            >
              Set up grid
            </KitButton>
          </Way>
          <Way title="Find the best layout" text="Pick the mutations you want and press Solve.">
            <KitButton size="md" onClick={onClose}>
              Start
            </KitButton>
          </Way>
          <Way title="Design by hand" text="Place crops yourself and see what spawns.">
            <KitButton
              size="md"
              onClick={() => {
                navigate("/designer");
                onClose();
              }}
            >
              Open Designer
            </KitButton>
          </Way>
        </ul>
      </DialogFrame>
    </ModalDialog>
  );
};
