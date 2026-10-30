import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { Scenario } from "../../../simulator";
import { IconButton, Tabs } from "../../ui/kit";
import { SettingsPanel, type SettingsTab } from "../ScenarioPanels";
import { changedAdvancedSettings } from "./pageHelpers";

// Every setting, in a right-side drawer. No scrim: changing settings is a side task, and the user
// should see the numbers react while it's open. 220ms in, 150ms out (UI-CONVENTIONS.md).

export type DrawerTab = SettingsTab | "scenario";

export const SettingsDrawer: React.FC<{
  open: boolean;
  tab: DrawerTab;
  onTab: (t: DrawerTab) => void;
  onClose: () => void;
  scenario: Scenario;
  onChange: (sc: Scenario) => void;
  cycleSecondsNow?: number;
  /** The Scenario tab (plots, problems, import/export), rendered by the page. */
  scenarioTab: React.ReactNode;
}> = ({ open, tab, onTab, onClose, scenario, onChange, cycleSecondsNow, scenarioTab }) => {
  // Stay mounted for the exit animation.
  const [shown, setShown] = useState(open);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (open) {
      setShown(true);
      setClosing(false);
      return;
    }
    if (!shown) return;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setShown(false);
      return;
    }
    setClosing(true);
    const t = window.setTimeout(() => {
      setShown(false);
      setClosing(false);
    }, 150);
    return () => window.clearTimeout(t);
  }, [open, shown]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!shown) return null;
  const advanced = changedAdvancedSettings(scenario.settings);
  return (
    <aside
      aria-label="Settings"
      style={{ bottom: "var(--ad-bottom, 0px)" }}
      className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-[440px] flex-col border-l border-slate-600/40 bg-slate-900 shadow-[-30px_0_60px_-24px_rgba(0,0,0,0.9)] ${
        closing ? "translate-x-6 opacity-0 transition-[transform,opacity] duration-150 ease-snappy" : "sim-drawer-in"
      }`}
    >
      <div className="flex items-center gap-2.5 px-4 pt-3.5">
        <h2 className="text-[14px] font-semibold text-slate-100">Settings</h2>
        <span className="text-[12px] text-slate-500">Changes restart the run</span>
        <span className="flex-1" />
        <IconButton aria-label="Close settings (Esc)" onClick={onClose}>
          <X />
        </IconButton>
      </div>
      <Tabs<DrawerTab>
        className="mt-2 px-4"
        value={tab}
        onChange={onTab}
        items={[
          { value: "player", label: "Player" },
          { value: "schedule", label: "Online" },
          { value: "policies", label: "Actions" },
          { value: "advanced", label: "Advanced", count: advanced || null },
          { value: "scenario", label: "Scenario" },
        ]}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 scrollbar-dark">
        {tab === "scenario" ? (
          scenarioTab
        ) : (
          <SettingsPanel bare tab={tab} scenario={scenario} onChange={onChange} cycleSecondsNow={cycleSecondsNow} />
        )}
      </div>
    </aside>
  );
};
