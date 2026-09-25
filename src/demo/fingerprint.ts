/**
 * An accepted proposal's fingerprint, as the demo's stand-in world seals it.
 *
 * Adminium seals a proposal, when it is accepted (or first signed), with the
 * SHA-256 of what was agreed — its own columns, its lines, and the terms it
 * points at with their clauses — so the client, or anyone later, can work it
 * out again and see nothing changed. The canonical form is Adminium's own,
 * written down there so anyone can repeat it, and repeated here exactly:
 *
 *   { "columns":  { <name>: <value>, … },
 *     "children": [ [ { <name>: <value>, … }, … ], … ],   // in declared order
 *     "linked":   [ { "columns": {…}, "children": [ … ] } | null, … ] }
 *
 *   - keys sorted, JSON with no spaces; lowercase hex of the UTF-8 bytes;
 *   - a decimal with a scale at exactly its places (`12.50`; the row's
 *     currency's own for money), one without and a whole number as digits
 *     with no trailing zeros (`12.5`, `3`) — text either way;
 *   - a boolean `true`/`false`; a date `YYYY-MM-DD`; a moment ISO 8601 UTC;
 *   - text in Unicode NFC; an empty value `null`;
 *   - child rows by their `orderBy` column, then by key.
 *
 * It is written in plain JavaScript, not the browser's `crypto.subtle`, so a
 * write stays one synchronous step, exactly as the server's is one
 * transaction. `fingerprint.test.ts` holds it to Node's own SHA-256.
 */
import { atPlaces, plainDecimal } from "./decimal.ts";

// ── SHA-256 (FIPS 180-4), over UTF-8 bytes ───────────────────────────────────

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256Hex(text: string): string {
  const data = new TextEncoder().encode(text);
  const bits = data.length * 8;
  const padded = new Uint8Array(Math.ceil((data.length + 9) / 64) * 64);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bits / 0x100000000));
  view.setUint32(padded.length - 4, bits >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const a = w[i - 15]!;
      const b = w[i - 2]!;
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!];
    for (let i = 0; i < 64; i += 1) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0]! + a) >>> 0;
    h[1] = (h[1]! + b) >>> 0;
    h[2] = (h[2]! + c) >>> 0;
    h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0;
    h[5] = (h[5]! + f) >>> 0;
    h[6] = (h[6]! + g) >>> 0;
    h[7] = (h[7]! + hh) >>> 0;
  }
  return [...h].map((word) => word.toString(16).padStart(8, "0")).join("");
}

// ── the canonical form ──────────────────────────────────────────────────────

export interface HashChild {
  table: string;
  via: string;
  columns: string[];
  orderBy?: string;
}

export interface HashOf {
  columns: string[];
  children?: HashChild[];
  linked?: { via: string; table: string; columns: string[]; children?: HashChild[] }[];
}

type Row = Record<string, unknown>;

export interface HashContext {
  /** The rows of a table. */
  rows(table: string): readonly Row[];
  /** A column's manifest type (`int`, `decimal`, `bool`, `date`, `timestamptz`, `text` …). */
  kind(table: string, column: string): string | undefined;
  /** A decimal column's places for this row, or undefined when it keeps no scale. */
  places(table: string, column: string, row: Row): number | undefined;
}

/** Sorted keys, no spaces: the same text for the same values on every run. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

const DAY = /^\d{4}-\d{2}-\d{2}/;

/** One value as the canonical form spells it. */
export function canonicalValue(table: string, column: string, row: Row, ctx: HashContext): unknown {
  const value = row[column];
  if (value === null || value === undefined) return null;
  switch (ctx.kind(table, column)) {
    case "int":
    case "fk":
      return plainDecimal(value);
    case "decimal": {
      const places = ctx.places(table, column, row);
      return places === undefined ? plainDecimal(value) : (atPlaces(value, places) ?? String(value));
    }
    case "bool":
      return value === true || value === 1 || value === "1" || value === "t" || value === "true";
    case "date":
      return DAY.exec(String(value))?.[0] ?? null;
    case "timestamptz": {
      const at = new Date(String(value));
      return Number.isNaN(at.getTime()) ? String(value) : at.toISOString();
    }
    default:
      return typeof value === "string" ? value.normalize("NFC") : value;
  }
}

function columnsOf(table: string, row: Row, names: readonly string[], ctx: HashContext): Record<string, unknown> {
  return Object.fromEntries(names.map((name) => [name, canonicalValue(table, name, row, ctx)]));
}

/** A key's order: numbers as numbers, as the database orders an integer key. */
function compareKeys(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  const x = Number(a);
  const y = Number(b);
  if (typeof a !== "boolean" && Number.isFinite(x) && Number.isFinite(y)) return x - y;
  const s = String(a);
  const t = String(b);
  return s < t ? -1 : s > t ? 1 : 0;
}

function childrenOf(children: readonly HashChild[] | undefined, key: unknown, ctx: HashContext): unknown[] {
  return (children ?? []).map((child) =>
    ctx
      .rows(child.table)
      .filter((row) => row[child.via] !== null && row[child.via] !== undefined && String(row[child.via]) === String(key))
      .sort((a, b) => (child.orderBy === undefined ? 0 : compareKeys(a[child.orderBy], b[child.orderBy])) || compareKeys(a["id"], b["id"]))
      .map((row) => columnsOf(child.table, row, child.columns, ctx)),
  );
}

/** The canonical document a fingerprint is the hash of. */
export function fingerprintDocument(table: string, row: Row, spec: HashOf, ctx: HashContext): unknown {
  const linked = (spec.linked ?? []).map((link) => {
    const pointsAt = row[link.via];
    const found = pointsAt === null || pointsAt === undefined ? undefined : ctx.rows(link.table).find((candidate) => String(candidate["id"]) === String(pointsAt));
    return found === undefined ? null : { columns: columnsOf(link.table, found, link.columns, ctx), children: childrenOf(link.children, found["id"], ctx) };
  });
  return { columns: columnsOf(table, row, spec.columns, ctx), children: childrenOf(spec.children, row["id"], ctx), linked };
}

export function fingerprint(table: string, row: Row, spec: HashOf, ctx: HashContext): string {
  return sha256Hex(canonical(fingerprintDocument(table, row, spec, ctx)));
}
