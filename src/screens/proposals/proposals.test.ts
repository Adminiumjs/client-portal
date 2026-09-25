/**
 * Proposals, worked out from stored rows: the word a pill says, which
 * filter a proposal is under ("Sent" counts the ones still in date), which
 * buttons each state offers, which stage is invoiced next (from the stage
 * invoices that exist, a void one not counted), the milestones a project
 * starts with, and the version and fingerprint a signature names. Then what
 * the sheets save: Start the project writes the project, its milestones
 * soonest first, the first stage's draft for the agreed share and its line;
 * Invoice the next stage the next share; Extend refuses a day that is not
 * later.
 */
import { beforeEach, describe, expect, it } from "vitest";

import * as act from "../../state/actions.ts";
import type { Invoice, Proposal } from "../../data/types.ts";
import { acceptAndSign } from "../../state/clientActions.ts";
import { loadProposal, refreshRows, useDesk } from "../../state/desk.ts";
import { fakeStudio, type FakeStudio } from "../../testing/fakeStudio.ts";
import { defaultMilestones, inFilter, isOutOfDate, nextStage, proposalState, proposalWord, shortFingerprint, stageInvoices, termsVersionLabel, PROPOSAL_FILTERS } from "./model.ts";
import { extendDefault, extendMin, extendProblem, newMilestoneRow, reasonMissing, stageInput, startInput, startProblem } from "./sheetModel.ts";

/** The words the sheets store, as the English page would say them. */
const EN: Record<string, string> = {
  "proposals.stage.toStart": "to start",
  "proposals.stage.midway": "midway",
  "proposals.stage.onDelivery": "on delivery",
  "proposals.stageName.toStart": "Deposit",
  "proposals.stageName.midway": "Midway",
  "proposals.stageName.onDelivery": "Delivery",
  "proposals.stageTitle": "{title} — {pct} % {stage}",
  "proposals.stageTitleNoName": "{pct} % {stage}",
};
const t = ((key: string, params: Record<string, string | number> = {}) => (EN[key] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? ""))) as never;

let studio: FakeStudio;
const today = "2026-07-28";
const p = (id: number): Proposal => useDesk.getState().rows.proposals[id]!;
const invoices = (): Invoice[] => Object.values(useDesk.getState().rows.invoices);

beforeEach(async () => {
  studio = await fakeStudio();
});

describe("what a proposal's state says", () => {
  it("names each state, and a sent one past its day is out of date", () => {
    expect([1, 2, 3, 4].map((id) => proposalWord(p(id), today))).toEqual(["declined", "accepted", "sent", "draft"]);
    const late = { ...p(3), valid_until: "2026-07-27" };
    expect(isOutOfDate(late, today)).toBe(true);
    expect(proposalWord(late, today)).toBe("outOfDate");
    expect(isOutOfDate({ ...p(3), valid_until: today }, today)).toBe(false);
  });

  it("files out-of-date proposals under their own filter, not under Sent", () => {
    const late = { ...p(3), valid_until: "2026-07-01" };
    expect(PROPOSAL_FILTERS.filter((f) => inFilter(late, f, today))).toEqual(["all", "outOfDate"]);
    expect(PROPOSAL_FILTERS.filter((f) => inFilter(p(3), f, today))).toEqual(["all", "sent"]);
  });

  it("offers each state its own buttons", () => {
    const live = proposalState(p(3), today, null, invoices());
    expect(live).toMatchObject({ live: true, sent: true, outOfDate: false, canRevise: false, canPreview: true, needsProject: false });
    const late = proposalState({ ...p(3), valid_until: "2026-07-01" }, today, null, invoices());
    expect(late).toMatchObject({ live: false, sent: true, outOfDate: true, canRevise: true });
    expect(proposalState(p(1), today, null, invoices())).toMatchObject({ note: "declined", canRevise: true, canPreview: false });
    expect(proposalState({ ...p(1), status: "withdrawn" }, today, null, invoices())).toMatchObject({ note: "withdrawn" });
    expect(proposalState(p(4), today, null, invoices())).toMatchObject({ draft: true, canPreview: false });
    const project = useDesk.getState().rows.projects[1]!;
    expect(proposalState(p(2), today, project, invoices())).toMatchObject({ signed: true, needsProject: false, firstInvoiceMissing: false });
    expect(proposalState(p(2), today, null, invoices())).toMatchObject({ needsProject: true });
    expect(proposalState({ ...p(2), signed_name: null, accepted_how: "email" }, today, project, invoices())).toMatchObject({ signed: false, unsigned: true });
  });

  it("says the first invoice is missing when a project started and no stage invoice exists", () => {
    const project = useDesk.getState().rows.projects[1]!;
    const withoutStages = invoices().filter((i) => i.from_quote_id !== 2);
    expect(proposalState(p(2), today, project, withoutStages).firstInvoiceMissing).toBe(true);
  });

  it("names the terms version by its number, or its place when it has none; shortens a fingerprint", () => {
    const versions = Object.values(useDesk.getState().rows.terms_versions);
    expect(termsVersionLabel(versions.find((v) => v.id === 3), versions)).toBe(3);
    const unnumbered = versions.map((v) => ({ ...v, version: null }));
    expect(termsVersionLabel(unnumbered.find((v) => v.id === 2), unnumbered)).toBe(2);
    expect(termsVersionLabel(undefined, versions)).toBeNull();
    expect(shortFingerprint("3f9a0c77d2e1b4aa9c21e")).toBe("3f9a…c21e");
    expect(shortFingerprint(null)).toBeNull();
  });
});

describe("the stages of the agreed split", () => {
  it("invoices the next stage from the stage invoices that exist, a void one not counted", async () => {
    await loadProposal(2);
    expect(stageInvoices(2, invoices()).map((i) => i.number)).toEqual(["INV-2036", "INV-2037"]);
    expect(nextStage(p(2), invoices())).toEqual({ index: 2, share: "30", name: "onDelivery" });
    const voided = invoices().map((i) => (i.id === 3 ? { ...i, status: "void" as const } : i));
    expect(nextStage(p(2), voided)).toEqual({ index: 1, share: "30", name: "midway" });
    const all = [...invoices(), { ...invoices()[0]!, id: 99, from_quote_id: 2, status: "draft" as const }];
    expect(nextStage(p(2), all)).toBeNull();
  });

  it("starts a project with a kickoff in a week, then one milestone per stage three weeks apart", () => {
    expect(defaultMilestones("403030", today)).toEqual([
      { name: "kickoff", due: "2026-08-04" },
      { name: "firstStage", due: "2026-08-25" },
      { name: "midwayReview", due: "2026-09-15" },
      { name: "delivery", due: "2026-10-06" },
    ]);
    expect(defaultMilestones("end", today).map((m) => m.name)).toEqual(["kickoff", "delivery"]);
  });
});

describe("what the proposal's sheets save", () => {
  const trail = () => studio.writes.map((w) => `${w.op} ${w.table}`);

  it("Extend: a day after the later of its valid-until and today, two weeks on to start with", () => {
    expect(extendMin(p(3), today)).toBe("2026-08-13");
    expect(extendDefault(p(3), today)).toBe("2026-08-26");
    const late = { ...p(3), valid_until: "2026-07-01" };
    expect(extendMin(late, today)).toBe("2026-07-29");
    expect(extendProblem("", p(3), today)).toEqual({ key: "pickDate" });
    expect(extendProblem("2026-08-12", p(3), today)).toEqual({ key: "pickAfter", after: "2026-08-12" });
    expect(extendProblem("2026-08-13", p(3), today)).toBeNull();
    expect(reasonMissing("  ")).toBe(true);
  });

  it("Start the project: the project, its milestones soonest first, the first share's draft and its line", async () => {
    // The client accepts and signs: the proposal the studio then starts from.
    const accepted = await acceptAndSign(3, "Amara Osei");
    if (!accepted.ok) throw new Error(accepted.reason);
    await refreshRows("proposals", [3]);
    studio.writes.length = 0;
    const rows = [newMilestoneRow("Delivery", "2026-09-15"), newMilestoneRow("Kickoff & schedule", "2026-08-04"), newMilestoneRow(" Halfway review ", "2026-08-25")];
    expect(startProblem("", rows)).toBe("name");
    expect(startProblem("Shopfront", [...rows, newMilestoneRow("", "2026-09-01")])).toBe("milestones");
    const stage = nextStage(p(3), invoices())!;
    const input = startInput(p(3), " Shopfront ", rows, stage, t);
    expect(input.milestones.map((m) => m.title)).toEqual(["Kickoff & schedule", "Halfway review", "Delivery"]);
    expect(input.firstStage).toEqual({ share_pct: "50", stage: "Deposit", title: "Shopfront identity — 50 % to start", description: "Shopfront identity — 50 % to start" });
    const out = await act.startProject(3, input);
    if (!out.ok) throw new Error(out.reason);
    expect(trail()).toEqual(["insert projects", "insert milestones", "insert milestones", "insert milestones", "insert invoices", "insert invoice_lines"]);
    expect(studio.writes[4]!.values).toMatchObject({ from_quote_id: 3, share_pct: "50", stage: "Deposit" });
    expect(studio.writes[4]!.values).not.toHaveProperty("status");
    expect(studio.writes[5]!.values).not.toHaveProperty("rate");
    expect(out.value.invoice.status).toBe("draft");
    expect(out.value.invoice.number).toMatch(/^INV-/);
  });

  it("Invoice the next stage: the next share of the agreed split, named in the studio's words", async () => {
    await loadProposal(2);
    const stage = nextStage(p(2), invoices())!;
    const input = stageInput(p(2), stage, t);
    expect(input).toEqual({ share_pct: "30", stage: "Delivery", title: "Packaging system — 30 % on delivery", description: "Packaging system — 30 % on delivery" });
    studio.writes.length = 0;
    const out = await act.draftStageInvoice(1, input);
    if (!out.ok) throw new Error(out.reason);
    expect(trail()).toEqual(["insert invoices", "insert invoice_lines"]);
    expect(nextStage(p(2), invoices())).toBeNull();
  });
});
