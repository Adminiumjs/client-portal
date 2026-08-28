/**
 * EVERY REF THE SNAPSHOT READS HAS A TABLE BEHIND IT.
 *
 * `REQUIRED` (adminiumSource.ts) is the set of refs `loadSnapshot` asks for.
 * `TABLE_OF_REF` (data/tableOfRef.ts) maps those refs to the tables the hosted
 * transport reads them from. Nothing connects the two, and nothing needs to
 * until a hosted build runs — at which point an unmapped ref throws
 * `UNKNOWN_REF` on the first load, in production, for a repo whose whole test
 * suite was green.
 *
 * It is not hypothetical: hotel-reservations was ported with five of its eight
 * refs mapped, type-checked clean, and passed 126 tests. This file is why that
 * is now a red suite instead of a broken deployment.
 *
 * The public transport does NOT need the map — a scope names its own refs — so
 * this can only ever fail for the hosted path, which is exactly the path with
 * no other check on it.
 */
import { describe, expect, it } from "vitest";

import { REQUIRED } from "./adminiumSource.ts";
import { TABLE_OF_REF } from "./tableOfRef.ts";

describe("ref coverage", () => {
  it("maps every ref the snapshot reads to a table", () => {
    const unmapped = Object.keys(REQUIRED).filter((ref) => !(ref in TABLE_OF_REF));
    expect(unmapped, "these refs would throw UNKNOWN_REF in a hosted build").toEqual([]);
  });

  it("maps nothing the snapshot does not read", () => {
    // A stale entry is a smaller problem than a missing one, and still a lie:
    // it says this app reads a table it does not.
    const extra = Object.keys(TABLE_OF_REF).filter((ref) => !(ref in REQUIRED));
    expect(extra, "these mappings correspond to no ref").toEqual([]);
  });
});
