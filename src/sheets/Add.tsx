/**
 * The "add" sheet: the design's one sheet for adding something small — a new
 * invoice, a new project, a client, a logged call, a milestone, a person, a
 * rate — and for editing a client's print details, a milestone, a person or a
 * rate. What each kind asks and saves is `add/spec.ts`; this draws it.
 *
 * Every save is Adminium's: the invoice and the project are step lists (a
 * step that doesn't save offers "Finish it"), the rest one write each. Then
 * the sheet closes and the desk goes where the new thing lives.
 */
import { useEffect, useId, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowUpRight, FilePlus, FolderPlus, IdCard, Milestone, PhoneIncoming, Ruler, Trash2, UserRoundPlus } from "lucide-react";

import { Sheet } from "../components/Sheet.tsx";
import { Alert, Button, Field, UnfinishedLine } from "../components/ui.tsx";
import type { Id } from "../data/types.ts";
import { useI18n, type MessageKey } from "../i18n/index.tsx";
import { Switch } from "../screens/settings/Switch.tsx";
import { addClient, addMilestone, editClient, editMilestone, logCall, newProject, removeMilestone, removeRate, saveInvoice, savePerson, saveRate, type Outcome } from "../state/actions.ts";
import { ensureRows, loadPage, loadWhere, useDesk, useRows } from "../state/desk.ts";
import { refusalKey, refusalOf } from "../state/outcome.ts";
import { saveFromSheet, setDraft, useSheets, type AddKind, type DeskSheet } from "../state/sheets.ts";
import { go, open, openComposer, toast } from "../state/ui.ts";
import {
  BUDGETS,
  clientEditInput,
  clientInput,
  defaults,
  editing,
  enquiryInput,
  invoiceInput,
  personInput,
  projectInput,
  rateInput,
  TERM_CHOICES,
  validate,
  type Values,
} from "./add/spec.ts";

type Refused = Extract<Outcome<unknown>, { ok: false }>;

const ICON: Record<AddKind, LucideIcon> = {
  invoice: FilePlus,
  project: FolderPlus,
  client: UserRoundPlus,
  clientEdit: IdCard,
  enquiry: PhoneIncoming,
  milestone: Milestone,
  person: UserRoundPlus,
  rate: Ruler,
};

/** Who can sign in to the desk is Adminium's (its people and roles), not this list's. */
const TEAM_URL = "/settings/team";

export default function Add({ sheet, onClose }: { sheet: Extract<DeskSheet, { kind: "add" }>; onClose: () => void }) {
  const { t, locale } = useI18n();
  const base = useId();
  const what = sheet.what;
  const about = sheet.about;
  const draft = useSheets((s) => s.draft);
  const busy = useSheets((s) => s.busy);
  const unfinished = useSheets((s) => s.unfinished);
  const clientsById = useDesk((s) => s.rows.clients);
  const projectRows = useRows("projects");
  const people = useRows("people");
  const rates = useRows("rates");
  const deliverables = useRows("deliverables");
  const milestonesById = useDesk((s) => s.rows.milestones);
  const [shown, setShown] = useState(false);
  const [refused, setRefused] = useState<Refused | null>(null);
  const isEdit = editing(what, about);

  // The rows the sheet chooses from or edits.
  useEffect(() => {
    if (what === "invoice" || what === "project") void loadPage("clients", { order: "company.asc", limit: 200, offset: 0 }).catch(() => undefined);
    if (what === "clientEdit") void ensureRows("clients", [about?.clientId]).catch(() => undefined);
    if (what === "milestone" && about?.milestoneId !== undefined) void ensureRows("milestones", [about.milestoneId]).catch(() => undefined);
  }, [what, about?.clientId, about?.milestoneId]);

  const clients = useMemo(() => Object.values(clientsById).sort((a, b) => a.company.localeCompare(b.company, locale)), [clientsById, locale]);
  const openProjects = useMemo(() => projectRows.filter((p) => p.status !== "done").sort((a, b) => a.id - b.id), [projectRows]);
  const row: Record<string, unknown> | null =
    what === "clientEdit" && about?.clientId !== undefined
      ? ((clientsById[about.clientId] as unknown as Record<string, unknown> | undefined) ?? null)
      : what === "milestone" && about?.milestoneId !== undefined
        ? ((milestonesById[about.milestoneId] as unknown as Record<string, unknown> | undefined) ?? null)
        : what === "person" && about?.personId !== undefined
          ? ((people.find((p) => p.id === about.personId) as unknown as Record<string, unknown> | undefined) ?? null)
          : what === "rate" && about?.rateId !== undefined
            ? ((rates.find((r) => r.id === about.rateId) as unknown as Record<string, unknown> | undefined) ?? null)
            : null;

  const firstMilestone = t("sheets.add.project.milestoneDefault");
  const seedClient = about?.clientId ?? (what === "invoice" || what === "project" ? (clients[0]?.id ?? null) : null);
  const seedProject = about?.projectId ?? (what === "milestone" ? (openProjects[0]?.id ?? null) : null);
  const values: Values = {
    ...defaults(what, { clientId: seedClient, projectId: seedProject, row: isEdit ? row : undefined, clientTerms: seedClient === null ? null : (clientsById[seedClient]?.terms ?? null), firstMilestone }),
    ...(draft as Values),
  };
  const errors = shown ? validate(what, values) : {};
  const set = (key: string, value: string | boolean) => {
    setRefused(null);
    // A new invoice takes the chosen client's own terms, else the studio's.
    if (what === "invoice" && key === "client") setDraft({ client: value, terms: clientsById[Number(value)]?.terms ?? "studio", project: "" });
    else setDraft({ [key]: value });
  };

  // ── the save, then where the desk goes ──────────────────────────────────
  const words = (key: MessageKey, params?: Record<string, string>) => t(key, params);
  const position = <T extends { position: number }>(list: readonly T[]) => list.reduce((m, x) => Math.max(m, x.position), -1) + 1;

  const save = async (): Promise<Outcome<unknown>> => {
    switch (what) {
      case "invoice":
        return saveInvoice(invoiceInput(values));
      case "project":
        return newProject(projectInput(values, firstMilestone));
      case "client":
        return addClient(clientInput(values));
      case "clientEdit":
        return editClient(about?.clientId as Id, clientEditInput(values));
      case "enquiry":
        return logCall(enquiryInput(values, { source: t("sheets.add.enquiry.source"), budget: (b) => t(`sheets.add.budget.${b}` as MessageKey) }));
      case "milestone": {
        const projectId = Number(values["project"]);
        const input = { title: String(values["title"]).trim(), due_on: String(values["due"]) };
        if (about?.milestoneId !== undefined) return editMilestone(about.milestoneId, input);
        try {
          await loadWhere("milestones", { column: "project_id", op: "eq", value: projectId }, "position.asc");
        } catch (error) {
          return refusalOf(error);
        }
        const held = Object.values(useDesk.getState().rows.milestones).filter((m) => m.project_id === projectId);
        return addMilestone(projectId, { ...input, position: position(held) });
      }
      case "person":
        return savePerson(about?.personId ?? null, personInput(values, about?.personId === undefined ? position(people) : ((row?.["position"] as number | undefined) ?? 0)));
      case "rate":
        return saveRate(about?.rateId ?? null, rateInput(values, about?.rateId === undefined ? position(rates) : null));
    }
  };

  const landed = (value: unknown) => {
    const r = (value ?? {}) as Record<string, unknown>;
    switch (what) {
      case "invoice":
        toast(words("sheets.add.invoice.done", { number: String(r["number"] ?? "") }), { icon: "file-plus" });
        openComposer({ kind: "invoice", id: r["id"] as Id });
        return;
      case "project":
        toast(words("sheets.add.project.done", { number: String(r["number"] ?? "") }), { icon: "folder-plus" });
        open("project", r["id"] as Id);
        return;
      case "client":
        toast(words("sheets.add.client.done", { company: String(r["company"] ?? "") }), { icon: "user-round-plus" });
        open("client", r["id"] as Id);
        return;
      case "enquiry":
        toast(words("sheets.add.enquiry.done", { business: String(r["business"] ?? "") }), { icon: "phone-incoming" });
        go("enquiries");
        return;
      case "milestone":
        if (about?.milestoneId !== undefined) return toast(words("sheets.add.saved"));
        toast(words("sheets.add.milestone.done"), { icon: "milestone" });
        open("project", r["project_id"] as Id);
        return;
      case "person":
        return toast(about?.personId !== undefined ? words("sheets.add.saved") : words("sheets.add.person.done", { name: String(r["name"] ?? "") }), { icon: "user-round-plus" });
      case "rate":
        return toast(about?.rateId !== undefined ? words("sheets.add.saved") : words("sheets.add.rate.done"), { icon: "ruler" });
      case "clientEdit":
        return toast(words("sheets.add.saved"));
    }
  };

  const onSubmit = async () => {
    setShown(true);
    if (Object.keys(validate(what, values)).length > 0) {
      // The first field that needs something takes the focus, so its message is read out.
      setTimeout(() => document.querySelector<HTMLElement>('.add-body [aria-invalid="true"]')?.focus(), 0);
      return;
    }
    const out = await saveFromSheet(save);
    if (out.ok) landed(out.value);
    else setRefused(out);
  };
  const onFinish = async () => {
    if (unfinished === null) return;
    const out = await saveFromSheet(() => unfinished.resume());
    if (out.ok) landed(out.value);
    else setRefused(out);
  };
  const canRemove =
    (what === "milestone" && about?.milestoneId !== undefined && !deliverables.some((d) => d.milestone_id === about.milestoneId)) || (what === "rate" && about?.rateId !== undefined);
  const onRemove = async () => {
    const out = await saveFromSheet(() => (what === "milestone" ? removeMilestone(about?.milestoneId as Id) : removeRate(about?.rateId as Id)));
    if (out.ok) toast(what === "milestone" ? t("sheets.add.milestone.removed") : t("sheets.add.rate.removed"));
    else setRefused(out);
  };

  // ── the fields ──────────────────────────────────────────────────────────
  const err = (k: string) => (errors[k] === undefined ? undefined : t(errors[k]!));
  const text = (k: string, label: MessageKey, opts: { ph?: MessageKey; hint?: MessageKey; mono?: boolean; mode?: "email" | "decimal" | "numeric" } = {}) => (
    <Field key={k} label={t(label)} hint={opts.hint === undefined ? undefined : t(opts.hint)} error={err(k)}>
      {({ id, describedBy, invalid }) => (
        <input
          id={id}
          className={`input${opts.mono === true ? " add-mono" : ""}`}
          dir={opts.mono === true ? "ltr" : undefined}
          type={opts.mode === "email" ? "email" : "text"}
          inputMode={opts.mode === "decimal" ? "decimal" : opts.mode === "numeric" ? "numeric" : opts.mode === "email" ? "email" : "text"}
          value={String(values[k] ?? "")}
          placeholder={opts.ph === undefined ? undefined : t(opts.ph)}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          onChange={(e) => set(k, e.target.value)}
        />
      )}
    </Field>
  );
  const area = (k: string, label: MessageKey, ph?: MessageKey) => (
    <Field key={k} label={t(label)} error={err(k)}>
      {({ id, describedBy }) => <textarea id={id} className="input" rows={3} value={String(values[k] ?? "")} placeholder={ph === undefined ? undefined : t(ph)} aria-describedby={describedBy} onChange={(e) => set(k, e.target.value)} />}
    </Field>
  );
  const date = (k: string, label: MessageKey) => (
    <Field key={k} label={t(label)} error={err(k)}>
      {({ id, describedBy, invalid }) => <input id={id} type="date" className="input add-mono" value={String(values[k] ?? "")} aria-describedby={describedBy} aria-invalid={invalid} onChange={(e) => set(k, e.target.value)} />}
    </Field>
  );
  const select = (k: string, label: MessageKey, options: readonly { id: string; name: string }[]) => (
    <Field key={k} label={t(label)} error={err(k)}>
      {({ id, describedBy, invalid }) => (
        <select id={id} className="input" value={String(values[k] ?? "")} aria-describedby={describedBy} aria-invalid={invalid} onChange={(e) => set(k, e.target.value)}>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
  const termOptions = TERM_CHOICES.map((c) => ({ id: c, name: c === "studio" ? t("sheets.add.terms.studio") : t(`settings.inv.term.${c}` as MessageKey) }));
  const clientOptions = clients.map((c) => ({ id: String(c.id), name: c.company }));

  const fields = (() => {
    switch (what) {
      case "invoice": {
        const chosen = Number(values["client"]);
        const projects = openProjects.filter((p) => p.client_id === chosen);
        return [
          select("client", "sheets.add.client", clientOptions),
          select("project", "sheets.add.invoice.project", [{ id: "", name: t("sheets.add.invoice.noProject") }, ...projects.map((p) => ({ id: String(p.id), name: p.number === null ? p.name : `${p.number} · ${p.name}` }))]),
          text("title", "sheets.add.invoice.title", { ph: "sheets.add.invoice.titlePh" }),
          select("terms", "sheets.add.terms", termOptions),
          text("desc", "sheets.add.invoice.desc", { ph: "sheets.add.invoice.descPh" }),
          <div key="qr" className="add-pair">
            {text("qty", "sheets.add.invoice.qty", { mono: true, mode: "decimal" })}
            {text("rate", "sheets.add.invoice.rate", { mono: true, mode: "decimal", ph: "sheets.add.invoice.ratePh" })}
          </div>,
          <p key="rh" className="add-hint">
            {t("sheets.add.invoice.rateHint")}
          </p>,
        ];
      }
      case "project":
        return [
          select("client", "sheets.add.client", clientOptions),
          text("name", "sheets.add.project.name", { ph: "sheets.add.project.namePh" }),
          text("milestone", "sheets.add.project.milestone", { ph: "sheets.add.project.milestoneDefault" }),
          date("due", "sheets.add.due"),
        ];
      case "client":
        return [
          text("company", "sheets.add.client.company", { ph: "sheets.add.client.companyPh" }),
          text("trade", "sheets.add.client.trade", { ph: "sheets.add.client.tradePh" }),
          text("contact", "sheets.add.client.contact", { ph: "sheets.add.client.contactPh" }),
          text("email", "sheets.add.client.email", { ph: "sheets.add.client.emailPh", mode: "email", mono: true }),
          area("address", "sheets.add.client.address", "sheets.add.client.addressPh"),
          text("tax_number", "sheets.add.client.taxNumber", { ph: "sheets.add.client.taxNumberPh", mono: true }),
        ];
      case "clientEdit":
        return [
          area("address", "sheets.add.client.address", "sheets.add.clientEdit.addressPh"),
          text("tax_number", "sheets.add.client.taxNumber", { ph: "sheets.add.client.taxNumberPh", mono: true }),
          select("terms", "sheets.add.terms", termOptions),
          text("tax_rate", "sheets.add.clientEdit.taxRate", { ph: "sheets.add.clientEdit.taxRatePh", hint: "sheets.add.clientEdit.taxRateHint", mono: true, mode: "decimal" }),
        ];
      case "enquiry":
        return [
          text("business", "sheets.add.enquiry.business", { ph: "sheets.add.enquiry.businessPh" }),
          text("name", "sheets.add.enquiry.name", { ph: "sheets.add.enquiry.namePh" }),
          text("email", "sheets.add.client.email", { ph: "sheets.add.enquiry.emailPh", mode: "email", mono: true }),
          select("budget", "sheets.add.enquiry.budget", BUDGETS.map((b) => ({ id: b, name: t(`sheets.add.budget.${b}` as MessageKey) }))),
          area("body", "sheets.add.enquiry.body", "sheets.add.enquiry.bodyPh"),
        ];
      case "milestone":
        return [
          ...(isEdit ? [] : [select("project", "sheets.add.milestone.project", openProjects.map((p) => ({ id: String(p.id), name: `${clientsById[p.client_id]?.company ?? ""} · ${p.name}` })))]),
          text("title", "sheets.add.milestone.field", { ph: "sheets.add.milestone.titlePh" }),
          date("due", "sheets.add.due"),
        ];
      case "person":
        return [
          text("name", "sheets.add.person.name", { ph: "sheets.add.person.namePh" }),
          text("role_label", "sheets.add.person.role", { ph: "sheets.add.person.rolePh" }),
          text("initials", "sheets.add.person.initials", { ph: "sheets.add.person.initialsPh", mono: true }),
          <div key="shown" className="add-switch-row">
            <span id={`${base}-shown`} className="add-switch-label">
              {t("settings.people.shown")}
            </span>
            <Switch on={values["shown"] === true} labelledBy={`${base}-shown`} onToggle={() => set("shown", values["shown"] !== true)} />
          </div>,
        ];
      case "rate":
        return [
          text("label", "sheets.add.rate.label", { ph: "sheets.add.rate.labelPh" }),
          text("amount", "sheets.add.rate.amount", { ph: "sheets.add.rate.amountPh", mono: true, mode: "decimal" }),
          text("hours", "sheets.add.rate.hours", { ph: "sheets.add.rate.hoursPh", hint: "sheets.add.rate.hoursHint", mono: true, mode: "decimal" }),
        ];
    }
  })();

  const kind = isEdit && what !== "clientEdit" ? `${what}Edit` : what;
  const title =
    what === "clientEdit"
      ? t("sheets.add.clientEdit.heading", { company: String(row?.["company"] ?? "") })
      : what === "person" && isEdit
        ? t("sheets.add.personEdit.heading", { name: String(row?.["name"] ?? "") })
        : t(`sheets.add.${kind}.heading` as MessageKey);
  const sub = t(`sheets.add.${what === "clientEdit" ? "clientEdit" : what}.sub` as MessageKey);
  const button = isEdit ? t("sheets.add.save") : t(`sheets.add.${what}.button` as MessageKey);
  const foot = t(`sheets.add.${what}.foot` as MessageKey);
  const Icon = ICON[what];
  const needsClient = (what === "invoice" || what === "project") && clients.length === 0;
  const needsProject = what === "milestone" && !isEdit && openProjects.length === 0;

  return (
    <Sheet title={title} sub={sub === "" ? undefined : sub} icon={Icon} onClose={onClose}>
      <div className="add-body" data-add={what}>
        {needsClient && <Alert tone="warn">{t("sheets.add.noClient")}</Alert>}
        {needsProject && <Alert tone="warn">{t("sheets.add.milestone.projectMissing")}</Alert>}
        {fields}
        {refused !== null && unfinished === null && (
          <Alert>{refused.reason === "duplicate" && (what === "client" || what === "enquiry") ? t("sheets.add.client.duplicate") : t(refusalKey(refused.reason), { id: "", balance: "" })}</Alert>
        )}
        {unfinished !== null && <UnfinishedLine unfinished={unfinished} busy={busy} onFinish={() => void onFinish()} />}
        <Button kind="primary" size="wide" icon={Icon} busy={busy} disabled={unfinished !== null || needsClient || needsProject} className="add-submit" onClick={() => void onSubmit()}>
          {button}
        </Button>
        {canRemove && (
          <Button kind="danger" icon={Trash2} disabled={busy} className="add-remove" onClick={() => void onRemove()}>
            {what === "milestone" ? t("sheets.add.milestone.remove") : t("sheets.add.rate.remove")}
          </Button>
        )}
        {foot !== "" && <p className="add-foot">{foot}</p>}
        {what === "person" && (
          <a className="add-link ol-gi" href={TEAM_URL} target="_blank" rel="noopener">
            {t("sheets.add.person.link")}
            <ArrowUpRight size={13} aria-hidden="true" />
          </a>
        )}
      </div>
    </Sheet>
  );
}
