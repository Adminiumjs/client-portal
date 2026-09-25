/**
 * Every email we send, as the person receiving it sees it.
 *
 * Twelve to clients and nine to the studio, each drawn from its template —
 * the one Adminium keeps (as edited in Email Templates, when it was) or the
 * one this app ships — filled with the studio's own rows the way the outbox
 * fills a real one: designed, as plain text, or at a phone's width, in any
 * of the eight languages. Beside it, when each goes out, and two ways to try
 * it: follow its link (to the client's page, seen as the studio's preview,
 * or to the desk's) and send it once to the studio's own address.
 *
 * Nothing on the page writes a row; a test goes through Adminium's Email
 * Templates test send (`emails/send.ts`).
 */
import { useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Bell,
  BellRing,
  CircleCheck,
  CircleX,
  ClipboardList,
  ExternalLink,
  Eye,
  HandCoins,
  Inbox,
  KeyRound,
  ListChecks,
  Mail,
  MailCheck,
  MessageSquare,
  PackageCheck,
  PanelsTopLeft,
  Pause,
  PencilLine,
  PenLine,
  Receipt,
  ReceiptText,
  Send,
  Smartphone,
  Tag,
  Timer,
  Type,
} from "lucide-react";

import { Alert, Button } from "../components/ui.tsx";
import { LOCALES, LOCALE_TAGS, useI18n, type LocaleTag, type MessageKey } from "../i18n/index.tsx";
import { addOnText, deskWrites, useAddOnSettings, useDesk, useSettings } from "../state/desk.ts";
import { previewClient } from "../state/preview.ts";
import { go, open, toast, useUi } from "../state/ui.ts";
import { EmailCard, type Mode } from "./emails/EmailCard.tsx";
import { CLIENT_EMAILS, STUDIO_EMAILS, adminiumLocale, filled, isStudioEmail, pieces, shippedDoc, templateKey, type EmailDoc, type EmailKind } from "./emails/model.ts";
import { followOf, loadSampleRows, pick, placesFrom, recipientOf, valuesFor, type Follow } from "./emails/samples.ts";
import { sendTest, type TestProblem } from "./emails/send.ts";

const ICONS: Readonly<Record<EmailKind, LucideIcon>> = {
  "sign-in-link": KeyRound,
  "proposal-sent": Send,
  "proposal-reminder": Timer,
  "invoice-sent": ReceiptText,
  "invoice-rung-1": Mail,
  "invoice-rung-2": BellRing,
  "invoice-rung-3": Pause,
  "payment-receipt": Receipt,
  "new-work": Eye,
  handover: PackageCheck,
  "enquiry-reply": Inbox,
  "ask-to-sign": PenLine,
  "accepted-and-signed": PenLine,
  declined: CircleX,
  "asked-for-a-new-price": Tag,
  "changes-requested": PencilLine,
  approved: CircleCheck,
  "new-note": MessageSquare,
  "client-says-paid": HandCoins,
  "brief-sent": ClipboardList,
  "new-enquiry": Inbox,
};

const MODES: readonly { id: Mode; key: MessageKey; icon: LucideIcon }[] = [
  { id: "rich", key: "emails.mode.rich", icon: PanelsTopLeft },
  { id: "plain", key: "emails.mode.plain", icon: Type },
  { id: "narrow", key: "emails.mode.narrow", icon: Smartphone },
];

const RULES: readonly { key: MessageKey; icon: LucideIcon }[] = [
  { key: "emails.rules.signIn", icon: KeyRound },
  { key: "emails.rules.reminders", icon: Bell },
  { key: "emails.rules.handover", icon: PackageCheck },
  { key: "emails.rules.studio", icon: BellRing },
];

const PROBLEM_KEYS: Readonly<Record<TestProblem, MessageKey>> = {
  "no-sender": "emails.test.noSender",
  "no-reply-to": "emails.test.noReplyTo",
  "live-link": "emails.test.liveLink",
  "no-template": "emails.test.noTemplate",
  "not-allowed": "emails.test.notAllowed",
  "no-email": "emails.test.noEmail",
  "signed-out": "save.signedOut",
  offline: "save.offline",
  refused: "emails.test.refused",
};

/** A sample six-digit code: what the sign-in email shows in its place. */
const SAMPLE_CODE = "481926";

/** The rows the samples read beyond the open work, once the desk knows its day. */
function useSampleRows(today: string): void {
  useEffect(() => {
    if (today !== "") void loadSampleRows().catch(() => undefined);
  }, [today]);
}

/** The template Adminium keeps for an email in a language, when the desk can read it; null for the shipped one. */
function useLiveTemplate(kind: EmailKind, tag: LocaleTag): EmailDoc | null {
  const [live, setLive] = useState<Record<string, EmailDoc | null>>({});
  const id = `${templateKey(kind)}/${adminiumLocale(tag)}`;
  useEffect(() => {
    const read = deskWrites().emailTemplate;
    if (read === undefined || id in live) return;
    let on = true;
    void read(templateKey(kind), adminiumLocale(tag))
      .then((doc) => (doc === null ? null : { name: doc.name, subject: doc.subject, preheader: doc.preheader, blocks: doc.blocks, footer: doc.footer }))
      .catch(() => null)
      .then((doc) => {
        if (on) setLive((s) => ({ ...s, [id]: doc }));
      });
    return () => {
      on = false;
    };
  }, [id, kind, tag, live]);
  return live[id] ?? null;
}

export default function Emails() {
  const { t, locale } = useI18n();
  const today = useDesk((s) => s.today);
  const rows = useDesk((s) => s.rows);
  const settings = useSettings();
  const invoicesAddOn = useAddOnSettings("invoices");
  useSampleRows(today);
  const [kind, setKind] = useState<EmailKind>("sign-in-link");
  const [chosenMode, setMode] = useState<Mode>("rich");
  const [tag, setTag] = useState<LocaleTag>(locale);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<TestProblem | null>(null);
  useEffect(() => setTag(locale), [locale]);

  const studio = isStudioEmail(kind);
  const mode: Mode = studio ? "plain" : chosenMode;
  const live = useLiveTemplate(kind, tag);
  const places = useMemo(() => (typeof window === "undefined" ? { portal: "/", staff: "/" } : placesFrom(window.location.origin, window.location.pathname)), []);
  const picked = useMemo(() => pick(kind, rows, today), [kind, rows, today]);
  const values = useMemo(
    () => valuesFor(picked, { tag, today, settings, payHow: addOnText(invoicesAddOn, "payment_instructions"), places, code: SAMPLE_CODE }),
    [picked, tag, today, settings, invoicesAddOn, places],
  );
  const doc = useMemo(() => filled(live ?? shippedDoc(kind, tag), values), [live, kind, tag, values]);
  const drawn = useMemo(() => pieces(doc), [doc]);
  const to = recipientOf(kind, picked, settings, studio);
  const studioName = settings?.name ?? "";
  const from = `${studioName} <${settings?.reply_to ?? ""}>`;
  const secrets = useMemo(() => Object.values(rows.projects).map((p) => p.share_token).filter((s): s is string => s !== null && s !== ""), [rows.projects]);

  useEffect(() => setProblem(null), [kind, tag]);

  const choose = (next: EmailKind) => setKind(next);

  async function follow(target: Follow): Promise<void> {
    if (target.to === "none") {
      toast(t("emails.try.noLink"), { icon: "mail" });
      return;
    }
    if (target.to === "desk") {
      if (target.view === "enquiries" || target.id === null) go("enquiries");
      else open(target.view, target.id);
      return;
    }
    const { view, id } = target;
    if (id !== null && view !== "home") useUi.setState((s) => ({ selected: { ...s.selected, [view]: id } }));
    await previewClient(target.clientId, "emails", view);
    toast(t("emails.try.followed"), { icon: "external-link" });
  }

  async function test(): Promise<void> {
    if (sending) return;
    setSending(true);
    setProblem(null);
    try {
      const out = await sendTest({ kind, tag, doc, studio, guard: { portal: places.portal, secrets } });
      if (out.ok) toast(t("emails.test.sent", { to: out.to }), { icon: "mail-check" });
      else setProblem(out.problem);
    } finally {
      setSending(false);
    }
  }

  const followTarget = followOf(kind, picked);
  // Each email's name as Email Templates lists it, in the page's language.
  const names = useMemo(() => Object.fromEntries([...CLIENT_EMAILS, ...STUDIO_EMAILS].map((k) => [k, shippedDoc(k, locale).name])) as Record<EmailKind, string>, [locale]);
  const tab = (k: EmailKind) => {
    const Icon = ICONS[k];
    const name = names[k];
    return (
      <button key={k} type="button" className="em-tab ol-chip" aria-pressed={k === kind} onClick={() => choose(k)}>
        <Icon size={14} aria-hidden="true" />
        {name}
      </button>
    );
  };

  return (
    <section className="screen ol-screen emails" data-screen="emails" aria-labelledby="emails-title">
      <div>
        <h1 className="screen-title emails-title" id="emails-title">
          {t("screen.emails")}
        </h1>
        <p className="emails-lead">{t("emails.lead")}</p>
      </div>

      <div className="em-tabs">
        <div className="em-tab-row" role="group" aria-labelledby="em-to-clients">
          <span className="em-tab-label" id="em-to-clients">
            {t("emails.toClients")}
          </span>
          {CLIENT_EMAILS.map(tab)}
        </div>
        <div className="em-tab-row" role="group" aria-labelledby="em-to-studio">
          <span className="em-tab-label" id="em-to-studio">
            {t("emails.toStudio")}
          </span>
          {STUDIO_EMAILS.map(tab)}
        </div>
      </div>

      <div className="em-toolbar">
        <label className="em-lang">
          <span className="em-lang-label">{t("emails.language")}</span>
          <select className="ol-fld em-lang-select" value={tag} onChange={(e) => setTag(e.target.value as LocaleTag)}>
            {LOCALE_TAGS.map((l) => (
              <option key={l} value={l} lang={l}>
                {LOCALES[l].native}
              </option>
            ))}
          </select>
        </label>
        <div className="em-modes" role="group" aria-label={t("emails.modesLabel")}>
          {MODES.map((m) => {
            const Icon = m.icon;
            const off = studio && m.id !== "plain";
            return (
              <button key={m.id} type="button" className="em-mode ol-chip" aria-pressed={mode === m.id} disabled={off} title={off ? t("emails.mode.studioPlain") : undefined} onClick={() => setMode(m.id)}>
                <Icon size={13} aria-hidden="true" />
                {t(m.key)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="em-cols">
        <section className="card em-panel" aria-label={t("emails.previewLabel", { name: doc.name })}>
          <dl className="em-head">
            <div className="em-head-row">
              <dt>{t("emails.head.from")}</dt>
              <dd className="em-head-mono" dir="ltr">
                {from}
              </dd>
            </div>
            <div className="em-head-row">
              <dt>{t("emails.head.to")}</dt>
              <dd className="em-head-mono" dir="ltr">
                {to}
              </dd>
            </div>
            <div className="em-head-row">
              <dt>{t("emails.head.subject")}</dt>
              <dd className="em-head-subject" lang={tag}>
                {doc.subject}
              </dd>
            </div>
          </dl>
          <div className="em-canvas">
            <EmailCard doc={doc} pieces={drawn} mode={mode} studio={studio} tag={tag} studioName={studioName} mark={settings?.mark ?? null} onFollow={() => void follow(followTarget)} />
          </div>
        </section>

        <div className="em-side">
          <section className="card em-panel" aria-labelledby="em-rules-title">
            <div className="em-panel-head">
              <ListChecks size={15} aria-hidden="true" />
              <h2 id="em-rules-title">{t("emails.rules.title")}</h2>
            </div>
            <ul className="em-rules" role="list">
              {RULES.map((r) => {
                const Icon = r.icon;
                return (
                  <li key={r.key} className="em-rule">
                    <Icon size={15} aria-hidden="true" className="em-rule-icon" />
                    <span>{t(r.key)}</span>
                  </li>
                );
              })}
            </ul>
          </section>
          <section className="card em-try" aria-labelledby="em-try-title">
            <h2 className="em-try-title" id="em-try-title">
              {t("emails.try.title")}
            </h2>
            <p className="em-try-body">{t("emails.try.body")}</p>
            <Button icon={ExternalLink} onClick={() => void follow(followTarget)}>
              {t("emails.try.follow")}
            </Button>
            <Button icon={MailCheck} busy={sending} onClick={() => void test()}>
              {t("emails.try.test")}
            </Button>
            {problem !== null && <Alert tone={problem === "live-link" || problem === "refused" ? "danger" : "warn"}>{t(PROBLEM_KEYS[problem], { to: settings?.reply_to ?? "" })}</Alert>}
            <p className="em-try-note">{t("emails.try.testNote", { to: settings?.reply_to ?? "" })}</p>
          </section>
        </div>
      </div>
    </section>
  );
}
