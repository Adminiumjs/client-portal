/**
 * What a client does on their side, against the sample studio: each action
 * goes through its own door with only what the client types, the page shows
 * the row as the server saved it, "Request changes" finishes after a failure
 * between its two writes, and the studio's preview refuses everything.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PortalPort } from "../data/ports.ts";
import { fakeStudio, tableOf, type FakeStudio } from "../testing/fakeStudio.ts";
import * as client from "./clientActions.ts";
import { loadPortal, setPortalPort, usePortal } from "./portal.ts";
import { useUi } from "./ui.ts";

let studio: FakeStudio;
let calls: [string, unknown[]][];
let failNext: string | null;

/** The world's client port, recording each door used and able to drop one answer. */
function recording(port: PortalPort): PortalPort {
  const wrapped = { ...port } as Record<string, unknown>;
  for (const name of ["accept", "sign", "decline", "askNewPrice", "review", "addNote", "saveAnswer", "sendBrief", "sentPayment", "requestLink", "verifyLink", "signOut"] as const) {
    const inner = port[name] as (...args: unknown[]) => Promise<unknown>;
    wrapped[name] = async (...args: unknown[]) => {
      calls.push([name, args]);
      if (failNext === name) {
        failNext = null;
        throw Object.assign(new Error("no answer"), { code: "PUBLIC_NETWORK_UNAVAILABLE", status: 0 });
      }
      return inner(...args);
    };
  }
  return wrapped as unknown as PortalPort;
}

beforeEach(async () => {
  studio = await fakeStudio();
  calls = [];
  failNext = null;
  setPortalPort(recording(studio.world.portal(1)));
  useUi.setState({ persona: "client", view: "home", preview: null });
  await loadPortal();
});

describe("a client's proposal", () => {
  it("accepts and signs with the typed name; who, when and how are the server's", async () => {
    expect(await client.acceptAndSign(3, "Amara Osei")).toEqual({ ok: true, value: undefined });
    expect(calls).toEqual([["accept", [3, "Amara Osei"]]]);
    expect(usePortal.getState().rows.proposals[3]).toMatchObject({ status: "accepted", signed_name: "Amara Osei", accepted_how: "portal" });
    expect(usePortal.getState().rows.proposals[3]?.signed_at).not.toBeNull();
  });

  it("declines with a note, and is refused a second decision", async () => {
    await client.declineProposal(3, "Not this year");
    expect(await client.acceptAndSign(3, "Amara Osei")).toMatchObject({ ok: false, code: "PUBLIC_WRITE_REFUSED" });
  });

  it("asks for a new price only on one past its date", async () => {
    expect(await client.askForNewPrice(3)).toMatchObject({ ok: false, code: "PUBLIC_WRITE_REFUSED" });
  });
});

describe("a client's review", () => {
  // Fold & Rule's large box is waiting for their review.
  beforeEach(async () => {
    setPortalPort(recording(studio.world.portal(2)));
    await loadPortal();
  });

  it("approves a deliverable waiting for them", async () => {
    await client.approveDeliverable(1);
    expect(calls).toEqual([["review", [1, "approved", null]]]);
    expect(tableOf(studio, "deliverables").find((d) => d["id"] === 1)).toMatchObject({ status: "approved", approved_how: "portal" });
  });

  it("requests changes: the status with the note, then the note in the conversation", async () => {
    await client.requestChanges(1, 1, " The lid is too dark ");
    expect(calls.map(([name]) => name)).toEqual(["review", "addNote"]);
    expect(calls[1]![1][0]).toEqual({ deliverable_id: 1, version_id: 1, body: "The lid is too dark", pin_x: null, pin_y: null });
  });

  it("finishes a request for changes whose note did not save — the status is not sent twice", async () => {
    failNext = "addNote";
    const first = await client.requestChanges(1, 1, "The lid is too dark");
    if (first.ok || first.unfinished === null) throw new Error("expected an unfinished action");
    expect(first.unfinished.step).toBe("note");
    await first.unfinished.resume();
    expect(calls.map(([name]) => name)).toEqual(["review", "addNote", "addNote"]);
    expect(tableOf(studio, "deliverable_notes").filter((n) => n["body"] === "The lid is too dark")).toHaveLength(1);
  });

  it("writes back, with a pin", async () => {
    await client.writeBack(1, 1, "Here", { x: "0.3", y: "0.7" });
    expect(calls[0]).toEqual(["addNote", [{ deliverable_id: 1, version_id: 1, body: "Here", pin_x: "0.3", pin_y: "0.7" }]]);
  });
});

describe("the brief and a payment", () => {
  it("answers a question (then changes it, the same row), and sends the brief", async () => {
    usePortal.setState({ me: { company: "Fold & Rule Stationers", contact_name: "Cleo Marchetti" } });
    setPortalPort(recording(studio.world.portal(2)));
    await loadPortal();
    await client.saveBriefAnswer(1, "admire", "Letterpress work");
    const made = Object.values(usePortal.getState().rows.brief_answers).find((a) => a.question_key === "admire");
    await client.saveBriefAnswer(1, "admire", "Letterpress, and old maps");
    expect(calls.map(([name, args]) => [name, args[3]])).toEqual([
      ["saveAnswer", null],
      ["saveAnswer", made?.id],
    ]);
  });

  it("says a payment was sent once; after that the door is closed until the studio records one", async () => {
    await client.sentAPayment(4, { on: "2026-07-27", amount: "200.00", note: "Bank transfer" });
    expect(calls[0]).toEqual(["sentPayment", [4, { on: "2026-07-27", amount: "200.00", note: "Bank transfer" }]]);
    expect(usePortal.getState().rows.invoices[4]).toMatchObject({ client_paid: true, client_paid_on: "2026-07-27" });
    expect(await client.sentAPayment(4, { on: "2026-07-28" })).toMatchObject({ ok: false, code: "PUBLIC_WRITE_REFUSED" });
  });
});

describe("signing in and out", () => {
  it("asks for a link, spends it, and reads a used one as expired", async () => {
    expect(await client.requestSignInLink("amara@hearth.example", "en-US")).toEqual({ ok: true, value: undefined });
    expect(await client.continueWithLink("demo")).toEqual({ ok: true, value: undefined });
    expect(await client.continueWithLink("used-token")).toMatchObject({ ok: false, reason: "link-expired", code: "LINK_EXPIRED" });
  });

  it("signs out: nothing of the client stays on the page", async () => {
    await client.signOut();
    expect(usePortal.getState().me).toBeNull();
    expect(Object.keys(usePortal.getState().rows.invoices)).toEqual([]);
    expect(useUi.getState().view).toBe("find");
  });
});

describe("the studio's preview", () => {
  it("refuses every client action before anything is sent", async () => {
    useUi.setState({ preview: { clientId: 1, back: "client" } });
    const spy = vi.fn();
    for (const outcome of [
      await client.acceptAndSign(3, "X"),
      await client.declineProposal(3, null),
      await client.approveDeliverable(1),
      await client.requestChanges(1, 1, "X"),
      await client.sentAPayment(4, { on: "2026-07-27" }),
      await client.sendBrief(2),
    ]) {
      spy();
      expect(outcome).toMatchObject({ ok: false, reason: "preview" });
    }
    expect(spy).toHaveBeenCalledTimes(6);
    expect(calls).toEqual([]);
  });
});
