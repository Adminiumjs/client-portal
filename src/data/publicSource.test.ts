/**
 * The clients' side: each write goes through its own narrow endpoint, found
 * by what the endpoint does, and sends only what that endpoint may write —
 * Adminium stamps the rest.
 */
import { describe, expect, it, vi } from "vitest";

import { PortError } from "./ports.ts";
import { portalRefs, publicPortalPort, type PortalClient, type PublicConfigLike } from "./publicSource.ts";

const r = (actions: string[], expose: string[], writable: string[] = []) => ({ actions, expose, writable });

/** The scope an install makes from the manifest's public entries (several per table, suffixed). */
const SCOPE: PublicConfigLike = {
  timezone: "America/New_York",
  currency: "USD",
  claim: { ref: "clients_clients" },
  refs: {
    clients_settings: r(["read"], ["name", "mark", "reply_to", "phone", "website"]),
    clients_people: r(["read"], ["name", "role_label", "initials", "position"]),
    clients_brief_questions: r(["read"], ["key", "question", "hint", "kind", "position"]),
    clients_clients: r(["read"], ["company", "contact_name"]),
    clients_proposals: r(["read"], ["id", "number", "status", "title", "scope", "total"]),
    clients_proposals_2: r(["update"], ["id", "status", "signed_name"], ["status", "signed_name"]),
    clients_proposals_3: r(["update"], ["id", "signed_name"], ["signed_name"]),
    clients_proposals_4: r(["update"], ["id", "status", "decline_note"], ["status", "decline_note"]),
    clients_proposals_5: r(["update"], ["id", "new_price_asked_at"], ["new_price_asked"]),
    clients_proposal_lines: r(["read"], ["id", "document_id", "amount"]),
    clients_terms_versions: r(["read"], ["id", "version"]),
    clients_terms_clauses: r(["read"], ["id", "body"]),
    clients_projects: r(["read"], ["id", "number", "name"]),
    clients_milestones: r(["read"], ["id", "state"]),
    clients_deliverables: r(["read"], ["id", "title", "status"]),
    clients_deliverables_2: r(["update"], ["id", "status"], ["status", "review_note"]),
    clients_deliverable_versions: r(["read"], ["id", "v", "file"]),
    clients_deliverable_notes: r(["read", "create"], ["id", "body"], ["deliverable_id", "version_id", "body", "pin_x", "pin_y"]),
    clients_briefs: r(["read", "update"], ["id", "status"], ["status"]),
    clients_brief_answers: r(["read", "create", "update"], ["id", "answer"], ["brief_id", "question_key", "answer"]),
    clients_invoices: r(["read"], ["id", "number", "balance"]),
    clients_invoices_2: r(["update"], ["id", "client_paid"], ["client_paid", "client_paid_note", "client_paid_amount", "client_paid_on"]),
    clients_invoice_lines: r(["read"], ["id", "amount"]),
    clients_payments: r(["read"], ["id", "paid_on"]),
  },
};

function fakeClient(extra: Partial<PortalClient> = {}) {
  const update = vi.fn(async (_ref: string, id: string, values: Record<string, unknown>) => ({ id: Number(id), ...values }));
  const create = vi.fn(async (_ref: string, values: Record<string, unknown>) => ({ id: 99, ...values }));
  const list = vi.fn(async () => ({ data: [] as unknown[] }));
  const client: PortalClient = {
    config: async () => SCOPE,
    list: list as never,
    create: create as never,
    update: update as never,
    signOut: async () => undefined,
    isClaimed: () => true,
    ...extra,
  };
  return { client, update, create, list };
}

describe("the clients' endpoints, by what each does", () => {
  it("tells accept, sign, decline and a new price apart on one table", () => {
    const refs = portalRefs(SCOPE, {});
    expect(refs).toMatchObject({
      proposals: "clients_proposals",
      accept: "clients_proposals_2",
      sign: "clients_proposals_3",
      decline: "clients_proposals_4",
      newPrice: "clients_proposals_5",
      review: "clients_deliverables_2",
      sentPayment: "clients_invoices_2",
      identity: "clients_clients",
    });
  });

  it("says which endpoint the portal's key lacks", () => {
    const { clients_proposals_3: _sign, ...rest } = SCOPE.refs;
    expect(() => portalRefs({ ...SCOPE, refs: rest }, {})).toThrow(/sign/);
  });
});

describe("each client write sends only what its endpoint may write", () => {
  it("accept and sign: the status and the typed name, nothing Adminium stamps", async () => {
    const { client, update } = fakeClient();
    const port = await publicPortalPort(client);
    await port.accept(12, "  Amara Osei ");
    await port.sign(13, "Amara Osei");
    expect(update.mock.calls).toEqual([
      ["clients_proposals_2", "12", { status: "accepted", signed_name: "Amara Osei" }],
      ["clients_proposals_3", "13", { signed_name: "Amara Osei" }],
    ]);
  });

  it("decline (with or without a note) and a new price", async () => {
    const { client, update } = fakeClient();
    const port = await publicPortalPort(client);
    await port.decline(12, "  ");
    await port.askNewPrice(12);
    expect(update.mock.calls).toEqual([
      ["clients_proposals_4", "12", { status: "declined", decline_note: null }],
      ["clients_proposals_5", "12", { new_price_asked: true }],
    ]);
  });

  it("a review, a note, an answer, the brief and a payment said to be sent", async () => {
    const { client, update, create } = fakeClient();
    const port = await publicPortalPort(client);
    await port.review(4, "approved", "ignored");
    await port.review(4, "changes", "Bigger logo");
    await port.addNote({ deliverable_id: 4, version_id: 7, body: "Here", pin_x: "0.4", pin_y: "0.2" });
    await port.saveAnswer(2, "audience", "Bakers", null);
    await port.saveAnswer(2, "audience", "Bakers and cafés", 31);
    await port.sendBrief(2);
    await port.sentPayment(9, { on: "2026-07-27", amount: "", note: null });
    expect(update.mock.calls).toEqual([
      ["clients_deliverables_2", "4", { status: "approved" }],
      ["clients_deliverables_2", "4", { status: "changes", review_note: "Bigger logo" }],
      ["clients_brief_answers", "31", { answer: "Bakers and cafés" }],
      ["clients_briefs", "2", { status: "sent" }],
      ["clients_invoices_2", "9", { client_paid: true, client_paid_on: "2026-07-27", client_paid_amount: null, client_paid_note: null }],
    ]);
    expect(create.mock.calls).toEqual([
      ["clients_deliverable_notes", { deliverable_id: 4, version_id: 7, body: "Here", pin_x: "0.4", pin_y: "0.2" }],
      ["clients_brief_answers", { brief_id: 2, question_key: "audience", answer: "Bakers" }],
    ]);
  });
});

describe("signing in by link", () => {
  it("asks for a link, spends it, and reads a used one as expired", async () => {
    const requestLink = vi.fn(async () => undefined);
    const verifyLink = vi.fn(async (input: { token: string } | { email: string; code: string }) => ({ ok: "token" in input && input.token === "good" }));
    const { client } = fakeClient({ requestLink, verifyLink });
    const port = await publicPortalPort(client);
    await port.requestLink(" amara@hearth.example ", "de-DE");
    expect(requestLink).toHaveBeenCalledWith({ email: "amara@hearth.example", lang: "de-DE" });
    await port.verifyLink("good");
    await expect(port.verifyLink("used")).rejects.toMatchObject({ code: "LINK_EXPIRED", status: 410 });
  });

  it("refuses to pretend with a public client that cannot sign in by link", async () => {
    const { client } = fakeClient();
    const port = await publicPortalPort(client);
    await expect(port.requestLink("a@b.example", "en-US")).rejects.toBeInstanceOf(PortError);
    await expect(port.requestLink("a@b.example", "en-US")).rejects.toMatchObject({ code: "PUBLIC_CLIENT_TOO_OLD" });
  });

  it("carries the server's refusal code through", async () => {
    const { client } = fakeClient({ update: vi.fn(async () => { throw Object.assign(new Error("x"), { code: "PUBLIC_WRITE_REFUSED", status: 403 }); }) as never });
    const port = await publicPortalPort(client);
    await expect(port.accept(1, "A")).rejects.toMatchObject({ code: "PUBLIC_WRITE_REFUSED", status: 403 });
  });
});
