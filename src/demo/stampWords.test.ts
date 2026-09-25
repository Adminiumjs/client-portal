/**
 * A stamp that differs by who writes it (`byOrigin`) may name a time word: a
 * client's approval is stamped with the studio's day, never the text "today".
 */
import { describe, expect, it } from "vitest";

import { DEMO_START, DEMO_ZONE } from "../lib/clock.ts";
import { venueDay } from "../data/venueTime.ts";
import { demoSample } from "./sample.ts";
import { createWorld } from "./world.ts";

describe("a stamp by origin", () => {
  it("stamps a client's approval with the studio's day", async () => {
    const world = createWorld(demoSample("en-US"), () => DEMO_START, DEMO_ZONE, { name: "Nadia Cole" });
    const waiting = world.rows.deliverables.find((d) => d["status"] === "pending")!;
    const approved = await world.portal(waiting["client_id"] as number).review(waiting.id, "approved", null);
    expect(approved.approved_on).toBe(venueDay(DEMO_START, DEMO_ZONE));
  });
});
