/**
 * Signing in: the typed address is checked only for its shape and shown back
 * masked; the code boxes take typing and pasting; the server's answer to a
 * code is put into words; asking for a link answers the same for any address;
 * and a link lands only on one of the app's own pages.
 */
import { describe, expect, it } from "vitest";

import type { Outcome } from "../../../state/outcome.ts";
import { codeProblem, emailProblem, emptyCode, landingOf, maskEmail, placeDigits, sendProblem } from "./model.ts";

const refused = (reason: string, code = "X"): Outcome<never> => ({ ok: false, reason: reason as never, code, field: null, details: {}, unfinished: null });

describe("the address", () => {
  it("is masked to its first letter and its domain", () => {
    expect(maskEmail("amara@hearth.example")).toBe("a•••@hearth.example");
    expect(maskEmail(" x@y.example ")).toBe("x•••@y.example");
  });

  it("is checked for shape only", () => {
    expect(emailProblem("   ")).toBe("empty");
    expect(emailProblem("amara")).toBe("shape");
    expect(emailProblem("amara@hearth")).toBe("shape");
    expect(emailProblem("someone@elsewhere.example")).toBeNull();
  });

  it("gets the same answer whether or not it is a client's", () => {
    expect(sendProblem({ ok: true, value: undefined })).toBeNull();
    expect(sendProblem(refused("busy", "PUBLIC_RATE_LIMITED"))).toBe("client.find.tooMany");
    expect(sendProblem(refused("offline"))).toBe("save.offline");
  });
});

describe("the six boxes", () => {
  it("take one digit and move on", () => {
    expect(placeDigits(emptyCode(), 0, "4")).toEqual({ code: ["4", "", "", "", "", ""], focus: 1 });
  });

  it("spread a pasted code from the box it lands in, digits only", () => {
    expect(placeDigits(emptyCode(), 0, "48 29-13")).toEqual({ code: ["4", "8", "2", "9", "1", "3"], focus: 5 });
    expect(placeDigits(emptyCode(), 4, "123456").code).toEqual(["", "", "", "", "1", "2"]);
  });

  it("clear a box when its digit is deleted", () => {
    expect(placeDigits(["1", "2", "", "", "", ""], 1, "").code).toEqual(["1", "", "", "", "", ""]);
  });
});

describe("a code the server did not take", () => {
  it("says how many tries are left, that it expired, or that the code path is locked", () => {
    expect(codeProblem({ ok: true, value: { ok: true } })).toBeNull();
    expect(codeProblem({ ok: true, value: { ok: false, triesLeft: 4 } })).toEqual({ key: "client.find.codeWrong", count: 4 });
    expect(codeProblem({ ok: true, value: { ok: false, triesLeft: 0 } })).toEqual({ key: "client.find.codeLocked", locked: true });
    expect(codeProblem({ ok: true, value: { ok: false, triesLeft: null } })).toEqual({ key: "client.find.codeExpired" });
    expect(codeProblem(refused("link-expired", "LINK_EXPIRED"))).toEqual({ key: "client.find.codeExpired" });
    expect(codeProblem(refused("busy", "PUBLIC_RATE_LIMITED"))).toEqual({ key: "client.find.codeLocked", locked: true });
  });
});

describe("where a link lands", () => {
  it("is the document it names, a whole page, or Home — never anything else", () => {
    expect(landingOf("invoices/12")).toEqual({ view: "invoice", id: 12 });
    expect(landingOf("proposals/7")).toEqual({ view: "proposal", id: 7 });
    expect(landingOf("statement")).toEqual({ view: "statement", id: null });
    expect(landingOf("invoices")).toEqual({ view: "home", id: null });
    expect(landingOf("h")).toEqual({ view: "home", id: null });
    expect(landingOf("https://elsewhere.example/x")).toEqual({ view: "home", id: null });
    expect(landingOf(null)).toEqual({ view: "home", id: null });
  });
});
