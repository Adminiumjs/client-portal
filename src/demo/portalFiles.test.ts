/**
 * The demo's clients' side serves what a live page fetches: a file the studio
 * uploaded during the visit, to the client it belongs to and through the
 * handover link of its project; and the payment details the studio wrote in
 * the add-on's settings.
 */
import { describe, expect, it } from "vitest";

import { DEMO_START, DEMO_ZONE } from "../lib/clock.ts";
import { demoSample } from "./sample.ts";
import { createWorld } from "./world.ts";

const fresh = () => createWorld(demoSample("en-US"), () => DEMO_START, DEMO_ZONE, { name: "Nadia Cole" });

describe("the demo's files and payment details", () => {
  it("fetches an uploaded file back for its own client and its handover, and for no one else", async () => {
    const world = fresh();
    const deliverable = world.rows.deliverables.find((d) => d["status"] === "approved" && world.rows.projects.some((p) => p.id === d["project_id"] && typeof p["share_token"] === "string"))!;
    const version = world.rows.deliverable_versions.find((v) => v["deliverable_id"] === deliverable.id)!;
    const project = world.rows.projects.find((p) => p.id === deliverable["project_id"])!;
    const blob = new Blob(["png"], { type: "image/png" });
    const stored = await world.writes.upload("deliverable_versions", "file", blob, "box.png");
    await world.writes.update("deliverable_versions", version.id, { file: stored });

    const own = await world.portal(deliverable["client_id"] as number).file!("deliverable_versions", version.id, "file");
    expect(own).toMatchObject({ filename: "box.png", inline: true });
    expect(await own.blob.text()).toBe("png");
    const other = world.rows.clients.find((c) => c.id !== deliverable["client_id"])!;
    await expect(world.portal(other.id).file!("deliverable_versions", version.id, "file")).rejects.toMatchObject({ code: "PUBLIC_REF_NOT_FOUND" });

    const view = await world.portal(other.id).openHandover(String(project["share_token"]));
    expect((await view.file!("deliverable_versions", version.id, "file")).filename).toBe("box.png");
    // A file the demo never received is not found, never an empty page.
    const another = world.rows.deliverable_versions.find((v) => v.id !== version.id)!;
    await expect(world.portal(another["client_id"] as number).file!("deliverable_versions", another.id, "file")).rejects.toMatchObject({ code: expect.stringMatching(/NOT_FOUND/) });
  });

  it("serves the payment details once the studio writes them", async () => {
    const world = fresh();
    const port = world.portal(world.rows.clients[0]!.id);
    expect(await port.paymentInstructions!()).toBeNull();
    await world.writes.saveAddOnSettings!("invoices", { payment_instructions: "Bank transfer, reference the invoice number." });
    expect(await port.paymentInstructions!()).toBe("Bank transfer, reference the invoice number.");
  });
});
