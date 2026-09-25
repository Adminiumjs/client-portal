/**
 * A document drawn on white paper from the stored rows — what the printed
 * copy shows when Adminium's own rendering of it cannot be asked for.
 *
 * The anatomy is the add-on's: the letterhead and who it is from; who it is
 * to and the document's facts; its title; a quote's scope; the lines (or a
 * statement's entries) and the stored totals; the payments so far and the
 * amount due; a quote's signature record; how to pay (or how it gets paid);
 * the terms, and who prepared it. A void invoice is marked VOID across the
 * sheet, with the day it was voided and never the reason, which is the
 * studio's alone. Every amount is a stored one; a receipt's "balance left" and
 * a statement's running figures add stored amounts for display only.
 */
import type { ReactNode } from "react";

import { BrandMark } from "../../components/BrandMark.tsx";
import type { Client, Day, Decimal, Id, Invoice, InvoiceLine, Payment, Proposal, ProposalLine, Settings, TermsVersion } from "../../data/types.ts";
import { useI18n } from "../../i18n/index.tsx";
import { addDays } from "../../data/venueTime.ts";
import { dayLabel } from "../../lib/dates.ts";
import { minorUnits, sumDecimals } from "../../lib/money.ts";
import { instantLabel } from "../../lib/dates.ts";
import { studioZone } from "../../lib/clock.ts";
import { dayOf } from "../chasing/rungs.ts";
import { ledger, paymentsOf } from "../invoices/figures.ts";
import type { PrintTarget } from "./target.ts";

export type Paper = "letter" | "a4";

export interface PaperRows {
  settings: Settings | null;
  clients: Record<Id, Client>;
  invoices: Record<Id, Invoice>;
  invoiceLines: readonly InvoiceLine[];
  payments: readonly Payment[];
  proposals: Record<Id, Proposal>;
  proposalLines: readonly ProposalLine[];
  termsVersions: Record<Id, TermsVersion>;
}

interface Line {
  key: string;
  description: ReactNode;
  sub?: ReactNode;
  qty: string;
  rate: string;
  amount: string;
}

const SPLITS: Record<Proposal["split"], { pct: number[]; names: ("start" | "midway" | "delivery")[] }> = {
  "5050": { pct: [50, 50], names: ["start", "delivery"] },
  "403030": { pct: [40, 30, 30], names: ["start", "midway", "delivery"] },
  end: { pct: [100], names: ["delivery"] },
};

/** The document on paper, or null while its rows are not read yet. */
export function PaperSheet({ target, rows, paper, day }: { target: PrintTarget; rows: PaperRows; paper: Paper; day: Day }) {
  const { t, money, number, locale } = useI18n();
  const settings = rows.settings;
  const studio = settings?.name ?? "";
  const long = (d: Day | null | undefined) => dayLabel(d, locale, "long");
  const short = (d: Day | null | undefined) => dayLabel(d, locale);
  const qty = (v: Decimal | null) => (v === null ? "" : number(Number(v), { maximumFractionDigits: 3 }));
  const lineOf = <L extends InvoiceLine | ProposalLine>(l: L, currency: string | null): Line => ({
    key: String(l.id),
    description: l.description ?? "",
    ...(l.discount_kind === "amount" && l.discount !== null && Number(l.discount) > 0 ? { sub: t("lines.less", { amount: money(l.discount, currency) }) } : {}),
    qty: qty(l.qty),
    rate: money(l.rate, currency),
    amount: money(l.amount, currency),
  });

  let doc: {
    toLabel: string;
    client: Client | undefined;
    meta: [string, string][];
    title: string;
    scope?: string[];
    heads: [string, string, string, string];
    lines: Line[];
    totals: { k: string; v: string; big?: boolean }[];
    pays?: { key: string; day: string; method: string; amount: string }[];
    due?: string;
    signed?: { name: string; line: string };
    payLabel: string;
    payLines: { text: string; mono?: boolean; strong?: boolean }[];
    footLabel: string;
    foot: string;
    void?: boolean;
  } | null = null;
  const heads: [string, string, string, string] = [t("lines.description"), t("lines.qty"), t("lines.rate"), t("lines.amount")];

  if (target.kind === "invoice") {
    const inv = rows.invoices[target.id];
    if (inv === undefined) return null;
    const cur = inv.currency;
    const kept = paymentsOf(rows.payments, inv.id).filter((p) => !p.voided);
    const isVoid = inv.status === "void";
    doc = {
      toLabel: t("invoices.print.to.invoice"),
      client: rows.clients[inv.client_id],
      meta: [
        [t("invoices.print.meta.invoice"), inv.number ?? ""],
        [t("invoices.print.meta.issued"), inv.issued_on === null ? "—" : long(inv.issued_on)],
        [t("invoices.print.meta.due"), inv.due_on === null ? "—" : long(inv.due_on)],
        [t("invoices.print.meta.terms"), inv.terms === null ? "—" : t(`invoices.terms.${inv.terms}`)],
        ...(isVoid && inv.voided_at !== null ? ([[t("invoices.print.meta.void"), long(dayOf(inv.voided_at, studioZone()))]] as [string, string][]) : []),
      ],
      title: inv.title ?? inv.number ?? "",
      heads,
      lines: rows.invoiceLines.filter((l) => l.document_id === inv.id).sort((a, b) => a.position - b.position || a.id - b.id).map((l) => lineOf(l, cur)),
      totals: [
        { k: t("lines.subtotal"), v: money(inv.subtotal, cur) },
        { k: t("lines.tax", { name: inv.tax_name ?? "", rate: inv.tax_rate === null ? "0" : number(Number(inv.tax_rate), { maximumFractionDigits: 3 }) }), v: money(inv.tax, cur) },
        { k: t("lines.total"), v: money(inv.total, cur), big: true },
      ],
      ...(kept.length > 0 && !isVoid ? { pays: kept.map((p) => ({ key: String(p.id), day: short(p.paid_on), method: t(`invoices.method.${p.method}`), amount: money(p.amount, cur) })), due: money(inv.balance, cur) } : {}),
      payLabel: t("invoices.print.pay.how"),
      payLines: [{ text: t("invoices.print.pay.reference", { id: inv.number ?? "" }), mono: true, strong: true }],
      footLabel: t("invoices.print.foot.terms"),
      foot: isVoid ? t("invoices.print.foot.void", { day: inv.voided_at === null ? "" : long(dayOf(inv.voided_at, studioZone())) }) : "",
      void: isVoid,
    };
  } else if (target.kind === "quote") {
    const q = rows.proposals[target.id];
    if (q === undefined) return null;
    const cur = q.currency;
    const split = SPLITS[q.split];
    const version = q.terms_version_id === null ? undefined : rows.termsVersions[q.terms_version_id];
    const signedOn = q.signed_at ?? q.decided_at;
    const fp = q.fingerprint;
    doc = {
      toLabel: t("invoices.print.to.quote"),
      client: rows.clients[q.client_id],
      meta: [
        [t("invoices.print.meta.quote"), q.number ?? ""],
        [t("invoices.print.meta.sent"), q.sent_at === null ? "—" : long(dayOf(q.sent_at, studioZone()))],
        [t("invoices.print.meta.validUntil"), q.valid_until === null ? "—" : long(q.valid_until)],
      ],
      title: q.title,
      scope: (q.scope ?? "").split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p !== ""),
      heads,
      lines: rows.proposalLines.filter((l) => l.document_id === q.id).sort((a, b) => a.position - b.position || a.id - b.id).map((l) => lineOf(l, cur)),
      totals: [
        { k: t("lines.subtotal"), v: money(q.subtotal, cur) },
        { k: t("lines.tax", { name: q.tax_name ?? "", rate: q.tax_rate === null ? "0" : number(Number(q.tax_rate), { maximumFractionDigits: 3 }) }), v: money(q.tax, cur) },
        { k: t("lines.total"), v: money(q.total, cur), big: true },
      ],
      ...(q.signed_name !== null && q.signed_name !== ""
        ? {
            signed: {
              name: q.signed_name,
              line: [
                signedOn === null ? "" : instantLabel(signedOn, studioZone(), locale, { day: "numeric", month: "long", year: "numeric" }),
                version?.version == null ? "" : t("invoices.print.signed.terms", { v: String(version.version) }),
                fp === null || fp.length < 8 ? "" : t("invoices.print.signed.fingerprint", { fp: `${fp.slice(0, 4)}…${fp.slice(-4)}` }),
              ]
                .filter((x) => x !== "")
                .join(" · "),
            },
          }
        : {}),
      payLabel: t("invoices.print.pay.split"),
      payLines: split.pct.map((pc, i) => ({ text: t(`invoices.print.split.${split.names[i]!}`, { pct: number(pc) }), mono: true })),
      footLabel: t("invoices.print.foot.terms"),
      foot: t("invoices.print.foot.quote"),
    };
  } else if (target.kind === "receipt") {
    const pay = rows.payments.find((p) => p.id === target.id);
    const inv = pay === undefined ? undefined : rows.invoices[pay.document_id];
    if (pay === undefined || inv === undefined) return null;
    const cur = inv.currency;
    const after = ledger(inv, rows.payments).find((r) => r.kind === "payment" && r.payment.id === pay.id);
    const left = after?.kind === "payment" ? after.balance : null;
    doc = {
      toLabel: t("invoices.print.to.receipt"),
      client: rows.clients[inv.client_id],
      meta: [
        [t("invoices.print.meta.receipt"), pay.number ?? ""],
        [t("invoices.print.meta.for"), inv.number ?? ""],
        [t("invoices.print.meta.received"), long(pay.paid_on)],
        [t("invoices.print.meta.method"), t(`invoices.method.${pay.method}`)],
      ],
      title: t("invoices.print.receiptTitle", { receipt: pay.number ?? "", id: inv.number ?? "" }),
      heads,
      lines: [{ key: "pay", description: t("invoices.print.receiptLine", { id: inv.number ?? "", title: inv.title ?? "" }), qty: qty("1"), rate: money(pay.amount, cur), amount: money(pay.amount, cur) }],
      totals: [
        { k: t("invoices.print.receipt.total"), v: money(inv.total, cur) },
        { k: t("invoices.print.receipt.received", { day: short(pay.paid_on) }), v: money(pay.amount, cur), big: true },
        { k: t("invoices.print.receipt.left"), v: money(left, cur) },
      ],
      payLabel: t("invoices.print.pay.thanks"),
      payLines: [
        { text: t("invoices.print.pay.receivedLine", { amount: money(pay.amount, cur), day: short(pay.paid_on) }), mono: true },
        { text: t("invoices.print.pay.leftLine", { amount: money(left, cur) }), mono: true },
      ],
      footLabel: t("invoices.print.foot.note"),
      foot: t("invoices.print.foot.receipt"),
      void: pay.voided,
    };
  } else {
    const client = rows.clients[target.id];
    if (client === undefined) return null;
    const from = target.period === "year" ? `${day.slice(0, 4)}-01-01` : target.period === "12m" ? addDays(day, -365) : null;
    const theirs = Object.values(rows.invoices)
      .filter((i) => i.client_id === client.id && i.status === "sent" && i.issued_on !== null && (from === null || i.issued_on >= from))
      .sort((a, b) => (a.issued_on! < b.issued_on! ? -1 : a.issued_on! > b.issued_on! ? 1 : a.id - b.id));
    const cur = theirs[0]?.currency ?? null;
    const scale = minorUnits(cur);
    const lines: Line[] = [];
    const paid: Decimal[] = [];
    for (const inv of theirs) {
      lines.push({ key: `i${String(inv.id)}`, description: t("invoices.print.statement.invoice", { id: inv.number ?? "", title: inv.title ?? "" }), qty: "", rate: short(inv.issued_on), amount: money(inv.total, inv.currency) });
      for (const p of paymentsOf(rows.payments, inv.id).filter((x) => !x.voided)) {
        paid.push(p.amount);
        lines.push({ key: `p${String(p.id)}`, description: t("invoices.print.statement.payment", { method: t(`invoices.method.${p.method}`) }), sub: t("invoices.print.statement.against", { id: inv.number ?? "" }), qty: "", rate: short(p.paid_on), amount: `−${money(p.amount, inv.currency)}` });
      }
    }
    const invoiced = sumDecimals(theirs.map((i) => i.total), scale);
    const paidSum = sumDecimals(paid, scale);
    doc = {
      toLabel: t("invoices.print.to.statement"),
      client,
      meta: [
        [t("invoices.print.meta.statement"), client.company],
        [t("invoices.print.meta.period"), t(`invoices.print.period.${target.period}`)],
        [t("invoices.print.meta.issued"), long(day)],
        [t("invoices.print.meta.documents"), number(theirs.length)],
      ],
      title: t("invoices.print.statementTitle"),
      heads: [t("invoices.print.statement.entry"), "", t("invoices.print.statement.date"), t("lines.amount")],
      lines,
      totals: [
        { k: t("invoices.print.statement.invoiced"), v: money(invoiced, cur) },
        { k: t("invoices.print.statement.paid"), v: money(paidSum, cur) },
        { k: t("invoices.print.statement.balance"), v: money(sumDecimals(theirs.map((i) => i.balance), scale), cur), big: true },
      ],
      payLabel: t("invoices.print.pay.how"),
      payLines: [{ text: t("invoices.print.pay.referenceAny"), mono: true, strong: true }],
      footLabel: t("invoices.print.foot.terms"),
      foot: "",
    };
  }

  const c = doc.client;
  const toLines: { key: string; text: string; mono?: boolean }[] = c === undefined ? [] : [
    { key: "who", text: c.contact_name },
    ...(c.address ?? "").split("\n").filter((x) => x.trim() !== "").map((x, i) => ({ key: `a${String(i)}`, text: x })),
    ...(c.tax_number === null || c.tax_number === "" ? [] : [{ key: "tax", text: t("invoices.print.taxNumber", { number: c.tax_number }), mono: true }]),
    { key: "email", text: c.email, mono: true },
  ];
  const fromLines = [settings?.reply_to, settings?.phone, settings?.website].filter((x): x is string => x !== null && x !== undefined && x !== "");

  return (
    <div className={`pr-sheet pr-sheet--${paper}`} lang={locale}>
      {doc.void === true && (
        <span className="pr-void" aria-hidden="true">
          <span>{t("invoices.print.voidMark")}</span>
        </span>
      )}
      <div className="pr-letterhead">
        <span className="pr-brand">
          <BrandMark mark={settings?.mark} name={studio} />
          <span className="pr-studio">{studio}</span>
        </span>
        <span className="pr-from">
          {fromLines.map((x) => (
            <span key={x}>{x}</span>
          ))}
        </span>
      </div>
      <div className="pr-parties">
        <span className="pr-to">
          <span className="pr-k">{doc.toLabel}</span>
          <span className="pr-to-name">{c?.company ?? ""}</span>
          {toLines.map((l) => (
            <span key={l.key} className={`pr-to-line${l.mono === true ? " pr-mono" : ""}`}>
              {l.text}
            </span>
          ))}
        </span>
        <dl className="pr-meta">
          {doc.meta.map(([k, v]) => (
            <div key={k} className="pr-meta-row">
              <dt>{k}</dt>
              <dd className="pr-mono">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      <h2 className="pr-title">{doc.title}</h2>
      {doc.scope !== undefined && doc.scope.length > 0 && (
        <div className="pr-scope">
          {doc.scope.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      )}
      <div className="pr-lines" role="table">
        <div className="pr-line pr-line--head" role="row">
          {doc.heads.map((h, i) => (
            <span key={i} role="columnheader" className={i === 0 ? undefined : "pr-num"}>
              {h}
            </span>
          ))}
        </div>
        {doc.lines.map((l) => (
          <div key={l.key} className="pr-line" role="row">
            <span role="cell" className="pr-line-desc">
              <span>{l.description}</span>
              {l.sub !== undefined && <span className="pr-line-sub">{l.sub}</span>}
            </span>
            <span role="cell" className="pr-num pr-mono pr-muted">
              {l.qty}
            </span>
            <span role="cell" className="pr-num pr-mono pr-muted">
              {l.rate}
            </span>
            <span role="cell" className="pr-num pr-mono pr-strong">
              {l.amount}
            </span>
          </div>
        ))}
      </div>
      <dl className="pr-totals">
        {doc.totals.map((row) => (
          <div key={row.k} className={`pr-total${row.big === true ? " pr-total--big" : ""}`}>
            <dt>{row.k}</dt>
            <dd className="pr-mono">{row.v}</dd>
          </div>
        ))}
      </dl>
      {doc.pays !== undefined && (
        <div className="pr-pays">
          <span className="pr-k">{t("invoices.print.paysSoFar")}</span>
          {doc.pays.map((p) => (
            <span key={p.key} className="pr-pay">
              <span className="pr-mono pr-muted">{p.day}</span>
              <span>{p.method}</span>
              <span className="pr-mono pr-num">{p.amount}</span>
            </span>
          ))}
          <span className="pr-due">
            <span>{t("invoices.print.amountDue")}</span>
            <span className="pr-mono">{doc.due}</span>
          </span>
        </div>
      )}
      {doc.signed !== undefined && (
        <div className="pr-signed">
          <span className="pr-k">{t("invoices.print.signed.title")}</span>
          <span className="pr-signed-name">{doc.signed.name}</span>
          <span className="pr-mono pr-muted">{doc.signed.line}</span>
        </div>
      )}
      <div className="pr-bottom">
        <div className="pr-box">
          <span className="pr-box-col">
            <span className="pr-k">{doc.payLabel}</span>
            {doc.payLines.map((l) => (
              <span key={l.text} className={`${l.mono === true ? "pr-mono" : ""}${l.strong === true ? " pr-strong" : ""}`}>
                {l.text}
              </span>
            ))}
          </span>
          {doc.foot !== "" && (
            <span className="pr-box-col">
              <span className="pr-k">{doc.footLabel}</span>
              <span>{doc.foot}</span>
            </span>
          )}
        </div>
        <span className="pr-signature">{t("invoices.print.signature", { studio, reply: settings?.reply_to ?? "", by: settings?.sign_off ?? studio, day: long(day) })}</span>
      </div>
    </div>
  );
}
