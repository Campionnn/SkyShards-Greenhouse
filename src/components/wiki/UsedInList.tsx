import React from "react";
import { CropImage } from "../shared";
import type { GreenhouseDataJSON } from "../../services/greenhouseDataService";
import { ItemLink } from "./ItemLink";
import { getRarityColor } from "./format";

interface UsedInListProps {
  ids: string[];
  data: GreenhouseDataJSON;
}

/** Mutations that list the item as an ingredient. */
export const UsedInList: React.FC<UsedInListProps> = ({ ids, data }) => {
  if (ids.length === 0) {
    return <p className="text-sm text-slate-400">Not an ingredient in any mutation.</p>;
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
      {ids.map((id) => {
        const mutation = data.mutations[id];
        const name = mutation?.name ?? id;
        return (
          <ItemLink
            key={id}
            id={id}
            className="flex items-center gap-2 min-w-0 px-1.5 py-1 rounded-md hover:bg-slate-700/40 transition-colors"
          >
            <CropImage cropId={id} cropName={name} width={22} height={22} showFallback={false} />
            <span className={`text-sm truncate ${getRarityColor(mutation?.rarity)}`}>{name}</span>
          </ItemLink>
        );
      })}
    </div>
  );
};
