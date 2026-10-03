import React, { useContext } from "react";
import { Link } from "react-router-dom";
import { wikiPath } from "../../wiki/slugs";
import { ItemNavContext } from "./itemNav";

interface ItemLinkProps {
  id: string;
  className?: string;
  title?: string;
  children: React.ReactNode;
}

/** Link to an item's wiki entry; in the info modal it swaps the modal content instead. */
export const ItemLink: React.FC<ItemLinkProps> = ({ id, className = "", title, children }) => {
  const navigate = useContext(ItemNavContext);
  if (navigate) {
    return (
      <button type="button" onClick={() => navigate(id)} className={`text-left cursor-pointer ${className}`} title={title}>
        {children}
      </button>
    );
  }
  return (
    <Link to={wikiPath(id)} className={className} title={title}>
      {children}
    </Link>
  );
};
