/**
 * The seal is SHA-256 over Adminium's canonical form: held to Node's own
 * SHA-256, and to the form's rules one by one.
 */
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { canonical, canonicalValue, fingerprint, sha256Hex, type HashContext } from "./fingerprint.ts";

const node = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

describe("SHA-256, written out in plain JavaScript", () => {
  it("agrees with Node's on the empty string, one block, several blocks, and text beyond ASCII", () => {
    for (const text of ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), "x".repeat(1000), "Crème brûlée · 雙語 · العربية · 🍞"]) {
      expect(sha256Hex(text), JSON.stringify(text.slice(0, 12))).toBe(node(text));
    }
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("the canonical form", () => {
  const ctx = (kinds: Record<string, string>, places: Record<string, number> = {}): HashContext => ({
    rows: () => [],
    kind: (_table, column) => kinds[column],
    places: (_table, column) => places[column],
  });

  it("sorts keys, has no spaces, and spells an empty value null", () => {
    expect(canonical({ b: 1, a: [true, null, "x"], c: undefined })).toBe('{"a":[true,null,"x"],"b":1,"c":null}');
  });

  it("spells each value by its column's type", () => {
    const row = { money: 1200, rate: "8.5", count: 3, fk: "12", yes: 1, day: "2026-08-11T00:00:00.000Z", at: "2026-07-28T10:00:00-04:00", word: "Café", none: null };
    const c = ctx({ money: "decimal", rate: "decimal", count: "int", fk: "fk", yes: "bool", day: "date", at: "timestamptz", word: "text", none: "text" }, { money: 2 });
    expect(Object.fromEntries(Object.keys(row).map((column) => [column, canonicalValue("t", column, row, c)]))).toEqual({
      money: "1200.00",
      rate: "8.5",
      count: "3",
      fk: "12",
      yes: true,
      day: "2026-08-11",
      at: "2026-07-28T14:00:00.000Z",
      word: "Café",
      none: null,
    });
  });

  it("orders child rows by their order column, then by key, and fingerprints the document", () => {
    const rows: Record<string, Record<string, unknown>[]> = {
      doc: [{ id: 1, title: "A" }],
      lines: [
        { id: 3, doc_id: 1, position: 2, text: "third" },
        { id: 2, doc_id: 1, position: 1, text: "second" },
        { id: 1, doc_id: 1, position: 1, text: "first" },
        { id: 4, doc_id: 2, position: 0, text: "another document" },
      ],
    };
    const c: HashContext = { rows: (table) => rows[table] ?? [], kind: (_t, column) => (column === "position" ? "int" : "text"), places: () => undefined };
    const spec = { columns: ["title"], children: [{ table: "lines", via: "doc_id", columns: ["position", "text"], orderBy: "position" }] };
    const expected = '{"children":[[{"position":"1","text":"first"},{"position":"1","text":"second"},{"position":"2","text":"third"}]],"columns":{"title":"A"},"linked":[]}';
    expect(fingerprint("doc", rows["doc"]![0]!, spec, c)).toBe(node(expected));
  });
});
