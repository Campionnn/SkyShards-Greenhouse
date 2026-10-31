import { describe, expect, it } from "vitest";
import { formatPercent } from "./format";

describe("formatPercent (uptime everywhere: never better than the run was)", () => {
  it("is 100% only when fully up", () => {
    expect(formatPercent(1)).toBe("100%");
    expect(formatPercent(1.2)).toBe("100%");
    expect(formatPercent(0.99999)).toBe("99.9%");
    expect(formatPercent(0.9995)).toBe("99.9%");
  });

  it("is 0% only at exactly zero (or no data)", () => {
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(-0.1)).toBe("0%");
    expect(formatPercent(Number.NaN)).toBe("0%");
    expect(formatPercent(0.0004)).toBe("<0.1%");
    expect(formatPercent(0.001)).toBe("0.1%");
  });

  it("floors to one decimal", () => {
    expect(formatPercent(0.94559)).toBe("94.5%");
    expect(formatPercent(0.945)).toBe("94.5%"); // 0.945 * 1000 is 944.999… in floats
    expect(formatPercent(0.7779)).toBe("77.7%");
    expect(formatPercent(0.5)).toBe("50.0%");
    expect(formatPercent(1 / 3)).toBe("33.3%");
  });

  it("agrees with the uptime ratio of real counts", () => {
    // 10,394 of 10,988 cell-cycles up (594 short): the KPI and the Sustainability card read the same.
    expect(formatPercent(10394 / 10988)).toBe("94.5%");
  });
});
