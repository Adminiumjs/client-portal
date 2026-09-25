/**
 * The enquiries inbox: filters ("Parked" is parked only, a polite no has its
 * own), the next unanswered one, the reply a fit starts from, a row's
 * summary — and the answers the screen gives write what the studio's
 * inbox needs: the reply message first and the enquiry marked replied last;
 * a park that comes back in thirty days.
 */
import { beforeEach, describe, expect, it } from "vitest";

import type { Enquiry } from "../../data/types.ts";
import * as act from "../../state/actions.ts";
import { loadPage, useDesk } from "../../state/desk.ts";
import { fakeStudio, type FakeStudio } from "../../testing/fakeStudio.ts";
import { byReceived, ENQUIRY_FILTERS, ENQUIRY_WORD, inEnquiryFilter, nextUnanswered, replyFor, summary } from "./model.ts";

let studio: FakeStudio;
const list = (): Enquiry[] => Object.values(useDesk.getState().rows.enquiries).sort(byReceived);

beforeEach(async () => {
  studio = await fakeStudio();
});

describe("the inbox", () => {
  it("files each enquiry under its own filter; a declined one is not parked", () => {
    const declined = { ...list()[0]!, status: "declined" as const };
    expect(ENQUIRY_FILTERS.filter((f) => inEnquiryFilter(declined, f))).toEqual(["all", "declined"]);
    const parked = list().find((e) => e.status === "parked")!;
    expect(ENQUIRY_FILTERS.filter((f) => inEnquiryFilter(parked, f))).toEqual(["all", "parked"]);
    expect(ENQUIRY_WORD.proposal).toBe("toProposal");
  });

  it("reads every state when the screen opens, not only the open work", async () => {
    await act.sendEnquiryReply(1, { to: "sam@northwind.example", language: "en-US", subject: null, body: "Hello" });
    await act.declineEnquiry(4);
    const { total } = await loadPage("enquiries", { order: "received_at.desc", limit: 200, offset: 0, count: true });
    expect(total).toBe(4);
    expect(list().map((e) => e.status).sort()).toEqual(["declined", "new", "parked", "replied"]);
  });

  it("jumps to the newest unanswered one that is not open, and says when none is left", () => {
    expect(list().map((e) => e.number)).toEqual(["ENQ-004", "ENQ-001", "ENQ-002", "ENQ-003"]);
    expect(nextUnanswered(list(), 4)?.number).toBe("ENQ-001");
    expect(nextUnanswered(list(), null)?.number).toBe("ENQ-004");
    expect(nextUnanswered(list().map((e) => ({ ...e, status: "replied" as const })), null)).toBeNull();
  });

  it("starts the reply from the fit, and sums a row up from what it has", () => {
    expect(list().map((e) => [e.number, replyFor(e)])).toEqual([
      ["ENQ-004", "no"],
      ["ENQ-001", "good"],
      ["ENQ-002", "maybe"],
      ["ENQ-003", "maybe"],
    ]);
    expect(summary(list()[1]!)).toBe("Bike shop · 5–8k · Website");
    expect(summary(list()[3]!)).toBe("Call");
  });
});

describe("the answers", () => {
  const trail = () => studio.writes.map((w) => `${w.op} ${w.table}`);

  it("sends a reply as a message first, then marks the enquiry replied", async () => {
    const out = await act.sendEnquiryReply(2, { to: "ines@lantern.example", language: "fr-FR", subject: null, body: "Bonjour Ines" });
    expect(out.ok).toBe(true);
    expect(trail()).toEqual(["insert messages", "update enquiries"]);
    expect(studio.writes[0]!.values).toMatchObject({ kind: "enquiry-reply", to: "ines@lantern.example", language: "fr-FR", body_override: "Bonjour Ines" });
  });

  it("parks one for thirty days on the studio's calendar", async () => {
    const out = await act.parkEnquiry(1);
    if (!out.ok) throw new Error(out.reason);
    expect(out.value.parked_until).toBe("2026-08-27");
  });
});
