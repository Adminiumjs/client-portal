/**
 * The "add" sheet's kinds: what each starts with, what it checks before a
 * round trip, and the writes its save makes, in order — the invoice and its
 * first line, the project and its first milestone, a client with one contact,
 * a call as an unanswered enquiry, a person, a rate.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { addClient, logCall, newProject, saveInvoice, savePerson, saveRate } from "../../state/actions.ts";
import { fakeStudio, type FakeStudio } from "../../testing/fakeStudio.ts";
import { clientEditInput, clientInput, defaults, editing, enquiryInput, initialsOf, invoiceInput, personInput, positive, projectInput, rateInput, validate, type Values } from "./spec.ts";

const seed = { clientId: 2, projectId: null, firstMilestone: "Kickoff & schedule" };

let studio: FakeStudio;
beforeEach(async () => {
  studio = await fakeStudio();
});

describe("what each kind starts with", () => {
  it("a new invoice takes the client's own terms, else the studio's; a project's first milestone is a week out", () => {
    expect(defaults("invoice", { ...seed, clientTerms: "net30" }, "2026-07-28")).toMatchObject({ client: "2", terms: "net30", qty: "1", rate: "" });
    expect(defaults("invoice", { ...seed, clientTerms: null }, "2026-07-28")).toMatchObject({ terms: "studio" });
    expect(defaults("project", seed, "2026-07-28")).toEqual({ client: "2", name: "", milestone: "Kickoff & schedule", due: "2026-08-04" });
    expect(defaults("milestone", { ...seed, projectId: 1 }, "2026-07-28")).toEqual({ project: "1", title: "", due: "2026-08-18" });
  });

  it("an edit starts from the row as stored; a new person starts hidden from clients", () => {
    expect(defaults("clientEdit", { ...seed, row: { address: "14 Mill Lane", tax_number: null, terms: "net14", tax_rate: "0" } })).toEqual({ address: "14 Mill Lane", tax_number: "", terms: "net14", tax_rate: "0" });
    expect(defaults("clientEdit", { ...seed, row: { terms: null } })["terms"]).toBe("studio");
    expect(defaults("person", seed)["shown"]).toBe(false);
    expect(defaults("rate", { ...seed, row: { label: "Design day", amount: "780.00", hours_per_unit: "6" } })).toEqual({ label: "Design day", amount: "780.00", hours: "6" });
  });

  it("knows an edit from an add", () => {
    expect(editing("clientEdit", { clientId: 1 })).toBe(true);
    expect(editing("person", {})).toBe(false);
    expect(editing("person", { personId: 1 })).toBe(true);
    expect(editing("rate", { rateId: 2 })).toBe(true);
    expect(editing("milestone", { projectId: 1 })).toBe(false);
  });
});

describe("what each kind checks", () => {
  it("a new invoice needs a client and a title; a rate above zero or none; a quantity above zero", () => {
    expect(validate("invoice", { client: "", title: " ", qty: "1", rate: "" })).toEqual({ client: "sheets.add.noClient", title: "sheets.add.invoice.titleMissing" });
    expect(validate("invoice", { client: "2", title: "Print", qty: "0", rate: "-5" })).toEqual({ qty: "sheets.add.invoice.qtyBad", rate: "sheets.add.invoice.rateBad" });
    expect(validate("invoice", { client: "2", title: "Print", qty: "1.5", rate: "240.5" })).toEqual({});
  });

  it("a project needs a name and a date; a client a name and an address that reaches someone", () => {
    expect(validate("project", { client: "2", name: "", milestone: "", due: "" })).toEqual({ name: "sheets.add.project.nameMissing", due: "sheets.add.dateMissing" });
    expect(validate("client", { company: "", email: "rosa@" })).toEqual({ company: "sheets.add.client.companyMissing", email: "sheets.add.client.emailBad" });
  });

  it("a client's tax rate is blank or 0 to 100; a call needs who it was", () => {
    expect(validate("clientEdit", { tax_rate: "101" })).toEqual({ tax_rate: "sheets.add.clientEdit.taxBad" });
    expect(validate("clientEdit", { tax_rate: "" })).toEqual({});
    expect(validate("clientEdit", { tax_rate: "0" })).toEqual({});
    expect(validate("enquiry", { business: "", email: "" })).toEqual({ business: "sheets.add.enquiry.businessMissing" });
    expect(validate("enquiry", { business: "Alderman", email: "kit@" })).toEqual({ email: "sheets.add.client.emailBad" });
  });

  it("a milestone needs a project, a name and a date; a person a name; a rate a name, an amount, and hours above zero if any", () => {
    expect(validate("milestone", { project: "", title: "", due: "x" })).toEqual({ project: "sheets.add.milestone.projectMissing", title: "sheets.add.milestone.titleMissing", due: "sheets.add.dateMissing" });
    expect(validate("person", { name: "" })).toEqual({ name: "sheets.add.person.nameMissing" });
    expect(validate("rate", { label: "", amount: "0", hours: "-1" })).toEqual({ label: "sheets.add.rate.labelMissing", amount: "sheets.add.rate.amountBad", hours: "sheets.add.rate.hoursBad" });
    expect(positive("1,250.50", 2)).toBe("1250.50");
  });
});

describe("what each kind saves", () => {
  it("a new invoice: the draft, then its first line (the title when no line was typed) — Adminium numbers it", async () => {
    const v: Values = { client: "2", project: "1", title: "Print checks", terms: "net30", desc: "", qty: "3", rate: "240" };
    const from = studio.writes.length;
    const out = await saveInvoice(invoiceInput(v));
    expect(out.ok).toBe(true);
    const writes = studio.writes.slice(from);
    expect(writes.map((w) => [w.op, w.table])).toEqual([
      ["insert", "invoices"],
      ["insert", "invoice_lines"],
    ]);
    expect(writes[0]!.values).toMatchObject({ client_id: 2, project_id: 1, title: "Print checks", terms: "net30" });
    expect(writes[1]!.values).toMatchObject({ description: "Print checks", qty: "3", rate: "240", position: 0 });
    expect(out.ok && out.value.number).toMatch(/^INV-\d{4}$/);
  });

  it("a new invoice with no rate: only the draft; and the studio's terms are left to Adminium", async () => {
    const from = studio.writes.length;
    await saveInvoice(invoiceInput({ client: "2", project: "", title: "Survey", terms: "studio", desc: "", qty: "1", rate: "" }));
    const writes = studio.writes.slice(from);
    expect(writes.map((w) => w.table)).toEqual(["invoices"]);
    expect(writes[0]!.values).not.toHaveProperty("terms");
    expect(writes[0]!.values).toMatchObject({ project_id: null });
  });

  it("a new project: the project, then its first milestone (named for the studio when left blank)", async () => {
    const from = studio.writes.length;
    const out = await newProject(projectInput({ client: "4", name: "Kiln shop signs", milestone: "", due: "2026-08-04" }, "Kickoff & schedule"));
    expect(out.ok).toBe(true);
    const writes = studio.writes.slice(from);
    expect(writes.map((w) => w.table)).toEqual(["projects", "milestones"]);
    expect(writes[0]!.values).toMatchObject({ client_id: 4, name: "Kiln shop signs" });
    expect(writes[0]!.values).not.toHaveProperty("proposal_id");
    expect(writes[1]!.values).toMatchObject({ title: "Kickoff & schedule", due_on: "2026-08-04", position: 0 });
  });

  it("a client: one contact, the business's name when none is given", async () => {
    const out = await addClient(clientInput({ company: "Vento & Sons", trade: "", contact: "", email: "rosa@vento.example", address: "", tax_number: "" }));
    expect(out.ok).toBe(true);
    expect(studio.writes.at(-1)!.values).toMatchObject({ company: "Vento & Sons", contact_name: "Vento & Sons", email: "rosa@vento.example", trade: null, address: null });
    const again = await addClient(clientInput({ company: "Vento again", email: "rosa@vento.example" }));
    expect(again.ok === false && again.reason).toBe("duplicate");
  });

  it("a client's print details: the studio's terms are none of their own", () => {
    expect(clientEditInput({ address: " 14 Mill Lane ", tax_number: "", terms: "studio", tax_rate: "" })).toEqual({ address: "14 Mill Lane", tax_number: null, terms: null, tax_rate: null });
    expect(clientEditInput({ address: "", tax_number: "", terms: "net7", tax_rate: "0" })).toMatchObject({ terms: "net7", tax_rate: "0" });
  });

  it("a call: an unanswered enquiry, from the phone, with the budget said (or none)", async () => {
    const words = { source: "Phone call", budget: (b: string) => ({ "2to4k": "2–4k", under1k: "Under 1k", "5to8k": "5–8k", "10kplus": "10k+", notStated: "Not stated" })[b]! };
    expect(enquiryInput({ business: "Alderman Cycles", name: "", email: "", budget: "notStated", body: "" }, words)).toEqual({ name: "Alderman Cycles", business: "Alderman Cycles", email: null, budget: null, source: "Phone call", fit: "maybe", body: null });
    const out = await logCall(enquiryInput({ business: "Alderman Cycles", name: "Kit", email: "kit@alderman.example", budget: "5to8k", body: "Signs" }, words));
    expect(out.ok).toBe(true);
    expect(studio.writes.at(-1)).toMatchObject({ op: "insert", table: "enquiries", values: { business: "Alderman Cycles", name: "Kit", budget: "5–8k", source: "Phone call", fit: "maybe" } });
    expect(out.ok && out.value.status).toBe("new");
  });

  it("a person: initials in capitals, three at most; hidden from clients unless switched on", async () => {
    expect(initialsOf(" am ")).toBe("AM");
    expect(initialsOf("abcd")).toBe("ABC");
    const out = await savePerson(null, personInput({ name: "Ada Moreno", role_label: "Designer", initials: "am", shown: false }, 2));
    expect(out.ok).toBe(true);
    expect(studio.writes.at(-1)).toMatchObject({ op: "insert", table: "people", values: { name: "Ada Moreno", role_label: "Designer", initials: "AM", shown_to_clients: false, position: 2 } });
  });

  it("a rate: two places, hours if any; an edit leaves its place alone", async () => {
    expect(rateInput({ label: "Visit", amount: "200", hours: "" }, 3)).toEqual({ label: "Visit", amount: "200.00", hours_per_unit: null, position: 3, active: true });
    expect(rateInput({ label: "Day", amount: "780.5", hours: "6" }, null)).toEqual({ label: "Day", amount: "780.50", hours_per_unit: "6" });
    const out = await saveRate(1, rateInput({ label: "Design day", amount: "800", hours: "6" }, null));
    expect(out.ok).toBe(true);
    expect(studio.writes.at(-1)).toEqual({ op: "update", table: "rates", id: 1, values: { label: "Design day", amount: "800.00", hours_per_unit: "6" } });
  });
});
