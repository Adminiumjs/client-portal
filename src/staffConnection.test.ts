/**
 * The staff surface's connection binding (29 D9).
 *
 * Every case here is a way the answer can be ABSENT, because absent is the
 * common case — unbound surfaces, and any Adminium older than the binding —
 * and all of them must keep the app booting on its old inference.
 */
import { describe, expect, it, vi } from "vitest";

import { configBase, resolveStaffConnectionId } from "./staffConnection.ts";

const ok = (doc: unknown) =>
  vi.fn(async () =>
    new Response(JSON.stringify(doc), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ) as unknown as typeof fetch;

describe("resolveStaffConnectionId", () => {
  it("reads the bound connection from the served document", async () => {
    const fetchImpl = ok({ connectionId: "con_42" });
    expect(
      await resolveStaffConnectionId({ hostedStaff: true, base: "/apps/clients/staff/", fetchImpl }),
    ).toBe("con_42");
  });

  it("returns null for an UNBOUND surface — a complete answer, not a failure", async () => {
    const fetchImpl = ok({ connectionId: null });
    expect(
      await resolveStaffConnectionId({ hostedStaff: true, base: "/apps/clients/staff/", fetchImpl }),
    ).toBeNull();
  });

  it("returns null when an older server answers with the SPA index", async () => {
    // The route does not exist there; the wildcard serves index.html and
    // `json()` throws. The app must still boot against that Adminium.
    const fetchImpl = vi.fn(
      async () => new Response("<!doctype html><html></html>", { status: 200 }),
    ) as unknown as typeof fetch;
    expect(
      await resolveStaffConnectionId({ hostedStaff: true, base: "/apps/clients/staff/", fetchImpl }),
    ).toBeNull();
  });

  it("never asks on a non-staff build", async () => {
    // A demo or customer bundle has no session and no business fetching this.
    const fetchImpl = ok({ connectionId: "con_42" });
    expect(await resolveStaffConnectionId({ hostedStaff: false, fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("configBase", () => {
  const BAKED = "/apps/clients/staff/";

  it("asks the INSTANCE mount when the page is served from one", () => {
    expect(configBase(BAKED, "/apps/clients/berlin/staff/invoices")).toBe(
      "/apps/clients/berlin/staff/",
    );
  });

  it("keeps the baked base on the unslugged mount", () => {
    expect(configBase(BAKED, "/apps/clients/staff/invoices")).toBe(BAKED);
  });

  it("asks `/` on a MAPPED DOMAIN, which is the only place its instance is known", () => {
    /*
     * Reversed deliberately. This returned the baked `/apps/…` form while
     * nothing answered at the root — but a mapped host can now point at an
     * instance, and the bundle never sees the domain map, so the root document
     * is the only thing that can tell it which database it belongs to. Asking
     * the baked form would pin every mapped host to the app's own.
     */
    expect(configBase(BAKED, "/invoices/7")).toBe("/");
    expect(configBase(BAKED, "/")).toBe("/");
  });

  it("never reads the unslugged mount as an instance called `staff`", () => {
    // `/apps/clients/staff/staff` is a deep link, not an instance.
    expect(configBase(BAKED, "/apps/clients/staff/staff")).toBe(BAKED);
  });

  it("ignores an instance path belonging to a DIFFERENT app or side", () => {
    // One bundle must never fetch another surface's binding.
    expect(configBase(BAKED, "/apps/clinic/berlin/staff/x")).toBe(BAKED);
    expect(configBase(BAKED, "/apps/clients/berlin/customer/x")).toBe(BAKED);
  });
});
