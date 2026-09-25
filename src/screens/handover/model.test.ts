/**
 * The handover page's reckoning — the link's state and address, how long it
 * lives (never, or ninety days: nothing else), the files the client picks up
 * (approved work only, its newest version), the notes as paragraphs, the
 * fonts' changes and their writes — and the zip that "Take it all" makes.
 */
import { beforeEach, describe, expect, it } from "vitest";

import type { Deliverable, DeliverableVersion, HandoverFile, Invoice, ProjectFont } from "../../data/types.ts";
import { fakeStudio, type FakeStudio } from "../../testing/fakeStudio.ts";
import { clientsBase, expiryDay, expiryOf, fontChanges, handoverRows, invoiced, linkState, paragraphs, saveFonts, shareAddress, shownAddress, zipName } from "./model.ts";
import { crc32, makeZip, safeName, uniqueNames } from "./zip.ts";

describe("the link", () => {
  const p = { share_stopped: false, share_expires_on: null, handover_sent: false, handover_sent_at: null };

  it("is stopped, ended, live once the handover went out, or not sent yet", () => {
    expect(linkState(p, "2026-07-28")).toBe("notSent");
    expect(linkState({ ...p, handover_sent: true }, "2026-07-28")).toBe("live");
    expect(linkState({ ...p, handover_sent_at: "2026-05-29T15:00:00Z" }, "2026-07-28")).toBe("live");
    expect(linkState({ ...p, handover_sent: true, share_expires_on: "2026-07-27" }, "2026-07-28")).toBe("ended");
    expect(linkState({ ...p, handover_sent: true, share_expires_on: "2026-07-28" }, "2026-07-28")).toBe("live");
    expect(linkState({ ...p, handover_sent: true, share_stopped: true }, "2026-07-28")).toBe("stopped");
  });

  it("opens the clients' side of the same install, the token in the fragment", () => {
    expect(clientsBase("https://studio.example", "/apps/clients/staff/")).toBe("https://studio.example/apps/clients/customer/");
    expect(shareAddress("Q7X2M9KD4RTW8VNC", "https://studio.example", "/apps/clients/staff/")).toBe("https://studio.example/apps/clients/customer/h#Q7X2M9KD4RTW8VNC");
    expect(shareAddress("Q7X2M9KD4RTW8VNC", "http://127.0.0.1:5391", "/")).toBe("http://127.0.0.1:5391/h#Q7X2M9KD4RTW8VNC");
    expect(shownAddress("https://studio.example/h#X")).toBe("studio.example/h#X");
  });

  it("lives for ever (no last day) or ninety days from today — nothing else", () => {
    expect(expiryDay("never", "2026-07-28")).toBeNull();
    expect(expiryDay("days90", "2026-07-28")).toBe("2026-10-26");
    expect(expiryOf({ share_expires_on: null })).toBe("never");
    expect(expiryOf({ share_expires_on: "2026-10-26" })).toBe("days90");
  });
});

describe("what the client picks up", () => {
  const d = (id: number, status: Deliverable["status"], project_id = 4, position = id): Deliverable => ({ id, project_id, status, title: `D${String(id)}`, position }) as Deliverable;
  const v = (id: number, deliverable_id: number, vn: number, file: string | null, link: string | null = null): DeliverableVersion => ({ id, deliverable_id, v: vn, file, link, posted_at: `2026-07-0${String(vn)}T00:00:00Z` }) as DeliverableVersion;

  it("lists the approved deliverables' newest versions (file or link), then the files the studio added", () => {
    const rows = handoverRows(
      4,
      [d(1, "approved"), d(2, "pending"), d(3, "approved"), d(9, "approved", 5)],
      [v(1, 1, 1, "demo-file:mark-v1.pdf"), v(2, 1, 2, "demo-file:mark-v2.pdf"), v(3, 2, 1, "demo-file:draft.pdf"), v(4, 3, 1, null, "https://www.figma.com/file/x"), v(5, 9, 1, "demo-file:other.pdf")],
      [{ id: 7, project_id: 4, file: "demo-file:colours.pdf", note: "Spot colours", position: 0 } as HandoverFile, { id: 8, project_id: 5, file: "demo-file:no.pdf", position: 0 } as HandoverFile],
    );
    expect(rows.map((r) => [r.key, r.value, r.link])).toEqual([
      ["d1", "demo-file:mark-v2.pdf", false],
      ["d3", "https://www.figma.com/file/x", true],
      ["f7", "demo-file:colours.pdf", false],
    ]);
  });

  it("adds up only the invoices that went out — never a void one or a draft", () => {
    const inv = (id: number, status: Invoice["status"], total: string) => ({ id, project_id: 4, status, total, currency: "USD" }) as Invoice;
    expect(invoiced([inv(1, "sent", "1200.00"), inv(2, "void", "500.00"), inv(3, "draft", "90.00"), inv(4, "sent", "300.50")], 4)).toEqual({ total: "1500.50", currency: "USD" });
  });

  it("splits the notes on a blank line", () => {
    expect(paragraphs("One.\n\n  Two,\nstill two.\n \n\nThree.")).toEqual(["One.", "Two,\nstill two.", "Three."]);
    expect(paragraphs(null)).toEqual([]);
  });

  it("names the zip after the client and the project, in plain letters", () => {
    expect(zipName("Kiln Street Céramics", "PRJ-04")).toBe("kiln-street-ceramics_prj-04_handover.zip");
    expect(zipName("", null)).toBe("client_project_handover.zip");
  });
});

describe("the fonts", () => {
  const f = (id: number, name: string, licence: string | null, position: number) => ({ id, project_id: 4, name, licence, position }) as ProjectFont;

  it("drops a row without a name, stores an empty licence as empty, and changes only what changed", () => {
    const held = [f(1, "Bell Grotesk", "Two weights", 0), f(2, "Marrow Text", null, 1), f(3, "Gone Sans", null, 2)];
    expect(
      fontChanges(held, [
        { id: 2, name: "Marrow Text", licence: "" },
        { id: 1, name: " Bell Grotesk ", licence: "Two weights, web too" },
        { name: "   ", licence: "orphan" },
        { name: "New Serif", licence: " " },
      ]),
    ).toEqual({
      remove: [3],
      edit: [
        { id: 2, name: "Marrow Text", licence: null, position: 0 },
        { id: 1, name: "Bell Grotesk", licence: "Two weights, web too", position: 1 },
      ],
      add: [{ name: "New Serif", licence: null, position: 2 }],
    });
  });

  let studio: FakeStudio;
  beforeEach(async () => {
    studio = await fakeStudio();
  });

  it("saves removals, then patches, then additions — each the desk's own write", async () => {
    const held = [f(1, "Bell Grotesk", null, 0)];
    studio.world.rows.project_fonts.push({ id: 1, project_id: 4, name: "Bell Grotesk", licence: null, position: 0 } as never);
    const out = await saveFonts(4, held, [{ id: 1, name: "Bell Grotesk", licence: "Desktop and web" }, { name: "Marrow Text", licence: "" }]);
    expect(out.ok).toBe(true);
    expect(studio.writes.map((w) => `${w.op} ${w.table}`)).toEqual(["update project_fonts", "insert project_fonts"]);
    expect(studio.writes[0]!.values).toEqual({ name: "Bell Grotesk", licence: "Desktop and web", position: 0 });
    expect(studio.writes[1]!.values).toMatchObject({ project_id: 4, name: "Marrow Text", licence: null, position: 1 });
    expect(String(studio.writes[1]!.values?.["client_key"])).toHaveLength(36);
  });
});

describe("Take it all", () => {
  it("checks each file with the zip format's own CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("makes a zip: an entry per file, a directory naming each, the end record counting them", () => {
    const zip = makeZip([
      { name: "contents.txt", data: new TextEncoder().encode("list") },
      { name: "façade.pdf", data: new Uint8Array([1, 2, 3]) },
    ]);
    const view = new DataView(zip.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    const end = zip.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
    const text = new TextDecoder().decode(zip);
    expect(text).toContain("contents.txt");
    expect(text).toContain("façade.pdf");
    // the directory's offset lands on its first header
    expect(view.getUint32(view.getUint32(end + 16, true), true)).toBe(0x02014b50);
  });

  it("keeps names safe and unique inside one zip", () => {
    expect(safeName("a/b:c?.pdf")).toBe("a_b_c_.pdf");
    expect(uniqueNames(["logo.pdf", "Logo.pdf", "notes", "notes"])).toEqual(["logo.pdf", "Logo (2).pdf", "notes", "notes (2)"]);
  });
});
