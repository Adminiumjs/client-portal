/**
 * The clients' 404: an address that names no page — and, on purpose, a
 * document that is not this client's, which answers exactly like one that
 * does not exist (nothing says another client's document is there).
 *
 * "Back to home" leads home when signed in, to sign-in otherwise; "Ask the
 * studio" writes to the studio's reply-to address.
 */
import { FileX, House, Mail } from "lucide-react";

import { DeadEnd } from "../../components/DeadEnd.tsx";
import { Button } from "../../components/ui.tsx";
import { useI18n } from "../../i18n/index.tsx";
import { usePortal } from "../../state/portal.ts";
import { go } from "../../state/ui.ts";

export default function NotFound() {
  const { t } = useI18n();
  const signedIn = usePortal((s) => s.me !== null);
  const replyTo = usePortal((s) => s.studio?.settings?.reply_to ?? null);
  return (
    <section data-screen="client-notfound" aria-labelledby="client-404">
      <DeadEnd
        card
        badge={FileX}
        kicker={t("notFound.code")}
        title={t("notFound.title")}
        body={t("notFound.body")}
        titleId="client-404"
        actions={
          <>
            <Button kind="primary" icon={House} onClick={() => go(signedIn ? "home" : "find")}>
              {t("notFound.home")}
            </Button>
            {replyTo !== null && (
              <a className="btn ol-gi" href={`mailto:${replyTo}`}>
                <Mail size={16} aria-hidden="true" />
                {t("notFound.askStudio")}
              </a>
            )}
          </>
        }
      />
    </section>
  );
}
