/**
 * What a refusal means for the person on the page.
 *
 * `STATE_MOVE_REFUSED` is two refusals with one code: a row that moved on
 * since it was drawn (a state's move, named with `from` and `to`), and a
 * message refused for what it carries (the outbox, naming a column). Only the
 * first is "someone changed this a moment ago".
 */
import { describe, expect, it } from "vitest";

import { SinkError } from "../data/sink.ts";
import { refusalOf } from "./outcome.ts";

const refused = (details: Record<string, unknown>, field: string | null = null) => refusalOf(new SinkError("refused", "refused", 409, "STATE_MOVE_REFUSED", field, details));

describe("a refused write", () => {
  it("says the row moved on only when a state's move was refused", () => {
    expect(refused({ column: "status", from: "sent", to: "draft" })).toMatchObject({ ok: false, reason: "moved" });
    expect(refused({ column: "status", requires: "proposal_lines" })).toMatchObject({ ok: false, reason: "empty" });
  });

  it("names the field when a message was refused for what it carries", () => {
    // A reply to an enquiry was refused for its wording, and the desk was told somebody else had changed it.
    expect(refused({ column: "body_override" })).toMatchObject({ ok: false, reason: "invalid", field: "body_override" });
    expect(refused({ column: "to" }, "to")).toMatchObject({ ok: false, reason: "invalid", field: "to" });
  });
});
