/**
 * Send a saved draft — a proposal or an invoice — as it stands: who it goes
 * to, its stored total, when it holds until or falls due, and "Send to
 * {first}". It is refused before anything is written when the draft has no
 * line with an amount (Adminium would refuse it too), and offers the
 * composer instead. Sending a revision withdraws the proposal it revises.
 */
import { useEffect } from "react";
import { Send as SendIcon, SquarePen } from "lucide-react";

import { Sheet } from "../components/Sheet.tsx";
import { Alert, Button, Money, UnfinishedLine } from "../components/ui.tsx";
import type { Invoice, Proposal } from "../data/types.ts";
import { addDays } from "../data/venueTime.ts";
import { useI18n } from "../i18n/index.tsx";
import { dayLabel } from "../lib/dates.ts";
import { isPositive } from "../lib/money.ts";
import { storedProposalDraft, TERM_DAYS } from "../screens/composer/draft.ts";
import { sendProposal, sendSavedInvoice, type Outcome } from "../state/actions.ts";
import { loadInvoice, loadProposal, useDesk, useRow, useRows } from "../state/desk.ts";
import { refusalKey } from "../state/outcome.ts";
import { closeSheet, saveFromSheet, setDraft, useSheets, type DeskSheet } from "../state/sheets.ts";
import { open, openComposer, toast } from "../state/ui.ts";

export default function Send({ sheet, onClose }: { sheet: Extract<DeskSheet, { kind: "send" }>; onClose: () => void }) {
  const { t, locale } = useI18n();
  const isInvoice = sheet.table === "invoices";
  const proposal = useRow("proposals", isInvoice ? null : sheet.id);
  const invoice = useRow("invoices", isInvoice ? sheet.id : null);
  const doc: Proposal | Invoice | undefined = isInvoice ? invoice : proposal;
  const client = useRow("clients", doc?.client_id);
  const proposalLines = useRows("proposal_lines");
  const invoiceLines = useRows("invoice_lines");
  const today = useDesk((s) => s.today);
  const draft = useSheets((s) => s.draft);
  const busy = useSheets((s) => s.busy);
  const unfinished = useSheets((s) => s.unfinished);

  useEffect(() => {
    void (isInvoice ? loadInvoice(sheet.id) : loadProposal(sheet.id)).catch(() => undefined);
  }, [isInvoice, sheet.id]);

  if (doc === undefined) return null;
  const lines = isInvoice ? invoiceLines.filter((l) => l.document_id === doc.id) : proposalLines.filter((l) => l.document_id === doc.id);
  const first = (client?.contact_name ?? "").trim().split(/\s+/)[0] ?? "";
  const number = doc.number ?? "";
  const empty = lines.length === 0 || !isPositive(doc.total);
  const pastValid = !isInvoice && proposal !== undefined && proposal.valid_until !== null && proposal.valid_until < today;
  const blocked = empty || pastValid || doc.status !== "draft";
  const refused = typeof draft["refused"] === "string" ? (draft["refused"] as string) : null;
  const terms = invoice?.terms ?? client?.terms ?? null;

  function landed(out: Outcome<Proposal> | Outcome<Invoice>): void {
    if (!out.ok) {
      setDraft({ refused: t(refusalKey(out.reason), { id: number }) });
      return;
    }
    toast(t("composer.toast.sent", { first }), { icon: "send" });
    open(isInvoice ? "invoice" : "proposal", out.value.id);
  }

  async function submit(): Promise<void> {
    if (doc === undefined || blocked) return;
    if (isInvoice) {
      landed(await saveFromSheet(() => sendSavedInvoice(doc.id)));
      return;
    }
    const replacedReason = number === "" ? t("composer.replacedByRevision") : t("composer.replacedBy", { number });
    landed(await saveFromSheet(() => sendProposal(storedProposalDraft(doc as Proposal, proposalLines.filter((l) => l.document_id === doc.id)), { replacedReason })));
  }

  return (
    <Sheet title={number === "" ? t("composer.sheet.sendDraft") : t("composer.sheet.sendTitle", { number })} sub={client?.company} icon={SendIcon} onClose={onClose}>
      <dl className="cmp-send-facts">
        <div>
          <dt>{t("composer.sheet.to")}</dt>
          <dd>{client === undefined ? "" : t("composer.sheet.toLine", { contact: client.contact_name, company: client.company, email: client.email })}</dd>
        </div>
        <div>
          <dt>{t("lines.total")}</dt>
          <dd>
            <Money value={doc.total} currency={doc.currency} />
          </dd>
        </div>
        <div>
          <dt>{isInvoice ? t("composer.sheet.due") : t("composer.validUntil")}</dt>
          <dd className="cmp-send-mono">
            {isInvoice
              ? terms === null
                ? ""
                : t("composer.dueIfSent", { date: dayLabel(addDays(today, TERM_DAYS[terms]), locale, "short") })
              : dayLabel(proposal?.valid_until, locale, "long")}
          </dd>
        </div>
      </dl>
      {empty && <Alert tone="warn">{t("composer.footNoLine")}</Alert>}
      {!empty && pastValid && <Alert tone="warn">{t("composer.sheet.pastValid")}</Alert>}
      {unfinished !== null && <UnfinishedLine unfinished={unfinished} busy={busy} onFinish={() => void saveFromSheet(() => unfinished.resume() as Promise<Outcome<Proposal>>).then(landed)} />}
      {refused !== null && unfinished === null && <Alert>{refused}</Alert>}
      <Button kind="primary" size="wide" icon={SendIcon} busy={busy} disabled={blocked || unfinished !== null} aria-describedby="cmp-send-foot" onClick={() => void submit()}>
        {first === "" ? t("composer.sendPlain") : t("composer.send", { first })}
      </Button>
      {blocked && doc.status === "draft" && (
        <Button
          icon={SquarePen}
          onClick={() => {
            closeSheet();
            openComposer({ kind: isInvoice ? "invoice" : "proposal", id: doc.id });
          }}
        >
          {t("proposals.openInComposer")}
        </Button>
      )}
      <span className="cmp-send-foot" id="cmp-send-foot">
        {t("composer.footSend", { first })}
      </span>
    </Sheet>
  );
}
