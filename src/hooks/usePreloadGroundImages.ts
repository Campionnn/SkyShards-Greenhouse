import { useEffect } from "react";
import { preloadAllGreenhouseImages } from "../utilities/imagePreload";

/**
 * Preloads every crop, mutation and ground image on mount so switching layouts, plots
 * or pages never shows an empty tile while an image is fetched.
 */
export const usePreloadGroundImages = () => {
  useEffect(() => {
    void preloadAllGreenhouseImages();
  }, []);
};
