import { describe, expect, it } from "vitest";

import { formatMoney, isolateMoney, isPositive, minorUnits, sumDecimals } from "./money.ts";

describe("money on screen", () => {
  it("shows each currency with its own minor units", () => {
    expect(minorUnits("USD")).toBe(2);
    expect(minorUnits("jpy")).toBe(0);
    expect(minorUnits("KWD")).toBe(3);
    expect(formatMoney("1950.00", "USD", "en-US")).toBe("$1,950.00");
    expect(formatMoney("1950", "JPY", "en-US")).toBe("¥1,950");
    expect(formatMoney("12.5", "KWD", "en-US")).toContain("12.500");
    expect(formatMoney("1950.5", "EUR", "de-DE").replace(/\s/g, " ")).toBe("1.950,50 €");
  });

  it("shows nothing for a missing amount, never a made-up zero", () => {
    expect(formatMoney(null, "USD", "en-US")).toBe("");
    expect(formatMoney("", "USD", "en-US")).toBe("");
  });

  it("adds stored amounts exactly, in whole minor units", () => {
    expect(sumDecimals(["0.10", "0.20", null, ""])).toBe("0.30");
    expect(sumDecimals(["1950.0000", "325.5000", "-100"])).toBe("2175.50");
    expect(sumDecimals(["12.3456"], 3)).toBe("12.346");
    expect(sumDecimals(["1950"], 0)).toBe("1950");
    expect(sumDecimals([])).toBe("0.00");
  });

  it("knows what is more than nothing", () => {
    expect(isPositive("0.00")).toBe(false);
    expect(isPositive(null)).toBe(false);
    expect(isPositive("0.01")).toBe(true);
  });

  it("keeps an amount's own order inside right-to-left text, and leaves left-to-right text alone", () => {
    const arabic = formatMoney("1621", "USD", "ar-EG");
    expect(isolateMoney(arabic, "rtl")).toBe(`\u2066${arabic}\u2069`);
    expect(isolateMoney("$1,621.00", "ltr")).toBe("$1,621.00");
    expect(isolateMoney("", "rtl")).toBe("");
  });
});
