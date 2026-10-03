import React, { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { X, Loader2, BookOpen, ExternalLink } from "lucide-react";
import { useInfoModal } from "../../context";
import { ItemDetails, ItemHeader, ItemNavContext, useWikiLookups } from "../wiki";
import { hypixelWikiUrl, wikiPath } from "../../wiki/slugs";

const ICON_BUTTON =
  "p-2 hover:bg-slate-800 rounded-lg transition-colors text-slate-400 hover:text-slate-200 flex items-center gap-1.5";

export const CropMutationInfoModal: React.FC = () => {
  const modalRef = useRef<HTMLDivElement>(null);
  const { isOpen, isLoading, error, itemId, itemType, allData, openInfo, closeInfo } = useInfoModal();
  const wiki = useWikiLookups(allData);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        closeInfo();
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, closeInfo]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // Reset scroll when the modal swaps to another item.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [itemId]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
      closeInfo();
    }
  };

  if (!isOpen) return null;

  const backdropClass =
    "fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/50 backdrop-blur-sm overflow-y-auto";

  if (isLoading) {
    return (
      <div className={backdropClass} onClick={handleBackdropClick}>
        <div ref={modalRef} className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-lg p-8 my-auto">
          <div className="flex flex-col items-center justify-center gap-3">
            <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
            <span className="text-slate-300">Loading...</span>
          </div>
        </div>
      </div>
    );
  }

  if (error || !wiki || !itemId || !itemType) {
    return (
      <div className={backdropClass} onClick={handleBackdropClick}>
        <div ref={modalRef} className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-lg p-6 my-auto">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-100">Error</h2>
            <button onClick={closeInfo} className={ICON_BUTTON} aria-label="Close modal">
              <X className="w-5 h-5" />
            </button>
          </div>
          <p className="text-rose-400">{error || "Item not found"}</p>
        </div>
      </div>
    );
  }

  const name = wiki.index.byId.get(itemId)?.name ?? itemId;
  const externalUrl = hypixelWikiUrl(itemId, name);

  return (
    <div className={backdropClass} onClick={handleBackdropClick}>
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label={name}
        className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-4xl max-h-[95vh] my-auto overflow-hidden flex flex-col"
      >
        <div className="flex-shrink-0 bg-slate-900 border-b border-slate-700 px-3 sm:px-6 py-3 sm:py-4 rounded-t-xl">
          <ItemHeader
            id={itemId}
            data={wiki.data}
            variant="modal"
            actions={
              <>
                <Link
                  to={wikiPath(itemId)}
                  onClick={closeInfo}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors bg-teal-500/15 hover:bg-teal-500/25 text-teal-300 border border-teal-500/25"
                  title="Open this item's page in the Greenhouse Wiki"
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Open in Wiki</span>
                </Link>
                {externalUrl && (
                  <a
                    href={externalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={ICON_BUTTON}
                    title="View on the Hypixel SkyBlock Wiki"
                    aria-label="View on the Hypixel SkyBlock Wiki"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                )}
                <button onClick={closeInfo} className={ICON_BUTTON} aria-label="Close modal">
                  <X className="w-5 h-5" />
                </button>
              </>
            }
          />
        </div>

        <div ref={scrollRef} className="p-4 sm:p-6 overflow-y-auto">
          {/* Links inside the modal swap it to the clicked item instead of leaving the page. */}
          <ItemNavContext.Provider value={openInfo}>
            <ItemDetails id={itemId} data={wiki.data} usedIn={wiki.usedIn} variant="modal" />
          </ItemNavContext.Provider>
        </div>
      </div>
    </div>
  );
};
