import React from "react";
import { Ellipsis, Eraser, FlaskConical, FolderOpen, Image as ImageIcon, Move, Redo2, Save, Share2, Undo2 } from "lucide-react";
import { useDesigner } from "../../context";
import { MenuItem, Popover } from "../ui/Popover";
import { cn } from "../ui/cn";
import { ActionTip, ClearMenuItems, LayoutTransformControls } from "./LayoutTools";
import { REDO_KEYS, UNDO_KEYS, useLayoutHistoryKeys, type ActionPops, type LayoutActions } from "./actionsModel";

/** A 44px icon button of the phone toolbar: bare (no caption), with an aria-label and a tooltip. */
const BarButton = React.forwardRef<
  HTMLButtonElement,
  { label: string; icon: React.ReactNode; kbd?: string[]; hint?: string; expanded?: boolean; haspopup?: "dialog" | "menu"; disabled?: boolean; onClick: () => void }
>(({ label, icon, kbd, hint, expanded, haspopup, disabled, onClick }, ref) => (
  <ActionTip label={label} kbd={kbd} hint={hint} side="bottom" className="shrink-0">
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-haspopup={haspopup}
      aria-expanded={haspopup ? !!expanded : undefined}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "focus-ring flex size-11 cursor-pointer items-center justify-center rounded-control text-fg-muted transition-colors duration-(--duration-hover) hover:bg-surface-hover hover:text-fg disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-[18px]",
        expanded && "bg-surface-hover text-fg",
      )}
    >
      {icon}
    </button>
  </ActionTip>
));
BarButton.displayName = "BarButton";

/**
 * The phone's actions in one row of eight 44px icons: Undo Redo | Save Load | Share Export | Clear More.
 * PNG and GIF are one Export button (its popover has the PNG | GIF switch); Transform and Simulate are
 * under More. It owns the Ctrl+Z listener (the desktop rail's LayoutHistoryControls does on desktop).
 * The Share and Export popovers are DesignerActions'; the menus hang here.
 */
export const PhoneToolbar: React.FC<{ actions: LayoutActions; pops: ActionPops; className?: string }> = ({ actions, pops, className }) => {
  const { undo, redo, canUndo, canRedo } = useDesigner();
  useLayoutHistoryKeys();
  const { pop, anchor, ref, open, close } = pops;
  const empty = actions.empty;
  const divider = <span aria-hidden className="h-6 w-px shrink-0 bg-line" />;
  return (
    <>
      <div role="toolbar" aria-label="Layout tools" className={cn("flex min-w-0 items-center justify-between", className)}>
        <BarButton label="Undo" icon={<Undo2 />} kbd={UNDO_KEYS} disabled={!canUndo} onClick={undo} />
        <BarButton label="Redo" icon={<Redo2 />} kbd={REDO_KEYS} disabled={!canRedo} onClick={redo} />
        {divider}
        <BarButton label="Save" icon={<Save />} hint={empty ? "Place something first" : undefined} disabled={empty} onClick={actions.openSave} />
        <BarButton label="Load" icon={<FolderOpen />} onClick={actions.openLoad} />
        {divider}
        <BarButton ref={ref("share")} label="Share" icon={<Share2 />} hint="Copies a link for Discord" haspopup="dialog" expanded={pop === "share"} disabled={empty} onClick={() => open("share")} />
        <BarButton ref={ref("export")} label="Export image" icon={<ImageIcon />} hint="PNG or GIF" haspopup="dialog" expanded={pop === "export" || pop === "gif"} disabled={empty} onClick={() => open("export")} />
        {divider}
        <BarButton ref={ref("clear")} label="Clear" icon={<Eraser />} haspopup="menu" expanded={pop === "clear"} disabled={empty} onClick={() => open("clear")} />
        <BarButton ref={ref("more")} label="More" icon={<Ellipsis />} haspopup="menu" expanded={pop === "more" || pop === "transform"} onClick={() => open("more")} />
      </div>
      <Popover anchor={anchor} open={pop === "clear" && !empty} onClose={close} label="Clear" role="menu" width={260} align="end">
        <ClearMenuItems close={close} />
      </Popover>
      <Popover anchor={anchor} open={pop === "more"} onClose={close} label="More tools" role="menu" width={240} align="end">
        <MenuItem icon={<Move />} hint="Nudge, rotate or mirror" onSelect={() => open("transform", "more")}>
          Transform
        </MenuItem>
        <MenuItem
          icon={<FlaskConical />}
          hint="Run this layout in the Simulator"
          disabled={empty}
          onSelect={() => {
            close();
            actions.simulate();
          }}
        >
          Simulate
        </MenuItem>
      </Popover>
      <Popover anchor={anchor} open={pop === "transform"} onClose={close} label="Transform" width={248} align="end" className="p-2">
        <LayoutTransformControls touch />
      </Popover>
    </>
  );
};
