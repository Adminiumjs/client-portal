import { describe, expect, it } from "vitest";

import { detailFromPath, landingFromHash, linkFragment, tokenFromHash } from "./deepLink.ts";

describe("links into one document", () => {
  it("opens the document a section path names, on each side", () => {
    expect(detailFromPath("staff", "invoices/12")).toEqual({ view: "invoice", id: 12 });
    expect(detailFromPath("customer", "proposals/7/")).toEqual({ view: "proposal", id: 7 });
    expect(detailFromPath("customer", "clients/3")).toBeNull();
    expect(detailFromPath("staff", "invoices")).toBeNull();
    expect(detailFromPath("staff", "invoices/INV-2039")).toBeNull();
  });

  it("reads a link's token from the fragment, and a landing only when it is the app's own path", () => {
    expect(tokenFromHash("#abcDEF123_-xyz")).toBe("abcDEF123_-xyz");
    expect(tokenFromHash("#abcDEF123_-xyz&to=invoices/12")).toBe("abcDEF123_-xyz");
    expect(tokenFromHash("#x")).toBeNull();
    expect(landingFromHash("#abcDEF123&to=invoices/12")).toBe("invoices/12");
    expect(landingFromHash("#abcDEF123&to=//evil.example")).toBeNull();
    expect(landingFromHash("#abcDEF123&to=https://evil.example")).toBeNull();
  });

  it("reads the token and the landing together, before the fragment leaves the address", () => {
    expect(linkFragment("#abcDEF123_-xyz&to=invoices/12")).toEqual({ token: "abcDEF123_-xyz", landing: "invoices/12" });
    expect(linkFragment("")).toEqual({ token: null, landing: null });
  });
});
