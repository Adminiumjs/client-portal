/**
 * The customer config carries the app's other browser keys by what they open
 * — the shared handover's `publicKeys.handover` — so the clients' page can
 * open a handover link on its own key.
 */
import { describe, expect, it } from "vitest";

import { resolveSurfaceConfig } from "./publicConfig.ts";

const served = (doc: unknown) => async () => new Response(JSON.stringify(doc), { status: 200 });
const opts = { baked: {}, hostedCustomer: true, base: "/apps/clients/customer/", origin: "https://studio.example" };

describe("the customer config's other keys", () => {
  it("reads the handover's key beside the portal's", async () => {
    const config = await resolveSurfaceConfig({ ...opts, fetchImpl: served({ baseUrl: "", publishableKey: "adm_pub_portal", publicKeys: { handover: "adm_pub_handover" } }) as never });
    expect(config).toMatchObject({ publishableKey: "adm_pub_portal", publicKeys: { handover: "adm_pub_handover" } });
  });

  it("has none from a server that serves none, and ignores what is not a key", async () => {
    expect(await resolveSurfaceConfig({ ...opts, fetchImpl: served({ publishableKey: "adm_pub_portal" }) as never })).not.toHaveProperty("publicKeys");
    expect(await resolveSurfaceConfig({ ...opts, fetchImpl: served({ publishableKey: "adm_pub_portal", publicKeys: { handover: 42, other: "" } }) as never })).not.toHaveProperty("publicKeys");
  });
});

describe("a rehearsal's token", () => {
  it("is carried when the server serves it to the person rehearsing, and never made up", async () => {
    const config = await resolveSurfaceConfig({ ...opts, fetchImpl: served({ publishableKey: "adm_pub_portal", rehearsal: { until: "2026-11-16T10:00:00.000Z", csrfToken: "tok_rehearse" } }) as never });
    expect(config).toMatchObject({ rehearsalCsrfToken: "tok_rehearse" });
    for (const rehearsal of [undefined, null, {}, { csrfToken: "" }, { csrfToken: 7 }]) {
      expect(await resolveSurfaceConfig({ ...opts, fetchImpl: served({ publishableKey: "adm_pub_portal", rehearsal }) as never })).not.toHaveProperty("rehearsalCsrfToken");
    }
  });
});
