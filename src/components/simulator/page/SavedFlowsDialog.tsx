import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, FolderOpen, Pencil, Save, Trash2, TriangleAlert } from "lucide-react";
import type { Scenario } from "../../../simulator";
import { useToast } from "../../ui";
import { cn } from "../../ui/cn";
import { IconButton, KitButton, KitInput, KitLabel } from "../../ui/kit";
import { DialogFrame, ModalDialog } from "../../ui/ModalDialog";
import { loadSavedFlows, MAX_FLOW_NAME, saveFlow, savedFlowSummary, scenarioFromSaved, suggestFlowName, writeSavedFlows, type SavedFlow } from "../savedFlows";

const formatDate = (t: number) => new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * Save the whole scenario (plots, flows, scripts, settings, starting inventory) in this browser, and
 * load, rename or delete earlier saves. `focus` picks what gets focus on open: the name field (Save)
 * or the newest save (Load). Loading and deleting offer Undo toasts instead of confirms.
 */
export const SavedFlowsDialog: React.FC<{ scenario: Scenario; onChange: (sc: Scenario) => void; onClose: () => void; focus: "save" | "load" }> = ({ scenario, onChange, onClose, focus }) => {
  const { toast } = useToast();
  const [list, setList] = useState<SavedFlow[]>(loadSavedFlows);
  const [name, setName] = useState(() => suggestFlowName(list));
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const sorted = useMemo(() => [...list].sort((a, b) => b.modifiedAt - a.modifiedAt), [list]);
  const trimmed = name.trim();
  const existing = list.find((s) => s.name === trimmed) ?? null;

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const first = listRef.current?.querySelector<HTMLElement>("[data-load]");
      if (focus === "load" && first) first.focus();
      else {
        input.current?.focus();
        input.current?.select();
      }
    });
    return () => cancelAnimationFrame(id);
  }, [focus]);

  const refused = () => toast({ title: "Could not save", description: "The browser refused to store it (storage may be full).", variant: "error" });

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmed) {
      setError("Give the save a name");
      input.current?.focus();
      return;
    }
    const next = saveFlow(list, scenario, trimmed);
    if (!next) return refused();
    setList(next);
    onClose();
    toast({ id: "simulator-flows-saved", title: existing ? `Overwrote "${trimmed}"` : `Saved "${trimmed}"`, description: "Saved in this browser. Open it from Flows › Load saved.", variant: "success" });
  };

  const load = (s: SavedFlow) => {
    try {
      const next = scenarioFromSaved(scenario, s);
      const before = scenario;
      onChange(next);
      onClose();
      toast({
        id: "simulator-flows-loaded",
        title: `Loaded "${s.name}"`,
        description: "Replaced your plots, flows, settings and starting inventory.",
        variant: "success",
        duration: 6000,
        action: { label: "Undo", onClick: () => onChange(before) },
      });
    } catch (err) {
      toast({ title: "Could not load", description: err instanceof Error ? err.message : String(err), variant: "error" });
    }
  };

  const remove = (s: SavedFlow) => {
    const next = list.filter((x) => x.id !== s.id);
    if (!writeSavedFlows(next)) return refused();
    setList(next);
    toast({
      id: "simulator-flows-deleted",
      title: `Deleted "${s.name}"`,
      variant: "success",
      duration: 6000,
      action: {
        label: "Undo",
        onClick: () => {
          const now = loadSavedFlows();
          if (now.some((x) => x.id === s.id)) return;
          const back = [...now, s];
          if (writeSavedFlows(back)) setList(back);
        },
      },
    });
  };

  const rename = (s: SavedFlow, to: string): string | null => {
    if (list.some((x) => x.name === to && x.id !== s.id)) return "Another save already has this name";
    const next = list.map((x) => (x.id === s.id ? { ...x, name: to, modifiedAt: Date.now() } : x));
    if (!writeSavedFlows(next)) {
      refused();
      return null;
    }
    setList(next);
    return null;
  };

  return (
    <ModalDialog labelledBy="saved-flows-title" onClose={onClose} maxWidth="max-w-xl">
      <DialogFrame
        id="saved-flows-title"
        title="Saved flows"
        onClose={onClose}
        footer={
          <>
            <span className="mr-auto self-center text-meta text-fg-meta">Stored in this browser only. Export a file to move flows to another device.</span>
            <KitButton variant="ghost" size="md" onClick={onClose}>
              Close
            </KitButton>
          </>
        }
      >
        <div className="space-y-4">
          <form onSubmit={save}>
            <label htmlFor="saved-flow-name" className="mb-1.5 block text-secondary font-medium text-fg-body">
              Save current flows as
            </label>
            <div className="flex gap-2">
              <KitInput
                ref={input}
                id="saved-flow-name"
                value={name}
                maxLength={MAX_FLOW_NAME}
                autoComplete="off"
                invalid={!!error}
                onChange={(e) => {
                  setName(e.target.value);
                  setError("");
                }}
                placeholder="e.g. Rose Dragon, 3 plots"
                className={cn("h-8 min-w-0 flex-1", existing && !error && "border-warn/60 enabled:hover:border-warn")}
              />
              <KitButton variant="primary" size="md" type="submit">
                <Save /> {existing ? "Overwrite" : "Save"}
              </KitButton>
            </div>
            <div className="mt-1 min-h-5 text-secondary">
              {error ? (
                <p role="alert" className="text-problem">
                  {error}
                </p>
              ) : existing ? (
                <p className="flex items-start gap-1.5 text-warn">
                  <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                  Replaces the save with this name.
                </p>
              ) : (
                <p className="text-fg-meta">
                  {scenario.plots.length} plot{scenario.plots.length === 1 ? "" : "s"}, with settings, player stats and starting inventory.
                </p>
              )}
            </div>
          </form>

          <div>
            <KitLabel className="mb-2">Saved · {list.length}</KitLabel>
            {sorted.length ? (
              <ul ref={listRef} className="scrollbar-dark max-h-[320px] space-y-1.5 overflow-y-auto">
                {sorted.map((s) => (
                  <SavedRow key={s.id} saved={s} onLoad={() => load(s)} onDelete={() => remove(s)} onRename={(to) => rename(s, to)} />
                ))}
              </ul>
            ) : (
              <p className="rounded-control border border-dashed border-line-control px-3 py-6 text-center text-secondary text-fg-muted">Nothing saved yet.</p>
            )}
          </div>
        </div>
      </DialogFrame>
    </ModalDialog>
  );
};

const SavedRow: React.FC<{ saved: SavedFlow; onLoad: () => void; onDelete: () => void; onRename: (name: string) => string | null }> = ({ saved, onLoad, onDelete, onRename }) => {
  const [renaming, setRenaming] = useState(false);
  const [value, setValue] = useState(saved.name);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (renaming) {
      input.current?.focus();
      input.current?.select();
    }
  }, [renaming]);
  const submit = () => {
    const t = value.trim();
    if (!t) return setError("Name cannot be empty");
    if (t !== saved.name) {
      const problem = onRename(t);
      if (problem) return setError(problem);
    }
    setRenaming(false);
    setError("");
  };
  const cancel = () => {
    setRenaming(false);
    setValue(saved.name);
    setError("");
  };
  return (
    <li className="group flex min-w-0 items-center gap-2 rounded-control border border-line bg-surface-card px-3 py-2 transition-colors duration-(--duration-hover) hover:bg-surface-hover">
      <div className="min-w-0 flex-1">
        {renaming ? (
          <>
            <KitInput
              ref={input}
              value={value}
              maxLength={MAX_FLOW_NAME}
              aria-label="Save name"
              invalid={!!error}
              onChange={(e) => {
                setValue(e.target.value);
                setError("");
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancel();
                }
              }}
              onBlur={cancel}
              className="h-7 w-full"
            />
            {error && <p className="mt-1 text-secondary text-problem">{error}</p>}
          </>
        ) : (
          <div className="truncate text-body font-medium text-fg" title={saved.name}>
            {saved.name}
          </div>
        )}
        <div className="truncate text-meta tabular-nums text-fg-meta">
          {savedFlowSummary(saved)} · {formatDate(saved.modifiedAt)}
        </div>
      </div>
      {renaming ? (
        <IconButton aria-label="Save name" onMouseDown={(e) => e.preventDefault()} onClick={submit}>
          <Check />
        </IconButton>
      ) : (
        <>
          <IconButton aria-label={`Rename ${saved.name}`} title="Rename" onClick={() => setRenaming(true)}>
            <Pencil />
          </IconButton>
          <IconButton aria-label={`Delete ${saved.name}`} title="Delete (you can undo it)" className="hover:bg-problem/10 hover:text-problem" onClick={onDelete}>
            <Trash2 />
          </IconButton>
          <KitButton data-load variant="accent" onClick={onLoad} title="Replace your plots, flows, settings and starting inventory with this save">
            <FolderOpen /> Load
          </KitButton>
        </>
      )}
    </li>
  );
};
