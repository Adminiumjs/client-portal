/**
 * The Archive's arithmetic: which projects are finished, what each was worth
 * (its sent invoices — never a void one or a draft), the years, and search.
 */
import { describe, expect, it } from "vitest";

import type { Client, Invoice, Project } from "../../data/types.ts";
import { byYear, finished, search, worth } from "./model.ts";

const project = (id: number, over: Partial<Project>): Project => ({
  id, number_seq: id, number: `PRJ-${String(id)}`, client_id: 1, proposal_id: null, name: `Project ${String(id)}`, status: "done", pause_note: null, started_on: "2025-01-01", done_on: "2026-07-03",
  share_token: null, share_expires_on: null, share_stopped: false, share_stopped_at: null, handover_notes: null, handover_sent: false, handover_sent_at: null, client_key: null, ...over,
});
const inv = (id: number, project_id: number, status: Invoice["status"], total: string) => ({ id, project_id, status, total, currency: "USD" }) as Invoice;
const clients = { 1: { id: 1, company: "Ferngrove Coffee", contact_name: "Ines Ferreira" } as Client };

describe("finished work", () => {
  const projects = [project(1, {}), project(2, { done_on: "2025-11-20", name: "Stamps" }), project(3, { status: "active", done_on: null })];
  const invoices = [inv(1, 1, "sent", "2387.00"), inv(2, 1, "sent", "2387.00"), inv(3, 1, "void", "999.00"), inv(4, 1, "draft", "50.00"), inv(5, 2, "sent", "4200.00")];
  const items = finished(projects, invoices, clients, "USD");

  it("is the done projects, newest first, each worth its sent invoices", () => {
    expect(items.map((i) => [i.project.name, i.value, i.invoices, i.year])).toEqual([
      ["Project 1", "4774.00", 2, 2026],
      ["Stamps", "4200.00", 1, 2025],
    ]);
    expect(worth(items, "USD")).toBe("8974.00");
  });

  it("groups by the year each was finished, the newest year first", () => {
    expect(byYear(items, "USD").map((g) => [g.year, g.items.length, g.value])).toEqual([
      [2026, 1, "4774.00"],
      [2025, 1, "4200.00"],
    ]);
  });

  it("searches every year by name, number, client and day", () => {
    const day = (d: string | null) => d ?? "";
    expect(search(items, "stamps", day).map((i) => i.project.id)).toEqual([2]);
    expect(search(items, "ferngrove", day)).toHaveLength(2);
    expect(search(items, "PRJ-1", day).map((i) => i.project.id)).toEqual([1]);
    expect(search(items, "2025-11", day).map((i) => i.project.id)).toEqual([2]);
    expect(search(items, "  ", day)).toHaveLength(2);
  });
});
