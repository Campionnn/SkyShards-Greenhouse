import React, { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { BookOpen, ExternalLink, LoaderCircle, X } from "lucide-react";
import { useInfoModal } from "../../context";
import { ItemDetails, ItemHeader, ItemNavContext, useWikiLookups } from "../wiki";
import { hypixelWikiUrl, wikiPath } from "../../wiki/slugs";
import { IconButton } from "../ui/kit";
import { DialogFrame, ModalDialog } from "../ui/ModalDialog";

/**
 * The app-wide item info dialog (any crop or mutation, opened from grids, lists and the Guide): the
 * wiki's item page in a kit modal. Links inside swap it to the clicked item instead of leaving.
 */
export const CropMutationInfoModal: React.FC = () => {
  const { isOpen, isLoading, error, itemId, itemType, allData, openInfo, closeInfo } = useInfoModal();
  const wiki = useWikiLookups(allData);

  // Back to the top when the dialog swaps to another item.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [itemId]);

  if (!isOpen) return null;

  if (isLoading) {
    return (
      <ModalDialog labelledBy="item-info-loading" onClose={closeInfo} maxWidth="max-w-sm">
        <div className="flex flex-col items-center justify-center gap-3 p-8">
          <LoaderCircle aria-hidden className="size-6 animate-spin text-fg-muted motion-reduce:animate-pulse" />
          <span id="item-info-loading" className="text-body text-fg-muted">
            Loading...
          </span>
        </div>
      </ModalDialog>
    );
  }

  if (error || !wiki || !itemId || !itemType) {
    return (
      <ModalDialog labelledBy="item-info-error" onClose={closeInfo} maxWidth="max-w-lg">
        <DialogFrame id="item-info-error" title="Couldn't open this item" onClose={closeInfo}>
          <p className="text-body text-problem">{error || "Item not found"}</p>
        </DialogFrame>
      </ModalDialog>
    );
  }

  const name = wiki.index.byId.get(itemId)?.name ?? itemId;
  const externalUrl = hypixelWikiUrl(itemId, name);

  return (
    <ModalDialog labelledBy="item-info-title" onClose={closeInfo} maxWidth="max-w-4xl">
      <div className="flex max-h-[calc(100dvh-1rem)] flex-col sm:max-h-[calc(100dvh-2rem)]">
        <span id="item-info-title" className="sr-only">
          {name}
        </span>
        <div className="shrink-0 border-b border-line px-3 py-3 sm:px-5">
          <ItemHeader
            id={itemId}
            data={wiki.data}
            variant="modal"
            actions={
              <>
                <Link
                  to={wikiPath(itemId)}
                  onClick={closeInfo}
                  className="hit-area focus-ring inline-flex h-8 items-center gap-1.5 rounded-control border border-line-strong bg-surface-control px-2.5 text-secondary font-medium text-fg-body transition-colors duration-(--duration-hover) hover:bg-surface-hover"
                  title="Open this item's page in the Greenhouse Wiki"
                >
                  <BookOpen aria-hidden className="size-3.5" />
                  <span className="hidden sm:inline">Open in Wiki</span>
                </Link>
                {externalUrl && (
                  <a
                    href={externalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hit-area focus-ring inline-grid size-8 place-items-center rounded-control text-fg-muted transition-colors duration-(--duration-hover) hover:bg-surface-hover hover:text-fg"
                    title="View on the Hypixel SkyBlock Wiki"
                    aria-label="View on the Hypixel SkyBlock Wiki"
                  >
                    <ExternalLink aria-hidden className="size-4" />
                  </a>
                )}
                <IconButton size="md" onClick={closeInfo} aria-label="Close" title="Close (Esc)">
                  <X />
                </IconButton>
              </>
            }
          />
        </div>
        <div ref={scrollRef} className="scrollbar-dark min-h-0 overflow-y-auto p-4 sm:p-6">
          <ItemNavContext.Provider value={openInfo}>
            <ItemDetails id={itemId} data={wiki.data} usedIn={wiki.usedIn} variant="modal" />
          </ItemNavContext.Provider>
        </div>
      </div>
    </ModalDialog>
  );
};
