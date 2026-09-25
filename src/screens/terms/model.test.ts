/**
 * Terms & signature, worked out from stored rows: where an agreement stands,
 * how versions are named and when they retired, which may still change, what
 * a version changed, the trail from stamps, one signature request a day —
 * and a new version as Adminium writes it: the version, then its full clause
 * list copied from the one in force, then put in force over the old one.
 */
import { beforeEach, describe, expect, it } from "vitest";

import type { Message, Project, Proposal, TermsClause, TermsVersion } from "../../data/types.ts";
import { newTermsVersion, putTermsInForce } from "../../state/actions.ts";
import { loadTermsVersion, useDesk } from "../../state/desk.ts";
import { fakeStudio, type FakeStudio } from "../../testing/fakeStudio.ts";
import {
  agreementState,
  askedState,
  changeAfterEdit,
  clausesOf,
  copyClauses,
  copySource,
  defaultAgreement,
  diffRows,
  editable,
  retiredOn,
  shortFingerprint,
  trailOf,
  versionNumber,
  versionsInOrder,
} from "./model.ts";

const ZONE = "America/New_York";
const v = (over: Partial<TermsVersion>): TermsVersion => ({ id: 1, version: 1, status: "retired", in_force_from: null, note: null, client_key: null, ...over });
const clause = (over: Partial<TermsClause>): TermsClause => ({ id: 1, version_id: 1, position: 0, title: "Paying", body: "Fourteen days.", change: "same", change_note: null, client_key: null, ...over });
const proposal = (over: Partial<Proposal>): Proposal => ({ id: 7, status: "accepted", signed_name: null, signed_at: null, decided_at: null, sent_at: null, accepted_how: null, ...over }) as Proposal;
const message = (over: Partial<Message>): Message => ({ id: 1, kind: "ask-to-sign", status: "sent", proposal_id: 7, sent_at: null, ...over }) as Message;

describe("agreements", () => {
  it("are out, signed (a name typed) or accepted with no signature", () => {
    expect(agreementState(proposal({ status: "sent" }))).toBe("out");
    expect(agreementState(proposal({ signed_name: "Cleo Marchetti" }))).toBe("signed");
    expect(agreementState(proposal({ signed_name: " " }))).toBe("unsigned");
  });

  it("open on the first accepted without a signature, else the first accepted", () => {
    const out = proposal({ id: 1, status: "sent" });
    const signed = proposal({ id: 2, signed_name: "A" });
    const unsigned = proposal({ id: 3 });
    expect(defaultAgreement([out, signed, unsigned])?.id).toBe(3);
    expect(defaultAgreement([out, signed])?.id).toBe(2);
    expect(defaultAgreement([])).toBeNull();
  });
});

describe("versions", () => {
  const versions = [v({ id: 3, version: 3, status: "in_force", in_force_from: "2026-03-01" }), v({ id: 1, version: 1, in_force_from: "2025-02-01" }), v({ id: 2, version: 2, in_force_from: "2025-09-01" })];

  it("run oldest first; a row read back with no state reads as a draft; a row with no number is named by its place", () => {
    const withDraft = [...versions, { ...v({ id: 9, version: null }), status: null } as unknown as TermsVersion];
    const ordered = versionsInOrder(withDraft);
    expect(ordered.map((x) => x.id)).toEqual([1, 2, 3, 9]);
    expect(ordered[3]!.status).toBe("draft");
    expect(versionNumber(ordered[3]!, ordered)).toBe(4);
  });

  it("retire on the day the next version came into force", () => {
    expect(retiredOn(versions[1]!, versions)).toBe("2025-09-01");
    expect(retiredOn(versions[2]!, versions)).toBe("2026-03-01");
    expect(retiredOn(versions[0]!, versions)).toBeNull();
  });

  it("may change only while no sent proposal names them — and not before that is known", () => {
    expect(editable(v({ status: "draft" }), 0)).toBe(true);
    expect(editable(v({ status: "in_force" }), 0)).toBe(true);
    expect(editable(v({ status: "in_force" }), 3)).toBe(false);
    expect(editable(v({ status: "draft" }), null)).toBe(false);
    expect(editable(v({ status: "retired" }), 0)).toBe(false);
  });

  it("start a new one from the version in force", () => {
    expect(copySource(versions)?.id).toBe(3);
    expect(copySource([v({ id: 5, version: 5, status: "draft" })])?.id).toBe(5);
    expect(copySource([])).toBeNull();
  });
});

describe("clauses", () => {
  it("are copied whole into a new version, each marked the same", () => {
    const copied = copyClauses([clause({ id: 2, position: 1, title: "Files", change: "added", change_note: "new" }), clause({ id: 1, position: 0 })]);
    expect(copied).toEqual([
      { title: "Paying", body: "Fourteen days.", change: "same", change_note: null },
      { title: "Files", body: "Fourteen days.", change: "same", change_note: null },
    ]);
  });

  it("are marked changed once their wording moves; an added clause stays added", () => {
    expect(changeAfterEdit(clause({}), { title: "Paying", body: "Thirty days." })).toBe("changed");
    expect(changeAfterEdit(clause({}), { title: "Paying ", body: "Fourteen days." })).toBe("same");
    expect(changeAfterEdit(clause({ change: "added" }), { title: "New", body: "x" })).toBe("added");
  });

  it("say what changed against the version before; the first says what it covered", () => {
    const versions = [v({ id: 1, version: 1, note: "The first one." }), v({ id: 2, version: 2 })];
    const clauses = [clause({ id: 10, version_id: 2, change: "same" }), clause({ id: 11, version_id: 2, position: 1, title: "Pause", change: "added", change_note: "After Northlight." }), clause({ id: 12, version_id: 2, position: 2, title: "Paying", change: "changed", body: "Thirty days." })];
    expect(diffRows(versions[1]!, clauses, versions)).toEqual([
      { key: "11", mark: "+", title: "Pause", body: "After Northlight." },
      { key: "12", mark: "~", title: "Paying", body: "Thirty days." },
    ]);
    expect(diffRows(versions[0]!, clauses, versions)).toEqual([{ key: "first", mark: "·", title: "", body: "The first one." }]);
    expect(clausesOf(clauses, 2).map((c) => c.id)).toEqual([10, 11, 12]);
  });
});

describe("the trail", () => {
  const project = { id: 1, number: "PRJ-01", status: "done", started_on: "2026-06-10", done_on: "2026-07-20", handover_sent: true } as Project;

  it("reads a portal signature as one row, then the project's start and close", () => {
    const p = proposal({ sent_at: "2026-06-02T14:00:00.000Z", decided_at: "2026-06-09T16:00:00.000Z", signed_at: "2026-06-09T16:00:00.000Z", signed_name: "Cleo", accepted_how: "portal" });
    expect(trailOf(p, { messages: [], project, zone: ZONE }).map((r) => [r.kind, r.on, r.tone])).toEqual([
      ["sent", "2026-06-02", "neutral"],
      ["acceptedSigned", "2026-06-09", "good"],
      ["started", "2026-06-10", "neutral"],
      ["closed", "2026-07-20", "neutral"],
    ]);
  });

  it("keeps an acceptance by email apart from a signature typed later, with each request between", () => {
    const p = proposal({ sent_at: "2026-06-02T14:00:00.000Z", decided_at: "2026-06-09T16:00:00.000Z", accepted_how: "email", signed_name: "Devi", signed_at: "2026-06-20T09:00:00.000Z" });
    const asks = [message({ id: 5, sent_at: "2026-06-15T10:00:00.000Z" }), message({ id: 6, status: "skipped", sent_at: null }), message({ id: 7, kind: "proposal-reminder", sent_at: "2026-06-16T10:00:00.000Z" })];
    expect(trailOf(p, { messages: asks, project: null, zone: ZONE }).map((r) => [r.kind, r.on])).toEqual([
      ["sent", "2026-06-02"],
      ["acceptedBy", "2026-06-09"],
      ["asked", "2026-06-15"],
      ["signed", "2026-06-20"],
    ]);
  });

  it("puts a request still on its way last", () => {
    const p = proposal({ sent_at: "2026-06-02T14:00:00.000Z", decided_at: "2026-06-09T16:00:00.000Z", accepted_how: "email" });
    expect(trailOf(p, { messages: [message({ status: "queued" })], project: null, zone: ZONE }).map((r) => r.kind)).toEqual(["sent", "acceptedBy", "asked"]);
  });
});

describe("asking them to sign", () => {
  it("is once a day: asked today (or on its way) waits; a day later asks again", () => {
    expect(askedState([], 7, "2026-07-28", ZONE)).toBe("never");
    expect(askedState([message({ status: "queued" })], 7, "2026-07-28", ZONE)).toBe("today");
    expect(askedState([message({ sent_at: "2026-07-28T13:00:00.000Z" })], 7, "2026-07-28", ZONE)).toBe("today");
    expect(askedState([message({ sent_at: "2026-07-27T13:00:00.000Z" })], 7, "2026-07-28", ZONE)).toBe("before");
    expect(askedState([message({ proposal_id: 8, status: "queued" })], 7, "2026-07-28", ZONE)).toBe("never");
  });
});

describe("the fingerprint", () => {
  it("is Adminium's stored value, shown first four … last four", () => {
    expect(shortFingerprint("3f9a0c77d1e25b6a90c21e")).toBe("3f9a…c21e");
    expect(shortFingerprint(null)).toBeNull();
  });
});

describe("a new version, as the screen saves it", () => {
  let studio: FakeStudio;
  beforeEach(async () => {
    studio = await fakeStudio();
  });

  it("writes the version, then the full clause list of the one in force, then retires it and puts the new one in force", async () => {
    const versions = versionsInOrder(Object.values(useDesk.getState().rows.terms_versions));
    const source = copySource(versions)!;
    expect(source.version).toBe(3);
    await loadTermsVersion(source.id);
    const clauses = copyClauses(clausesOf(Object.values(useDesk.getState().rows.terms_clauses), source.id));
    const from = studio.writes.length;
    const made = await newTermsVersion({ in_force_from: "2026-08-01", note: "Pause after 30 days", clauses });
    expect(made.ok).toBe(true);
    const created = studio.writes.slice(from);
    expect(created.map((w) => w.table)).toEqual(["terms_versions", "terms_clauses", "terms_clauses", "terms_clauses", "terms_clauses"]);
    expect(created.slice(1).every((w) => w.values?.["change"] === "same")).toBe(true);
    expect(created.slice(1).map((w) => w.values?.["title"])).toEqual(["What we make", "Paying in stages", "Your files", "When payment is late"]);
    if (!made.ok) return;
    const put = await putTermsInForce(made.value.id);
    expect(put.ok).toBe(true);
    expect(studio.writes.slice(-2).map((w) => [w.id, w.values])).toEqual([
      [source.id, { status: "retired" }],
      [made.value.id, { status: "in_force" }],
    ]);
  });
});
