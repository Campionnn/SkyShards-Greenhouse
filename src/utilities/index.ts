export const formatNumber = (num: number): string => {
  if (num === 0) return "0";
  if (num < 0.01) return num.toFixed(4);
  if (num < 1) return num.toFixed(2);
  return num.toFixed(2).replace(/\.00$/, "");
};

export function debounce<TArgs extends unknown[], TReturn>(
  func: (...args: TArgs) => TReturn,
  wait: number
): (...args: TArgs) => void {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return (...args: TArgs) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => {
      func(...args);
    }, wait);
  };
}

export * from "./gridCalculations";
export * from "./placementValidation";
export * from "./rarity";
export * from "./designEncoding";
export * from "./layoutStorage";
export * from "./mutationLayoutGenerator";
export * from "./localStorageManager";
export * from "./gridExport";
export * from "./effectSimulation";
export * from "./layoutTransform";
export * from "./layoutHistory";
export * from "./layoutHandoff";
