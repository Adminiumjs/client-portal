/**
 * `manifest.json`, assembled from the modules beside this file.
 *
 * The manifest is what Adminium installs: the tables and their rules, the
 * pages, the roles, the clients' doors, the emails, and the add-on the app is
 * built on. It is written from typed modules rather than by hand because it is
 * long and mostly the same eight languages over and over; the modules say
 * each thing once. The file itself is still the product's input, checked in,
 * and `manifest-drift.test.ts` fails when it and the modules disagree
 * (`npm run manifest` re-writes it).
 */
import { ADD_ONS } from "./add-ons.ts";
import { DOCUMENTS } from "./documents.ts";
import { emailTemplates } from "./emails.ts";
import { untranslated } from "./labels.ts";
import { KINDS, OUTBOX } from "./outbox.ts";
import { NAV_GROUPS, pages } from "./pages.ts";
import { PUBLIC_ACCESS, PUBLIC_KEYS } from "./public.ts";
import { ROLES } from "./roles.ts";
import { TABLES } from "./tables.ts";

/** This release. The version moves 0.1.3 → 0.2.0 once: its tables are new. */
export const VERSION = "0.2.0";

/**
 * The Adminium release that first reads everything below: formulas, numbers
 * without gaps, states, sign-in links, held emails, and apps built on an
 * add-on's shape. Written from the version actually released, never guessed.
 */
export const MIN_ADMINIUM = "0.3.3";

const ENV = {
  VITE_ADMINIUM_API_BASE_URL: { required: false, example: "https://admin.example.com" },
  VITE_ADMINIUM_PUBLISHABLE_KEY: { required: false, example: "adm_pub_..." },
};

/** The desk's screens, as the address bar names them. */
export const STAFF_ROUTES = {
  home: "/",
  schedule: "/schedule",
  capacity: "/capacity",
  enquiries: "/enquiries",
  proposals: "/proposals",
  projects: "/projects",
  clients: "/clients",
  invoices: "/invoices",
  chasing: "/chasing",
  expenses: "/expenses",
  suppliers: "/suppliers",
  time: "/time",
  terms: "/terms",
  settings: "/settings",
};

/**
 * The desk's back-office screens, as the address bar will name them. Not in
 * `frontends[].routes` yet: a route there is a row in Adminium's sidebar, and
 * none shows before its screen is built. The screens move them into
 * `STAFF_ROUTES` (and `surface-nav.ts`) as they ship.
 */
export const LATER_STAFF_ROUTES = {
  scoping: "/scoping",
  money: "/money",
  archive: "/archive",
  emails: "/emails",
};

/** The clients' side. A sign-in link lands on `/c` and a shared handover on `/h`; their tokens ride the fragment. */
export const CUSTOMER_ROUTES = {
  find: "/",
  link: "/c",
  home: "/home",
  proposals: "/proposals",
  projects: "/projects",
  invoices: "/invoices",
  statement: "/statement",
  brief: "/brief",
  handover: "/h",
};

/** `laterPages`: also the pages declared for later — only the test that proves they install asks. */
export function buildManifest(opts: { laterPages?: boolean } = {}): Record<string, unknown> {
  return {
    kind: "app",
    manifestVersion: 1,
    key: "clients",
    name: "Client Portal",
    version: VERSION,
    publisher: { id: "adminium", name: "Adminium", url: "https://adminium.dev" },
    license: "AGPL-3.0-only",
    description: {
      key: "mft.clients.desc",
      fallback:
        "A studio's desk and a portal for its clients: proposals they accept and sign, projects they review, invoices and receipts they see — backed by your own database.",
    },
    categories: ["operations", "crm"],
    compatibility: {
      minAdminiumVersion: MIN_ADMINIUM,
      engines: ["sqlite", "postgres", "mysql"],
      requires: ["email-delivery", "file-storage"],
      // 0.1.x kept its tables unprefixed and in another shape: it cannot be
      // updated in place (uninstall it first — its tables are kept).
      updatesFrom: ">=0.2.0",
    },
    capabilities: ["email-delivery", "file-storage", "realtime"],
    frontends: [
      { side: "staff", kind: "spa", entry: "index.html", env: ENV, placement: "external", routes: STAFF_ROUTES },
      { side: "customer", kind: "spa", entry: "index.html", env: ENV, routes: CUSTOMER_ROUTES },
    ],
    addOns: ADD_ONS,
    documents: DOCUMENTS,
    navGroups: NAV_GROUPS,
    requiredSchema: { prefixed: true, tables: TABLES },
    pages: pages(opts.laterPages === true),
    roles: ROLES,
    publicKeys: PUBLIC_KEYS,
    publicAccess: PUBLIC_ACCESS,
    outbox: OUTBOX,
    emailTemplates: emailTemplates(KINDS),
    sampleData: { file: "seeds/clients.sample.json" },
  };
}

/** The manifest as it is written to disk: two-space JSON and a final newline. */
export function manifestText(): string {
  const text = `${JSON.stringify(buildManifest(), null, 2)}\n`;
  const missing = untranslated();
  if (missing.length > 0) {
    throw new Error(
      `these labels have no translation in words.ts, so the manifest would show English in seven languages:\n  ${missing.join("\n  ")}`,
    );
  }
  return text;
}
