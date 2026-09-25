/**
 * Not available: the studio has switched the clients' side off while this
 * page was open (Adminium answers such a page with its own "not available"
 * page; this is the same answer, for a page already loaded).
 *
 * "Back to home" reads again — the studio may have switched it back on;
 * "Ask the studio" writes to its reply-to address.
 */
import { CircleSlash, House, Mail } from "lucide-react";

import { DeadEnd } from "../../components/DeadEnd.tsx";
import { Button } from "../../components/ui.tsx";
import { useI18n } from "../../i18n/index.tsx";
import { loadPortal, loadStudio, usePortal } from "../../state/portal.ts";
import { go } from "../../state/ui.ts";
import { portOrNull } from "./shared/page.ts";

export default function NotAvailable() {
  const { t } = useI18n();
  const replyTo = usePortal((s) => s.studio?.settings?.reply_to ?? null);
  const again = async () => {
    // Switched off before the page could start: only a fresh start can read again.
    if (portOrNull() === null) {
      window.location.reload();
      return;
    }
    usePortal.setState({ loadError: null });
    await loadStudio(true);
    if (usePortal.getState().me !== null) await loadPortal();
    if (usePortal.getState().loadError === null) go(usePortal.getState().me === null ? "find" : "home");
  };
  return (
    <section data-screen="client-notavailable" aria-labelledby="client-na">
      <DeadEnd
        card
        badge={CircleSlash}
        kicker={t("notAvailable.kicker")}
        title={t("notAvailable.title")}
        body={t("notAvailable.body")}
        titleId="client-na"
        actions={
          <>
            <Button kind="primary" icon={House} onClick={() => void again()}>
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
