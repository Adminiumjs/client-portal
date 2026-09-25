/**
 * The composer's form, its checks and what it saves: the figures the rail
 * shows while typing are worked out as Adminium works them out (and agree
 * with what it stores), the red hints and the Send gate follow the design,
 * and the drafts the form becomes write the rows the studio's action needs —
 * a new proposal from an enquiry makes its client and moves the enquiry on
 * the first save only; a saved draft is patched, never re-created.
 */
import { beforeEach, describe, expect, it } from "vitest";

import * as act from "../../state/actions.ts";
import { loadInvoice, loadProposal, useDesk } from "../../state/desk.ts";
import { fakeStudio, tableOf, type FakeStudio } from "../../testing/fakeStudio.ts";
import {
  blankLine,
  enquiryProposalForm,
  invoiceForm,
  lineInputs,
  lineProblem,
  newProposalForm,
  proposalForm,
  scopeParagraphs,
  sendBlock,
  storedProposalDraft,
  toInvoiceDraft,
  toProposalDraft,
  type ComposerForm,
  type LineForm,
} from "./draft.ts";
import { documentFigures, lineAmount, readAmount, shareOf } from "./figures.ts";

const line = (patch: Partial<LineForm>): LineForm => ({ ...blankLine(), ...patch });

let studio: FakeStudio;
beforeEach(async () => {
  studio = await fakeStudio();
  // What the composer reads when it opens a document: its lines.
  await Promise.all([loadProposal(3), loadProposal(4), loadInvoice(7)]);
  studio.writes.length = 0;
});

describe("the figures while typing", () => {
  it("reads an amount the way people type it", () => {
    expect(readAmount("1250")).toBe("1250");
    expect(readAmount("1,250.50")).toBe("1250.50");
    expect(readAmount("1.250,50")).toBe("1250.50");
    expect(readAmount("12,5")).toBe("12.5");
    expect(readAmount("$ 90")).toBe("90");
    expect(readAmount(".5")).toBe("0.5");
    expect(readAmount("")).toBeNull();
    expect(readAmount("abc")).toBeNull();
    expect(readAmount("1.2.3,4,5")).toBeNull();
  });

  it("works a line out as quantity × rate less the discount, never below zero, rounded half away from zero", () => {
    expect(lineAmount("2", "250.00", null)).toBe("500.00");
    expect(lineAmount("1", "900.00", "100.00")).toBe("800.00");
    expect(lineAmount("1", "10", "25")).toBe("0.00");
    expect(lineAmount("3", "0.335", null)).toBe("1.01");
    expect(lineAmount("1", "1000", null, 0)).toBe("1000");
  });

  it("agrees with what Adminium stored for the sample proposal (subtotal, tax, total)", () => {
    const stored = useDesk.getState().rows.proposals[3]!;
    const lines = Object.values(useDesk.getState().rows.proposal_lines).filter((l) => l.document_id === 3);
    const f = documentFigures(
      lines.map((l) => ({ qty: l.qty, rate: l.rate, discount: l.discount })),
      stored.tax_rate,
    );
    expect([f.subtotal, f.tax, f.total]).toEqual([stored.subtotal, stored.tax, stored.total]);
  });

  it("says nothing about tax it does not know, and takes a stage's share of an amount exactly", () => {
    expect(documentFigures([{ qty: "1", rate: "100", discount: null }], null)).toEqual({ amounts: ["100.00"], subtotal: "100.00", tax: null, total: "100.00" });
    expect(shareOf("3900.00", "50")).toBe("1950.00");
    expect(shareOf("6120.00", "30")).toBe("1836.00");
    expect(shareOf("100.01", "33.3")).toBe("33.30");
    expect(shareOf(null, "50")).toBeNull();
  });
});

describe("the checks the design draws", () => {
  it("marks the first thing wrong with a line, and leaves an untouched one alone", () => {
    expect(lineProblem(blankLine())).toBeNull();
    expect(lineProblem(line({ rate: "100" }))).toBe("description");
    expect(lineProblem(line({ description: "Mark", qty: "0", rate: "100" }))).toBe("qty");
    expect(lineProblem(line({ description: "Mark", rate: "0" }))).toBe("rate");
    expect(lineProblem(line({ description: "Mark", rate: "abc" }))).toBe("rate");
    expect(lineProblem(line({ description: "Mark", rate: "100", discount: "-5" }))).toBe("discountNegative");
    expect(lineProblem(line({ description: "Mark", qty: "2", rate: "100", discount: "201" }))).toBe("discountOver");
    expect(lineProblem(line({ description: "Mark", qty: "2", rate: "100", discount: "200" }))).toBeNull();
  });

  it("keeps Send off until at least one line is good and none is marked", () => {
    const form = newProposalForm("2026-07-28", { termsVersionId: 3 });
    expect(sendBlock(form)).toBe("noGoodLine");
    expect(sendBlock({ ...form, lines: [line({ description: "Mark", rate: "100" }), line({ rate: "5" })] })).toBe("problems");
    expect(sendBlock({ ...form, lines: [line({ description: "Mark", rate: "100" }), blankLine()] })).toBeNull();
  });
});

describe("the form, from what is stored", () => {
  it("starts a new proposal three weeks out, on the terms in force", () => {
    const form = newProposalForm("2026-07-28", { termsVersionId: 3 });
    expect(form).toMatchObject({ kind: "proposal", id: null, validUntil: "2026-08-18", split: "5050", termsVersionId: 3, scope: [""] });
  });

  it("starts from an enquiry: its words are the scope, its sender the new client — or the one on file", () => {
    const enquiry = useDesk.getState().rows.enquiries[1]!;
    const fresh = enquiryProposalForm(enquiry, "2026-07-28", { existing: null, termsVersionId: 3, title: "Bike shop identity" });
    expect(fresh).toMatchObject({ clientId: null, enquiryId: 1, scope: ["A new mark and shop signage before the autumn season."], title: "Bike shop identity" });
    expect(fresh.newClient).toEqual({ company: "Northwind Cycles", contact_name: "Sam Hale", email: "sam@northwind.example", trade: "Bike shop" });
    const known = enquiryProposalForm(enquiry, "2026-07-28", { existing: useDesk.getState().rows.clients[1]!, termsVersionId: 3, title: "" });
    expect(known).toMatchObject({ clientId: 1, newClient: null });
  });

  it("reads a draft back as typed, and moves a day already past to three weeks from today", () => {
    const p = useDesk.getState().rows.proposals[4]!;
    const lines = Object.values(useDesk.getState().rows.proposal_lines).filter((l) => l.document_id === 4);
    const form = proposalForm(p, lines, "2026-07-28");
    expect(form.lines.map((l) => [l.id, l.description, l.qty, l.rate, l.discount])).toEqual([[7, "Poster design", "1", "650", ""]]);
    expect(form.validUntil).toBe("2026-08-18");
    expect(proposalForm({ ...p, valid_until: "2026-07-01" }, lines, "2026-07-28").validUntil).toBe("2026-08-18");
    expect(scopeParagraphs("One.\n\nTwo.\n\n\n")).toEqual(["One.", "Two."]);
  });
});

describe("what the form saves", () => {
  const trail = () => studio.writes.map((w) => `${w.op} ${w.table}`);
  const ok = <T,>(o: act.Outcome<T>): T => {
    if (!o.ok) throw new Error(`refused: ${o.reason} ${o.code}`);
    return o.value;
  };

  it("drops untouched lines and saves each amount as a decimal", () => {
    expect(lineInputs([line({ description: "Mark", qty: "1,5", rate: "1.250,00", discount: "" }), blankLine()])).toEqual([{ description: "Mark", qty: "1.5", rate: "1250.00", discount: null }]);
  });

  it("sends a new proposal from an enquiry: client → proposal → line → the enquiry → sent, and reads Adminium's figures back", async () => {
    const enquiry = useDesk.getState().rows.enquiries[1]!;
    const form: ComposerForm = {
      ...enquiryProposalForm(enquiry, "2026-07-28", { existing: null, termsVersionId: 3, title: "Bike shop identity" }),
      lines: [line({ description: "Mark and signage", rate: "1,250.5", discount: "50" })],
    };
    const draft = toProposalDraft(form)!;
    const sent = ok(await act.sendProposal(draft, { replacedReason: "Replaced." }));
    expect(trail()).toEqual(["insert clients", "insert proposals", "insert proposal_lines", "update enquiries", "update proposals"]);
    expect(studio.writes[3]!.values).toEqual({ client_id: sent.client_id, proposal_id: sent.id, status: "proposal" });
    expect(studio.writes[4]!.values).toEqual({ status: "sent" });
    expect([sent.status, sent.subtotal, sent.tax, sent.total]).toEqual(["sent", "1200.50", "102.04", "1302.54"]);
  });

  it("saves a draft it opened as patches: no second proposal, no enquiry moved", async () => {
    const p = useDesk.getState().rows.proposals[4]!;
    const lines = Object.values(useDesk.getState().rows.proposal_lines).filter((l) => l.document_id === 4);
    const form = proposalForm(p, lines, "2026-07-28");
    const edited: ComposerForm = { ...form, enquiryId: 2, lines: [{ ...form.lines[0]!, rate: "700" }, line({ description: "Print check", rate: "240" })] };
    const draft = toProposalDraft(edited)!;
    expect(draft.enquiryId).toBeNull();
    const saved = ok(await act.saveProposal(draft));
    expect(trail()).toEqual(["update proposals", "update proposal_lines", "insert proposal_lines"]);
    expect(saved.total).toBe(String((940 * 1.085).toFixed(2)));
  });

  it("has nothing to save without a client, and sends a stored draft as it stands", async () => {
    expect(toProposalDraft(newProposalForm("2026-07-28", { termsVersionId: 3 }))).toBeNull();
    const inv = useDesk.getState().rows.invoices[7]!;
    const invLines = Object.values(useDesk.getState().rows.invoice_lines).filter((l) => l.document_id === 7);
    expect(toInvoiceDraft({ ...invoiceForm(inv, invLines), terms: "net30" })).toMatchObject({ id: 7, client_id: 4, terms: "net30", lines: [{ id: 7, qty: "2", rate: "90" }] });
    expect(toInvoiceDraft(invoiceForm(inv, invLines))).not.toHaveProperty("terms");

    const p = useDesk.getState().rows.proposals[4]!;
    const lines = Object.values(useDesk.getState().rows.proposal_lines).filter((l) => l.document_id === 4);
    const sent = ok(await act.sendProposal(storedProposalDraft(p, lines), { replacedReason: "Replaced." }));
    expect(trail()).toEqual(["update proposals", "update proposal_lines", "update proposals"]);
    expect(sent.status).toBe("sent");
    expect(tableOf(studio, "proposals").filter((r) => r["status"] === "draft")).toHaveLength(0);
  });
});
