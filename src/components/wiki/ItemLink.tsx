import React, { useContext } from "react";
import { Link } from "react-router-dom";
import { wikiPath } from "../../wiki/slugs";
import { cn } from "../ui/cn";
import { ItemNavContext } from "./itemNav";

interface ItemLinkProps {
  id: string;
  className?: string;
  title?: string;
  /** Marks the current item (navbox, Browse). */
  current?: boolean;
  /** Runs before a plain click navigates or swaps (close a popover, flag the h1 for focus). */
  onNavigate?: () => void;
  children: React.ReactNode;
}

/**
 * A link to an item's wiki page: always a real `/wiki/<slug>` href, so middle-click, copy link and crawlers
 * work. On a page it's a router Link (Back works). Inside the info dialog (`ItemNavContext`) a plain click
 * swaps the dialog to the item instead of leaving; modified clicks still open the page.
 */
export const ItemLink: React.FC<ItemLinkProps> = ({ id, className, title, current, onNavigate, children }) => {
  const swap = useContext(ItemNavContext);
  const cls = cn("focus-ring cursor-pointer rounded-inner", className);
  if (swap)
    return (
      <a
        href={wikiPath(id)}
        title={title}
        aria-current={current ? "page" : undefined}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          e.preventDefault();
          onNavigate?.();
          swap(id);
        }}
        className={cls}
      >
        {children}
      </a>
    );
  return (
    <Link to={wikiPath(id)} title={title} aria-current={current ? "page" : undefined} onClick={(e) => !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) && onNavigate?.()} className={cls}>
      {children}
    </Link>
  );
};
