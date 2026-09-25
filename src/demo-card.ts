/**
 * What the website's demo card offers for this app — written into `demo.json`
 * beside the demo build (`demo-emit.ts`, wired in `vite.config.ts`).
 *
 * Two sides, the studio's desk and the clients' pages, each with the screens
 * that ship; the card shows only the current side's. Some screens carry
 * shortcuts that act on them ("The client accepts and signs", "Part
 * payment"). The clock row moves the demo's pinned Tuesday on a week at a
 * time and puts it back, with the sample as it was.
 *
 * Labels are message keys (`demo/strings.ts`), written out in all eight
 * languages. Icons are lucide names. Screen ids are the card's; `view` is the
 * app's own view (`app/routes.ts`).
 */
import type { DemoFrame } from "./demo-types.ts";

export const DEMO_APP_KEY = "clients";
export const DEMO_DIR = "client-portal";

export interface DemoCardShortcut {
  id: string;
  icon: string;
  labelKey: string;
}

export interface DemoCardScreen {
  id: string;
  view: string;
  icon: string;
  labelKey: string;
  side: "staff" | "customer";
  persona: "studio" | "client";
  shortcuts?: DemoCardShortcut[];
}

export const DEMO_FRAMES: DemoFrame[] = ["desktop", "phone"];

export const DEMO_PERSONAS = [
  { id: "studio", icon: "pen-tool", labelKey: "demo.persona.studio" },
  { id: "client", icon: "user-round", labelKey: "demo.persona.client" },
];

const studio = (id: string, icon: string, shortcuts?: DemoCardShortcut[], view = id): DemoCardScreen => ({
  id,
  view,
  icon,
  labelKey: `demo.screen.${id === "archive" ? "notfound" : id}`,
  side: "staff",
  persona: "studio",
  ...(shortcuts === undefined ? {} : { shortcuts }),
});
const client = (id: string, view: string, icon: string, shortcuts?: DemoCardShortcut[]): DemoCardScreen => ({
  id,
  view,
  icon,
  labelKey: id === "c404" ? "demo.screen.notfound" : `demo.screen.${id}`,
  side: "customer",
  persona: "client",
  ...(shortcuts === undefined ? {} : { shortcuts }),
});
const shortcut = (id: string, icon: string, key: string): DemoCardShortcut => ({ id, icon, labelKey: `demo.do.${key}` });

export const DEMO_SCREENS: DemoCardScreen[] = [
  studio("home", "house"),
  studio("enquiries", "inbox", [shortcut("call-comes-in", "phone-incoming", "callComesIn")]),
  studio("proposals", "file-text", [shortcut("accepts-and-signs", "pen-line", "acceptsAndSigns")]),
  studio("composer", "square-pen", [shortcut("sample-proposal", "wand-sparkles", "sampleProposal")]),
  studio("terms", "file-signature"),
  studio("projects", "folder-kanban"),
  studio("project", "folder-open", [shortcut("asks-for-changes", "message-square", "asksForChanges"), shortcut("approves", "check", "approves")]),
  studio("review", "message-square-dashed"),
  studio("handover", "package-check"),
  studio("clients", "users-round"),
  studio("client", "id-card"),
  studio("invoices", "receipt-text"),
  studio("invoice", "file-digit", [shortcut("part-payment", "receipt", "partPayment"), shortcut("says-paid", "hand-coins", "saysPaid")]),
  studio("chasing", "bell-ring"),
  studio("print", "printer"),
  studio("settings", "settings"),
  studio("archive", "triangle-alert", undefined, "notfound"),

  client("entry", "find", "key-round", [
    shortcut("amara", "wand-sparkles", "amara"),
    shortcut("unknown-address", "mail-x", "unknownAddress"),
    shortcut("open-link", "mail-open", "openLink"),
    shortcut("expire-link", "unplug", "expireLink"),
  ]),
  client("chome", "home", "house"),
  client("cproposal", "proposal", "file-text", [shortcut("out-of-date", "calendar-x", "outOfDate")]),
  client("cproject", "project", "folder-open", [shortcut("paused-work", "pause", "pausedWork")]),
  client("cinvoice", "invoice", "receipt-text", [shortcut("already-paid", "check-check", "alreadyPaid")]),
  client("cstatement", "statement", "scroll-text"),
  client("cbrief", "brief", "clipboard-list"),
  client("cwrap", "handover", "package-check"),
  client("cna", "notavailable", "circle-slash"),
  client("c404", "notfound", "file-x"),
];

/**
 * The views a chip lights up for besides its own: a sign-in link's landing
 * and an expired link are "Sign in"; the client's review of a file is their
 * "Project"; one proposal is "Proposals".
 */
export const DEMO_LIT_BY: Readonly<Record<string, string>> = {
  "client:link": "entry",
  "client:expired": "entry",
  "client:review": "cproject",
  "studio:proposal": "proposals",
};

export const DEMO_CLOCK = {
  advance: [{ id: "1w", labelKey: "demo.clock.week" }],
  reset: { labelKey: "demo.clock.reset" },
};

/** How far the card's one clock step moves the demo on. */
export const DEMO_CLOCK_STEP_DAYS: Readonly<Record<string, number>> = { "1w": 7 };

export type DemoShortcutId = NonNullable<DemoCardScreen["shortcuts"]>[number]["id"];
