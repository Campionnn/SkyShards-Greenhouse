import type { SavedLayout } from "../types/layout";

const STORAGE_KEY = "skyshards-designer-designs";

function generateLayoutId(): string {
  return `layout_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/** Shape check on the first entry only. */
function isValidFormat(data: any): data is SavedLayout[] {
  if (!Array.isArray(data)) return false;
  if (data.length === 0) return true;
  
  const firstItem = data[0];
  return (
    'id' in firstItem &&
    'name' in firstItem &&
    'savedAt' in firstItem &&
    'modifiedAt' in firstItem &&
    'inputs' in firstItem &&
    'targets' in firstItem
  );
}

export function saveLayouts(layouts: SavedLayout[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(layouts));
}

/** Saved layouts; empty if missing, unparseable or malformed. */
export function loadLayouts(): SavedLayout[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return [];
    
    const parsed = JSON.parse(data);
    if (!isValidFormat(parsed)) {
      console.warn('[Layout Storage] Data not in expected format');
      return [];
    }
    
    return parsed;
  } catch (error) {
    console.error('[Layout Storage] Error loading layouts:', error);
    return [];
  }
}

export function getLayoutById(id: string): SavedLayout | null {
  const layouts = loadLayouts();
  return layouts.find(l => l.id === id) || null;
}

/** Returns false if no layout had that id. */
export function deleteLayout(id: string): boolean {
  try {
    const layouts = loadLayouts();
    const filtered = layouts.filter(l => l.id !== id);
    
    if (filtered.length === layouts.length) {
      return false;
    }
    
    saveLayouts(filtered);
    return true;
  } catch (error) {
    console.error('[Layout Storage] Error deleting layout:', error);
    return false;
  }
}

export function layoutNameExists(name: string, excludeId?: string): boolean {
  const layouts = loadLayouts();
  return layouts.some(l => l.name === name && l.id !== excludeId);
}

/** Fails if the id is unknown or another layout already has the name. */
export function renameLayout(id: string, newName: string): boolean {
  try {
    const layouts = loadLayouts();
    const layoutIndex = layouts.findIndex(l => l.id === id);
    
    if (layoutIndex === -1) {
      return false;
    }
    
    if (layoutNameExists(newName, id)) {
      console.warn('[Layout Storage] Cannot rename: name already exists');
      return false;
    }
    
    layouts[layoutIndex] = {
      ...layouts[layoutIndex],
      name: newName,
      modifiedAt: Date.now(),
    };
    
    saveLayouts(layouts);
    return true;
  } catch (error) {
    console.error('[Layout Storage] Error renaming layout:', error);
    return false;
  }
}

/** Overwrites a layout, keeping its id and savedAt. */
export function updateLayout(id: string, layout: Omit<SavedLayout, 'id' | 'savedAt'>): boolean {
  try {
    const layouts = loadLayouts();
    const layoutIndex = layouts.findIndex(l => l.id === id);
    
    if (layoutIndex === -1) {
      return false;
    }
    
    layouts[layoutIndex] = {
      ...layout,
      id,
      savedAt: layouts[layoutIndex].savedAt,
      modifiedAt: Date.now(),
    };
    
    saveLayouts(layouts);
    return true;
  } catch (error) {
    console.error('[Layout Storage] Error updating layout:', error);
    return false;
  }
}

export { generateLayoutId };
