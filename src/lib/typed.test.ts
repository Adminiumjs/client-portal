import { describe, expect, it } from "vitest";

import { latinDigits } from "./typed.ts";
import { decimalText } from "../state/officeWrites.ts";
import { positive } from "../sheets/add/spec.ts";
import { rateAmount } from "../screens/settings/model.ts";
import { readAmount } from "../screens/composer/figures.ts";
import { typedNumber } from "../screens/scoping/model.ts";
import { hoursProblem } from "../state/timeActions.ts";

describe("a number typed on an Arabic or Persian keyboard", () => {
  it("reads as the same number", () => {
    expect(latinDigits("٣٫٥")).toBe("3.5");
    expect(latinDigits("١٬٢٥٠٫٧٥")).toBe("1250.75");
    expect(latinDigits("۴۲")).toBe("42");
    expect(latinDigits("12.5 US$")).toBe("12.5 US$");
  });

  it("is taken by every field that reads an amount, a rate or hours", () => {
    expect(decimalText("٧٥٠")).toBe("750");
    expect(positive("٤٠٫٥", 2)).toBe("40.5");
    expect(rateAmount("٧٥٠")).toBe("750.00");
    expect(readAmount("١٬٢٥٠٫٥")).toBe("1250.5");
    expect(typedNumber("٢٫٥", 1)).toBe("2.5");
    expect(hoursProblem("٣٫٢٥")).toBeNull();
    expect(hoursProblem("١٧")).toBe("HOURS_OUT_OF_RANGE");
  });
});
