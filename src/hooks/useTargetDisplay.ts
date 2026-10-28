import { useCallback, useState } from "react";
import type { TargetDisplay } from "../constants";
import { LocalStorageManager } from "../utilities/localStorageManager";

/** How grids draw target mutations (solid / faded / hidden), remembered across visits and shared by the Calculator and Designer. */
export function useTargetDisplay(): [TargetDisplay, (display: TargetDisplay) => void] {
  const [display, setDisplay] = useState<TargetDisplay>(() => LocalStorageManager.loadTargetDisplay());
  const set = useCallback((next: TargetDisplay) => {
    setDisplay(next);
    LocalStorageManager.saveTargetDisplay(next);
  }, []);
  return [display, set];
}

/**
 * Whether grids draw input crops (planted crops and placed items). Hidden inputs leave only their
 * ground, so with targets hidden too the grid shows just the ground. Remembered like the target display.
 */
export function useInputsVisible(): [boolean, (visible: boolean) => void] {
  const [visible, setVisible] = useState<boolean>(() => !LocalStorageManager.loadInputsHidden());
  const set = useCallback((next: boolean) => {
    setVisible(next);
    LocalStorageManager.saveInputsHidden(!next);
  }, []);
  return [visible, set];
}
