import React, { useMemo } from "react";
import {
  AlertTriangle,
  Box,
  ClockArrowDown,
  ClockArrowUp,
  Droplets,
  Flame,
  GitFork,
  Hourglass,
  Network,
  PackageOpen,
  Scissors,
  Sprout,
  Target,
  WandSparkles,
} from "lucide-react";
import { getGroundImagePath } from "../../types/greenhouse";
import { CropImage } from "../shared";
import { MutationRequirementGrid } from "../ui";
import { getEffectDescription } from "../../context";
import type { CropDataJSON, GreenhouseDataJSON, MutationDataJSON } from "../../services/greenhouseDataService";
import { getRecipeSource } from "../../wiki/recipes";
import { ItemLink } from "./ItemLink";
import { RecipeTree } from "./RecipeTree";
import { UsedInList } from "./UsedInList";
import { formatMinimumMutations, formatName, formatRarity, getRarityBgColor, getRarityColor } from "./format";

const DECAY_RULE_NOTE =
  "It can only decay once its timer has run out and it has helped create this many mutations; until then the timer extends by 24h. Fully grown plants of the same kind on a plot share the count.";

export type ItemDetailsVariant = "modal" | "page";

interface ItemHeaderProps {
  id: string;
  data: GreenhouseDataJSON;
  /** Rendered on the right of the header (close button, external links...). */
  actions?: React.ReactNode;
  variant: ItemDetailsVariant;
}

/** Icon, name, size, rarity and watering badges. */
export const ItemHeader: React.FC<ItemHeaderProps> = ({ id, data, actions, variant }) => {
  const mutation = data.mutations[id];
  const item = mutation ?? data.crops[id];
  if (!item) return null;
  const rarity = mutation?.rarity ?? null;
  const requiresWatering = mutation ? mutation.requires_watering ?? null : null;
  const isPage = variant === "page";

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <div
          className={`bg-slate-800 rounded-lg flex items-center justify-center overflow-hidden flex-shrink-0 ${
            isPage ? "w-14 h-14 sm:w-16 sm:h-16" : "w-10 h-10 sm:w-12 sm:h-12"
          }`}
        >
          <CropImage cropId={id} cropName={item.name} size={isPage ? "md" : "sm"} showFallback={false} />
        </div>
        <div className="min-w-0">
          {isPage ? (
            <h1 className={`text-xl sm:text-2xl font-bold truncate ${getRarityColor(rarity)}`}>{item.name}</h1>
          ) : (
            <h2 className={`text-base sm:text-lg font-semibold truncate ${getRarityColor(rarity)}`}>{item.name}</h2>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-400">
              {item.size}x{item.size}
            </span>
            {rarity ? (
              <span className={`text-xs px-1.5 py-0.5 rounded border ${getRarityBgColor(rarity)} ${getRarityColor(rarity)}`}>
                {formatRarity(rarity)}
              </span>
            ) : (
              <span className="text-xs px-1.5 py-0.5 rounded border bg-slate-500/20 border-slate-500/30 text-slate-300">
                Base Crop
              </span>
            )}
            {requiresWatering !== null && (
              <span
                className={`text-xs px-1.5 py-0.5 rounded border ${
                  requiresWatering
                    ? "bg-sky-500/20 border-sky-500/30 text-sky-300"
                    : "bg-slate-500/20 border-slate-500/30 text-slate-400"
                }`}
              >
                {requiresWatering ? "Needs Water" : "No Water"}
              </span>
            )}
          </div>
        </div>
      </div>
      {actions && <div className="flex items-center gap-1 flex-shrink-0">{actions}</div>}
    </div>
  );
};

interface ItemDetailsProps {
  id: string;
  data: GreenhouseDataJSON;
  usedIn: Map<string, string[]>;
  variant: ItemDetailsVariant;
}

/** Everything known about a crop or mutation. Shared by the info modal and the wiki page. */
export const ItemDetails: React.FC<ItemDetailsProps> = ({ id, data, usedIn, variant }) => {
  const mutation = data.mutations[id];
  const crop = data.crops[id];
  const item: CropDataJSON | MutationDataJSON | undefined = mutation ?? crop;

  // Requirements can be crops or mutations.
  const cropDataMap = useMemo(() => ({ ...data.crops, ...data.mutations }), [data]);

  if (!item) return <p className="text-rose-400">Item &quot;{id}&quot; not found</p>;

  const isMutation = !!mutation;
  const { ground, size, growth_stages: growthStages, positive_buffs: positiveBuffs, negative_buffs: negativeBuffs } = item;
  const requirements = mutation?.requirements ?? [];
  const special = mutation?.special ?? null;
  // Days; 0 = never. Crops carry it too (optional in the data type).
  const decay: number | null = mutation ? mutation.decay : crop?.decay ?? null;
  const minimumMutations = item.minimum_mutations;
  // The rule applies only with a decay timer and a numeric minimum.
  const showDecayRule = decay !== null && decay > 0 && typeof minimumMutations === "number";
  const drops = item.drops && Object.keys(item.drops).length > 0 ? Object.entries(item.drops) : [];
  const requiresWatering = mutation ? mutation.requires_watering ?? null : null;
  const usedInIds = usedIn.get(id) ?? [];
  const hasTree = getRecipeSource(data, id).ingredients.length > 0;
  const showRequirementGrid = requirements.length > 0 || special === "all_positive_crop_effects";
  const isPage = variant === "page";

  const renderDropRows = (entries: [string, number][]) => (
    <div className="space-y-1">
      {entries.map(([drop, amount]) => (
        <div key={drop} className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CropImage cropId={drop} cropName={formatName(drop)} size="xs" showFallback={false} />
            <span className="text-sm text-slate-300">{formatName(drop)}</span>
          </div>
          <span className="text-sm text-slate-400">{amount}</span>
        </div>
      ))}
    </div>
  );

  const renderEffects = (buffs: string[], tone: "emerald" | "rose") =>
    buffs.map((buff, index) => {
      const description = getEffectDescription(buff, data.effects);
      return (
        <div key={`${buff}-${index}`} className="space-y-0.5">
          <span className={`text-sm font-medium ${tone === "emerald" ? "text-emerald-300" : "text-rose-300"}`}>
            {formatName(buff)}
          </span>
          {description && (
            <p className={`text-xs ${tone === "emerald" ? "text-emerald-300/70" : "text-rose-300/70"}`}>{description}</p>
          )}
        </div>
      );
    });

  return (
    <div className="flex flex-col lg:flex-row gap-4 lg:gap-6">
      {/* Left column: properties and effects. */}
      <div className="space-y-4 flex-1 min-w-0">
        <Card icon={<Box className="w-4 h-4 text-emerald-400" />} title="Ground Type">
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded border border-slate-600"
              style={{ backgroundImage: `url(${getGroundImagePath(ground)})`, backgroundSize: "cover" }}
            />
            <span className="text-sm text-slate-300">{formatName(ground)}</span>
          </div>
        </Card>

        {/* Growth stages, decay and minimum mutations share a wrapping row. */}
        {(growthStages !== null || decay !== null || minimumMutations !== undefined) && (
          <div className="flex flex-wrap gap-4">
            {growthStages !== null && (
              <Card className="flex-1 min-w-[8rem]" icon={<ClockArrowUp className="w-4 h-4 text-blue-400" />} title="Growth Stages">
                <span className="text-sm text-slate-300">
                  {growthStages} stage{growthStages !== 1 ? "s" : ""}
                </span>
              </Card>
            )}
            {decay !== null && (
              <Card className="flex-1 min-w-[8rem]" icon={<ClockArrowDown className="w-4 h-4 text-amber-400" />} title="Decay">
                <span className="text-sm text-slate-300">{decay > 0 ? `${decay} day${decay !== 1 ? "s" : ""}` : "Never"}</span>
              </Card>
            )}
            {minimumMutations !== undefined && (
              <Card className="flex-1 min-w-[8rem]" icon={<Hourglass className="w-4 h-4 text-amber-400" />} title="Minimum Mutations">
                <span className="text-sm text-slate-300">{formatMinimumMutations(minimumMutations)}</span>
              </Card>
            )}
          </div>
        )}

        {showDecayRule && <p className="text-xs text-slate-500 leading-relaxed">{DECAY_RULE_NOTE}</p>}

        {requiresWatering !== null && (
          <div
            className={`rounded-lg p-4 border ${
              requiresWatering ? "bg-sky-500/10 border-sky-500/30" : "bg-slate-800/40 border-slate-600/30"
            }`}
          >
            <div className="flex items-center gap-2 mb-2">
              <Droplets className={`w-4 h-4 ${requiresWatering ? "text-sky-400" : "text-slate-500"}`} />
              <h3 className="text-sm font-medium text-slate-200">Watering</h3>
            </div>
            <p className={`text-sm leading-relaxed ${requiresWatering ? "text-sky-300/90" : "text-slate-400"}`}>
              {requiresWatering
                ? "Requires water while growing. A plant that dries out halts: it stops growing, gives no effects and doesn't count for mutations or unique crops until it is watered. It no longer dies. Water Retain crops nearby help."
                : "Does not need water to grow."}
            </p>
          </div>
        )}

        {special && (
          <ToneCard tone="amber" icon={<WandSparkles className="w-4 h-4 text-amber-400" />} title="Special Condition">
            <p className="text-sm text-amber-300/90">
              {special === "all_positive_crop_effects"
                ? `Spawns in any empty ${size}x${size} area that receives every one of its positive effects from neighbouring crops (directly from a side neighbour, or relayed by a Wild Rose): ${positiveBuffs.map(formatName).join(", ")}. No crop requirements.`
                : getRecipeSource(data, id).note}
            </p>
          </ToneCard>
        )}

        {mutation?.growing_info && (
          <ToneCard tone="blue" icon={<Sprout className="w-4 h-4 text-blue-400" />} title="Growing Info">
            <p className="text-sm text-blue-300/90 leading-relaxed">{mutation.growing_info}</p>
          </ToneCard>
        )}

        {mutation?.harvest_info && (
          <ToneCard tone="purple" icon={<Scissors className="w-4 h-4 text-purple-400" />} title="Harvest Info">
            <p className="text-sm text-purple-300/90 leading-relaxed">{mutation.harvest_info}</p>
          </ToneCard>
        )}

        {positiveBuffs.length > 0 && (
          <ToneCard tone="emerald" icon={<Flame className="w-4 h-4 text-emerald-400" />} title="Positive Effects">
            <div className="space-y-2">{renderEffects(positiveBuffs, "emerald")}</div>
          </ToneCard>
        )}

        {negativeBuffs.length > 0 && (
          <ToneCard tone="rose" icon={<AlertTriangle className="w-4 h-4 text-rose-400" />} title="Negative Effects">
            <div className="space-y-2">{renderEffects(negativeBuffs, "rose")}</div>
          </ToneCard>
        )}

        {!isMutation && drops.length > 0 && (
          <Card icon={<PackageOpen className="w-4 h-4 text-blue-400" />} title="Base Yield">
            {renderDropRows(drops)}
            <p className="text-xs text-slate-500 mt-3 pt-3 border-t border-slate-600/30">
              Per harvest before Farming Fortune and Yield buffs.
            </p>
          </Card>
        )}
      </div>

      {/* Right column: how to make it, what it drops, what it makes. */}
      <div className={`w-full flex-shrink-0 space-y-4 ${isPage ? "lg:w-96" : "lg:w-80"}`}>
        {showRequirementGrid && (
          <Card icon={<Target className="w-4 h-4 text-yellow-400" />} title="Requirements">
            <div className="w-full mb-4">
              <MutationRequirementGrid mutationId={id} cropDataMap={cropDataMap} />
            </div>
            {requirements.length > 0 && (
              <div className="space-y-0.5 border-t border-slate-600/30 pt-3">
                {requirements.map((req, index) => {
                  const reqRarity = data.mutations[req.crop]?.rarity;
                  return (
                    <ItemLink
                      key={`${req.crop}-${index}`}
                      id={req.crop}
                      className="flex items-center gap-2 -mx-1.5 px-1.5 py-0.5 rounded-md hover:bg-slate-700/40 transition-colors"
                    >
                      <CropImage cropId={req.crop} cropName={req.crop} size="xs" showFallback={false} />
                      <span className={`text-sm ${getRarityColor(reqRarity)}`}>
                        {req.count}x {data.mutations[req.crop]?.name ?? data.crops[req.crop]?.name ?? formatName(req.crop)}
                      </span>
                    </ItemLink>
                  );
                })}
              </div>
            )}
          </Card>
        )}

        {isMutation && drops.length > 0 && (
          <Card icon={<PackageOpen className="w-4 h-4 text-blue-400" />} title="Drops">
            {renderDropRows(drops)}
          </Card>
        )}

        {hasTree && (
          <Card icon={<Network className="w-4 h-4 text-teal-400" />} title="Crafting Tree">
            <RecipeTree key={id} id={id} data={data} />
          </Card>
        )}

        <Card
          icon={<GitFork className="w-4 h-4 text-indigo-400" />}
          title="Used In"
          badge={usedInIds.length > 0 ? String(usedInIds.length) : undefined}
        >
          <UsedInList ids={usedInIds} data={data} />
        </Card>
      </div>
    </div>
  );
};

interface CardProps {
  icon: React.ReactNode;
  title: string;
  badge?: string;
  className?: string;
  children: React.ReactNode;
}

const Card: React.FC<CardProps> = ({ icon, title, badge, className = "", children }) => (
  <section className={`bg-slate-800/40 border border-slate-600/30 rounded-lg p-4 ${className}`}>
    <div className="flex items-center gap-2 mb-3">
      {icon}
      <h3 className="text-sm font-medium text-slate-200">{title}</h3>
      {badge && <span className="ml-auto text-xs text-slate-500">{badge}</span>}
    </div>
    {children}
  </section>
);

const TONES = {
  amber: { box: "bg-amber-500/10 border-amber-500/30", title: "text-amber-200" },
  blue: { box: "bg-blue-500/10 border-blue-500/30", title: "text-blue-200" },
  purple: { box: "bg-purple-500/10 border-purple-500/30", title: "text-purple-200" },
  emerald: { box: "bg-emerald-500/10 border-emerald-500/30", title: "text-emerald-200" },
  rose: { box: "bg-rose-500/10 border-rose-500/30", title: "text-rose-200" },
} as const;

const ToneCard: React.FC<{ tone: keyof typeof TONES; icon: React.ReactNode; title: string; children: React.ReactNode }> = ({
  tone,
  icon,
  title,
  children,
}) => (
  <section className={`border rounded-lg p-4 ${TONES[tone].box}`}>
    <div className="flex items-center gap-2 mb-2">
      {icon}
      <h3 className={`text-sm font-medium ${TONES[tone].title}`}>{title}</h3>
    </div>
    {children}
  </section>
);
