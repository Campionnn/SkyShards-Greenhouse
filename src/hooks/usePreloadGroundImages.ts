import { useEffect } from "react";
import { getGroundImagePath } from "../types/greenhouse";

const GROUND_TYPES = [
  "farmland",
  "mycelium",
  "netherrack",
  "sand",
  "soul_sand",
  "end_stone",
];

/** Preloads ground textures on mount so placing a crop doesn't wait for its image. */
export const usePreloadGroundImages = () => {
  useEffect(() => {
    const imagePromises = GROUND_TYPES.map((groundType) => {
      return new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = () => {
          console.warn(`Failed to preload ground image: ${groundType}`);
          resolve(); // A failed image must not block the others.
        };
        img.src = getGroundImagePath(groundType);
      });
    });

    Promise.all(imagePromises).then(() => {});
  }, []);
};
