/**
 * The design's repeated pieces, as components: buttons, pills, cards, the
 * screen heading, the document list, line items with totals, empty states,
 * money and dates, avatars, filters and tabs, fields, alerts, and the
 * "A step didn't save — Finish it" line. Each draws with the classes in
 * `styles/primitives.css`; a screen composes them and adds its own layout in
 * its area's stylesheet.
 *
 * Every word they show comes from the caller or from the shared `chrome`
 * strings; none is written here.
 */
import { useId, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { CircleAlert, LoaderCircle } from "lucide-react";

import type { Day, Decimal, Instant } from "../data/types.ts";
import { useI18n, type MessageKey } from "../i18n/index.tsx";
import { dayLabel, instantLabel, type DayStyle } from "../lib/dates.ts";
import { initials } from "../lib/initials.ts";
import { studioZone } from "../lib/clock.ts";
import type { Unfinished } from "../state/outcome.ts";

// ── buttons ─────────────────────────────────────────────────────────────────

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  kind?: "primary" | "ghost" | "danger";
  size?: "normal" | "small" | "wide";
  icon?: LucideIcon;
  /** A save on its way: the button shows it and takes no second press. */
  busy?: boolean;
}

export function Button({ kind = "ghost", size = "normal", icon: Icon, busy = false, children, className, disabled, type = "button", ...rest }: ButtonProps) {
  const classes = ["btn", kind === "primary" ? "btn--primary ol-btn" : "ol-gi", kind === "danger" ? "btn--danger" : "", size === "small" ? "btn--small" : size === "wide" ? "btn--wide" : "", className ?? ""]
    .filter((c) => c !== "")
    .join(" ");
  return (
    <button type={type} className={classes} disabled={disabled === true || busy} aria-busy={busy || undefined} {...rest}>
      {busy ? <LoaderCircle size={16} className="btn-spin" aria-hidden="true" /> : Icon !== undefined && <Icon size={16} aria-hidden="true" />}
      {children}
    </button>
  );
}

export function IconButton({ icon: Icon, label, onClick, pressed, className, ...rest }: { icon: LucideIcon; label: string; onClick?: () => void; pressed?: boolean; className?: string } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick">) {
  return (
    <button type="button" className={`icon-btn ol-gi ${className ?? ""}`.trim()} aria-label={label} title={label} aria-pressed={pressed} onClick={onClick} {...rest}>
      <Icon size={17} aria-hidden="true" />
    </button>
  );
}

// ── pills ───────────────────────────────────────────────────────────────────

export type PillTone = "neutral" | "info" | "pos" | "warn" | "danger" | "accent";

export function Pill({ tone = "neutral", mono = false, children }: { tone?: PillTone; mono?: boolean; children: ReactNode }) {
  return <span className={`pill${tone === "neutral" ? "" : ` pill--${tone}`}${mono ? " pill--mono" : ""}`}>{children}</span>;
}

/** Every stored or worked-out state a pill names, with the design's tone for it. */
export const STATUS_TONE = {
  draft: "neutral",
  sent: "info",
  accepted: "pos",
  declined: "danger",
  withdrawn: "neutral",
  outOfDate: "neutral",
  paid: "pos",
  partPaid: "warn",
  overdue: "danger",
  void: "neutral",
  active: "accent",
  paused: "warn",
  done: "pos",
  notShared: "neutral",
  pending: "info",
  approved: "pos",
  changes: "warn",
  new: "info",
  replied: "pos",
  parked: "neutral",
  toProposal: "accent",
  held: "warn",
  queued: "info",
  skipped: "neutral",
  failed: "danger",
  open: "neutral",
  inForce: "pos",
  retired: "neutral",
} as const satisfies Record<string, PillTone>;

export type StatusWord = keyof typeof STATUS_TONE;

/** A status in the design's colours and the page's language: `<StatusPill status="overdue" />`. */
export function StatusPill({ status }: { status: StatusWord }) {
  const { t } = useI18n();
  return <Pill tone={STATUS_TONE[status]}>{t(`status.${status}` as MessageKey)}</Pill>;
}

// ── cards and headings ──────────────────────────────────────────────────────

export function Card({ children, pad = true, hover = false, className, style, as: Tag = "div", ...aria }: { children: ReactNode; pad?: boolean; hover?: boolean; className?: string; style?: CSSProperties; as?: "div" | "section" | "article"; "aria-labelledby"?: string }) {
  return (
    <Tag className={["card", pad ? "card--pad" : "", hover ? "ol-card" : "", className ?? ""].filter((c) => c !== "").join(" ")} style={style} {...aria}>
      {children}
    </Tag>
  );
}

export function Kicker({ icon: Icon, children, id }: { icon?: LucideIcon; children: ReactNode; id?: string }) {
  return (
    <div className="kicker" id={id}>
      {Icon !== undefined && <Icon size={13} aria-hidden="true" />}
      {children}
    </div>
  );
}

/** A screen's title, its lead line and its buttons, as the design lays them out. */
export function ScreenHead({ title, lead, actions, id }: { title: ReactNode; lead?: ReactNode; actions?: ReactNode; id?: string }) {
  return (
    <div className="screen-head">
      <div>
        <h1 className="screen-title" id={id}>
          {title}
        </h1>
        {lead !== undefined && <p className="screen-lead">{lead}</p>}
      </div>
      {actions !== undefined && <span className="screen-actions">{actions}</span>}
    </div>
  );
}

// ── the document list ───────────────────────────────────────────────────────

export function DocList({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="doc-list" role="list" aria-label={label}>
      {children}
    </div>
  );
}

/** One document in a list: its number, title and client, a date, an amount and a pill. */
export function DocRow({ number, title, sub, due, amount, pill, onOpen }: { number: ReactNode; title: ReactNode; sub?: ReactNode; due?: ReactNode; amount?: ReactNode; pill?: ReactNode; onOpen: () => void }) {
  return (
    <div role="listitem">
      <button type="button" className="doc-row ol-row" onClick={onOpen}>
        <span className="doc-cell-id">{number}</span>
        <span className="doc-cell-main">
          <span className="doc-cell-title">{title}</span>
          {sub !== undefined && <span className="doc-cell-sub">{sub}</span>}
        </span>
        <span className="doc-cell-due">{due}</span>
        <span className="doc-cell-amount">{amount}</span>
        <span className="doc-cell-pill">{pill}</span>
      </button>
    </div>
  );
}

// ── line items ──────────────────────────────────────────────────────────────

export interface LineView {
  key: string | number;
  description: string;
  qty: Decimal | null;
  rate: Decimal | null;
  amount: Decimal | null;
  discount?: Decimal | null;
}

/** A document's lines and its stored totals (subtotal, tax, total), in its own currency. */
export function LinesTable({ lines, subtotal, tax, taxName, taxRate, total, currency }: { lines: readonly LineView[]; subtotal: Decimal | null; tax: Decimal | null; taxName: string | null; taxRate: Decimal | null; total: Decimal | null; currency?: string | null }) {
  const { t, money, number } = useI18n();
  const num = (v: Decimal | null) => (v === null ? "" : number(Number(v), { maximumFractionDigits: 4 }));
  return (
    <div className="lines">
      <div className="lines-head" aria-hidden="true">
        <span>{t("lines.description")}</span>
        <span className="lines-qty lines-num">{t("lines.qty")}</span>
        <span className="lines-rate lines-num">{t("lines.rate")}</span>
        <span className="lines-num">{t("lines.amount")}</span>
      </div>
      <ul role="list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {lines.map((line) => (
          <li key={line.key} className="lines-row">
            <span>
              <span style={{ fontSize: 13.5, fontWeight: 700 }}>{line.description}</span>
              {line.discount !== undefined && line.discount !== null && Number(line.discount) > 0 && (
                <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--fg-subtle)" }}>{t("lines.less", { amount: money(line.discount, currency) })}</span>
              )}
            </span>
            <span className="lines-qty lines-num">
              <span className="ol-sr-only">{t("lines.qty")} </span>
              {num(line.qty)}
            </span>
            <span className="lines-rate lines-num">
              <span className="ol-sr-only">{t("lines.rate")} </span>
              <Money value={line.rate} currency={currency} />
            </span>
            <span className="lines-num">
              <span className="ol-sr-only">{t("lines.amount")} </span>
              <Money value={line.amount} currency={currency} />
            </span>
          </li>
        ))}
      </ul>
      <dl className="totals" style={{ margin: 0 }}>
        <div className="totals-row">
          <dt>{t("lines.subtotal")}</dt>
          <dd style={{ margin: 0 }}>
            <Money value={subtotal} currency={currency} />
          </dd>
        </div>
        <div className="totals-row">
          <dt>{t("lines.tax", { name: taxName ?? "", rate: taxRate === null ? "0" : number(Number(taxRate), { maximumFractionDigits: 2 }) })}</dt>
          <dd style={{ margin: 0 }}>
            <Money value={tax} currency={currency} />
          </dd>
        </div>
        <div className="totals-row totals-row--grand">
          <dt>{t("lines.total")}</dt>
          <dd style={{ margin: 0 }}>
            <Money value={total} currency={currency} />
          </dd>
        </div>
      </dl>
    </div>
  );
}

// ── empty states ────────────────────────────────────────────────────────────

export function Empty({ icon: Icon, title, body }: { icon?: LucideIcon; title: ReactNode; body?: ReactNode }) {
  return (
    <div className="empty">
      {Icon !== undefined && (
        <div className="empty-icon" aria-hidden="true">
          <Icon size={19} />
        </div>
      )}
      <div className="empty-title">{title}</div>
      {body !== undefined && <div className="empty-body">{body}</div>}
    </div>
  );
}

// ── money and dates ─────────────────────────────────────────────────────────

/** A stored amount, in the page's language and its currency (the studio's when none is given). */
export function Money({ value, currency, style }: { value: Decimal | null | undefined; currency?: string | null; style?: CSSProperties }) {
  const { money } = useI18n();
  return (
    <span className="money" style={style}>
      {money(value, currency)}
    </span>
  );
}

/** A calendar day on the studio's calendar. */
export function DayText({ day, style = "short" }: { day: Day | null | undefined; style?: DayStyle }) {
  const { locale } = useI18n();
  if (day === null || day === undefined) return null;
  return (
    <time className="when" dateTime={day}>
      {dayLabel(day, locale, style)}
    </time>
  );
}

/** An instant, read on the studio's clock. */
export function When({ at, opts }: { at: Instant | null | undefined; opts?: Intl.DateTimeFormatOptions }) {
  const { locale } = useI18n();
  if (at === null || at === undefined) return null;
  return (
    <time className="when" dateTime={at}>
      {instantLabel(at, studioZone(), locale, opts)}
    </time>
  );
}

// ── avatars ─────────────────────────────────────────────────────────────────

/** A client's or a person's tile: initials on their tint. */
export function Avatar({ name, tint, size = 40, label }: { name: string; tint?: string | null; size?: number; label?: string }) {
  const colour = tint ?? "#b25e09";
  return (
    <span
      className="avatar"
      role={label === undefined ? undefined : "img"}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.3),
        fontSize: Math.round(size * 0.35),
        background: `linear-gradient(152deg, color-mix(in srgb, ${colour} 20%, transparent), color-mix(in srgb, ${colour} 6%, transparent))`,
        color: `color-mix(in srgb, ${colour} 78%, var(--fg))`,
      }}
    >
      {initials(name)}
    </span>
  );
}

// ── filters and tabs ────────────────────────────────────────────────────────

export interface FilterItem<T extends string> {
  id: T;
  label: string;
  count?: number;
}

/** The design's filter chips (one pressed at a time). */
export function Filters<T extends string>({ items, value, onChange, label }: { items: readonly FilterItem<T>[]; value: T; onChange: (id: T) => void; label: string }) {
  const { number } = useI18n();
  return (
    <div className="filters" role="group" aria-label={label}>
      {items.map((item) => (
        <button key={item.id} type="button" className="filter ol-chip" aria-pressed={item.id === value} onClick={() => onChange(item.id)}>
          {item.label}
          {item.count !== undefined && <span className="filter-count">{number(item.count)}</span>}
        </button>
      ))}
    </div>
  );
}

/** Segmented tabs over one panel. */
export function Tabs<T extends string>({ items, value, onChange, label, panelId }: { items: readonly FilterItem<T>[]; value: T; onChange: (id: T) => void; label: string; panelId?: string }) {
  return (
    <div className="tabs ol-hide-scroll" role="tablist" aria-label={label}>
      {items.map((item) => (
        <button key={item.id} type="button" role="tab" className="tab ol-chip" aria-selected={item.id === value} aria-controls={panelId} tabIndex={item.id === value ? 0 : -1} onClick={() => onChange(item.id)}>
          {item.label}
        </button>
      ))}
    </div>
  );
}

// ── fields ──────────────────────────────────────────────────────────────────

/** A label, the control, a hint and an error — tied together for screen readers. */
export function Field({ label, hint, error, children }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode }) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint !== undefined ? hintId : null, error !== undefined && error !== null && error !== false ? errorId : null].filter((x) => x !== null).join(" ") || undefined;
  const invalid = error !== undefined && error !== null && error !== false;
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {children({ id, describedBy, invalid })}
      {hint !== undefined && (
        <span className="field-hint" id={hintId}>
          {hint}
        </span>
      )}
      {invalid && (
        <span className="field-error" id={errorId}>
          {error}
        </span>
      )}
    </div>
  );
}

export function Alert({ children, tone = "danger" }: { children: ReactNode; tone?: "danger" | "warn" }) {
  return (
    <div className={`alert${tone === "warn" ? " alert--warn" : ""}`} role="alert">
      <CircleAlert size={15} aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

/** "A step didn't save — Finish it": an action stopped half-way, and the button that finishes it. */
export function UnfinishedLine({ unfinished, onFinish, busy = false }: { unfinished: Unfinished<unknown>; onFinish: () => void; busy?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="alert alert--warn" role="alert" data-step={unfinished.step}>
      <CircleAlert size={15} aria-hidden="true" />
      <span style={{ flex: 1 }}>{t("save.unfinished")}</span>
      <Button size="small" onClick={onFinish} busy={busy}>
        {t("save.finish")}
      </Button>
    </div>
  );
}
