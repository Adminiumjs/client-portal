/**
 * Tell us about your project: the studio's public enquiry form. Anyone may
 * send one, with no sign-in — the studio's own site links here.
 *
 * What a visitor types goes to one narrow door on the studio's server, behind
 * the human check the page's client solves as it sends (nothing to tick):
 * only the form's own fields are sent, and the server makes it a NEW enquiry
 * from the WEB whatever a browser says, numbers and stamps it, limits how
 * many one address and the page may send, and tells the studio when its
 * switch is on. Nothing comes back but when it arrived — so the thank-you
 * shows that, and nothing else.
 *
 * Every answer that is not a yes is said in words, and what was typed stays
 * on the page to send again.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import type { EnquiryReceipt } from "../../data/ports.ts";
import { useI18n, type MessageKey } from "../../i18n/index.tsx";
import { sendEnquiry } from "../../state/publicEnquiry.ts";
import { usePortal } from "../../state/portal.ts";
import { go } from "../../state/ui.ts";
import { tenantCurrency } from "../../i18n/ambient.ts";
import { EMPTY, budgetWords, formProblems, payloadOf, refusalWords, shortMoney, type Budget, type EnquireField, type EnquireInput, type Refused } from "./enquire/model.ts";
import { FormView, SentView } from "./enquire/view.tsx";

export default function ClientEnquire() {
  const { t, locale } = useI18n();
  const settings = usePortal((s) => s.studio?.settings ?? null);
  const [input, setInput] = useState<EnquireInput>(EMPTY);
  const [problems, setProblems] = useState<Partial<Record<EnquireField, MessageKey>>>({});
  const [sending, setSending] = useState(false);
  const [refused, setRefused] = useState<Refused | null>(null);
  const [receipt, setReceipt] = useState<EnquiryReceipt | null>(null);
  const fields = useRef<Partial<Record<EnquireField, HTMLElement | null>>>({});
  const heading = useRef<HTMLHeadingElement>(null);

  // The thank-you takes the focus, so a screen reader hears that it went.
  useEffect(() => {
    if (receipt !== null) heading.current?.focus();
  }, [receipt]);

  const amount = useMemo(() => shortMoney(locale, tenantCurrency()), [locale]);
  const band = (budget: Budget) => budgetWords(budget, t, amount);
  const studioName = settings?.name ?? "";
  const replyTo = settings?.reply_to ?? null;

  const focus = (field: EnquireField) => setTimeout(() => fields.current[field]?.focus(), 0);

  const submit = async () => {
    if (sending) return;
    const found = formProblems(input);
    if (found.length > 0) {
      setProblems(Object.fromEntries([...found].reverse().map((p) => [p.field, p.key])));
      setRefused(null);
      focus(found[0]!.field);
      return;
    }
    setProblems({});
    setRefused(null);
    setSending(true);
    const out = await sendEnquiry(payloadOf(input, band));
    setSending(false);
    if (out.ok) {
      setReceipt(out.value);
      setInput(EMPTY);
      return;
    }
    const words = refusalWords(out);
    setRefused(words);
    if (words !== null && words.field !== null) {
      setProblems({ [words.field]: words.key });
      focus(words.field);
    }
  };

  if (receipt !== null) {
    return (
      <SentView
        receivedAt={receipt.received_at}
        studioName={studioName}
        website={settings?.website ?? null}
        headingRef={heading}
        onFind={() => go("find")}
        onAnother={() => {
          setReceipt(null);
          setRefused(null);
          setProblems({});
        }}
      />
    );
  }

  return (
    <FormView
      input={input}
      problems={problems}
      sending={sending}
      refused={refused}
      studioName={studioName}
      replyTo={replyTo}
      band={band}
      onFind={() => go("find")}
      onSubmit={() => void submit()}
      bind={(field) => (element) => {
        fields.current[field] = element;
      }}
      onChange={(field, value) => {
        setInput((current) => ({ ...current, [field]: value }));
        if (problems[field] !== undefined) setProblems(({ [field]: _gone, ...rest }) => rest);
      }}
    />
  );
}
