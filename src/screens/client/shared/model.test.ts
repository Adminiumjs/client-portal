/**
 * The labels the clients' pages work out from stored values: an invoice's
 * pill, whether a proposal can still be decided or only re-priced, the
 * "sign only" state, how far along a project is, a version's file and label.
 */
import { describe, expect, it } from "vitest";

import type { Tables } from "../../../data/types.ts";
import { canDecide, canSign, fileName, hasClaimed, invoiceState, isStale, needsSignature, progress, versionLabel, versionsOf } from "./model.ts";

const TODAY = "2026-07-28";
const inv = (over: Partial<Tables["invoices"]>): Tables["invoices"] => ({ id: 1, status: "sent", balance: "100.00", paid: "0.00", due_on: "2026-08-10", client_paid: null, client_paid_at: null, ...over }) as Tables["invoices"];
const prop = (over: Partial<Tables["proposals"]>): Tables["proposals"] => ({ id: 1, status: "sent", valid_until: "2026-08-12", signed_name: null, accepted_how: null, ...over }) as Tables["proposals"];
const ms = (state: Tables["milestones"]["state"]) => ({ state }) as Tables["milestones"];
const ver = (id: number, v: number | null, posted_at: string, file: string | null = null, link: string | null = null) => ({ id, deliverable_id: 1, v, posted_at, file, link }) as Tables["deliverable_versions"];

describe("an invoice's pill", () => {
  it("reads void, paid, overdue, part paid or sent from stored values", () => {
    expect(invoiceState(inv({ status: "void", balance: "0.00" }), TODAY)).toBe("void");
    expect(invoiceState(inv({ balance: "0.00", paid: "100.00" }), TODAY)).toBe("paid");
    expect(invoiceState(inv({ due_on: "2026-07-16" }), TODAY)).toBe("overdue");
    expect(invoiceState(inv({ paid: "40.00" }), TODAY)).toBe("partPaid");
    expect(invoiceState(inv({}), TODAY)).toBe("sent");
  });

  it("is not overdue on its due day, only after it", () => {
    expect(invoiceState(inv({ due_on: TODAY }), TODAY)).toBe("sent");
  });

  it("knows the client already said they paid, until a payment clears it", () => {
    expect(hasClaimed(inv({}))).toBe(false);
    expect(hasClaimed(inv({ client_paid_at: "2026-07-27T18:00:00.000Z" }))).toBe(true);
    expect(hasClaimed(inv({ client_paid: true }))).toBe(true);
  });
});

describe("a proposal", () => {
  it("can be decided while it holds its price, and only re-priced after", () => {
    expect(canDecide(prop({}), TODAY)).toBe(true);
    expect(canDecide(prop({ valid_until: TODAY }), TODAY)).toBe(true);
    expect(isStale(prop({ valid_until: "2026-07-27" }), TODAY)).toBe(true);
    expect(canDecide(prop({ valid_until: "2026-07-27" }), TODAY)).toBe(false);
    expect(canDecide(prop({ status: "accepted" }), TODAY)).toBe(false);
  });

  it("asks for a signature only when accepted on the client's word and not yet signed", () => {
    expect(needsSignature(prop({ status: "accepted", accepted_how: "email" }))).toBe(true);
    expect(needsSignature(prop({ status: "accepted", accepted_how: "portal" }))).toBe(false);
    expect(needsSignature(prop({ status: "accepted", accepted_how: "call", signed_name: "Amara Osei" }))).toBe(false);
    expect(needsSignature(prop({ status: "sent" }))).toBe(false);
  });

  it("offers Accept and sign only with a name and the terms ticked", () => {
    expect(canSign("", true)).toBe(false);
    expect(canSign("A", true)).toBe(false);
    expect(canSign("Amara Osei", false)).toBe(false);
    expect(canSign("  Amara Osei ", true)).toBe(true);
  });
});

describe("a project and its deliverables", () => {
  it("counts a milestone done as whole and one under way as half", () => {
    expect(progress([])).toBe(0);
    expect(progress([ms("done"), ms("now"), ms("next"), ms("next")])).toBe(38);
    expect(progress([ms("done"), ms("done")])).toBe(100);
  });

  it("puts the newest version first and names its file", () => {
    const all = [ver(1, 1, "2026-07-01T00:00:00Z", null, "https://files.example/box-v1.pdf?sig=1"), ver(2, 2, "2026-07-20T00:00:00Z", "store:ref/box%20v2.pdf")];
    const sorted = versionsOf(all, 1);
    expect(sorted.map((v) => v.id)).toEqual([2, 1]);
    expect(fileName(sorted[0]!.file)).toBe("box v2.pdf");
    expect(fileName(sorted[1]!.link)).toBe("box-v1.pdf");
  });

  it("labels a version with no number by its place", () => {
    const all = versionsOf([ver(1, null, "2026-07-01T00:00:00Z"), ver(2, null, "2026-07-20T00:00:00Z")], 1);
    expect(all.map((v) => versionLabel(v, all))).toEqual(["v2", "v1"]);
  });
});
