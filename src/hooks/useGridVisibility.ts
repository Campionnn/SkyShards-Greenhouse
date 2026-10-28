import { useCallback, useState } from "react";
import { LocalStorageManager } from "../utilities/localStorageManager";

/**
 * Whether grids draw target mutations / input crops. A hidden placement shows only its ground, so
 * with both hidden the grid shows just the ground. Each choice is remembered across visits and
 * shared by the Calculator and Designer.
 */
function useStoredVisibility(load: () => boolean, save: (hidden: boolean) => void): [boolean, (visible: boolean) => void] {
  const [visible, setVisible] = useState<boolean>(() => !load());
  const set = useCallback(
    (next: boolean) => {
      setVisible(next);
      save(!next);
    },
    [save]
  );
  return [visible, set];
}

const loadTargets = () => LocalStorageManager.loadTargetsHidden();
const saveTargets = (hidden: boolean) => LocalStorageManager.saveTargetsHidden(hidden);
const loadInputs = () => LocalStorageManager.loadInputsHidden();
const saveInputs = (hidden: boolean) => LocalStorageManager.saveInputsHidden(hidden);

export function useTargetsVisible(): [boolean, (visible: boolean) => void] {
  return useStoredVisibility(loadTargets, saveTargets);
}

export function useInputsVisible(): [boolean, (visible: boolean) => void] {
  return useStoredVisibility(loadInputs, saveInputs);
}
