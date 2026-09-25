/**
 * The enquiry form's two faces, drawn from what the page holds: the form
 * (with its field problems, the human check's small area and a refusal in
 * words), and the thank-you once the studio's server took it — which shows
 * when it arrived and nothing else, since nothing else comes back.
 */
import type { ReactNode, Ref } from "react";
import { Check, CircleAlert, ExternalLink, FileSearch, LoaderCircle, RotateCcw, Send, ShieldCheck } from "lucide-react";

import { When } from "../../../components/ui.tsx";
import type { Instant } from "../../../data/types.ts";
import { useI18n, type MessageKey } from "../../../i18n/index.tsx";
import { slot } from "../shared/slot.tsx";
import { BUDGETS, MAX, type Budget, type EnquireField, type EnquireInput, type Refused } from "./model.ts";

export const FORM_TITLE_ID = "enquire-title";

const fieldId = (field: EnquireField) => `enquire-${field.replace("_", "-")}`;
const errorId = (field: EnquireField) => `${fieldId(field)}-error`;

/** The studio's own site, when it is an ordinary web address: its link and its host name. */
export function siteOf(website: string | null | undefined): { href: string; host: string } | null {
  if (website === null || website === undefined || !/^https?:\/\//i.test(website.trim())) return null;
  try {
    const url = new URL(website.trim());
    return { href: url.href, host: url.host.replace(/^www\./, "") };
  } catch {
    return null;
  }
}

function FieldBox({ field, label, optional, problem, wide, children }: { field: EnquireField; label: MessageKey; optional?: boolean; problem: MessageKey | undefined; wide?: boolean; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className={`cl-field enquire-field${wide === true ? " enquire-field--wide" : ""}`}>
      <label className="enquire-label" htmlFor={fieldId(field)}>
        {t(label)}
        {optional === true && <span className="enquire-optional">{t("enquire.optional")}</span>}
      </label>
      {children}
      {problem !== undefined && (
        <span className="cl-error" id={errorId(field)}>
          <CircleAlert size={14} aria-hidden="true" />
          {t(problem)}
        </span>
      )}
    </div>
  );
}

/** The refusal's words, and — where it helps — the studio's address to write to instead. */
export function RefusedLine({ refused, replyTo }: { refused: Refused; replyTo: string | null }) {
  const { t } = useI18n();
  return (
    <div className={`alert enquire-refused${refused.tone === "warn" ? " alert--warn" : ""}`} role="alert">
      <CircleAlert size={15} aria-hidden="true" />
      <span>
        {t(refused.key)}
        {refused.writeInstead && replyTo !== null && replyTo !== "" && (
          <>
            {" "}
            {slot(
              t("enquire.refused.writeTo", { email: "{email}" }),
              "email",
              <a className="enquire-mail" href={`mailto:${replyTo}`} dir="ltr">
                {replyTo}
              </a>,
            )}
          </>
        )}
      </span>
    </div>
  );
}

export interface FormViewProps {
  input: EnquireInput;
  problems: Partial<Record<EnquireField, MessageKey>>;
  sending: boolean;
  refused: Refused | null;
  studioName: string;
  replyTo: string | null;
  onChange: (field: EnquireField, value: string) => void;
  onSubmit: () => void;
  onFind: () => void;
  /** A budget band in words, in the studio's currency. */
  band: (budget: Budget) => string;
  /** Where each field's element goes, so the first with a problem can take the focus. */
  bind?: (field: EnquireField) => (element: HTMLElement | null) => void;
}

export function FormView({ input, problems, sending, refused, studioName, replyTo, onChange, onSubmit, onFind, band: bandWords, bind }: FormViewProps) {
  const { t } = useI18n();
  const control = (field: EnquireField) => ({
    id: fieldId(field),
    name: field,
    value: input[field],
    "aria-invalid": problems[field] !== undefined,
    "aria-describedby": problems[field] !== undefined ? errorId(field) : undefined,
    ref: bind?.(field),
    onChange: (e: { target: { value: string } }) => onChange(field, e.target.value),
  });
  const text = (field: Exclude<EnquireField, "budget" | "body">, autoComplete: string, placeholder?: MessageKey) => (
    <input
      {...control(field)}
      className="input cl-input-lg ol-fld"
      type={field === "email" ? "email" : "text"}
      autoComplete={autoComplete}
      maxLength={MAX[field]}
      placeholder={placeholder === undefined ? undefined : t(placeholder)}
      required={field === "name" || field === "email" ? true : undefined}
    />
  );
  return (
    <section className="screen ol-screen cl-page enquire" data-screen="client-enquire" aria-labelledby={FORM_TITLE_ID}>
      <div className="enquire-head">
        {studioName !== "" && <span className="cl-mono-kicker">{studioName}</span>}
        <h1 className="cl-find-title enquire-title" id={FORM_TITLE_ID}>
          {t("screen.enquire")}
        </h1>
        <p className="cl-find-lead enquire-lead">{t("enquire.lead")}</p>
      </div>
      <form
        className="cl-card enquire-card"
        noValidate
        aria-labelledby={FORM_TITLE_ID}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <div className="enquire-grid">
          <FieldBox field="name" label="enquire.name" problem={problems.name}>
            {text("name", "name")}
          </FieldBox>
          <FieldBox field="email" label="enquire.email" problem={problems.email}>
            {text("email", "email", "enquire.emailPlaceholder")}
          </FieldBox>
          <FieldBox field="business" label="enquire.business" optional problem={problems.business}>
            {text("business", "organization")}
          </FieldBox>
          <FieldBox field="trade" label="enquire.trade" optional problem={problems.trade}>
            {text("trade", "off", "enquire.tradePlaceholder")}
          </FieldBox>
          <FieldBox field="budget" label="enquire.budget" optional problem={problems.budget}>
            <select {...control("budget")} className="input cl-input-lg ol-fld enquire-select">
              <option value="">{t("enquire.budgetNotSure")}</option>
              {BUDGETS.map((band) => (
                <option key={band} value={band}>
                  {bandWords(band)}
                </option>
              ))}
            </select>
          </FieldBox>
          <FieldBox field="start_when" label="enquire.start" optional problem={problems.start_when}>
            {text("start_when", "off", "enquire.startPlaceholder")}
          </FieldBox>
          <FieldBox field="body" label="enquire.body" problem={problems.body} wide>
            <textarea {...control("body")} className="input ol-fld enquire-body" rows={6} maxLength={MAX.body} required placeholder={t("enquire.bodyPlaceholder")} />
          </FieldBox>
        </div>

        <div className="enquire-check" role="status">
          {sending ? <LoaderCircle size={16} className="btn-spin" aria-hidden="true" /> : <ShieldCheck size={16} aria-hidden="true" />}
          <span>{sending ? t("enquire.checking") : t("enquire.check")}</span>
        </div>

        {refused !== null && refused.field === null && <RefusedLine refused={refused} replyTo={replyTo} />}

        <button type="submit" className="btn btn--primary ol-btn cl-btn-huge enquire-send" disabled={sending} aria-busy={sending || undefined}>
          <Send size={17} aria-hidden="true" />
          {studioName === "" ? t("enquire.sendPlain") : t("enquire.send", { studio: studioName })}
        </button>
        <p className="cl-fine enquire-fine">{studioName === "" ? t("enquire.finePlain") : t("enquire.fine", { studio: studioName })}</p>
      </form>

      <p className="enquire-already">
        <span className="cl-subtle">{t("enquire.already")}</span>
        <button type="button" className="cl-link-btn ol-gi" onClick={onFind}>
          <FileSearch size={14} aria-hidden="true" />
          {t("enquire.find")}
        </button>
      </p>
    </section>
  );
}

export interface SentViewProps {
  receivedAt: Instant | null;
  studioName: string;
  website: string | null;
  onAnother: () => void;
  onFind: () => void;
  headingRef?: Ref<HTMLHeadingElement>;
}

export const SENT_TITLE_ID = "enquire-sent-title";

export function SentView({ receivedAt, studioName, website, onAnother, onFind, headingRef }: SentViewProps) {
  const { t } = useI18n();
  const site = siteOf(website);
  return (
    <section className="screen ol-screen cl-page enquire" data-screen="client-enquire" data-state="sent" aria-labelledby={SENT_TITLE_ID}>
      <div className="cl-card enquire-sent">
        <span className="cl-done-badge" aria-hidden="true">
          <Check size={28} />
        </span>
        <h1 className="cl-h1 cl-h1--done enquire-sent-title" id={SENT_TITLE_ID} tabIndex={-1} ref={headingRef}>
          {studioName === "" ? t("enquire.sent.titlePlain") : t("enquire.sent.title", { studio: studioName })}
        </h1>
        <p className="cl-muted cl-body enquire-sent-body">{t("enquire.sent.body")}</p>
        {receivedAt !== null && (
          <p className="cl-mono-kicker enquire-sent-at">{slot(t("enquire.sent.at", { when: "{when}" }), "when", <When at={receivedAt} />)}</p>
        )}
        <div className="cl-row-wrap enquire-sent-actions">
          <button type="button" className="btn ol-gi" onClick={onAnother}>
            <RotateCcw size={16} aria-hidden="true" />
            {t("enquire.sent.another")}
          </button>
          {site !== null && (
            <a className="btn ol-gi" href={site.href} rel="noopener">
              <ExternalLink size={16} aria-hidden="true" />
              {t("enquire.sent.site", { site: site.host })}
            </a>
          )}
        </div>
      </div>
      <p className="enquire-already">
        <span className="cl-subtle">{t("enquire.already")}</span>
        <button type="button" className="cl-link-btn ol-gi" onClick={onFind}>
          <FileSearch size={14} aria-hidden="true" />
          {t("enquire.find")}
        </button>
      </p>
    </section>
  );
}
