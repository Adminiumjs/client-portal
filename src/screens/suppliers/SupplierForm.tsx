/**
 * "A new name" — and the same fields to change one: who they are, what for,
 * who to ask for, their email and phone, the postal address, the lead time,
 * what it costs, and what to remember. The number (`SUP-…`) is Adminium's.
 */
import { useId, useState } from "react";
import { Check, Trash2, UserRoundPlus } from "lucide-react";

import { Alert, Button } from "../../components/ui.tsx";
import type { Supplier, SupplierKind } from "../../data/types.ts";
import { useI18n } from "../../i18n/index.tsx";
import { useCan } from "../../state/desk.ts";
import { addSupplier, editSupplier, removeSupplier, type SupplierInput } from "../../state/officeActions.ts";
import type { Outcome } from "../../state/outcome.ts";
import { refusalKey } from "../../state/outcome.ts";
import { toast } from "../../state/ui.ts";
import { SUPPLIER_KINDS } from "./model.ts";

type Text = "name" | "contact" | "email" | "phone" | "lead_time" | "typical_cost" | "address" | "note";
type Values = Record<Text, string> & { kind: SupplierKind };

/** The one-line fields after the name and the kind, in the form's order. */
const FIELDS: readonly { key: "contact" | "email" | "phone" | "lead_time" | "typical_cost"; mono?: boolean; type?: string }[] = [
  { key: "contact" },
  { key: "email", mono: true, type: "email" },
  { key: "phone", mono: true, type: "tel" },
  { key: "lead_time" },
  { key: "typical_cost" },
];

const valuesOf = (s: Supplier | null, kind: SupplierKind): Values => ({
  name: s?.name ?? "",
  kind: s?.kind ?? kind,
  contact: s?.contact ?? "",
  email: s?.email ?? "",
  phone: s?.phone ?? "",
  lead_time: s?.lead_time ?? "",
  typical_cost: s?.typical_cost ?? "",
  address: s?.address ?? "",
  note: s?.note ?? "",
});

/** What a refused supplier save says. */
function problemOf(out: Extract<Outcome<unknown>, { ok: false }>, t: ReturnType<typeof useI18n>["t"]): { field: Text | null; text: string } {
  if (out.code === "NAME_REQUIRED") return { field: "name", text: t("suppliers.form.needName") };
  if (out.code === "FK_VIOLATION") return { field: null, text: t("suppliers.form.inUse") };
  if (out.field === "email") return { field: "email", text: t("suppliers.form.badEmail") };
  return { field: null, text: t(refusalKey(out.reason), { id: "", balance: "" }) };
}

export function SupplierForm({ supplier, defaultKind, onClose, onSaved }: { supplier: Supplier | null; defaultKind: SupplierKind; onClose: () => void; onSaved: (s: Supplier | null) => void }) {
  const { t } = useI18n();
  const id = useId();
  const mayRemove = useCan("suppliers", "delete");
  const [values, setValues] = useState<Values>(() => valuesOf(supplier, defaultKind));
  const [problem, setProblem] = useState<{ field: Text | null; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);

  const set = (patch: Partial<Values>) => {
    setValues((v) => ({ ...v, ...patch }));
    setProblem(null);
  };

  const save = async () => {
    const input: SupplierInput = { ...values };
    setBusy(true);
    const out = supplier === null ? await addSupplier(input) : await editSupplier(supplier.id, input);
    setBusy(false);
    if (!out.ok) return setProblem(problemOf(out, t));
    toast(supplier === null ? t("suppliers.form.added", { name: out.value.name }) : t("suppliers.form.changed", { name: out.value.name }), { icon: "truck" });
    onSaved(out.value);
  };

  const remove = async () => {
    if (supplier === null) return;
    setBusy(true);
    const out = await removeSupplier(supplier.id);
    setBusy(false);
    if (!out.ok) return setProblem(problemOf(out, t));
    toast(t("suppliers.form.removed", { name: supplier.name }), { icon: "check" });
    onSaved(null);
  };

  const errorId = `${id}-error`;
  const bad = (field: Text) => (problem?.field === field ? { "aria-invalid": true, "aria-describedby": errorId } : {});
  const titleId = `${id}-title`;

  return (
    <section className="card sup-form" aria-labelledby={titleId}>
      <div className="sup-head">
        <UserRoundPlus size={15} aria-hidden="true" />
        <h2 className="sup-h2" id={titleId}>
          {supplier === null ? t("suppliers.form.title") : t("suppliers.form.editTitle", { name: supplier.name })}
        </h2>
      </div>
      <form
        className="sup-form-body"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="sup-form-grid">
          <label className="ex-fld">
            <span className="ex-fld-k">{t("suppliers.form.name")}</span>
            <input className="ex-input" value={values.name} maxLength={160} placeholder={t("suppliers.form.namePh")} onChange={(e) => set({ name: e.target.value })} {...bad("name")} />
          </label>
          <label className="ex-fld">
            <span className="ex-fld-k">{t("suppliers.form.kind")}</span>
            <select className="ex-input" value={values.kind} onChange={(e) => set({ kind: e.target.value as SupplierKind })}>
              {SUPPLIER_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`suppliers.kind.${k}`)}
                </option>
              ))}
            </select>
          </label>
          {FIELDS.map((f) => (
            <label key={f.key} className="ex-fld">
              <span className="ex-fld-k">{t(`suppliers.form.${f.key}`)}</span>
              <input
                className={`ex-input${f.mono === true ? " ex-input--mono" : ""}`}
                type={f.type ?? "text"}
                value={values[f.key]}
                maxLength={f.key === "email" ? 254 : f.key === "phone" ? 40 : 160}
                placeholder={t(`suppliers.form.${f.key}Ph`)}
                onChange={(e) => set({ [f.key]: e.target.value } as Partial<Values>)}
                {...bad(f.key)}
              />
            </label>
          ))}
          <label className="ex-fld sup-fld--wide">
            <span className="ex-fld-k">{t("suppliers.form.address")}</span>
            <textarea className="ex-input sup-textarea" rows={2} value={values.address} maxLength={500} placeholder={t("suppliers.form.addressPh")} onChange={(e) => set({ address: e.target.value })} />
          </label>
          <label className="ex-fld sup-fld--wide">
            <span className="ex-fld-k">{t("suppliers.detail.remember")}</span>
            <textarea className="ex-input sup-textarea" rows={2} value={values.note} maxLength={1000} placeholder={t("suppliers.detail.rememberPh")} onChange={(e) => set({ note: e.target.value })} />
          </label>
        </div>
        {problem !== null && (
          <span className="ex-form-err" id={errorId} role="alert">
            {problem.text}
          </span>
        )}
        {asking && (
          <Alert tone="warn">{t("suppliers.form.removeAsk", { name: supplier?.name ?? "" })}</Alert>
        )}
        <div className="ex-form-actions">
          <Button kind="primary" type="submit" icon={Check} busy={busy && !asking}>
            {supplier === null ? t("suppliers.form.save") : t("suppliers.form.saveChanges")}
          </Button>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          {supplier !== null && mayRemove && (
            <Button kind="danger" icon={Trash2} className="sup-remove" busy={busy && asking} onClick={() => (asking ? void remove() : setAsking(true))}>
              {asking ? t("suppliers.form.removeYes") : t("suppliers.form.remove")}
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}
