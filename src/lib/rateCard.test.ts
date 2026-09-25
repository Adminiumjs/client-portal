/**
 * The day rate every screen bills and measures by: the rate that is one
 * working day, never one worked out from a half day or a print check.
 */
import { describe, expect, it } from "vitest";

import type { Rate } from "../data/types.ts";
import { dayRateOf } from "./rateCard.ts";

const rate = (id: number, amount: string, hours: string | null, position = id, active = true): Rate => ({ id, label: `r${String(id)}`, amount, hours_per_unit: hours, position, active });

describe("the day rate", () => {
  it("is the rate whose hours are a working day, wherever it sits on the card", () => {
    const card = [rate(2, "400.00", "3", 0), rate(1, "750.00", "6", 1), rate(3, "90.00", null, 2)];
    expect(dayRateOf(card, 6)?.id).toBe(1);
    // However the stored decimal is spelled.
    expect(dayRateOf([rate(4, "780.00", "6.00")], 6)?.id).toBe(4);
  });

  it("is the first such rate in use, in the card's order", () => {
    expect(dayRateOf([rate(1, "700.00", "6", 0, false), rate(2, "720.00", "6", 2), rate(3, "760.00", "6", 1)], 6)?.id).toBe(3);
  });

  it("is none when no rate is a whole working day — never guessed from another", () => {
    expect(dayRateOf([rate(1, "400.00", "3"), rate(2, "90.00", null)], 6)).toBeNull();
    expect(dayRateOf([rate(1, "750.00", "6")], 8)).toBeNull();
    expect(dayRateOf([rate(1, "750.00", "6")], null)).toBeNull();
    expect(dayRateOf([rate(1, "750.00", "6")], 0)).toBeNull();
    expect(dayRateOf([], 6)).toBeNull();
  });
});
