import { describe, expect, it } from "vitest";

import { LOCALE_TAGS } from "./i18n/locales.ts";
import { MESSAGES } from "./i18n/messages/index.ts";
import { startupFailureCopy } from "./startupFailure.ts";

describe("the startup failure screen", () => {
  it("speaks the page's language, in its direction", () => {
    const ar = startupFailureCopy({ key: "startup.deskUnread" }, null, "ar-EG");
    expect(ar).toMatchObject({ lang: "ar-EG", dir: "rtl", title: "تعذّر على Clinic Desk تحميل بياناته" });
    expect(ar.detail).toBe(MESSAGES["ar-EG"]["startup.deskUnread"]);
    expect(startupFailureCopy({ key: "startup.noConfig" }, "NO_BACKEND", "de-DE")).toMatchObject({
      dir: "ltr",
      title: "Für Clinic Desk ist kein Backend eingerichtet",
    });
  });

  it("chooses the headline by cause, with the product's own name", () => {
    const title = (code: string | null) => startupFailureCopy({ text: "x" }, code, "en-US").title;
    expect(title("NO_CONNECTION")).toBe("Clinic Desk is not connected");
    expect(title("NO_BACKEND")).toBe("Clinic Desk has no backend configured");
    expect(title("SCHEMA_MISMATCH")).toBe("Clinic Desk’s tables do not match what it reads");
    expect(title("RATE_LIMITED")).toBe("Clinic Desk could not load its data");
  });

  it("shows a server's own words as sent", () => {
    expect(startupFailureCopy({ text: "Table clinic_faqs is absent." }, "SCHEMA_MISMATCH", "fr-FR").detail).toBe("Table clinic_faqs is absent.");
  });

  it("has every headline and sentence in all eight languages, each naming the product where it should", () => {
    for (const tag of LOCALE_TAGS) {
      for (const code of ["NO_CONNECTION", "NO_BACKEND", "SCHEMA_MISMATCH", null]) {
        const { title } = startupFailureCopy({ text: "" }, code, tag);
        expect(title, `${tag} ${String(code)}`).toContain("Clinic Desk");
        expect(title).not.toContain("{product}");
      }
      for (const key of ["startup.noConfig", "startup.noBookingKey", "startup.noServer", "startup.deskUnread"] as const) {
        expect(MESSAGES[tag][key], `${tag} ${key}`).toBeTruthy();
      }
    }
  });
});
