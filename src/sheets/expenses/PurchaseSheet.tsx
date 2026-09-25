/**
 * One purchase, opened from Expenses: what it cost, whose it is, who it was
 * bought from, the day, its receipt — and where it stands.
 *
 *   waiting to pass on   "Pass it on": one line, at its stored cost, on the
 *                        client's draft invoice (a new draft when they have none)
 *   on a draft           "Take it off the draft" (asked twice): the line goes, and
 *                        the purchase waits to be passed on again
 *   on a sent invoice    its lines are locked; "Open INV-…"
 *   ours                 the studio's own, never passed on
 *
 * The receipt can be added or replaced (the file first, then the purchase
 * names it). "Change it" edits the words, the day, the supplier — and, while
 * no line carries it, the cost and whose it is. A studio manager can remove a
 * purchase no line carries.
 */
import { useMemo, useState } from "react";
import { FileUp, Pencil, ReceiptText, Trash2, Undo2, Wallet } from "lucide-react";

import { Sheet } from "../../components/Sheet.tsx";
import { Alert, Button, UnfinishedLine } from "../../components/ui.tsx";
import type { Expense, Id } from "../../data/types.ts";
import { useI18n } from "../../i18n/index.tsx";
import { dayLabel } from "../../lib/dates.ts";
import { today } from "../../lib/clock.ts";
import { useCan, useDesk, useRows } from "../../state/desk.ts";
import { takeOffDraft, type OntoDrafts } from "../../state/invoiceDrafts.ts";
import { attachReceipt, editPurchase, passOn, removePurchase } from "../../state/officeActions.ts";
import type { Outcome, Unfinished } from "../../state/outcome.ts";
import { open as openView, toast } from "../../state/ui.ts";
import { DropZone } from "../../screens/review/DropZone.tsx";
import { rememberUpload, useFileInfo } from "../../screens/review/files.ts";
import { carriersOf, carrierState, openProjects, standingOf } from "../../screens/expenses/model.ts";
import { passedOnWords, refusalWords } from "../../screens/expenses/words.ts";

type Confirm = "take-off" | "remove" | null;

export function PurchaseSheet({ expense, onClose }: { expense: Expense; onClose: () => void }) {
  const { t, money, number, locale } = useI18n();
  const day = useDesk((s) => s.today) || today();
  const lines = useRows("invoice_lines");
  const invoices = useDesk((s) => s.rows.invoices);
  const clients = useDesk((s) => s.rows.clients);
  const projects = useDesk((s) => s.rows.projects);
  const suppliers = useDesk((s) => s.rows.suppliers);
  const settings = useDesk((s) => Object.values(s.rows.settings)[0] ?? null);
  const mayRemove = useCan("expenses", "delete");
  // Taking a line off a draft removes the line: a studio manager's, as every removal is.
  const mayTakeOff = useCan("invoice_lines", "delete");
  const receipt = useFileInfo(expense.receipt);

  const carriers = useMemo(() => carriersOf(lines, invoices), [lines, invoices]);
  const standing = standingOf(expense, carriers);
  const carrier = carriers.get(expense.id);
  const where = carrierState(carrier);

  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [unfinished, setUnfinished] = useState<Unfinished<OntoDrafts> | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [editing, setEditing] = useState(false);

  const company = expense.client_id === null ? null : (clients[expense.client_id]?.company ?? null);
  const project = expense.project_id === null ? null : (projects[expense.project_id] ?? null);
  const supplier = expense.supplier_id === null ? null : (suppliers[expense.supplier_id] ?? null);
  const forWhom = company === null ? t("expenses.row.overhead", { studio: settings?.name ?? "" }) : project === null ? company : `${company} · ${project.number ?? project.name}`;

  const run = async <T,>(action: () => Promise<Outcome<T>>, done: (value: T) => void) => {
    setBusy(true);
    setProblem(null);
    const out = await action();
    setBusy(false);
    if (!out.ok) {
      setProblem(refusalWords(out, t));
      return false;
    }
    done(out.value);
    return true;
  };

  const passIt = async () => {
    setBusy(true);
    setProblem(null);
    const out = await (unfinished === null ? passOn([expense.id], { newTitle: () => t("expenses.draftTitle") }) : unfinished.resume());
    setBusy(false);
    if (!out.ok) {
      setUnfinished(out.unfinished);
      setProblem(refusalWords(out, t));
      return;
    }
    setUnfinished(null);
    const words = passedOnWords(out.value, [expense], clients);
    toast(t(words.key, { amount: money(words.amount), company: words.company, count: number(words.count) }, words.count), { icon: "wallet" });
  };

  const takeOff = () =>
    carrier === undefined
      ? undefined
      : void run(
          () => takeOffDraft(carrier.line.id),
          () => {
            setConfirm(null);
            toast(t("expenses.sheet.takenOff", { what: expense.what }), { icon: "check" });
          },
        );

  const saveReceipt = () => {
    if (file === null) {
      setProblem(t("expenses.sheet.needFile"));
      return;
    }
    const chosen = file;
    void run(
      () => attachReceipt(expense.id, { file: chosen, filename: chosen.name }),
      (saved) => {
        if (saved.receipt !== null) rememberUpload(saved.receipt, chosen, chosen.name);
        setFile(null);
        toast(t("expenses.sheet.receiptSaved"), { icon: "check" });
      },
    );
  };

  const remove = () =>
    void run(
      () => removePurchase(expense.id),
      () => {
        toast(t("expenses.sheet.removed", { number: expense.number ?? expense.what }), { icon: "check" });
        onClose();
      },
    );

  const standingText =
    standing === "ours"
      ? t("expenses.sheet.ours")
      : standing === "to-pass-on"
        ? t("expenses.sheet.waiting", { company: company ?? "" })
        : standing === "voided"
          ? t("expenses.sheet.onVoided", { number: carrier?.invoice?.number ?? "" })
          : where === "draft"
            ? t("expenses.sheet.onDraft", { company: company ?? "" })
            : where === "locked"
              ? t("expenses.sheet.onSent", { number: carrier?.invoice?.number ?? "" })
              : t("expenses.sheet.onInvoice");

  return (
    <Sheet title={expense.what} sub={[expense.number, dayLabel(expense.date, locale, "long")].filter((x) => x !== null && x !== "").join(" · ")} icon={Wallet} onClose={onClose}>
      <div className="ex-sh">
        <dl className="ex-sh-facts">
          <div>
            <dt>{t("expenses.form.cost")}</dt>
            <dd className="money">{money(expense.amount)}</dd>
          </div>
          <div>
            <dt>{t("expenses.form.for")}</dt>
            <dd>{forWhom}</dd>
          </div>
          <div>
            <dt>{t("expenses.form.supplier")}</dt>
            <dd>{supplier?.name ?? t("expenses.form.noSupplier")}</dd>
          </div>
          <div>
            <dt>{t("expenses.form.receipt")}</dt>
            <dd>
              {expense.receipt === null ? (
                t("expenses.sheet.noReceipt")
              ) : receipt?.download ? (
                <a className="ex-sh-link" href={receipt.download} target="_blank" rel="noopener noreferrer" download={receipt.name}>
                  <ReceiptText size={13} aria-hidden="true" />
                  {receipt.name}
                </a>
              ) : (
                (receipt?.name ?? t("expenses.sheet.receiptKept"))
              )}
            </dd>
          </div>
        </dl>

        <div className={`ex-sh-standing ex-sh-standing--${standing}`}>
          <p>{standingText}</p>
          {standing === "to-pass-on" && company !== null && (
            <Button kind="primary" icon={Wallet} busy={busy} onClick={() => void passIt()}>
              {t("expenses.tag.to-pass-on")}
            </Button>
          )}
          {standing === "passed-on" && where === "draft" && confirm !== "take-off" && mayTakeOff && (
            <Button icon={Undo2} onClick={() => setConfirm("take-off")}>
              {t("expenses.sheet.takeOff")}
            </Button>
          )}
          {standing === "passed-on" && where === "draft" && !mayTakeOff && <p>{t("expenses.sheet.takeOffManager")}</p>}
          {((standing === "passed-on" && where === "locked") || standing === "voided") && carrier?.invoice && (
            <Button icon={ReceiptText} onClick={() => openView("invoice", carrier.invoice!.id as Id)}>
              {t("expenses.sheet.openInvoice", { number: carrier.invoice.number ?? "" })}
            </Button>
          )}
        </div>
        {confirm === "take-off" && (
          <div className="ex-sh-confirm" role="group" aria-label={t("expenses.sheet.takeOff")}>
            <p>{t("expenses.sheet.takeOffAsk")}</p>
            <div className="ex-sh-row">
              <Button kind="danger" icon={Undo2} busy={busy} onClick={takeOff}>
                {t("expenses.sheet.takeOffYes")}
              </Button>
              <Button onClick={() => setConfirm(null)}>{t("common.cancel")}</Button>
            </div>
          </div>
        )}

        <div className="ex-sh-block">
          <span className="ex-fld-k">{expense.receipt === null ? t("expenses.sheet.addReceipt") : t("expenses.sheet.replaceReceipt")}</span>
          <DropZone
            file={file}
            invalid={false}
            onFile={(f) => {
              setFile(f);
              setProblem(null);
            }}
            onTooBig={() => {
              setFile(null);
              setProblem(t("expenses.form.tooBig"));
            }}
          />
          <Button icon={FileUp} busy={busy && file !== null} disabled={file === null} onClick={saveReceipt}>
            {t("expenses.sheet.saveReceipt")}
          </Button>
        </div>

        {editing ? (
          <EditPurchase expense={expense} locked={standing === "passed-on"} onDone={() => setEditing(false)} day={day} />
        ) : (
          <div className="ex-sh-row">
            <Button icon={Pencil} onClick={() => setEditing(true)}>
              {t("expenses.sheet.change")}
            </Button>
            {mayRemove && standing !== "passed-on" && confirm !== "remove" && (
              <Button kind="danger" icon={Trash2} onClick={() => setConfirm("remove")}>
                {t("expenses.sheet.remove")}
              </Button>
            )}
          </div>
        )}
        {confirm === "remove" && (
          <div className="ex-sh-confirm" role="group" aria-label={t("expenses.sheet.remove")}>
            <p>{t("expenses.sheet.removeAsk", { number: expense.number ?? expense.what })}</p>
            <div className="ex-sh-row">
              <Button kind="danger" icon={Trash2} busy={busy} onClick={remove}>
                {t("expenses.sheet.removeYes")}
              </Button>
              <Button onClick={() => setConfirm(null)}>{t("common.cancel")}</Button>
            </div>
          </div>
        )}

        {unfinished !== null && <UnfinishedLine unfinished={unfinished} busy={busy} onFinish={() => void passIt()} />}
        {problem !== null && unfinished === null && <Alert>{problem}</Alert>}
      </div>
    </Sheet>
  );
}

/** "Change it": the words, the day, the supplier — and the cost and whose it is while no line carries it. */
function EditPurchase({ expense, locked, onDone, day }: { expense: Expense; locked: boolean; onDone: () => void; day: string }) {
  const { t } = useI18n();
  const projects = useRows("projects");
  const clients = useDesk((s) => s.rows.clients);
  const suppliers = useRows("suppliers");
  const running = useMemo(() => {
    const list = openProjects(projects);
    // Its own project stays on offer even when it is done.
    const own = projects.find((p) => p.id === expense.project_id);
    return own !== undefined && !list.includes(own) ? [...list, own] : list;
  }, [projects, expense.project_id]);
  const [what, setWhat] = useState(expense.what);
  const [amount, setAmount] = useState(expense.amount);
  const [date, setDate] = useState(expense.date);
  const [supplier, setSupplier] = useState(expense.supplier_id === null ? "" : String(expense.supplier_id));
  const [forWhom, setForWhom] = useState(expense.project_id !== null ? String(expense.project_id) : expense.rebill ? "keep" : "ours");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const save = async () => {
    const patch: Parameters<typeof editPurchase>[1] = {};
    if (what !== expense.what) patch.what = what;
    if (date !== expense.date) patch.date = date;
    const supplierId = supplier === "" ? null : Number(supplier);
    if (supplierId !== expense.supplier_id) patch.supplier_id = supplierId;
    if (!locked) {
      if (amount !== expense.amount) patch.amount = amount;
      if (forWhom === "ours" && (expense.rebill || expense.project_id !== null)) Object.assign(patch, { project_id: null, client_id: null, rebill: false });
      else if (forWhom !== "ours" && forWhom !== "keep" && Number(forWhom) !== expense.project_id) Object.assign(patch, { project_id: Number(forWhom), rebill: true });
    }
    if (Object.keys(patch).length === 0) return onDone();
    setBusy(true);
    const out = await editPurchase(expense.id, patch);
    setBusy(false);
    if (!out.ok) return setProblem(refusalWords(out, t));
    toast(t("expenses.sheet.changed"), { icon: "check" });
    onDone();
  };

  return (
    <form
      className="ex-sh-edit"
      aria-label={t("expenses.sheet.change")}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label className="ex-fld">
        <span className="ex-fld-k">{t("expenses.form.what")}</span>
        <input className="ex-input" value={what} maxLength={300} onChange={(e) => setWhat(e.target.value)} />
      </label>
      <div className="ex-sh-pair">
        <label className="ex-fld">
          <span className="ex-fld-k">{t("expenses.form.cost")}</span>
          <input className="ex-input ex-input--mono" value={amount} inputMode="decimal" disabled={locked} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="ex-fld">
          <span className="ex-fld-k">{t("expenses.form.date")}</span>
          <input className="ex-input ex-input--mono" type="date" value={date} max={day} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      <label className="ex-fld">
        <span className="ex-fld-k">{t("expenses.form.for")}</span>
        <select className="ex-input" value={forWhom} disabled={locked} onChange={(e) => setForWhom(e.target.value)}>
          <option value="ours">{t("expenses.form.ours")}</option>
          {forWhom === "keep" && <option value="keep">{expense.client_id === null ? "" : (clients[expense.client_id]?.company ?? "")}</option>}
          {running.map((p) => (
            <option key={p.id} value={String(p.id)}>
              {`${clients[p.client_id]?.company ?? ""} · ${p.name}`}
            </option>
          ))}
        </select>
      </label>
      {locked && <p className="ex-sh-hint">{t("expenses.sheet.lockedHint")}</p>}
      <label className="ex-fld">
        <span className="ex-fld-k">{t("expenses.form.supplier")}</span>
        <select className="ex-input" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
          <option value="">{t("expenses.form.noSupplier")}</option>
          {[...suppliers]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.name}
              </option>
            ))}
        </select>
      </label>
      {problem !== null && <Alert>{problem}</Alert>}
      <div className="ex-sh-row">
        <Button kind="primary" type="submit" busy={busy}>
          {t("expenses.sheet.saveChanges")}
        </Button>
        <Button onClick={onDone}>{t("common.cancel")}</Button>
      </div>
    </form>
  );
}
