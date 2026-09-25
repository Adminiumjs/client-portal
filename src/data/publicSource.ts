/**
 * The clients' side, through the portal's browser key and the signed-in
 * client's session.
 *
 * Every door is a public endpoint the install made from the manifest's
 * `publicAccess`, and each is narrow on the server: the studio's name and
 * people before sign-in; after it, only the client's OWN proposals, projects,
 * invoices, payments and brief (never a list of clients); and one entry per
 * write — accept, sign, decline, ask for a new price, review a deliverable,
 * write a note, answer the brief and send it, say a payment was sent. The
 * browser sends only what an entry lets it write; Adminium stamps the rest
 * (who signed, when, the fingerprint, how it was approved).
 *
 * The refs are found by what each endpoint DOES (which table, what it may
 * write), never by guessing the names an install gave them, so an extra
 * endpoint or a renamed table does not misroute a client's signature.
 *
 * ── The client this sits on ─────────────────────────────────────────────────
 *
 * `PortalClient` is the public client's shape. The sign-in LINK calls
 * (`requestLink`, `peekLink`, `verifyLink`, `resendLink`) and the share-link
 * claim (`claimToken`) must share the client's session, so they are the
 * client's own methods, not a fetch beside it; a client without them answers
 * `PUBLIC_CLIENT_TOO_OLD` here rather than signing nobody in.
 */
import { normalise, normaliseAll } from "./rows.ts";
import { realTables } from "./tableOfRef.ts";
import type { ListCondition } from "./snapshotPort.ts";
import { PortError, type ClientNote, type CodeResult, type DocumentKind, type HandoverView, type Me, type PortalPort, type PublicStudio, type SentPayment } from "./ports.ts";
import type { TableRef, Tables } from "./types.ts";

export interface PublicRefLike {
  actions: string[];
  expose: string[];
  writable: string[];
}

export interface PublicConfigLike {
  timezone: string;
  currency: string | null;
  claim?: { ref: string } | null;
  refs: Record<string, PublicRefLike>;
}

export interface PortalClient {
  config(): Promise<PublicConfigLike>;
  list<T>(ref: string, options?: { where?: ListCondition; order?: string; limit?: number }): Promise<{ data: T[] }>;
  create<T>(ref: string, values: Record<string, unknown>): Promise<T>;
  update<T>(ref: string, id: string, values: Record<string, unknown>): Promise<T>;
  signOut(): Promise<void>;
  isClaimed(): boolean;
  documents?: {
    render(input: { kind: string; ref: string; id: string | number; locale?: string }): Promise<{ id: string }>;
    contentUrl(id: string): string;
  };
  /** The private file of a row's file column (a signed, short-lived link). */
  fileUrl?(ref: string, id: string, column: string): string;
  requestLink?(input: { email: string; lang: string }): Promise<void>;
  peekLink?(input: { token: string }): Promise<{ firstName: string } | null>;
  verifyLink?(input: { token: string } | { email: string; code: string }): Promise<{ ok: boolean; triesLeft?: number | null }>;
  resendLink?(input: { token: string; lang: string }): Promise<void>;
  claimToken?(input: { token: string }): Promise<void>;
}

/** A refusal in the page's terms: the server's code and what it named. */
export function portError(error: unknown): PortError {
  if (error instanceof PortError) return error;
  const e = (error ?? {}) as { code?: unknown; status?: unknown; message?: unknown; params?: unknown };
  if (typeof e.code === "string") {
    return new PortError(e.code, typeof e.message === "string" ? e.message : e.code, typeof e.status === "number" ? e.status : 0, (e.params ?? {}) as Record<string, unknown>);
  }
  return new PortError("PUBLIC_NETWORK_UNAVAILABLE", error instanceof Error ? error.message : String(error));
}

const guard = async <T>(run: () => Promise<T>): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    throw portError(error);
  }
};

/** The endpoints, by what each one does. */
export interface PortalRefs {
  settings: string;
  people: string;
  briefQuestions: string;
  identity: string;
  proposals: string;
  accept: string;
  sign: string;
  decline: string;
  newPrice: string;
  proposalLines: string;
  termsVersions: string;
  termsClauses: string;
  projects: string;
  milestones: string;
  deliverables: string;
  review: string;
  versions: string;
  notes: string;
  briefs: string;
  answers: string;
  invoices: string;
  sentPayment: string;
  invoiceLines: string;
  payments: string;
}

/** Which ref is which. Throws naming what the portal's key lacks. */
export function portalRefs(config: PublicConfigLike, tables: Record<string, string>): PortalRefs {
  const entries = Object.entries(config.refs);
  const real = realTables(tables);
  const of = (table: TableRef) => entries.filter(([ref]) => ref === real[table] || ref.startsWith(`${real[table]}_`));
  const reads = (table: TableRef, column?: string) => of(table).filter(([, r]) => r.actions.includes("read") && (column === undefined || r.expose.includes(column)));
  const writes = (table: TableRef, column: string, not?: string) => of(table).filter(([, r]) => r.writable.includes(column) && (not === undefined || !r.writable.includes(not)));
  const pick = (label: string, found: [string, unknown][]): string => {
    const ref = found[0]?.[0];
    if (ref === undefined) throw new PortError("PUBLIC_SETUP", `the portal's key has no ${label} endpoint`);
    return ref;
  };
  const identity = config.claim?.ref;
  return {
    settings: pick("studio", reads("settings", "reply_to")),
    people: pick("people", reads("people", "role_label")),
    briefQuestions: pick("brief questions", reads("brief_questions", "question")),
    identity: pick("client", identity === undefined ? reads("clients", "company") : [[identity, null]]),
    proposals: pick("proposals", reads("proposals", "scope")),
    accept: pick("accept", writes("proposals", "status", "decline_note").filter(([, r]) => r.writable.includes("signed_name"))),
    sign: pick("sign", writes("proposals", "signed_name", "status")),
    decline: pick("decline", writes("proposals", "decline_note")),
    newPrice: pick("new price", writes("proposals", "new_price_asked")),
    proposalLines: pick("proposal lines", reads("proposal_lines", "amount")),
    termsVersions: pick("terms", reads("terms_versions", "version")),
    termsClauses: pick("terms clauses", reads("terms_clauses", "body")),
    projects: pick("projects", reads("projects", "name")),
    milestones: pick("milestones", reads("milestones", "state")),
    deliverables: pick("deliverables", reads("deliverables", "title")),
    review: pick("review", writes("deliverables", "status")),
    versions: pick("versions", reads("deliverable_versions", "v")),
    notes: pick("notes", writes("deliverable_notes", "body")),
    briefs: pick("brief", writes("briefs", "status")),
    answers: pick("brief answers", writes("brief_answers", "answer")),
    invoices: pick("invoices", reads("invoices", "number")),
    sentPayment: pick("I've sent a payment", writes("invoices", "client_paid")),
    invoiceLines: pick("invoice lines", reads("invoice_lines", "amount")),
    payments: pick("payments", reads("payments", "paid_on")),
  };
}

/** The read endpoint of each table a client screen lists. */
function readRefOf(refs: PortalRefs, table: TableRef): string {
  const map: Partial<Record<TableRef, keyof PortalRefs>> = {
    proposals: "proposals",
    proposal_lines: "proposalLines",
    terms_versions: "termsVersions",
    terms_clauses: "termsClauses",
    projects: "projects",
    milestones: "milestones",
    deliverables: "deliverables",
    deliverable_versions: "versions",
    deliverable_notes: "notes",
    briefs: "briefs",
    brief_answers: "answers",
    invoices: "invoices",
    invoice_lines: "invoiceLines",
    payments: "payments",
    people: "people",
    brief_questions: "briefQuestions",
    settings: "settings",
  };
  const key = map[table];
  if (key === undefined) throw new PortError("PUBLIC_REF_NOT_FOUND", `the clients' side reads no ${table}`);
  return refs[key];
}

const TOO_OLD = () => new PortError("PUBLIC_CLIENT_TOO_OLD", "this public client cannot sign in by link");

export interface PublicPortalOptions {
  /** The shared handover's own client (its own key), when the page has one. */
  handover?: PortalClient | null;
  /** Real table names from the customer config. */
  tables?: Record<string, string>;
}

export async function publicPortalPort(client: PortalClient, opts: PublicPortalOptions = {}): Promise<PortalPort> {
  const config = await guard(() => client.config());
  const tables = opts.tables ?? {};
  const refs = portalRefs(config, tables);
  const one = <R extends TableRef>(table: R, row: unknown): Tables[R] => normalise(table, (row ?? {}) as Record<string, unknown>);
  const read = async <R extends TableRef>(table: R, ref: string, where?: ListCondition, order?: string, limit = 200): Promise<Tables[R][]> =>
    normaliseAll(table, (await client.list<Record<string, unknown>>(ref, { limit, ...(where === undefined ? {} : { where }), ...(order === undefined ? {} : { order }) })).data);

  return {
    timeZone: () => config.timezone,
    currency: () => config.currency,

    signedIn: () => client.isClaimed(),

    requestLink: (email, language) =>
      guard(async () => {
        if (client.requestLink === undefined) throw TOO_OLD();
        await client.requestLink({ email: email.trim(), lang: language });
      }),

    peekLink: (token) =>
      guard(async () => {
        if (client.peekLink === undefined) throw TOO_OLD();
        return client.peekLink({ token });
      }),

    verifyLink: (token) =>
      guard(async () => {
        if (client.verifyLink === undefined) throw TOO_OLD();
        const result = await client.verifyLink({ token });
        if (!result.ok) throw new PortError("LINK_EXPIRED", "this link was used or has expired", 410);
      }),

    verifyCode: (email, code) =>
      guard(async (): Promise<CodeResult> => {
        if (client.verifyLink === undefined) throw TOO_OLD();
        const result = await client.verifyLink({ email: email.trim(), code: code.trim() });
        return result.ok ? { ok: true } : { ok: false, triesLeft: result.triesLeft ?? null };
      }),

    resendFromLink: (token, language) =>
      guard(async () => {
        if (client.resendLink === undefined) throw TOO_OLD();
        await client.resendLink({ token, lang: language });
      }),

    signOut: () => guard(() => client.signOut()),

    studio: () =>
      guard(async (): Promise<PublicStudio> => {
        const [settings, people, briefQuestions] = await Promise.all([
          read("settings", refs.settings, undefined, undefined, 1),
          read("people", refs.people, undefined, "position.asc"),
          read("brief_questions", refs.briefQuestions, undefined, "position.asc"),
        ]);
        return { settings: settings[0] ?? null, people, briefQuestions };
      }),

    me: () =>
      guard(async (): Promise<Me> => {
        const found = await client.list<Record<string, unknown>>(refs.identity, { limit: 1 });
        const row = found.data[0];
        if (row === undefined) throw new PortError("PUBLIC_CLAIM_LEVEL", "no client for this session", 401);
        return { company: String(row["company"] ?? ""), contact_name: String(row["contact_name"] ?? "") };
      }),

    list: (table, where, order, limit) => guard(() => read(table, readRefOf(refs, table), where, order, limit)),

    documentUrl: (kind: DocumentKind, table, id, locale) =>
      guard(async () => {
        if (client.documents === undefined) throw new PortError("PUBLIC_CLIENT_TOO_OLD", "this public client has no documents");
        const ref = table === "payments" ? refs.payments : table === "proposals" ? refs.proposals : refs.invoices;
        const doc = await client.documents.render({ kind, ref, id, locale });
        return client.documents.contentUrl(doc.id);
      }),

    fileUrl: (table, id, column) => {
      if (client.fileUrl === undefined) throw new PortError("PUBLIC_CLIENT_TOO_OLD", "this public client has no file links");
      return client.fileUrl(readRefOf(refs, table), String(id), column);
    },

    accept: (id, signedName) => guard(async () => one("proposals", await client.update(refs.accept, String(id), { status: "accepted", signed_name: signedName.trim() }))),
    sign: (id, signedName) => guard(async () => one("proposals", await client.update(refs.sign, String(id), { signed_name: signedName.trim() }))),
    decline: (id, note) => guard(async () => one("proposals", await client.update(refs.decline, String(id), { status: "declined", decline_note: note === null || note.trim() === "" ? null : note.trim() }))),
    askNewPrice: (id) => guard(async () => one("proposals", await client.update(refs.newPrice, String(id), { new_price_asked: true }))),
    review: (id, status, note) =>
      guard(async () => one("deliverables", await client.update(refs.review, String(id), status === "changes" ? { status, review_note: note } : { status }))),
    addNote: (note: ClientNote) =>
      guard(async () =>
        one(
          "deliverable_notes",
          await client.create(refs.notes, { deliverable_id: note.deliverable_id, version_id: note.version_id, body: note.body, pin_x: note.pin_x, pin_y: note.pin_y }),
        ),
      ),
    saveAnswer: (briefId, questionKey, answer, existing) =>
      guard(async () =>
        one(
          "brief_answers",
          existing === null ? await client.create(refs.answers, { brief_id: briefId, question_key: questionKey, answer }) : await client.update(refs.answers, String(existing), { answer }),
        ),
      ),
    sendBrief: (briefId) => guard(async () => one("briefs", await client.update(refs.briefs, String(briefId), { status: "sent" }))),
    sentPayment: (id, payment: SentPayment) =>
      guard(async () =>
        one(
          "invoices",
          await client.update(refs.sentPayment, String(id), {
            client_paid: true,
            client_paid_on: payment.on,
            client_paid_amount: payment.amount === null || payment.amount.trim() === "" ? null : payment.amount.trim(),
            client_paid_note: payment.note === null || payment.note.trim() === "" ? null : payment.note.trim(),
          }),
        ),
      ),

    openHandover: (token) =>
      guard(async (): Promise<HandoverView> => {
        const h = opts.handover;
        if (h === null || h === undefined || h.claimToken === undefined) throw new PortError("PUBLIC_CLIENT_TOO_OLD", "this page has no handover key");
        await h.claimToken({ token });
        const hc = await h.config();
        const real = realTables(tables);
        const href = (table: TableRef) => Object.keys(hc.refs).find((ref) => ref === real[table] || ref.startsWith(`${real[table]}_`)) ?? real[table];
        const list = async <R extends TableRef>(table: R) => normaliseAll(table, (await h.list<Record<string, unknown>>(href(table), { limit: 200 })).data);
        const [settings, projects, fonts, files, deliverables, versions] = await Promise.all([
          list("settings"),
          list("projects"),
          list("project_fonts"),
          list("handover_files"),
          list("deliverables"),
          list("deliverable_versions"),
        ]);
        const project = projects[0];
        if (project === undefined) throw new PortError("LINK_STOPPED", "this link has been stopped", 410);
        return { studio: settings[0] ?? null, project, fonts, files, deliverables, versions };
      }),
  };
}
