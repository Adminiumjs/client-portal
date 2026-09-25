/**
 * Decimals as the database keeps them: exact text at a column's places.
 *
 * Adminium's Postgres answers a `numeric(12,2)` as `"1621.00"`, and every
 * figure it works out is exact at those places — so the demo's figures are
 * kept the same way, as integers of the smallest unit while they are added
 * up, and as decimal text in the rows. Rounding is half away from zero, the
 * rule every one of Adminium's money paths uses.
 */

/** Decimal text (or a number) → an integer at `places`, rounded half away from zero; null when empty or not a number. */
export function toUnits(value: unknown, places: number): bigint | null {
  if (value === null || value === undefined || value === "") return null;
  const text = typeof value === "number" ? (Number.isFinite(value) ? value.toFixed(Math.min(places + 6, 20)) : "") : String(value).trim();
  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text);
  if (match === null) return null;
  const [, sign, whole = "", fraction = ""] = match;
  if (whole === "" && fraction === "") return null;
  const digits = fraction.padEnd(places + 1, "0");
  let units = BigInt(`${whole === "" ? "0" : whole}${digits.slice(0, places)}`);
  if (Number(digits[places] ?? "0") >= 5) units += 1n;
  return sign === "-" ? -units : units;
}

/** An integer at `places` → decimal text: `162100n, 2` → `"1621.00"`. */
export function fromUnits(units: bigint, places: number): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(places + 1, "0");
  const whole = places === 0 ? digits : digits.slice(0, -places);
  const fraction = places === 0 ? "" : `.${digits.slice(-places)}`;
  return `${negative ? "-" : ""}${whole}${fraction}`;
}

/** A value as decimal text at `places`, or null. */
export function atPlaces(value: unknown, places: number): string | null {
  const units = toUnits(value, places);
  return units === null ? null : fromUnits(units, places);
}

/** A decimal with no trailing zeros (`12.5000` → `12.5`, `3.000` → `3`), as a column without a scale spells it. */
export function plainDecimal(value: unknown): string | null {
  const text = atPlaces(value, 12);
  if (text === null) return null;
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}
