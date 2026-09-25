/**
 * What a refused time write says, in this screen's words: Adminium's code (or
 * the desk's own check before anything was sent) and the field it names pick
 * the sentence; anything else gets the shared wording for its reason.
 */
import type { Decimal } from "../../data/types.ts";
import type { TFunction } from "../../i18n/index.tsx";
import type { MessageKey } from "../../i18n/messages/index.ts";
import { refusalKey, type Outcome } from "../../state/outcome.ts";
import { hoursParts } from "./model.ts";

export type Refused = Extract<Outcome<unknown>, { ok: false }>;

/** Which field of the form a refusal belongs beside, or null for the whole form. */
export type TimeField = "hours" | "note" | "date" | null;

export interface Words {
  key: MessageKey;
  field: TimeField;
}

const BY_CODE: Record<string, Words> = {
  HOURS_OUT_OF_RANGE: { key: "time.error.hours", field: "hours" },
  HOURS_NOT_A_NUMBER: { key: "time.error.hoursNumber", field: "hours" },
  NOTE_REQUIRED: { key: "time.error.note", field: "note" },
  CLOCK_TOO_LONG: { key: "time.error.tooLong", field: "hours" },
  CLOCK_NOT_RUNNING: { key: "time.error.notRunning", field: null },
  ALREADY_INVOICED: { key: "time.error.invoiced", field: null },
  RATE_NOT_A_NUMBER: { key: "time.error.noRate", field: null },
  NO_DAY_RATE: { key: "time.error.noDayRate", field: null },
  DATE_NOT_A_DAY: { key: "time.error.date", field: "date" },
};

/** The sentence for a refused time write. */
export function refusalWords(out: Refused): Words {
  const known = BY_CODE[out.code];
  if (known !== undefined) return known;
  // A second clock for the same person: Adminium keeps one running clock a person.
  if (out.reason === "duplicate") return { key: "time.error.clockRunning", field: null };
  // Adminium's own checks name the column they refused.
  if (out.reason === "invalid" && out.field === "hours") return { key: "time.error.hours", field: "hours" };
  if (out.reason === "invalid" && out.field === "note") return { key: "time.error.note", field: "note" };
  if (out.reason === "invalid" && out.field === "date") return { key: "time.error.date", field: "date" };
  return { key: refusalKey(out.reason), field: null };
}

/** Hours as the screen reads them: "3.5 h", or "6 min" under a tenth of an hour. */
export function hoursLabel(t: TFunction, number: (n: number, opts?: Intl.NumberFormatOptions) => string, hours: Decimal | number | null): string {
  const { unit, value } = hoursParts(hours ?? 0);
  return unit === "min" ? t("time.minutes", { m: number(value) }) : t("time.hours", { h: number(value, { maximumFractionDigits: 2 }) });
}
