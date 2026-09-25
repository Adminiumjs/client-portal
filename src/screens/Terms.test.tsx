/**
 * Terms & signature, drawn from the sample studio: the versions with their
 * state and lock, a signed agreement's record, one accepted with no
 * signature (and the one request a day), one still out — and a version's
 * clauses, editable only while no sent proposal names it.
 */
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import type { Proposal } from "../data/types.ts";
import { I18nProvider } from "../i18n/index.tsx";
import { upsert, useDesk } from "../state/desk.ts";
import { usePortal } from "../state/portal.ts";
import { useSheets } from "../state/sheets.ts";
import { useUi } from "../state/ui.ts";
import { fakeStudio } from "../testing/fakeStudio.ts";
import Terms, { AgreementPanel, VersionList, VersionPanel } from "./Terms.tsx";
import { versionsInOrder } from "./terms/model.ts";
import { loadTermsVersion } from "../state/desk.ts";

function current(): void {
  for (const store of [useDesk, usePortal, useUi, useSheets] as unknown as { getState: () => object; getInitialState: () => object }[]) {
    Object.assign(store.getInitialState(), store.getState());
  }
}
const draw = (node: ReactNode) => {
  current();
  return renderToStaticMarkup(<I18nProvider>{node}</I18nProvider>);
};
const versions = () => versionsInOrder(Object.values(useDesk.getState().rows.terms_versions));
const proposal = (id: number): Proposal => useDesk.getState().rows.proposals[id]!;
const noop = () => undefined;

beforeEach(async () => {
  await fakeStudio();
  await loadTermsVersion(3);
  useUi.setState({ view: "terms" });
});

describe("the screen", () => {
  it("opens with the lead that promises no tracking, and reads the agreements from the server", () => {
    const html = draw(<Terms />);
    expect(html).toContain('data-screen="terms"');
    expect(html).toContain(">Terms &amp; signature</h1>");
    expect(html).toContain("Who agreed, when, and the exact wording in force on the day.");
    expect(html).not.toMatch(/from where/i);
    expect(html).toContain("Loading…");
  });
});

describe("the versions", () => {
  it("say which is in force, when the others retired, how many agreements name each, and lock those", () => {
    const html = draw(<VersionList versions={versions()} counts={{ 1: 0, 2: 0, 3: 3 }} manager={true} openId={null} onOpen={noop} />);
    expect(html).toContain("Terms v3");
    expect(html).toContain(">In force<");
    expect(html).toContain("Retired Mar 2026");
    expect(html).toContain("Retired Sep 2025");
    expect(html).toContain("on 3 agreements");
    expect(html).toContain("Read v3");
    expect(html).toContain("Old versions are never edited.");
    expect(html).toContain("New version");
  });

  it("offer no new version to the Studio role", () => {
    expect(draw(<VersionList versions={versions()} counts={{}} manager={false} openId={null} onOpen={noop} />)).not.toContain("New version");
  });
});

describe("one agreement", () => {
  it("signed in the portal: who, their email, when, how, the version that day — and no fingerprint line for a sample row", () => {
    const html = draw(<AgreementPanel proposal={proposal(2)} versions={versions()} />);
    expect(html).toContain("Fold &amp; Rule Stationers");
    expect(html).toContain("PRO-1141 · Packaging system");
    expect(html).toContain(">Signed<");
    expect(html).toContain("Cleo Marchetti");
    expect(html).toContain("cleo@foldandrule.example");
    expect(html).toContain("Typed their name in the portal after signing in with an emailed link");
    expect(html).toContain("Terms v3, live from March 1, 2026");
    expect(html).not.toContain("Fingerprint");
    expect(html).toContain("Accepted and signed");
    expect(html).toContain("PRJ-01");
    expect(html).toContain("Nothing here is editable");
    expect(html).toContain("Terms v3 — the wording in force");
    expect(html).toContain("4 clauses.");
  });

  it("shows the stored fingerprint short, with a way to copy it whole", () => {
    upsert("proposals", { ...proposal(2), fingerprint: "3f9a0c77d1e25b6a90c21e" });
    const html = draw(<AgreementPanel proposal={proposal(2)} versions={versions()} />);
    expect(html).toContain("3f9a…c21e");
    expect(html).toContain("Copy the full fingerprint");
  });

  it("accepted by email with no signature: says so, and asks them to sign — once a day", () => {
    const unsigned = { ...proposal(2), signed_name: null, signed_at: null, signed_email: null, accepted_how: "email" as const };
    upsert("proposals", unsigned);
    let html = draw(<AgreementPanel proposal={proposal(2)} versions={versions()} />);
    expect(html).toContain(">Unsigned<");
    expect(html).toContain("Accepted June 9, 2026 by email — agreement, but no signature.");
    expect(html).toMatch(/<button[^>]*>(?:<svg.*?<\/svg>)?Ask them to sign<\/button>/);
    expect(html).toContain("Accepted by email");
    expect(html).toContain("The gap between accepting and signing");
    upsert("messages", { id: 900, kind: "ask-to-sign", status: "queued", proposal_id: 2, client_id: 2, sent_at: null } as never);
    html = draw(<AgreementPanel proposal={proposal(2)} versions={versions()} />);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>(?:<svg.*?<\/svg>)?Asked — waiting on Cleo<\/button>/);
    expect(html).toContain("Signature requested");
  });

  it("still out: nothing to sign, and the way to the proposal", () => {
    const html = draw(<AgreementPanel proposal={proposal(3)} versions={versions()} />);
    expect(html).toContain(">Nothing to sign<");
    expect(html).toContain("PRO-1142 is still out with Amara Osei.");
    expect(html).toContain("Open PRO-1142");
  });
});

describe("one version", () => {
  it("named by sent proposals: locked, read only", () => {
    const v3 = versions().find((v) => v.id === 3)!;
    const html = draw(<VersionPanel version={v3} versions={versions()} count={3} manager={true} onBack={noop} />);
    expect(html).toContain("Locked — a sent proposal names this version.");
    expect(html).not.toContain("Edit clause");
    expect(html).not.toContain("Add a clause");
    expect(html).toContain("When payment is late");
  });

  it("a draft no proposal names: each clause editable, and a way to put it in force", () => {
    const draft = { id: 99, version: 4, status: "draft" as const, in_force_from: "2026-08-01", note: null, client_key: null };
    upsert("terms_versions", draft);
    upsert("terms_clauses", { id: 99, version_id: 99, position: 0, title: "Paying", body: "Thirty days.", change: "changed", change_note: "Thirty, not fourteen", client_key: null });
    const all = versions();
    const html = draw(<VersionPanel version={all.find((v) => v.id === 99)!} versions={all} count={0} manager={true} onBack={noop} />);
    expect(html).toContain(">Draft<");
    expect(html).toContain('aria-label="Edit clause 1"');
    expect(html).toContain(">Changed<");
    expect(html).toContain("Thirty, not fourteen");
    expect(html).toContain("Add a clause");
    expect(html).toContain("Put it in force");
    expect(draw(<VersionPanel version={all.find((v) => v.id === 99)!} versions={all} count={0} manager={false} onBack={noop} />)).not.toContain("Put it in force");
  });
});
