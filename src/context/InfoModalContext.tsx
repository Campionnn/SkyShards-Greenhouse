import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { loadGreenhouseData, getEffectData, getRawData } from "../services/greenhouseDataService";
import type { EffectDefinition, GreenhouseDataJSON } from "../services/greenhouseDataService";

interface InfoModalContextType {
  isOpen: boolean;
  itemId: string | null;
  itemType: "crop" | "mutation" | null;
  isLoading: boolean;
  error: string | null;

  // Full data; the modal renders itemId from it.
  allData: GreenhouseDataJSON | null;

  /** Opens the modal on an item, or swaps an open modal to it. */
  openInfo: (itemId: string) => void;
  closeInfo: () => void;
}

const InfoModalContext = createContext<InfoModalContextType | null>(null);

export const InfoModalProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [itemId, setItemId] = useState<string | null>(null);
  const [itemType, setItemType] = useState<"crop" | "mutation" | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allData, setAllData] = useState<GreenhouseDataJSON | null>(null);

  useEffect(() => {
    loadGreenhouseData()
      .then(setAllData)
      .catch((err) => {
        console.error("Failed to load greenhouse data:", err);
      });
  }, []);

  const openInfo = useCallback((id: string) => {
    const show = (data: GreenhouseDataJSON) => {
      setAllData(data);
      if (data.mutations[id]) {
        setItemType("mutation");
      } else if (data.crops[id]) {
        setItemType("crop");
      } else {
        setItemType(null);
        setError(`Item "${id}" not found`);
      }
    };

    setIsOpen(true);
    setItemId(id);
    setError(null);

    // Already loaded: swap synchronously so the modal doesn't flash a spinner.
    const cached = getRawData();
    if (cached) {
      setIsLoading(false);
      show(cached);
      return;
    }

    setIsLoading(true);
    loadGreenhouseData()
      .then(show)
      .catch((err) => {
        setItemType(null);
        setError(err instanceof Error ? err.message : "Failed to load data");
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  const closeInfo = useCallback(() => {
    setIsOpen(false);
    setItemId(null);
    setItemType(null);
    setError(null);
  }, []);

  const value: InfoModalContextType = {
    isOpen,
    itemId,
    itemType,
    isLoading,
    error,
    allData,
    openInfo,
    closeInfo,
  };

  return <InfoModalContext.Provider value={value}>{children}</InfoModalContext.Provider>;
};

export const useInfoModal = (): InfoModalContextType => {
  const context = useContext(InfoModalContext);
  if (!context) {
    throw new Error("useInfoModal must be used within InfoModalProvider");
  }
  return context;
};

export const getEffectDescription = (effectId: string, effectsMap: Record<string, EffectDefinition>): string => {
  const effect = effectsMap[effectId] || getEffectData(effectId);
  return effect?.description || "";
};
