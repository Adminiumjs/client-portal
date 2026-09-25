/**
 * Every action the desk takes, against the sample studio: what it writes, in
 * what order, with which action keys — and what it answers when the studio's
 * server says no. The actions that write several rows are also run HALF-WAY:
 * a first try whose answer is lost after a step (the network drops), then
 * "Finish it", which must finish without writing any row twice.
 */
import { beforeEach, describe, expect, it } from "vitest";

import * as act from "./actions.ts";
import { acceptAndSign } from "./clientActions.ts";
import { upsertAll, useDesk } from "./desk.ts";
import { fakeStudio, tableOf, type FakeStudio } from "../testing/fakeStudio.ts";

let studio: FakeStudio;
beforeEach(async () => {
  studio = await fakeStudio();
});

/** What was written, as `op table` in order. */
const trail = () => studio.writes.map((w) => `${w.op} ${w.table}`);
const keys = () => studio.writes.flatMap((w) => (typeof w.values?.["client_key"] === "string" ? [w.values["client_key"] as string] : []));
const row = (ref: Parameters<typeof tableOf>[1], id: number) => tableOf(studio, ref).find((r) => r["id"] === id)!;
const ok = <T,>(outcome: act.Outcome<T>): T => {
  if (!outcome.ok) throw new Error(`refused: ${outcome.reason} ${outcome.code}`);
  return outcome.value;
};
const lines = [
  { description: "Mark", qty: "1", rate: "1200.00" },
  { description: "Sign artwork", qty: "2", rate: "300.00", discount: "50.00" },
];

describe("enquiries", () => {
  it("logs a call: one enquiry under an action key; its number and time are the server's", async () => {
    const made = ok(await act.logCall({ name: " Dee Park ", business: "Park Florist", source: "Call", body: "Wants a shop sign" }));
    expect(trail()).toEqual(["insert enquiries"]);
    expect(studio.writes[0]!.values).toMatchObject({ name: "Dee Park", business: "Park Florist", source: "Call", email: null });
    expect(studio.writes[0]!.values).not.toHaveProperty("number");
    expect(keys()[0]).toHaveLength(36);
    expect(made.number).toBe("ENQ-005");
  });

  it("sends a reply: the message first, the enquiry marked replied last", async () => {
    ok(await act.sendEnquiryReply(1, { to: "sam@northwind.example", language: "en-US", subject: null, body: "Thanks — can we talk Thursday?" }));
    expect(trail()).toEqual(["insert messages", "update enquiries"]);
    expect(studio.writes[0]!.values).toMatchObject({ kind: "enquiry-reply", status: "queued", enquiry_id: 1, body_override: "Thanks — can we talk Thursday?" });
    expect(studio.writes[1]!.values).toEqual({ status: "replied" });
  });

  it("parks for 30 days on the studio's calendar, and declines", async () => {
    ok(await act.parkEnquiry(2));
    ok(await act.declineEnquiry(4));
    expect(studio.writes.map((w) => w.values)).toEqual([{ status: "parked", parked_until: "2026-08-27" }, { status: "declined" }]);
  });
});

describe("the composer", () => {
  const fromEnquiry = (): act.ProposalDraft => ({
    id: null,
    client: { new: { company: "Northwind Cycles", contact_name: "Sam Hale", email: "sam@northwind.example" } },
    title: "Mark and signage",
    scope: "A mark and the shop sign.",
    split: "5050",
    valid_until: "2026-08-18",
    terms_version_id: 3,
    lines,
    enquiryId: 1,
  });

  it("starts a proposal from an enquiry: the client, the proposal, its lines — the enquiry moves last", async () => {
    const proposal = ok(await act.saveProposal(fromEnquiry()));
    expect(trail()).toEqual(["insert clients", "insert proposals", "insert proposal_lines", "insert proposal_lines", "update enquiries"]);
    expect(studio.writes[4]!.values).toEqual({ client_id: proposal.client_id, proposal_id: proposal.id, status: "proposal" });
    expect(new Set(keys()).size).toBe(4);
    // Totals are the server's, read back after the lines: 1200 + (600 − 50) = 1750, plus 8.5 %.
    expect(proposal).toMatchObject({ subtotal: "1750.00", tax: "148.75", total: "1898.75", number: "PRO-1143" });
    expect(useDesk.getState().rows.proposals[proposal.id]?.total).toBe("1898.75");
  });

  for (const [n, step] of [
    [2, "insert proposals"],
    [3, "insert proposal_lines"],
    [5, "update enquiries"],
  ] as const) {
    it(`finishes after the answer to "${step}" is lost, writing nothing twice`, async () => {
      studio.failWrite(n, "after");
      const first = await act.saveProposal(fromEnquiry());
      expect(first.ok).toBe(false);
      if (first.ok || first.unfinished === null) throw new Error("expected an unfinished action");
      expect(first.reason).toBe("offline");
      const done = await first.unfinished.resume();
      expect(done.ok).toBe(true);
      expect(tableOf(studio, "clients").filter((c) => c["company"] === "Northwind Cycles")).toHaveLength(1);
      expect(tableOf(studio, "proposals").filter((p) => p["title"] === "Mark and signage")).toHaveLength(1);
      expect(tableOf(studio, "proposal_lines").filter((l) => l["description"] === "Sign artwork")).toHaveLength(1);
      expect(row("enquiries", 1)["status"]).toBe("proposal");
    });
  }

  it("never moves the enquiry before the proposal exists", async () => {
    studio.failWrite(2, "before");
    const first = await act.saveProposal(fromEnquiry());
    expect(first.ok).toBe(false);
    expect(row("enquiries", 1)["status"]).toBe("new");
  });

  it("edits a draft: the proposal patched, kept lines patched, new ones made, dropped ones removed", async () => {
    ok(await act.saveProposal({ id: 4, client: { id: 4 }, title: "Studio sale poster", scope: null, split: "end", valid_until: "2026-08-18", terms_version_id: 3, lines: [{ id: 7, description: "Poster design", qty: "1", rate: "700.00" }, lines[0]!] }));
    expect(trail()).toEqual(["update proposals", "update proposal_lines", "insert proposal_lines"]);
    ok(await act.saveProposal({ id: 4, client: { id: 4 }, title: "Studio sale poster", scope: null, split: "end", valid_until: "2026-08-18", terms_version_id: 3, lines: [{ id: 7, description: "Poster design", qty: "1", rate: "700.00" }] }));
    expect(trail().slice(3)).toEqual(["update proposals", "remove proposal_lines", "update proposal_lines"]);
  });

  it("sends a new proposal: create, lines, then the move to sent; an empty one is refused", async () => {
    const sent = ok(await act.sendProposal({ ...fromEnquiry(), enquiryId: null, client: { id: 1 } }, { replacedReason: "Replaced" }));
    expect(trail()).toEqual(["insert proposals", "insert proposal_lines", "insert proposal_lines", "update proposals"]);
    expect(studio.writes[3]!.values).toEqual({ status: "sent" });
    expect(sent.status).toBe("sent");
    expect(sent.sent_at).not.toBeNull();
    const empty = await act.sendProposal({ ...fromEnquiry(), enquiryId: null, client: { id: 1 }, lines: [] }, { replacedReason: "Replaced" });
    expect(empty).toMatchObject({ ok: false, reason: "empty", code: "STATE_MOVE_REFUSED", details: { requires: "proposal_lines" } });
  });

  it("makes a revision (the draft, then its copied lines); sending it withdraws the one it revises", async () => {
    const draft = ok(await act.makeRevision(3));
    expect(trail()).toEqual(["insert proposals", "insert proposal_lines", "insert proposal_lines", "insert proposal_lines"]);
    expect(studio.writes[0]!.values).toMatchObject({ revision_of: 3, client_id: 1, title: "Shopfront identity", split: "5050" });
    expect(draft.number).toMatch(/^PRO-/);
    const copied = tableOf(studio, "proposal_lines").filter((l) => l["document_id"] === draft.id);
    ok(
      await act.sendProposal(
        { id: draft.id, client: { id: 1 }, title: "Shopfront identity", scope: null, split: "5050", valid_until: "2026-08-25", terms_version_id: 3, revision_of: 3, lines: copied.map((l) => ({ id: l["id"] as number, description: String(l["description"]), qty: String(l["qty"]), rate: String(l["rate"]) })) },
        { replacedReason: "Replaced by a revision" },
      ),
    );
    expect(trail().slice(-2)).toEqual(["update proposals", "update proposals"]);
    expect(studio.writes.at(-1)).toMatchObject({ id: 3, values: { status: "withdrawn", withdraw_reason: "Replaced by a revision" } });
  });

  it("leaves a declined original its own decision when a revision of it is sent", async () => {
    const draft = ok(await act.makeRevision(3));
    const declined = { ...useDesk.getState().rows.proposals[3]!, status: "declined" as const };
    upsertAll("proposals", [declined]);
    const copied = tableOf(studio, "proposal_lines").filter((l) => l["document_id"] === draft.id);
    ok(
      await act.sendProposal(
        { id: draft.id, client: { id: 1 }, title: "Shopfront identity", scope: null, split: "5050", valid_until: "2026-08-25", terms_version_id: 3, revision_of: 3, lines: copied.map((l) => ({ id: l["id"] as number, description: String(l["description"]), qty: String(l["qty"]), rate: String(l["rate"]) })) },
        { replacedReason: "Replaced by a revision" },
      ),
    );
    expect(studio.writes.filter((w) => w.id === 3)).toEqual([]);
  });

  it("sends a reminder, extends, and withdraws", async () => {
    ok(await act.sendProposalReminder(3));
    ok(await act.extendProposal(3, "2026-08-30"));
    ok(await act.withdrawProposal(3, " Budget moved "));
    expect(studio.writes.map((w) => [w.op, w.table, w.values])).toEqual([
      ["insert", "messages", expect.objectContaining({ kind: "proposal-reminder", status: "queued", proposal_id: 3, client_id: 1 })],
      ["update", "proposals", { valid_until: "2026-08-30" }],
      ["update", "proposals", { status: "withdrawn", withdraw_reason: "Budget moved" }],
    ]);
  });
});

describe("starting the work", () => {
  const start: act.StartProjectInput = {
    name: "Shopfront identity",
    milestones: [
      { title: "Mark", due_on: "2026-08-14" },
      { title: "Sign", due_on: "2026-08-28" },
    ],
    firstStage: { share_pct: "50", stage: "Deposit", title: "Shopfront identity — deposit", description: "Deposit, 50 %" },
  };

  beforeEach(async () => {
    ok(await acceptAndSign(3, "Amara Osei"));
    studio.writes.length = 0;
  });

  it("starts the project: the project, its milestones, the first stage's invoice draft, its line — in that order", async () => {
    const { project, invoice } = ok(await act.startProject(3, start));
    expect(trail()).toEqual(["insert projects", "insert milestones", "insert milestones", "insert invoices", "insert invoice_lines"]);
    expect(studio.writes[0]!.values).toMatchObject({ client_id: 1, proposal_id: 3, name: "Shopfront identity" });
    // The stage is taxed once, on the invoice, at the proposal's rate.
    expect(studio.writes[3]!.values).toMatchObject({ project_id: project.id, from_quote_id: 3, share_pct: "50", stage: "Deposit", tax_rate: row("proposals", 3)["tax_rate"] });
    // The line names the proposal; the rate and amount are the server's, from the proposal's stored subtotal (taxed once, on the invoice).
    expect(studio.writes[4]!.values).toMatchObject({ document_id: invoice.id, quote_id: 3 });
    expect(studio.writes[4]!.values).not.toHaveProperty("rate");
    expect(invoice.status).toBe("draft");
    // A stage is invoiced before tax: half the proposal's SUBTOTAL, taxed once on the invoice.
    expect(Number(invoice.subtotal)).toBeCloseTo(Number(row("proposals", 3)["subtotal"]) / 2, 2);
    expect(invoice.tax_rate).toBe(row("proposals", 3)["tax_rate"]);
    expect(new Set(keys()).size).toBe(5);
  });

  it("stops at the line, then finishes it — one project, one invoice, one line", async () => {
    studio.failWrite(5, "before");
    const first = await act.startProject(3, start);
    if (first.ok || first.unfinished === null) throw new Error("expected an unfinished action");
    expect(first.unfinished.step).toBe("line");
    expect(first.unfinished.finished).toBe(4);
    ok(await first.unfinished.resume());
    expect(tableOf(studio, "projects").filter((p) => p["proposal_id"] === 3)).toHaveLength(1);
    expect(tableOf(studio, "invoices").filter((i) => i["from_quote_id"] === 3)).toHaveLength(1);
    expect(tableOf(studio, "invoice_lines").filter((l) => l["quote_id"] === 3)).toHaveLength(1);
  });

  it("drafts the next stage (the draft, then its line), and never past the whole proposal", async () => {
    ok(await act.draftStageInvoice(1, { share_pct: "30", stage: "Handover", title: "Packaging system — handover", description: "Handover, 30 %" }));
    expect(trail()).toEqual(["insert invoices", "insert invoice_lines"]);
    const over = await act.draftStageInvoice(1, { share_pct: "5", stage: "Extra", title: "Extra", description: "Extra" });
    expect(over).toMatchObject({ ok: false, reason: "over-share" });
    expect(trail()).toHaveLength(2);
  });

  it("makes a project with no proposal: the project, then its first milestone", async () => {
    ok(await act.newProject({ client_id: 4, name: "Signage", milestone: { title: "Survey", due_on: null } }));
    expect(trail()).toEqual(["insert projects", "insert milestones"]);
  });

  it("pauses with a note, resumes, marks done and reopens", async () => {
    ok(await act.moveProject(2, "pause", " Waiting on photos "));
    ok(await act.moveProject(2, "resume"));
    ok(await act.moveProject(2, "done"));
    ok(await act.moveProject(2, "reopen"));
    expect(studio.writes.map((w) => w.values)).toEqual([{ status: "paused", pause_note: "Waiting on photos" }, { status: "active", pause_note: null }, { status: "done" }, { status: "active", done_on: null }]);
    expect(row("projects", 2)["done_on"]).toBeNull();
  });

  it("adds, edits, ticks and removes a milestone", async () => {
    const m = ok(await act.addMilestone(2, { title: "Print", due_on: "2026-08-20", position: 2 }));
    ok(await act.editMilestone(m.id, { title: " Print run " }));
    ok(await act.setMilestoneState(m.id, "done"));
    ok(await act.removeMilestone(m.id));
    expect(trail()).toEqual(["insert milestones", "update milestones", "update milestones", "remove milestones"]);
    expect(studio.writes[1]!.values).toEqual({ title: "Print run" });
    expect(studio.writes[2]!.values).toEqual({ state: "done" });
  });
});

describe("deliverables", () => {
  const file = { file: new Blob(["pdf"], { type: "application/pdf" }), filename: "window-b.pdf" };

  it("adds one and shares it: the deliverable, its file, version 1, and shared last", async () => {
    const d = ok(await act.addDeliverable(2, { title: "Window sketch C", milestone_id: 4, position: 2, content: file, note: "Winter", share: true }));
    expect(trail()).toEqual(["insert deliverables", "upload deliverable_versions", "insert deliverable_versions", "update deliverables"]);
    expect(studio.writes[2]!.values).toMatchObject({ deliverable_id: d.id, file: "demo-file:window-b.pdf", note: "Winter" });
    expect(studio.writes[3]!.values).toEqual({ status: "pending" });
    expect(d.status).toBe("pending");
    expect(tableOf(studio, "deliverable_versions").find((v) => v["deliverable_id"] === d.id)?.["v"]).toBe(1);
  });

  it("saves one unshared, with a link instead of a file", async () => {
    ok(await act.addDeliverable(2, { title: "Moodboard", milestone_id: null, position: 3, content: { link: "https://files.outline.example/mood" }, note: null, share: false }));
    expect(trail()).toEqual(["insert deliverables", "insert deliverable_versions"]);
  });

  it("posts a new version (the file, the version) and sends it back for review", async () => {
    const { version } = ok(await act.postVersion(3, file, "Bigger loaf"));
    expect(trail()).toEqual(["upload deliverable_versions", "insert deliverable_versions", "update deliverables"]);
    expect(version.v).toBe(2);
    expect(row("deliverables", 3)["status"]).toBe("pending");
  });

  it("shares, notes, and marks approved (how and when)", async () => {
    ok(await act.shareDeliverable(4));
    ok(await act.addStudioNote(3, { version_id: 3, body: " On it ", pin_x: "0.5", pin_y: "0.5" }));
    ok(await act.markApproved(3, "email", "2026-07-28"));
    expect(studio.writes.map((w) => [w.op, w.table, w.values])).toEqual([
      ["update", "deliverables", { status: "pending" }],
      ["insert", "deliverable_notes", expect.objectContaining({ deliverable_id: 3, version_id: 3, body: "On it", pin_x: "0.5", pin_y: "0.5" })],
      ["update", "deliverables", { status: "approved", approved_how: "email", approved_on: "2026-07-28" }],
    ]);
  });
});

describe("invoices", () => {
  it("makes a new invoice and its first line; its number is the server's", async () => {
    const inv = ok(await act.saveInvoice({ id: null, client_id: 3, project_id: null, title: "Menu reprint", terms: "net14", lines: [lines[0]!] }));
    expect(trail()).toEqual(["insert invoices", "insert invoice_lines"]);
    expect(inv).toMatchObject({ number: "INV-2042", status: "draft", subtotal: "1200.00", issued_on: null });
  });

  it("sends: saved, then the move to sent (issued and due are the server's stamps)", async () => {
    const inv = ok(await act.sendInvoice({ id: 7, client_id: 4, project_id: null, title: "Mark files, extra formats", lines: [{ id: 7, description: "Extra file formats", qty: "2", rate: "90.00" }] }));
    expect(trail()).toEqual(["update invoices", "update invoice_lines", "update invoices"]);
    expect(inv).toMatchObject({ status: "sent", issued_on: "2026-07-28", due_on: "2026-08-11" });
  });

  it("records a payment (one create, its receipt number the server's) and reads the balance back", async () => {
    const { payment, invoice } = ok(await act.recordPayment(4, { amount: "500.00", method: "bank-transfer", paid_on: "2026-07-28" }));
    expect(trail()).toEqual(["insert payments"]);
    expect(studio.writes[0]!.values).toMatchObject({ document_id: 4, amount: "500.00", method: "bank-transfer", paid_on: "2026-07-28", method_note: null });
    expect(payment.number).toBe("REC-0018");
    expect(Number(invoice.balance)).toBeCloseTo(Number(invoice.total) - 500, 2);
  });

  it("refuses a payment over the balance, and reads the invoice again", async () => {
    const over = await act.recordPayment(4, { amount: "99999.00", method: "card", paid_on: "2026-07-28" });
    expect(over).toMatchObject({ ok: false, reason: "balance", code: "BALANCE_EXCEEDED" });
  });

  it("finishes a payment whose answer was lost, recording it once", async () => {
    studio.failWrite(1, "after");
    const first = await act.recordPayment(6, { amount: "100.00", method: "card", paid_on: "2026-07-28" });
    if (first.ok || first.unfinished === null) throw new Error("expected an unfinished payment");
    ok(await first.unfinished.resume());
    expect(tableOf(studio, "payments").filter((p) => p["document_id"] === 6)).toHaveLength(1);
  });

  it("voids a payment, voids an unpaid invoice, discards a draft, and sets the ladder", async () => {
    ok(await act.voidPayment(2, " Bounced "));
    ok(await act.voidInvoice(6, "Sent twice"));
    ok(await act.discardDraft(7));
    ok(await act.setLadder(4, "gentle"));
    expect(studio.writes.map((w) => [w.table, w.id, w.values])).toEqual([
      ["payments", 2, { voided: true, void_reason: "Bounced" }],
      ["invoices", 6, { status: "void", void_reason: "Sent twice" }],
      ["invoices", 7, { status: "void", void_reason: act.DISCARDED_DRAFT }],
      ["invoices", 4, { ladder: "gentle" }],
    ]);
  });

  it("refuses to void an invoice with money paid", async () => {
    expect(await act.voidInvoice(2, "Oops")).toMatchObject({ ok: false, reason: "moved", code: "STATE_MOVE_REFUSED" });
  });
});

describe("chasing", () => {
  it("approves, edits, sends early and skips a held rung", async () => {
    ok(await act.editRung(3, { subject: "A reminder", body: "Could you look at INV-2038?" }));
    ok(await act.approveRung(2, { subject: null, body: " Thank you " }));
    ok(await act.sendRungEarly(3));
    ok(await act.skipRung(4));
    expect(studio.writes.map((w) => [w.id, w.values])).toEqual([
      [3, { subject_override: "A reminder", body_override: "Could you look at INV-2038?" }],
      [2, { status: "queued", subject_override: null, body_override: "Thank you" }],
      [3, { status: "queued", due: expect.stringMatching(/^2026-07-28T14:00:00/) }],
      [4, { status: "skipped" }],
    ]);
  });

  it("sends all: only the rungs that are due, one per invoice", async () => {
    expect(act.readyRungs().map((m) => m.id).sort()).toEqual([2, 4]);
    ok(await act.sendAllReady());
    expect(studio.writes.map((w) => [w.id, w.values])).toEqual([
      [2, { status: "queued" }],
      [4, { status: "queued" }],
    ]);
  });

  it("when two rungs of one invoice are due, sends the later one — it overtakes the earlier", () => {
    // 11 August: INV-2038's second (27 Jul) and third (10 Aug) rungs are both due.
    const later = Date.parse("2026-08-11T15:00:00.000Z");
    expect(act.readyRungs(later).find((m) => m.invoice_id === 4)?.id).toBe(3);
  });
});

describe("marking a project done", () => {
  it("closes the open milestones, then the project — and finishes from the step whose answer was lost", async () => {
    studio.failWrite(2, "after");
    const first = await act.markProjectDone(1);
    if (first.ok || first.unfinished === null) throw new Error("expected an unfinished action");
    expect(row("projects", 1)["status"]).toBe("active");
    ok(await first.unfinished.resume());
    // The first milestone is not sent again; the one whose answer was lost is (the same value), then the project.
    expect(studio.writes.map((w) => `${w.op} ${w.table} ${String(w.id)}`)).toEqual(["update milestones 2", "update milestones 3", "update milestones 3", "update projects 1"]);
    expect(row("projects", 1)).toMatchObject({ status: "done" });
  });
});

describe("the handover", () => {
  it("notes, fonts, files, the link's expiry, stopping it, a new link, and sending it", async () => {
    ok(await act.saveHandoverNotes(4, "Keep the mark at 20 mm."));
    const font = ok(await act.addFont(4, { name: "Söhne", licence: "Desktop, 2 seats", position: 0 }));
    ok(await act.editFont(font.id, { licence: "Desktop, 3 seats" }));
    ok(await act.removeFont(font.id));
    const f = ok(await act.addHandoverFile(4, { file: new Blob(["x"]), filename: "mark.zip", note: null, position: 0 }));
    ok(await act.removeHandoverFile(f.id));
    ok(await act.setShareExpiry(4, null));
    ok(await act.stopShareLink(4));
    ok(await act.newShareLink(4));
    ok(await act.sendHandover(4));
    expect(trail()).toEqual([
      "update projects",
      "insert project_fonts",
      "update project_fonts",
      "remove project_fonts",
      "upload handover_files",
      "insert handover_files",
      "remove handover_files",
      "update projects",
      "update projects",
      "regenerate projects",
      "update projects",
      "insert messages",
      "update projects",
    ]);
    expect(studio.writes[8]!.values).toEqual({ share_stopped: true });
    expect(studio.writes[10]!.values).toEqual({ share_stopped: false });
    expect(studio.writes[11]!.values).toMatchObject({ kind: "handover", project_id: 4, client_id: 4 });
    expect(studio.writes[12]!.values).toEqual({ handover_sent: true });
    expect(row("projects", 4)["share_token"]).not.toBe("KILNSTREETDONE26");
  });
});

describe("clients, terms and settings", () => {
  it("adds a client, refuses an address another has, edits, and keeps a private note", async () => {
    ok(await act.addClient({ company: "Park Florist", contact_name: "Dee Park", email: "dee@park.example" }));
    expect(await act.addClient({ company: "Copy", contact_name: "X", email: "amara@hearth.example" })).toMatchObject({ ok: false, reason: "duplicate", field: "email" });
    ok(await act.editClient(1, { phone: " ", terms: "net30" }));
    ok(await act.addClientNote(1, " Call first "));
    expect(studio.writes.map((w) => [w.op, w.table])).toEqual([
      ["insert", "clients"],
      ["insert", "clients"],
      ["update", "clients"],
      ["insert", "client_notes"],
    ]);
    expect(studio.writes[2]!.values).toEqual({ phone: null, terms: "net30" });
  });

  it("writes a new terms version with its clauses, then puts it in force (the old one retires first)", async () => {
    const v = ok(await act.newTermsVersion({ in_force_from: "2026-09-01", note: "Shorter", clauses: [{ title: "What we make", body: "The work.", change: "same", change_note: null }] }));
    expect(v.version).toBe(4);
    ok(await act.putTermsInForce(v.id));
    expect(trail()).toEqual(["insert terms_versions", "insert terms_clauses", "update terms_versions", "update terms_versions"]);
    expect(studio.writes[2]).toMatchObject({ id: 3, values: { status: "retired" } });
    expect(studio.writes[3]).toMatchObject({ id: v.id, values: { status: "in_force" } });
  });

  it("puts a version with no start day in force from today, and edits a version's note and day", async () => {
    const v = ok(await act.newTermsVersion({ in_force_from: null, note: null, clauses: [] }));
    ok(await act.editTermsVersion(v.id, { note: " Clearer kill fee ", in_force_from: null }));
    ok(await act.putTermsInForce(v.id));
    expect(studio.writes.slice(1).map((w) => [w.id, w.values])).toEqual([
      [v.id, { note: "Clearer kill fee", in_force_from: null }],
      [3, { status: "retired" }],
      [v.id, { status: "in_force", in_force_from: "2026-07-28" }],
    ]);
  });

  it("uploads the studio's mark, then points the settings at it — last", async () => {
    const saved = ok(await act.saveStudioMark(new Blob(["png"], { type: "image/png" }), "mark.png"));
    expect(trail()).toEqual(["upload settings", "update settings"]);
    expect(studio.writes[0]!.values).toEqual({ column: "mark", filename: "mark.png" });
    expect(saved.mark).toBe("demo-file:mark.png");
  });

  it("asks a client to sign, and saves the studio's settings and the add-on's", async () => {
    ok(await act.askToSign(2));
    ok(await act.saveStudioSettings({ phone: "+1 555 0100", notify_notes: false }));
    ok(await act.saveInvoiceSettings({ tax_name: "Sales tax" }));
    ok(await act.saveRate(null, { label: "Half day", amount: "390.00", position: 3, active: true }));
    ok(await act.savePerson(1, { role_label: "Partner" }));
    expect(studio.writes.map((w) => [w.op, w.table, w.values])).toEqual([
      ["insert", "messages", expect.objectContaining({ kind: "ask-to-sign", proposal_id: 2, client_id: 2 })],
      ["update", "settings", { phone: "+1 555 0100", notify_notes: false }],
      ["settings", "add-on", { key: "invoices", tax_name: "Sales tax" }],
      ["insert", "rates", { label: "Half day", amount: "390.00", position: 3, active: true }],
      ["update", "people", { role_label: "Partner" }],
    ]);
  });
});
