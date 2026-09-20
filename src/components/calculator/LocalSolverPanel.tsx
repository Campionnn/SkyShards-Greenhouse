import React, { useCallback, useEffect, useState } from "react";
import { Cpu, Download, ExternalLink, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import { Panel, ToggleSwitch } from "../ui";
import {
  DEFAULT_LOCAL_PORT,
  fetchLatestLocalSolver,
  loadLocalSolverSettings,
  onLocalSolverSettingsChange,
  probeLocalSolver,
  saveLocalSolverSettings,
} from "../../services";
import type { LocalSolverHealth, LocalSolverRelease, LocalSolverSettings } from "../../services";

const POLL_MS = 10000;

/**
 * "Solve locally": route solves to a solver running on the user's own machine
 * instead of the public API. The panel owns the setting (localStorage), shows
 * whether the local server answers, and hands out the download.
 */
export const LocalSolverPanel: React.FC = () => {
  const [settings, setSettings] = useState<LocalSolverSettings>(() => loadLocalSolverSettings());
  const [collapsed, setCollapsed] = useState(() => !loadLocalSolverSettings().enabled);
  const [health, setHealth] = useState<LocalSolverHealth | null>(null);
  const [probed, setProbed] = useState(false);
  const [probing, setProbing] = useState(false);
  const [release, setRelease] = useState<LocalSolverRelease | null>(null);
  const [portDraft, setPortDraft] = useState(String(settings.port));
  const [limitDraft, setLimitDraft] = useState(settings.timeLimit === null ? "" : String(settings.timeLimit));

  const update = useCallback((patch: Partial<LocalSolverSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveLocalSolverSettings(next);
      return next;
    });
  }, []);

  const probe = useCallback(async (port: number) => {
    setProbing(true);
    const result = await probeLocalSolver(port, { force: true });
    setHealth(result);
    setProbed(true);
    setProbing(false);
  }, []);

  // Keep in sync if another tab/component changes the setting.
  useEffect(() => onLocalSolverSettingsChange(() => setSettings(loadLocalSolverSettings())), []);

  // Release info (for the download link and update notice), once.
  useEffect(() => {
    let cancelled = false;
    fetchLatestLocalSolver().then((r) => {
      if (!cancelled) setRelease(r);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Probe when enabled (and keep probing so the status stays honest).
  useEffect(() => {
    if (!settings.enabled) {
      setHealth(null);
      setProbed(false);
      return;
    }
    probe(settings.port);
    const timer = setInterval(() => probe(settings.port), POLL_MS);
    return () => clearInterval(timer);
  }, [settings.enabled, settings.port, probe]);

  const commitPort = useCallback(() => {
    const port = parseInt(portDraft, 10);
    if (Number.isInteger(port) && port > 0 && port < 65536) {
      if (port !== settings.port) update({ port });
    } else {
      setPortDraft(String(settings.port));
    }
  }, [portDraft, settings.port, update]);

  const commitLimit = useCallback(() => {
    const text = limitDraft.trim();
    if (text === "") {
      if (settings.timeLimit !== null) update({ timeLimit: null });
      return;
    }
    const value = Number(text);
    if (Number.isFinite(value) && value > 0) {
      // No ceiling: the solve runs on this machine, so the limit is the user's call.
      const seconds = Math.round(value);
      setLimitDraft(String(seconds));
      if (seconds !== settings.timeLimit) update({ timeLimit: seconds });
    } else {
      setLimitDraft(settings.timeLimit === null ? "" : String(settings.timeLimit));
    }
  }, [limitDraft, settings.timeLimit, update]);

  const updateAvailable = Boolean(health && release && release.version !== "unknown" && health.version !== release.version);

  let statusDot = "bg-slate-500";
  let statusText = "Off";
  if (settings.enabled) {
    if (!probed || probing) {
      statusDot = "bg-amber-400 animate-pulse";
      statusText = "Checking...";
    } else if (health) {
      statusDot = updateAvailable ? "bg-amber-400" : "bg-emerald-400";
      statusText = updateAvailable ? `Connected, v${health.version} (update: v${release?.version})` : `Connected, v${health.version}`;
    } else {
      statusDot = "bg-rose-400";
      statusText = "Not running (solves use the server)";
    }
  }

  return (
    <Panel
      title="Local solver"
      icon={<Cpu />}
      actions={
        <>
          <span className="flex items-center gap-1.5 text-[11px] text-slate-400" title={statusText}>
            <span className={`inline-block w-2 h-2 rounded-full ${statusDot}`} />
            <span className="truncate max-w-[140px]">{settings.enabled ? (health ? "connected" : probing || !probed ? "checking" : "not running") : "off"}</span>
          </span>
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="p-1 hover:bg-slate-600/50 rounded text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
            title={collapsed ? "Show local solver options" : "Hide local solver options"}
            aria-expanded={!collapsed}
          >
            {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        </>
      }
      description={
        collapsed
          ? undefined
          : "Run the same solver on your own computer: no queue, and you can give it as long as you like. Layouts that beat the server's cached answer are sent back so everyone benefits."
      }
    >
      {!collapsed && (
        <div className="space-y-3">
          <ToggleSwitch
            label="Solve on this computer"
            checked={settings.enabled}
            onChange={(enabled) => update({ enabled })}
            id="local-solver-toggle"
          />

          {settings.enabled && (
            <>
              <div className="flex items-center gap-2 text-xs">
                <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${statusDot}`} />
                <span className="text-slate-300 flex-1 min-w-0 truncate">{statusText}</span>
                <button
                  onClick={() => probe(settings.port)}
                  disabled={probing}
                  className="p-1 hover:bg-slate-600/50 rounded text-slate-400 hover:text-slate-200 transition-colors cursor-pointer disabled:opacity-50"
                  title="Check again"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${probing ? "animate-spin" : ""}`} />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-slate-400 flex flex-col gap-1">
                  Port
                  <input
                    type="text"
                    inputMode="numeric"
                    value={portDraft}
                    onChange={(e) => setPortDraft(e.target.value)}
                    onBlur={commitPort}
                    onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                    placeholder={String(DEFAULT_LOCAL_PORT)}
                    className="px-2 py-1 bg-slate-700/50 border border-slate-600/30 rounded text-xs text-slate-200 focus:outline-none focus:border-blue-500/50"
                  />
                </label>
                <label className="text-xs text-slate-400 flex flex-col gap-1">
                  Time limit (s)
                  <input
                    type="text"
                    inputMode="numeric"
                    value={limitDraft}
                    onChange={(e) => setLimitDraft(e.target.value)}
                    onBlur={commitLimit}
                    onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                    placeholder="default"
                    title="Blank uses the solver's normal budget (30-90 s). Any longer limit is allowed: the solve runs on your machine."
                    className="px-2 py-1 bg-slate-700/50 border border-slate-600/30 rounded text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500/50"
                  />
                </label>
              </div>
            </>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <a
              href={release?.download_url ?? "https://github.com/Campionnn/SkyShards-Solver/releases/latest"}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Download{release ? ` v${release.version}` : ""}
            </a>
            <a
              href={release?.repo_url ?? "https://github.com/Campionnn/SkyShards-Solver"}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 transition-colors"
            >
              Source (AGPL) <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          <ol className="text-[11px] text-slate-500 list-decimal list-inside space-y-0.5">
            <li>Install Python 3.10+ (python.org, tick "Add to PATH" on Windows).</li>
            <li>Unzip the download and run start.bat (Windows) or start.sh (Mac/Linux).</li>
            <li>Leave that window open and turn on the switch above. Chrome asks once to allow local network access; Safari may block it.</li>
          </ol>
        </div>
      )}
    </Panel>
  );
};
