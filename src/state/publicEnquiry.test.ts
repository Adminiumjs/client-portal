/**
 * The enquiry form: through its own door (a create that reads nothing back),
 * only what a stranger may write, and it arrives as a NEW enquiry from the
 * WEB whatever the browser sent.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PortError } from "../data/ports.ts";
import { portalRefs, publicPortalPort, type PortalClient, type PublicConfigLike } from "../data/publicSource.ts";
import { fakeStudio, tableOf, type FakeStudio } from "../testing/fakeStudio.ts";
import { setPortalPort } from "./portal.ts";
import { enquiryProblem, sendEnquiry } from "./publicEnquiry.ts";
import { useUi } from "./ui.ts";

const FORM = { name: " Rosa Vento ", email: " rosa@ventoandsons.example ", body: " A sign and a name people can find. ", business: "Vento & Sons", budget: "", trade: null };

describe("the enquiry form on the studio's site", () => {
  let studio: FakeStudio;
  beforeEach(async () => {
    studio = await fakeStudio();
  });

  it("arrives as a new enquiry from the web, numbered and stamped by Adminium", async () => {
    const sent = await sendEnquiry(FORM);
    expect(sent.ok).toBe(true);
    const made = tableOf(studio, "enquiries").at(-1)!;
    expect(made).toMatchObject({ name: "Rosa Vento", email: "rosa@ventoandsons.example", body: "A sign and a name people can find.", business: "Vento & Sons", budget: null, status: "new", source: "web", number: "ENQ-005", fit: null, client_id: null });
    expect(sent.ok && sent.value.received_at).toBe(made["received_at"]);
  });

  it("asks for a name, an address to answer and what they want, before anything is sent", () => {
    expect(enquiryProblem({ ...FORM, name: " " })).toEqual({ code: "NAME_REQUIRED", field: "name" });
    expect(enquiryProblem({ ...FORM, email: "rosa@" })).toEqual({ code: "EMAIL_REQUIRED", field: "email" });
    expect(enquiryProblem({ ...FORM, body: "" })).toEqual({ code: "BODY_REQUIRED", field: "body" });
  });

  it("is refused in the studio's preview", async () => {
    useUi.setState({ preview: { clientId: 1 } as never });
    const refused = await sendEnquiry(FORM);
    expect(!refused.ok && refused.reason).toBe("preview");
    expect(tableOf(studio, "enquiries")).toHaveLength(4);
  });
});

describe("the enquiry door on a real install", () => {
  beforeEach(() => {
    useUi.setState({ preview: null });
  });
  const r = (actions: string[], expose: string[], writable: string[] = []) => ({ actions, expose, writable });
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
      clients_enquiries: r(["create"], ["received_at"], ["name", "email", "business", "trade", "budget", "start_when", "body"]),
    },
  };

  it("finds the door by what it does, and sends only the form's own columns", async () => {
    expect(portalRefs(SCOPE, {}).enquiry).toBe("clients_enquiries");
    const create = vi.fn(async () => ({ received_at: "2026-07-28T14:00:00.000Z" }));
    const client: PortalClient = {
      config: async () => SCOPE,
      list: (async () => ({ data: [] })) as never,
      create: create as never,
      update: (async () => ({})) as never,
      signOut: async () => undefined,
      isClaimed: () => false,
    };
    const port = await publicPortalPort(client);
    setPortalPort(port);
    const sent = await sendEnquiry(FORM);
    expect(sent.ok && sent.value).toEqual({ received_at: "2026-07-28T14:00:00.000Z" });
    expect(create).toHaveBeenCalledWith("clients_enquiries", {
      name: "Rosa Vento",
      email: "rosa@ventoandsons.example",
      body: "A sign and a name people can find.",
      business: "Vento & Sons",
      trade: null,
      budget: null,
      start_when: null,
    });
  });

  it("says so when an install has no enquiry door, and the rest of the portal still works", async () => {
    const { clients_enquiries: _form, ...rest } = SCOPE.refs;
    const port = await publicPortalPort({
      config: async () => ({ ...SCOPE, refs: rest }),
      list: (async () => ({ data: [] })) as never,
      create: (async () => ({})) as never,
      update: (async () => ({})) as never,
      signOut: async () => undefined,
      isClaimed: () => false,
    });
    await expect(port.sendEnquiry({ name: "A", email: "a@b.example", body: "c" })).rejects.toBeInstanceOf(PortError);
    expect(port.timeZone()).toBe("America/New_York");
  });
});
