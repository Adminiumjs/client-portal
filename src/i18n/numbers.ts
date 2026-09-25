import type { LocaleTag } from "./locales.ts";

/**
 * A number said inside a sentence, in the page's own digits.
 *
 * Money and dates already come out of `Intl` in the locale, so an Arabic page
 * reads "٦٬٩٣٧٫٥٠" — and a count dropped into a sentence as `String(47)` would
 * sit beside it in Latin digits. Every numeric parameter goes through the
 * locale's number format instead. Without grouping, so a year, an id or a
 * code keeps its shape ("2026", never "2,026"), and with every fraction digit
 * the number has, so nothing is rounded on its way into words. In English the
 * result is exactly `String(n)` for every finite number below 1e21
 * (`digits.test.tsx` checks it over every message).
 */
export function paramFormatter(locale: LocaleTag): (value: string | number) => string {
  const nf = new Intl.NumberFormat(locale, { useGrouping: false, maximumFractionDigits: 20 });
  return (value) => {
    if (typeof value !== "number") return value;
    if (!Number.isFinite(value) || Math.abs(value) >= 1e21) return String(value);
    return nf.format(value + 0); // `+ 0` turns -0 into 0, as String() does
  };
}
