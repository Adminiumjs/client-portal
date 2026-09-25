/**
 * The Projects board and one project, drawn from the sample studio's rows:
 * the groups and their counts, each card's ring and next step; the project's
 * hero, milestones (tick buttons on open ones, un-tick on done ones), the
 * deliverables (pill, the date line, Share only on an unshared one, the
 * client's note on changes asked), the brief, and the ways on — a void
 * invoice never reads "paid". And the two sheets this area draws.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../../i18n/index.tsx";
import { fakeStudio } from "../../testing/fakeStudio.ts";
import { loadProject, upsert, useDesk } from "../../state/desk.ts";
import { useSheets } from "../../state/sheets.ts";
import { usePortal } from "../../state/portal.ts";
import { useUi } from "../../state/ui.ts";
import Projects from "../Projects.tsx";
import Project from "../Project.tsx";
import Milestones from "../../sheets/Milestones.tsx";
import Deliverable from "../../sheets/Deliverable.tsx";

/** A store hook drawn on the server reads the store's initial state: make it say what the store holds now (tests only). */
function current(): void {
  for (const store of [useDesk, usePortal, useUi, useSheets] as unknown as { getState: () => object; getInitialState: () => object }[]) {
    Object.assign(store.getInitialState(), store.getState());
  }
}
const draw = (node: React.ReactNode) => {
  current();
  return renderToStaticMarkup(<I18nProvider>{node}</I18nProvider>);
};
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ");

beforeEach(async () => {
  await fakeStudio();
  useUi.setState({ view: "projects", theme: "light" });
});

describe("the Projects board", () => {
  it("draws the three groups with their counts, and a card per project", () => {
    const html = draw(<Projects />);
    const words = text(html);
    expect(words).toContain("2 active · 1 paused · 0 delivered");
    expect(words).toMatch(/Active 2 .*Paused 1 .*Done 0 /);
    expect(words).toContain("Nothing delivered yet.");
    expect(html).toContain('data-project="1"');
    expect(words).toContain("Fold & Rule Stationers Packaging system");
    expect(words).toContain("PRJ-01 1 of 3 milestones");
    expect(words).toContain("Next: Artwork · Jul 31");
    expect(html).toContain('aria-label="50% done"');
  });

  it("lists a finished project under Done once it is read", async () => {
    await loadProject(4);
    const words = text(draw(<Projects />));
    expect(words).toMatch(/Done 1 .*Kiln Street Ceramics Studio identity/);
    expect(words).toContain("Delivered May 29");
  });
});

describe("one project", () => {
  beforeEach(async () => {
    await loadProject(1);
    useUi.setState((s) => ({ view: "project", selected: { ...s.selected, project: 1 } }));
  });

  it("draws the number, state, Status menu, name, where it stands and the ring", () => {
    const html = draw(<Project />);
    const words = text(html);
    expect(html).toContain('<h1 class="prj-title" id="project-title">Packaging system</h1>');
    expect(words).toContain("PRJ-01 Active Status");
    expect(html).toContain('aria-haspopup="menu"');
    expect(words).toContain("Fold & Rule Stationers · started June 10, 2026 · 1 of 3 milestones · next Jul 31");
  });

  it("ticks open milestones, offers to un-tick a done one, and opens the editor from a title", () => {
    const html = draw(<Project />);
    expect(html).toContain('aria-label="Mark “Artwork” done"');
    expect(html).toContain('aria-label="Mark “Structure and dielines” not done"');
    expect(html).toContain('aria-label="Edit “Print and hand over”"');
    expect(text(html)).toContain("Artwork In progress · due in 3 days");
  });

  it("draws each deliverable with its pill and date; Share only on one not shared", async () => {
    await loadProject(2);
    useUi.setState((s) => ({ selected: { ...s.selected, project: 2 } }));
    const html = draw(<Project />);
    const words = text(html);
    expect(words).toContain("Changes requested Window sketch A Changes asked Jul 23 Could the loaf be bigger?");
    expect(words).toContain("Not shared Window sketch B Not shared yet");
    expect(html.match(/prj-dv-share-btn/g)).toHaveLength(1);
    expect(words).toContain("Not back yet");
    expect(words).toContain("6 questions are waiting on their side of the portal.");
    expect(words).toContain("See what we asked them");
  });

  it("shows the brief's answers when it is in, and the ways on — a void invoice says void, never paid", () => {
    const s = useDesk.getState();
    upsert("invoices", { ...s.rows.invoices[2]!, status: "void", balance: "0.00" });
    const words = text(draw(<Project />));
    expect(words).toContain("Their brief In WHO IS THIS FOR? People who still write by hand.".replace("WHO IS THIS FOR?", "Who is this for?"));
    expect(words).toContain("Preview as the client");
    expect(words).toContain("Handover page");
    expect(words).toContain("Invoice the next stage");
    expect(words).toContain("INV-2036 · void");
    expect(words).not.toContain("INV-2036 · paid");
    expect(words).toMatch(/INV-2037 · \$[\d,.]+ open/);
  });

  it("offers no next stage once the shares are all invoiced, and says the pause note while paused", async () => {
    await loadProject(3);
    useUi.setState((s) => ({ selected: { ...s.selected, project: 3 } }));
    const words = text(draw(<Project />));
    expect(words).toContain("Paused under clause 4");
    expect(words).not.toContain("Invoice the next stage");
  });

  it("says so when the project isn't there", () => {
    useUi.setState((s) => ({ selected: { ...s.selected, project: 99 } }));
    expect(text(draw(<Project />))).toContain("All projects");
  });
});

describe("the sheets", () => {
  it("Edit milestones: a row per milestone with its title and day, a remove only where nothing hangs on it", async () => {
    await loadProject(2);
    const html = draw(<Milestones sheet={{ kind: "milestones", projectId: 2 }} onClose={() => undefined} />);
    expect(html).toContain('value="Window sketches"');
    expect(html).toContain('value="2026-08-07"');
    expect(html).toMatch(/aria-label="Remove milestone 1"[^>]*disabled=""/);
    expect(html).not.toMatch(/aria-label="Remove milestone 2"[^>]*disabled=""/);
    expect(text(html)).toContain("Save milestones");
  });

  it("Add deliverable: title, milestone (open ones only), file or link, share with the contact or save without", async () => {
    await loadProject(1);
    const words = text(draw(<Deliverable sheet={{ kind: "deliverable", projectId: 1 }} onClose={() => undefined} />));
    expect(words).toContain("PRJ-01 · Packaging system");
    expect(words).toContain("No milestone Artwork Print and hand over");
    expect(words).not.toContain("Structure and dielines");
    expect(words).toContain("Drop a file or choose one");
    expect(words).toContain("Share with Cleo");
    expect(words).toContain("Save without sharing");
  });
});
