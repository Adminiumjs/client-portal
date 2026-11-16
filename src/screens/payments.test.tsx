/**
 * Paying online, on both sides, drawn from the hand studio.
 *
 *   the client's invoice   payments off reads as it always has (no "Pay
 *                          now", greyed or otherwise); on, "Pay {balance}
 *                          now" sits beside How to pay and "I've sent a
 *                          payment"; the hand-off, the check on coming back
 *                          and a payment that did not start; the rehearsal
 *                          band; "Paid online · receipt emailed", never card
 *                          details; the studio's preview offers nothing
 *   the demo's stand-in    takes what is owed as a payment made online: the
 *                          invoice reads paid, the client's "I've sent a
 *                          payment" clears as a recorded payment clears it,
 *                          and the receipt waits in the outbox
 *   the desk's invoice     "Copy pay link" only while clients can pay online
 *                          and the person may change invoices; a payment
 *                          made online says "Online · {service}", is never
 *                          voided, and has "Refund…" only for someone who may
 *                          refund; what was refunded is a line of its own and
 *                          the balance goes back up by it
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../i18n/index.tsx";
import { fakeStudio, type FakeStudio } from "../testing/fakeStudio.ts";
import { loadInvoice, useDesk } from "../state/desk.ts";
import { setDeskPayments, useDeskPayments } from "../state/deskPayments.ts";
import { afterPaying, checkPayments, loadPayOnline, noticeConfirming, payNow, useClientPay } from "../state/clientPay.ts";
import type { PayState } from "../data/ports.ts";
import { loadClientInvoice, loadPortal, loadStudio, previewFromDesk, setPortalPort, usePortal } from "../state/portal.ts";
import { useSheets } from "../state/sheets.ts";
import { useUi } from "../state/ui.ts";
import ClientInvoice from "./client/Invoice.tsx";
import Invoice from "./Invoice.tsx";
import { ledger } from "./invoices/figures.ts";

let studio: FakeStudio;

function current(): void {
  for (const store of [useDesk, usePortal, useUi, useSheets, useClientPay, useDeskPayments] as unknown as { getState: () => object; getInitialState: () => object }[]) {
    Object.assign(store.getInitialState(), store.getState());
  }
}
const draw = (node: React.ReactNode): string => {
  current();
  return renderToStaticMarkup(<I18nProvider>{node}</I18nProvider>);
};
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ");
const select = (id: number) => useUi.setState((s) => ({ selected: { ...s.selected, invoice: id } }));

async function signIn(clientId: number): Promise<void> {
  setPortalPort(studio.world.portal(clientId));
  useUi.setState({ persona: "client", view: "invoice", preview: null, toasts: [] });
  await Promise.all([loadStudio(true), loadPortal()]);
}

async function clientPage(clientId: number, invoiceId: number): Promise<string> {
  await signIn(clientId);
  select(invoiceId);
  await loadClientInvoice(invoiceId);
  return text(draw(<ClientInvoice />));
}

beforeEach(async () => {
  studio = await fakeStudio();
  useClientPay.setState({ online: null, flow: {} });
  setDeskPayments(null, null);
});

describe("the client's invoice", () => {
  it("payments off: no Pay now at all, and How to pay and I've sent a payment as always", async () => {
    useClientPay.setState({ online: { online: false, test: false } });
    const page = await clientPage(3, 5);
    expect(page).not.toMatch(/Pay \$[\d,.]+ now/);
    expect(page).not.toContain("Stripe");
    expect(page).toContain("How to pay");
    expect(page).toContain("Reference: INV-2039");
    expect(page).toContain("I’ve sent a payment");
    // Nothing is greyed: the button is not there at all.
    expect(draw(<ClientInvoice />)).not.toContain("cl-pay-now");
  });

  it("payments on: Pay {balance} now beside the other ways, the balance not the total", async () => {
    useClientPay.setState({ online: { online: true, test: false } });
    const page = await clientPage(3, 5);
    const inv = usePortal.getState().rows.invoices[5]!;
    expect(inv.balance).not.toBe(inv.total);
    expect(page).toMatch(/Pay \$[\d,.]+ now/);
    expect(page).toContain(`Pay $${Number(inv.balance).toLocaleString("en-US", { minimumFractionDigits: 2 })} now`);
    expect(page).toContain("You’ll pay on the Stripe or PayPal page. Part payments are fine by bank transfer.");
    expect(page).toContain("How to pay");
    expect(page).toContain("I’ve sent a payment");
    expect(page).not.toContain("Test mode");
    // The amount sits in the money face, inside one translated sentence.
    expect(draw(<ClientInvoice />)).toMatch(/Pay <span class="money">\$[\d,.]+<\/span> now/);
  });

  it("a paid invoice offers nothing to pay, online or otherwise", async () => {
    useClientPay.setState({ online: { online: true, test: false } });
    const page = await clientPage(2, 2);
    expect(page).not.toMatch(/Pay \$[\d,.]+ now/);
    expect(page).toContain("There is nothing to pay.");
  });

  it("the rehearsal band shows only to the person rehearsing", async () => {
    useClientPay.setState({ online: { online: true, test: true } });
    const page = await clientPage(3, 5);
    expect(page).toContain("Test mode — only you see this. No money moves. This invoice is sample data and goes when you remove sample data.");
  });

  it("the hand-off, the check on coming back, and a payment that did not start", async () => {
    useClientPay.setState({ online: { online: true, test: false } });
    await clientPage(3, 5);
    useClientPay.setState({ flow: { 5: "taking" } });
    let page = text(draw(<ClientInvoice />));
    expect(page).toContain("Taking you to the secure payment page…");
    expect(page).toContain("You’ll pay on the Stripe or PayPal page.");
    expect(page).not.toMatch(/Pay \$[\d,.]+ now/);

    useClientPay.setState({ flow: { 5: "checking" } });
    page = text(draw(<ClientInvoice />));
    expect(page).toContain("Checking your payment…");
    expect(page).not.toContain("How to pay");
    expect(page).not.toContain("I’ve sent a payment");

    useClientPay.setState({ flow: { 5: "failed" } });
    page = text(draw(<ClientInvoice />));
    expect(page).toContain("The payment didn’t finish. Nothing was taken.");
    expect(page).toContain("You can try again, or pay by bank transfer below.");
    expect(page).toMatch(/Pay \$[\d,.]+ now/);
    expect(page).toContain("How to pay");
  });

  it("Pay now opens the pay page in its own tab and checks the invoice when the client comes back", async () => {
    await signIn(2);
    const port = studio.world.portal(2);
    let opened: string | null = null;
    setPortalPort({ ...port, payOnline: async () => ({ online: true, test: false }), payInvoice: async () => ({ payUrl: "https://studio.example/pay/AbCdEf" }) });
    await loadPayOnline();
    expect(await payNow(2, { openTab: async (link) => ((opened = await link()), true) })).toBe("away");
    expect(opened).toBe("https://studio.example/pay/AbCdEf");
    expect(useClientPay.getState().flow[2]).toBe("checking");
    await checkPayments();
    expect(useClientPay.getState().flow[2]).toBe("idle");
  });

  it("a tab that did not open, or a refusal, leaves the other ways and says nothing was taken", async () => {
    await signIn(2);
    const port = studio.world.portal(2);
    setPortalPort({ ...port, payOnline: async () => ({ online: true, test: false }), payInvoice: async () => ({ payUrl: "https://studio.example/pay/x" }) });
    expect(await payNow(2, { openTab: async () => false })).toBe("failed");
    expect(useClientPay.getState().flow[2]).toBe("failed");
  });

  it("says Paid online and a receipt went, never a card's brand or digits", async () => {
    useClientPay.setState({ online: { online: true, test: false } });
    await signIn(3);
    await studio.world.portal(3).payInvoice!(5);
    await loadClientInvoice(5);
    select(5);
    const page = text(draw(<ClientInvoice />));
    expect(page).toContain("was settled on");
    expect(page).toContain("Paid online · receipt emailed");
    expect(page).not.toMatch(/••|Visa|4242/);
    // The ledger names the way it was paid: online.
    expect(page).toContain("Online");
  });

  it("the bank confirming a payment: said, and nothing offers to pay again, by Stripe or by bank transfer", async () => {
    useClientPay.setState({ online: { online: true, test: false } });
    await clientPage(3, 5);
    useClientPay.setState({ flow: { 5: "confirming" } });
    const page = text(draw(<ClientInvoice />));
    expect(page).toContain("Your bank is confirming the payment");
    expect(page).toContain("Some ways to pay take a few days. Please don’t pay again. We’ll email you when it’s confirmed.");
    expect(page).not.toMatch(/Pay \$[\d,.]+ now/);
    expect(page).not.toContain("How to pay");
    expect(page).not.toContain("I’ve sent a payment");
  });

  it("the time on the pay page ran out: said, and every way to pay is back", async () => {
    useClientPay.setState({ online: { online: true, test: false } });
    await clientPage(3, 5);
    useClientPay.setState({ flow: { 5: "expired" } });
    const page = text(draw(<ClientInvoice />));
    expect(page).toContain("The time to pay on that page ran out. Nothing was taken.");
    expect(page).toContain("You can try again, or pay by bank transfer below.");
    expect(page).not.toContain("didn’t finish");
    expect(page).toMatch(/Pay \$[\d,.]+ now/);
    expect(page).toContain("How to pay");
    expect(page).toContain("I’ve sent a payment");
  });

  it("a paid invoice reads paid whatever its last payment's state", async () => {
    useClientPay.setState({ online: { online: true, test: false } });
    await clientPage(2, 2);
    for (const flow of ["confirming", "expired", "failed"] as const) {
      useClientPay.setState({ flow: { 2: flow } });
      const page = text(draw(<ClientInvoice />));
      expect(page, flow).toContain("There is nothing to pay.");
      expect(page, flow).not.toContain("Your bank is confirming");
      expect(page, flow).not.toContain("Nothing was taken");
    }
  });

  it("what the page does with Adminium's word on coming back", () => {
    // Owed: said, looked for again, or the page as it reads.
    expect(afterPaying("confirming", true)).toBe("confirming");
    expect(afterPaying("failed", true)).toBe("failed");
    expect(afterPaying("expired", true)).toBe("expired");
    expect(afterPaying("none", true)).toBe("idle");
    expect(afterPaying("open", true)).toBe("look");
    expect(afterPaying("paid", true)).toBe("look");
    expect(afterPaying("unknown", true)).toBe("look");
    // Nothing owed: the invoice says it is paid, whatever the word.
    for (const said of ["none", "open", "confirming", "paid", "failed", "expired", "unknown"] as const) expect(afterPaying(said, false), said).toBe("idle");
  });

  it("back from the pay page: Adminium's word, looked for again while the service has not said", async () => {
    await signIn(3);
    select(5);
    useClientPay.setState({ online: { online: true, test: false } });
    const port = studio.world.portal(3);
    const answers = (said: PayState[]) => {
      const asked: number[] = [];
      setPortalPort({ ...port, payState: async (id) => (asked.push(id), said.length > 1 ? said.shift()! : said[0]!) });
      return asked;
    };
    const pauses: number[] = [];
    const pause = async (ms: number) => void pauses.push(ms);
    for (const [said, flow] of [["confirming", "confirming"], ["failed", "failed"], ["expired", "expired"], ["none", "idle"]] as const) {
      const asked = answers([said]);
      useClientPay.setState({ flow: { 5: "checking" } });
      await checkPayments(pause);
      expect(useClientPay.getState().flow[5], said).toBe(flow);
      expect(asked).toEqual([5]);
    }
    // Still open at the service: asked again, and the answer when it comes.
    pauses.length = 0;
    answers(["open", "open", "failed"]);
    useClientPay.setState({ flow: { 5: "checking" } });
    await checkPayments(pause);
    expect(useClientPay.getState().flow[5]).toBe("failed");
    expect(pauses).toEqual([2000, 2000]);
    // Open all along (the pay page left open in its tab): a few looks, then Pay now again (it opens the same checkout).
    pauses.length = 0;
    answers(["open"]);
    useClientPay.setState({ flow: { 5: "checking" } });
    await checkPayments(pause);
    expect(useClientPay.getState().flow[5]).toBe("idle");
    expect(pauses).toHaveLength(5);
    // The money arrived and is not recorded yet: looked for longer, never offered again meanwhile.
    pauses.length = 0;
    answers(["paid"]);
    useClientPay.setState({ flow: { 5: "checking" } });
    await checkPayments(pause);
    expect(pauses).toHaveLength(29);
  });

  it("opened again while the bank confirms a payment: said, until the bank has answered", async () => {
    await signIn(3);
    select(5);
    await loadClientInvoice(5);
    const port = studio.world.portal(3);
    let said: PayState = "confirming";
    setPortalPort({ ...port, payState: async () => said });
    // Not offered online: nothing asked, nothing said.
    useClientPay.setState({ online: { online: false, test: false }, flow: {} });
    await noticeConfirming(5);
    expect(useClientPay.getState().flow[5]).toBeUndefined();
    useClientPay.setState({ online: { online: true, test: false } });
    await noticeConfirming(5);
    expect(useClientPay.getState().flow[5]).toBe("confirming");
    // The bank turned it down: the page as the invoice reads, Pay now with it.
    said = "failed";
    await noticeConfirming(5);
    expect(useClientPay.getState().flow[5]).toBe("idle");
    // A flow the page is following is its own.
    said = "confirming";
    useClientPay.setState({ flow: { 5: "taking" } });
    await noticeConfirming(5);
    expect(useClientPay.getState().flow[5]).toBe("taking");
  });

  it("the studio's preview never offers Pay now", async () => {
    await signIn(3);
    previewFromDesk(useDesk.getState().rows, 3, usePortal.getState().studio!);
    useUi.setState({ preview: { clientId: 3, back: "client" } });
    await loadPayOnline();
    expect(useClientPay.getState().online).toBeNull();
    select(5);
    expect(text(draw(<ClientInvoice />))).not.toMatch(/Pay \$[\d,.]+ now/);
    useUi.setState({ preview: null });
  });
});

describe("the demo's stand-in", () => {
  it("takes what is owed as a payment made online: paid, the client's word cleared, the receipt waiting", async () => {
    await signIn(2);
    const before = studio.world.rows.invoices.find((i) => i.id === 3)!;
    expect(before["client_paid"]).toBe(true);
    const balance = String(before["balance"]);
    await loadPayOnline();
    expect(useClientPay.getState().online).toMatchObject({ online: true, standIn: true });
    expect(await payNow(3, { openTab: async () => false })).toBe("paid");
    const after = studio.world.rows.invoices.find((i) => i.id === 3)!;
    expect(Number(after["balance"])).toBe(0);
    // A payment recorded online clears "I've sent a payment" as one the studio records does.
    expect(after["client_paid"] ?? null).toBeNull();
    expect(after["client_paid_at"] ?? null).toBeNull();
    const payment = studio.world.rows.payments.filter((p) => p["document_id"] === 3).at(-1)!;
    expect(payment).toMatchObject({ method: "online", provider: "Demo", amount: balance });
    expect(String(payment["payment_ref"])).toMatch(/^demo_/);
    expect(studio.world.rows.messages.some((m) => m["kind"] === "payment-receipt" && m["payment_id"] === payment.id)).toBe(true);
    // Nothing left to pay: asked again, it is refused.
    await expect(studio.world.portal(2).payInvoice!(3)).rejects.toMatchObject({ code: "PUBLIC_PAY_REFUSED" });
  });

  it("never pays another client's invoice", async () => {
    await expect(studio.world.portal(1).payInvoice!(3)).rejects.toMatchObject({ code: "PUBLIC_REF_NOT_FOUND" });
  });
});

describe("the desk's invoice", () => {
  async function deskPage(id: number): Promise<string> {
    useUi.setState({ persona: "studio", view: "invoice", preview: null });
    await loadInvoice(id);
    select(id);
    return text(draw(<Invoice />));
  }
  const kit = { contract: 1, entry: "/assets/kit/kit-AbC123.js" };

  it("payments off, or a server that says nothing: no Copy pay link, no chip, the desk as it always was", async () => {
    let page = await deskPage(5);
    expect(page).not.toContain("Copy pay link");
    setDeskPayments({ on: false, online: false, test: false, refund: true }, kit);
    page = await deskPage(5);
    expect(page).not.toContain("Copy pay link");
    expect(page).toContain("Record payment");
  });

  it("Copy pay link while clients can pay online (or this person rehearses), for someone who may change invoices", async () => {
    setDeskPayments({ on: true, online: true, test: false, refund: false }, kit);
    expect(await deskPage(5)).toContain("Copy pay link");
    setDeskPayments({ on: true, online: false, test: true, refund: false }, kit);
    expect(await deskPage(5)).toContain("Copy pay link");
    // Never on a paid invoice.
    expect(await deskPage(2)).not.toContain("Copy pay link");
    useDesk.setState({ me: { ...useDesk.getState().me, access: { tables: { invoices: ["read"] }, roles: [{ slug: "studio", name: "Studio" }] } } });
    expect(await deskPage(5)).not.toContain("Copy pay link");
  });

  it("a payment made online says so, is never voided, and is refunded only by someone who may", async () => {
    await studio.world.portal(3).payInvoice!(5);
    setDeskPayments({ on: true, online: true, test: false, refund: false }, kit);
    let page = await deskPage(5);
    expect(page).toContain("Online · Demo");
    expect(page).not.toContain("Refund…");
    // The payment the studio recorded keeps its Void; the one made online has none.
    const html = draw(<Invoice />);
    expect(html).toContain('aria-label="Void the $300.00 payment of Jun 20"');
    expect(html).not.toContain('aria-label="Void the $741.60 payment');
    expect(page.match(/Void…/g)?.length).toBe(1);
    setDeskPayments({ on: true, online: true, test: false, refund: true }, kit);
    page = await deskPage(5);
    expect(page).toContain("Refund…");
    expect(draw(<Invoice />)).toContain('aria-label="Refund the $741.60 payment of Jul 28"');
    // No kit on this server: no Refund here (the payment panel in Adminium still refunds).
    setDeskPayments({ on: true, online: true, test: false, refund: true }, null);
    expect(await deskPage(5)).not.toContain("Refund…");
  });

  it("what was refunded is a line under its payment, and the balance goes back up by it", async () => {
    await studio.world.portal(3).payInvoice!(5);
    const online = studio.world.rows.payments.filter((p) => p["document_id"] === 5 && p["provider"] === "Demo")[0]!;
    await studio.world.writes.update("payments", online.id, { refunded_amount: "100.00" });
    setDeskPayments({ on: true, online: true, test: false, refund: true }, kit);
    const page = await deskPage(5);
    expect(page).toContain("Refunded");
    expect(page).toMatch(/Refund Online · Demo .* \+\$100\.00/);
    const inv = useDesk.getState().rows.invoices[5]!;
    expect(inv.balance).toBe("100.00");
    const rows = ledger(inv, Object.values(useDesk.getState().rows.payments));
    const refund = rows.find((r) => r.kind === "refund");
    expect(refund).toMatchObject({ kind: "refund", amount: "100.00", balance: "100.00" });
  });
});
