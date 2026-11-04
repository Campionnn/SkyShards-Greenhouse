import { useCallback, useRef, useState } from "react";

// Undo / redo for the flow editor: snapshots of the whole plot, one stack per plot (the editor
// switches plots without remounting, and each keeps its own history). Consecutive edits with the
// same merge key (typing in one field, dragging one node) are one undo step.

const LIMIT = 200;

export interface History<T> {
  push: (before: T, mergeKey?: string) => void;
  undo: (current: T) => T | null;
  redo: (current: T) => T | null;
  canUndo: boolean;
  canRedo: boolean;
}

interface Stack<T> {
  past: T[];
  future: T[];
  lastKey: { key: string; at: number } | null;
}

export function useHistory<T>(scope: string | number = 0): History<T> {
  const stacks = useRef(new Map<string | number, Stack<T>>());
  const [, bump] = useState(0);
  const tick = () => bump((n) => n + 1);
  const get = useCallback(() => {
    let s = stacks.current.get(scope);
    if (!s) stacks.current.set(scope, (s = { past: [], future: [], lastKey: null }));
    return s;
  }, [scope]);

  const push = useCallback(
    (before: T, mergeKey?: string) => {
      const s = get();
      const now = Date.now();
      const merge = mergeKey && s.lastKey?.key === mergeKey && now - s.lastKey.at < 1500;
      s.lastKey = mergeKey ? { key: mergeKey, at: now } : null;
      s.future = [];
      if (!merge) {
        s.past.push(before);
        if (s.past.length > LIMIT) s.past.shift();
      }
      tick();
    },
    [get]
  );

  const undo = useCallback(
    (current: T) => {
      const s = get();
      const prev = s.past.pop();
      if (prev === undefined) return null;
      s.future.push(current);
      s.lastKey = null;
      tick();
      return prev;
    },
    [get]
  );

  const redo = useCallback(
    (current: T) => {
      const s = get();
      const next = s.future.pop();
      if (next === undefined) return null;
      s.past.push(current);
      s.lastKey = null;
      tick();
      return next;
    },
    [get]
  );

  const s = stacks.current.get(scope);
  return { push, undo, redo, canUndo: !!s && s.past.length > 0, canRedo: !!s && s.future.length > 0 };
}
