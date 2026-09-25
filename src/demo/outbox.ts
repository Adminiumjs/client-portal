/**
 * THE DEMO'S OUTBOX — the emails Adminium makes, holds, judges and sends,
 * played in memory with Adminium's own rules (the manifest's `outbox`).
 *
 *   - MAKING: a row that reaches a producer's moment (an invoice sent, a
 *     payment recorded, a file shared) makes one message of its kind, once —
 *     addressed as the client is now, or to the studio's reply-to for a
 *     studio notice (only while its switch in the settings is on); a batched
 *     kind waits for its window; a reminder of the ladder is HELD for a
 *     person, dated on the invoice's due day plus its ladder's days, at 09:00
 *     on the studio's clock.
 *   - JUDGING (the minute scan, and just before a message goes): a waiting
 *     message is skipped when the row it is about no longer needs it (paid,
 *     void), skipped as overtaken when a later message of its group has come
 *     due, and re-dated when what it is dated by moved.
 *   - A PERSON: approves a held message (it goes now, even before its day),
 *     rewords it while it waits, skips one by hand, queues a failed one again —
 *     and nothing else; what Adminium writes is never a person's.
 *   - SENDING: a queued message whose moment has come is marked sent; a
 *     message whose producer changes something once it is sent does so then
 *     (the third reminder pauses the project).
 *
 * Two things the demo does not do, and says so: it sends nothing anywhere
 * (a sent message is only marked sent), and so it sends to the sample's
 * `.example` addresses, which Adminium itself would skip as reserved; and the
 * sample's rows make messages like the studio's own rows do — Adminium makes
 * none for rows a sample added, but the demo's studio is all sample.
 *
 * DEMO BUILD ONLY.
 */
import type { Id, TableRef } from "../data/types.ts";
import { addDays, venueDay, venueStamp } from "../data/venueTime.ts";
import { empty, holds, Refusal, sameValue, type Engine, type Row, type WriteEvent, type Writer } from "./engine.ts";
import { DEMO_RULES } from "./rules.ts";
import type { OutboxProducerRule, OutboxRule, RowCondition } from "./rulesOf.ts";

/** Why a waiting message is no longer needed. */
export type SkipReason = "overtaken" | "paid" | "void" | "no-longer-needed" | "by-hand";

const SYSTEM: Writer = { origin: "system", name: null, roles: "any" };
const MINUTE = 60_000;
const DEFAULT_WAKE = "09:00";

/** What a producer's `due` says, as the manifest writes it. */
interface DueSpec {
  date: string;
  days: number | { setting: { addOn: string; setting: string } | string; byColumn?: string; index?: number } | { values: Record<string, number>; byColumn: string };
  at?: string;
}

type Producer = OutboxProducerRule & { onCreate?: { table: string; via?: string; where?: RowCondition }; recipient?: { setting: { table: string; column: string } } };

export interface OutboxOptions {
  engine: () => Engine;
  now: () => number;
  zone: string;
  settings: () => Readonly<Record<string, unknown>>;
}

export interface Outbox {
  /** The producers, told of every write the engine stored. */
  produce(event: WriteEvent): void;
  /** The person's moves on a message, judged before the write (the engine's before hook). */
  judgeMove(table: TableRef, stored: Row, values: Record<string, unknown>, writer: Writer): void;
  /** The minute scan: reminders made that went missing, then every waiting message judged. */
  scan(): void;
  /** The sender: every queued message whose moment has come, judged once more and sent. */
  send(): void;
}

export function createOutbox(opts: OutboxOptions): Outbox {
  const box = DEMO_RULES.outbox as OutboxRule;
  const cols = box.columns;
  const producers = box.producers as Producer[];
  const table = box.table as TableRef;
  const rows = () => opts.engine().rows;
  const find = (ref: string, id: unknown) => opts.engine().find(ref as TableRef, id);
  const referencedBy = (from: string, column: string): string | undefined => DEMO_RULES.references[from]?.[column];
  const producerOf = (kind: unknown) => producers.find((producer) => producer.kind === kind);
  const sourceOf = (producer: Producer) => producer.onCreate ?? producer.onChange!;

  // ── timing ──

  /** A setting a producer reads (`{addOn, setting}` → `invoices.ladders`), JSON text read as JSON. */
  function settingValue(name: { addOn: string; setting: string } | string): unknown {
    const value = opts.settings()[typeof name === "string" ? name : `${name.addOn}.${name.setting}`];
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  }

  function daysFor(days: DueSpec["days"], row: Row): number | null {
    if (typeof days === "number") return days;
    if ("values" in days) {
      const pick = row[days.byColumn];
      return pick === null || pick === undefined ? null : wholeDays(days.values[String(pick)]);
    }
    let value = settingValue(days.setting);
    if (days.byColumn !== undefined) {
      const pick = row[days.byColumn];
      value = pick === null || pick === undefined || typeof value !== "object" || value === null || Array.isArray(value) ? undefined : (value as Record<string, unknown>)[String(pick)];
    }
    if (days.index !== undefined) value = Array.isArray(value) ? (value as unknown[])[days.index] : undefined;
    return wholeDays(value);
  }

  /** The moment a dated message is due: its row's day plus its days, at its wake-up time on the studio's clock. */
  function dueFor(due: DueSpec, row: Row): number | null {
    const raw = row[due.date];
    if (empty(raw)) return null;
    const text = String(raw);
    const day = /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : venueDay(Date.parse(text), opts.zone);
    const days = daysFor(due.days, row);
    if (days === null) return null;
    return venueStamp(addDays(day, days), due.at ?? DEFAULT_WAKE, opts.zone);
  }

  const instantOf = (value: unknown): number | null => {
    if (empty(value)) return null;
    const at = Date.parse(String(value));
    return Number.isNaN(at) ? null : at;
  };

  function dropReason(conditions: Producer["dropWhen"], row: Row | undefined): SkipReason | null {
    if (conditions === undefined || row === undefined) return null;
    for (const condition of conditions) {
      const value = row[condition.column];
      let met: boolean;
      if (condition.eq !== undefined) met = sameValue(condition.eq, value);
      else if (empty(value) || !Number.isFinite(Number(value))) met = false;
      else met = condition.lte !== undefined ? Number(value) <= condition.lte : condition.gte !== undefined ? Number(value) >= condition.gte : false;
      if (met) return condition.reason as SkipReason;
    }
    return null;
  }

  /** Whether a message of a supersede group has come due: sent or tried, or waiting with its moment passed. */
  function cameDue(status: unknown, due: unknown, now: number): boolean {
    if (status === "sent" || status === "failed") return true;
    if (status !== "held" && status !== "queued") return false;
    const at = instantOf(due);
    return at !== null && at <= now;
  }

  function groupRanks(group: string): Map<string, number> {
    const ranks = new Map<string, number>();
    for (const producer of producers) if (producer.supersede === group && !ranks.has(producer.kind)) ranks.set(producer.kind, ranks.size);
    return ranks;
  }

  // ── addressing ──

  /** The row a message is about: the source row, or — a child source — the row its foreign key names. */
  function aboutOf(producer: Producer, source: Row, sourceTable: string): { table: string; row: Row } | null {
    const via = sourceOf(producer).via;
    if (via === undefined) return { table: sourceTable, row: source };
    const target = referencedBy(sourceTable, via);
    const parent = target === undefined ? undefined : find(target, source[via]);
    return target === undefined || parent === undefined ? null : { table: target, row: parent };
  }

  /** The links a message carries, filled from the row it is about and one hop past it. */
  function fillLinks(about: { table: string; row: Row }, values: Record<string, unknown>, own: string): void {
    const recipient = box.recipient;
    const columns = [...new Set([...Object.values(box.links), recipient.via, ...(recipient.fallback === undefined ? [] : [recipient.fallback.via])])].filter((c) => c !== own);
    const from = (tableName: string, row: Row, column: string): unknown => {
      if (column in row && !empty(row[column])) return row[column];
      const target = referencedBy(box.table, column);
      if (target === undefined) return undefined;
      const keys = Object.entries(DEMO_RULES.references[tableName] ?? {}).filter(([, to]) => to === target);
      if (keys.length > 1) return null;
      const value = keys.length === 1 ? row[keys[0]![0]] : undefined;
      return empty(value) ? undefined : value;
    };
    const ambiguous = new Set<string>();
    for (const column of columns) {
      const value = from(about.table, about.row, column);
      if (value === null) ambiguous.add(column);
      else if (value !== undefined) values[column] = value;
    }
    for (const column of columns) {
      if (!empty(values[column]) || ambiguous.has(column)) continue;
      for (const link of [own, ...columns]) {
        if (link === column || empty(values[link])) continue;
        const target = referencedBy(box.table, link);
        const row = target === undefined ? undefined : find(target, values[link]);
        if (target === undefined || row === undefined) continue;
        const value = from(target, row, column);
        if (value !== null && value !== undefined) {
          values[column] = value;
          break;
        }
      }
    }
  }

  /** Where a message goes, as the person is now: a setting's address, the client, else the enquiry's. */
  function addressFor(producer: Producer | undefined, values: Record<string, unknown>): { address: string | null; language: string | null } {
    if (producer?.recipient !== undefined) {
      const settings = rows()[producer.recipient.setting.table as TableRef]?.[0];
      const address = settings?.[producer.recipient.setting.column];
      return { address: empty(address) ? null : String(address), language: null };
    }
    const recipient = box.recipient;
    const person = find(recipient.table, values[recipient.via]);
    if (person !== undefined && !empty(person[recipient.email])) {
      const language = recipient.language === undefined ? null : (person[recipient.language] as string | null);
      return { address: String(person[recipient.email]), language: empty(language) ? null : language };
    }
    const fallback = recipient.fallback;
    if (fallback !== undefined) {
      const target = referencedBy(box.table, fallback.via);
      const row = target === undefined ? undefined : find(target, values[fallback.via]);
      if (row !== undefined && !empty(row[fallback.email])) return { address: String(row[fallback.email]), language: null };
    }
    return { address: null, language: null };
  }

  /** A studio notice goes only while its switch is on: a settings row, and none of them off. */
  function switchedOn(gate: Producer["gate"]): boolean {
    if (gate === undefined) return true;
    const list = rows()[gate.setting.table as TableRef] ?? [];
    return list.length > 0 && list.every((row) => sameValue(true, row[gate.setting.column]));
  }

  // ── making ──

  /** One message for one row, once. Returns whether it is waiting to go. */
  function queue(producer: Producer, source: Row, sourceTable: string): boolean {
    const about = aboutOf(producer, source, sourceTable);
    if (about === null) return false;
    if (!switchedOn(producer.gate)) return false;
    const now = opts.now();
    const link = producer.link;
    // The log is the dedupe; a batched kind takes a later one into the message still waiting for its window.
    const seen = rows()[table].some((message) => {
      if (message[cols.kind!] !== producer.kind || String(message[link]) !== String(about.row.id)) return false;
      if (producer.batchMinutes === undefined) return true;
      const due = instantOf(message[cols.due!]);
      return (message[cols.status!] === "queued" || message[cols.status!] === "held") && due !== null && due > now;
    });
    if (seen) return false;
    const values: Record<string, unknown> = { [cols.kind!]: producer.kind, [link]: about.row.id };
    fillLinks(about, values, link);
    let due: number | null = null;
    if (producer.batchMinutes !== undefined) due = now + producer.batchMinutes * MINUTE;
    else if (producer.due !== undefined) due = dueFor(producer.due as DueSpec, about.row);
    if (due !== null) values[cols.due!] = new Date(due).toISOString();
    const addressed = addressFor(producer, values);
    values[cols.to!] = addressed.address;
    if (cols.language !== undefined && addressed.language !== null) values[cols.language] = addressed.language;
    values[cols.status!] = producer.hold === true ? "held" : addressed.address !== null ? "queued" : "skipped";
    if (values[cols.status!] === "skipped" && cols.error !== undefined) values[cols.error] = "No email on file";
    // Adminium's own write: a new message may start held, which a person's could not.
    const written = opts.engine().insert(table, values, { ...SYSTEM, origin: "history" });
    return written[cols.status!] === "queued" || written[cols.status!] === "held";
  }

  function produce(event: WriteEvent): void {
    if (event.table === table) {
      // A person approved a message, or queued one again: it goes now, not at the next sweep.
      if (event.after[cols.status!] === "queued" && event.before?.[cols.status!] !== "queued") send();
      return;
    }
    let queued = false;
    for (const producer of producers) {
      if (producer.onCreate !== undefined) {
        if (event.action !== "create" || producer.onCreate.table !== event.table || (producer.onCreate.where !== undefined && !holds(producer.onCreate.where, event.after))) continue;
      } else if (producer.onChange !== undefined) {
        const change = producer.onChange;
        if (event.action !== "update" || change.table !== event.table || (change.where !== undefined && !holds(change.where, event.after))) continue;
        if (event.before === null) continue;
        const to = Array.isArray(change.to) ? (change.to as unknown[]) : [change.to];
        const value = event.after[change.column];
        if (!to.some((candidate) => sameValue(candidate, value)) || sameValue(event.before[change.column], value)) continue;
      } else continue;
      const made = queue(producer, event.after, event.table);
      queued = (made && producer.hold !== true) || queued;
    }
    if (queued) send();
  }

  // ── judging ──

  interface Verdict {
    skip?: SkipReason;
    due?: number | null;
  }

  function verdictsFor(waiting: readonly Row[], mode: "scan" | "send"): Map<Row, Verdict> {
    const now = opts.now();
    const out = new Map<Row, Verdict>();
    const judged: Row[] = [];
    for (const row of waiting) {
      const producer = producerOf(row[cols.kind!]);
      if (producer === undefined || producer.batchMinutes !== undefined) continue;
      const status = row[cols.status!];
      const due = instantOf(row[cols.due!]);
      const approved = status === "queued" && producer.hold === true;
      const judge =
        mode === "send" ? status === "queued" : status === "held" || (status === "queued" && (approved || (due !== null && due > now) || (due === null && producer.due !== undefined)));
      if (!judge) continue;
      judged.push(row);
      const target = referencedBy(box.table, producer.link);
      const linked = target === undefined ? undefined : find(target, row[producer.link]);
      const reason = dropReason(producer.dropWhen, linked);
      if (reason !== null) {
        out.set(row, { skip: reason });
        continue;
      }
      if (producer.due !== undefined && !approved && linked !== undefined) {
        const next = dueFor(producer.due as DueSpec, linked);
        const moved = next === null ? due !== null : due === null || Math.abs(next - due) >= 1_000;
        if (mode === "send" ? moved && (next === null || next > now) : moved) out.set(row, { due: next });
      }
    }
    // Overtaken: per group and row it is about, the latest-ranked message that has come due takes the place of every earlier one not yet sent.
    const verdictOf = (candidate: Row) => out.get(judged.find((row) => String(row.id) === String(candidate.id)) ?? candidate);
    const dueOf = (candidate: Row): unknown => {
      const verdict = verdictOf(candidate);
      if (verdict?.due !== undefined) return verdict.due === null ? null : new Date(verdict.due).toISOString();
      return candidate[cols.due!];
    };
    const groups = new Set(producers.flatMap((producer) => (producer.supersede === undefined ? [] : [producer.supersede])));
    for (const group of groups) {
      const ranks = groupRanks(group);
      const members = judged.filter((row) => ranks.has(String(row[cols.kind!])) && out.get(row)?.skip === undefined);
      for (const row of members) {
        const producer = producerOf(row[cols.kind!])!;
        const rank = ranks.get(String(row[cols.kind!])) ?? 0;
        const overtaken = rows()[table].some(
          (sibling) =>
            String(sibling.id) !== String(row.id) &&
            ranks.has(String(sibling[cols.kind!])) &&
            sameValue(sibling[producer.link], row[producer.link]) &&
            (ranks.get(String(sibling[cols.kind!])) ?? -1) > rank &&
            verdictOf(sibling)?.skip === undefined &&
            cameDue(sibling[cols.status!], dueOf(sibling), now),
        );
        if (overtaken) out.set(row, { skip: "overtaken" });
      }
    }
    return out;
  }

  /** A verdict written, only while the message still is as it was read. */
  function apply(row: Row, verdict: Verdict): void {
    const values: Record<string, unknown> = {};
    if (verdict.skip !== undefined) {
      values[cols.status!] = "skipped";
      if (cols.skipReason !== undefined) values[cols.skipReason] = verdict.skip;
    } else if (verdict.due !== undefined) values[cols.due!] = verdict.due === null ? null : new Date(verdict.due).toISOString();
    else return;
    opts.engine().update(table, row.id, values, { ...SYSTEM, origin: "history" });
  }

  /** Reminders a watched row should have and has not (an invoice sent while nothing listened): made now, held. */
  function repair(): void {
    for (const producer of producers) {
      if (producer.hold !== true || producer.onChange === undefined || producer.onChange.via !== undefined) continue;
      const change = producer.onChange;
      const states = Array.isArray(change.to) ? (change.to as unknown[]) : [change.to];
      for (const row of [...(rows()[change.table as TableRef] ?? [])]) {
        if (!states.some((state) => sameValue(state, row[change.column]))) continue;
        if (rows()[table].some((message) => message[cols.kind!] === producer.kind && String(message[producer.link]) === String(row.id))) continue;
        if ((change.where !== undefined && !holds(change.where, row)) || dropReason(producer.dropWhen, row) !== null) continue;
        queue(producer, row, change.table);
      }
    }
  }

  function scan(): void {
    repair();
    const waiting = rows()[table].filter((row) => row[cols.status!] === "held" || row[cols.status!] === "queued");
    const verdicts = verdictsFor(waiting, "scan");
    for (const [row, verdict] of verdicts) apply(row, verdict);
  }

  // ── sending ──

  function send(): void {
    const now = opts.now();
    const ready = rows()[table].filter((row) => {
      if (row[cols.status!] !== "queued") return false;
      const due = instantOf(row[cols.due!]);
      return due === null || due <= now;
    });
    if (ready.length === 0) return;
    const verdicts = verdictsFor(ready, "send");
    for (const row of ready) {
      const verdict = verdicts.get(row);
      if (verdict !== undefined) {
        apply(row, verdict);
        continue;
      }
      const producer = producerOf(row[cols.kind!]);
      // A row that names no address goes where its recipient link says, as the person is now.
      let to = row[cols.to!];
      if (empty(to)) to = addressFor(producer, row).address;
      if (empty(to)) {
        opts.engine().update(table, row.id, { [cols.status!]: "skipped", ...(cols.error === undefined ? {} : { [cols.error]: "No email on file" }) }, { ...SYSTEM, origin: "history" });
        continue;
      }
      opts.engine().update(table, row.id, { [cols.status!]: "sent", [cols.to!]: to, ...(cols.sentAt === undefined ? {} : { [cols.sentAt]: new Date(now).toISOString() }) }, { ...SYSTEM, origin: "history" });
      if (producer?.onSent !== undefined) effect(producer, row, now);
    }
  }

  /** What a sent message changes (the third reminder pauses the project), through the ordinary write — or why it could not. */
  function effect(producer: Producer, message: Row, now: number): void {
    const onSent = producer.onSent!;
    const target = referencedBy(box.table, producer.link);
    const about = target === undefined ? undefined : find(target, message[producer.link]);
    let error: string | null = null;
    if (about === undefined) error = "The row this message is about is gone";
    else {
      const id = onSent.via === undefined ? about.id : about[onSent.via];
      if (!empty(id)) {
        if (find(onSent.table, id) === undefined) error = "The row to change is gone";
        else {
          try {
            opts.engine().update(onSent.table as TableRef, id as Id, { ...onSent.set }, SYSTEM);
          } catch (refusal) {
            if (!(refusal instanceof Refusal) || refusal.status >= 500) throw refusal;
            error = refusal.message;
          }
        }
      }
    }
    const values: Record<string, unknown> = {};
    if (cols.effectAt !== undefined) values[cols.effectAt] = new Date(now).toISOString();
    if (cols.effectError !== undefined) values[cols.effectError] = error;
    if (Object.keys(values).length > 0) opts.engine().update(table, message.id, values, { ...SYSTEM, origin: "history" });
  }

  // ── what a person may do to a message ──

  const PERSON_MOVES: Readonly<Record<string, readonly string[]>> = { held: ["queued", "skipped"], queued: ["skipped"], failed: ["queued"] };

  function judgeMove(target: TableRef, stored: Row, values: Record<string, unknown>, writer: Writer): void {
    if (target !== table || writer.origin === "system" || writer.origin === "history") return;
    const refuse = (column: string, message: string, extra: Record<string, unknown> = {}): never => {
      throw new Refusal(409, "STATE_MOVE_REFUSED", message, { column, ...extra });
    };
    const adminiums = [cols.sentAt, cols.approvedBy, cols.effectAt, cols.effectError, cols.skipReason, cols.error].filter((c): c is string => c !== undefined);
    const overrides = [cols.subjectOverride, cols.bodyOverride].filter((c): c is string => c !== undefined);
    const identity = [cols.kind!, ...Object.values(box.links), box.recipient.via, ...(box.recipient.fallback === undefined ? [] : [box.recipient.fallback.via])];
    const has = (column: string) => Object.prototype.hasOwnProperty.call(values, column);
    const moment = (column: string) => column === cols.due || column === cols.sentAt || column === cols.effectAt;
    const same = (a: unknown, b: unknown, instant: boolean) => {
      if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null);
      if (instant) {
        const [x, y] = [instantOf(a), instantOf(b)];
        return x !== null && y !== null && Math.abs(x - y) < 1_000;
      }
      return sameValue(a, b);
    };
    const changed = (column: string | undefined) => column !== undefined && has(column) && !same(values[column], stored[column], moment(column));
    const from = String(stored[cols.status!] ?? "");
    const to = has(cols.status!) && !empty(values[cols.status!]) ? String(values[cols.status!]) : from;

    for (const column of adminiums) {
      if (changed(column)) refuse(column, `"${column}" is written by Adminium, not by hand.`);
      delete values[column];
    }
    for (const column of identity) {
      if (changed(column)) refuse(column, `"${column}" says what the message is and what it is about, so it is fixed once the message is made.`);
    }
    if (from === "sent") {
      const owned = [cols.status!, cols.to!, cols.language, cols.due, ...overrides].filter((c): c is string => c !== undefined);
      const touched = owned.find((column) => changed(column));
      if (touched !== undefined) refuse(touched, "This message was sent, so it stays as it was sent: it is never queued, re-addressed or re-worded again.", { from, to });
      return;
    }
    const producer = producerOf(stored[cols.kind!]);
    const held = producer?.hold === true;
    for (const column of overrides) {
      if (changed(column) && (!held || from !== "held")) refuse(column, "Only a message waiting for approval can be reworded, before or as it is approved.", { from, to });
    }
    if (held && changed(cols.to!)) refuse(cols.to!, "This message goes to the address on file, looked up when it is sent.");
    if (to !== from && !(PERSON_MOVES[from] ?? []).includes(to)) {
      refuse(
        cols.status!,
        to === "sent" || to === "failed" ? "Only Adminium marks a message sent or failed, when it sends it." : `A message that is ${from || "without a status"} can't be made ${to} by hand.`,
        { from, to },
      );
    }
    if (to === from) return;
    if (to === "skipped") {
      if (cols.skipReason !== undefined) values[cols.skipReason] = "by-hand";
      return;
    }
    if (cols.skipReason !== undefined && !empty(stored[cols.skipReason])) values[cols.skipReason] = null;
    if (from !== "held") return;
    if (cols.approvedBy !== undefined) values[cols.approvedBy] = writer.origin === "desk" ? writer.name : null;
    // Approved before its day: it goes now.
    const due = instantOf(has(cols.due!) ? values[cols.due!] : stored[cols.due!]);
    const now = opts.now();
    if (due !== null && due > now) values[cols.due!] = new Date(now).toISOString();
    if (producer === undefined) return;
    const addressed = addressFor(producer, { ...stored, ...values });
    values[cols.to!] = addressed.address;
    if (cols.language !== undefined && addressed.language !== null) values[cols.language] = addressed.language;
  }

  return { produce, judgeMove, scan, send };
}

function wholeDays(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  return Number.isInteger(n) ? n : null;
}
