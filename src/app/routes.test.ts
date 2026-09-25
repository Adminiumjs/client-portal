/**
 * The route table, the files, the app's two records and `surface-nav.ts` are
 * one fact: every view has exactly one file that exists, `App.tsx` maps each
 * view to that file's component (and only its side's), and every view a side
 * navigates to or renders is in the table. A lane that replaces a screen's
 * file keeps all of this true by construction.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CLIENT_ROUTES, CLIENT_VIEWS, DESK_ROUTES, DESK_VIEWS, SIDEBAR, sidebarItemFor } from "./routes.ts";
import { SURFACE_EXTRAS, SURFACE_NAV } from "../surface-nav.ts";
import { MESSAGES } from "../i18n/messages/index.ts";
import { STAFF_ROUTES, CUSTOMER_ROUTES } from "../manifest/build.ts";

const ROOT = join(__dirname, "..", "..");
const APP = readFileSync(join(__dirname, "App.tsx"), "utf8");

/** `view: Component` inside one of App.tsx's records, with the file that component is imported from. */
function record(name: "DESK_SCREENS" | "CLIENT_SCREENS"): Record<string, string> {
  const body = new RegExp(`const ${name} = \\{([^}]*)\\}`).exec(APP)?.[1] ?? "";
  const imports = new Map([...APP.matchAll(/import (\w+) from "\.\.\/(screens\/[^"]+)";/g)].map((m) => [m[1]!, `src/${m[2]!}`]));
  return Object.fromEntries([...body.matchAll(/(\w+): (\w+),/g)].map((m) => [m[1]!, imports.get(m[2]!) ?? "?"]));
}

describe("the route table", () => {
  it("names a file that exists for every view of both sides", () => {
    for (const route of [...Object.values(DESK_ROUTES), ...Object.values(CLIENT_ROUTES)]) expect(existsSync(join(ROOT, route.file)), route.file).toBe(true);
    expect(Object.keys(DESK_ROUTES)).toEqual([...DESK_VIEWS]);
    expect(Object.keys(CLIENT_ROUTES)).toEqual([...CLIENT_VIEWS]);
  });

  it("puts every desk screen at src/screens/<View>.tsx and every client page under src/screens/client/", () => {
    for (const route of Object.values(DESK_ROUTES)) expect(route.file).toMatch(/^src\/screens\/[A-Z]\w+\.tsx$/);
    for (const route of Object.values(CLIENT_ROUTES)) expect(route.file).toMatch(/^src\/screens\/client\/[A-Z]\w+\.tsx$/);
  });

  it("is what App.tsx renders, view for view and file for file", () => {
    expect(record("DESK_SCREENS")).toEqual(Object.fromEntries(DESK_VIEWS.map((v) => [v, DESK_ROUTES[v].file])));
    expect(record("CLIENT_SCREENS")).toEqual(Object.fromEntries(CLIENT_VIEWS.map((v) => [v, CLIENT_ROUTES[v].file])));
  });

  it("names every screen in every language", () => {
    for (const route of [...Object.values(DESK_ROUTES), ...Object.values(CLIENT_ROUTES)]) {
      for (const bundle of Object.values(MESSAGES)) expect(bundle[route.titleKey], route.titleKey).toBeTruthy();
    }
  });
});

describe("the surfaces' navigation", () => {
  it("covers every view of each side, and names none that has no screen", () => {
    const side = (s: "staff" | "customer") => new Set([...SURFACE_NAV.filter((e) => e.side === s).map((e) => e.view as string), ...SURFACE_EXTRAS[s]]);
    expect([...side("staff")].sort()).toEqual([...DESK_VIEWS].sort());
    expect([...side("customer")].sort()).toEqual([...CLIENT_VIEWS].sort());
  });

  it("uses the manifest's own routes for each side", () => {
    const paths = (s: "staff" | "customer") => SURFACE_NAV.filter((e) => e.side === s).map((e) => `/${e.path}`).sort();
    expect(paths("staff")).toEqual(Object.values(STAFF_ROUTES).sort());
    expect(paths("customer")).toEqual(Object.values(CUSTOMER_ROUTES).sort());
  });
});

describe("the studio's sidebar", () => {
  it("shows this release's screens only, Settings for managers", () => {
    expect(SIDEBAR.map((i) => i.view)).toEqual(["home", "enquiries", "proposals", "projects", "clients", "invoices", "chasing", "settings"]);
    expect(SIDEBAR.find((i) => i.view === "settings")?.managerOnly).toBe(true);
  });

  it("lights the section a document's page belongs to", () => {
    expect(sidebarItemFor("proposal")).toBe("proposals");
    expect(sidebarItemFor("composer")).toBe("proposals");
    expect(sidebarItemFor("review")).toBe("projects");
    expect(sidebarItemFor("print")).toBe("invoices");
    expect(sidebarItemFor("terms")).toBe("settings");
    expect(sidebarItemFor("notfound")).toBeNull();
  });
});
