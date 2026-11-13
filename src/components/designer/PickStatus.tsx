import React from "react";
import { X } from "lucide-react";
import { useDesigner } from "../../context";
import { IconButton, Kbd } from "../ui/kit";
import { cn } from "../ui/cn";
import { CropImage } from "../shared";
import { getGroundImagePath } from "../../types/greenhouse";

// What the next click on the grid does. It replaces the palette's "Placing X" chip and the hint line under
// the grid (D18, D43; research/designer-v2/decisions.md "G3"): one place, above the grid.

const groundName = (g: string) => g.replace(/_/g, " ");

const ItemIcon: React.FC<{ id: string; name: string; size: number }> = ({ id, name, size }) => (
  <CropImage cropId={id} cropName={name} size="custom" width={size} height={size} showFallback className="shrink-0" />
);

/**
 * Above the grid: "Placing Choconut as a target · Esc" or "Painting sand · right-click erases · Esc" (in the
 * select role; a click or Escape stops), else how to start. `where`: where the palette is ("in the
 * palette" on desktop, "below" on the phone).
 */
export const PickStatus: React.FC<{ where: string; className?: string }> = ({ where, className }) => {
  const { selectedCropForPlacement, setSelectedCropForPlacement, selectedGround, setSelectedGround, mode } = useDesigner();
  if (!selectedCropForPlacement && !selectedGround)
    return (
      <span className={cn("min-w-0 truncate text-secondary text-fg-meta", className)} title="Click a cell to place, drag to place a row. Right-click removes; drag a piece to move it.">
        Pick an item {where} to place it
      </span>
    );
  const label = selectedGround
    ? `Painting ${groundName(selectedGround)} · right-click erases`
    : `Placing ${selectedCropForPlacement!.name} as ${mode === "targets" ? "a target" : "an input"}`;
  return (
    <button
      type="button"
      title="Stop (Esc)"
      onClick={() => (selectedGround ? setSelectedGround(null) : setSelectedCropForPlacement(null))}
      className={cn(
        "focus-ring inline-flex h-7 min-w-0 cursor-pointer items-center gap-1.5 rounded-control bg-select/10 pr-1.5 pl-1 text-secondary text-select-fg transition-colors duration-(--duration-hover) hover:bg-select/20 pointer-coarse:h-11",
        className,
      )}
    >
      {selectedGround ? (
        <img src={getGroundImagePath(selectedGround)} alt="" className="size-5 shrink-0 rounded-inner" />
      ) : (
        <ItemIcon id={selectedCropForPlacement!.id} name={selectedCropForPlacement!.name} size={20} />
      )}
      <span className="min-w-0 truncate">{label}</span>
      <Kbd className="shrink-0">Esc</Kbd>
    </button>
  );
};

/** The phone sheet's peek row: the item picked for placing (or "Nothing picked"), with a 44px stop button. */
export const PickedChip: React.FC = () => {
  const { selectedCropForPlacement, setSelectedCropForPlacement, selectedGround, setSelectedGround } = useDesigner();
  if (!selectedCropForPlacement && !selectedGround) return <span className="min-w-0 truncate text-secondary text-fg-meta">Nothing picked</span>;
  const name = selectedGround ? groundName(selectedGround) : selectedCropForPlacement!.name;
  return (
    <span className="inline-flex h-11 max-w-full min-w-0 items-center gap-1.5 rounded-control bg-select/10 pl-1.5 text-secondary text-select-fg">
      {selectedGround ? <img src={getGroundImagePath(selectedGround)} alt="" className="size-6 shrink-0 rounded-inner" /> : <ItemIcon id={selectedCropForPlacement!.id} name={name} size={24} />}
      <span className="min-w-0 truncate">{name}</span>
      <IconButton
        size="touch"
        aria-label={selectedGround ? "Stop painting" : "Stop placing"}
        className="text-select-fg"
        onClick={() => (selectedGround ? setSelectedGround(null) : setSelectedCropForPlacement(null))}
      >
        <X />
      </IconButton>
    </span>
  );
};
