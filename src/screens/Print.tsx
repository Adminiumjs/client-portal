/**
 * The printed copy: a document as the client receives it — an invoice, a
 * proposal, a receipt for one payment, or a client's statement over a period.
 *
 * The document is the Invoices & Receipts add-on's own: Adminium draws it and
 * the page shows its print copy, with "Print or save as PDF" and — where the
 * add-on's PDF can draw the page's language — "Download PDF". Letter or A4
 * sets the sheet on screen. The demo shows the copy the add-on drew at build
 * time. When no copy can be asked for here, the page draws the same document
 * itself from the stored rows.
 *
 * A draft has no printed copy (nothing has been issued); a void invoice has
 * one, marked void.
 */
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Download, Printer } from "lucide-react";

import { Alert, Button } from "../components/ui.tsx";
import { useI18n } from "../i18n/index.tsx";
import { today } from "../lib/clock.ts";
import { ensureRows, loadClient, loadInvoice, loadProposal, useDesk, useSettings } from "../state/desk.ts";
import { go, open, setPrintTarget, usePrintTarget, type PrintTarget } from "../state/ui.ts";
import { documentPort, pdfDraws, type DocumentLink } from "./print/document.ts";
import { PaperSheet, type Paper } from "./print/Paper.tsx";
import type { StatementPeriod } from "./print/target.ts";

const PERIODS: readonly StatementPeriod[] = ["all", "year", "12m"];

export default function Print() {
  const { t, locale } = useI18n();
  const target = usePrintTarget();
  const day = useDesk((s) => s.today) || today();
  const settings = useSettings();
  const rows = useDesk((s) => s.rows);
  const [paper, setPaper] = useState<Paper>("letter");
  const [link, setLink] = useState<{ key: string; value: DocumentLink | null; error: string | null }>({ key: "", value: null, error: null });
  const frame = useRef<HTMLIFrameElement>(null);
  const port = documentPort();
  const key = target === null ? "" : `${target.kind}:${String(target.id)}:${target.kind === "statement" ? target.period : ""}:${locale}`;

  // The rows the document shows.
  useEffect(() => {
    if (target === null) return;
    const read = async () => {
      if (target.kind === "invoice") await loadInvoice(target.id);
      else if (target.kind === "quote") await loadProposal(target.id);
      else if (target.kind === "statement") await loadClient(target.id);
      else {
        await ensureRows("payments", [target.id]);
        const pay = useDesk.getState().rows.payments[target.id];
        if (pay !== undefined) await loadInvoice(pay.document_id);
      }
    };
    void read().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.kind, target?.id]);

  // Adminium's own copy of it, when it can be asked for.
  useEffect(() => {
    if (target === null || port === null) return;
    let live = true;
    setLink({ key, value: null, error: null });
    port(target, locale)
      .then((value) => live && setLink({ key, value, error: null }))
      .catch((error: unknown) => live && setLink({ key, value: null, error: error instanceof Error ? error.message : String(error) }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, port === null]);

  const back = backOf(target, rows.payments);
  const label = labelOf(target, rows, t);
  const server = port !== null && link.key === key ? link : null;

  const print = () => {
    const win = frame.current?.contentWindow;
    try {
      if (win !== null && win !== undefined) win.print();
      else window.print();
    } catch {
      if (server?.value != null) window.open(server.value.printUrl, "_blank", "noopener");
      else window.print();
    }
  };

  return (
    <section className="screen ol-screen pr-screen" data-screen="print" aria-labelledby="print-title">
      <div className="ol-noprint pr-tools">
        {back !== null && (
          <Button size="small" icon={ArrowLeft} className="pr-back" onClick={back.go}>
            {t("invoices.print.back", { id: label })}
          </Button>
        )}
        <div>
          <h1 className="screen-title" id="print-title">
            {t("invoices.print.title")}
          </h1>
          <p className="screen-lead">{t("invoices.print.lead")}</p>
        </div>
        {target !== null && (
          <div className="pr-toolbar">
            {target.kind === "statement" && (
              <div className="pr-seg" role="group" aria-label={t("invoices.print.periodLabel")}>
                {PERIODS.map((p) => (
                  <button key={p} type="button" className="pr-seg-chip ol-chip" aria-pressed={target.period === p} onClick={() => setPrintTarget({ ...target, period: p })}>
                    {t(`invoices.print.period.${p}`)}
                  </button>
                ))}
              </div>
            )}
            <Button kind="primary" icon={Printer} onClick={print}>
              {t("invoices.print.print")}
            </Button>
            {server?.value != null && server.value.contentUrl !== null && pdfDraws(locale) ? (
              <a className="btn ol-gi" href={server.value.contentUrl} download>
                <Download size={16} aria-hidden="true" />
                {t("invoices.print.pdf")}
              </a>
            ) : (
              <span className="pr-note">{server?.value == null ? t("invoices.print.drawnHere") : server.value.contentUrl === null ? t("invoices.print.savePdf") : t("invoices.print.noPdf")}</span>
            )}
            <div className="pr-seg" role="group" aria-label={t("invoices.print.paperLabel")}>
              {(["letter", "a4"] as const).map((p) => (
                <button key={p} type="button" className="pr-seg-chip ol-chip" aria-pressed={paper === p} onClick={() => setPaper(p)}>
                  {t(`invoices.print.paper.${p}`)}
                </button>
              ))}
            </div>
            <span className="pr-size">{t(`invoices.print.size.${paper}`)}</span>
          </div>
        )}
        {server?.error != null && <Alert>{t("invoices.print.failed")}</Alert>}
      </div>

      {target === null ? (
        <p className="pr-empty">{t("invoices.print.nothing")}</p>
      ) : isDraft(target, rows) ? (
        <p className="pr-empty">{t("invoices.print.draft")}</p>
      ) : server?.value != null ? (
        <div className="pr-wrap">
          <iframe ref={frame} className={`pr-frame pr-sheet--${paper}`} src={server.value.printUrl} title={t("invoices.print.frameTitle", { id: label })} />
        </div>
      ) : (
        <div className="pr-wrap">
          <PaperSheet
            target={target}
            paper={paper}
            day={day}
            rows={{
              settings,
              clients: rows.clients,
              invoices: rows.invoices,
              invoiceLines: Object.values(rows.invoice_lines),
              payments: Object.values(rows.payments),
              proposals: rows.proposals,
              proposalLines: Object.values(rows.proposal_lines),
              termsVersions: rows.terms_versions,
            }}
          />
        </div>
      )}
    </section>
  );
}

type Rows = ReturnType<typeof useDesk.getState>["rows"];

/** A draft invoice or proposal has no printed copy: it has not been issued. */
function isDraft(target: PrintTarget, rows: Rows): boolean {
  if (target.kind === "invoice") {
    const inv = rows.invoices[target.id];
    return inv !== undefined && (inv.status === "draft" || (inv.status === "void" && inv.issued_on === null));
  }
  if (target.kind === "quote") return rows.proposals[target.id]?.status === "draft";
  return false;
}

/** Where "back" goes: the document the copy was opened from. */
function backOf(target: PrintTarget | null, payments: Rows["payments"]): { go: () => void } | null {
  if (target === null) return { go: () => go("invoices") };
  switch (target.kind) {
    case "invoice":
      return { go: () => open("invoice", target.id) };
    case "quote":
      return { go: () => open("proposal", target.id) };
    case "receipt": {
      const inv = payments[target.id]?.document_id;
      return inv === undefined ? { go: () => go("invoices") } : { go: () => open("invoice", inv) };
    }
    case "statement":
      return { go: () => open("client", target.id) };
  }
}

/** The document's own name, for "Back to …" and the frame's title. */
function labelOf(target: PrintTarget | null, rows: Rows, t: ReturnType<typeof useI18n>["t"]): string {
  if (target === null) return t("nav.invoices");
  switch (target.kind) {
    case "invoice":
      return rows.invoices[target.id]?.number ?? "";
    case "quote":
      return rows.proposals[target.id]?.number ?? rows.proposals[target.id]?.title ?? "";
    case "receipt":
      return rows.payments[target.id]?.number ?? "";
    case "statement":
      return rows.clients[target.id]?.company ?? "";
  }
}
