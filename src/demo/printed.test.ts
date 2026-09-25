/**
 * THE DEMO'S PRINTED COPIES ARE THE ADD-ON'S, AS PINNED.
 *
 * Every copy the demo carries is on disk for every language, names its
 * document and its client, and is found for the row it belongs to. With the
 * add-ons checkout beside this repo (or at `ADD_ONS_REPO`), the copies are
 * drawn again by the pinned renderer and must be byte for byte the ones
 * committed — a checkout that moved fails until it is re-pinned
 * (`writePrinted.ts --pin`) and the copies written again.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { Id } from "../data/types.ts";
import { DEMO_LOCALES } from "../demo-types.ts";
import { DEMO_START, DEMO_ZONE } from "../lib/clock.ts";
import { createEngine } from "./engine.ts";
import { printedHtml, printedKey } from "./printed.ts";
import { addOnsRepo, checkoutPin, drawAll, PRINTED_DIR, readPin, serverPath } from "./prerender.ts";
import { printedName, printedRows } from "./printedSubjects.ts";
import { DEMO_CURRENCY, DEMO_SETTINGS, demoSample, resolveDemoSample } from "./sample.ts";
import { createWorld } from "./world.ts";

const sampleRows = () => {
  const engine = createEngine({ now: () => DEMO_START, zone: DEMO_ZONE, currency: DEMO_CURRENCY, settings: () => DEMO_SETTINGS, announce: () => {} });
  engine.load(resolveDemoSample(demoSample("en-US"), DEMO_START, DEMO_ZONE));
  return engine.rows;
};

describe("the printed copies the demo carries", () => {
  const rows = sampleRows();
  const expected = printedRows(rows).map(({ kind, row }) => `${printedName(kind, String(row["number"]))}.html`).sort();

  it("are pinned to one add-ons commit, one version and one renderer", () => {
    expect(readPin()).toMatchObject({ package: "@adminium/add-on-invoices", commit: expect.stringMatching(/^[0-9a-f]{40}$/), serverSha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
  });

  it("are every document of the clients the card signs in as, in every language, and nothing else", () => {
    expect(expected.length).toBe(22);
    for (const locale of DEMO_LOCALES) expect(readdirSync(join(PRINTED_DIR, locale)).sort(), locale).toEqual(expected);
  });

  it("each name their document and its client", () => {
    for (const { kind, row } of printedRows(rows)) {
      const client = rows.clients.find((c) => c.id === row["client_id"])!;
      for (const locale of DEMO_LOCALES) {
        const html = readFileSync(join(PRINTED_DIR, locale, `${printedName(kind, String(row["number"]))}.html`), "utf8");
        expect(html, `${locale} ${String(row["number"])}`).toContain(String(row["number"]));
        expect(html, `${locale} ${String(row["number"])}`).toContain(String(client["company"]).replace("&", "&amp;"));
        if (locale === "ar-EG") expect(html).toContain('dir="rtl"');
      }
    }
  });

  it("are found for their row, in the asked language, and a row made in the demo has none", async () => {
    const invoice = rows.invoices.find((i) => i["number"] === "INV-S2039")!;
    expect(printedKey("invoice", "invoices", invoice, "de-DE")).toBe("./printed/de-DE/invoice-INV-S2039.html");
    expect(await printedHtml("invoice", "invoices", invoice, "de-DE")).toContain("Rechnung");
    expect(printedKey("receipt", "invoices", invoice, "en-US")).toBeNull();
    expect(printedKey("invoice", "invoices", { ...invoice, number: "INV-2042" }, "en-US")).toBeNull();
  });

  it("open as a page from both sides of the demo, for the client's own rows only", async () => {
    const world = createWorld(demoSample("en-US"), () => DEMO_START, DEMO_ZONE, { name: "Nadia Cole" });
    const invoice = world.rows.invoices.find((i) => i["number"] === "INV-S2039")!;
    expect(await world.documentUrl("invoice", "invoices", invoice.id, "fr-FR")).toMatch(/^blob:/);
    expect(await world.portal(invoice["client_id"] as Id).documentUrl("invoice", "invoices", invoice.id, "fr-FR")).toMatch(/^blob:/);
    await expect(world.portal(3).documentUrl("invoice", "invoices", invoice.id, "fr-FR")).rejects.toMatchObject({ code: "PUBLIC_REF_NOT_FOUND" });
    const draft = await world.writes.insert("invoices", { client_id: 1, title: "New" });
    expect(await world.documentUrl("invoice", "invoices", draft.id, "en-US")).toBeNull();
  });
});

const repo = addOnsRepo();
const checkout = existsSync(serverPath(repo));

describe.runIf(checkout)("the printed copies against the pinned add-ons checkout", () => {
  it("is the pinned checkout", () => {
    const pin = readPin();
    expect(checkoutPin(repo), "the add-ons checkout moved: re-pin with `writePrinted.ts --pin` and write the copies again").toEqual(pin);
  });

  it("draws every copy byte for byte as committed", async () => {
    const drawn = await drawAll(repo);
    expect([...drawn.keys()].sort()).toEqual(DEMO_LOCALES.flatMap((locale) => readdirSync(join(PRINTED_DIR, locale)).map((name) => `${locale}/${name}`)).sort());
    const drifted = [...drawn].filter(([name, html]) => readFileSync(join(PRINTED_DIR, name), "utf8") !== html).map(([name]) => name);
    expect(drifted).toEqual([]);
  }, 60_000);
});
