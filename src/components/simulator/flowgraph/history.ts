import { useCallback, useRef, useState } from "react";

// Undo / redo for the flow editor: snapshots of the whole plot. Consecutive edits with the same
// merge key (typing in one field, dragging one node) are one undo step.

const LIMIT = 200;

export interface History<T> {
  push: (before: T, mergeKey?: string) => void;
  undo: (current: T) => T | null;
  redo: (current: T) => T | null;
  canUndo: boolean;
  canRedo: boolean;
}

export function useHistory<T>(): History<T> {
  const past = useRef<T[]>([]);
  const future = useRef<T[]>([]);
  const lastKey = useRef<{ key: string; at: number } | null>(null);
  const [, bump] = useState(0);
  const tick = () => bump((n) => n + 1);

  const push = useCallback((before: T, mergeKey?: string) => {
    const now = Date.now();
    const merge = mergeKey && lastKey.current?.key === mergeKey && now - lastKey.current.at < 1500;
    lastKey.current = mergeKey ? { key: mergeKey, at: now } : null;
    future.current = [];
    if (!merge) {
      past.current.push(before);
      if (past.current.length > LIMIT) past.current.shift();
    }
    tick();
  }, []);

  const undo = useCallback((current: T) => {
    const prev = past.current.pop();
    if (prev === undefined) return null;
    future.current.push(current);
    lastKey.current = null;
    tick();
    return prev;
  }, []);

  const redo = useCallback((current: T) => {
    const next = future.current.pop();
    if (next === undefined) return null;
    past.current.push(current);
    lastKey.current = null;
    tick();
    return next;
  }, []);

  return { push, undo, redo, canUndo: past.current.length > 0, canRedo: future.current.length > 0 };
}
