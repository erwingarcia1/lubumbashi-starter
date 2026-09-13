import { describe, expect, it } from "vitest";

import { formatFC } from "@/lib/i18n/format";

const NBSP = " ";

describe("formatFC", () => {
  it("groups thousands with a no-break space and appends FC", () => {
    expect(formatFC(15000)).toBe(`15${NBSP}000${NBSP}FC`);
    expect(formatFC(5000)).toBe(`5${NBSP}000${NBSP}FC`);
    expect(formatFC(1500000)).toBe(`1${NBSP}500${NBSP}000${NBSP}FC`);
    expect(formatFC(0)).toBe(`0${NBSP}FC`);
    expect(formatFC(999)).toBe(`999${NBSP}FC`);
  });

  it("never emits the narrow no-break space", () => {
    expect(formatFC(1234567)).not.toContain(" ");
  });

  it("rejects anything that is not a non-negative integer (invariant 9)", () => {
    expect(() => formatFC(1.5)).toThrow(TypeError);
    expect(() => formatFC(-1)).toThrow(TypeError);
    expect(() => formatFC(Number.NaN)).toThrow(TypeError);
  });
});
