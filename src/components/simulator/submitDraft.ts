/**
 * The Submit-to-leaderboard dialog's unsent fields, kept in sessionStorage so a Discord login
 * (a full-page redirect that comes back to /simulator in the same tab) doesn't wipe them. A
 * `reopen` flag set just before the redirect makes the simulator open the dialog again on return.
 * Lives outside SubmitFlowDialog.tsx because that module is lazy-loaded.
 */
import type { Board } from "../../leaderboard/rules";

const KEY = "skyshards-submit-draft";

export interface SubmitDraft {
  title: string;
  description: string;
  boards: Board[];
  cycles: number;
  /** Open the dialog again on the next simulator load (set right before the login redirect). */
  reopen?: boolean;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function loadSubmitDraft(): SubmitDraft | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<SubmitDraft>;
    return {
      title: typeof d.title === "string" ? d.title : "",
      description: typeof d.description === "string" ? d.description : "",
      boards: Array.isArray(d.boards) ? d.boards.filter((b): b is Board => b === "ironman" || b === "normal") : [],
      cycles: typeof d.cycles === "number" && Number.isFinite(d.cycles) ? d.cycles : NaN,
      reopen: d.reopen === true,
    };
  } catch {
    return null;
  }
}

export function saveSubmitDraft(draft: SubmitDraft): void {
  try {
    storage()?.setItem(KEY, JSON.stringify(draft));
  } catch {
    // Storage full or blocked: losing the draft is acceptable.
  }
}

export function clearSubmitDraft(): void {
  try {
    storage()?.removeItem(KEY);
  } catch {
    // ignore
  }
}

/** True once if the dialog should reopen after a login redirect (clears the flag). */
export function consumeSubmitReopen(): boolean {
  const d = loadSubmitDraft();
  if (!d?.reopen) return false;
  saveSubmitDraft({ ...d, reopen: false });
  return true;
}
