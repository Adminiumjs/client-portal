/**
 * One digit system per page.
 *
 * In Arabic the page's money and dates come out of `Intl` in Arabic-Indic
 * digits, so every other number it shows must too — a count said in a
 * sentence, a KPI figure, a badge, hours, a percentage, a page number. Two
 * checks:
 *
 *   - `t()` fills a numeric parameter in the page's digits, and in English
 *     that changes not one byte of any message;
 *   - the main screens of both sides, drawn in Arabic from the sample studio,
 *     carry no Latin digit in any text a person reads — but for what is data
 *     rather than a number said in words: a document's number (INV-2039), a
 *     code, a phone number, an email address, and text somebody typed, which
 *     is shown as they typed it.
 */
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";

import { DEMO_ROWS } from "../data/demo.ts";
import { setAmbient } from "./ambient.ts";
import { createT, I18nProvider, setHostLocale, useI18n } from "./index.tsx";
import { LOCALE_TAGS } from "./locales.ts";
import { MESSAGES } from "./messages/index.ts";
import { fakeStudio, type FakeStudio } from "../testing/fakeStudio.ts";
import { loadClient, loadDeliverable, loadInvoice, loadProject, loadProposal, loadSystemActions, loadTermsVersion, useDesk } from "../state/desk.ts";
import { loadClientDeliverable, loadClientInvoice, loadClientProject, loadClientProposal, loadPortal, loadStudio, setPortalPort, usePortal } from "../state/portal.ts";
import { useSheets } from "../state/sheets.ts";
import { openPrint, useUi } from "../state/ui.ts";
import { loadTime } from "../state/timeActions.ts";
import { loadPurchases, loadStudioDates, loadSuppliers } from "../state/officeActions.ts";
import { loadMoney } from "../screens/money/load.ts";
import { loadArchive } from "../screens/archive/load.ts";
import { loadSampleRows } from "../screens/emails/samples.ts";
import { useScheduleView } from "../screens/schedule/state.ts";
import { useWorksheet } from "../screens/scoping/store.ts";
import type { Worksheet } from "../state/scoping.ts";

import DeskFrame from "../components/DeskFrame.tsx";
import ClientFrame from "../components/ClientFrame.tsx";
import Home from "../screens/Home.tsx";
import Enquiries from "../screens/Enquiries.tsx";
import Proposals from "../screens/Proposals.tsx";
import Proposal from "../screens/Proposal.tsx";
import Projects from "../screens/Projects.tsx";
import Project from "../screens/Project.tsx";
import Review from "../screens/Review.tsx";
import Handover from "../screens/Handover.tsx";
import Clients from "../screens/Clients.tsx";
import ClientRecord from "../screens/Client.tsx";
import Invoices from "../screens/Invoices.tsx";
import Invoice from "../screens/Invoice.tsx";
import Chasing from "../screens/Chasing.tsx";
import Terms, { AgreementPanel, VersionPanel } from "../screens/Terms.tsx";
import { versionsInOrder } from "../screens/terms/model.ts";
import Settings from "../screens/Settings.tsx";
import Time from "../screens/Time.tsx";
import Expenses from "../screens/Expenses.tsx";
import Suppliers from "../screens/Suppliers.tsx";
import { ScopingPage } from "../screens/Scoping.tsx";
import Schedule from "../screens/Schedule.tsx";
import Capacity from "../screens/Capacity.tsx";
import Money from "../screens/Money.tsx";
import Archive from "../screens/Archive.tsx";
import Emails from "../screens/Emails.tsx";
import Print from "../screens/Print.tsx";
import ClientHome from "../screens/client/Home.tsx";
import ClientProposal from "../screens/client/Proposal.tsx";
import ClientProject from "../screens/client/Project.tsx";
import ClientReview from "../screens/client/Review.tsx";
import ClientInvoice from "../screens/client/Invoice.tsx";
import ClientStatement from "../screens/client/Statement.tsx";
import ClientBrief from "../screens/client/Brief.tsx";
import ClientFind from "../screens/client/Find.tsx";
import ClientEnquire from "../screens/client/Enquire.tsx";
import Add from "../sheets/Add.tsx";
import Send from "../sheets/Send.tsx";
import StartProject from "../sheets/StartProject.tsx";
import NextStage from "../sheets/NextStage.tsx";
import Milestones from "../sheets/Milestones.tsx";
import Version from "../sheets/Version.tsx";
import MarkApproved from "../sheets/MarkApproved.tsx";
import RecordPayment from "../sheets/RecordPayment.tsx";
import VoidPayment from "../sheets/VoidPayment.tsx";
import VoidInvoice from "../sheets/VoidInvoice.tsx";
import Extend from "../sheets/Extend.tsx";
import MoveOntoInvoice from "../sheets/time/MoveOntoInvoice.tsx";
import { PurchaseSheet } from "../sheets/expenses/PurchaseSheet.tsx";
import AddDate from "../sheets/schedule/AddDate.tsx";
import RunningCostSheet from "../sheets/money/RunningCost.tsx";
import ClientTerms from "../sheets/client/Terms.tsx";
import ClientReceipt from "../sheets/client/Receipt.tsx";
import { DEMO_MESSAGES } from "../demo/strings.ts";
import { emailWords } from "../manifest/emails.ts";

/* ── t() and its numeric parameters ─────────────────────────────────────── */

/** `t()` as it was before numbers were formatted: every parameter through `String()`. */
function legacyT(key: string, params?: Record<string, string | number>, count?: number): string {
  const english = MESSAGES["en-US"];
  let raw = english[key] ?? key;
  if (count !== undefined && raw.includes("|")) {
    const variants = raw.split("|");
    const idx = ["one", "other"].indexOf(new Intl.PluralRules("en-US").select(count));
    raw = variants[idx === -1 ? variants.length - 1 : Math.min(idx, variants.length - 1)]!;
  }
  const all = count === undefined ? params : { count, ...params };
  if (!all) return raw;
  return raw.replace(/\{(\w+)\}/g, (m: string, name: string) => (name in all ? String(all[name]) : m));
}

/** Numbers of every shape a sentence carries: counts, a year, an id, money-ish decimals, a share, a negative. */
const SAMPLES = [0, 1, 2, 3, 5, 7, 11, 12, 21, 47, 100, 1000, 2026, 12345, 1234567, 0.5, 1.5, 9.5, 8.875, 0.25, 33.333333333333336, 1 / 3, -3, -0, -12.5];

describe("t() says a number in the page's digits", () => {
  it("changes nothing in English: every message, every sample number, every placeholder", () => {
    const t = createT("en-US", MESSAGES);
    const english = MESSAGES["en-US"];
    let checked = 0;
    const differ: string[] = [];
    for (const [key, text] of Object.entries(english)) {
      const names = [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!))];
      for (const n of SAMPLES) {
        const params = Object.fromEntries(names.map((name, i) => [name, i % 2 === 0 ? n : n * 7 + 1]));
        for (const count of [undefined, n]) {
          const got = t(key as never, params, count);
          const want = legacyT(key, params, count);
          checked += 1;
          if (got !== want) differ.push(`${key} ${JSON.stringify(params)} ${String(count)}: ${got} ≠ ${want}`);
        }
      }
    }
    expect(checked).toBeGreaterThan(Object.keys(english).length * SAMPLES.length);
    expect(differ.slice(0, 5)).toEqual([]);
  });

  it("fills a count, a year and a decimal in Arabic-Indic digits in Arabic, ungrouped, and leaves a string as it is", () => {
    const t = createT("ar-EG", MESSAGES);
    expect(t("home.overdueSub", {}, 47)).toContain("٤٧");
    expect(t("frame.copyright", { year: 2026, studio: "Outline 5" })).toBe("© ٢٠٢٦ Outline 5");
    expect(t("time.hours", { h: 9.5 })).toContain("٩٫٥");
    expect(t("home.overdueSub", {}, 12345)).toContain("١٢٣٤٥");
  });

  it("says each locale's own digits for a number, and the same digits for every locale that writes Latin ones", () => {
    const said = Object.fromEntries(LOCALE_TAGS.map((tag) => [tag, createT(tag, MESSAGES)("frame.copyright", { year: 2026, studio: "" }).trim()]));
    expect(said["ar-EG"]).toBe("© ٢٠٢٦");
    for (const tag of LOCALE_TAGS.filter((x) => x !== "ar-EG")) expect(said[tag]).toBe("© 2026");
  });
});

/* ── the screens, drawn in Arabic ───────────────────────────────────────── */

/** Stores drawn on the server side of React read their initial state: make it the current one (test-only). */
function current(): void {
  for (const store of [useDesk, usePortal, useUi, useSheets, useScheduleView, useWorksheet] as unknown as { getState: () => object; getInitialState: () => object }[]) {
    Object.assign(store.getInitialState(), store.getState());
  }
}

/** What `<App>` does on every render: the formatters outside React speak the page's language. */
function Ambient({ children }: { children: ReactNode }) {
  const { locale, t, money, number } = useI18n();
  setAmbient(locale, t, money, number);
  return <>{children}</>;
}

function draw(node: ReactNode): string {
  current();
  return renderToStaticMarkup(
    <I18nProvider>
      <Ambient>{node}</Ambient>
    </I18nProvider>,
  );
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#x27;": "'", "&#39;": "'", "&nbsp;": " " };
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

/**
 * The text a person reads on the page, node by node — but for what is inside
 * a <textarea> (what somebody typed), a <script> or a <style>, or inside an
 * element in ANOTHER language (`lang` not Arabic): an email previewed in the
 * language the client reads it in says its numbers the way it is sent.
 * Attribute values are not read: an input's value is what was typed, and a
 * placeholder shows what to type in the digits the field reads.
 */
function textNodes(html: string): string[] {
  const out: string[] = [];
  const stack: { tag: string; skip: boolean }[] = [];
  const skipping = () => stack.length > 0 && stack[stack.length - 1]!.skip;
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>|([^<]+)/g)) {
    if (m[5] !== undefined) {
      if (skipping()) continue;
      const text = m[5].replace(/&[#\w]+;/g, (e) => ENTITIES[e] ?? e).trim();
      if (text !== "") out.push(text);
      continue;
    }
    const tag = m[2]!.toLowerCase();
    if (m[1] === "/") {
      const at = stack.map((e) => e.tag).lastIndexOf(tag);
      if (at !== -1) stack.length = at;
      continue;
    }
    if (VOID.has(tag) || m[4] === "/") continue;
    const lang = /\slang="([^"]*)"/.exec(m[3] ?? "")?.[1];
    const skip = skipping() || tag === "textarea" || tag === "script" || tag === "style" || (lang !== undefined && !lang.startsWith("ar"));
    stack.push({ tag, skip });
  }
  return out;
}

/** Every string stored in the sample's rows that holds a digit — text somebody typed, shown as they typed it. */
const TYPED: string[] = (() => {
  const out = new Set<string>();
  for (const rows of Object.values(DEMO_ROWS as unknown as Record<string, Record<string, unknown>[]>)) {
    for (const row of rows) {
      for (const value of Object.values(row)) {
        if (typeof value === "string" && /\d/.test(value) && !/^[\d.:TZ+-]+$/.test(value)) out.add(value);
      }
    }
  }
  return [...out].sort((a, b) => b.length - a.length);
})();

/**
 * What is data rather than a number said in words, and so keeps its digits
 * in every language: a document's or a payment's number, an email address,
 * a web address or a file's name, a phone number, a sign-in code.
 */
const DATA: RegExp[] = [
  /\b[A-Z]{2,}(?:-[A-Z]*\d+)+\b/g, // INV-2039, INV-S2039, PRO-1142, REC-0016
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, // an email address
  /\bhttps?:\/\/\S+/g, // a web address
  /\b[\w-]+(?:\.[\w-]+)+(?::\d+)?\/\S*/g, // a web address without its scheme
  /[\w.-]+\.(?:pdf|png|jpe?g|gif|webp|svg|zip|ai|psd|indd|otf|ttf|woff2?|mp4|mov|fig)\b/gi, // a file's name
  /\+?\d[\d ()-]{6,}\d/g, // a phone number
  /\b\d{3} \d{3}\b/g, // a six-digit sign-in code, shown in two halves
  /\bA4\b/g, // the paper size's name
];

/** The Latin digits left in one text once the data and the typed text are taken out. */
function latin(text: string): string | null {
  let left = text;
  for (const typed of TYPED) if (left.includes(typed)) left = left.split(typed).join(" ");
  for (const re of DATA) left = left.replace(re, " ");
  return /[0-9]/.test(left) ? text : null;
}

function hits(html: string): string[] {
  return [...new Set(textNodes(html).flatMap((t) => latin(t) ?? []))];
}

let studio: FakeStudio;

/** A client signed in to their portal. */
async function signIn(clientId: number): Promise<void> {
  setPortalPort(studio.world.portal(clientId));
  useUi.setState({ persona: "client", view: "home", preview: null, toasts: [] });
  await Promise.all([loadStudio(true), loadPortal()]);
}

const select = (key: "proposal" | "invoice" | "project" | "deliverable" | "client", id: number) => useUi.setState((s) => ({ selected: { ...s.selected, [key]: id } }));
const close = () => undefined;
const termsVersions = () => versionsInOrder(Object.values(useDesk.getState().rows.terms_versions));

const WORKED: Worksheet = {
  clientId: 4,
  stage: "Studio sale poster, second run",
  rows: [
    { rateId: 1, qty: "2" },
    { rateId: 3, qty: "4" },
  ],
  expenses: [
    { what: "Poster proofs", amount: "60", passOn: true },
    { what: "Reference books", amount: "38", passOn: false },
  ],
  contingency: true,
  split: "403030",
};

type Screen = [name: string, prepare: () => Promise<void> | void, node: () => ReactNode];

const DESK: Screen[] = [
  ["home, in the studio's frame", () => undefined, () => <DeskFrame><Home /></DeskFrame>],
  ["enquiries", () => useUi.setState({ view: "enquiries" }), () => <Enquiries />],
  ["proposals", () => useUi.setState({ view: "proposals" }), () => <Proposals />],
  ["a proposal", async () => { await loadProposal(3); select("proposal", 3); useUi.setState({ view: "proposal" }); }, () => <Proposal />],
  ["a signed proposal", async () => { await loadProposal(2); select("proposal", 2); useUi.setState({ view: "proposal" }); }, () => <Proposal />],
  ["projects", () => useUi.setState({ view: "projects" }), () => <Projects />],
  ["a project", async () => { await loadProject(1); select("project", 1); useUi.setState({ view: "project" }); }, () => <Project />],
  ["a project in stages", async () => { await loadProject(2); select("project", 2); useUi.setState({ view: "project" }); }, () => <Project />],
  ["a review", async () => { await loadDeliverable(3); select("deliverable", 3); useUi.setState({ view: "review" }); }, () => <Review />],
  ["a handover", async () => { await loadProject(4); select("project", 4); useUi.setState({ view: "handover" }); }, () => <Handover />],
  ["clients", () => useUi.setState({ view: "clients" }), () => <Clients />],
  ["a client", async () => { await loadClient(1); select("client", 1); useUi.setState({ view: "client" }); }, () => <ClientRecord />],
  ["invoices", () => useUi.setState({ view: "invoices" }), () => <Invoices />],
  ["an invoice, part paid", async () => { await loadInvoice(5); select("invoice", 5); useUi.setState({ view: "invoice" }); }, () => <Invoice />],
  ["an invoice, overdue", async () => { await loadInvoice(3); select("invoice", 3); useUi.setState({ view: "invoice" }); }, () => <Invoice />],
  ["chasing", () => useUi.setState({ view: "chasing" }), () => <Chasing />],
  ["terms", async () => { await loadTermsVersion(3); useUi.setState({ view: "terms" }); }, () => <Terms />],
  ["terms, a version and its clauses", async () => { await loadTermsVersion(3); useUi.setState({ view: "terms" }); }, () => <VersionPanel version={termsVersions().find((v) => v.id === 3)!} versions={termsVersions()} count={3} manager={true} onBack={close} />],
  ["terms, a proposal's agreement", async () => { await loadTermsVersion(3); useUi.setState({ view: "terms" }); }, () => <AgreementPanel proposal={useDesk.getState().rows.proposals[2]!} versions={termsVersions()} />],
  ["settings", async () => { await loadSystemActions().catch(() => undefined); useUi.setState({ view: "settings" }); }, () => <Settings />],
  ["time", async () => { await loadTime("2000-01-01"); useUi.setState({ view: "time" }); }, () => <Time />],
  ["expenses", async () => { await loadPurchases(null); await loadSuppliers(); useUi.setState({ view: "expenses" }); }, () => <Expenses />],
  ["suppliers", async () => { await loadPurchases(null); await loadSuppliers(); useUi.setState({ view: "suppliers" }); }, () => <Suppliers />],
  ["scoping, a worked sheet", () => { useUi.setState({ view: "scoping" }); useWorksheet.setState({ sheet: WORKED }); }, () => <ScopingPage reading={{ state: "ready", past: [1, 6] }} onRetry={close} />],
  ["schedule", async () => { await loadStudioDates("2026-07-01", "2026-12-31"); useUi.setState({ view: "schedule" }); }, () => <Schedule />],
  ["capacity", async () => { await loadStudioDates("2026-07-01", "2026-12-31"); useUi.setState({ view: "capacity" }); }, () => <Capacity />],
  ["money", async () => { await loadMoney("2026-07-28"); useUi.setState({ view: "money" }); }, () => <Money />],
  ["the archive", async () => { await loadArchive(); useUi.setState({ view: "archive" }); }, () => <Archive />],
  ["every email we send", async () => { await loadSampleRows(); useUi.setState({ view: "emails" }); }, () => <Emails />],
  ["a printed invoice", async () => { await loadInvoice(5); openPrint({ kind: "invoice", id: 5 }); }, () => <Print />],
  ["a printed receipt", async () => { await loadInvoice(5); openPrint({ kind: "receipt", id: 2 }); }, () => <Print />],
];

const SHEETS: Screen[] = [
  ["send an invoice", () => undefined, () => <Send sheet={{ kind: "send", table: "invoices", id: 7 }} onClose={close} />],
  ["send a proposal", async () => { await loadProposal(4); }, () => <Send sheet={{ kind: "send", table: "proposals", id: 4 }} onClose={close} />],
  ["start a project", async () => { await loadProposal(3); }, () => <StartProject sheet={{ kind: "startProject", proposalId: 3 }} onClose={close} />],
  ["the next stage", async () => { await loadProject(1); }, () => <NextStage sheet={{ kind: "nextStage", projectId: 1 }} onClose={close} />],
  ["milestones", async () => { await loadProject(2); }, () => <Milestones sheet={{ kind: "milestones", projectId: 2 }} onClose={close} />],
  ["a new version", async () => { await loadDeliverable(3); }, () => <Version sheet={{ kind: "version", deliverableId: 3 }} onClose={close} />],
  ["mark approved", async () => { await loadDeliverable(3); }, () => <MarkApproved sheet={{ kind: "markApproved", deliverableId: 3 }} onClose={close} />],
  ["record a payment", async () => { await loadInvoice(3); }, () => <RecordPayment sheet={{ kind: "recordPayment", invoiceId: 3 }} onClose={close} />],
  ["void a payment", async () => { await loadInvoice(5); }, () => <VoidPayment sheet={{ kind: "voidPayment", paymentId: 2 }} onClose={close} />],
  ["void an invoice", async () => { await loadInvoice(4); }, () => <VoidInvoice sheet={{ kind: "voidInvoice", invoiceId: 4 }} onClose={close} />],
  ["extend a proposal", async () => { await loadProposal(3); }, () => <Extend sheet={{ kind: "extend", proposalId: 3 }} onClose={close} />],
  ["an enquiry, added", () => undefined, () => <Add sheet={{ kind: "add", what: "enquiry" }} onClose={close} />],
  ["an invoice, added", () => undefined, () => <Add sheet={{ kind: "add", what: "invoice" }} onClose={close} />],
  ["a rate, added", () => undefined, () => <Add sheet={{ kind: "add", what: "rate" }} onClose={close} />],
  ["time onto an invoice", async () => { await loadTime("2000-01-01"); }, () => <MoveOntoInvoice entries={Object.values(useDesk.getState().rows.time_entries)} invoiced={new Set()} rate="130.00" companyOf={() => "Hearth & Loaf"} onClose={close} />],
  ["a purchase", async () => { await loadPurchases(null); await loadSuppliers(); }, () => <PurchaseSheet expense={Object.values(useDesk.getState().rows.expenses)[0]!} onClose={close} />],
  ["a studio date", () => undefined, () => <AddDate prefill={{ date: "2026-08-03", kind: "away" }} onClose={close} onSaved={close} />],
  ["a running cost", async () => { await loadMoney("2026-07-28"); }, () => <RunningCostSheet cost={Object.values(useDesk.getState().rows.running_costs)[0] ?? null} nextPosition={2} currency="USD" onClose={close} />],
];

const CLIENT: Screen[] = [
  ["home, in the clients' frame", () => select("client", 1), () => <ClientFrame><ClientHome /></ClientFrame>],
  ["a proposal", async () => { select("proposal", 3); await loadClientProposal(3); }, () => <ClientProposal />],
  ["a project", async () => { select("project", 2); await loadClientProject(2); }, () => <ClientProject />],
  ["a review", async () => { select("deliverable", 3); await loadClientDeliverable(3); }, () => <ClientReview />],
  ["an invoice", async () => { select("invoice", 4); await loadClientInvoice(4); }, () => <ClientInvoice />],
  ["an invoice, part paid and late (another client)", async () => { await signIn(3); select("invoice", 5); await loadClientInvoice(5); }, () => <ClientInvoice />],
  ["the statement", () => undefined, () => <ClientStatement />],
  ["the brief", () => undefined, () => <ClientBrief />],
  ["the terms", async () => { await loadClientProposal(3); }, () => <ClientTerms sheet={{ kind: "terms", versionId: 3 }} onClose={close} />],
  ["a receipt", async () => { await signIn(2); }, () => <ClientReceipt sheet={{ kind: "receipt", paymentId: 1 }} onClose={close} />],
  ["finding the portal", () => undefined, () => <ClientFind />],
  ["the enquiry form", () => undefined, () => <ClientEnquire />],
];

describe("an Arabic page carries no Latin digit but in its data", () => {
  beforeAll(() => setHostLocale("ar-EG"));

  it("draws in Arabic at all (the control: a page in English would pass by silence)", async () => {
    await fakeStudio();
    const html = draw(<DeskFrame><Home /></DeskFrame>);
    expect(html).toMatch(/[٠-٩]/);
    expect(html).toMatch(/[\u0600-\u06FF]{3}/);
    // …and the scan sees a Latin digit where there is one.
    expect(hits("<p>بعد 47 يومًا</p><p>INV-2039</p>")).toEqual(["بعد 47 يومًا"]);
  });

  it.each(DESK)("the desk: %s", async (_name, prepare, node) => {
    await fakeStudio();
    await prepare();
    const html = draw(node());
    expect(textNodes(html).length).toBeGreaterThan(5);
    expect(hits(html)).toEqual([]);
  });

  it.each(SHEETS)("the desk's sheet: %s", async (_name, prepare, node) => {
    await fakeStudio();
    await prepare();
    const html = draw(node());
    expect(textNodes(html).length).toBeGreaterThan(2);
    expect(hits(html)).toEqual([]);
  });

  it.each(CLIENT)("the clients' side: %s", async (_name, prepare, node) => {
    studio = await fakeStudio();
    await signIn(1);
    await prepare();
    const html = draw(node());
    expect(textNodes(html).length).toBeGreaterThan(2);
    expect(hits(html)).toEqual([]);
  });
});

/**
 * The Arabic strings themselves: a number written into a sentence is written
 * in Arabic-Indic digits. What keeps Latin digits is named here, with why —
 * each an example of what to type into a field that reads Latin digits, or a
 * name that is spelt with them.
 */
const LATIN_IN_ARABIC: Readonly<Record<string, string>> = {
  "notFound.code": "an error's code, the same on every page on the web",
  "invoices.print.paper.a4": "the paper size's name, as printers call it",
  "sheets.add.invoice.ratePh": "an example of what to type into an amount field",
  "sheets.add.rate.amountPh": "an example of what to type into an amount field",
  "sheets.add.rate.hoursPh": "an example of what to type into an hours field",
  "expenses.form.costPh": "an example of what to type into an amount field",
  "suppliers.form.phonePh": "an example phone number, which is data",
  "sheets.add.clientEdit.taxRateHint": "the exact thing to type into the rate field",
  "time.error.hoursNumber": "an example of what to type into the hours field",
  "money.sheet.amountNotANumber": "examples of what to type into the amount field",
};

describe("the Arabic strings write their numbers in Arabic-Indic digits", () => {
  it("but for what is typed or named", () => {
    const arabic = MESSAGES["ar-EG"];
    const latinKeys = Object.entries(arabic)
      .filter(([, text]) => /[0-9]/.test(text.replace(/\{\w+\}/g, "")))
      .map(([key]) => key);
    expect(latinKeys.filter((key) => !(key in LATIN_IN_ARABIC))).toEqual([]);
    // Every exception still is one, so the list cannot outlive what it excuses.
    expect(Object.keys(LATIN_IN_ARABIC).filter((key) => !latinKeys.includes(key))).toEqual([]);
  });

  it("and so do the emails the studio sends in Arabic", () => {
    const flat = (v: unknown): string[] => (typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(flat) : Object.values(v as object).flatMap(flat));
    const words = flat(emailWords()["ar-EG"]);
    expect(words.length).toBeGreaterThan(50);
    expect(words.filter((text) => /[0-9]/.test(text.replace(/\{\{[^}]*\}\}/g, "")))).toEqual([]);
  });

  it("and so does the demo card", () => {
    const arabic = DEMO_MESSAGES["ar-EG"] as Record<string, string>;
    const latin = Object.entries(arabic).filter(([key, text]) => key !== "demo.screen.notfound" && /[0-9]/.test(text.replace(/\{\w+\}/g, "")));
    expect(latin).toEqual([]);
  });
});
