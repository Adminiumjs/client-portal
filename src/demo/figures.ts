/**
 * The Overview's figures, worked out from rows alone — the arithmetic the
 * sample's own test holds the bundle to at 10:00 on Tuesday 28 July 2026
 * (`data/sample-figures.test.ts`), repeated here so the demo's world can be
 * held to the same figures, at that moment and after the card moves it on.
 *
 * "Owing" is a sent invoice with a balance, "overdue" one due before the
 * studio's today, a month a calendar month on the studio's clock, the week
 * Monday to Sunday. Money comes out as numbers, however the rows spell it.
 *
 * DEMO BUILD ONLY (and its tests).
 */
type Row = Record<string, unknown>;
type Rows = Readonly<Record<string, readonly Row[]>>;

const DAY = 86_400_000;
const money = (n: number) => Math.round(n * 100) / 100;
const sum = (rows: readonly Row[], column: string) => money(rows.reduce((total, row) => total + Number(row[column]), 0));
const daysFrom = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
const shiftDay = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const monthOf = (day: string) => day.slice(0, 7);
const monthsBack = (day: string, back: number) => {
  const [y, m] = day.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 - back, 1)).toISOString().slice(0, 7);
};

export function overview(rows: Rows, now: number, zone: string) {
  /** A date (`YYYY-MM-DD`) or an instant, as the day it falls on in the studio's zone. */
  const studioDay = (value: unknown) => (String(value).length === 10 ? String(value) : new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(new Date(String(value))));
  const today = studioDay(new Date(now).toISOString());
  const company = (id: unknown) => String(rows["clients"]!.find((c) => String(c["id"]) === String(id))!["company"]);
  const invoices = rows["invoices"]!;
  const owing = invoices.filter((i) => i["status"] === "sent" && Number(i["balance"]) > 0);
  const late = (i: Row) => daysFrom(String(i["due_on"]), today);
  const overdue = owing.filter((i) => late(i) > 0);
  const band = (from: number, to: number) => owing.filter((i) => late(i) >= from && late(i) <= to);
  const payments = rows["payments"]!.filter((p) => p["voided"] !== true);
  const thisMonth = payments.filter((p) => monthOf(String(p["paid_on"])) === monthOf(today));
  const waiting = rows["proposals"]!.filter((p) => p["status"] === "sent" && String(p["valid_until"]) >= today);
  const projects = rows["projects"]!;
  const rungs = rows["messages"]!.filter((m) => String(m["kind"]).startsWith("invoice-rung-"));
  const held = rungs.filter((m) => m["status"] === "held");
  const ready = held.filter((m) => Date.parse(String(m["due"])) <= now);
  const months = [5, 4, 3, 2, 1, 0].map((back) => monthsBack(today, back));
  const sent = invoices.filter((i) => i["status"] === "sent");
  const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  const monday = shiftDay(today, -weekday);
  const sunday = shiftDay(monday, 6);
  const inWeek = (day: unknown) => String(day) >= monday && String(day) <= sunday;
  const milestones = rows["milestones"]!;
  const invoiceOf = (m: Row) => invoices.find((i) => String(i["id"]) === String(m["invoice_id"]))!;
  return {
    today,
    outstanding: { amount: sum(owing, "balance"), invoices: owing.length },
    overdue: { amount: sum(overdue, "balance"), invoices: overdue.length, oldestDays: Math.max(...overdue.map(late)) },
    collectedThisMonth: { amount: sum(thisMonth, "amount"), payments: thisMonth.length, methods: [...new Set(thisMonth.map((p) => p["method"]))] },
    proposalsWaiting: { amount: sum(waiting, "total"), proposals: waiting.length, holdsUntil: waiting.map((p) => String(p["valid_until"])).sort()[0] },
    projects: {
      active: projects.filter((p) => p["status"] === "active").length,
      paused: projects.filter((p) => p["status"] === "paused").length,
      doneThisMonth: projects.filter((p) => p["status"] === "done" && monthOf(String(p["done_on"])) === monthOf(today)).length,
    },
    aging: {
      notYetDue: { amount: sum(band(-Infinity, 0), "balance"), invoices: band(-Infinity, 0).length },
      days1to30: { amount: sum(band(1, 30), "balance"), invoices: band(1, 30).length },
      days31to60: { amount: sum(band(31, 60), "balance"), invoices: band(31, 60).length },
      over60: { amount: sum(band(61, 3650), "balance"), invoices: band(61, 3650).length },
    },
    needs: {
      chaseReady: ready.map((m) => ({ invoice: invoiceOf(m)["number"], client: company(invoiceOf(m)["client_id"]), daysLate: late(invoiceOf(m)), rung: m["kind"] })),
      chaseHeld: held.length,
      clientSaysPaid: owing.filter((i) => i["client_paid_at"] !== null).map((i) => ({ invoice: i["number"], client: company(i["client_id"]), balance: Number(i["balance"]) })),
      changesAsked: rows["deliverables"]!.filter((d) => d["status"] === "changes").map((d) => ({ title: d["title"], client: company(d["client_id"]) })),
      newEnquiries: rows["enquiries"]!.filter((e) => e["status"] === "new").length,
    },
    chart: months.map((month) => ({
      month,
      invoiced: sum(sent.filter((i) => monthOf(String(i["issued_on"])) === month), "total"),
      invoices: sent.filter((i) => monthOf(String(i["issued_on"])) === month).length,
      collected: sum(payments.filter((p) => monthOf(String(p["paid_on"])) === month), "amount"),
      payments: payments.filter((p) => monthOf(String(p["paid_on"])) === month).length,
    })),
    waitingOnClient: {
      proposals: waiting.map((p) => [p["number"], company(p["client_id"]), p["valid_until"]]),
      files: rows["deliverables"]!
        .filter((d) => d["status"] === "pending")
        .sort((a, b) => String(a["shared_at"]).localeCompare(String(b["shared_at"])))
        .map((d) => [d["title"], company(d["client_id"]), studioDay(d["shared_at"])]),
      overdue: [...overdue].sort((a, b) => String(a["due_on"]).localeCompare(String(b["due_on"]))).map((i) => [i["number"], company(i["client_id"]), i["due_on"], Number(i["balance"])]),
    },
    thisWeek: {
      monday,
      sunday,
      milestones: milestones
        .filter((m) => m["state"] !== "done" && inWeek(m["due_on"]))
        .sort((a, b) => String(a["due_on"]).localeCompare(String(b["due_on"])))
        .map((m) => [m["title"], company(m["client_id"]), m["due_on"]]),
      invoicesDue: owing.filter((i) => inWeek(i["due_on"])).map((i) => i["number"]),
      nextInvoiceDue: owing
        .filter((i) => String(i["due_on"]) > sunday)
        .sort((a, b) => String(a["due_on"]).localeCompare(String(b["due_on"])))
        .map((i) => [i["number"], company(i["client_id"]), i["due_on"]])[0],
    },
    workInProgress: projects
      .filter((p) => p["status"] === "active" || p["status"] === "paused")
      .map((p) => {
        const own = milestones.filter((m) => String(m["project_id"]) === String(p["id"]));
        const next = own.filter((m) => m["state"] !== "done").sort((a, b) => String(a["due_on"]).localeCompare(String(b["due_on"])))[0];
        return {
          project: p["name"],
          client: company(p["client_id"]),
          status: p["status"],
          done: `${String(own.filter((m) => m["state"] === "done").length)} of ${String(own.length)}`,
          next: p["status"] === "active" ? [next?.["title"], next?.["due_on"]] : null,
          note: p["pause_note"],
        };
      }),
    chasing: [...owing]
      .sort((a, b) => late(b) - late(a))
      .map((i) => {
        const own = rungs.filter((m) => String(m["invoice_id"]) === String(i["id"])).sort((a, b) => String(a["kind"]).localeCompare(String(b["kind"])));
        const waitingRung = own.find((m) => m["status"] === "held" && Date.parse(String(m["due"])) <= now);
        const nextRung = own.find((m) => m["status"] === "held" && Date.parse(String(m["due"])) > now);
        return {
          invoice: i["number"],
          client: company(i["client_id"]),
          daysLate: late(i),
          balance: Number(i["balance"]),
          rungs: own.map((m) => m["status"]),
          ready: waitingRung?.["kind"] ?? null,
          next: nextRung === undefined ? null : [nextRung["kind"], studioDay(nextRung["due"])],
        };
      }),
    nextWake: held
      .filter((m) => Date.parse(String(m["due"])) > now)
      .sort((a, b) => String(a["due"]).localeCompare(String(b["due"])))
      .map((m) => [invoiceOf(m)["number"], m["kind"], studioDay(m["due"])])[0],
  };
}

export type Overview = ReturnType<typeof overview>;
