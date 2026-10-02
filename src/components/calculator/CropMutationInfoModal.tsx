import React, { useEffect, useRef, useMemo } from "react";
import {
  X,
  AlertTriangle,
  Loader2,
  Box,
  ClockArrowUp, Flame, Target, PackageOpen, ClockArrowDown, Hourglass, WandSparkles, Sprout, Scissors, Droplets
} from "lucide-react";
import { getGroundImagePath } from "../../types/greenhouse";
import { CropImage } from "../shared";
import { useInfoModal, getEffectDescription } from "../../context";
import { MutationRequirementGrid } from "../ui";
import type { CropDataJSON, MutationDataJSON } from "../../services/greenhouseDataService";

function formatName(name: string): string {
  return name
    .split("_")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatGroundType(ground: string): string {
  return ground
    .split("_")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// Minimum mutations: a number, "infinite" (never decays), or null (N/A: timer-only).
function formatMinimumMutations(value: number | "infinite" | null): string {
  if (value === "infinite") return "Infinite";
  if (value === null) return "None";
  return String(value);
}

const DECAY_RULE_NOTE =
  "It can only decay once its timer has run out and it has helped create this many mutations; until then the timer extends by 24h. Plants of the same kind on a plot share the count.";

function getRarityColor(rarity: string): string {
  switch (rarity.toLowerCase()) {
    case "common":
      return "text-slate-300";
    case "uncommon":
      return "text-green-400";
    case "rare":
      return "text-blue-400";
    case "epic":
      return "text-purple-400";
    case "legendary":
      return "text-yellow-400";
    default:
      return "text-slate-300";
  }
}

function getRarityBgColor(rarity: string): string {
  switch (rarity.toLowerCase()) {
    case "common":
      return "bg-slate-500/20 border-slate-500/30";
    case "uncommon":
      return "bg-green-500/20 border-green-500/30";
    case "rare":
      return "bg-blue-500/20 border-blue-500/30";
    case "epic":
      return "bg-purple-500/20 border-purple-500/30";
    case "legendary":
      return "bg-yellow-500/20 border-yellow-500/30";
    default:
      return "bg-slate-500/20 border-slate-500/30";
  }
}

export const CropMutationInfoModal: React.FC = () => {
  const modalRef = useRef<HTMLDivElement>(null);
  const {
    isOpen,
    isLoading,
    error,
    cropData,
    mutationData,
    effectsMap,
    allData,
    closeInfo,
  } = useInfoModal();

  const isMutation = !!mutationData;
  const data = mutationData || cropData;

  const cropDataMap = useMemo(() => {
    if (!allData) return {};
    const map: Record<string, CropDataJSON | MutationDataJSON> = {};
    
    for (const [id, crop] of Object.entries(allData.crops)) {
      map[id] = crop;
    }
    
    // Some requirements are mutations.
    for (const [id, mutation] of Object.entries(allData.mutations)) {
      map[id] = mutation;
    }
    
    return map;
  }, [allData]);

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

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
      closeInfo();
    }
  };

  if (!isOpen) return null;

  if (isLoading) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/50 backdrop-blur-sm overflow-y-auto"
        onClick={handleBackdropClick}
      >
        <div
          ref={modalRef}
          className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-lg p-8 my-auto"
        >
          <div className="flex flex-col items-center justify-center gap-3">
            <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
            <span className="text-slate-300">Loading...</span>
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/50 backdrop-blur-sm overflow-y-auto"
        onClick={handleBackdropClick}
      >
        <div
          ref={modalRef}
          className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-lg p-6 my-auto"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-100">Error</h2>
            <button
              onClick={closeInfo}
              className="p-2 hover:bg-slate-800 rounded-lg transition-colors text-slate-400 hover:text-slate-200"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <p className="text-rose-400">{error || "Item not found"}</p>
        </div>
      </div>
    );
  }

  const id = isMutation ? mutationData!.id : cropData!.id;
  const name = data.name;
  const size = data.size;
  const ground = data.ground;
  const growthStages = data.growth_stages;
  const positiveBuffs = data.positive_buffs;
  const negativeBuffs = data.negative_buffs;

  const rarity = isMutation ? mutationData!.rarity : null;
  const requirements = isMutation ? mutationData!.requirements : [];
  const special = isMutation ? mutationData!.special : null;
  // Days; 0 = never. Crops carry it too (optional in the data type).
  const decay: number | null = isMutation ? mutationData!.decay : cropData!.decay ?? null;
  const minimumMutations = isMutation ? mutationData!.minimum_mutations : cropData!.minimum_mutations;
  // The rule applies only with a decay timer and a numeric minimum.
  const showDecayRule = decay !== null && decay > 0 && typeof minimumMutations === "number";
  const drops = isMutation ? mutationData!.drops : cropData!.drops ?? null;
  const requiresWatering = isMutation ? mutationData!.requires_watering ?? null : null;
  const harvestInfo = isMutation ? mutationData!.harvest_info : null;
  const growingInfo = isMutation ? mutationData!.growing_info : null;

  // Shared by the mutation "Drops" list and the crop "Base Yield" list.
  const renderDropRows = (entries: [string, number][]) => (
    <div className="space-y-1">
      {entries.map(([item, amount]) => (
        <div key={item} className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CropImage
              cropId={item}
              cropName={formatName(item)}
              size="xs"
              showFallback={false}
            />
            <span className="text-sm text-slate-300">{formatName(item)}</span>
          </div>
          <span className="text-sm text-slate-400">{amount}</span>
        </div>
      ))}
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/50 backdrop-blur-sm overflow-y-auto"
      onClick={handleBackdropClick}
    >
      <div
        ref={modalRef}
        className={`bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-h-[95vh] my-auto overflow-hidden flex flex-col ${
          isMutation && (requirements.length > 0 || special === "all_positive_crop_effects" || (drops && Object.keys(drops).length > 0)) ? "max-w-3xl" : "max-w-lg"
        }`}
      >
        <div className="flex-shrink-0 bg-slate-900 border-b border-slate-700 px-3 sm:px-6 py-3 sm:py-4 flex items-center justify-between rounded-t-xl">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-slate-800 rounded-lg flex items-center justify-center overflow-hidden flex-shrink-0">
              <CropImage
                cropId={id}
                cropName={name}
                size="sm"
                showFallback={false}
              />
            </div>
            <div className="min-w-0">
              <h2 className={`text-base sm:text-lg font-semibold truncate ${rarity ? getRarityColor(rarity) : "text-slate-100"}`}>
                {name}
              </h2>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">
                  {size}x{size}
                </span>
                {rarity && (
                  <span className={`text-xs px-1.5 py-0.5 rounded border ${getRarityBgColor(rarity)} ${getRarityColor(rarity)}`}>
                    {rarity.charAt(0).toUpperCase() + rarity.slice(1)}
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
          <button
            onClick={closeInfo}
            className="p-2 hover:bg-slate-800 rounded-lg transition-colors text-slate-400 hover:text-slate-200"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className={`p-4 sm:p-6 overflow-y-auto ${isMutation && (requirements.length > 0 || special === "all_positive_crop_effects" || (drops && Object.keys(drops).length > 0)) ? "flex flex-col lg:flex-row gap-4 lg:gap-6" : ""}`}>
          <div className={`space-y-4 ${isMutation && (requirements.length > 0 || special === "all_positive_crop_effects" || (drops && Object.keys(drops).length > 0)) ? "flex-1 min-w-0" : ""}`}>
            <div className="bg-slate-800/40 border border-slate-600/30 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <Box className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-medium text-slate-200">Ground Type</h3>
              </div>
              <div className="flex items-center gap-3">
                <div
                  className="w-8 h-8 rounded border border-slate-600"
                  style={{
                    backgroundImage: `url(${getGroundImagePath(ground)})`,
                    backgroundSize: "cover",
                  }}
                />
                <span className="text-sm text-slate-300">{formatGroundType(ground)}</span>
              </div>
            </div>

            {/* Growth stages, decay and minimum mutations share a wrapping row. */}
            {(growthStages !== null || decay !== null || minimumMutations !== undefined) && (
              <div className="flex flex-wrap gap-4">
                {growthStages !== null && (
                  <div className="flex-1 min-w-[8rem] bg-slate-800/40 border border-slate-600/30 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <ClockArrowUp className="w-4 h-4 text-blue-400" />
                      <h3 className="text-sm font-medium text-slate-200">Growth Stages</h3>
                    </div>
                    <span className="text-sm text-slate-300">{growthStages} stage{growthStages !== 1 ? "s" : ""}</span>
                  </div>
                )}
                {decay !== null && (
                  <div className="flex-1 min-w-[8rem] bg-slate-800/40 border border-slate-600/30 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <ClockArrowDown className="w-4 h-4 text-amber-400" />
                      <h3 className="text-sm font-medium text-slate-200">Decay</h3>
                    </div>
                    <span className="text-sm text-slate-300">
                      {decay > 0 ? `${decay} day${decay !== 1 ? "s" : ""}` : "Never"}
                    </span>
                  </div>
                )}
                {minimumMutations !== undefined && (
                  <div className="flex-1 min-w-[8rem] bg-slate-800/40 border border-slate-600/30 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Hourglass className="w-4 h-4 text-amber-400" />
                      <h3 className="text-sm font-medium text-slate-200">Minimum Mutations</h3>
                    </div>
                    <span className="text-sm text-slate-300">{formatMinimumMutations(minimumMutations)}</span>
                  </div>
                )}
              </div>
            )}

            {showDecayRule && (
              <p className="text-xs text-slate-500 leading-relaxed">{DECAY_RULE_NOTE}</p>
            )}

            {isMutation && requiresWatering !== null && (
              <div
                className={`rounded-lg p-4 border ${
                  requiresWatering
                    ? "bg-sky-500/10 border-sky-500/30"
                    : "bg-slate-800/40 border-slate-600/30"
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Droplets
                    className={`w-4 h-4 ${requiresWatering ? "text-sky-400" : "text-slate-500"}`}
                  />
                  <h3 className="text-sm font-medium text-slate-200">Watering</h3>
                </div>
                <p
                  className={`text-sm leading-relaxed ${
                    requiresWatering ? "text-sky-300/90" : "text-slate-400"
                  }`}
                >
                  {requiresWatering
                    ? "Requires water while growing. A plant that dries out halts: it stops growing, gives no effects and doesn't count for mutations or unique crops until it is watered. It no longer dies. Water Retain crops nearby help."
                    : "Does not need water to grow."}
                </p>
              </div>
            )}

            {isMutation && special && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <WandSparkles className="w-4 h-4 text-amber-400" />
                  <h3 className="text-sm font-medium text-amber-200">Special Condition</h3>
                </div>
                <p className="text-sm text-amber-300/90">
                  {special === "all_positive_crop_effects"
                    ? `Spawns in any empty ${size}x${size} area that receives every one of its positive effects from neighbouring crops (directly from a side neighbour, or relayed by a Wild Rose): ${positiveBuffs.map(formatName).join(", ")}. No crop requirements.`
                    : formatName(special)}
                </p>
              </div>
            )}

            {isMutation && growingInfo && (
              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Sprout className="w-4 h-4 text-blue-400" />
                  <h3 className="text-sm font-medium text-blue-200">Growing Info</h3>
                </div>
                <p className="text-sm text-blue-300/90 leading-relaxed">{growingInfo}</p>
              </div>
            )}

            {isMutation && harvestInfo && (
              <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Scissors className="w-4 h-4 text-purple-400" />
                  <h3 className="text-sm font-medium text-purple-200">Harvest Info</h3>
                </div>
                <p className="text-sm text-purple-300/90 leading-relaxed">{harvestInfo}</p>
              </div>
            )}

            {positiveBuffs.length > 0 && (
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Flame className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-sm font-medium text-emerald-200">Positive Effects</h3>
                </div>
                <div className="space-y-2">
                  {positiveBuffs.map((buff, index) => {
                    const description = getEffectDescription(buff, effectsMap);
                    return (
                      <div key={index} className="space-y-0.5">
                        <span className="text-sm font-medium text-emerald-300">
                          {formatName(buff)}
                        </span>
                        {description && (
                          <p className="text-xs text-emerald-300/70">{description}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {negativeBuffs.length > 0 && (
              <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle className="w-4 h-4 text-rose-400" />
                  <h3 className="text-sm font-medium text-rose-200">Negative Effects</h3>
                </div>
                <div className="space-y-2">
                  {negativeBuffs.map((buff, index) => {
                    const description = getEffectDescription(buff, effectsMap);
                    return (
                      <div key={index} className="space-y-0.5">
                        <span className="text-sm font-medium text-rose-300">
                          {formatName(buff)}
                        </span>
                        {description && (
                          <p className="text-xs text-rose-300/70">{description}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {!isMutation && drops && Object.keys(drops).length > 0 && (
              <div className="bg-slate-800/40 border border-slate-600/30 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <PackageOpen className="w-4 h-4 text-blue-400" />
                  <h3 className="text-sm font-medium text-slate-200">Base Yield</h3>
                </div>
                {renderDropRows(Object.entries(drops))}
                <p className="text-xs text-slate-500 mt-3 pt-3 border-t border-slate-600/30">
                  Per harvest before Farming Fortune and Yield buffs.
                </p>
              </div>
            )}
          </div>

          {/* Right column: requirements and drops (mutations only). */}
          {isMutation && (requirements.length > 0 || special === "all_positive_crop_effects" || (drops && Object.keys(drops).length > 0)) && (
            <div className="w-full lg:w-72 flex-shrink-0 space-y-4">
              {(requirements.length > 0 || special === "all_positive_crop_effects") && (
                <div className="bg-slate-800/40 border border-slate-600/30 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Target className="w-4 h-4 text-yellow-400" />
                    <h3 className="text-sm font-medium text-slate-200">Requirements</h3>
                  </div>
                  
                  <div className="w-full mb-4">
                    <MutationRequirementGrid
                      mutationId={id}
                      cropDataMap={cropDataMap}
                    />
                  </div>
                  
                  <div className="space-y-1.5 border-t border-slate-600/30 pt-3">
                    {requirements.map((req, index) => {
                      const reqData = cropDataMap[req.crop];
                      const reqRarity = reqData && "rarity" in reqData ? reqData.rarity : null;
                      const reqColor = reqRarity ? getRarityColor(reqRarity) : "text-slate-300";
                      
                      return (
                        <div key={index} className="flex items-center gap-2">
                          <CropImage
                            cropId={req.crop}
                            cropName={req.crop}
                            size="xs"
                            showFallback={false}
                          />
                          <span className={`text-sm ${reqColor}`}>
                            {req.count}x {formatName(req.crop)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              
              {drops && Object.keys(drops).length > 0 && (
                <div className="bg-slate-800/40 border border-slate-600/30 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <PackageOpen className="w-4 h-4 text-blue-400" />
                    <h3 className="text-sm font-medium text-slate-200">Drops</h3>
                  </div>
                  {renderDropRows(Object.entries(drops))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
