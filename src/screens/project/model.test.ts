/**
 * What the board and one project work out: the ring, what comes next, the
 * board's groups, a deliverable card's date, whether a stage is left to
 * invoice, the invoice chips (a void one never reads "paid"), the brief.
 */
import { describe, expect, it } from "vitest";

import type { Brief, BriefAnswer, BriefQuestion, Deliverable, Invoice, Milestone, Project, Proposal } from "../../data/types.ts";
import { boardGroups, briefRows, cardDate, deliverablePill, firstName, invoiceChips, lastDue, milestonesOf, nextMilestone, progress, ringDash, ringTone, stageLeft } from "./model.ts";

const ms = (id: number, state: Milestone["state"], position = id, due: string | null = `2026-08-${String(10 + id).padStart(2, "0")}`): Milestone => ({
  id,
  project_id: 1,
  client_id: 1,
  title: `M${String(id)}`,
  due_on: due,
  state,
  done_at: null,
  estimated_days: null,
  position,
  client_key: null,
});

const project = (patch: Partial<Project> = {}): Project => ({
  id: 1,
  number_seq: 1,
  number: "PRJ-01",
  client_id: 1,
  proposal_id: 9,
  name: "Packaging",
  status: "active",
  pause_note: null,
  started_on: "2026-06-01",
  done_on: null,
  share_token: "ABCDEFGHJKLMNPQR",
  share_expires_on: null,
  share_stopped: false,
  share_stopped_at: null,
  handover_notes: null,
  handover_sent: false,
  handover_sent_at: null,
  client_key: null,
  ...patch,
});

const invoice = (id: number, patch: Partial<Invoice>): Invoice =>
  ({ id, number: `INV-${String(id)}`, status: "sent", balance: "0.00", currency: "USD", project_id: 1, from_quote_id: 9, share_pct: null, ...patch }) as Invoice;

describe("the ring and what comes next", () => {
  it("counts a done milestone whole and the one in progress half", () => {
    expect(progress([ms(1, "done"), ms(2, "now"), ms(3, "next"), ms(4, "next")])).toBe(38);
    expect(progress([ms(1, "done"), ms(2, "done")])).toBe(100);
    expect(progress([])).toBe(0);
  });

  it("names the first milestone not done, in the studio's order (not the key order)", () => {
    const list = milestonesOf([ms(3, "next", 0), ms(1, "done", 1), ms(2, "now", 2)], 1);
    expect(list.map((m) => m.id)).toEqual([3, 1, 2]);
    expect(nextMilestone(list)?.id).toBe(3);
    expect(lastDue(list)).toBe("2026-08-13");
  });

  it("colours a paused project to wait, a finished one good, the rest in the accent", () => {
    expect(ringTone({ status: "paused" }, 100)).toBe("warn");
    expect(ringTone({ status: "active" }, 100)).toBe("pos");
    expect(ringTone({ status: "done" }, 40)).toBe("pos");
    expect(ringTone({ status: "active" }, 40)).toBe("accent");
    expect(ringDash(50)).toBe("48.70 97.39");
    expect(ringDash(140)).toBe("97.39 97.39");
  });
});

describe("the board", () => {
  it("groups by state, the newest first", () => {
    const groups = boardGroups([
      project({ id: 1, started_on: "2026-01-01" }),
      project({ id: 2, started_on: "2026-05-01" }),
      project({ id: 3, status: "paused" }),
      project({ id: 4, status: "done", done_on: "2026-02-01" }),
      project({ id: 5, status: "done", done_on: "2026-06-01" }),
    ]);
    expect(groups.active.map((p) => p.id)).toEqual([2, 1]);
    expect(groups.paused.map((p) => p.id)).toEqual([3]);
    expect(groups.done.map((p) => p.id)).toEqual([5, 4]);
  });
});

describe("a deliverable's card", () => {
  const d = (patch: Partial<Deliverable>): Deliverable =>
    ({ id: 1, status: "pending", shared_at: "2026-07-24T13:00:00.000Z", reviewed_at: null, approved_on: null, ...patch }) as Deliverable;

  it("says not shared, shared, changes asked or approved — with the day each happened", () => {
    expect(cardDate(d({ status: "unshared", shared_at: null }))).toEqual({ kind: "notShared" });
    expect(cardDate(d({}))).toEqual({ kind: "shared", at: "2026-07-24T13:00:00.000Z" });
    expect(cardDate(d({ status: "changes", reviewed_at: "2026-07-25T09:00:00.000Z" }))).toEqual({ kind: "changes", at: "2026-07-25T09:00:00.000Z" });
    expect(cardDate(d({ status: "approved", approved_on: "2026-07-02" }))).toEqual({ kind: "approved", day: "2026-07-02" });
  });

  it("wears 'Not shared' while the client can't see it", () => {
    expect(deliverablePill({ status: "unshared" })).toBe("notShared");
    expect(deliverablePill({ status: "changes" })).toBe("changes");
  });
});

describe("invoicing the stages", () => {
  const accepted = { id: 9, status: "accepted" } as Proposal;

  it("has a stage left while the stage invoices hold less than the whole", () => {
    expect(stageLeft(project(), accepted, [invoice(1, { share_pct: "40" }), invoice(2, { share_pct: "30" })])).toBe(true);
    expect(stageLeft(project(), accepted, [invoice(1, { share_pct: "40" }), invoice(2, { share_pct: "30" }), invoice(3, { share_pct: "30", status: "draft" })])).toBe(false);
  });

  it("does not count a void stage invoice, and offers nothing without an accepted proposal or once done", () => {
    expect(stageLeft(project(), accepted, [invoice(1, { share_pct: "50" }), invoice(2, { share_pct: "50", status: "void" })])).toBe(true);
    expect(stageLeft(project({ proposal_id: null }), undefined, [])).toBe(false);
    expect(stageLeft(project({ status: "done" }), accepted, [])).toBe(false);
    expect(stageLeft(project(), { ...accepted, status: "sent" }, [])).toBe(false);
  });

  it("chips each invoice of the project: open with its balance, paid, void (never 'paid'), draft", () => {
    const chips = invoiceChips(
      [invoice(3, { balance: "120.50" }), invoice(1, { balance: "0.00" }), invoice(2, { status: "void", balance: "0.00" }), invoice(4, { status: "draft", number: null }), invoice(5, { project_id: 2 })],
      1,
    );
    expect(chips.map((c) => [c.id, c.kind])).toEqual([
      [1, "paid"],
      [2, "void"],
      [3, "open"],
      [4, "draft"],
    ]);
    expect(chips[2]).toMatchObject({ balance: "120.50", currency: "USD" });
  });
});

describe("the brief", () => {
  const questions = [
    { id: 1, key: "feel", question: "How should it feel?", position: 1, active: true },
    { id: 2, key: "audience", question: "Who is this for?", position: 0, active: true },
  ] as BriefQuestion[];
  const brief = { id: 7, project_id: 1, status: "sent" } as Brief;
  const answers = [
    { id: 1, brief_id: 7, question_key: "feel", answer: " Quiet. " },
    { id: 2, brief_id: 7, question_key: "audience", answer: "   " },
    { id: 3, brief_id: 8, question_key: "audience", answer: "Someone else's" },
    { id: 4, brief_id: 7, question_key: "retired", answer: "Still said" },
  ] as BriefAnswer[];

  it("lists the answered questions in the questions' order, blank ones left out, another brief's never", () => {
    expect(briefRows(brief, answers, questions)).toEqual([
      { key: "feel", question: "How should it feel?", answer: "Quiet." },
      { key: "retired", question: "retired", answer: "Still said" },
    ]);
    expect(briefRows(undefined, answers, questions)).toEqual([]);
  });

  it("speaks of a contact by their first name", () => {
    expect(firstName("Amara Osei")).toBe("Amara");
    expect(firstName(null)).toBe("");
  });
});
