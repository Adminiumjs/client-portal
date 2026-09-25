/**
 * The page a sign-in link opens: the studio's mark, "Hello" and the first
 * name the link is for, and one button — Continue. Opening the page signs no
 * one in (a mail scanner that follows the link spends nothing); only Continue
 * does, once. A link already used, or past its twenty minutes, goes to the
 * "link expired" page.
 */
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";

import { BrandMark } from "../../components/BrandMark.tsx";
import { Alert, Button } from "../../components/ui.tsx";
import { useI18n } from "../../i18n/index.tsx";
import { continueWithLink, peekSignInLink } from "../../state/clientActions.ts";
import { refusalKey } from "../../state/outcome.ts";
import { usePortal } from "../../state/portal.ts";
import { go, useUi } from "../../state/ui.ts";
import { goAfterSignIn } from "./signin/landing.ts";
import { linkToken } from "./shared/token.ts";

export default function Link() {
  const { t } = useI18n();
  const token = linkToken(useUi((s) => s.token), "sign-in");
  const studio = usePortal((s) => s.studio?.settings ?? null);
  const [first, setFirst] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (token === null) {
      go("find");
      return;
    }
    let live = true;
    void peekSignInLink(token).then((out) => {
      if (!live) return;
      if (out.ok && out.value === null) {
        // Used, or past its time: nothing to greet, nothing to continue.
        useUi.setState({ token });
        go("expired");
        return;
      }
      if (out.ok && out.value !== null) setFirst(out.value.firstName.trim() || null);
    });
    return () => {
      live = false;
    };
  }, [token]);

  const onContinue = async () => {
    if (token === null || busy) return;
    setBusy(true);
    const out = await continueWithLink(token);
    setBusy(false);
    if (out.ok) {
      goAfterSignIn();
      return;
    }
    if (out.reason === "link-expired") {
      useUi.setState({ token });
      go("expired");
      return;
    }
    setError(t(refusalKey(out.reason)));
  };

  return (
    <section className="screen ol-screen cl-link" data-screen="client-link" aria-labelledby="cl-link-title">
      <span className="cl-link-mark">
        <BrandMark mark={studio?.mark} name={studio?.name ?? ""} />
      </span>
      <h1 className="cl-find-title" id="cl-link-title">
        {first === null ? t("client.link.helloAnon") : t("client.link.hello", { first })}
      </h1>
      {error !== null && <Alert>{error}</Alert>}
      <Button kind="primary" icon={ArrowRight} busy={busy} className="cl-btn-tall" onClick={() => void onContinue()}>
        {t("screen.link")}
      </Button>
      <span className="cl-subtle">{t("client.link.notYou")}</span>
    </section>
  );
}
