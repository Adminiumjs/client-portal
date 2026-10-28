/**
 * The studio's clients, as the manifest tells Adminium of them: who a client
 * is and where they are copied, which emails the do-not-email list may stop
 * (none), and which tables the law keeps.
 */
import { describe, expect, it } from "vitest";

import { mailClassFloorIssues, mailClassOf } from "../testing/manifest/mail-class.ts";
import { buildManifest, MIN_ADMINIUM } from "./build.ts";
import { KINDS } from "./outbox.ts";

type Json = Record<string, unknown>;
type Column = Json & { ref: string; type: string; references?: string; rules?: Json };
type Copy = { table: string; column: string; holds: string; via?: string };
type Person = Json & { table: string; email: string; copies: Copy[] };
type Entry = Json & { table: string; claim?: Json };
type Producer = Json & { kind: string; recipient?: Json };

const manifest = buildManifest() as Json & {
  people: Person[];
  publicAccess: Entry[];
  outbox: Json & { recipient: Json; kinds: Record<string, string>; classes: Record<string, string>; producers: Producer[] };
  requiredSchema: { tables: (Json & { ref: string; keep?: Json; columns: Column[] })[] };
  compatibility: { minAdminiumVersion: string };
};
const table = (ref: string) => manifest.requiredSchema.tables.find((t) => t.ref === ref)!;
const column = (t: string, ref: string) => table(t).columns.find((c) => c.ref === ref);

/** The kinds sent only to the studio's own address. */
const TO_THE_STUDIO = ["accepted-and-signed", "declined", "asked-for-a-new-price", "changes-requested", "approved", "new-note", "client-says-paid", "brief-sent", "new-enquiry"];

describe("the studio's clients", () => {
  it("are the clients table: the contact's address, name, first name and language, no consent, customer or opt-out mark, and every copy of them", () => {
    expect(manifest.people).toEqual([
      {
        table: "clients",
        kind: "people",
        email: "email",
        name: "contact_name",
        firstName: "firstWordOfName",
        language: "language",
        copies: [
          { table: "enquiries", column: "name", holds: "name", via: "client_id" },
          { table: "enquiries", column: "email", holds: "email", via: "client_id" },
          { table: "proposals", column: "signed_name", holds: "name", via: "client_id" },
          { table: "proposals", column: "signed_email", holds: "email", via: "client_id" },
          { table: "deliverables", column: "approved_by", holds: "name", via: "client_id" },
          { table: "deliverable_notes", column: "author", holds: "name", via: "client_id" },
        ],
      },
    ]);
    expect([MIN_ADMINIUM, manifest.compatibility.minAdminiumVersion]).toEqual(["0.3.38", "0.3.38"]);
  });

  it("are not the studio's own team, whose table is called people", () => {
    expect(table("people")).toBeDefined();
    expect(manifest.people.map((p) => p.table)).toEqual(["clients"]);
    expect(JSON.stringify(manifest.people)).not.toContain('"table":"people"');
  });

  it("have one address: the one the outbox writes to and the one their emailed sign-in link goes to", () => {
    const person = manifest.people[0]!;
    expect([manifest.outbox.recipient["table"], manifest.outbox.recipient["email"], manifest.outbox.recipient["name"], manifest.outbox.recipient["language"]]).toEqual([
      person.table,
      person.email,
      person["name"],
      person["language"],
    ]);
    const signIn = manifest.publicAccess.filter((e) => e.table === "clients" && e.claim?.["email"] !== undefined);
    expect(signIn.map((e) => e.claim!["email"])).toEqual([person.email]);
  });

  it("are copied onto text columns, each linked back to the client", () => {
    for (const copy of manifest.people[0]!.copies) {
      const held = column(copy.table, copy.column);
      expect([copy.table, copy.column, held?.type]).toEqual([copy.table, copy.column, "text"]);
      expect([copy.table, copy.via, column(copy.table, copy.via!)]).toEqual([copy.table, "client_id", expect.objectContaining({ type: "fk", references: "clients" })]);
    }
  });

  it("are copied by name where the clients' side stamps the signed-in contact: work approved and notes written", () => {
    for (const [t, ref] of [
      ["deliverables", "approved_by"],
      ["deliverable_notes", "author"],
    ] as const) {
      expect([t, ref, (column(t, ref)?.rules?.["stamp"] as Json | undefined)?.["set"]]).toEqual([t, ref, expect.objectContaining({ claim: "contact_name" })]);
    }
  });

  it("keep the personal marks they had: none new, so no list, template or rule loses a column to a mask", () => {
    const personal = manifest.requiredSchema.tables.flatMap((t) => t.columns.filter((c) => c.rules?.["personal"] === true).map((c) => `${t.ref}.${c.ref}`));
    expect(personal).toEqual([]);
  });
});

describe("the tables the law keeps", () => {
  it("are the studio's money, for tax, and what its clients agreed to, as a contract", () => {
    const kept = manifest.requiredSchema.tables.filter((t) => t.keep !== undefined).map((t) => [t.ref, t.keep]);
    expect(kept).toEqual([
      ["terms_versions", { law: "contract" }],
      ["proposals", { law: "contract" }],
      ["invoices", { law: "tax" }],
      ["invoice_lines", { law: "tax" }],
      ["payments", { law: "tax" }],
    ]);
  });

  it("leave the enquiries, the work and its notes the tables where an erasure blanks a client's copies", () => {
    const keptRefs = manifest.requiredSchema.tables.filter((t) => t.keep !== undefined).map((t) => t.ref);
    const blanked = [...new Set(manifest.people[0]!.copies.map((c) => c.table))].filter((ref) => !keptRefs.includes(ref));
    expect(blanked).toEqual(["enquiries", "deliverables", "deliverable_notes"]);
  });
});

describe("the studio's emails", () => {
  it("are every one service mail: the do-not-email list stops none", () => {
    expect(Object.keys(manifest.outbox.classes).sort()).toEqual([...KINDS].sort());
    for (const kind of KINDS) expect([kind, mailClassOf(manifest as never, { outboxKind: kind })]).toEqual([kind, "service"]);
  });

  it("include the notices to the studio, sent only to its reply-to address, which say service though they need no class", () => {
    const house = KINDS.filter((kind) => {
      const producers = manifest.outbox.producers.filter((p) => p.kind === kind);
      return producers.length > 0 && producers.every((p) => p.recipient !== undefined && "setting" in p.recipient);
    });
    expect([...house].sort()).toEqual([...TO_THE_STUDIO].sort());
    for (const kind of TO_THE_STUDIO) expect([kind, manifest.outbox.classes[kind]]).toEqual([kind, "service"]);
    // Without its class, a notice reads as staff mail: it was never a client's.
    const { classes: _classes, ...unclassed } = manifest.outbox;
    for (const kind of TO_THE_STUDIO) expect([kind, mailClassOf({ outbox: unclassed } as never, { outboxKind: kind })]).toEqual([kind, "staff"]);
  });

  it("leave no kind unclassed, as Adminium 0.3.38 asks: every kind to a client is refused without one", () => {
    expect(mailClassFloorIssues(manifest as never)).toEqual([]);
    const { classes: _classes, ...unclassed } = manifest.outbox;
    expect(mailClassFloorIssues({ ...manifest, outbox: unclassed } as never).length).toBe(KINDS.length - TO_THE_STUDIO.length);
  });
});
