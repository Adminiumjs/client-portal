import { describe, expect, it } from "vitest";

import { LIVE_TABLES, startLive, type LiveFrame } from "./live.ts";
import { TABLE_OF_REF } from "./tableOfRef.ts";

class FakeSource {
  url: string;
  listeners = new Map<string, ((event: MessageEvent) => void)[]>();
  onerror: ((event: Event) => void) | null = null;
  onopen: ((event: Event) => void) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
  }
  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  emit(type: string, data: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener({ data: typeof data === "string" ? data : JSON.stringify(data) } as MessageEvent);
  }
  close() {
    this.closed = true;
  }
}

async function follow() {
  let source!: FakeSource;
  const frames: LiveFrame[] = [];
  let reconnects = 0;
  const stop = await startLive({
    transport: { connection: async () => "conn-1", tableId: async (name) => `public.${name}` },
    tables: { ...TABLE_OF_REF, invoices: "studio7_invoices" },
    onFrame: (frame) => frames.push(frame),
    onReconnect: () => {
      reconnects += 1;
    },
    createSource: (url) => (source = new FakeSource(url)),
  });
  return { source, frames, stop, reconnects: () => reconnects };
}

describe("live updates", () => {
  it("follows every table the desk holds on one stream, by their real names", async () => {
    const { source } = await follow();
    const channels = decodeURIComponent(source.url.split("channels=")[1]!).split(",");
    expect(channels).toHaveLength(LIVE_TABLES.length);
    expect(channels).toContain("widget-data:conn-1:public.studio7_invoices");
    expect(channels).toContain("widget-data:conn-1:public.clients_payments");
    // Payments move an invoice's balance, lines its totals, without a frame for the document.
    for (const ref of ["payments", "invoice_lines", "proposal_lines", "messages", "deliverable_notes"] as const) expect(LIVE_TABLES).toContain(ref);
  });

  it("leaves out the tables the person may not read (the stream would refuse them)", async () => {
    let source!: FakeSource;
    await startLive({
      transport: { connection: async () => "conn-1", tableId: async (name) => `public.${name}` },
      tables: TABLE_OF_REF,
      readable: (ref) => !["payments", "client_notes", "messages"].includes(ref),
      onFrame: () => undefined,
      onReconnect: () => undefined,
      createSource: (url) => (source = new FakeSource(url)),
    });
    const channels = decodeURIComponent(source.url.split("channels=")[1]!).split(",");
    expect(channels).toHaveLength(LIVE_TABLES.length - 3);
    expect(channels.some((c) => c.endsWith("clients_payments"))).toBe(false);
  });

  it("hands on each change with its table, its kind and its key — never the streamed row", async () => {
    const { source, frames } = await follow();
    source.emit("record.update", {
      channel: "widget-data:conn-1:public.studio7_invoices",
      data: { pk: { id: 51 }, row: { id: 51, status: "sent", balance: null } },
    });
    source.emit("record.delete", { channel: "widget-data:conn-1:public.clients_payments", data: { pk: { id: 7 }, row: null } });
    expect(frames).toEqual([
      { table: "invoices", kind: "record.update", id: 51 },
      { table: "payments", kind: "record.delete", id: 7 },
    ]);
  });

  it("ignores frames for other channels, frames it cannot read, and keys that are not ids", async () => {
    const { source, frames } = await follow();
    source.emit("record.create", { channel: "widget-data:conn-1:public.pos_tickets", data: { pk: { id: 1 } } });
    source.emit("record.create", "{not json");
    source.emit("record.create", { channel: "widget-data:conn-1:public.clients_clients", data: { pk: null } });
    expect(frames).toEqual([{ table: "clients", kind: "record.create", id: null }]);
  });

  it("asks for a fresh read after the connection comes back, not on the first open", async () => {
    const { source, reconnects, stop } = await follow();
    source.onopen?.(new Event("open"));
    expect(reconnects()).toBe(0);
    source.onerror?.(new Event("error"));
    source.onopen?.(new Event("open"));
    expect(reconnects()).toBe(1);
    stop();
    expect(source.closed).toBe(true);
  });
});
