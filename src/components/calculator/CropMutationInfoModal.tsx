import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, BookOpen, ExternalLink, LoaderCircle, RotateCw, X } from "lucide-react";
import { useInfoModal } from "../../context";
import { ItemDetails, ItemHeader, ItemNavContext, useWikiLookups } from "../wiki";
import { nameOf } from "../wiki/articleModel";
import { hypixelWikiUrl, wikiPath } from "../../wiki/slugs";
import { IconButton, KitButton } from "../ui/kit";
import { DialogFrame, ModalDialog } from "../ui/ModalDialog";

/**
 * The app-wide item info dialog (any crop or mutation, opened from the Calculator, Designer, Simulator,
 * Guide and Flows grids): the wiki article (facts → recipe band → details) in a kit modal.
 * - Item links inside swap the dialog in place; a Back arrow returns to the item before (a small stack,
 *   reset when the dialog opens on a new item from outside).
 * - First focus goes to the scrolling body (arrow keys scroll it), not to "Open in Wiki"; a swap scrolls back
 *   to the top.
 * - States: "Loading..." while data.json loads; "Couldn't open this item" with Retry when it fails.
 */
export const CropMutationInfoModal: React.FC = () => {
  const { isOpen, isLoading, error, itemId, itemType, allData, openInfo, closeInfo } = useInfoModal();
  const wiki = useWikiLookups(allData);

  // The swap history: ids opened inside this dialog session. openInfo from outside starts a new session.
  const [stack, setStack] = useState<string[]>([]);
  const swapping = useRef(false);
  useEffect(() => {
    if (!isOpen || !itemId) {
      setStack([]);
      return;
    }
    setStack((s) => {
      if (swapping.current) {
        swapping.current = false;
        return s[s.length - 1] === itemId ? s : [...s, itemId];
      }
      return [itemId];
    });
  }, [isOpen, itemId]);
  const swap = useCallback(
    (id: string) => {
      swapping.current = true;
      openInfo(id);
    },
    [openInfo],
  );
  const back = () => {
    const prev = stack[stack.length - 2];
    if (!prev) return;
    setStack((s) => s.slice(0, -1));
    openInfo(prev);
  };

  // On open and on every swap / Back: scroll the body to the top and focus it (the clicked link is gone, so
  // focus would otherwise fall to <body>). ModalDialog calls showModal() in its own effect, after this one:
  // wait a frame.
  const scrollRef = useRef<HTMLDivElement>(null);
  const shown = isOpen && !isLoading && !error && !!wiki && !!itemId && !!itemType;
  useEffect(() => {
    if (!shown) return;
    scrollRef.current?.scrollTo({ top: 0 });
    const raf = requestAnimationFrame(() => scrollRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(raf);
  }, [shown, itemId]);

  if (!isOpen) return null;

  if (isLoading) {
    return (
      <ModalDialog labelledBy="item-info-loading" onClose={closeInfo} maxWidth="max-w-sm">
        <div className="flex flex-col items-center justify-center gap-3 p-8" role="status">
          <LoaderCircle aria-hidden className="size-6 animate-spin text-fg-muted motion-reduce:animate-pulse" />
          <span id="item-info-loading" className="text-body text-fg-muted">
            Loading...
          </span>
        </div>
      </ModalDialog>
    );
  }

  if (error || !wiki || !itemId || !itemType) {
    // A missing item can't be retried; a failed load can.
    const failedLoad = !!error && !(allData && itemId && !allData.mutations[itemId] && !allData.crops[itemId]);
    return (
      <ModalDialog labelledBy="item-info-error" onClose={closeInfo} maxWidth="max-w-lg">
        <DialogFrame
          id="item-info-error"
          title="Couldn't open this item"
          onClose={closeInfo}
          footer={
            failedLoad && itemId ? (
              <KitButton onClick={() => openInfo(itemId)}>
                <RotateCw /> Retry
              </KitButton>
            ) : undefined
          }
        >
          <p role="alert" className="text-body text-problem">
            {error || "Item not found"}
          </p>
          {failedLoad && <p className="text-secondary text-fg-muted">Check your connection and try again.</p>}
        </DialogFrame>
      </ModalDialog>
    );
  }

  const name = wiki.index.byId.get(itemId)?.name ?? itemId;
  const externalUrl = hypixelWikiUrl(itemId, name);
  const prev = stack.length > 1 ? stack[stack.length - 2] : null;

  return (
    <ModalDialog labelledBy="item-info-title" onClose={closeInfo} maxWidth="max-w-4xl">
      <div className="flex max-h-[calc(100dvh-1rem)] flex-col sm:max-h-[calc(100dvh-2rem)]">
        <div className="shrink-0 border-b border-line px-3 py-3 sm:px-5">
          <ItemHeader
            id={itemId}
            data={wiki.data}
            variant="modal"
            headingId="item-info-title"
            lead={
              prev ? (
                <IconButton size="md" aria-label={`Back to ${nameOf(wiki, prev)}`} onClick={back} className="pointer-coarse:size-11">
                  <ArrowLeft />
                </IconButton>
              ) : undefined
            }
            actions={
              <>
                <Link
                  to={wikiPath(itemId)}
                  onClick={closeInfo}
                  aria-label="Open in Wiki"
                  className="hit-area focus-ring inline-flex h-8 items-center gap-1.5 rounded-control border border-line-strong bg-surface-control px-2.5 text-secondary font-medium text-fg-body transition-colors duration-(--duration-hover) hover:bg-surface-hover pointer-coarse:h-11"
                  title="Open this item's page in the Greenhouse Wiki"
                >
                  <BookOpen aria-hidden className="size-3.5" />
                  <span className="max-sm:hidden">Open in Wiki</span>
                </Link>
                {externalUrl && (
                  <a
                    href={externalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hit-area focus-ring inline-grid size-8 place-items-center rounded-control text-fg-muted transition-colors duration-(--duration-hover) hover:bg-surface-hover hover:text-fg pointer-coarse:size-11"
                    title="View on the Hypixel SkyBlock Wiki"
                    aria-label="View on the Hypixel SkyBlock Wiki"
                  >
                    <ExternalLink aria-hidden className="size-4" />
                  </a>
                )}
                <IconButton size="md" onClick={closeInfo} aria-label="Close" title="Close (Esc)" className="pointer-coarse:size-11">
                  <X />
                </IconButton>
              </>
            }
          />
        </div>
        <div ref={scrollRef} tabIndex={-1} aria-label={`${name} details`} className="scrollbar-dark min-h-0 overflow-y-auto overscroll-contain p-4 outline-none sm:px-5">
          <ItemNavContext.Provider value={swap}>
            <ItemDetails key={itemId} id={itemId} data={wiki.data} usedIn={wiki.usedIn} variant="modal" />
          </ItemNavContext.Provider>
        </div>
      </div>
    </ModalDialog>
  );
};
