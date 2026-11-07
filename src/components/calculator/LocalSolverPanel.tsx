/** "Solve on this computer" (C11): routes solves to a solver on the user's machine. Owns the setting (localStorage), shows its health and the download link. */
import React, { useCallback, useEffect, useState } from "react";
import { ChevronDown, Download, ExternalLink, RefreshCw } from "lucide-react";
import { cn } from "../ui/cn";
import { InfoHint } from "../ui/InfoHint";
import { ButtonLink, IconButton, KitInput, Switch } from "../ui/kit";
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

/** "Solve locally": routes solves to a solver on the user's machine. Owns the setting (localStorage), shows server health and the download link. */
export const LocalSolverPanel: React.FC = () => {
  const [settings, setSettings] = useState<LocalSolverSettings>(() => loadLocalSolverSettings());
  const [health, setHealth] = useState<LocalSolverHealth | null>(null);
  const [probed, setProbed] = useState(false);
  const [probing, setProbing] = useState(false);
  const [release, setRelease] = useState<LocalSolverRelease | null>(null);
  const [portDraft, setPortDraft] = useState(String(settings.port));
  const [limitDraft, setLimitDraft] = useState(settings.timeLimit === null ? "" : String(settings.timeLimit));

  // Saved outside the state updater: saving fires the settings-changed event (which other listeners
  // turn into state updates), and an updater must stay pure (React may run it during render).
  const update = useCallback(
    (patch: Partial<LocalSolverSettings>) => {
      const next = { ...settings, ...patch };
      setSettings(next);
      saveLocalSolverSettings(next);
    },
    [settings],
  );

  const probe = useCallback(async (port: number) => {
    setProbing(true);
    const result = await probeLocalSolver(port, { force: true });
    setHealth(result);
    setProbed(true);
    setProbing(false);
  }, []);

  // Follow changes made by another tab or component.
  useEffect(() => onLocalSolverSettingsChange(() => setSettings(loadLocalSolverSettings())), []);

  // Release info for the download link and update notice, fetched once.
  useEffect(() => {
    let cancelled = false;
    fetchLatestLocalSolver().then((r) => {
      if (!cancelled) setRelease(r);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Probe while enabled, repeatedly, so the status stays current.
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
      // No upper bound: the solve runs locally.
      const seconds = Math.round(value);
      setLimitDraft(String(seconds));
      if (seconds !== settings.timeLimit) update({ timeLimit: seconds });
    } else {
      setLimitDraft(settings.timeLimit === null ? "" : String(settings.timeLimit));
    }
  }, [limitDraft, settings.timeLimit, update]);

  const updateAvailable = Boolean(health && release && release.version !== "unknown" && health.version !== release.version);


  // One status, in words: off / checking / connected (update) / not running.
  let tone: "off" | "busy" | "ok" | "warn" = "off";
  let statusText = "Off";
  if (settings.enabled) {
    if (!probed || probing) {
      tone = "busy";
      statusText = "Checking…";
    } else if (health) {
      tone = updateAvailable ? "warn" : "ok";
      statusText = updateAvailable ? `Connected, v${health.version} (update: v${release?.version})` : `Connected, v${health.version}`;
    } else {
      tone = "warn";
      statusText = "Not running: solves use the server";
    }
  }
  const short = !settings.enabled ? "off" : tone === "busy" ? "checking" : health ? "connected" : "not running";

  return (
    <details className="group/ls" open={settings.enabled || undefined}>
      <summary className="focus-ring flex min-h-8 cursor-pointer list-none items-center gap-1.5 rounded-inner text-body text-fg-body pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          Solve on this computer
          <InfoHint title="Solve on this computer">
            Run the same solver on your own computer: no queue, and you can give it as long as you like. Layouts that beat the server's cached answer are sent back so everyone
            benefits.
          </InfoHint>
        </span>
        <span className={cn("text-secondary", tone === "ok" ? "text-fg-body" : tone === "warn" ? "text-warn" : "text-fg-meta")} title={statusText}>
          {short}
        </span>
        <ChevronDown aria-hidden className="size-3.5 text-fg-meta transition-transform duration-(--duration-ink) group-open/ls:rotate-180" />
      </summary>
      <div className="space-y-3 pt-2">
        <Switch label="Solve on this computer" checked={settings.enabled} onChange={(enabled) => update({ enabled })}>
          Use the local solver
        </Switch>

        {settings.enabled && (
          <>
            <div className="flex items-center gap-2 text-secondary">
              <span className={cn("min-w-0 flex-1 truncate", tone === "warn" ? "text-warn" : "text-fg-body")} role="status">
                {statusText}
              </span>
              <IconButton size="sm" aria-label="Check again" onClick={() => probe(settings.port)} disabled={probing}>
                <RefreshCw className={probing ? "animate-spin motion-reduce:animate-none" : undefined} />
              </IconButton>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
              <label className="flex min-w-0 flex-col gap-1 text-secondary text-fg-muted">
                Port
                <KitInput
                  size={1}
                  className="w-full min-w-0"
                  type="text"
                  inputMode="numeric"
                  value={portDraft}
                  onChange={(e) => setPortDraft(e.target.value)}
                  onBlur={commitPort}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  placeholder={String(DEFAULT_LOCAL_PORT)}
                />
              </label>
              <label className="flex min-w-0 flex-col gap-1 text-secondary text-fg-muted">
                Time limit (s)
                <KitInput
                  size={1}
                  className="w-full min-w-0"
                  type="text"
                  inputMode="numeric"
                  value={limitDraft}
                  onChange={(e) => setLimitDraft(e.target.value)}
                  onBlur={commitLimit}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  placeholder="default"
                  title="Blank uses the solver's normal budget (30-90 s). Any longer limit is allowed: the solve runs on your machine."
                />
              </label>
            </div>
          </>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <ButtonLink href={release?.download_url ?? "https://github.com/Campionnn/SkyShards-Solver/releases/latest"} target="_blank" rel="noopener noreferrer" size="md">
            <Download /> Download{release ? ` v${release.version}` : ""}
          </ButtonLink>
          <a
            href={release?.repo_url ?? "https://github.com/Campionnn/SkyShards-Solver"}
            target="_blank"
            rel="noopener noreferrer"
            className="focus-ring inline-flex items-center gap-1 rounded-inner text-secondary text-fg-muted hover:text-fg"
          >
            Source (AGPL) <ExternalLink aria-hidden className="size-3" />
          </a>
        </div>

        <ol className="list-inside list-decimal space-y-0.5 text-meta text-fg-meta">
          <li>Install Python 3.10+ (python.org, tick "Add to PATH" on Windows).</li>
          <li>Unzip the download and run start.bat (Windows) or start.sh (Mac/Linux).</li>
          <li>Leave that window open and turn on the switch above. Chrome asks once to allow local network access; Safari may block it.</li>
        </ol>
      </div>
    </details>
  );
};