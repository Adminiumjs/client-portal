/**
 * Find your documents: the client types the address the studio writes to, and
 * is sent a link to sign in. Whatever they typed, the page answers the same —
 * "if that is one of ours, a link is on its way" — so it never tells anyone
 * whether an address belongs to a client.
 *
 * The same email carries a six-digit code for opening it on another device:
 * the code boxes sign in here; "Send it again" asks once more after half a
 * minute; "Use a different email" goes back.
 */
import { useEffect, useRef, useState } from "react";
import { CircleAlert, LogIn, Mail, MailCheck, RotateCw } from "lucide-react";

import { Alert, Button } from "../../components/ui.tsx";
import { useI18n, type MessageKey } from "../../i18n/index.tsx";
import { requestSignInLink, signInWithCode } from "../../state/clientActions.ts";
import { useDemoSignal } from "../../state/demoSignal.ts";
import { usePortal } from "../../state/portal.ts";
import { go, toast } from "../../state/ui.ts";
import { CODE_LENGTH, RESEND_AFTER, codeProblem, emailProblem, emptyCode, maskEmail, placeDigits, sendProblem, type CodeProblem } from "./signin/model.ts";
import { goAfterSignIn } from "./signin/landing.ts";
import { slot } from "./shared/slot.tsx";

export default function Find() {
  const { t, locale, number } = useI18n();
  const sessionEnded = usePortal((s) => s.me === null && s.loadError === "PUBLIC_CLAIM_LEVEL");
  const [step, setStep] = useState<"email" | "check">("email");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<MessageKey | null>(null);
  const [code, setCode] = useState<string[]>(emptyCode);
  const [codeError, setCodeError] = useState<CodeProblem | null>(null);
  const [locked, setLocked] = useState(false);
  const [sentAt, setSentAt] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const boxes = useRef<(HTMLInputElement | null)[]>([]);

  const wait = Math.max(0, RESEND_AFTER - Math.floor((clock - sentAt) / 1000));
  useEffect(() => {
    if (step !== "check" || wait === 0) return;
    const tick = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [step, wait]);

  const focusBox = (i: number) => setTimeout(() => boxes.current[i]?.focus(), 0);

  const send = async (address: string = email) => {
    const problem = emailProblem(address);
    if (problem !== null) {
      setEmailError(problem === "empty" ? "client.find.emailEmpty" : "client.find.emailShape");
      return;
    }
    setBusy(true);
    const out = await requestSignInLink(address.trim(), locale);
    setBusy(false);
    const refused = sendProblem(out);
    if (refused !== null) {
      setEmailError(refused);
      return;
    }
    setEmailError(null);
    setCode(emptyCode());
    setCodeError(null);
    setLocked(false);
    setSentAt(Date.now());
    setClock(Date.now());
    setStep("check");
  };

  // The website demo's sign-in shortcuts: the address typed in (and, for "send", sent) as a person would.
  useDemoSignal("signin.fill", (fill) => {
    const address = fill["email"] ?? "";
    setStep("email");
    setEmail(address);
    setEmailError(null);
    if (fill["send"] === "yes") void send(address);
  });

  const resend = async () => {
    if (wait > 0 || busy) return;
    setBusy(true);
    const out = await requestSignInLink(email.trim(), locale);
    setBusy(false);
    const refused = sendProblem(out);
    if (refused !== null) {
      setCodeError({ key: refused });
      return;
    }
    setCode(emptyCode());
    setCodeError(null);
    setLocked(false);
    setSentAt(Date.now());
    setClock(Date.now());
    toast(t("client.find.sentAgain"), { icon: "mail" });
  };

  const check = async () => {
    if (locked || busy) return;
    const typed = code.join("");
    if (typed.length < CODE_LENGTH) {
      setCodeError({ key: "client.find.codeShort" });
      return;
    }
    setBusy(true);
    const out = await signInWithCode(email.trim(), typed);
    setBusy(false);
    const problem = codeProblem(out);
    if (problem === null) {
      goAfterSignIn();
      return;
    }
    setCodeError(problem);
    if (problem.locked === true) setLocked(true);
    if (problem.key === "client.find.codeWrong") {
      setCode(emptyCode());
      focusBox(0);
    }
  };

  const type = (at: number, typed: string) => {
    const next = placeDigits(code, at, typed);
    setCode(next.code);
    setCodeError(null);
    if (typed.replace(/\D/g, "") !== "") focusBox(next.focus);
  };

  return (
    <section className="screen ol-screen cl-find" data-screen="client-find" aria-labelledby="cl-find-title">
      {sessionEnded && <Alert tone="warn">{t("portal.session")}</Alert>}
      <div className="cl-find-head">
        <h1 className="cl-find-title" id="cl-find-title">
          {t("screen.find")}
        </h1>
        <p className="cl-find-lead">{t("client.find.lead")}</p>
      </div>
      <div className="cl-card cl-find-card">
        {step === "email" ? (
          <form
            className="cl-stack"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <label className="cl-field">
              <span className="cl-label">{t("client.find.email")}</span>
              <input
                className="input cl-input-lg ol-fld"
                type="email"
                autoComplete="email"
                value={email}
                placeholder={t("client.find.placeholder")}
                aria-invalid={emailError !== null}
                aria-describedby={emailError !== null ? "cl-find-email-err" : undefined}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setEmailError(null);
                }}
              />
              {emailError !== null && (
                <span className="cl-error" id="cl-find-email-err" role="alert">
                  <CircleAlert size={14} aria-hidden="true" />
                  {t(emailError)}
                </span>
              )}
            </label>
            <Button kind="primary" type="submit" icon={Mail} busy={busy} className="cl-btn-tall">
              {t("client.find.send")}
            </Button>
          </form>
        ) : (
          <div className="cl-stack">
            <div className="cl-check">
              <span className="cl-check-badge" aria-hidden="true">
                <MailCheck size={19} />
              </span>
              <span className="cl-check-text">
                <h2 className="cl-h2">{t("client.find.checkTitle")}</h2>
                <span className="cl-muted">
                  {slot(
                    t("client.find.checkBody"),
                    "masked",
                    <span className="cl-mono-inline" dir="ltr">
                      {maskEmail(email)}
                    </span>,
                  )}
                </span>
              </span>
            </div>
            <div className="cl-code">
              <span className="cl-subtle" id="cl-code-label">
                {t("client.find.codeLead")}
              </span>
              <div className="cl-code-boxes" role="group" aria-labelledby="cl-code-label" dir="ltr">
                {code.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => {
                      boxes.current[i] = el;
                    }}
                    className="cl-digit ol-fld"
                    inputMode="numeric"
                    autoComplete={i === 0 ? "one-time-code" : "off"}
                    maxLength={i === 0 ? CODE_LENGTH : 1}
                    aria-label={t("client.find.digit", { n: i + 1, total: CODE_LENGTH })}
                    aria-invalid={codeError !== null}
                    aria-describedby={codeError !== null ? "cl-code-err" : undefined}
                    value={digit}
                    disabled={locked}
                    onChange={(e) => type(i, e.target.value)}
                    onPaste={(e) => {
                      const pasted = e.clipboardData.getData("text");
                      if (pasted.replace(/\D/g, "") === "") return;
                      e.preventDefault();
                      type(i, pasted);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Backspace" && digit === "" && i > 0) focusBox(i - 1);
                      if (e.key === "Enter") void check();
                    }}
                  />
                ))}
              </div>
              {codeError !== null && (
                <span className="cl-error" id="cl-code-err" role="alert">
                  <CircleAlert size={14} aria-hidden="true" />
                  {codeError.count === undefined ? t(codeError.key) : t(codeError.key, { count: number(codeError.count) }, codeError.count)}
                </span>
              )}
              <div className="cl-row-wrap">
                <Button kind="primary" icon={LogIn} disabled={locked} busy={busy} onClick={() => void check()}>
                  {t("client.find.signIn")}
                </Button>
                <Button icon={RotateCw} aria-disabled={wait > 0} className={wait > 0 ? "cl-waiting" : undefined} onClick={() => void resend()}>
                  {t("client.find.again")}
                  {wait > 0 && (
                    <span className="cl-countdown" dir="ltr">
                      {`0:${String(wait).padStart(2, "0")}`}
                    </span>
                  )}
                </Button>
                <button
                  type="button"
                  className="cl-link-btn ol-gi"
                  onClick={() => {
                    setStep("email");
                    setCodeError(null);
                    setLocked(false);
                  }}
                >
                  {t("client.find.other")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      <p className="enquire-already">
        <span className="cl-subtle">{t("client.find.newHere")}</span>
        <button type="button" className="cl-link-btn ol-gi" onClick={() => go("enquire")}>
          {t("client.find.enquire")}
        </button>
      </p>
    </section>
  );
}
