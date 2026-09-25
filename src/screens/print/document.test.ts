/**
 * The printed copy asks the desk's reads for the add-on's document by the
 * app's own table for each kind, a statement with its period; without the
 * read it draws the document itself.
 */
import { describe, expect, it, vi } from "vitest";

import type { DeskReads } from "../../data/ports.ts";
import { documentPort } from "./document.ts";

const link = { printUrl: "/print", contentUrl: null };

describe("the printed copy's document", () => {
  it("names each kind's table, and a statement's period", async () => {
    const documentUrl = vi.fn(async () => link);
    const port = documentPort({ documentUrl } as unknown as DeskReads)!;
    expect(await port({ kind: "statement", id: 4, period: "12m" }, "de-DE")).toBe(link);
    await port({ kind: "quote", id: 3 }, "en-US");
    await port({ kind: "receipt", id: 9 }, "en-US");
    await port({ kind: "invoice", id: 12 }, "fr-FR");
    expect(documentUrl.mock.calls).toEqual([
      ["statement", "clients", 4, "de-DE", "12m"],
      ["quote", "proposals", 3, "en-US", undefined],
      ["receipt", "payments", 9, "en-US", undefined],
      ["invoice", "invoices", 12, "fr-FR", undefined],
    ]);
  });

  it("is absent where the reads cannot draw one", () => {
    expect(documentPort({} as DeskReads)).toBeNull();
  });
});
