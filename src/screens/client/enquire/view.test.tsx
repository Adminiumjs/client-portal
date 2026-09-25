/**
 * The enquiry form as it is drawn, in each state a visitor meets: empty, with
 * problems, while the human check runs, refused, and sent — and the page
 * itself on the sample studio.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nProvider, setHostLocale } from "../../../i18n/index.tsx";
import { fakeStudio } from "../../../testing/fakeStudio.ts";
import { loadStudio, setPortalPort, usePortal } from "../../../state/portal.ts";
import { useUi } from "../../../state/ui.ts";
import { setZone } from "../../../lib/clock.ts";
import ClientEnquire from "../Enquire.tsx";
import { EMPTY, REFUSAL_WORDS, type EnquireInput } from "./model.ts";
import { FormView, SentView, siteOf, type FormViewProps } from "./view.tsx";

function current(): void {
  for (const store of [usePortal, useUi] as unknown as { getState: () => object; getInitialState: () => object }[]) Object.assign(store.getInitialState(), store.getState());
}
const draw = (node: React.ReactNode): string => {
  current();
  return renderToStaticMarkup(<I18nProvider>{node}</I18nProvider>);
};
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ");
const noop = () => undefined;

const base: FormViewProps = { input: EMPTY, problems: {}, sending: false, refused: null, studioName: "Outline", replyTo: "hello@outline.example", onChange: noop, onSubmit: noop, onFind: noop, band: (b) => `band ${b}` };
const form = (over: Partial<FormViewProps> = {}) => draw(<FormView {...base} {...over} />);

beforeEach(() => {
  setHostLocale("en-US");
  setZone("America/New_York");
});

describe("the form", () => {
  it("asks for seven things, three of them needed, with the human check said before Send", () => {
    const html = form();
    expect(html).toContain('data-screen="client-enquire"');
    expect(html.match(/<h1/g)).toHaveLength(1);
    for (const name of ["name", "email", "business", "trade", "budget", "start_when", "body"]) expect(html, name).toContain(`name="${name}"`);
    // Never a field for what the studio decides.
    for (const name of ["status", "source", "fit", "number", "client_id", "received_at"]) expect(html, name).not.toContain(`name="${name}"`);
    expect(html.match(/required=""/g)).toHaveLength(3);
    expect(html).toMatch(/autocomplete="email"/i);
    const words = text(html);
    expect(words).toContain("Tell us about your project");
    expect(words).toContain("When you press Send, your browser does a quick sum to show a person is sending this.");
    expect(words).toContain("Send to Outline");
    expect(words).toContain("What you send here goes to Outline and no one else.");
    expect(words).toContain("Already working with us?");
    expect(html).not.toContain('aria-invalid="true"');
    expect(html).not.toContain('role="alert"');
  });

  it("marks each field with a problem, tied to its words for a screen reader", () => {
    const html = form({ problems: { name: "enquire.error.namePlain", body: "enquire.error.bodyEmpty" } });
    expect(html).toMatch(/id="enquire-name"[^>]*aria-invalid="true"[^>]*aria-describedby="enquire-name-error"|aria-invalid="true"[^>]*aria-describedby="enquire-name-error"[^>]*id="enquire-name"/);
    expect(html).toContain('id="enquire-name-error"');
    expect(html).toContain('id="enquire-body-error"');
    expect(text(html)).toContain("A name can hold letters, spaces and ordinary punctuation — no numbers, symbols or links.");
    expect(html.match(/aria-invalid="true"/g)).toHaveLength(2);
  });

  it("says the check is running while it sends, and cannot be sent twice", () => {
    const html = form({ sending: true, input: { ...EMPTY, name: "Rosa" } });
    expect(text(html)).toContain("Checking and sending…");
    expect(html).toMatch(/<button type="submit"[^>]*disabled=""[^>]*aria-busy="true"/);
  });

  it("words a limit, and offers the studio's address to write to instead", () => {
    const html = form({ refused: REFUSAL_WORDS["PUBLIC_LIMIT_REACHED"]! });
    expect(html).toContain('role="alert"');
    expect(text(html)).toContain("We’ve had as many enquiries as we can take online for now, from this address or through this page. This one wasn’t sent.");
    expect(text(html)).toContain("You can write to us at hello@outline.example instead.");
    expect(html).toContain('href="mailto:hello@outline.example"');
    // Without an address to offer, the words stand on their own.
    const bare = form({ refused: REFUSAL_WORDS["PUBLIC_LIMIT_REACHED"]!, replyTo: null });
    expect(text(bare)).not.toContain("write to us");
    // A wait-and-retry needs no address.
    expect(text(form({ refused: REFUSAL_WORDS["PUBLIC_RATE_LIMITED"]! }))).not.toContain("write to us");
  });

  it("keeps what was typed", () => {
    const typed: EnquireInput = { ...EMPTY, name: "Rosa Vento", body: "<b>A sign</b> & a name" };
    const html = form({ input: typed, refused: REFUSAL_WORDS["PUBLIC_RATE_LIMITED"]! });
    expect(html).toContain('value="Rosa Vento"');
    expect(html).toContain("&lt;b&gt;A sign&lt;/b&gt; &amp; a name");
    expect(html).not.toContain("<b>A sign</b>");
  });

  it("reads in the visitor's language, right to left in Arabic", () => {
    setHostLocale("ar-EG");
    const words = text(form());
    expect(words).toContain("احكِ لنا عن مشروعك");
    expect(words).toContain("إرسال إلى Outline");
    setHostLocale("en-US");
  });
});

describe("sent", () => {
  it("thanks them, says when it arrived — and nothing else comes back to show", () => {
    const html = draw(<SentView receivedAt="2026-07-28T14:04:00.000Z" studioName="Outline" website="https://outline.example/" onAnother={noop} onFind={noop} />);
    const words = text(html);
    expect(words).toContain("Thank you — it’s with Outline.");
    // Read on the studio's clock, not the visitor's.
    expect(words).toContain("Received Jul 28, 10:04 AM");
    expect(html).toMatch(/datetime="2026-07-28T14:04:00.000Z"/i);
    expect(words).toContain("Send another enquiry");
    expect(html).toContain('href="https://outline.example/"');
    expect(words).toContain("Back to outline.example");
    expect(words).not.toMatch(/ENQ-|number|status/i);
  });

  it("links the studio's site only when it is an ordinary web address", () => {
    expect(siteOf("https://www.outline.example/work")).toEqual({ href: "https://www.outline.example/work", host: "outline.example" });
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "//evil.example", "outline.example", "", null, undefined]) expect(siteOf(bad), String(bad)).toBeNull();
    const html = draw(<SentView receivedAt={null} studioName="" website="javascript:alert(1)" onAnother={noop} onFind={noop} />);
    expect(html).not.toContain("javascript:");
    expect(text(html)).toContain("Thank you — it’s with the studio.");
    expect(text(html)).not.toContain("Received");
  });
});

describe("the page on the sample studio", () => {
  it("opens empty, in the studio's name, to anyone", async () => {
    const studio = await fakeStudio();
    setPortalPort(studio.world.portal(1));
    usePortal.setState({ me: null, studio: null });
    useUi.setState({ persona: "client", view: "enquire", preview: null });
    await loadStudio(true);
    const html = draw(<ClientEnquire />);
    const words = text(html);
    expect(words).toContain("Send to Outline");
    expect(html).not.toContain('aria-invalid="true"');
    expect(html).not.toContain("data-state=\"sent\"");
    // The bands in the studio's currency.
    expect(words).toContain("Under $1K");
    expect(words).toContain("$2K–$4K");
    expect(words).toContain("$8K or more");
  });
});
