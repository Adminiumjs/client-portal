/**
 * Home, from the sample studio's first client (Hearth & Co): what is waiting
 * on them is only what they can act on, their documents never include a
 * draft, and the figure under the list counts neither a void invoice nor a
 * voided payment.
 */
import { beforeEach, describe, expect, it } from "vitest";

import type { Tables } from "../../../data/types.ts";
import { DEMO_ZONE } from "../../../lib/clock.ts";
import { fakeStudio } from "../../../testing/fakeStudio.ts";
import { loadPortal, usePortal } from "../../../state/portal.ts";
import { documents, homeTotal, nextSteps, waitingOnYou, type HomeRows } from "./model.ts";

let rows: HomeRows;

const held = (today = "2026-07-28"): HomeRows => {
  const r = usePortal.getState().rows;
  return {
    today,
    zone: DEMO_ZONE,
    proposals: Object.values(r.proposals),
    projects: Object.values(r.projects),
    milestones: Object.values(r.milestones),
    deliverables: Object.values(r.deliverables),
    versions: Object.values(r.deliverable_versions),
    invoices: Object.values(r.invoices),
    payments: Object.values(r.payments),
    briefs: Object.values(r.briefs),
  };
};

beforeEach(async () => {
  await fakeStudio();
  await loadPortal();
  rows = held();
});

describe("waiting on you", () => {
  it("lists the invoices to pay, the proposal to decide and the brief to answer", () => {
    const todo = waitingOnYou(rows).map((t) => {
      if (t.kind === "invoice") return `${t.invoice.number}${t.overdue ? ` late ${t.days}` : ""}`;
      if (t.kind === "proposal") return `decide ${t.proposal.number}`;
      if (t.kind === "brief") return `brief ${t.project.name}`;
      return `look ${t.deliverable.title}`;
    });
    expect(todo).toEqual(["INV-2040", "INV-2038 late 12", "decide PRO-1142", "brief Seasonal window"]);
  });

  it("never lists a deliverable the studio has not shared, even one marked for review", () => {
    const unshared = { id: 99, project_id: 2, title: "Hidden sketch", status: "unshared", shared_at: null, position: 9 } as Tables["deliverables"];
    const pending = { id: 98, project_id: 2, title: "Window sketch C", status: "pending", shared_at: "2026-07-27T13:00:00.000Z", position: 8 } as Tables["deliverables"];
    const todo = waitingOnYou({ ...rows, deliverables: [...rows.deliverables, unshared, pending] });
    expect(todo.filter((t) => t.kind === "review").map((t) => (t.kind === "review" ? t.deliverable.title : ""))).toEqual(["Window sketch C"]);
  });

  it("drops a proposal once its price stops holding", () => {
    const later = { ...rows, today: "2026-08-13" };
    expect(waitingOnYou(later).some((t) => t.kind === "proposal")).toBe(false);
  });

  it("drops a brief once it is sent, or when its project is not running", () => {
    const sent = { ...rows, briefs: rows.briefs.map((b) => ({ ...b, status: "sent" as const })) };
    expect(waitingOnYou(sent).some((t) => t.kind === "brief")).toBe(false);
    const paused = { ...rows, projects: rows.projects.map((p) => ({ ...p, status: "paused" as const })) };
    expect(waitingOnYou(paused).some((t) => t.kind === "brief")).toBe(false);
  });
});

describe("the documents and the figure under them", () => {
  it("lists invoices then proposals, never a draft", () => {
    const draft = { ...rows.proposals[0]!, id: 50, status: "draft" as const, number: null };
    const docs = documents({ ...rows, proposals: [...rows.proposals, draft] });
    expect(docs.map((d) => (d.kind === "invoice" ? d.invoice.number : d.proposal.number))).toEqual(["INV-2040", "INV-2038", "PRO-1142"]);
  });

  it("is the open balance while anything is open", () => {
    expect(homeTotal(rows)).toMatchObject({ kind: "open", value: "2007.25", overdue: true });
  });

  it("is what was paid once nothing is open — leaving out a void invoice and a voided payment", () => {
    const invoices = rows.invoices.map((i) => ({ ...i, balance: "0.00", paid: i.total }));
    const voidInvoice = { ...invoices[0]!, id: 70, status: "void" as const, issued_on: "2026-06-01", total: "999.00", balance: "0.00" };
    const payments: Tables["payments"][] = [
      { id: 1, document_id: invoices[0]!.id, amount: "488.25", voided: false, paid_on: "2026-07-25" } as Tables["payments"],
      { id: 2, document_id: invoices[1]!.id, amount: "1519.00", voided: false, paid_on: "2026-07-26" } as Tables["payments"],
      { id: 3, document_id: invoices[1]!.id, amount: "50.00", voided: true, paid_on: "2026-07-26" } as Tables["payments"],
      { id: 4, document_id: 70, amount: "999.00", voided: false, paid_on: "2026-06-02" } as Tables["payments"],
    ];
    expect(homeTotal({ ...rows, invoices: [...invoices, voidInvoice], payments })).toMatchObject({ kind: "paid", value: "2007.25" });
  });
});

describe("what happens next", () => {
  it("is the next two milestones, the next invoice to pay, then the handover", () => {
    expect(nextSteps(rows).map((s) => (s.kind === "milestone" ? s.milestone.title : s.kind === "invoice" ? s.invoice.number : "handover"))).toEqual(["Window sketches", "Install", "INV-2038", "handover"]);
  });
});
