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
  it("asks for a link, greets by the link's first name, spends it, and reads a used one as expired", async () => {
    const requestLink = vi.fn(async () => ({ sentTo: "a•••@h•••.example" }));
    const peekLink = vi.fn(async (token: string) => (token === "good" ? "Amara" : null));
    const openLink = vi.fn(async (token: string) => token === "good");
    const { client } = fakeClient({ requestLink, peekLink, openLink });
    const port = await publicPortalPort(client);
    await port.requestLink(" amara@hearth.example ", "de-DE");
    expect(requestLink).toHaveBeenCalledWith({ email: "amara@hearth.example", lang: "de-DE" });
    expect(await port.peekLink("good")).toEqual({ firstName: "Amara" });
    expect(await port.peekLink("used")).toBeNull();
    await port.verifyLink("good");
    await expect(port.verifyLink("used")).rejects.toMatchObject({ code: "LINK_EXPIRED", status: 410 });
  });

  it("signs in by the code on another device, and resends to the link's own address", async () => {
    const verifyLinkCode = vi.fn(async (input: { email: string; code: string }) => (input.code === "123456" ? ({ ok: true } as const) : ({ ok: false, triesLeft: 3 } as const)));
    const resendLink = vi.fn(async () => undefined);
    const { client } = fakeClient({ verifyLinkCode, resendLink });
    const port = await publicPortalPort(client);
    expect(await port.verifyCode(" amara@hearth.example", " 123456 ")).toEqual({ ok: true });
    expect(verifyLinkCode).toHaveBeenCalledWith({ email: "amara@hearth.example", code: "123456" });
    expect(await port.verifyCode("amara@hearth.example", "000000")).toEqual({ ok: false, triesLeft: 3 });
    await port.resendFromLink("old-token", "en-US");
    expect(resendLink).toHaveBeenCalledWith("old-token");
  });

  it("refuses to pretend with a public client that cannot sign in by link", async () => {
    const { client } = fakeClient();
    const port = await publicPortalPort(client);
    await expect(port.requestLink("a@b.example", "en-US")).rejects.toBeInstanceOf(PortError);
    await expect(port.requestLink("a@b.example", "en-US")).rejects.toMatchObject({ code: "PUBLIC_CLIENT_TOO_OLD" });
    await expect(port.verifyLink("t")).rejects.toMatchObject({ code: "PUBLIC_CLIENT_TOO_OLD" });
  });

  it("carries the server's refusal code through", async () => {
    const { client } = fakeClient({ update: vi.fn(async () => { throw Object.assign(new Error("x"), { code: "PUBLIC_WRITE_REFUSED", status: 403 }); }) as never });
    const port = await publicPortalPort(client);
    await expect(port.accept(1, "A")).rejects.toMatchObject({ code: "PUBLIC_WRITE_REFUSED", status: 403 });
  });
});

describe("the payment instructions", () => {
  it("are the add-on's setting, read for the verified session", async () => {
    const addOnSettings = vi.fn(async () => ({ payment_instructions: "Bank transfer to Outline Studio", business_name: "Outline" }));
    const port = await publicPortalPort(fakeClient({ addOnSettings }).client);
    expect(await port.paymentInstructions?.()).toBe("Bank transfer to Outline Studio");
    expect(addOnSettings).toHaveBeenCalledWith("invoices");
  });

  it("read as none — never an error — from a client without the read, a refusal, or an empty setting", async () => {
    expect(await (await publicPortalPort(fakeClient().client)).paymentInstructions?.()).toBeNull();
    const refused = vi.fn(async () => {
      throw Object.assign(new Error("x"), { code: "PUBLIC_REF_NOT_FOUND", status: 404 });
    });
    expect(await (await publicPortalPort(fakeClient({ addOnSettings: refused }).client)).paymentInstructions?.()).toBeNull();
    expect(await (await publicPortalPort(fakeClient({ addOnSettings: async () => ({ payment_instructions: "  " }) }).client)).paymentInstructions?.()).toBeNull();
  });
});

describe("documents and files", () => {
  it("draws a statement over the client's own row, for its period", async () => {
    const render = vi.fn(async () => ({ id: "doc-1" }));
    const { client, list } = fakeClient({ documents: { render, contentUrl: (id: string) => `/c/${id}` } });
    list.mockImplementation(async () => ({ data: [{ id: 9, company: "Hearth & Co", contact_name: "Amara" }] }));
    const port = await publicPortalPort(client);
    expect(await port.documentUrl("statement", "invoices", 42, "en-US", "year")).toBe("/c/doc-1");
    expect(render).toHaveBeenCalledWith({ kind: "statement", ref: "clients_clients", id: 9, locale: "en-US", period: "year" });
    await port.documentUrl("invoice", "invoices", 42, "en-US");
    expect(render).toHaveBeenLastCalledWith({ kind: "invoice", ref: "clients_invoices", id: 42, locale: "en-US" });
  });

  it("fetches a private file with the session", async () => {
    const file = vi.fn(async () => ({ blob: new Blob(["x"]), filename: "box.pdf", inline: true }));
    const port = await publicPortalPort(fakeClient({ file }).client);
    expect(await port.file?.("deliverable_versions", 3, "file")).toMatchObject({ filename: "box.pdf", inline: true });
    expect(file).toHaveBeenCalledWith("clients_deliverable_versions", 3, "file");
  });
});

describe("the shared handover", () => {
  const handoverScope: PublicConfigLike = { timezone: "America/New_York", currency: "USD", refs: { clients_settings: r(["read"], ["name"]), clients_projects: r(["read"], ["id", "name"]) } };

  it("opens by the link's code, then reads that project's handover", async () => {
    const openShared = vi.fn(async () => "opened" as const);
    const hlist = vi.fn(async (ref: string) => ({ data: ref === "clients_projects" ? [{ id: 4, name: "Studio identity" }] : [] }));
    const handover = { ...fakeClient().client, config: async () => handoverScope, openShared, list: hlist as never };
    const port = await publicPortalPort(fakeClient().client, { handover });
    expect((await port.openHandover("CODE")).project).toMatchObject({ id: 4, name: "Studio identity" });
    expect(openShared).toHaveBeenCalledWith("CODE");
  });

  it("tells a stopped link from one that opens nothing", async () => {
    for (const [answer, code] of [
      ["closed", "LINK_STOPPED"],
      ["unknown", "LINK_UNKNOWN"],
    ] as const) {
      const handover = { ...fakeClient().client, config: async () => handoverScope, openShared: async () => answer };
      const port = await publicPortalPort(fakeClient().client, { handover });
      await expect(port.openHandover("CODE")).rejects.toMatchObject({ code });
    }
  });
});
