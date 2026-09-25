/**
 * Suppliers: the studio's address book — the press, the courier, the type
 * foundry — and what went through each of them.
 *
 * Purchases name their supplier, so every figure here comes from Expenses:
 * what was spent through suppliers this year (and across how many of them),
 * the biggest, how many were never used; where the money went, by kind (a bar
 * filters the book to that kind); the book, filtered by kind, with each
 * name's kind, when they were last used and this year's spend; and one
 * supplier open beside it — who to ask for, email, phone, address (each can
 * be copied, and "Email" writes to them), lead time, what it costs, what
 * they were last used for, how many purchases went through them, whether
 * we'd use them again, what to remember, and what we bought from them.
 *
 * "Add a supplier" opens "A new name" in place; "Change" opens the same form
 * for the one on show. Their number is Adminium's.
 */
import { useEffect, useMemo, useState } from "react";
import { AtSign, ChartNoAxesColumn, CircleCheck, CircleDashed, Copy, Mail, Pencil, Plus, ThumbsDown, ThumbsUp, Truck, Wallet } from "lucide-react";

import { DayText, Filters, IconButton, Money, ScreenHead } from "../components/ui.tsx";
import type { Id, SupplierKind } from "../data/types.ts";
import { useI18n } from "../i18n/index.tsx";
import { today } from "../lib/clock.ts";
import { dayLabel } from "../lib/dates.ts";
import { ensureRows, useDesk, useRows } from "../state/desk.ts";
import { linesCarrying } from "../state/invoiceDrafts.ts";
import { editSupplier, loadPurchases, loadSuppliers } from "../state/officeActions.ts";
import { refusalKey } from "../state/outcome.ts";
import { go, toast } from "../state/ui.ts";
import { carriersOf, standingOf } from "./expenses/model.ts";
import { barPercent, bookFigures, postalAddress, type SupplierFigures } from "./suppliers/model.ts";
import { SupplierForm } from "./suppliers/SupplierForm.tsx";

type KindFilter = "all" | SupplierKind;

async function copy(text: string): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || navigator.clipboard === undefined) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export default function Suppliers() {
  const { t, money, number, locale } = useI18n();
  const day = useDesk((s) => s.today) || today();
  const suppliers = useRows("suppliers");
  const expenses = useRows("expenses");
  const [filter, setFilter] = useState<KindFilter>("all");
  const [chosen, setChosen] = useState<Id | null>(null);
  const [form, setForm] = useState<"add" | "edit" | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        await loadSuppliers();
        const rows = await loadPurchases(null);
        await ensureRows("invoices", linesCarrying("expense_id", rows.map((r) => r.id)).map((l) => l.document_id));
      } catch {
        // What the desk holds is drawn.
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  // The book in the order the names were added.
  const book = useMemo(() => [...suppliers].sort((a, b) => a.id - b.id), [suppliers]);
  const figures = useMemo(() => bookFigures(book, expenses, day), [book, expenses, day]);
  const rows = useMemo(() => book.filter((s) => filter === "all" || s.kind === filter), [book, filter]);
  const shown: SupplierFigures | undefined = figures.bySupplier.get(chosen ?? -1) ?? (rows[0] === undefined ? undefined : figures.bySupplier.get(rows[0].id)) ?? (book[0] === undefined ? undefined : figures.bySupplier.get(book[0].id));
  const kindWord = (k: SupplierKind) => t(`suppliers.kind.${k}`);
  // At phone width the supplier opens below the book: bring it into view.
  const choose = (id: Id) => {
    setChosen(id);
    requestAnimationFrame(() => {
      const card = document.getElementById("sup-name")?.closest(".sup-card");
      if (card instanceof HTMLElement && card.getBoundingClientRect().top > window.innerHeight * 0.6) card.scrollIntoView({ block: "start" });
    });
  };
  const largest = figures.byKind[0]?.spend ?? "0";

  return (
    <section className="screen ol-screen sup-screen" data-screen="suppliers" aria-labelledby="suppliers-title">
      <ScreenHead id="suppliers-title" title={t("nav.suppliers")} lead={t("suppliers.lead")} />

      <div className="ex-kpis sup-kpis">
        <div className="ex-kpi sup-kpi" data-kpi="spent">
          <span className="ex-kpi-k">{t("suppliers.kpi.spent")}</span>
          <span className="ex-kpi-v sup-kpi-v money">{money(figures.total)}</span>
          <span className="ex-kpi-sub">{t("suppliers.kpi.spentSub", { used: number(figures.used), n: number(book.length) }, book.length)}</span>
        </div>
        <div className="ex-kpi sup-kpi" data-kpi="biggest">
          <span className="ex-kpi-k">{t("suppliers.kpi.biggest")}</span>
          <span className="sup-kpi-name">{figures.biggest?.supplier.name ?? "—"}</span>
          <span className="ex-kpi-sub">{figures.biggest === null ? t("suppliers.kpi.biggestNone") : `${money(figures.biggest.spend)} · ${kindWord(figures.biggest.supplier.kind).toLocaleLowerCase(locale)}`}</span>
        </div>
        <div className="ex-kpi sup-kpi" data-kpi="never">
          <span className="ex-kpi-k">{t("suppliers.kpi.never")}</span>
          <span className="ex-kpi-v sup-kpi-v sup-kpi-v--quiet money">{number(figures.never)}</span>
          <span className="ex-kpi-sub">{t("suppliers.kpi.neverSub")}</span>
        </div>
      </div>

      <section className="card sup-where" aria-labelledby="sup-where-title">
        <div className="sup-head">
          <ChartNoAxesColumn size={15} aria-hidden="true" />
          <h2 className="sup-h2" id="sup-where-title">
            {t("suppliers.where.title")}
          </h2>
          <span className="sup-head-aside money">{t("suppliers.where.aside", { amount: money(figures.total), year: number(figures.year, { useGrouping: false }) })}</span>
        </div>
        {figures.byKind.map((k) => (
          <button key={k.kind} type="button" className="sup-bar-row ol-row" aria-pressed={filter === k.kind} onClick={() => setFilter(filter === k.kind ? "all" : k.kind)}>
            <span className="sup-bar-k">{kindWord(k.kind)}</span>
            <span className="sup-bar" aria-hidden="true">
              <span className={`sup-bar-fill${(Number(k.spend) || 0) > 0 ? "" : " sup-bar-fill--none"}`} style={{ width: `${String(barPercent(k.spend, largest))}%` }} />
            </span>
            <span className="sup-bar-v money">{money(k.spend)}</span>
          </button>
        ))}
      </section>

      <div className="sup-filter-row">
        <Filters
          label={t("suppliers.filter.label")}
          value={filter}
          onChange={setFilter}
          items={[{ id: "all" as KindFilter, label: t("suppliers.filter.all"), count: book.length }, ...figures.kinds.map((k) => ({ id: k.kind as KindFilter, label: kindWord(k.kind), count: k.count }))]}
        />
        <button type="button" className="sup-add ol-gi" aria-expanded={form === "add"} onClick={() => setForm("add")}>
          <Plus size={14} aria-hidden="true" />
          {t("suppliers.add")}
        </button>
      </div>

      {form !== null && (
        <SupplierForm
          key={form === "edit" ? `edit-${String(shown?.supplier.id)}` : "add"}
          supplier={form === "edit" ? (shown?.supplier ?? null) : null}
          defaultKind={figures.kinds[0]?.kind ?? "print"}
          onClose={() => setForm(null)}
          onSaved={(s) => {
            setForm(null);
            setChosen(s === null ? null : s.id);
            if (s !== null) setFilter((f) => (f === "all" || f === s.kind ? f : "all"));
          }}
        />
      )}

      <div className="sup-cols">
        <section className="card sup-book" aria-labelledby="sup-book-title">
          <div className="sup-head">
            <Truck size={15} aria-hidden="true" />
            <h2 className="sup-h2" id="sup-book-title">
              {t("suppliers.book.title")}
            </h2>
            <span className="sup-head-aside money">{t("suppliers.book.aside", { amount: money(figures.total) })}</span>
          </div>
          {rows.length === 0 ? (
            <p className="sup-quiet">{loading ? t("common.loading") : t("suppliers.book.empty")}</p>
          ) : (
            <ul className="sup-list" aria-label={t("suppliers.book.title")}>
              {rows.map((s) => {
                const f = figures.bySupplier.get(s.id)!;
                return (
                  <li key={s.id}>
                    <button type="button" className="sup-row ol-row" aria-current={s.id === shown?.supplier.id ? "true" : undefined} onClick={() => choose(s.id)}>
                      <span className="sup-ini" aria-hidden="true">
                        {initialsOf(s.name)}
                      </span>
                      <span className="sup-row-main">
                        <span className="sup-row-name">{s.name}</span>
                        <span className="sup-row-sub">
                          {kindWord(s.kind)} · {f.last === null ? t("suppliers.book.never") : t("suppliers.book.lastUsed", { day: dayLabel(f.last.date, locale) })}
                        </span>
                      </span>
                      <span className="sup-row-v money">{money(f.spend)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="sup-foot">{t("suppliers.book.foot", { n: number(book.length) }, book.length)}</div>
        </section>

        {shown !== undefined ? <SupplierDetail figures={shown} onEdit={() => setForm("edit")} /> : <div />}
      </div>
    </section>
  );
}

const initialsOf = (name: string): string =>
  name
    .split(/[\s&]+/)
    .filter((w) => w !== "")
    .slice(0, 2)
    .map((w) => w.charAt(0).toLocaleUpperCase())
    .join("");

function SupplierDetail({ figures, onEdit }: { figures: SupplierFigures; onEdit: () => void }) {
  const { t, money, number, locale } = useI18n();
  const s = figures.supplier;
  const lines = useRows("invoice_lines");
  const invoices = useDesk((st) => st.rows.invoices);
  const clients = useDesk((st) => st.rows.clients);
  const projects = useDesk((st) => st.rows.projects);
  const settings = useDesk((st) => Object.values(st.rows.settings)[0] ?? null);
  const carriers = useMemo(() => carriersOf(lines, invoices), [lines, invoices]);
  const [note, setNote] = useState(s.note ?? "");
  const [noteState, setNoteState] = useState<"idle" | "saving" | "saved" | string>("idle");
  const [againBusy, setAgainBusy] = useState(false);

  useEffect(() => {
    setNote(s.note ?? "");
    setNoteState("idle");
  }, [s.id, s.note]);

  const dash = "—";
  const last = figures.last;
  const lastFor = last === null ? null : last.client_id === null ? null : (clients[last.client_id]?.company ?? null);
  const fields: { k: string; v: string; mono?: boolean; pre?: boolean; quiet?: boolean }[] = [
    { k: t("suppliers.form.contact"), v: s.contact ?? dash },
    { k: t("suppliers.form.email"), v: s.email ?? dash, mono: true },
    { k: t("suppliers.form.phone"), v: s.phone ?? dash, mono: true },
    { k: t("suppliers.form.address"), v: s.address ?? dash, pre: true },
    { k: t("suppliers.form.lead_time"), v: s.lead_time ?? dash },
    { k: t("suppliers.form.typical_cost"), v: s.typical_cost ?? t("suppliers.detail.notQuoted") },
    {
      k: t("suppliers.detail.lastUsedFor"),
      v:
        last === null
          ? t("suppliers.detail.nothingYet")
          : [last.what, dayLabel(last.date, locale, "long"), lastFor === null ? null : t("suppliers.detail.lastFor", { company: lastFor })].filter((x) => x !== null).join(" · "),
      quiet: true,
    },
  ];

  const count = figures.purchases.length;
  const again = s.would_use_again;

  const saveNote = async () => {
    if (note === (s.note ?? "")) return;
    setNoteState("saving");
    const out = await editSupplier(s.id, { note });
    setNoteState(out.ok ? "saved" : t(refusalKey(out.reason), { id: "", balance: "" }));
  };

  const toggleAgain = async () => {
    setAgainBusy(true);
    const out = await editSupplier(s.id, { would_use_again: !again });
    setAgainBusy(false);
    if (!out.ok) toast(t(refusalKey(out.reason), { id: "", balance: "" }), { icon: "alert", tone: "danger" });
  };

  const copyAddress = async () => {
    const ok = await copy(postalAddress(s));
    toast(ok ? t("suppliers.detail.addressCopied") : t("suppliers.detail.addressBlocked"), { icon: ok ? "check" : "info" });
  };
  const copyEmail = async () => {
    const ok = await copy(s.email ?? "");
    toast(ok ? t("suppliers.detail.emailCopied", { email: s.email ?? "" }) : t("suppliers.detail.emailBlocked"), { icon: ok ? "check" : "info" });
  };

  const who = (companyId: Id | null, projectId: Id | null): string => {
    if (companyId === null) return t("expenses.row.overhead", { studio: settings?.name ?? "" });
    const company = clients[companyId]?.company ?? "";
    const project = projectId === null ? null : (projects[projectId]?.number ?? null);
    return project === null ? company : `${company} · ${project}`;
  };

  return (
    <div className="sup-detail">
      <section className="card sup-card" aria-labelledby="sup-name">
        <div className="sup-card-head">
          <span className="sup-ini sup-ini--big" aria-hidden="true">
            {initialsOf(s.name)}
          </span>
          <span className="sup-card-names">
            <h2 className="sup-card-name" id="sup-name">
              {s.name}
            </h2>
            <span className="sup-card-kind">{[t(`suppliers.kind.${s.kind}`), s.number].filter((x) => x !== null && x !== "").join(" · ")}</span>
          </span>
          <span className="sup-card-actions">
            {s.address !== null && s.address.trim() !== "" && (
              <button type="button" className="sup-act ol-gi" onClick={() => void copyAddress()}>
                <Copy size={14} aria-hidden="true" />
                {t("suppliers.detail.copyAddress")}
              </button>
            )}
            {s.email !== null && (
              <>
                <button type="button" className="sup-act ol-gi" onClick={() => void copyEmail()}>
                  <AtSign size={14} aria-hidden="true" />
                  {t("suppliers.detail.copyEmail")}
                </button>
                <a className="sup-act ol-gi" href={`mailto:${s.email}`}>
                  <Mail size={14} aria-hidden="true" />
                  {t("suppliers.detail.email")}
                </a>
              </>
            )}
            <IconButton icon={Pencil} className="sup-act sup-act--icon" label={t("suppliers.detail.changeLabel", { name: s.name })} onClick={onEdit} />
          </span>
        </div>
        <dl className="sup-fields">
          {fields.map((f) => (
            <div key={f.k} className="sup-field">
              <dt>{f.k}</dt>
              <dd className={[f.mono === true ? "sup-field-v--mono" : "", f.pre === true ? "sup-field-v--pre" : "", f.quiet === true ? "sup-field-v--quiet" : ""].filter((c) => c !== "").join(" ") || undefined}>{f.v}</dd>
            </div>
          ))}
        </dl>
        <div className="sup-record">
          <span className={`pill ${count > 0 ? "pill--pos" : ""} sup-record-pill`}>
            {count > 0 ? <CircleCheck size={13} aria-hidden="true" /> : <CircleDashed size={13} aria-hidden="true" />}
            {count > 0 ? t("suppliers.detail.purchases", { count: number(count) }, count) : t("suppliers.detail.noRecord")}
          </span>
          <span className="sup-record-note">{count > 0 && last !== null ? t("suppliers.detail.recordNote", { day: dayLabel(last.date, locale, "long") }) : t("suppliers.detail.recordNone")}</span>
          <button type="button" className={`sup-again ol-chip${again ? " sup-again--on" : ""}`} aria-pressed={again} aria-busy={againBusy || undefined} disabled={againBusy} onClick={() => void toggleAgain()}>
            {again ? <ThumbsUp size={13} aria-hidden="true" /> : <ThumbsDown size={13} aria-hidden="true" />}
            {again ? t("suppliers.detail.again") : t("suppliers.detail.lastResort")}
          </button>
        </div>
        <div className="sup-note">
          <label className="ex-fld-k" htmlFor="sup-note">
            {t("suppliers.detail.remember")}
          </label>
          <textarea
            id="sup-note"
            className="ex-input sup-textarea"
            rows={3}
            maxLength={1000}
            value={note}
            placeholder={t("suppliers.detail.rememberPh")}
            aria-describedby="sup-note-state"
            onChange={(e) => {
              setNote(e.target.value);
              setNoteState("idle");
            }}
            onBlur={() => void saveNote()}
          />
          <span className="sup-note-state" id="sup-note-state" role="status">
            {noteState === "idle" ? "" : noteState === "saving" ? t("save.saving") : noteState === "saved" ? t("suppliers.detail.noteSaved") : noteState}
          </span>
        </div>
      </section>

      <section className="card sup-bought" aria-labelledby="sup-bought-title">
        <div className="sup-head">
          <Wallet size={15} aria-hidden="true" />
          <h2 className="sup-h2" id="sup-bought-title">
            {t("suppliers.bought.title")}
          </h2>
          <span className="sup-head-aside money">{t("suppliers.bought.aside", { amount: money(figures.spend) })}</span>
        </div>
        {count === 0 ? (
          <p className="sup-quiet sup-quiet--pad">{t("suppliers.bought.none", { name: s.name })}</p>
        ) : (
          <ul className="sup-buys" aria-label={t("suppliers.bought.title")}>
            {figures.purchases.map((e) => {
              const standing = standingOf(e, carriers);
              return (
                <li key={e.id}>
                  <button type="button" className="sup-buy ol-row" onClick={() => go("expenses")}>
                    <span className="sup-buy-date">
                      <DayText day={e.date} />
                    </span>
                    <span className="sup-row-main">
                      <span className="sup-buy-what">{e.what}</span>
                      <span className="sup-row-sub">{who(e.client_id, e.project_id)}</span>
                    </span>
                    <span className="sup-buy-v">
                      <Money value={e.amount} />
                    </span>
                    <span className={`pill sup-buy-pill sup-buy-pill--${standing}`}>{t(`suppliers.bought.${standing}`)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="sup-foot">{count > 0 ? t("suppliers.bought.foot") : t("suppliers.bought.footNone")}</div>
      </section>
    </div>
  );
}

