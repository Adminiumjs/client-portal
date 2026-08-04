/**
 * The client side: the "find your documents" gate, the proposal review, the
 * project progress view, and the invoice with its pay sheet.
 *
 * Every screen here renders the SAME line table and ledger the studio sees
 * (imported from `Studio.tsx`), so the two sides can never show different
 * numbers for the same document.
 */

import { Compass, KeyRound, ShieldCheck } from "lucide-react";

import { PORTAL_HINTS, TODAY } from "../data/demo.ts";
import { useI18n } from "../i18n/index.tsx";
import { dateLong, label, money } from "../lib/format.ts";
import { balance, docTotals, isOverdue, projectProgress } from "../lib/invoice.ts";
import { clientById, useStore } from "../state/store.ts";
import { Button, Chip, Empty, Mono, Panel } from "../components/Primitives.tsx";
import { Ledger, LineTable, ProjectBody, Ring } from "./Studio.tsx";

/* -------------------------------------------------------------------- gate */

export function Entry() {
  const { t } = useI18n();
  const email = useStore((s) => s.portalEmail);
  const number = useStore((s) => s.portalNumber);
  const error = useStore((s) => s.portalError);
  const setEmail = useStore((s) => s.setPortalEmail);
  const setNumber = useStore((s) => s.setPortalNumber);
  const submit = useStore((s) => s.submitPortal);

  return (
    <div className="ol-screen">
      <section className="ol-gate">
        <span className="ol-gate__mark" aria-hidden="true">
          <KeyRound size={24} />
        </span>
        <h1 className="ol-gate__title">{t("entry.title")}</h1>
        <p className="ol-gate__sub">{t("entry.subtitle")}</p>

        <form
          className="ol-gate__form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label className="ol-field">
            <span className="ol-label">{t("entry.email")}</span>
            <input
              className="ol-input ol-fld"
              type="email"
              value={email}
              autoComplete="email"
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          <label className="ol-field">
            <span className="ol-label">{t("entry.number")}</span>
            <input
              className="ol-input ol-fld ol-mono"
              value={number}
              placeholder="INV-2039"
              onChange={(e) => setNumber(e.target.value)}
            />
          </label>

          {error !== null && (
            <p className="ol-gate__error">{t(`entry.err.${error}` as "entry.err.unknownNumber")}</p>
          )}

          <Button type="submit" className="ol-fullwidth">
            {t("entry.submit")}
          </Button>
        </form>

        <div className="ol-gate__hints">
          <span className="ol-label">{t("entry.hints")}</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBlockStart: 8 }}>
            {PORTAL_HINTS.map((hint) => (
              <Chip
                key={hint.num}
                onClick={() => {
                  setEmail(hint.email);
                  setNumber(hint.num);
                }}
              >
                <Mono>{hint.num}</Mono>
              </Chip>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ review */

export function Review() {
  const { t } = useI18n();
  const num = useStore((s) => s.proposalNum);
  const proposals = useStore((s) => s.proposals);
  const accept = useStore((s) => s.acceptProposal);
  const askDecline = useStore((s) => s.askDecline);
  const leave = useStore((s) => s.leavePortal);

  const proposal = proposals.find((p) => p.num === num);
  if (!proposal) return <PortalMissing />;

  const client = clientById(proposal.client);
  const decided = proposal.status === "accepted" || proposal.status === "declined";

  return (
    <div className="ol-screen">
      <header className="ol-portal-head">
        <Mono className="ol-dochead__num">{proposal.num}</Mono>
        <h1 className="ol-gate__title">{label(proposal.title)}</h1>
        <p className="ol-gate__sub">
          {client?.company} · {t("proposal.validUntil", { date: dateLong(proposal.validUntil) })}
        </p>
      </header>

      <Panel title={t("proposal.scope")}>
        {proposal.scope.map((para) => (
          <p key={para} className="ol-prose">
            {label(para)}
          </p>
        ))}
      </Panel>

      <div style={{ marginBlockStart: 16 }}>
        <Panel title={t("proposal.items")}>
          <LineTable items={proposal.items} taxRate={proposal.taxRate} />
        </Panel>
      </div>

      {proposal.status === "accepted" ? (
        <p className="ol-accepted">
          <ShieldCheck size={16} aria-hidden="true" />
          {t("review.accepted")}
        </p>
      ) : proposal.status === "declined" ? (
        <p className="ol-declined">{t("review.declinedState")}</p>
      ) : (
        <div className="ol-portal-actions">
          <Button tone="pos" onClick={() => accept(proposal.num)}>
            {t("review.accept")}
          </Button>
          <Button tone="ghost" onClick={() => askDecline(proposal.num)}>
            {t("review.decline")}
          </Button>
        </div>
      )}

      {decided && (
        <div style={{ marginBlockStart: 18, textAlign: "center" }}>
          <Button tone="ghost" onClick={leave}>
            {t("entry.title")}
          </Button>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- progress */

export function Progress() {
  const { t } = useI18n();
  const id = useStore((s) => s.projectId);
  const projects = useStore((s) => s.projects);

  const project = projects.find((p) => p.id === id);
  if (!project) return <PortalMissing />;

  const client = clientById(project.client);

  return (
    <div className="ol-screen">
      <header className="ol-portal-head">
        <Ring value={projectProgress(project)} tint={client?.tint ?? "#b25e09"} />
        <h1 className="ol-gate__title">{label(project.name)}</h1>
        <p className="ol-gate__sub">{t("project.due", { date: dateLong(project.due) })}</p>
      </header>

      <ProjectBody project={project} clientSide />
    </div>
  );
}

/* ------------------------------------------------------------ client invoice */

export function ClientInvoice() {
  const { t } = useI18n();
  const num = useStore((s) => s.invoiceNum);
  const invoices = useStore((s) => s.invoices);
  const askPay = useStore((s) => s.askPay);
  const leave = useStore((s) => s.leavePortal);

  const invoice = invoices.find((i) => i.num === num);
  if (!invoice) return <PortalMissing />;

  const client = clientById(invoice.client);
  const due = balance(invoice);
  const overdue = isOverdue(invoice, TODAY);

  return (
    <div className="ol-screen">
      <header className="ol-portal-head">
        <Mono className="ol-dochead__num">{invoice.num}</Mono>
        <h1 className="ol-gate__title">{label(invoice.title)}</h1>
        <p className="ol-gate__sub">
          {client?.company} · {t("invoice.due", { date: dateLong(invoice.due) })}
        </p>
        {overdue && (
          <div style={{ marginBlockStart: 9 }}>
            <Chip tone="danger">{t("chrome.status.overdue")}</Chip>
          </div>
        )}
      </header>

      <Panel title={t("proposal.items")}>
        <LineTable items={invoice.items} taxRate={invoice.taxRate} />
      </Panel>

      <div style={{ marginBlockStart: 16 }}>
        <Panel title={t("invoice.ledger")}>
          <Ledger invoice={invoice} />
        </Panel>
      </div>

      <section className="ol-paybar">
        <div>
          <span className="ol-paybar__label">
            {due === 0 ? t("clientinvoice.settled") : t("invoice.balanceDue")}
          </span>
          <Mono className="ol-paybar__value">{money(due)}</Mono>
        </div>
        {due > 0 ? (
          <Button tone="pos" onClick={() => askPay(invoice.num)}>
            {t("clientinvoice.pay")}
          </Button>
        ) : (
          <Button tone="ghost" onClick={leave}>
            {t("entry.title")}
          </Button>
        )}
      </section>

      <p className="ol-fineprint ol-mono">
        {t("proposal.total")}: {money(docTotals(invoice.items, invoice.taxRate).total)}
      </p>
    </div>
  );
}

function PortalMissing() {
  const { t } = useI18n();
  const leave = useStore((s) => s.leavePortal);
  return (
    <div className="ol-screen">
      <Empty
        icon={<Compass size={22} aria-hidden="true" />}
        title={t("notfound.title")}
        body={t("notfound.body")}
        action={<Button onClick={leave}>{t("entry.title")}</Button>}
      />
    </div>
  );
}

/* ------------------------------------------------------------------- 404 */

export function NotFound() {
  const { t } = useI18n();
  const go = useStore((s) => s.go);
  const persona = useStore((s) => s.persona);

  return (
    <div className="ol-screen">
      <Empty
        icon={<Compass size={22} aria-hidden="true" />}
        title={t("notfound.title")}
        body={t("notfound.body")}
        action={
          <Button onClick={() => go(persona === "client" ? "entry" : "home")}>
            {t("notfound.action")}
          </Button>
        }
      />
    </div>
  );
}
