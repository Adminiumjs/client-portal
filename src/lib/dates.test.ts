import { describe, expect, it } from "vitest";

import { dayLabel, daysLate, instantLabel } from "./dates.ts";
import { initials } from "./initials.ts";

describe("days and times on screen", () => {
  it("shows a calendar day as that day in every language, never shifted by a zone", () => {
    expect(dayLabel("2026-07-28", "en-US")).toBe("Jul 28");
    expect(dayLabel("2026-07-28", "de-DE", "long")).toBe("28. Juli 2026");
    expect(dayLabel(null, "en-US")).toBe("");
  });

  it("reads an instant on the studio's clock", () => {
    expect(instantLabel("2026-07-28T15:04:00.000Z", "America/New_York", "en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })).toBe("11:04");
  });

  it("counts whole days late, and none before the due day", () => {
    expect(daysLate("2026-07-16", "2026-07-28")).toBe(12);
    expect(daysLate("2026-08-03", "2026-07-28")).toBe(0);
    expect(daysLate(null, "2026-07-28")).toBe(0);
  });

  it("makes initials from a name", () => {
    expect(initials("Amara Osei")).toBe("AO");
    expect(initials("  nadia  ")).toBe("N");
    expect(initials("Élodie Zhang Wei")).toBe("ÉZ");
  });
});
