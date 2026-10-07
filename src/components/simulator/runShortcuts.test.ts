import { describe, expect, it } from "vitest";
import { ownsKeys, runShortcutFor, type ShortcutKey } from "./runShortcuts";

const key = (k: string, mods: Partial<ShortcutKey> = {}): ShortcutKey => ({
  key: k,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...mods,
});

describe("run control shortcuts", () => {
  it("maps step, back, run, stop and undo", () => {
    expect(runShortcutFor(key("ArrowRight"))).toBe("step");
    expect(runShortcutFor(key("."))).toBe("step");
    expect(runShortcutFor(key("ArrowLeft"))).toBe("back");
    expect(runShortcutFor(key(","))).toBe("back");
    expect(runShortcutFor(key("ArrowRight", { shiftKey: true }))).toBe("run");
    expect(runShortcutFor(key(" "))).toBe("toggleRun");
    expect(runShortcutFor(key("Escape"))).toBe("stop");
    expect(runShortcutFor(key("z", { ctrlKey: true }))).toBe("undo");
    expect(runShortcutFor(key("Z", { metaKey: true }))).toBe("undo");
  });

  it("ignores other keys and modifier combinations", () => {
    expect(runShortcutFor(key("a"))).toBeNull();
    expect(runShortcutFor(key("ArrowRight", { altKey: true }))).toBeNull();
    expect(runShortcutFor(key("ArrowRight", { ctrlKey: true }))).toBeNull();
    expect(runShortcutFor(key("z", { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(runShortcutFor(key("ArrowLeft", { shiftKey: true }))).toBeNull();
  });

  it("never claims keys without a DOM target", () => {
    expect(ownsKeys(null, "step")).toBe(false);
  });
});
