/**
 * The studio's handover page, drawn from the sample studio's rows: "Preview
 * what they see" and the picker, the hero and its three figures, the link and
 * its state (live, stopped with the day and "Make a new link", not sent yet),
 * how long it lives (Never or 90 days — nothing that says it never expires),
 * the send button, the files, the notes, the fonts. And the stop sheet.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../../i18n/index.tsx";
import { fakeStudio } from "../../testing/fakeStudio.ts";
import { loadProject, upsert, upsertAll, useDesk } from "../../state/desk.ts";
import { useSheets } from "../../state/sheets.ts";
import { usePortal } from "../../state/portal.ts";
import { useUi } from "../../state/ui.ts";
import Handover from "../Handover.tsx";
import StopShare from "../../sheets/StopShare.tsx";

function current(): void {
  for (const store of [useDesk, usePortal, useUi, useSheets] as unknown as { getState: () => object; getInitialState: () => object }[]) {
    Object.assign(store.getInitialState(), store.getState());
  }
}
const draw = (node: React.ReactNode) => {
  current();
  return renderToStaticMarkup(<I18nProvider>{node}</I18nProvider>);
};
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");

async function openHandover(id: number): Promise<void> {
  await loadProject(id);
  useUi.setState((s) => ({ view: "handover", selected: { ...s.selected, project: id } }));
}

beforeEach(async () => {
  await fakeStudio();
});

describe("a finished project's handover", () => {
  beforeEach(async () => {
    await openHandover(4);
  });

  it("offers the visitor's view and a picker of projects", () => {
    const html = draw(<Handover />);
    expect(text(html)).toContain("Preview what they see");
    expect(html).toMatch(/aria-pressed="true"[^>]*>Kiln Street Ceramics</);
  });

  it("draws the hero with when it closed and the three figures (void invoices left out)", () => {
    const words = text(draw(<Handover />));
    expect(words).toContain("Kiln Street Ceramics · PRJ-04");
    expect(words).toContain("Everything from the studio identity");
    expect(words).toContain("Closed on May 29, 2026.");
    expect(words).toContain("Ran for Jan 5 – May 29");
    expect(words).toContain("Milestones 1 of 1");
    expect(words).toContain("Invoiced $0.00");
  });

  it("shows the live link, Copy and Stop, and how long it lives — Never or 90 days", () => {
    const html = draw(<Handover />);
    const words = text(html);
    expect(words).toContain("The link you send Live");
    expect(words).toContain("/h#KILNSTREETDONE26");
    expect(words).toContain("Copy");
    expect(words).toContain("Stop this link");
    expect(html).toMatch(/aria-pressed="true"[^>]*>Never</);
    expect(html).toMatch(/aria-pressed="false"[^>]*>90 days</);
    expect(words).not.toMatch(/never expires/i);
    expect(words).toContain("Sent to Jonas");
  });

  it("when stopped: the link struck through, the day it stopped, and Make a new link", () => {
    const p = useDesk.getState().rows.projects[4]!;
    upsert("projects", { ...p, share_stopped: true, share_stopped_at: "2026-07-28T14:00:00.000Z" });
    const html = draw(<Handover />);
    const words = text(html);
    expect(words).toContain("The link you send Stopped");
    expect(html).toContain("ho-address ho-address--stopped");
    expect(words).toContain("Stopped on Jul 28");
    expect(words).toContain("Make a new link");
    expect(words).not.toContain("Stop this link");
  });

  it("with ninety days: the day it ends", () => {
    const p = useDesk.getState().rows.projects[4]!;
    upsert("projects", { ...p, share_expires_on: "2026-10-26" });
    const html = draw(<Handover />);
    expect(html).toMatch(/aria-pressed="true"[^>]*>90 days</);
    expect(text(html)).toContain("it ends on October 26, 2026");
  });

  it("lists the approved work, the notes and the fonts", () => {
    upsertAll("project_fonts", [{ id: 1, project_id: 4, client_id: 4, name: "Bell Grotesk", licence: null, position: 0, client_key: null }]);
    const words = text(draw(<Handover />));
    expect(words).toContain("Everything, in one place");
    // The file's own name is read after the first drawing; until then the deliverable's title stands in.
    expect(words).toContain("Take it all Final mark files Link ");
    expect(words).toContain("Print the mark at 20 mm or larger.");
    expect(words).toContain("Bell Grotesk Licence on file Yours");
  });
});

describe("a running project's handover", () => {
  it("says it fills in as work is approved, has nothing to hand over yet, and has not been sent", async () => {
    await openHandover(2);
    const words = text(draw(<Handover />));
    expect(words).toContain("This project is still running");
    expect(words).toContain("Since Jul 1");
    expect(words).toContain("Nothing here yet. Approved work lands here, and anything you add.");
    expect(words).toContain("The link you send Not sent yet");
    expect(words).toContain("Send the handover");
    expect(words).toContain("No notes for this project yet.");
    expect(words).toContain("No fonts licensed on this project.");
  });
});

describe("the stop sheet", () => {
  it("says what stopping does, and stops", async () => {
    await openHandover(4);
    const words = text(draw(<StopShare sheet={{ kind: "stopShare", projectId: 4 }} onClose={() => undefined} />));
    expect(words).toContain("Stop this link");
    expect(words).toContain("PRJ-04 · Studio identity");
    expect(words).toContain("Anyone with it — the client, their printer — sees a stopped page from now on.");
    expect(words).toContain("Stop the link");
  });
});
