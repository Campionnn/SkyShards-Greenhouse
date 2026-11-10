import { describe, expect, it } from "vitest";
import { openModalDialogs, toastDuration, TOAST_ACTION_MIN_MS, TOAST_MIN_MS } from "./toastContext";

// A stand-in for document: openModalDialogs only queries "dialog[open]" and checks :modal.
const fakeRoot = (dialogs: { modal: boolean | "throws" }[]) =>
  ({
    querySelectorAll: (sel: string) => {
      expect(sel).toBe("dialog[open]");
      return dialogs.map((d) => ({
        matches: (q: string) => {
          expect(q).toBe(":modal");
          if (d.modal === "throws") throw new SyntaxError("unsupported");
          return d.modal;
        },
        d,
      }));
    },
  }) as unknown as ParentNode;

describe("openModalDialogs", () => {
  it("keeps modal dialogs in document order and skips non-modal ones", () => {
    const found = openModalDialogs(fakeRoot([{ modal: true }, { modal: false }, { modal: true }])) as unknown as { d: { modal: boolean } }[];
    expect(found.map((x) => x.d.modal)).toEqual([true, true]);
  });

  it("treats every open dialog as modal where :modal is unsupported", () => {
    expect(openModalDialogs(fakeRoot([{ modal: "throws" }]))).toHaveLength(1);
  });

  it("is empty with no open dialog", () => {
    expect(openModalDialogs(fakeRoot([]))).toEqual([]);
  });
});

describe("toastDuration", () => {
  it("floors at 4s, 10s with an action", () => {
    expect(toastDuration({})).toBe(TOAST_MIN_MS);
    expect(toastDuration({ duration: 1000, action: { label: "Undo", onClick: () => {} } })).toBe(TOAST_ACTION_MIN_MS);
    expect(toastDuration({ duration: 20000 })).toBe(20000);
  });
});
