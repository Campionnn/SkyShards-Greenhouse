import React from "react";
import { getGroundImagePath } from "../../types/greenhouse";
import { InfoHint } from "../ui/InfoHint";
import { cn } from "../ui/cn";
import { factsOf, type Item } from "./articleModel";

/**
 * The facts (the Hypixel wiki's infobox, as a strip): label over value, tabular values, a ? hint for the
 * water rule and the decay rule. One row of up to 6 on the page and in the dialog; 3 + 3 / 2 + 2 + 2 on a
 * phone. Hairlines above and below on the page; in the dialog only below (the header has one above).
 */
export const FactGrid: React.FC<{ item: Item; variant: "page" | "modal"; className?: string }> = ({ item, variant, className }) => (
  <dl className={cn("grid min-w-0 grid-cols-[repeat(auto-fit,minmax(6.75rem,1fr))] gap-x-4 gap-y-2.5 border-b border-line py-2.5", variant === "modal" ? "pt-0" : "border-t", className)}>
    {factsOf(item).map((f) => (
      <div key={f.key} className="min-w-0">
        <dt className="text-secondary text-fg-meta">{f.label}</dt>
        <dd className="mt-0.5 flex min-w-0 items-center gap-1.5 text-body font-medium text-fg tabular-nums" title={f.title}>
          {f.ground && <img src={getGroundImagePath(f.ground)} alt="" className="size-4 shrink-0 rounded-inner" />}
          <span className="min-w-0 truncate">{f.value}</span>
          {f.hint && (
            <InfoHint title={f.hint.title} width={300} label={`About ${f.label.toLowerCase()}`}>
              {f.hint.text}
            </InfoHint>
          )}
        </dd>
      </div>
    ))}
  </dl>
);
