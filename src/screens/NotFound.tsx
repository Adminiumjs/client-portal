/**
 * The desk's 404: an address that names no screen of the desk lands here —
 * a faint "404", the heading and one line, then the two ways on the design
 * gives it: back to Home, or to the invoices.
 *
 * The finished pattern every desk screen follows: a `section` labelled by its
 * heading, `data-screen` for tests and the demo, words from the strings, and
 * the shared pieces (`DeadEnd`, `Button`) rather than a style of its own.
 */
import { House, ReceiptText } from "lucide-react";

import { DeadEnd } from "../components/DeadEnd.tsx";
import { Button } from "../components/ui.tsx";
import { useI18n } from "../i18n/index.tsx";
import { go } from "../state/ui.ts";

export default function NotFound() {
  const { t } = useI18n();
  return (
    <section data-screen="notfound" aria-labelledby="desk-404">
      <DeadEnd
        code={t("notFound.code")}
        title={t("notFound.title")}
        body={t("notFound.body")}
        titleId="desk-404"
        actions={
          <>
            <Button kind="primary" icon={House} onClick={() => go("home")}>
              {t("notFound.home")}
            </Button>
            <Button icon={ReceiptText} onClick={() => go("invoices")}>
              {t("notFound.invoices")}
            </Button>
          </>
        }
      />
    </section>
  );
}
