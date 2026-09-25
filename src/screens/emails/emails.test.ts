/**
 * Every email the Emails screen shows, and the one thing it sends: a test.
 *
 *   the list      every outbox kind the app ships is on the screen (to
 *                 clients or to the studio), with Adminium's sign-in link
 *   the template  each has its words in all eight languages, and the preview
 *                 fills every place the outbox fills
 *   a test        goes to the studio's own address, read again from
 *                 Adminium — never the client's, never one the page holds —
 *                 carries no sign-in link, no share code and nothing left to
 *                 fill, and is refused before anything leaves when it would
 */
import { beforeEach, describe, expect, it } from "vitest";

import type { DeskWrites, EmailDocument } from "../../data/ports.ts";
import { SinkError } from "../../data/sink.ts";
import { LOCALE_TAGS } from "../../i18n/locales.ts";
import { KINDS } from "../../manifest/outbox.ts";
import { deskWrites, setDeskWrites, useDesk } from "../../state/desk.ts";
import { fakeStudio, type FakeStudio } from "../../testing/fakeStudio.ts";
import { CLIENT_EMAILS, STUDIO_EMAILS, fill, filled, pieces, placesIn, plainLines, shippedDoc, testDocument, testProblem, type EmailKind } from "./model.ts";
import { HIDDEN_TOKEN, followOf, loadSampleRows, pick, placesFrom, recipientOf, valuesFor } from "./samples.ts";
import { sendTest } from "./send.ts";

const PLACES = { portal: "https://studio.example/apps/clients/customer/", staff: "https://studio.example/apps/clients/staff/" };

describe("the list", () => {
  it("shows every email the outbox sends, once, and the sign-in link", () => {
    const shown = [...CLIENT_EMAILS, ...STUDIO_EMAILS];
    expect(new Set(shown).size).toBe(shown.length);
    expect([...shown].sort()).toEqual([...KINDS, "sign-in-link"].sort());
    expect([CLIENT_EMAILS.length, STUDIO_EMAILS.length]).toEqual([12, 9]);
  });

  it("has every template's words in all eight languages", () => {
    for (const kind of [...CLIENT_EMAILS, ...STUDIO_EMAILS]) {
      const english = shippedDoc(kind, "en-US");
      for (const tag of LOCALE_TAGS) {
        const doc = shippedDoc(kind, tag);
        expect(doc.subject, `${kind} ${tag}`).not.toBe("");
        expect(doc.blocks.map((b) => b.block), `${kind} ${tag}`).toEqual(english.blocks.map((b) => b.block));
        if (tag !== "en-US" && kind !== "sign-in-link") expect(doc.subject, `${kind} ${tag}`).not.toBe(english.subject);
      }
    }
  });
});

describe("a preview", () => {
  let studio: FakeStudio;
  beforeEach(async () => {
    studio = await fakeStudio();
    await loadSampleRows();
  });

  it("fills every place the templates name from the studio's own rows", () => {
    const rows = useDesk.getState().rows;
    const settings = Object.values(rows.settings)[0]!;
    for (const kind of [...CLIENT_EMAILS, ...STUDIO_EMAILS] as EmailKind[]) {
      const picked = pick(kind, rows, "2026-07-28");
      const values = valuesFor(picked, { tag: "en-US", today: "2026-07-28", settings, payHow: "Bank transfer", places: PLACES, code: "481926" });
      const doc = filled(shippedDoc(kind, "en-US"), values);
      const text = JSON.stringify(doc);
      expect(placesIn(text), kind).toEqual([]);
      // Every place had a value: nothing reads as a bracketed name.
      expect(text, kind).not.toMatch(/\[[a-z_]+(\.[a-z_]+)+\]/);
    }
    expect(studio.writes).toEqual([]);
  });

  it("draws the invoice email: greeting, the invoice row, how to pay with its reference, the button, the sign-off", () => {
    const rows = useDesk.getState().rows;
    const picked = pick("invoice-sent", rows, "2026-07-28");
    const values = valuesFor(picked, { tag: "en-US", today: "2026-07-28", settings: Object.values(rows.settings)[0]!, payHow: "Bank transfer\nSort 00-00-00", places: PLACES, code: "481926" });
    const ps = pieces(filled(shippedDoc("invoice-sent", "en-US"), values));
    expect(ps.map((p) => p.kind)).toEqual(["lead", "para", "rows", "box", "button", "sign"]);
    const box = ps.find((p) => p.kind === "box") as { lines: string[]; reference: string };
    expect(box.lines).toEqual(["Bank transfer", "Sort 00-00-00"]);
    expect(box.reference).toBe(`Reference: ${picked.invoice!.number!}`);
    expect(recipientOf("invoice-sent", picked, null, false)).toBe(picked.client!.email);
    expect(plainLines(ps, "Foot").at(-1)).toEqual({ text: "--\nFoot", tone: "foot" });
  });

  it("never shows a share code or a sign-in token, only the address with the token left out", () => {
    const rows = useDesk.getState().rows;
    const picked = pick("handover", rows, "2026-07-28");
    expect(picked.project?.share_token).toBe("KILNSTREETDONE26");
    const values = valuesFor(picked, { tag: "en-US", today: "2026-07-28", settings: null, payHow: null, places: PLACES, code: "481926" });
    const doc = filled(shippedDoc("handover", "en-US"), values);
    expect(JSON.stringify(doc)).not.toContain("KILNSTREETDONE26");
    expect(pieces(doc).find((p) => p.kind === "button")).toMatchObject({ url: `${PLACES.portal}h#${HIDDEN_TOKEN}` });
    expect(values["signInLink"]).toBe(`${PLACES.portal}c#${HIDDEN_TOKEN}`);
  });

  it("follows a client's link into the studio's preview of their side, and a notice into the desk", () => {
    const rows = useDesk.getState().rows;
    expect(followOf("invoice-sent", pick("invoice-sent", rows, "2026-07-28"))).toMatchObject({ to: "client", view: "invoice" });
    expect(followOf("declined", pick("declined", rows, "2026-07-28"))).toMatchObject({ to: "desk", view: "proposal" });
    expect(followOf("enquiry-reply", pick("enquiry-reply", rows, "2026-07-28"))).toEqual({ to: "none" });
  });

  it("knows the two sides' addresses from where the desk is served", () => {
    expect(placesFrom("https://a.example", "/apps/clients/staff/emails")).toEqual({ portal: "https://a.example/apps/clients/customer/", staff: "https://a.example/apps/clients/staff/" });
    expect(placesFrom("https://a.example", "/apps/clients/acme/staff/")).toEqual({ portal: "https://a.example/apps/clients/acme/customer/", staff: "https://a.example/apps/clients/acme/staff/" });
  });
});

describe("a test", () => {
  let studio: FakeStudio;
  let sent: { id: string; to: readonly string[]; document: EmailDocument }[];
  let templates: string[];
  let answer: (() => Promise<{ queued: number }>) | null;

  beforeEach(async () => {
    studio = await fakeStudio();
    await loadSampleRows();
    sent = [];
    templates = [];
    answer = null;
    const base = deskWrites();
    const withEmail: DeskWrites = {
      ...base,
      emailTemplate: async (key, locale) => {
        templates.push(`${key}/${locale}`);
        return { id: `t-${key}-${locale}`, name: key, subject: "s", preheader: "", blocks: [], footer: "" };
      },
      testEmail: async (id, to, document) => {
        sent.push({ id, to, document });
        return answer === null ? { queued: to.length } : answer();
      },
    };
    setDeskWrites(withEmail);
  });

  function previewOf(kind: EmailKind, tag: "en-US" | "ar-EG" = "en-US") {
    const rows = useDesk.getState().rows;
    const values = valuesFor(pick(kind, rows, "2026-07-28"), { tag, today: "2026-07-28", settings: Object.values(rows.settings)[0]!, payHow: "Bank transfer", places: PLACES, code: "481926" });
    return filled(shippedDoc(kind, tag), values);
  }
  const secrets = () => Object.values(useDesk.getState().rows.projects).map((p) => p.share_token).filter((s): s is string => s !== null);

  it("goes to the studio's own address, read again from Adminium, and nowhere else", async () => {
    // What the page holds is not what counts: the address is read again when the test goes.
    const held = Object.values(useDesk.getState().rows.settings)[0]!;
    useDesk.setState((s) => ({ rows: { ...s.rows, settings: { [held.id]: { ...held, reply_to: "someone@elsewhere.example" } } } }));
    const out = await sendTest({ kind: "invoice-sent", tag: "en-US", doc: previewOf("invoice-sent"), studio: false, guard: { portal: PLACES.portal, secrets: secrets() } });
    expect(out).toEqual({ ok: true, to: "hello@outline.example" });
    expect(sent.map((s) => s.to)).toEqual([["hello@outline.example"]]);
    expect(templates).toEqual(["clients-invoice-sent/en_US"]);
    expect(sent[0]!.id).toBe("t-clients-invoice-sent-en_US");
    // A client's address is never a recipient.
    const clientEmails = Object.values(useDesk.getState().rows.clients).map((c) => c.email);
    for (const s of sent) for (const to of s.to) expect(clientEmails).not.toContain(to);
    expect(studio.writes).toEqual([]);
  });

  it("points every button to the clients' side at the portal's front page: no sign-in link, no share code", async () => {
    for (const kind of CLIENT_EMAILS) {
      const out = await sendTest({ kind, tag: "en-US", doc: previewOf(kind), studio: false, guard: { portal: PLACES.portal, secrets: secrets() } });
      expect(out.ok, kind).toBe(true);
    }
    for (const s of sent) {
      const text = JSON.stringify(s.document);
      expect(text).not.toContain("KILNSTREETDONE26");
      expect(text).not.toContain(HIDDEN_TOKEN + '"');
      for (const b of s.document.blocks.filter((x) => x.block === "email.button")) expect(b.data["url"]).toBe(PLACES.portal);
    }
  });

  it("is refused before anything leaves when it would carry a live link or a place to fill", async () => {
    const doc = previewOf("new-work");
    const leaking = { ...doc, blocks: [...doc.blocks, { id: "x", block: "email.text", data: { paras: ["Open https://studio.example/apps/clients/customer/h#KILNSTREETDONE26"] } }] };
    expect(await sendTest({ kind: "new-work", tag: "en-US", doc: leaking, studio: false, guard: { portal: PLACES.portal, secrets: secrets() } })).toEqual({ ok: false, problem: "live-link" });
    const secretOnly = { ...doc, blocks: [...doc.blocks, { id: "x", block: "email.text", data: { paras: ["code KILNSTREETDONE26"] } }] };
    expect(await sendTest({ kind: "new-work", tag: "en-US", doc: secretOnly, studio: false, guard: { portal: PLACES.portal, secrets: secrets() } })).toEqual({ ok: false, problem: "live-link" });
    const unfilled = { ...doc, subject: "Hi {{signInLink}}" };
    expect(await sendTest({ kind: "new-work", tag: "en-US", doc: unfilled, studio: false, guard: { portal: PLACES.portal, secrets: [] } })).toEqual({ ok: false, problem: "live-link" });
    expect(sent).toEqual([]);
  });

  it("keeps a studio notice's link to the desk, and sends in the email's own language", async () => {
    await sendTest({ kind: "declined", tag: "ar-EG", doc: previewOf("declined", "ar-EG"), studio: true, guard: { portal: PLACES.portal, secrets: secrets() } });
    expect(templates).toEqual(["clients-declined/ar_EG"]);
    const button = sent[0]!.document.blocks.find((b) => b.block === "email.button")!;
    expect(String(button.data["url"])).toMatch(/^https:\/\/studio\.example\/apps\/clients\/staff\/proposals\/\d+$/);
  });

  it("says why when Adminium will not send it", async () => {
    const doc = previewOf("proposal-sent");
    const guard = { portal: PLACES.portal, secrets: [] };
    answer = () => Promise.reject(new SinkError("no", "refused", 403, "FORBIDDEN"));
    expect(await sendTest({ kind: "proposal-sent", tag: "en-US", doc, studio: false, guard })).toEqual({ ok: false, problem: "not-allowed" });
    answer = () => Promise.reject(new SinkError("no smtp", "refused", 409, "CONFLICT", null, { setting: "email.smtp" }));
    expect(await sendTest({ kind: "proposal-sent", tag: "en-US", doc, studio: false, guard })).toEqual({ ok: false, problem: "no-email" });
    answer = () => Promise.reject(new SinkError("gone", "offline", 0, "NETWORK"));
    expect(await sendTest({ kind: "proposal-sent", tag: "en-US", doc, studio: false, guard })).toEqual({ ok: false, problem: "offline" });
  });

  it("goes nowhere when the studio has no reply-to address, or nothing here sends email", async () => {
    const held = Object.values(useDesk.getState().rows.settings)[0]!;
    await studio.world.writes.update("settings", held.id, { reply_to: null });
    expect(await sendTest({ kind: "proposal-sent", tag: "en-US", doc: previewOf("proposal-sent"), studio: false, guard: { portal: PLACES.portal, secrets: [] } })).toEqual({ ok: false, problem: "no-reply-to" });
    const { emailTemplate: _t, testEmail: _s, ...plain } = deskWrites();
    setDeskWrites(plain);
    expect(await sendTest({ kind: "proposal-sent", tag: "en-US", doc: previewOf("proposal-sent"), studio: false, guard: { portal: PLACES.portal, secrets: [] } })).toEqual({ ok: false, problem: "no-sender" });
    expect(sent).toEqual([]);
  });
});

describe("filling", () => {
  it("puts a value in each place, and names a place with none", () => {
    expect(fill("{{a.b}} and {{ c }}", { "a.b": "x", c: "y" })).toBe("x and y");
    expect(fill("{{missing.one}}", {})).toBe("[missing.one]");
  });

  it("finds a place left, a token riding a link and a held share code", () => {
    const doc = (text: string): EmailDocument => ({ subject: "", preheader: "", footer: "", blocks: [{ id: "a", block: "email.text", data: { paras: [text] } }] });
    expect(testProblem(doc("{{signInLink}}"), { secrets: [] })).toBe("unfilled");
    expect(testProblem(doc("https://x.example/c#abcdefgh12"), { secrets: [] })).toBe("live-link");
    expect(testProblem(doc("see SECRET-TOKEN-1"), { secrets: ["SECRET-TOKEN-1"] })).toBe("live-link");
    expect(testProblem(doc("Account #12345678, reference INV-1"), { secrets: [] })).toBeNull();
    expect(testDocument({ name: "n", subject: "", preheader: "", footer: "", blocks: [{ id: "b", block: "email.button", data: { label: "Go", url: "https://x/c#tok" } }] }, false, { portal: "https://p/", secrets: [] }).blocks[0]!.data["url"]).toBe("https://p/");
  });
});
