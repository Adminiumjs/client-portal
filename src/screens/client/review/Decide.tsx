/**
 * Approve, or Request changes — on a deliverable waiting for the client's
 * review, from its card on the project page or from its review page.
 *
 * Request changes is two writes in one step list: the deliverable moves to
 * "changes" with what should change, then the same words go into the
 * conversation. When the second does not save the page says so and "Finish
 * it" completes it, without writing the first twice.
 */
import { useState } from "react";
import { Check } from "lucide-react";

import { Alert, UnfinishedLine } from "../../../components/ui.tsx";
import type { Id } from "../../../data/types.ts";
import { useI18n } from "../../../i18n/index.tsx";
import { approveDeliverable, requestChanges } from "../../../state/clientActions.ts";
import type { Outcome, Unfinished } from "../../../state/outcome.ts";
import { toast } from "../../../state/ui.ts";
import { sayRefusal } from "../shared/page.ts";

export function Decide({ deliverableId, versionId, size = "card", onSettled }: { deliverableId: Id; versionId: Id | null; size?: "card" | "page"; onSettled?: () => void }) {
  const { t } = useI18n();
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unfinished, setUnfinished] = useState<Unfinished<void> | null>(null);

  const settle = (out: Outcome<void>, done: string) => {
    if (out.ok) {
      setError(null);
      setUnfinished(null);
      setNote(null);
      toast(done, { icon: "check" });
      onSettled?.();
      return;
    }
    setUnfinished(out.unfinished);
    setError(out.unfinished === null ? sayRefusal(t, out) : null);
    onSettled?.();
  };

  const approve = async () => {
    if (busy) return;
    setBusy(true);
    const out = await approveDeliverable(deliverableId);
    setBusy(false);
    settle(out, t("client.review.approvedToast"));
  };

  const send = async () => {
    if (busy) return;
    const text = (note ?? "").trim();
    if (text === "") {
      toast(t("client.review.sayWhat"), { icon: "info" });
      return;
    }
    setBusy(true);
    const out = await requestChanges(deliverableId, versionId, text);
    setBusy(false);
    settle(out, t("client.review.changesToast"));
  };

  const finish = async () => {
    if (unfinished === null || busy) return;
    setBusy(true);
    const out = await unfinished.resume();
    setBusy(false);
    settle(out, t("client.review.changesToast"));
  };

  return (
    <div className={`cl-decide-deliv cl-decide-deliv--${size}`}>
      {unfinished !== null ? (
        <UnfinishedLine unfinished={unfinished} busy={busy} onFinish={() => void finish()} />
      ) : (
        <>
          <button type="button" className="btn cl-btn-pos ol-btn" disabled={busy} aria-busy={busy || undefined} onClick={() => void approve()}>
            <Check size={size === "page" ? 18 : 15} aria-hidden="true" />
            {t("client.review.approve")}
          </button>
          {note === null ? (
            <button type="button" className="btn ol-gi cl-btn-quiet" onClick={() => setNote("")}>
              {t("client.review.requestChanges")}
            </button>
          ) : (
            <div className="cl-stack-tight">
              <textarea
                className="input ol-fld"
                rows={3}
                aria-label={t("client.review.whatChange")}
                placeholder={t("client.review.changePlaceholder")}
                value={note}
                autoFocus
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setNote(null);
                }}
              />
              <div className="cl-row">
                <button type="button" className="btn ol-gi btn--small" onClick={() => setNote(null)}>
                  {t("common.cancel")}
                </button>
                <button type="button" className="btn cl-btn-warn ol-btn btn--small cl-grow" disabled={busy} aria-busy={busy || undefined} onClick={() => void send()}>
                  {t("client.review.sendRequest")}
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {error !== null && <Alert>{error}</Alert>}
    </div>
  );
}
