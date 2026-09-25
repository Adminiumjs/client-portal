/**
 * A studio for tests: the demo's stand-in world over the sample rows, with a
 * sink that RECORDS every write (its table, its body, its order) and can be
 * told to drop the answer to its n-th write, the way a lost network does —
 * after the write happened on the server, or before it.
 *
 * Tests only; nothing that ships imports it.
 */
import { DEMO_ROWS } from "../data/demo.ts";
import type { DeskWrites } from "../data/ports.ts";
import { SinkError } from "../data/sink.ts";
import type { Id, TableRef } from "../data/types.ts";
import { createWorld, type DemoWorld } from "../demo/world.ts";
import { DEMO_START, DEMO_ZONE, setClockSource, setZone } from "../lib/clock.ts";
import { loadDesk, resetDesk, setDeskReads, setDeskWrites, useDesk } from "../state/desk.ts";
import { resetPortal, setPortalPort } from "../state/portal.ts";
import { useSheets } from "../state/sheets.ts";
import { useUi } from "../state/ui.ts";

export interface Write {
  op: "insert" | "update" | "remove" | "upload" | "regenerate" | "settings";
  table: TableRef | "add-on";
  id?: Id;
  values?: Record<string, unknown>;
}

export interface FakeStudio {
  world: DemoWorld;
  writes: Write[];
  /** Drop the answer to the n-th write from now: `"after"` it saved (the answer was lost), `"before"` it reached the server. */
  failWrite(n: number, when?: "before" | "after"): void;
  /** Move the clock the world and the desk read (epoch ms): time passing, a clock left running. */
  setNow(at: number): void;
}

export async function fakeStudio(opts: { at?: number } = {}): Promise<FakeStudio> {
  let at = opts.at ?? DEMO_START;
  setZone(DEMO_ZONE);
  setClockSource(() => at);
  const world = createWorld(DEMO_ROWS, () => at, DEMO_ZONE, { name: "Nadia Cole" });
  const writes: Write[] = [];
  let countdown = 0;
  let when: "before" | "after" = "before";
  const lost = () => new SinkError("no answer", "offline", 0, "NETWORK");
  const around = async <T>(write: Write, run: () => Promise<T>): Promise<T> => {
    writes.push(write);
    if (countdown > 0) {
      countdown -= 1;
      if (countdown === 0) {
        if (when === "before") throw lost();
        await run();
        throw lost();
      }
    }
    return run();
  };
  const sink: DeskWrites = {
    insert: (ref, values) => around({ op: "insert", table: ref, values }, () => world.writes.insert(ref, values)),
    update: (ref, id, patch) => around({ op: "update", table: ref, id, values: patch }, () => world.writes.update(ref, id, patch)),
    remove: (ref, id) => around({ op: "remove", table: ref, id }, () => world.writes.remove(ref, id)),
    upload: (ref, column, file, filename) => around({ op: "upload", table: ref, values: { column, filename } }, () => world.writes.upload(ref, column, file, filename)),
    regenerateCode: (ref, id, column) => around({ op: "regenerate", table: ref, id, values: { column } }, () => world.writes.regenerateCode(ref, id, column)),
    saveAddOnSettings: (key, values) => around({ op: "settings", table: "add-on", values: { key, ...values } }, () => world.writes.saveAddOnSettings(key, values)),
    // A read, recorded as nothing; only where the world keeps the add-on's settings.
    ...(world.writes.addOnSettings === undefined ? {} : { addOnSettings: (key: string) => world.writes.addOnSettings!(key) }),
  };
  resetDesk();
  resetPortal();
  useUi.setState({ persona: "studio", view: "home", preview: null, signedOut: false, toasts: [] });
  useSheets.setState({ open: null, draft: {}, unfinished: null, busy: false });
  setDeskReads(world.reads);
  setDeskWrites(sink);
  setPortalPort(world.portal(1));
  useDesk.setState({ me: { name: "Nadia Cole", email: "nadia@outline.example", roleName: "Studio manager", manager: true, access: null } });
  await loadDesk();
  return {
    world,
    writes,
    failWrite(n, w = "before") {
      countdown = n;
      when = w;
    },
    setNow(moment) {
      at = moment;
    },
  };
}

/** The rows of a table the world holds now. */
export const tableOf = (studio: FakeStudio, ref: TableRef) => studio.world.rows[ref] as Record<string, unknown>[];
