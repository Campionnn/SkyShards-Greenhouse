import { describe, expect, it } from "vitest";
import { liveSkipped } from "./skipped";

describe("liveSkipped", () => {
  it("keeps a skip only while that plot still has its confirmation", () => {
    const store = { 2: "7 Dead Plant", 3: "" };
    expect(liveSkipped(store, (id) => id === 2)).toEqual({ 2: "7 Dead Plant" });
    // Undo, Wrong farm? or Next check-in drop the confirmation, and with it the skip.
    expect(liveSkipped(store, () => false)).toEqual({});
  });
});
