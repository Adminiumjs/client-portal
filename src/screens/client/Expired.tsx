/**
 * A sign-in link that has been used, or whose twenty minutes are up. One way
 * on: "Send me a new link" mails a fresh one to the address that link was for
 * (never to anyone else, whoever opened it), or "Use my email instead" goes
 * back to finding your documents.
 */
import { useState } from "react";
import { KeyRound, Mail, MailCheck, Unplug } from "lucide-react";

import { Alert, Button } from "../../components/ui.tsx";
import { useI18n } from "../../i18n/index.tsx";
import { resendSignInLink } from "../../state/clientActions.ts";
import { go, toast, useUi } from "../../state/ui.ts";
import { sendProblem } from "./signin/model.ts";
import { linkToken } from "./shared/token.ts";

export default function Expired() {
  const { t, locale } = useI18n();
  const token = linkToken(useUi((s) => s.token), "sign-in");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const again = async () => {
    if (token === null || busy) return;
    setBusy(true);
    const out = await resendSignInLink(token, locale);
    setBusy(false);
    const refused = sendProblem(out);
    if (refused !== null) {
      setError(t(refused));
      return;
    }
    setError(null);
    setSent(true);
    toast(t("client.expired.toast"), { icon: "mail" });
  };

  const useEmail = (
    <Button kind={token === null ? "primary" : "ghost"} icon={KeyRound} onClick={() => go("find")}>
      {t("client.expired.useEmail")}
    </Button>
  );

  return (
    <section className="screen ol-screen" data-screen="client-expired" aria-labelledby="cl-expired-title">
      <div className="dead-end dead-end--card cl-expired">
        <span className="dead-end-badge cl-badge-warn" aria-hidden="true">
          <Unplug size={26} />
        </span>
        <span className="dead-end-kicker">{t("screen.expired")}</span>
        <h1 className="dead-end-title" id="cl-expired-title">
          {t("client.expired.title")}
        </h1>
        <p className="dead-end-body">{t("client.expired.body")}</p>
        {sent && (
          <div className="cl-sent" role="status">
            <MailCheck size={17} aria-hidden="true" />
            <span>{t("client.expired.sent")}</span>
          </div>
        )}
        {error !== null && <Alert>{error}</Alert>}
        <div className="dead-end-actions">
          {token !== null && (
            <Button kind="primary" icon={Mail} busy={busy} onClick={() => void again()}>
              {t("client.expired.again")}
            </Button>
          )}
          {useEmail}
        </div>
        <span className="cl-foot">{t("client.expired.foot")}</span>
      </div>
    </section>
  );
}
