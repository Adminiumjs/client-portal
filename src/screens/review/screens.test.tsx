/**
 * The review, drawn from the sample studio's rows: the head line, the
 * versions named by number (or by place when unnumbered), what was said with
 * its pin, the client's side by the deliverable's state (Share on an
 * unshared one; Mark approved while pending or with changes asked; the
 * approval line once approved). And the version and approval sheets.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../../i18n/index.tsx";
import { fakeStudio } from "../../testing/fakeStudio.ts";
import { ensureRows, loadDeliverable, upsert, upsertAll, useDesk } from "../../state/desk.ts";
import { useSheets } from "../../state/sheets.ts";
import { usePortal } from "../../state/portal.ts";
import { useUi } from "../../state/ui.ts";
import Review from "../Review.tsx";
import Version from "../../sheets/Version.tsx";
import MarkApproved from "../../sheets/MarkApproved.tsx";

function current(): void {
  for (const store of [useDesk, usePortal, useUi, useSheets] as unknown as { getState: () => object; getInitialState: () => object }[]) {
    Object.assign(store.getInitialState(), store.getState());
  }
}
const draw = (node: React.ReactNode) => {
  current();
  return renderToStaticMarkup(<I18nProvider>{node}</I18nProvider>);
};
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");

async function openReview(id: number): Promise<void> {
  await loadDeliverable(id);
  const d = useDesk.getState().rows.deliverables[id]!;
  await ensureRows("clients", [useDesk.getState().rows.projects[d.project_id]!.client_id]);
  useUi.setState((s) => ({ view: "review", selected: { ...s.selected, deliverable: id } }));
}

beforeEach(async () => {
  await fakeStudio();
});

describe("the review", () => {
  it("draws the head line, the title and where it stands", async () => {
    await openReview(3);
    const html = draw(<Review />);
    const words = text(html);
    expect(html).toContain('<h1 class="prj-title rv-title" id="review-title">Window sketch A</h1>');
    expect(words).toContain("PRJ-02");
    expect(words).toContain("Changes requested");
    expect(words).toContain("Hearth & Co Bakery · Seasonal window · 1 version · shared Jul 20");
  });

  it("names versions by their number, newest first, and one without a number by its place", async () => {
    await openReview(3);
    const s = useDesk.getState();
    upsertAll("deliverable_versions", [
      { ...s.rows.deliverable_versions[3]!, v: null },
      { ...s.rows.deliverable_versions[3]!, id: 50, v: null, note: "Bigger loaf.", posted_at: "2026-07-27T10:00:00.000Z" },
    ]);
    const html = draw(<Review />);
    expect([...html.matchAll(/class="rv-chip ol-chip" aria-pressed="(true|false)"[^>]*>(v\d)</g)].map((m) => `${m[2]!}${m[1] === "true" ? "*" : ""}`)).toEqual(["v2*", "v1"]);
    expect(text(html)).toContain("Bigger loaf. Nadia Cole · July 27, 2026 · current");
    expect(html).not.toMatch(/rv-compare"[^>]*disabled/);
  });

  it("threads what was said, the client's and the studio's, with the pin a note carries", async () => {
    await openReview(3);
    const s = useDesk.getState();
    upsert("deliverable_notes", { ...s.rows.deliverable_notes[1]!, pin_x: "42", pin_y: "58" });
    const html = draw(<Review />);
    const words = text(html);
    expect(words).toContain("2 notes");
    expect(words).toMatch(/Amara Osei Pin 1 .*Could the loaf be bigger\?/);
    expect(html).toContain("rv-note rv-note--studio");
    expect(words).toContain("Yes — new version by Thursday.");
  });

  it("offers Mark approved while changes are asked, and Share on a deliverable not shared yet", async () => {
    await openReview(3);
    expect(text(draw(<Review />))).toContain("Mark approved");
    await openReview(4);
    const words = text(draw(<Review />));
    expect(words).toContain("Share with Amara");
    expect(words).not.toContain("Mark approved");
    expect(words).not.toContain("Preview as the client");
  });

  it("says who approved and how once approved — marked by the studio, or in the portal", async () => {
    await openReview(5);
    let words = text(draw(<Review />));
    expect(words).toContain("Approved by email on Feb 27, marked by Nadia");
    expect(words).not.toContain("Mark approved");
    await openReview(2);
    words = text(draw(<Review />));
    expect(words).toContain("Approved in the portal by Cleo on Jun 24");
  });

  it("says a link is a link: a card to open it, no pins", async () => {
    await openReview(1);
    const words = text(draw(<Review />));
    expect(words).toContain("A link to somewhere else — open it to see the work.");
    expect(words).toContain("Open the link");
  });
});

describe("the sheets", () => {
  it("Post a version: the number it expects, a note, and 'and tell' only when the client will see it", async () => {
    await openReview(3);
    let words = text(draw(<Version sheet={{ kind: "version", deliverableId: 3 }} onClose={() => undefined} />));
    expect(words).toContain("Post v2");
    expect(words).toContain("Note for the client");
    expect(words).toContain("Post v2 and tell Amara");
    await openReview(4);
    words = text(draw(<Version sheet={{ kind: "version", deliverableId: 4 }} onClose={() => undefined} />));
    expect(words).not.toContain("and tell");
    expect(words).toContain("Not shared yet — it stays with the studio until you share it.");
  });

  it("Mark approved: how and when; with changes asked it says so and asks to approve anyway", async () => {
    await openReview(3);
    const html = draw(<MarkApproved sheet={{ kind: "markApproved", deliverableId: 3 }} onClose={() => undefined} />);
    const words = text(html);
    expect(words).toContain("How did they approve?");
    expect(words).toContain("Amara asked for changes on this version. Approve the current version anyway?");
    expect(words).toContain("By email On a call In person");
    expect(html).toMatch(/aria-pressed="true"[^>]*>By email</);
    expect(html).toContain('min="2026-07-20"');
    expect(html).toContain('max="2026-07-28"');
    expect(words).toContain("Approve it anyway");
  });

  it("Mark approved on a pending one asks nothing more", async () => {
    await openReview(1);
    const words = text(draw(<MarkApproved sheet={{ kind: "markApproved", deliverableId: 1 }} onClose={() => undefined} />));
    expect(words).not.toContain("anyway");
    expect(words).toContain("Mark approved");
  });
});
