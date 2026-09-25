/**
 * The demo's stand-in world — DEMO BUILD ONLY.
 *
 * The website's demo has no server, so this plays Adminium's part in memory
 * through the same doors the real desk and clients' side use (`DeskReads`,
 * `DeskWrites`, `PortalPort`): the app's real sample, resolved at the demo's
 * moment (`sample.ts`); every write decided as Adminium decides it
 * (`engine.ts`); the emails made, held, judged and sent as Adminium's outbox
 * does (`outbox.ts`); a clock the card moves a week at a time and puts back.
 * Every write announces itself as the live stream would, so the desk follows
 * the clients' side and back.
 *
 * The screens' tests run on it too (`testing/fakeStudio.ts`), over a small
 * hand-written studio (`data/demo.ts`) instead of the sample: the same rules,
 * with that studio's own number prefixes.
 */
import type { LiveFrame } from "../data/live.ts";
import { PortError, type DeskReads, type DeskWrites, type DocumentKind, type HandoverView, type Page, type PortalPort, type SearchHit } from "../data/ports.ts";
import { kindOfStatus, SinkError } from "../data/sink.ts";
import type { ListCondition } from "../data/snapshotPort.ts";
import { TABLE_REFS, type Id, type TableRef, type Tables } from "../data/types.ts";
import { venueDay } from "../data/venueTime.ts";
import { openWork } from "../data/adminiumSource.ts";
import { clockJumped } from "../lib/clock.ts";
import { createEngine, drawCode, Refusal, type Row, type Rows, type Writer } from "./engine.ts";
import { createOutbox } from "./outbox.ts";
import { DEMO_CURRENCY, DEMO_SETTINGS, isSampleSource, resolveDemoSample, type SampleSource } from "./sample.ts";

export type { Row, Rows } from "./engine.ts";
type Seed = { [R in TableRef]?: Partial<Tables[R]>[] };

export interface Actor {
  /** The desk's signed-in person (stamps "by", "posted by", "recorded by"). */
  name: string;
}

export interface WorldOptions {
  /** The add-on's settings; the sample's by default, or the hand seed's. */
  settings?: Readonly<Record<string, unknown>>;
  currency?: string;
}

export interface DemoWorld {
  readonly rows: Rows;
  reads: DeskReads;
  writes: DeskWrites;
  /** The clients' side, signed in (or not) as one client. */
  portal(clientId: Id): PortalPort;
  subscribe(listener: (frame: LiveFrame) => void): () => void;
  /** The world's clock: the base clock plus the weeks the card moved it on. */
  now(): number;
  /** Move the clock on (the card's "+1 week"): the minute scan and the sender run at the new moment. */
  advance(days: number): void;
  /** Everything back: the pinned day, and the sample as it was added. */
  reset(): void;
  /** The sample's words in another language (rows still as the sample wrote them). */
  relabel(locale: string): void;
  /** The emailed sign-in link stops working (the card's "Let the link expire"). */
  expireLink(): void;
  /** Told when the whole world changed at once (a reset, a relabel, a clock move): screens read again. */
  onReload(listener: () => void): () => void;
  /** The add-on's settings the rules read. */
  settings(): Readonly<Record<string, unknown>>;
  /** The desk's printed copy of a row (the add-on's HTML drawn at build time), or null when the demo has none. */
  documentUrl(kind: DocumentKind, ref: TableRef, id: Id, locale: string): Promise<string | null>;
}

/** The hand seed's settings: its own prefixes, the same add-on otherwise. */
const HAND_SETTINGS: Readonly<Record<string, unknown>> = {
  ...DEMO_SETTINGS,
  "invoices.tax_name": "Tax",
  "invoices.prefix_quote": "PRO-",
  "invoices.number_start_invoice": 1,
  "invoices.number_start_receipt": 1,
  "invoices.number_start_quote": 1,
};

/** The desk person's roles in the demo: the studio's manager. */
const MANAGER: ReadonlySet<string> = new Set(["studio-manager"]);

/** The token the demo's emailed sign-in link carries, and the code the same email shows. */
export const DEMO_LINK_TOKEN = "demo";
export const DEMO_CODE = "000000";

const DAY_MS = 86_400_000;

let current: DemoWorld | null = null;
/** The world the demo booted (the card's bridge acts on it); null outside the demo. */
export const demoWorld = (): DemoWorld | null => current;

// ── the filter grammar, as the data API reads it ────────────────────────────

export function matches(row: Record<string, unknown>, where: ListCondition | undefined): boolean {
  if (where === undefined) return true;
  if ("and" in where) return where.and.every((c) => matches(row, c));
  if ("or" in where) return where.or.some((c) => matches(row, c));
  const value = row[where.column];
  const cmp = (a: unknown, b: unknown): number => {
    const na = Number(a);
    const nb = Number(b);
    if (typeof a !== "boolean" && a !== "" && b !== "" && Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return String(a).localeCompare(String(b));
  };
  switch (where.op) {
    case "eq":
      return value === where.value || (value !== null && value !== undefined && String(value) === String(where.value));
    case "neq":
      return !(value === where.value || String(value) === String(where.value));
    case "gt":
      return value !== null && value !== undefined && cmp(value, where.value) > 0;
    case "gte":
      return value !== null && value !== undefined && cmp(value, where.value) >= 0;
    case "lt":
      return value !== null && value !== undefined && cmp(value, where.value) < 0;
    case "lte":
      return value !== null && value !== undefined && cmp(value, where.value) <= 0;
    case "in":
      return Array.isArray(where.value) && where.value.some((v) => v === value || String(v) === String(value));
    case "ilike": {
      const pattern = String(where.value).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*");
      return new RegExp(`^${pattern}$`).test(String(value ?? "").toLowerCase());
    }
    case "is_null":
      return value === null || value === undefined;
    case "not_null":
      return value !== null && value !== undefined;
  }
}

export function sortRows(rows: Row[], order: string | undefined): Row[] {
  if (order === undefined) return [...rows].sort((a, b) => Number(a.id) - Number(b.id));
  const keys = order.split(",").map((k) => {
    const [column, dir] = k.split(".");
    return { column: column ?? "id", desc: dir === "desc" };
  });
  return [...rows].sort((a, b) => {
    for (const { column, desc } of keys) {
      const x = a[column];
      const y = b[column];
      if (x === y) continue;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      const d = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      if (d !== 0) return desc ? -d : d;
    }
    return Number(a.id) - Number(b.id);
  });
}

// ── the world ───────────────────────────────────────────────────────────────

export function createWorld(source: Seed | SampleSource, base: () => number, zone: string, actor: Actor, options: WorldOptions = {}): DemoWorld {
  const sampled = isSampleSource(source);
  let settings: Record<string, unknown> = { ...(options.settings ?? (sampled ? DEMO_SETTINGS : HAND_SETTINGS)) };
  const currency = options.currency ?? DEMO_CURRENCY;
  let offset = 0;
  const now = () => base() + offset;
  const listeners = new Set<(frame: LiveFrame) => void>();
  const reloads = new Set<() => void>();
  const emit = (table: TableRef, kind: LiveFrame["kind"], id: Id) => listeners.forEach((l) => l({ table, kind, id }));
  const desk: Writer = { origin: "desk", name: actor.name, roles: MANAGER };

  const engine = createEngine({
    now,
    zone,
    currency,
    settings: () => settings,
    announce: emit,
    before: (table, stored, values, writer) => outbox.judgeMove(table, stored, values, writer),
    after: (event) => outbox.produce(event),
  });
  const outbox = createOutbox({ engine: () => engine, now, zone, settings: () => settings });

  // ── the rows brought in ──

  /** What the sample wrote, in the language its words are in now: what a relabel compares with. */
  let baseline: Partial<Record<TableRef, Record<string, unknown>[]>> = {};
  let locale = sampled ? source.locale : "en-US";
  const loadedAt = base();

  function bringIn(): void {
    const input = sampled ? resolveDemoSample({ ...source, locale }, loadedAt, zone) : (source as Partial<Record<TableRef, Record<string, unknown>[]>>);
    baseline = Object.fromEntries(Object.entries(input).map(([ref, list]) => [ref, (list ?? []).map((row) => ({ ...row }))]));
    engine.load(input);
    // A code the server draws for every row that has none (a share link's token).
    for (const project of engine.rows.projects) if (project["share_token"] === null || project["share_token"] === undefined) project["share_token"] = drawCode(16);
  }
  bringIn();

  let linkLive = true;
  const find = (ref: TableRef, id: unknown): Row | undefined => engine.find(ref, id);
  const copy = <R extends TableRef>(row: Row): Tables[R] => ({ ...row }) as unknown as Tables[R];
  const select = <R extends TableRef>(ref: R, where?: ListCondition, order?: string): Tables[R][] =>
    sortRows(engine.rows[ref].filter((r) => matches(r, where)), order).map((r) => copy<R>(r));
  const today = () => venueDay(now(), zone);

  /** A refusal as the desk's data port throws it. */
  const asSink = (error: unknown): never => {
    if (error instanceof Refusal) {
      const column = typeof error.details["column"] === "string" ? (error.details["column"] as string) : null;
      throw new SinkError(error.message, kindOfStatus(error.status, error.code), error.status, error.code, column, error.details);
    }
    throw error;
  };
  /**
   * After every write, the outbox's minute scan — as the next minute would
   * run it on Adminium: a paid or void invoice's waiting reminders go.
   */
  const written = <T>(value: T): T => {
    outbox.scan();
    return value;
  };
  const deskWrite = <T>(run: () => T): T => {
    try {
      return written(run());
    } catch (error) {
      return asSink(error);
    }
  };

  const reads: DeskReads = {
    async snapshot(day, z) {
      const open = openWork(day, z);
      const projects = select("projects", open.projects, "id.desc");
      const ids = projects.map((p) => p.id);
      const snap = {
        today: day,
        settings: select("settings")[0] ?? null,
        people: select("people", undefined, "position.asc"),
        rates: select("rates", undefined, "position.asc"),
        termsVersions: select("terms_versions", undefined, "version.desc"),
        briefQuestions: select("brief_questions", undefined, "position.asc"),
        proposals: select("proposals", open.proposals, "id.desc"),
        invoices: select("invoices", open.invoices, "id.desc"),
        projects,
        milestones: select("milestones", { column: "project_id", op: "in", value: ids }, "position.asc"),
        deliverables: select("deliverables", { column: "project_id", op: "in", value: ids }, "position.asc"),
        enquiries: select("enquiries", open.enquiries, "received_at.desc"),
        messages: select("messages", open.messages, "due.asc"),
        clients: [] as Tables["clients"][],
      };
      const named = new Set([...snap.proposals, ...snap.invoices, ...snap.projects, ...snap.enquiries, ...snap.messages].map((r) => r.client_id));
      snap.clients = select("clients").filter((c) => named.has(c.id));
      return snap;
    },
    rows: async (ref, ids) => select(ref, { column: "id", op: "in", value: [...ids] }),
    where: async (ref, where, order, limit = 2000) => select(ref, where, order).slice(0, limit),
    async page<R extends TableRef>(ref: R, query: { where?: ListCondition; order?: string; limit: number; offset: number; count?: boolean }): Promise<Page<Tables[R]>> {
      const all = select(ref, query.where, query.order);
      return { rows: all.slice(query.offset, query.offset + query.limit), total: query.count === true ? all.length : null };
    },
    async search(text, limit) {
      const q = text.trim().toLowerCase();
      if (q === "") return [];
      const company = (id: unknown) => String(find("clients", id)?.["company"] ?? "") || null;
      const has = (...values: unknown[]) => values.some((v) => String(v ?? "").toLowerCase().includes(q));
      const rows = engine.rows;
      const hits: SearchHit[] = [
        ...rows.proposals.filter((r) => has(r["number"], r["title"])).map((r) => ({ table: "proposals" as const, id: r.id, label: String(r["number"] ?? ""), title: String(r["title"]), client: company(r["client_id"]) })),
        ...rows.invoices.filter((r) => has(r["number"], r["title"])).map((r) => ({ table: "invoices" as const, id: r.id, label: String(r["number"] ?? ""), title: String(r["title"] ?? ""), client: company(r["client_id"]) })),
        ...rows.projects.filter((r) => has(r["number"], r["name"])).map((r) => ({ table: "projects" as const, id: r.id, label: String(r["number"] ?? ""), title: String(r["name"]), client: company(r["client_id"]) })),
        ...rows.clients.filter((r) => has(r["company"], r["contact_name"])).map((r) => ({ table: "clients" as const, id: r.id, label: String(r["company"]), title: String(r["contact_name"]), client: null })),
      ];
      return hits.slice(0, limit);
    },
  };

  const writes: DeskWrites = {
    async insert(ref, values) {
      const key = values["client_key"];
      const earlier = typeof key === "string" ? engine.rows[ref].find((r) => r["client_key"] === key) : undefined;
      // The step's own key already there: the row an earlier try saved.
      if (earlier !== undefined) return copy(earlier);
      return copy(deskWrite(() => engine.insert(ref, values, desk)));
    },
    async update(ref, id, patch) {
      return copy(deskWrite(() => engine.update(ref, id, patch, desk)));
    },
    async remove(ref, id) {
      deskWrite(() => engine.remove(ref, id, desk));
    },
    async upload(_ref, _column, _file, filename) {
      return `demo-file:${filename}`;
    },
    async regenerateCode(ref, id, column) {
      return copy(deskWrite(() => engine.update(ref, id, { [column]: drawCode(16) }, desk)));
    },
    async saveAddOnSettings(key, values) {
      settings = { ...settings, ...Object.fromEntries(Object.entries(values).map(([k, v]) => [`${key}.${k}`, v])) };
      return values;
    },
  };

  function portal(clientId: Id): PortalPort {
    let signedIn = true;
    const client = () => find("clients", clientId);
    const guard = () => {
      if (!signedIn) throw new PortError("PUBLIC_CLAIM_LEVEL", "signed out", 401);
    };
    const mine = (row: Row) => String(row["client_id"]) === String(clientId);
    // What the manifest's public entries let a client read of their own rows.
    const visible: Partial<Record<TableRef, (row: Row) => boolean>> = {
      proposals: (r) => mine(r) && r["status"] !== "draft",
      invoices: (r) => mine(r) && (r["status"] === "sent" || (r["status"] === "void" && r["issued_on"] !== null)),
      payments: (r) => mine(r) && r["voided"] !== true,
      deliverables: (r) => mine(r) && r["status"] !== "unshared",
    };
    const own = (ref: TableRef) => (row: Row) => (visible[ref] ?? mine)(row);
    const guest = (): Writer => ({ origin: "public", name: null, claim: client() ?? null });
    const asPort = (error: unknown): never => {
      if (error instanceof Refusal) throw new PortError(error.code, error.message, error.status, error.details);
      throw error;
    };
    const write = <R extends TableRef>(ref: R, id: Id, patch: Record<string, unknown>, allowed: (row: Row) => boolean): Tables[R] => {
      guard();
      const row = find(ref, id);
      if (row === undefined || !own(ref)(row)) throw new PortError("PUBLIC_REF_NOT_FOUND", "not found", 404);
      if (!allowed(row)) throw new PortError("PUBLIC_WRITE_REFUSED", "refused", 403);
      try {
        return copy<R>(written(engine.update(ref, id, patch, guest())));
      } catch (error) {
        return asPort(error);
      }
    };
    const create = <R extends TableRef>(ref: R, values: Record<string, unknown>): Tables[R] => {
      guard();
      try {
        return copy<R>(written(engine.insert(ref, values, guest())));
      } catch (error) {
        return asPort(error);
      }
    };
    const inDate = (r: Row) => r["valid_until"] === null || String(r["valid_until"]) >= today();
    return {
      timeZone: () => zone,
      currency: () => currency,
      signedIn: () => signedIn,
      requestLink: async () => undefined,
      peekLink: async (token) => (token === DEMO_LINK_TOKEN && linkLive ? { firstName: String(client()?.["contact_name"] ?? "").split(" ")[0] ?? "" } : null),
      verifyLink: async (token) => {
        if (token !== DEMO_LINK_TOKEN || !linkLive) throw new PortError("LINK_EXPIRED", "expired", 410);
        signedIn = true;
      },
      verifyCode: async (_email, code) => {
        if (code === DEMO_CODE) {
          signedIn = true;
          return { ok: true };
        }
        return { ok: false, triesLeft: 4 };
      },
      resendFromLink: async () => undefined,
      signOut: async () => {
        signedIn = false;
      },
      studio: async () => ({
        settings: select("settings")[0] ?? null,
        people: select("people", { column: "shown_to_clients", op: "eq", value: true }, "position.asc"),
        briefQuestions: select("brief_questions", { column: "active", op: "eq", value: true }, "position.asc"),
      }),
      me: async () => {
        guard();
        const c = client();
        return { company: String(c?.["company"] ?? ""), contact_name: String(c?.["contact_name"] ?? "") };
      },
      list: async (ref, where, order, limit = 200) => {
        guard();
        const open = ref === "settings" || ref === "people" || ref === "brief_questions" || ref === "terms_versions" || ref === "terms_clauses";
        return sortRows(engine.rows[ref].filter((r) => (open || own(ref)(r)) && matches(r, where)), order)
          .slice(0, limit)
          .map((r) => copy(r)) as never;
      },
      documentUrl: async (kind, ref, id, language) => {
        guard();
        const row = find(ref, id);
        if (row === undefined || !own(ref)(row)) throw new PortError("PUBLIC_REF_NOT_FOUND", "not found", 404);
        const { printedUrl } = await import("./printed.ts");
        const url = await printedUrl(kind, ref, row, language);
        if (url === null) throw new PortError("DOCUMENT_UNAVAILABLE", "this document was not drawn for the demo", 404);
        return url;
      },
      fileUrl: (ref, id) => String(find(ref, id)?.["link"] ?? "about:blank"),
      accept: async (id, name) => write("proposals", id, { status: "accepted", signed_name: name.trim() }, (r) => r["status"] === "sent" && inDate(r)),
      sign: async (id, name) => write("proposals", id, { signed_name: name.trim() }, (r) => r["status"] === "accepted" && (r["signed_name"] === null || r["signed_name"] === "")),
      decline: async (id, note) => write("proposals", id, { status: "declined", decline_note: note === null || note.trim() === "" ? null : note.trim() }, (r) => r["status"] === "sent" && inDate(r)),
      askNewPrice: async (id) => write("proposals", id, { new_price_asked: true }, (r) => r["status"] === "sent" && !inDate(r) && r["new_price_asked_at"] === null),
      review: async (id, status, note) => write("deliverables", id, status === "changes" ? { status, review_note: note } : { status }, (r) => r["status"] === "pending"),
      addNote: async (note) => create("deliverable_notes", { ...note }),
      saveAnswer: async (briefId, key, answer, existing) => {
        if (existing !== null) return write("brief_answers", existing, { answer }, () => find("briefs", briefId)?.["status"] === "open");
        return create("brief_answers", { brief_id: briefId, question_key: key, answer });
      },
      sendBrief: async (briefId) => write("briefs", briefId, { status: "sent" }, (r) => r["status"] === "open"),
      sentPayment: async (id, p) =>
        write("invoices", id, { client_paid: true, client_paid_on: p.on, client_paid_amount: p.amount, client_paid_note: p.note }, (r) => r["status"] === "sent" && r["client_paid_at"] === null),
      openHandover: async (token): Promise<HandoverView> => {
        const project = engine.rows.projects.find((p) => p["share_token"] === token && p["share_stopped"] !== true);
        if (project === undefined) throw new PortError("LINK_STOPPED", "stopped", 410);
        const deliverables = engine.rows.deliverables.filter((d) => d["project_id"] === project.id && d["status"] === "approved");
        return {
          studio: select("settings")[0] ?? null,
          project: copy<"projects">(project),
          fonts: select("project_fonts", { column: "project_id", op: "eq", value: project.id }),
          files: select("handover_files", { column: "project_id", op: "eq", value: project.id }),
          deliverables: deliverables.map((d) => copy<"deliverables">(d)),
          versions: select("deliverable_versions", { column: "deliverable_id", op: "in", value: deliverables.map((d) => d.id) }),
        };
      },
    };
  }

  /** Rows that were sealed in the demo: their words stay as they were accepted. */
  function sealedKeys(): Set<string> {
    const out = new Set<string>();
    for (const proposal of engine.rows.proposals) {
      if (proposal["fingerprint"] === null || proposal["fingerprint"] === undefined) continue;
      out.add(`proposals|${String(proposal.id)}`);
      for (const line of engine.rows.proposal_lines) if (String(line["document_id"]) === String(proposal.id)) out.add(`proposal_lines|${String(line.id)}`);
      out.add(`terms_versions|${String(proposal["terms_version_id"])}`);
      for (const clause of engine.rows.terms_clauses) if (String(clause["version_id"]) === String(proposal["terms_version_id"])) out.add(`terms_clauses|${String(clause.id)}`);
    }
    return out;
  }

  const world: DemoWorld = {
    get rows() {
      return engine.rows;
    },
    reads,
    writes,
    portal,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    now,
    advance(days) {
      offset += days * DAY_MS;
      clockJumped();
      // The minute scan and the sender, at the new moment.
      outbox.scan();
      outbox.send();
      reloads.forEach((l) => l());
    },
    reset() {
      offset = 0;
      linkLive = true;
      settings = { ...(options.settings ?? (sampled ? DEMO_SETTINGS : HAND_SETTINGS)) };
      bringIn();
      clockJumped();
      reloads.forEach((l) => l());
    },
    relabel(next) {
      if (!sampled || next === locale) return;
      const fresh = resolveDemoSample({ ...source, locale: next }, loadedAt, zone);
      const sealed = sealedKeys();
      for (const ref of TABLE_REFS) {
        const was = baseline[ref] ?? [];
        const now = fresh[ref] ?? [];
        was.forEach((old, index) => {
          const row = find(ref, old["id"]);
          const updated = now[index];
          if (row === undefined || updated === undefined || sealed.has(`${ref}|${String(row.id)}`)) return;
          let touched = false;
          for (const [column, value] of Object.entries(old)) {
            if (typeof value !== "string" || row[column] !== value || updated[column] === value) continue;
            row[column] = updated[column];
            touched = true;
          }
          if (touched) emit(ref, "record.update", row.id);
        });
      }
      baseline = Object.fromEntries(Object.entries(fresh).map(([ref, list]) => [ref, (list ?? []).map((row) => ({ ...row }))]));
      locale = next;
      reloads.forEach((l) => l());
    },
    expireLink() {
      linkLive = false;
    },
    onReload(listener) {
      reloads.add(listener);
      return () => reloads.delete(listener);
    },
    settings: () => settings,
    async documentUrl(kind, ref, id, language) {
      const row = find(ref, id);
      if (row === undefined) return null;
      const { printedUrl } = await import("./printed.ts");
      return printedUrl(kind, ref, row, language);
    },
  };
  current = world;
  return world;
}
