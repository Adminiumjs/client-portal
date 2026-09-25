import { describe, expect, it } from "vitest";

import { normalise } from "./rows.ts";

describe("a row in the app's spelling", () => {
  it("keeps every amount as the server's own digits, whatever the database", () => {
    const pg = normalise("invoices", { id: "7", total: "1950.0000", balance: "0.0000", paid: "1950.0000" });
    expect(pg).toMatchObject({ id: 7, total: "1950.0000", balance: "0.0000" });
    const sqlite = normalise("invoices", { id: 7, total: 1950.5, balance: 0 });
    expect(sqlite).toMatchObject({ total: "1950.5", balance: "0" });
    expect(normalise("invoices", { id: 7, total: null }).total).toBeNull();
  });

  it("reads a yes/no, a day and an instant the same from every engine", () => {
    const row = normalise("payments", { id: 1, voided: "t", paid_on: "2026-07-28", recorded_at: "2026-07-28T09:00:00.000Z" });
    expect(row).toMatchObject({ voided: true, paid_on: "2026-07-28", recorded_at: "2026-07-28T09:00:00.000Z" });
    expect(normalise("payments", { id: 1, voided: 0 }).voided).toBe(false);
  });

  it("reads a masked address as none and other masked text as empty", () => {
    const row = normalise("clients", { id: 3, company: "Hearth & Co", email: null, phone: null, _masked: ["email", "phone"] });
    expect(row).toMatchObject({ company: "Hearth & Co", email: null, phone: "" });
    expect(row).not.toHaveProperty("_masked");
  });
});
