import { useCallback, useEffect, useState } from "react";
import type { ProfileMode } from "../simulator";
import { LocalStorageManager } from "../utilities/localStorageManager";

const EVENT = "skyshards-profile-mode";

/**
 * The site-wide profile mode (ironman by default), stored in localStorage so any page can read it.
 * Every hook instance (and other tabs) follows a change.
 */
export function useProfileMode(): [ProfileMode, (mode: ProfileMode) => void] {
  const [mode, setModeState] = useState<ProfileMode>(() => LocalStorageManager.loadProfileMode());

  useEffect(() => {
    const sync = () => setModeState(LocalStorageManager.loadProfileMode());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const setMode = useCallback((next: ProfileMode) => {
    LocalStorageManager.saveProfileMode(next);
    setModeState(next);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return [mode, setMode];
}
