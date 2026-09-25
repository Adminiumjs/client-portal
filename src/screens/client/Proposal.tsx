/**
 * One of the client's proposals: what the studio will do, what it costs (the
 * stored lines and totals), until when the price holds — and what the client
 * can do with it now.
 *
 *   still holding its price   Accept proposal → type your name, tick the
 *                             terms (the version this proposal names, readable
 *                             in full) → Accept and sign; or Decline… with an
 *                             optional note
 *   past its date             "Proposal out of date" and Ask for a new price
 *                             (once; it stays asked after a reload)
 *   accepted on their word    sign it: the typed name and the terms, nothing else
 *   decided                   accepted and signed / declined / withdrawn, and
 *                             "See progress" once the project has started
 *
 * Who signed, when, from which address and the fingerprint are Adminium's;
 * the page sends only the typed name (or the note).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarX, Check, CircleCheck, CircleSlash, CircleX, FileText, PenLine, Send, X } from "lucide-react";

import { Alert, Button, LinesTable, StatusPill } from "../../components/ui.tsx";
import { useI18n } from "../../i18n/index.tsx";
import { acceptAndSign, askForNewPrice, declineProposal, signAccepted } from "../../state/clientActions.ts";
import { loadClientProposal, usePortal, usePortalRow, usePortalRows } from "../../state/portal.ts";
import { openSheet } from "../../state/sheets.ts";
import { open, toast } from "../../state/ui.ts";
import NotFound from "./NotFound.tsx";
import { AlsoWith, useDay, useSelected } from "./shared/bits.tsx";
import { byPosition, canDecide, canSign, dayOf, isStale, needsSignature, proposalState } from "./shared/model.ts";
import { sayRefusal, useOpened, useSignedIn } from "./shared/page.ts";
import { today, studioZone } from "../../lib/clock.ts";

/** The name, the tick and "Read the terms" — shared by Accept and sign and by sign-only. */
function SignFields({ name, setName, agreed, setAgreed, placeholder, label, termsVersionId }: { name: string; setName: (v: string) => void; agreed: boolean; setAgreed: (v: boolean) => void; placeholder: string; label: string; termsVersionId: number | null }) {
  const { t } = useI18n();
  const studio = usePortal((s) => s.studio?.settings?.name ?? "");
  const version = usePortalRow("terms_versions", termsVersionId);
  return (
    <>
      <label className="cl-field">
        <span className="cl-label">{label}</span>
        <input className="input cl-input-sign ol-fld" autoComplete="name" value={name} placeholder={placeholder} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="cl-tick">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        <span>
          {termsVersionId === null ? t("client.proposal.agreeNoTerms") : t("client.proposal.agree", { studio })}
          {version?.version !== null && version?.version !== undefined && (
            <>
              {" "}
              <span className="cl-mono-inline">{`(v${version.version})`}</span>
            </>
          )}
        </span>
      </label>
      {termsVersionId !== null && (
        <button type="button" className="cl-link-btn ol-gi" onClick={() => openSheet({ kind: "terms", versionId: termsVersionId })}>
          <FileText size={14} aria-hidden="true" />
          {t("client.proposal.readTerms")}
        </button>
      )}
    </>
  );
}

export default function Proposal() {
  const { t, number } = useI18n();
  const date = useDay();
  const signedIn = useSignedIn();
  const id = useSelected("proposal");
  const p = usePortalRow("proposals", id);
  const ready = useOpened(id, loadClientProposal, p !== undefined);
  const me = usePortal((s) => s.me);
  const studio = usePortal((s) => s.studio?.settings?.name ?? "");
  const allLines = usePortalRows("proposal_lines");
  const projects = usePortalRows("projects");
  const [step, setStep] = useState<"ask" | "sign">("ask");
  const [name, setName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noteBox = useRef<HTMLTextAreaElement>(null);

  // A different proposal starts from the question again.
  useEffect(() => {
    setStep("ask");
    setName("");
    setAgreed(false);
    setDeclining(false);
    setNote("");
    setError(null);
  }, [id]);
  useEffect(() => {
    if (declining) noteBox.current?.focus();
  }, [declining]);

  const reread = useCallback(() => (id === null ? Promise.resolve() : loadClientProposal(id).catch(() => undefined)), [id]);

  if (!signedIn) return null;
  if (!ready) return <section className="screen ol-screen cl-page" data-screen="client-proposal" aria-busy="true" />;
  if (p === undefined || p.status === "draft") return <NotFound />;

  const day = today();
  const zone = studioZone();
  const lines = allLines.filter((l) => l.document_id === p.id).sort(byPosition);
  const project = projects.find((j) => j.proposal_id === p.id);
  const stale = isStale(p, day);
  const decidable = canDecide(p, day);
  const signOnly = needsSignature(p);
  const decidedOn = dayOf(p.decided_at, zone);
  const taxLabel = t("lines.tax", { name: p.tax_name ?? "", rate: p.tax_rate === null ? number(0) : number(Number(p.tax_rate), { maximumFractionDigits: 2 }) });
  const scope = (p.scope ?? "").split(/\n\s*\n|\n/).map((s) => s.trim()).filter((s) => s !== "");

  const act = async (run: () => Promise<{ ok: boolean }>, done: string) => {
    if (busy) return;
    setBusy(true);
    const out = await run();
    setBusy(false);
    if (out.ok) {
      setError(null);
      toast(done, { icon: "check" });
      return true;
    }
    setError(sayRefusal(t, out as never));
    await reread();
    return false;
  };

  const sign = () =>
    void act(() => acceptAndSign(p.id, name), t("client.proposal.signedToast")).then((ok) => {
      if (ok) setStep("ask");
    });
  const signOnlyNow = () => void act(() => signAccepted(p.id, name), t("client.proposal.signOnlyToast"));
  const decline = () =>
    void act(() => declineProposal(p.id, note.trim() === "" ? null : note), t("client.proposal.declinedToast")).then((ok) => {
      if (ok) setDeclining(false);
    });
  const askPrice = () => void act(() => askForNewPrice(p.id), t("client.proposal.askedToast", { studio }));

  const decidedTone = p.status === "withdrawn" ? "withdrawn" : p.status === "accepted" ? "accepted" : "declined";
  const DecidedIcon = p.status === "withdrawn" ? CircleSlash : p.status === "accepted" ? CircleCheck : CircleX;

  return (
    <section className="screen ol-screen cl-page" data-screen="client-proposal" aria-labelledby="cl-proposal-title">
      <article className="cl-card cl-doc-card">
        <div className="cl-doc-head">
          <div className="cl-doc-line">
            <span className="cl-doc-number">{p.number}</span>
            <StatusPill status={proposalState(p, day)} />
            {p.sent_at !== null && (
              <span className="cl-doc-dates">{t("client.proposal.sentOn", { date: date(dayOf(p.sent_at, zone), "long") })}</span>
            )}
          </div>
          <h1 className="cl-doc-title" id="cl-proposal-title">
            {p.title}
          </h1>
          {me !== null && <p className="cl-doc-for">{t("client.proposal.for", { contact: me.contact_name, company: me.company, studio })}</p>}
        </div>
        <div className="cl-doc-body">
          {scope.length > 0 && (
            <section aria-labelledby="cl-proposal-scope">
              <h2 className="cl-kicker" id="cl-proposal-scope">
                {t("client.proposal.scope")}
              </h2>
              <div className="cl-scope">
                {scope.map((para, i) => (
                  <p key={i}>{para}</p>
                ))}
              </div>
            </section>
          )}
          <section aria-labelledby="cl-proposal-costs">
            <h2 className="cl-kicker" id="cl-proposal-costs">
              {t("client.proposal.costs")}
            </h2>
            <div className="cl-lines">
              <LinesTable
                lines={lines.map((l) => ({ key: l.id, description: l.description ?? "", qty: l.qty, rate: l.rate, amount: l.amount, discount: l.discount_kind === "amount" ? l.discount : null }))}
                subtotal={p.subtotal}
                tax={p.tax}
                taxName={p.tax_name}
                taxRate={p.tax_rate}
                total={p.total}
                currency={p.currency}
              />
            </div>
            {p.valid_until !== null && (
              <p className="cl-fine">{t("client.proposal.holds", { date: date(p.valid_until, "long"), tax: taxLabel })}</p>
            )}
          </section>
        </div>
      </article>

      {error !== null && <Alert>{error}</Alert>}

      {decidable && (
        <div className="cl-card cl-decide" role="group" aria-labelledby="cl-decide-lead">
          {step === "ask" ? (
            <>
              <span className="cl-decide-lead" id="cl-decide-lead">
                {t("client.proposal.decideLead")}
              </span>
              <button
                type="button"
                className="btn cl-btn-pos cl-btn-huge ol-btn"
                onClick={() => {
                  setDeclining(false);
                  setStep("sign");
                }}
              >
                <Check size={19} aria-hidden="true" />
                {t("client.proposal.accept")}
              </button>
              <button type="button" className="btn ol-gi cl-btn-quiet" aria-expanded={declining} onClick={() => setDeclining(true)}>
                {t("client.proposal.declineOpen")}
              </button>
            </>
          ) : (
            <>
              <span className="cl-decide-lead" id="cl-decide-lead">
                {t("client.proposal.decideLead")}
              </span>
              <SignFields name={name} setName={setName} agreed={agreed} setAgreed={setAgreed} placeholder={me?.contact_name ?? ""} label={t("client.proposal.fullName")} termsVersionId={p.terms_version_id} />
              <div className="cl-row-wrap">
                <button type="button" className="btn cl-btn-pos cl-btn-sign ol-btn" disabled={!canSign(name, agreed) || busy} aria-busy={busy || undefined} onClick={sign}>
                  <PenLine size={18} aria-hidden="true" />
                  {t("client.proposal.acceptSign")}
                </button>
                <Button onClick={() => setStep("ask")}>{t("common.back")}</Button>
              </div>
            </>
          )}
          {declining && (
            <div
              className="cl-pop"
              role="group"
              aria-labelledby="cl-decline-title"
              onKeyDown={(e) => {
                if (e.key === "Escape") setDeclining(false);
              }}
            >
              <div className="cl-pop-head">
                <span className="cl-pop-title" id="cl-decline-title">
                  {t("client.proposal.declineTitle")}
                </span>
                <button type="button" className="icon-btn cl-pop-close ol-gi" aria-label={t("common.close")} title={t("common.close")} onClick={() => setDeclining(false)}>
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
              <label className="cl-field">
                <span className="cl-muted cl-small">{t("client.proposal.declineHint")}</span>
                <textarea ref={noteBox} className="input ol-fld" rows={3} value={note} placeholder={t("client.proposal.declinePlaceholder")} onChange={(e) => setNote(e.target.value)} />
              </label>
              <button type="button" className="btn cl-btn-danger-solid ol-btn" disabled={busy} aria-busy={busy || undefined} onClick={decline}>
                {t("client.proposal.declineSend")}
              </button>
            </div>
          )}
        </div>
      )}

      {stale && (
        <div className="cl-card cl-pad cl-stack cl-stale">
          <span className="cl-stale-kicker">
            <span className="cl-badge cl-badge--muted" aria-hidden="true">
              <CalendarX size={17} />
            </span>
            <span className="cl-mono-kicker">{t("client.proposal.staleKicker")}</span>
          </span>
          <h2 className="cl-h2 cl-h2--big">{t("client.proposal.staleTitle", { id: p.number ?? p.title, date: date(p.valid_until) })}</h2>
          <p className="cl-muted cl-body">{t("client.proposal.staleBody")}</p>
          <div className="cl-row-wrap">
            <Button kind="primary" icon={Send} disabled={p.new_price_asked_at !== null || p.new_price_asked} busy={busy} onClick={askPrice}>
              {p.new_price_asked_at !== null || p.new_price_asked ? t("client.proposal.asked") : t("client.proposal.askPrice")}
            </Button>
          </div>
          <span className="cl-fine">{t("client.proposal.staleFoot")}</span>
        </div>
      )}

      {signOnly && (
        <div className="cl-card cl-decide" role="group" aria-labelledby="cl-signonly-lead">
          <span className="cl-decide-lead" id="cl-signonly-lead">
            {decidedOn === null ? t("client.proposal.signOnlyLeadNoDay") : t("client.proposal.signOnlyLead", { date: date(decidedOn, "long") })}
          </span>
          <SignFields name={name} setName={setName} agreed={agreed} setAgreed={setAgreed} placeholder={me?.contact_name ?? ""} label={t("client.proposal.typeName")} termsVersionId={p.terms_version_id} />
          <div className="cl-row-wrap">
            <button type="button" className="btn cl-btn-pos cl-btn-sign ol-btn" disabled={!canSign(name, agreed) || busy} aria-busy={busy || undefined} onClick={signOnlyNow}>
              <PenLine size={18} aria-hidden="true" />
              {t("client.proposal.sign")}
            </button>
          </div>
        </div>
      )}

      {!signOnly && (p.status === "accepted" || p.status === "declined" || p.status === "withdrawn") && (
        <div className={`cl-decided cl-decided--${decidedTone}`} role="status">
          <DecidedIcon size={20} aria-hidden="true" className="cl-decided-icon" />
          <span className="cl-decided-text">
            <span className="cl-decided-title">
              {p.status === "withdrawn"
                ? t("client.proposal.withdrawnOn", { date: date(decidedOn) })
                : p.status === "accepted"
                  ? p.signed_name !== null && p.signed_name !== ""
                    ? t("client.proposal.signedOn", { date: date(dayOf(p.signed_at ?? p.decided_at, zone)), name: p.signed_name })
                    : decidedOn === null
                      ? t("client.proposal.acceptedNoDay")
                      : t("client.proposal.acceptedOn", { date: date(decidedOn, "long") })
                  : decidedOn === null
                    ? t("client.proposal.declinedNoDay")
                    : t("client.proposal.declinedOn", { date: date(decidedOn, "long") })}
            </span>
            <span className="cl-decided-body">
              {p.status === "withdrawn"
                ? t("client.proposal.withdrawnBody")
                : p.status === "accepted"
                  ? t(project === undefined ? "client.proposal.starting" : "client.proposal.started")
                  : p.decline_note !== null && p.decline_note.trim() !== ""
                    ? t("client.proposal.youSaid", { note: p.decline_note })
                    : t("client.proposal.noNote")}
            </span>
          </span>
          {p.status === "accepted" && project !== undefined && (
            <Button size="small" onClick={() => open("project", project.id)}>
              {t("client.proposal.seeProgress")}
            </Button>
          )}
        </div>
      )}

      <AlsoWith current={{ kind: "proposal", id: p.id }} />
    </section>
  );
}
