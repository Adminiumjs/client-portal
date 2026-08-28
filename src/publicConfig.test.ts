/**
 * `resolveSurfaceConfig` (29-app-surfaces.md D10, 29-T16) — the resolution
 * order is the contract: baked wins outright; only a hosted CUSTOMER build
 * fetches; every malformed answer degrades to null (the app's hard-stop),
 * never to a thrown boot.
 */
import { describe, expect, it, vi } from "vitest";

import { resolveSurfaceConfig } from "./publicConfig.ts";

const CONFIG = { baseUrl: "", publishableKey: "adm_pub_livekey0.secret" };

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("resolveSurfaceConfig", () => {
  it("baked vars win outright — no fetch happens", async () => {
    const fetchImpl = vi.fn();
    const config = await resolveSurfaceConfig({
      baked: { baseUrl: "https://api.example.com", publishableKey: "adm_pub_baked.k" },
      hostedCustomer: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(config).toEqual({ baseUrl: "https://api.example.com", publishableKey: "adm_pub_baked.k" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("a hosted customer build fetches the base-derived absolute path, uncached", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes(200, CONFIG));
    const config = await resolveSurfaceConfig({
      baked: {},
      hostedCustomer: true,
      base: "/apps/clients/customer/",
      origin: "https://shop.example.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).toHaveBeenCalledWith("/apps/clients/customer/surface-config.json", {
      cache: "no-store",
    });
    // The served "" baseUrl means THIS origin, normalized here once.
    expect(config).toEqual({
      baseUrl: "https://shop.example.com",
      publishableKey: "adm_pub_livekey0.secret",
    });
  });

  it("a served absolute baseUrl passes through untouched", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonRes(200, { ...CONFIG, baseUrl: "https://api.other.example" }));
    const config = await resolveSurfaceConfig({
      baked: {},
      hostedCustomer: true,
      base: "/apps/clients/customer/",
      origin: "https://shop.example.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(config?.baseUrl).toBe("https://api.other.example");
  });

  it("anything but a hosted customer build never fetches", async () => {
    const fetchImpl = vi.fn();
    expect(
      await resolveSurfaceConfig({
        baked: {},
        hostedCustomer: false,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["a 404 (nothing bound)", () => jsonRes(404, { error: { code: "NOT_FOUND" } })],
    ["an empty key", () => jsonRes(200, { baseUrl: "", publishableKey: "" })],
    ["a non-object body", () => jsonRes(200, "nope")],
    [
      "the SPA fallback answering HTML (older server)",
      () => new Response("<!doctype html>", { status: 200, headers: { "content-type": "text/html" } }),
    ],
    ["a network failure", () => Promise.reject(new Error("offline"))],
  ])("degrades to null on %s — the hard-stop's job, never a throw", async (_name, answer) => {
    const fetchImpl = vi.fn().mockImplementation(() => {
      const value = answer();
      return value instanceof Promise ? value : Promise.resolve(value);
    });
    expect(
      await resolveSurfaceConfig({
        baked: {},
        hostedCustomer: true,
        base: "/apps/clients/customer/",
        origin: "https://shop.example.com",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).toBeNull();
  });
});
