/**
 * The terms a proposal names, read in full from its accept step: the
 * version, since when it is in force, and each clause. Read only — the
 * client agrees to them by ticking the box and signing.
 */
import { ScrollText } from "lucide-react";

import { Sheet } from "../../components/Sheet.tsx";
import { useI18n } from "../../i18n/index.tsx";
import { dayLabel } from "../../lib/dates.ts";
import { usePortal, usePortalRow, usePortalRows } from "../../state/portal.ts";
import type { ClientSheet } from "../../state/sheets.ts";

export default function Terms({ sheet, onClose }: { sheet: Extract<ClientSheet, { kind: "terms" }>; onClose: () => void }) {
  const { t, locale, number } = useI18n();
  const studio = usePortal((s) => s.studio?.settings?.name ?? "");
  const version = usePortalRow("terms_versions", sheet.versionId);
  const clauses = usePortalRows("terms_clauses")
    .filter((c) => c.version_id === sheet.versionId)
    .sort((a, b) => a.position - b.position || a.id - b.id);
  const since = version?.in_force_from ?? null;
  const sub = [version?.version !== null && version?.version !== undefined ? t("common.versionTag", { n: version.version }) : null, since === null ? null : t("client.sheet.inForceSince", { date: dayLabel(since, locale, "long") })]
    .filter((x) => x !== null)
    .join(" · ");
  return (
    <Sheet title={t("client.sheet.termsTitle", { studio })} sub={sub === "" ? undefined : sub} icon={ScrollText} onClose={onClose}>
      {clauses.length === 0 ? (
        <p className="cl-subtle">{t("client.sheet.noClauses")}</p>
      ) : (
        <ol className="cl-clauses">
          {clauses.map((c, i) => (
            <li key={c.id} className="cl-clause">
              <span className="cl-clause-n" aria-hidden="true">
                {number(i + 1)}
              </span>
              <span className="cl-clause-text">
                <span className="cl-clause-title">{c.title}</span>
                {c.body !== null && <span className="cl-clause-body">{c.body}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Sheet>
  );
}
