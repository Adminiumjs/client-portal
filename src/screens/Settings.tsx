/**
 * Settings — the handful of things true for every document the studio sends.
 *
 *   The studio        name, reply-to, phone, website, hours in a working day
 *   People            who clients deal with, and whether clients see them
 *   Email             who signs the studio's emails off; every email we send
 *   Tell us when      the notices the studio is emailed
 *   Invoices & receipts
 *                     the Invoices & Receipts add-on's own settings (shared by
 *                     every app it serves), for a studio manager: letterhead,
 *                     tax, payment instructions, numbers, terms, the footer,
 *                     the payment ledger, the reminder ladders; the currency is
 *                     the connection's and is only shown
 *   Rate card         what the studio works its stage prices out from
 *
 * Each card saves on its own (its "Save" writes only what changed); the sign-
 * off and a rate's amount save as they are changed. Every save is Adminium's
 * to accept: a studio manager's role changes the set-up, the add-on's
 * settings grant changes the add-on's settings.
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowUpRight, Bell, Check, FileSignature, Mail, PenTool, Plus, ReceiptText, Ruler, Trash2, UsersRound } from "lucide-react";

import { Alert, Button, Field, IconButton, ScreenHead } from "../components/ui.tsx";
import type { Id, Person, Rate, Settings as SettingsRow } from "../data/types.ts";
import { useI18n, type MessageKey } from "../i18n/index.tsx";
import { tenantCurrency } from "../i18n/ambient.ts";
import { initials } from "../lib/initials.ts";
import { removePerson, saveInvoiceSettings, savePerson, saveRate, saveStudioSettings, type Outcome } from "../state/actions.ts";
import { loadPage, useDesk, useManager, useRows, useSettings } from "../state/desk.ts";
import { refusalKey } from "../state/outcome.ts";
import { openSheet } from "../state/sheets.ts";
import { go, toast } from "../state/ui.ts";
import { readInvoiceSettings, type InvoiceSettingsRead } from "./settings/invoiceSettings.ts";
import {
  currencyName,
  currencySymbol,
  formatNumber,
  hourlyRate,
  invoiceErrors,
  invoiceFormOf,
  invoicePatch,
  LADDERS,
  NOTICES,
  newStart,
  nextInSeries,
  noticesPatch,
  rateAmount,
  SERIES,
  signOffOptions,
  studioErrors,
  studioPatch,
  studioValue,
  TERMS,
  type InvoiceForm,
  type Notice,
  type NoticeDraft,
  type Series,
  type StudioDraft,
  type StudioField,
} from "./settings/model.ts";
import { Switch } from "./settings/Switch.tsx";

type Refused = Extract<Outcome<unknown>, { ok: false }>;

// ── the card and its foot ───────────────────────────────────────────────────

function SetCard({ icon: Icon, title, sub, action, children, id }: { icon: LucideIcon; title: ReactNode; sub?: ReactNode; action?: ReactNode; children: ReactNode; id?: string }) {
  const titleId = useId();
  return (
    <section className="set-card" aria-labelledby={titleId} id={id}>
      <div className={`set-card-head${sub === undefined ? "" : " set-card-head--sub"}`}>
        <span className="set-card-title">
          <Icon size={15} aria-hidden="true" />
          <h2 id={titleId}>{title}</h2>
          {action}
        </span>
        {sub !== undefined && <span className="set-card-sub">{sub}</span>}
      </div>
      {children}
    </section>
  );
}

function CardFoot({ dirty, busy, onDiscard, onSave }: { dirty: boolean; busy: boolean; onDiscard: () => void; onSave: () => void }) {
  const { t } = useI18n();
  return (
    <div className="set-card-foot">
      {dirty && <span className="set-dirty">{t("settings.unsaved")}</span>}
      <Button size="small" className="set-discard" onClick={onDiscard} disabled={busy}>
        {t("settings.discard")}
      </Button>
      <Button kind="primary" size="small" icon={Check} busy={busy} onClick={onSave}>
        {t("settings.save")}
      </Button>
    </div>
  );
}

/** A card's save: busy while it runs, the refusal kept to show. */
function useSave() {
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<Refused | null>(null);
  const run = async <T,>(save: () => Promise<Outcome<T>>): Promise<boolean> => {
    setBusy(true);
    setRefused(null);
    const out = await save();
    setBusy(false);
    if (!out.ok) setRefused(out);
    return out.ok;
  };
  return { busy, refused, setRefused, run };
}

function RefusedLine({ refused }: { refused: Refused | null }) {
  const { t } = useI18n();
  if (refused === null) return null;
  return (
    <div className="set-card-alert">
      <Alert>{t(refusalKey(refused.reason), { id: "", balance: "" })}</Alert>
    </div>
  );
}

// ── the studio ──────────────────────────────────────────────────────────────

const STUDIO_LABELS: Record<StudioField, MessageKey> = {
  name: "settings.studio.name",
  reply_to: "settings.studio.replyTo",
  phone: "settings.studio.phone",
  website: "settings.studio.website",
  hours_per_day: "settings.studio.hours",
};

function StudioCard({ settings, manager }: { settings: SettingsRow | null; manager: boolean }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<StudioDraft>({});
  const [shown, setShown] = useState(false);
  const save = useSave();
  const patch = studioPatch(settings, draft);
  const dirty = Object.keys(patch).length > 0;
  const errors = shown ? studioErrors(settings, draft) : {};

  const onSave = async () => {
    if (!dirty) return toast(t("settings.nothingChanged"));
    setShown(true);
    if (Object.keys(studioErrors(settings, draft)).length > 0) {
      setTimeout(() => document.querySelector<HTMLElement>('.set-card [aria-invalid="true"]')?.focus(), 0);
      return;
    }
    if (await save.run(() => saveStudioSettings(patch))) {
      setDraft({});
      setShown(false);
      toast(t("settings.saved"));
    }
  };
  const onDiscard = () => {
    if (!dirty) return toast(t("settings.nothingChanged"));
    setDraft({});
    setShown(false);
    save.setRefused(null);
    toast(t("settings.discarded"), { icon: "undo-2" });
  };

  const input = (field: StudioField, opts: { mono?: boolean; mode?: "text" | "email" | "tel" | "url" | "numeric" } = {}) => (
    <Field key={field} label={t(STUDIO_LABELS[field])} hint={field === "hours_per_day" ? t("settings.studio.hoursHint") : undefined} error={errors[field] === undefined ? undefined : t(`settings.studio.error.${errors[field]}` as MessageKey)}>
      {({ id, describedBy, invalid }) => (
        <input
          id={id}
          className={`input${opts.mono === true ? " set-mono" : ""}`}
          dir={opts.mono === true ? "ltr" : undefined}
          value={draft[field] ?? studioValue(settings, field)}
          inputMode={opts.mode === "numeric" ? "numeric" : opts.mode === "tel" ? "tel" : opts.mode === "email" ? "email" : opts.mode === "url" ? "url" : "text"}
          type={opts.mode === "email" ? "email" : "text"}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          readOnly={!manager}
          onChange={(e) => setDraft((d) => ({ ...d, [field]: e.target.value }))}
        />
      )}
    </Field>
  );

  return (
    <SetCard icon={PenTool} title={t("settings.studio.title")}>
      <div className="set-card-body">
        {input("name")}
        {input("reply_to", { mono: true, mode: "email" })}
        {input("phone", { mono: true, mode: "tel" })}
        {input("website", { mono: true, mode: "url" })}
        {input("hours_per_day", { mono: true, mode: "numeric" })}
      </div>
      <RefusedLine refused={save.refused} />
      {manager && <CardFoot dirty={dirty} busy={save.busy} onDiscard={onDiscard} onSave={() => void onSave()} />}
    </SetCard>
  );
}

// ── people ──────────────────────────────────────────────────────────────────

function PersonTile({ person }: { person: Person }) {
  const colour = "#5a5a65";
  return (
    <span
      className="avatar set-person-tile"
      aria-hidden="true"
      style={{
        background: `linear-gradient(152deg, color-mix(in srgb, ${colour} 20%, transparent), color-mix(in srgb, ${colour} 6%, transparent))`,
        color: `color-mix(in srgb, ${colour} 78%, var(--fg))`,
      }}
    >
      {person.initials !== null && person.initials.trim() !== "" ? person.initials.trim().slice(0, 3) : initials(person.name)}
    </span>
  );
}

function PeopleCard({ people, manager }: { people: Person[]; manager: boolean }) {
  const { t } = useI18n();
  const base = useId();
  const [draft, setDraft] = useState<Record<Id, boolean>>({});
  const [asking, setAsking] = useState<Id | null>(null);
  const save = useSave();
  const shownOf = (p: Person) => draft[p.id] ?? p.shown_to_clients;
  const changed = people.filter((p) => draft[p.id] !== undefined && draft[p.id] !== p.shown_to_clients);
  const dirty = changed.length > 0;

  const onSave = async () => {
    if (!dirty) return toast(t("settings.nothingChanged"));
    const ok = await save.run(async (): Promise<Outcome<null>> => {
      for (const p of changed) {
        const out = await savePerson(p.id, { shown_to_clients: draft[p.id] });
        if (!out.ok) return { ...out, unfinished: null };
        setDraft((d) => {
          const next = { ...d };
          delete next[p.id];
          return next;
        });
      }
      return { ok: true, value: null };
    });
    if (ok) toast(t("settings.saved"));
  };
  const onDiscard = () => {
    if (!dirty) return toast(t("settings.nothingChanged"));
    setDraft({});
    save.setRefused(null);
    toast(t("settings.discarded"), { icon: "undo-2" });
  };
  const onRemove = async (p: Person) => {
    if (await save.run(() => removePerson(p.id))) {
      setAsking(null);
      toast(t("settings.people.removed", { name: p.name }));
    }
  };

  const noneShown = people.length > 0 && people.every((p) => !shownOf(p));
  return (
    <SetCard
      icon={UsersRound}
      title={t("settings.people.title")}
      action={
        manager ? (
          <Button size="small" icon={Plus} className="set-head-btn" onClick={() => openSheet({ kind: "add", what: "person" })}>
            {t("settings.people.add")}
          </Button>
        ) : undefined
      }
    >
      {people.length === 0 && <p className="set-empty">{t("settings.people.empty")}</p>}
      <ul className="set-rows" role="list">
        {people.map((p) => {
          const swId = `${base}-p${String(p.id)}`;
          return (
            <li key={p.id} className="set-row">
              <PersonTile person={p} />
              <span className="set-person">
                {manager ? (
                  <button type="button" className="set-person-name set-link-text ol-gi" aria-label={t("settings.people.edit", { name: p.name })} onClick={() => openSheet({ kind: "add", what: "person", about: { personId: p.id } })}>
                    {p.name}
                  </button>
                ) : (
                  <span className="set-person-name">{p.name}</span>
                )}
                {p.role_label !== null && p.role_label !== "" && <span className="set-person-role">{p.role_label}</span>}
              </span>
              {asking === p.id ? (
                <span className="set-confirm" role="group" aria-label={t("settings.people.removeAsk", { name: p.name })}>
                  <span className="set-confirm-text">{t("settings.people.removeAsk", { name: p.name })}</span>
                  <Button size="small" onClick={() => setAsking(null)}>
                    {t("common.cancel")}
                  </Button>
                  <Button size="small" kind="danger" busy={save.busy} onClick={() => void onRemove(p)}>
                    {t("settings.people.removeYes")}
                  </Button>
                </span>
              ) : (
                <>
                  <span id={swId} className="set-switch-label">
                    {t("settings.people.shown")}
                  </span>
                  <Switch on={shownOf(p)} labelledBy={`${swId} ${swId}-n`} disabled={!manager} onToggle={() => setDraft((d) => ({ ...d, [p.id]: !shownOf(p) }))} />
                  <span id={`${swId}-n`} className="ol-sr-only">
                    {p.name}
                  </span>
                  {manager && <IconButton icon={Trash2} label={t("settings.people.removeLabel", { name: p.name })} className="set-row-remove" onClick={() => setAsking(p.id)} />}
                </>
              )}
            </li>
          );
        })}
      </ul>
      {noneShown && (
        <div className="set-card-alert">
          <Alert tone="warn">{t("settings.people.noneShown")}</Alert>
        </div>
      )}
      <RefusedLine refused={save.refused} />
      {manager && people.length > 0 && <CardFoot dirty={dirty} busy={save.busy} onDiscard={onDiscard} onSave={() => void onSave()} />}
    </SetCard>
  );
}

// ── email ───────────────────────────────────────────────────────────────────

/** Adminium's Email Templates, where every email the studio sends is written. */
const EMAILS_URL = "/email-templates";

function EmailCard({ settings, people, manager }: { settings: SettingsRow | null; people: Person[]; manager: boolean }) {
  const { t, locale } = useI18n();
  const save = useSave();
  const stored = settings?.sign_off ?? null;
  const options = signOffOptions(people, stored, locale);
  const onChange = async (value: string) => {
    if (value === stored) return;
    if (await save.run(() => saveStudioSettings({ sign_off: value }))) toast(t("settings.saved"));
  };
  return (
    <SetCard icon={Mail} title={t("settings.email.title")}>
      <div className="set-card-body">
        <Field label={t("settings.email.signOff")}>
          {({ id }) => (
            <select id={id} className="input" value={stored ?? ""} disabled={!manager || save.busy} onChange={(e) => void onChange(e.target.value)}>
              {stored === null && <option value="">{t("settings.email.signOffNone")}</option>}
              {options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          )}
        </Field>
        <a className="btn ol-gi btn--wide set-email-link" href={EMAILS_URL} target="_blank" rel="noopener">
          <ArrowUpRight size={15} aria-hidden="true" />
          {t("settings.email.all")}
        </a>
      </div>
      <RefusedLine refused={save.refused} />
    </SetCard>
  );
}

// ── tell us when ────────────────────────────────────────────────────────────

function TellCard({ settings, manager }: { settings: SettingsRow | null; manager: boolean }) {
  const { t } = useI18n();
  const base = useId();
  const [draft, setDraft] = useState<NoticeDraft>({});
  const save = useSave();
  const patch = noticesPatch(settings, draft);
  const dirty = Object.keys(patch).length > 0;
  const on = (n: Notice) => draft[n] ?? settings?.[n] ?? false;
  const onSave = async () => {
    if (!dirty) return toast(t("settings.nothingChanged"));
    if (await save.run(() => saveStudioSettings(patch))) {
      setDraft({});
      toast(t("settings.saved"));
    }
  };
  const onDiscard = () => {
    if (!dirty) return toast(t("settings.nothingChanged"));
    setDraft({});
    save.setRefused(null);
    toast(t("settings.discarded"), { icon: "undo-2" });
  };
  const address = settings?.reply_to ?? null;
  return (
    <SetCard icon={Bell} title={t("settings.tell.title")}>
      <ul className="set-rows" role="list">
        {NOTICES.map((n) => (
          <li key={n} className="set-row">
            <span id={`${base}-${n}`} className="set-tell-label">
              {t(`settings.tell.${n}` as MessageKey)}
            </span>
            <Switch on={on(n)} labelledBy={`${base}-${n}`} disabled={!manager} onToggle={() => setDraft((d) => ({ ...d, [n]: !on(n) }))} />
          </li>
        ))}
      </ul>
      <p className="set-note">{address === null || address === "" ? t("settings.tell.footNoAddress") : t("settings.tell.foot", { address })}</p>
      <RefusedLine refused={save.refused} />
      {manager && <CardFoot dirty={dirty} busy={save.busy} onDiscard={onDiscard} onSave={() => void onSave()} />}
    </SetCard>
  );
}

// ── Invoices & receipts ─────────────────────────────────────────────────────

/** The last number each series gave, read from the rows (a label; the server numbers). */
function useLastNumbers(): Record<Series["id"], number | null> | null {
  const [last, setLast] = useState<Record<Series["id"], number | null> | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.all(
      SERIES.map(async (s) => {
        try {
          const page = await loadPage(s.table, { where: { column: "number_seq", op: "not_null" }, order: "number_seq.desc", limit: 1, offset: 0 });
          const id = page.ids[0];
          const row = id === undefined ? undefined : (useDesk.getState().rows[s.table][id] as { number_seq: number | null } | undefined);
          return [s.id, row?.number_seq ?? null] as const;
        } catch {
          return [s.id, null] as const;
        }
      }),
    ).then((pairs) => {
      if (live) setLast(Object.fromEntries(pairs) as Record<Series["id"], number | null>);
    });
    return () => {
      live = false;
    };
  }, []);
  return last;
}

function StartPopover({ series, next, prefix, onClose, onSaved }: { series: Series; next: number; prefix: unknown; onClose: () => void; onSaved: (value: number) => void }) {
  const { t } = useI18n();
  const [typed, setTyped] = useState(String(next + 1));
  const [error, setError] = useState(false);
  const save = useSave();
  const input = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const shownPrefix = typeof prefix === "string" && prefix !== "" ? prefix : series.fallback;
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const onSubmit = async () => {
    const n = newStart(typed, next);
    if (n === null) return setError(true);
    if (await save.run(() => saveInvoiceSettings({ [series.start]: n }))) {
      toast(t("settings.inv.startDone", { number: formatNumber(prefix, n, series.fallback) }));
      onSaved(n);
    }
  };
  return (
    <div
      className="set-pop"
      role="dialog"
      aria-labelledby={titleId}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="set-pop-head">
        <span id={titleId} className="set-pop-title">
          {t("settings.inv.startTitle", { prefix: shownPrefix })}
        </span>
      </div>
      <p className="set-pop-sub">{t("settings.inv.startSub", { number: formatNumber(prefix, next, series.fallback) })}</p>
      <Field label={t("settings.inv.startField")} error={error ? t("settings.inv.startError", { n: String(next) }) : undefined}>
        {({ id, describedBy, invalid }) => (
          <input
            ref={input}
            id={id}
            className="input set-mono"
            dir="ltr"
            inputMode="numeric"
            value={typed}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            onChange={(e) => {
              setTyped(e.target.value);
              setError(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void onSubmit();
            }}
          />
        )}
      </Field>
      <RefusedLine refused={save.refused} />
      <div className="set-pop-actions">
        <Button size="small" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button kind="primary" size="small" busy={save.busy} onClick={() => void onSubmit()}>
          {t("settings.inv.changeStart")}
        </Button>
      </div>
    </div>
  );
}

function InvoiceCard() {
  const { t, locale } = useI18n();
  const base = useId();
  const [read, setRead] = useState<InvoiceSettingsRead | null>(null);
  const [form, setForm] = useState<InvoiceForm | null>(null);
  const [shown, setShown] = useState(false);
  const [popFor, setPopFor] = useState<Series["id"] | null>(null);
  const save = useSave();
  const last = useLastNumbers();

  const reload = () => {
    setRead(null);
    void readInvoiceSettings().then((r) => {
      setRead(r);
      setForm(r.state === "ready" ? invoiceFormOf(r.settings.values) : null);
    });
  };
  useEffect(reload, []);

  const body = (() => {
    if (read === null) return <p className="set-empty">{t("common.loading")}</p>;
    if (read.state === "absent") return <p className="set-empty">{t("settings.inv.absent")}</p>;
    if (read.state === "unreadable") return <p className="set-empty">{t("settings.inv.unreadable")}</p>;
    if (read.state === "failed")
      return (
        <div className="set-card-body">
          <Alert>{t("settings.inv.failed")}</Alert>
          <Button size="small" onClick={reload}>
            {t("common.retry")}
          </Button>
        </div>
      );
    return null;
  })();

  if (body !== null || read === null || read.state !== "ready" || form === null) {
    return (
      <SetCard icon={ReceiptText} title={t("settings.inv.title")} sub={t("settings.inv.sub")} id="set-invoicing">
        {body}
      </SetCard>
    );
  }

  const stored = read.settings.values;
  const declared = read.settings.declared;
  const patch = invoicePatch(stored, form, declared);
  const dirty = Object.keys(patch).length > 0;
  const errors = shown ? invoiceErrors(form) : {};
  const set = (next: Partial<InvoiceForm>) => setForm((f) => (f === null ? f : { ...f, ...next }));
  const has = (key: string) => declared.includes(key);

  const onSave = async () => {
    if (!dirty) return toast(t("settings.nothingChanged"));
    setShown(true);
    if (Object.keys(invoiceErrors(form)).length > 0) return;
    const ok = await save.run(() => saveInvoiceSettings(patch));
    if (ok) {
      const values = { ...stored, ...patch };
      setRead({ state: "ready", settings: { values, declared } });
      setForm(invoiceFormOf(values));
      setShown(false);
      toast(t("settings.inv.saved"));
    }
  };
  const onDiscard = () => {
    if (!dirty) return toast(t("settings.nothingChanged"));
    setForm(invoiceFormOf(stored));
    setShown(false);
    save.setRefused(null);
    toast(t("settings.discarded"), { icon: "undo-2" });
  };
  const onStartSaved = (s: Series, n: number) => {
    setRead({ state: "ready", settings: { values: { ...stored, [s.start]: n }, declared } });
    setPopFor(null);
  };

  const text = (key: "business_name" | "tax_name" | "tax_number" | "default_tax_rate", label: MessageKey, opts: { hint?: MessageKey; mono?: boolean; decimal?: boolean } = {}) =>
    has(key) && (
      <Field label={t(label)} hint={opts.hint === undefined ? undefined : t(opts.hint)} error={key === "default_tax_rate" && errors.default_tax_rate !== undefined ? t("settings.inv.error.taxRate") : undefined}>
        {({ id, describedBy, invalid }) => (
          <input id={id} className={`input${opts.mono === true ? " set-mono" : ""}`} dir={opts.mono === true ? "ltr" : undefined} inputMode={opts.decimal === true ? "decimal" : "text"} value={form[key]} aria-describedby={describedBy} aria-invalid={invalid} onChange={(e) => set({ [key]: e.target.value })} />
        )}
      </Field>
    );
  const area = (key: "business_lines" | "payment_instructions" | "footer", label: MessageKey, rows: number, hint?: MessageKey) =>
    has(key) && (
      <Field label={t(label)} hint={hint === undefined ? undefined : t(hint)}>
        {({ id, describedBy }) => <textarea id={id} className="input" rows={rows} value={form[key]} aria-describedby={describedBy} onChange={(e) => set({ [key]: e.target.value })} />}
      </Field>
    );

  return (
    <SetCard icon={ReceiptText} title={t("settings.inv.title")} sub={t("settings.inv.sub")} id="set-invoicing">
      <div className="set-card-body set-card-body--pop">
        {text("business_name", "settings.inv.legal")}
        {area("business_lines", "settings.inv.address", 2, "settings.inv.addressHint")}
        {text("tax_name", "settings.inv.taxName", { hint: "settings.inv.taxNameHint" })}
        {text("tax_number", "settings.inv.taxNumber", { mono: true })}
        <div className="field">
          <span className="field-label" id={`${base}-cur`}>
            {t("settings.inv.currency")}
          </span>
          <span className="set-readonly" aria-labelledby={`${base}-cur`} aria-describedby={`${base}-cur-hint`}>
            {currencyName(tenantCurrency(), locale)}
          </span>
          <span className="field-hint" id={`${base}-cur-hint`}>
            {t("settings.inv.currencyHint")}
          </span>
        </div>
        {text("default_tax_rate", "settings.inv.taxRate", { hint: "settings.inv.taxRateHint", mono: true, decimal: true })}
        {area("payment_instructions", "settings.inv.payHow", 3, "settings.inv.payHowHint")}

        <div className="field set-numbers-field">
          <span className="field-label" id={`${base}-num`}>
            {t("settings.inv.numbers")}
          </span>
          <ul className="set-numbers" role="list" aria-labelledby={`${base}-num`}>
            {SERIES.filter((s) => has(s.start)).map((s) => {
              const next = nextInSeries(last?.[s.id] ?? null, stored[s.start]);
              return (
                <li key={s.id} className="set-number">
                  <span className="set-mono set-number-next">{last === null ? "…" : formatNumber(stored[s.prefix], next, s.fallback)}</span>
                  <span className="set-number-label">{t(`settings.inv.next.${s.id}` as MessageKey)}</span>
                  <button type="button" className="set-link-text set-number-change ol-gi" aria-expanded={popFor === s.id} disabled={last === null} onClick={() => setPopFor((v) => (v === s.id ? null : s.id))}>
                    {t("settings.inv.changeStart")}
                  </button>
                </li>
              );
            })}
          </ul>
          {popFor !== null &&
            (() => {
              const s = SERIES.find((x) => x.id === popFor)!;
              return <StartPopover key={s.id} series={s} next={nextInSeries(last?.[s.id] ?? null, stored[s.start])} prefix={stored[s.prefix]} onClose={() => setPopFor(null)} onSaved={(n) => onStartSaved(s, n)} />;
            })()}
        </div>
        {has("default_terms") && (
          <Field label={t("settings.inv.terms")}>
            {({ id }) => (
              <select id={id} className="input" value={form.default_terms} onChange={(e) => set({ default_terms: e.target.value as InvoiceForm["default_terms"] })}>
                {TERMS.map((term) => (
                  <option key={term} value={term}>
                    {t(`settings.inv.term.${term}` as MessageKey)}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        {area("footer", "settings.inv.footer", 3)}
        {has("show_payment_ledger") && (
          <div className="set-toggle-box">
            <span className="set-toggle-text">
              <span id={`${base}-ledger`} className="set-toggle-title">
                {t("settings.inv.ledger")}
              </span>
              <span id={`${base}-ledger-sub`} className="set-toggle-sub">
                {t("settings.inv.ledgerSub")}
              </span>
            </span>
            <Switch on={form.show_payment_ledger} labelledBy={`${base}-ledger`} onToggle={() => set({ show_payment_ledger: !form.show_payment_ledger })} />
          </div>
        )}
        {has("ladders") && has("default_ladder") && (
          <div className="field">
            <span className="field-label" id={`${base}-ladder`}>
              {t("settings.inv.ladder")}
            </span>
            <div className="filters" role="group" aria-labelledby={`${base}-ladder`}>
              {LADDERS.map((l) => (
                <button key={l} type="button" className="filter ol-chip" aria-pressed={form.default_ladder === l} onClick={() => set({ default_ladder: l })}>
                  {t(`settings.inv.ladder.${l}` as MessageKey)}
                </button>
              ))}
            </div>
            <ul className="set-numbers" role="list">
              {LADDERS.map((l) => (
                <li key={l} className="set-ladder-row">
                  <span className="set-ladder-name">{t(`settings.inv.ladder.${l}` as MessageKey)}</span>
                  {form.ladders[l].map((d, i) => (
                    <input
                      key={i}
                      className="input set-mono set-ladder-day"
                      dir="ltr"
                      inputMode="numeric"
                      value={d}
                      aria-label={t("settings.inv.rungAria", { ladder: t(`settings.inv.ladder.${l}` as MessageKey), n: String(i + 1) })}
                      aria-invalid={errors[l] !== undefined}
                      aria-describedby={errors[l] === undefined ? undefined : `${base}-${l}-err`}
                      onChange={(e) => {
                        const days = [...form.ladders[l]] as [string, string, string];
                        days[i] = e.target.value;
                        set({ ladders: { ...form.ladders, [l]: days } });
                      }}
                    />
                  ))}
                  <span className="set-ladder-unit">{t("settings.inv.daysPast")}</span>
                  {errors[l] !== undefined && (
                    <span className="field-error set-ladder-error" id={`${base}-${l}-err`}>
                      {t(`settings.inv.error.${errors[l]}` as MessageKey)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {save.refused !== null && (
        <div className="set-card-alert">
          <Alert>{save.refused.code === "SETTING_INVALID" ? t("settings.inv.refused") : t(refusalKey(save.refused.reason), { id: "", balance: "" })}</Alert>
        </div>
      )}
      <CardFoot dirty={dirty} busy={save.busy} onDiscard={onDiscard} onSave={() => void onSave()} />
    </SetCard>
  );
}

// ── the rate card ───────────────────────────────────────────────────────────

function RateRow({ rate, manager }: { rate: Rate; manager: boolean }) {
  const { t, locale } = useI18n();
  const [typed, setTyped] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const errId = useId();
  const symbol = currencySymbol(tenantCurrency(), locale);
  const onCommit = async () => {
    if (typed === null) return;
    const amount = rateAmount(typed);
    if (amount === null) return setError(t("settings.rates.error"));
    if (amount === rate.amount) return setTyped(null);
    const out = await saveRate(rate.id, { amount });
    if (!out.ok) return setError(t(refusalKey(out.reason), { id: "", balance: "" }));
    setTyped(null);
    setError(null);
    toast(t("settings.saved"));
  };
  return (
    <li className="set-row set-rate">
      {manager ? (
        <button type="button" className="set-rate-label set-link-text ol-gi" aria-label={t("settings.rates.editLabel", { label: rate.label })} onClick={() => openSheet({ kind: "add", what: "rate", about: { rateId: rate.id } })}>
          {rate.label}
        </button>
      ) : (
        <span className="set-rate-label">{rate.label}</span>
      )}
      <span className="set-rate-cur" aria-hidden="true">
        {symbol}
      </span>
      <input
        className="input set-mono set-rate-amount"
        dir="ltr"
        inputMode="decimal"
        value={typed ?? rate.amount}
        readOnly={!manager}
        aria-label={t("settings.rates.amountLabel", { label: rate.label })}
        aria-invalid={error !== null}
        aria-describedby={error === null ? undefined : errId}
        onChange={(e) => {
          setTyped(e.target.value);
          setError(null);
        }}
        onBlur={() => void onCommit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") void onCommit();
        }}
      />
      {error !== null && (
        <span className="field-error set-rate-error" id={errId}>
          {error}
        </span>
      )}
    </li>
  );
}

function RateCard({ rates, settings, manager }: { rates: Rate[]; settings: SettingsRow | null; manager: boolean }) {
  const { t, money } = useI18n();
  const hourly = hourlyRate(rates[0]?.amount, settings?.hours_per_day);
  return (
    <SetCard
      icon={Ruler}
      title={t("settings.rates.title")}
      action={
        <>
          {manager && (
            <Button size="small" icon={Plus} className="set-head-btn" onClick={() => openSheet({ kind: "add", what: "rate" })}>
              {t("settings.rates.add")}
            </Button>
          )}
          {hourly !== null && <span className="set-hourly">{t("settings.rates.hourly", { amount: money(hourly) })}</span>}
        </>
      }
    >
      {rates.length === 0 && <p className="set-empty">{t("settings.rates.empty")}</p>}
      <ul className="set-rows" role="list">
        {rates.map((r) => (
          <RateRow key={r.id} rate={r} manager={manager} />
        ))}
      </ul>
      <p className="set-note">{t("settings.rates.note")}</p>
    </SetCard>
  );
}

// ── the screen ──────────────────────────────────────────────────────────────

export default function Settings() {
  const { t } = useI18n();
  const manager = useManager();
  const settings = useSettings();
  const peopleRows = useRows("people");
  const rateRows = useRows("rates");
  const people = useMemo(() => [...peopleRows].sort((a, b) => a.position - b.position || a.id - b.id), [peopleRows]);
  const rates = useMemo(() => rateRows.filter((r) => r.active).sort((a, b) => a.position - b.position || a.id - b.id), [rateRows]);
  return (
    <section className="screen ol-screen set-screen" data-screen="settings" aria-labelledby="settings-title">
      <div>
        <ScreenHead id="settings-title" title={t("nav.settings")} lead={t("settings.lead")} />
        <div className="set-links">
          <Button icon={FileSignature} onClick={() => go("terms")}>
            {t("nav.terms")}
          </Button>
        </div>
      </div>
      {!manager && <Alert tone="warn">{t("settings.readOnly")}</Alert>}
      <div className="set-cols">
        <div className="set-col">
          <StudioCard settings={settings} manager={manager} />
          <PeopleCard people={people} manager={manager} />
          <EmailCard settings={settings} people={people} manager={manager} />
          <TellCard settings={settings} manager={manager} />
        </div>
        <div className="set-col">
          {manager && <InvoiceCard />}
          <RateCard rates={rates} settings={settings} manager={manager} />
        </div>
      </div>
    </section>
  );
}
