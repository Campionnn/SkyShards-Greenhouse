import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "./cn";
import { IconButton, KitButton } from "./kit";
import { surface } from "./surface";
import { openModalDialogs, TOAST_MAX, ToastContext, toastDuration, type ToastAction, type ToastContextValue } from "./toastContext";

export type ToastVariant = "success" | "error" | "info" | "warning";

export type ToastOptions = {
  id?: string;
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** Time on screen in ms (paused while hovered, focused or the tab is hidden). Floors below apply. */
  duration?: number;
  action?: ToastAction;
};

export type Toast = Required<Omit<ToastOptions, "id" | "action">> & { id: string; action?: ToastAction };

const EXIT_MS = 150;

// One role colour per kind, as a small icon only (the surface stays the neutral raised one).
const VARIANT: Record<ToastVariant, { icon: React.ReactNode; bar: string }> = {
  success: { icon: <CheckCircle2 className="text-go-fg" />, bar: "bg-go-fg/40" },
  error: { icon: <XCircle className="text-problem" />, bar: "bg-problem/40" },
  warning: { icon: <AlertTriangle className="text-warn" />, bar: "bg-warn/40" },
  info: { icon: <Info className="text-fg-muted" />, bar: "bg-fg-muted/30" },
};

const genId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type Clock = { remaining: number; startedAt: number; timer: number | null };
/** A toast on screen; `stamp` changes when the same id is shown again, restarting its time bar. */
type Shown = Toast & { stamp: number };
let stampSeq = 0;

export const ToastProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [toasts, setToasts] = useState<Shown[]>([]);
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(() => new Set());
  const clocks = useRef<Map<string, Clock>>(new Map());
  const exitTimers = useRef<Map<string, number>>(new Map());
  // The list as of the last change, read synchronously by toast() / dismiss() (state lags a render).
  const toastsRef = useRef<Shown[]>([]);
  const commit = useCallback((next: Shown[]) => {
    toastsRef.current = next;
    setToasts(next);
  }, []);

  // Paused while the pointer is over the stack, focus is inside it, or the tab is hidden.
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(() => typeof document !== "undefined" && document.visibilityState === "hidden");
  const paused = hovered || focused || hidden;
  const pausedRef = useRef(paused);
  // A toast closed from under the pointer (Undo, ×) never fires pointerleave: once the stack is
  // empty, nothing can be hovered or focused, so the next toast must not start paused.
  if (toasts.length === 0 && (hovered || focused)) {
    setHovered(false);
    setFocused(false);
  }

  useEffect(() => {
    const onVisibility = () => setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // While a modal <dialog> is open it is in the browser's top layer, above everything in <body>,
  // and the page behind it is inert: a toast there (an Undo while Load is open) could be neither
  // seen nor clicked. So the stack renders inside the topmost open modal dialog, and moves back to
  // the page when it closes. Same place on screen (position: fixed), same clocks and actions.
  const [host, setHost] = useState<HTMLDialogElement | null>(null);
  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    // Opening order (the last opened is on top); dialogs found on the first look keep DOM order.
    let order: HTMLDialogElement[] = [];
    const update = () => {
      const open = openModalDialogs();
      order = [...order.filter((d) => open.includes(d)), ...open.filter((d) => !order.includes(d))];
      setHost(order[order.length - 1] ?? null);
    };
    update();
    // A dialog opens or closes through its `open` attribute; one removed while open (unmounted) only
    // shows up as a childList change, which matters only while a dialog is open. So on a busy page
    // (the simulator) with no dialog open, node churn costs nothing here.
    const mo = new MutationObserver((records) => {
      if (order.length || records.some((r) => r.type === "attributes")) update();
    });
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
    return () => mo.disconnect();
  }, []);
  // The stack is remounted in its new place: nothing is hovered or focused in it any more, the toasts
  // already on screen don't rise in again, and their time bars carry on where they were.
  const [shownIn, setShownIn] = useState(host);
  const [moves, setMoves] = useState({ count: 0, lastStamp: 0 });
  if (shownIn !== host) {
    setShownIn(host);
    setHovered(false);
    setFocused(false);
    setMoves((m) => ({ count: m.count + 1, lastStamp: stampSeq }));
  }
  /** Time already spent by each time bar, read once per (showing, place) and kept: a style that changed on a running animation would jump. */
  const barDelays = useRef<Map<string, number>>(new Map());
  if (toasts.length === 0 && barDelays.current.size) barDelays.current.clear();
  const elapsedOf = (t: Shown) => {
    const key = `${t.stamp}:${moves.count}`;
    let d = barDelays.current.get(key);
    if (d === undefined) {
      const c = clocks.current.get(t.id);
      d = c ? Math.max(0, t.duration - c.remaining + (c.timer ? Date.now() - c.startedAt : 0)) : 0;
      barDelays.current.set(key, d);
    }
    return d;
  };

  const remove = useCallback((id: string) => {
    const c = clocks.current.get(id);
    if (c?.timer) window.clearTimeout(c.timer);
    clocks.current.delete(id);
    const e = exitTimers.current.get(id);
    if (e) window.clearTimeout(e);
    exitTimers.current.delete(id);
    commit(toastsRef.current.filter((t) => t.id !== id));
    setLeaving((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, [commit]);

  /** Fades the toast out, then removes it. */
  const dismiss = useCallback<ToastContextValue["dismiss"]>(
    (id) => {
      const c = clocks.current.get(id);
      if (c?.timer) window.clearTimeout(c.timer);
      if (c) c.timer = null;
      if (exitTimers.current.has(id) || !toastsRef.current.some((t) => t.id === id)) return;
      setLeaving((prev) => new Set(prev).add(id));
      exitTimers.current.set(id, window.setTimeout(() => remove(id), EXIT_MS));
    },
    [remove]
  );

  const dismissAll = useCallback<ToastContextValue["dismissAll"]>(() => {
    clocks.current.forEach((c) => c.timer && window.clearTimeout(c.timer));
    clocks.current.clear();
    exitTimers.current.forEach((t) => window.clearTimeout(t));
    exitTimers.current.clear();
    commit([]);
    setLeaving(new Set());
  }, [commit]);

  const arm = useCallback(
    (id: string) => {
      const c = clocks.current.get(id);
      if (!c) return;
      if (c.timer) window.clearTimeout(c.timer);
      c.startedAt = Date.now();
      c.timer = window.setTimeout(() => dismiss(id), Math.max(0, c.remaining));
    },
    [dismiss]
  );

  // Pause / resume every running clock.
  useEffect(() => {
    pausedRef.current = paused;
    const now = Date.now();
    clocks.current.forEach((c, id) => {
      if (exitTimers.current.has(id)) return;
      if (paused) {
        if (c.timer) {
          window.clearTimeout(c.timer);
          c.timer = null;
          c.remaining -= now - c.startedAt;
        }
      } else if (!c.timer) arm(id);
    });
  }, [paused, arm]);

  useEffect(
    () => () => {
      clocks.current.forEach((c) => c.timer && window.clearTimeout(c.timer));
      exitTimers.current.forEach((t) => window.clearTimeout(t));
    },
    []
  );

  const toast = useCallback<ToastContextValue["toast"]>(
    (opts) => {
      const description = opts.description ?? "";
      const variant: ToastVariant = opts.variant ?? "info";
      // The same message again (without an id) restarts the one on screen instead of stacking a copy.
      const same = opts.id ? undefined : toastsRef.current.find((t) => t.title === opts.title && t.description === description && t.variant === variant);
      const id = opts.id ?? same?.id ?? genId();
      const duration = toastDuration(opts);
      const entry: Shown = { id, title: opts.title, description, variant, duration, action: opts.action, stamp: ++stampSeq };

      const exit = exitTimers.current.get(id);
      if (exit) {
        window.clearTimeout(exit);
        exitTimers.current.delete(id);
        setLeaving((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
      const old = clocks.current.get(id);
      if (old?.timer) window.clearTimeout(old.timer);

      const kept = toastsRef.current.filter((t) => t.id !== id);
      const dropped = kept.length >= TOAST_MAX ? kept.slice(0, kept.length - TOAST_MAX + 1) : [];
      for (const t of dropped) {
        const c = clocks.current.get(t.id);
        if (c?.timer) window.clearTimeout(c.timer);
        clocks.current.delete(t.id);
      }
      commit([...kept.slice(dropped.length), entry]);

      clocks.current.set(id, { remaining: duration, startedAt: Date.now(), timer: null });
      if (!pausedRef.current) arm(id);
      return id;
    },
    [arm, commit]
  );

  const value = useMemo<ToastContextValue>(() => ({ toast, dismiss, dismissAll }), [toast, dismiss, dismissAll]);

  // Phones: top, so the stack never covers a bottom action bar. md+: bottom-right, above the bottom ad.
  // Sized in vw, not with left+right insets: a page that overflows sideways widens the layout
  // viewport, and an inset-x box would grow with it (and keep the overflow). 100vw is the initial
  // containing block's width here (mobile viewport), so the stack always fits it. Inside a modal
  // dialog the same fixed box lands in the same place (the dialog has no transform).
  const stack = (
      <section
        aria-label="Notifications"
        className="pointer-events-none fixed top-2 left-2 z-(--z-toast) flex w-[calc(100vw-1rem)] md:top-auto md:right-3 md:bottom-(--toast-bottom) md:left-auto md:w-[min(380px,calc(100vw-1.5rem))] md:justify-end"
        style={{ ["--toast-bottom" as string]: "calc(var(--ad-bottom, 0px) + 12px)" }}
      >
        {/* One persistent polite live region (it must exist before a toast lands in it to be announced);
            an error is its own role=alert, the nearest live region for its text, so it is read at once. */}
        <div
          role="status"
          aria-live="polite"
          className="flex w-full min-w-0 flex-col-reverse gap-2 md:flex-col"
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
          onFocus={() => setFocused(true)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
          }}
        >
          {toasts.map((t) => {
            const v = VARIANT[t.variant];
            const out = leaving.has(t.id);
            return (
              <div
                key={t.id}
                role={t.variant === "error" ? "alert" : undefined}
                aria-atomic="true"
                className={cn(
                  surface.raised,
                  "pointer-events-auto relative overflow-hidden py-2.5 pr-2 pl-3 transition-opacity duration-(--duration-pop) ease-snappy",
                  out ? "opacity-0" : t.stamp > moves.lastStamp && "kit-rise-in"
                )}
              >
                <div className="flex items-start gap-2.5 pointer-coarse:items-center">
                  <span className="mt-0.5 flex shrink-0 pointer-coarse:mt-0 [&>svg]:h-4 [&>svg]:w-4" aria-hidden>
                    {v.icon}
                  </span>
                  <div className="min-w-0 flex-1 py-px">
                    <div className="text-body font-medium break-words text-fg">{t.title}</div>
                    {t.description && <div className="mt-0.5 text-secondary break-words whitespace-pre-wrap text-fg-muted">{t.description}</div>}
                  </div>
                  {/* 44px on touch screens: the visible box, not only the hit area (the card clips overflow). */}
                  {t.action && (
                    <KitButton
                      variant="neutral"
                      className="shrink-0 pointer-coarse:h-11 pointer-coarse:px-4 pointer-coarse:text-body"
                      onClick={() => {
                        t.action!.onClick();
                        dismiss(t.id);
                      }}
                    >
                      {t.action.label}
                    </KitButton>
                  )}
                  <IconButton aria-label="Dismiss notification" title="Dismiss" className="shrink-0 pointer-coarse:size-11" onClick={() => dismiss(t.id)}>
                    <X />
                  </IconButton>
                </div>
                {/* Time left. Hidden for reduced motion; pauses with the clock. */}
                <div
                  key={`${t.stamp}:${moves.count}`}
                  aria-hidden
                  className={cn("absolute bottom-0 left-0 h-0.5 w-full origin-left motion-reduce:hidden", v.bar)}
                  style={{
                    animationName: "toast-time-left",
                    animationDuration: `${t.duration}ms`,
                    animationDelay: `-${elapsedOf(t)}ms`,
                    animationTimingFunction: "linear",
                    animationFillMode: "forwards",
                    animationPlayState: paused ? "paused" : "running",
                  }}
                />
              </div>
            );
          })}
        </div>
      </section>
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {host ? createPortal(stack, host) : stack}
      <style>{"@keyframes toast-time-left { from { transform: scaleX(1); } to { transform: scaleX(0); } }"}</style>
    </ToastContext.Provider>
  );
};
