/**
 * The overlay layer: toasts, the client's pay sheet, the studio's
 * record-payment popover, the decline-with-note dialog and the
 * request-changes dialog.
 *
 * The pay sheet carries the demo callout VERBATIM — "This is a demo. No real
 * card is charged." — because a payment surface that does not say so is a
 * payment surface somebody will eventually mistake for a real one.
 */

import { useEffect, useState } from "react";
import { Check, CreditCard, X } from "lucide-react";

import type { PaymentMethod } from "../data/types.ts";
import { useI18n } from "../i18n/index.tsx";
import { label, money, taxLabel } from "../lib/format.ts";
import { balance, docTotals } from "../lib/invoice.ts";
import { useStore } from "../state/store.ts";
import { Button, Chip, Mono } from "./Primitives.tsx";

const METHODS: PaymentMethod[] = ["card", "cash", "transfer"];

const METHOD_KEY: Record<PaymentMethod, "chrome.method.card"> = {
  card: "chrome.method.card",
  cash: "chrome.method.cash" as "chrome.method.card",
  transfer: "chrome.method.transfer" as "chrome.method.card",
};

export function ToastLayer() {
  const { t } = useI18n();
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);

  return (
    <div className="ol-toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`ol-toast ol-toast--${toast.tone}`}>
          {toast.tone === "pos" && <Check size={15} aria-hidden="true" />}
          <span>{toast.text}</span>
          <button
            type="button"
            className="ol-toast__x"
            onClick={() => dismiss(toast.id)}
            aria-label={t("chrome.toast.dismiss")}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Parse a typed amount into cents, tolerating both decimal separators. */
function toCents(value: string): number {
  const cleaned = value.replace(/[^\d.,-]/g, "").replace(",", ".");
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) : Number.NaN;
}

/** The client's Stripe-style card sheet. */
export function PaySheet() {
  const { t } = useI18n();
  const num = useStore((s) => s.paySheetFor);
  const invoices = useStore((s) => s.invoices);
  const askPay = useStore((s) => s.askPay);
  const recordPayment = useStore((s) => s.recordPayment);
  const [amount, setAmount] = useState("");

  const invoice = invoices.find((i) => i.num === num);

  useEffect(() => {
    if (invoice !== undefined) setAmount((balance(invoice) / 100).toFixed(2));
  }, [num, invoice]);

  if (num === null || invoice === undefined) return null;

  const due = balance(invoice);
  const cents = toCents(amount);
  const valid = Number.isFinite(cents) && cents > 0 && cents <= due;
  const after = valid ? due - cents : due;

  return (
    <div
      className="ol-modal-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) askPay(null);
      }}
    >
      <div className="ol-modal" role="dialog" aria-modal="true" aria-label={t("clientinvoice.sheet.title", { doc: num })}>
        <h2 className="ol-modal__title">{t("clientinvoice.sheet.title", { doc: num })}</h2>

        <p className="ol-callout">{t("chrome.demoCallout")}</p>

        <dl className="ol-facts" style={{ marginBlockStart: 14 }}>
          <dt>{t("clientinvoice.sheet.open")}</dt>
          <dd>
            <Mono>{money(due)}</Mono>
          </dd>
          <dt>{t("clientinvoice.sheet.after")}</dt>
          <dd>
            <Mono>{money(after)}</Mono>
          </dd>
        </dl>

        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBlockStart: 14 }}>
          <Chip onClick={() => setAmount((due / 100).toFixed(2))}>
            {t("clientinvoice.sheet.full")}
          </Chip>
          <Chip onClick={() => setAmount((Math.round(due / 2) / 100).toFixed(2))}>
            {t("clientinvoice.sheet.half")}
          </Chip>
        </div>

        <label className="ol-field" style={{ marginBlockStart: 12 }}>
          <span className="ol-label">{t("clientinvoice.sheet.custom")}</span>
          <input
            className="ol-input ol-fld ol-mono"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>

        {/* Read-only test card — never a field a reader could fill with a real one. */}
        <div className="ol-cardfields">
          <label className="ol-field">
            <span className="ol-label">{t("clientinvoice.sheet.card")}</span>
            <input className="ol-input ol-mono" readOnly value="4242 4242 4242 4242" />
          </label>
          <label className="ol-field">
            <span className="ol-label">{t("clientinvoice.sheet.expiry")}</span>
            <input className="ol-input ol-mono" readOnly value="04 / 30" />
          </label>
          <label className="ol-field">
            <span className="ol-label">{t("clientinvoice.sheet.cvc")}</span>
            <input className="ol-input ol-mono" readOnly value="123" />
          </label>
        </div>

        <div className="ol-modal__actions">
          <Button tone="ghost" onClick={() => askPay(null)}>
            {t("chrome.action.cancel")}
          </Button>
          <Button
            tone="pos"
            disabled={!valid}
            onClick={() => recordPayment(num, cents, "card")}
          >
            <CreditCard size={15} aria-hidden="true" />
            {t("clientinvoice.sheet.confirm", { amount: money(valid ? cents : 0) })}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** The studio's record-payment popover — accepts partials, refuses overpayment. */
export function RecordPayment() {
  const { t } = useI18n();
  const num = useStore((s) => s.recordFor);
  const invoices = useStore((s) => s.invoices);
  const askRecord = useStore((s) => s.askRecord);
  const recordPayment = useStore((s) => s.recordPayment);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("transfer");

  const invoice = invoices.find((i) => i.num === num);

  useEffect(() => {
    if (invoice !== undefined) setAmount((balance(invoice) / 100).toFixed(2));
    setMethod("transfer");
  }, [num, invoice]);

  if (num === null || invoice === undefined) return null;

  const due = balance(invoice);
  const cents = toCents(amount);
  const blocked =
    !Number.isFinite(cents) || cents === 0
      ? t("invoice.record.empty")
      : cents < 0
        ? t("invoice.record.negative")
        : cents > due
          ? t("invoice.record.overpay", { max: money(due) })
          : null;

  return (
    <div
      className="ol-modal-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) askRecord(null);
      }}
    >
      <div className="ol-modal" role="dialog" aria-modal="true">
        <h2 className="ol-modal__title">{t("invoice.record")}</h2>
        <p className="ol-panel__sub">
          <Mono>{num}</Mono> · {t("invoice.balanceDue")} <Mono>{money(due)}</Mono>
        </p>

        <label className="ol-field" style={{ marginBlockStart: 14 }}>
          <span className="ol-label">{t("invoice.record.amount")}</span>
          <input
            className="ol-input ol-fld ol-mono"
            inputMode="decimal"
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>

        <div style={{ marginBlockStart: 12 }}>
          <span className="ol-label">{t("invoice.record.method")}</span>
          <div style={{ display: "flex", gap: 7, marginBlockStart: 7, flexWrap: "wrap" }}>
            {METHODS.map((m) => (
              <Chip key={m} onClick={() => setMethod(m)} pressed={method === m}>
                {t(METHOD_KEY[m])}
              </Chip>
            ))}
          </div>
        </div>

        {blocked !== null && (
          <p style={{ fontSize: 12, fontWeight: 600, color: "var(--warn)", marginBlockStart: 11 }}>
            {blocked}
          </p>
        )}

        <div className="ol-modal__actions">
          <Button tone="ghost" onClick={() => askRecord(null)}>
            {t("chrome.action.cancel")}
          </Button>
          <Button
            tone="pos"
            disabled={blocked !== null}
            onClick={() => recordPayment(num, cents, method)}
          >
            {t("invoice.record.confirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Declining a proposal — a note is required, and the studio reads it. */
export function DeclineDialog() {
  const { t } = useI18n();
  const num = useStore((s) => s.declineFor);
  const askDecline = useStore((s) => s.askDecline);
  const declineProposal = useStore((s) => s.declineProposal);
  const proposals = useStore((s) => s.proposals);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (num !== null) setNote("");
  }, [num]);

  if (num === null) return null;
  const proposal = proposals.find((p) => p.num === num);
  if (!proposal) return null;

  const blocked = note.trim().length === 0;

  return (
    <div
      className="ol-modal-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) askDecline(null);
      }}
    >
      <div className="ol-modal" role="dialog" aria-modal="true">
        <h2 className="ol-modal__title">{t("review.decline.title")}</h2>
        <p className="ol-panel__sub">
          <Mono>{num}</Mono> · {label(proposal.title)} ·{" "}
          <Mono>{money(docTotals(proposal.items, proposal.taxRate).total)}</Mono>
        </p>

        <textarea
          className="ol-textarea ol-fld"
          style={{ marginBlockStart: 14 }}
          value={note}
          autoFocus
          placeholder={t("review.decline.placeholder")}
          aria-label={t("review.decline.title")}
          onChange={(e) => setNote(e.target.value)}
        />
        {blocked && (
          <p style={{ fontSize: 12, fontWeight: 600, color: "var(--warn)", marginBlockStart: 8 }}>
            {t("review.decline.required")}
          </p>
        )}

        <div className="ol-modal__actions">
          <Button tone="ghost" onClick={() => askDecline(null)}>
            {t("chrome.action.cancel")}
          </Button>
          <Button tone="danger" disabled={blocked} onClick={() => declineProposal(num, note)}>
            {t("review.decline.confirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Requesting changes on a deliverable — also note-required, same reasoning. */
export function ChangesDialog() {
  const { t } = useI18n();
  const target = useStore((s) => s.changesFor);
  const askChanges = useStore((s) => s.askChanges);
  const setStatus = useStore((s) => s.setDeliverableStatus);
  const projects = useStore((s) => s.projects);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (target !== null) setNote("");
  }, [target]);

  if (target === null) return null;
  const project = projects.find((p) => p.id === target.project);
  const deliverable = project?.deliverables.find((d) => d.id === target.deliverable);
  if (!project || !deliverable) return null;

  const blocked = note.trim().length === 0;

  return (
    <div
      className="ol-modal-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) askChanges(null);
      }}
    >
      <div className="ol-modal" role="dialog" aria-modal="true">
        <h2 className="ol-modal__title">{t("progress.changes.title")}</h2>
        <p className="ol-panel__sub ol-mono">{deliverable.file}</p>

        <textarea
          className="ol-textarea ol-fld"
          style={{ marginBlockStart: 14 }}
          value={note}
          autoFocus
          placeholder={t("progress.changes.placeholder")}
          aria-label={t("progress.changes.title")}
          onChange={(e) => setNote(e.target.value)}
        />
        {blocked && (
          <p style={{ fontSize: 12, fontWeight: 600, color: "var(--warn)", marginBlockStart: 8 }}>
            {t("progress.changes.required")}
          </p>
        )}

        <div className="ol-modal__actions">
          <Button tone="ghost" onClick={() => askChanges(null)}>
            {t("chrome.action.cancel")}
          </Button>
          <Button
            disabled={blocked}
            onClick={() => setStatus(project.id, deliverable.id, "changes", note)}
          >
            {t("progress.changes.confirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}

export { taxLabel };
