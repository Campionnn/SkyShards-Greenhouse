import React, { useCallback, useEffect, useState } from "react";
import { CircleCheck, ClipboardCopy } from "lucide-react";
import { KitButton, KitInput } from "../ui/kit";
import { InfoHint } from "../ui/InfoHint";
import { Popover } from "../ui/Popover";
import { useToast } from "../ui/toastContext";
import { cn } from "../ui/cn";
import { copyShareLink, shareUrlFor } from "../../utilities";

/**
 * Share (D06), one click as before: opening it copies the link (copyShareLink also asks the API to render
 * the Discord image ahead of time), and the popover shows the link itself, says "Copied", and Copy link
 * copies again. Focus lands on the link, selected, so Ctrl+C works too.
 */
export const SharePanel: React.FC<{ code: string }> = ({ code }) => {
  const { toast } = useToast();
  const url = shareUrlFor(code);
  const [state, setState] = useState<"copying" | "copied" | "failed">("copying");
  const copy = useCallback(
    async (fromOpen: boolean) => {
      try {
        await copyShareLink(code);
        setState("copied");
        toast({ id: "share-copied", title: "Share link copied!", description: "Paste this link in Discord or share with others", variant: "success", duration: 3000 });
      } catch (err) {
        setState("failed");
        // On open a refused clipboard only shows here (the link is on screen); Copy link reports it.
        if (!fromOpen) toast({ title: "Export failed", description: err instanceof Error ? err.message : "Failed to encode design", variant: "error", duration: 5000 });
      }
    },
    [code, toast],
  );
  useEffect(() => {
    void copy(true);
    // Once, on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="space-y-2 p-2">
      <div className="flex min-h-6 items-center gap-1.5">
        <span className="text-body font-semibold text-fg">Share link</span>
        <InfoHint title="Share link" width={260}>
          Anyone with the link opens this layout in the Designer. Discord shows a picture of it.
        </InfoHint>
        <span role="status" className={cn("ml-auto inline-flex items-center gap-1 text-secondary", state === "copied" ? "text-go-fg" : "text-fg-meta")}>
          {state === "copied" && (
            <>
              <CircleCheck aria-hidden className="size-3.5" /> Copied
            </>
          )}
          {state === "failed" && "Copy it below"}
        </span>
      </div>
      <div className="flex min-w-0 gap-1.5">
        {/* First focus (the Popover's data-autofocus): the link, selected by its onFocus. */}
        <KitInput data-autofocus readOnly value={url} aria-label="Share link" title={url} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 font-mono text-secondary" />
        <KitButton size="md" onClick={() => void copy(false)}>
          <ClipboardCopy /> Copy link
        </KitButton>
      </div>
    </div>
  );
};

/** The Share popover: beside the rail (`beside`) on desktop; under the button where there is no room (the phone toolbar). */
export const SharePopover: React.FC<{ anchor: HTMLElement | null; beside?: HTMLElement | null; open: boolean; onClose: () => void; code: () => string }> = ({ anchor, beside, open, onClose, code }) => (
  <Popover anchor={anchor} open={open} onClose={onClose} label="Share link" width={380} side="right" beside={beside}>
    <SharePanel code={code()} />
  </Popover>
);
