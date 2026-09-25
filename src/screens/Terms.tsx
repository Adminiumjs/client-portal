/**
 * Terms & signature — accepted is not the same as signed.
 *
 *   Agreements      every proposal out for decision or accepted: signed (a
 *                   name typed), accepted with no signature, or still out
 *   Versions        each terms version: in force, retired (from the day the
 *                   next one took over), or a draft; how many agreements name
 *                   it; a new version (a studio manager's) copies the full
 *                   clause list of the one in force
 *   The agreement   who agreed, their email, when, how, the version in force
 *                   that day and the fingerprint Adminium stored — or, for one
 *                   accepted with no signature, "Ask them to sign"; the trail
 *                   from stamps; what its version changed; its clauses
 *   A version       its clauses; a draft (or a version no sent proposal names
 *                   yet) is edited clause by clause, each change marked, and
 *                   a draft is put in force, retiring the one before
 *
 * Adminium locks a version once a proposal naming it is sent; the screen
 * shows the lock and offers nothing it would refuse.
 */
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowUpRight, Copy, FilePlus, FileSignature, Footprints, GitCompare, History, Lock, PenLine, Printer, ScrollText, Send, Trash2, TriangleAlert } from "lucide-react";

import { Alert, Avatar, Button, DayText, Field, IconButton, Pill, ScreenHead, UnfinishedLine, type PillTone } from "../components/ui.tsx";
import type { Day, Id, Proposal, TermsClause, TermsClauseChange, TermsVersion } from "../data/types.ts";
import { dayLabel, instantLabel } from "../lib/dates.ts";
import { instant, venueDay } from "../data/venueTime.ts";
import { studioZone, today } from "../lib/clock.ts";
import { useI18n, type MessageKey } from "../i18n/index.tsx";
import { addClause, askToSign, editClause, newTermsVersion, putTermsInForce, removeClause, type Outcome } from "../state/actions.ts";
import { ensureRows, loadPage, loadTermsVersion, loadWhere, useDesk, useManager, useRows } from "../state/desk.ts";
import { refusalKey, type Unfinished } from "../state/outcome.ts";
import { open, toast } from "../state/ui.ts";
import {
  AGREEMENT_STATUSES,
  agreementState,
  askedState,
  changeAfterEdit,
  clausesOf,
  copyClauses,
  copySource,
  defaultAgreement,
  diffRows,
  editable,
  inForce,
  previousVersion,
  retiredOn,
  sentMessage,
  shortFingerprint,
  trailOf,
  versionNumber,
  versionsInOrder,
  type AgreementState,
  type TrailRow,
} from "./terms/model.ts";

type Refused = Extract<Outcome<unknown>, { ok: false }>;

const PAGE = 50;
const STATE_TONE: Record<AgreementState, PillTone> = { out: "info", signed: "pos", unsigned: "warn" };
const CHANGE_TONE: Record<TermsClauseChange, PillTone> = { added: "pos", changed: "warn", same: "neutral" };

/** A refusal in this screen's words where it has its own, else the shared ones. */
function useRefusalText() {
  const { t } = useI18n();
  return (out: Refused) => (out.reason === "locked" ? t("terms.locked") : t(refusalKey(out.reason), { id: "", balance: "" }));
}

// ── the agreements ──────────────────────────────────────────────────────────

function useAgreements() {
  const [ids, setIds] = useState<Id[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [signed, setSigned] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const where = { column: "status", op: "in" as const, value: [...AGREEMENT_STATUSES] };
  const more = async (offset: number) => {
    try {
      const page = await loadPage("proposals", { where, order: "id.desc", limit: PAGE, offset, count: offset === 0 });
      setIds((held) => [...(offset === 0 ? [] : (held ?? [])), ...page.ids]);
      if (offset === 0) setTotal(page.total);
    } catch {
      setFailed(true);
    }
  };
  useEffect(() => {
    void more(0);
    void loadPage("proposals", { where: { and: [{ column: "status", op: "eq", value: "accepted" }, { column: "signed_name", op: "not_null" }] }, limit: 1, offset: 0, count: true })
      .then((p) => setSigned(p.total))
      .catch(() => setSigned(null));
    // Read once, when the screen opens.
  }, []);
  return { ids, total, signed, failed, more };
}

/** How many sent proposals name each version (Adminium's lock follows the same pointer). */
function useVersionCounts(versions: readonly TermsVersion[]): Record<Id, number | null> {
  const [counts, setCounts] = useState<Record<Id, number | null>>({});
  const key = versions.map((v) => v.id).join(",");
  useEffect(() => {
    let live = true;
    for (const v of versions) {
      void loadPage("proposals", {
        where: { and: [{ column: "terms_version_id", op: "eq", value: v.id }, { column: "status", op: "in", value: ["sent", "accepted", "declined", "withdrawn"] }] },
        limit: 1,
        offset: 0,
        count: true,
      })
        .then((p) => live && setCounts((c) => ({ ...c, [v.id]: p.total })))
        .catch(() => live && setCounts((c) => ({ ...c, [v.id]: null })));
    }
    return () => {
      live = false;
    };
  }, [key]);
  return counts;
}

function AgreementList({ list, selected, onSelect, total, signed, failed, onMore, versions }: { list: Proposal[] | null; selected: Id | null; onSelect: (id: Id) => void; total: number | null; signed: number | null; failed: boolean; onMore: () => void; versions: readonly TermsVersion[] }) {
  const { t, locale } = useI18n();
  const clients = useDesk((s) => s.rows.clients);
  const byId = useMemo(() => new Map(versions.map((v) => [v.id, v])), [versions]);
  return (
    <section className="tm-card" aria-labelledby="tm-agreements">
      <div className="tm-card-head">
        <FileSignature size={15} aria-hidden="true" />
        <h2 id="tm-agreements">{t("terms.agreements")}</h2>
        {total !== null && signed !== null && <span className="tm-count">{t("terms.signedCount", { signed: String(signed), total: String(total) })}</span>}
      </div>
      {failed && (
        <div className="tm-pad">
          <Alert>{t("save.offline")}</Alert>
        </div>
      )}
      {list === null && !failed && <p className="tm-empty">{t("common.loading")}</p>}
      {list !== null && list.length === 0 && <p className="tm-empty">{t("terms.agreementsEmpty")}</p>}
      {list !== null && list.length > 0 && (
        <ul className="tm-list" role="list">
          {list.map((p) => {
            const state = agreementState(p);
            const v = p.terms_version_id === null ? undefined : byId.get(p.terms_version_id);
            return (
              <li key={p.id}>
                <button type="button" className="tm-agreement ol-row" aria-current={p.id === selected ? "true" : undefined} onClick={() => onSelect(p.id)}>
                  <span className="tm-agreement-main">
                    <span className="tm-agreement-top">
                      <span className="tm-mono tm-agreement-id">{p.number ?? "—"}</span>
                      <Pill tone={STATE_TONE[state]}>{t(`terms.state.${state}` as MessageKey)}</Pill>
                    </span>
                    <span className="tm-agreement-client">{clients[p.client_id]?.company ?? ""}</span>
                    <span className="tm-agreement-sub">{p.status === "accepted" ? t("terms.acceptedOn", { date: dayLabel(p.decided_at === null ? null : venueDay(instant(p.decided_at), studioZone()), locale, "long") }) : t("terms.sentNoAnswer", { title: p.title })}</span>
                  </span>
                  <span className="tm-mono tm-agreement-ver">{v === undefined ? t("terms.noVersion") : t("terms.versionTag", { n: String(versionNumber(v, versions)) })}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {list !== null && total !== null && list.length < total && (
        <div className="tm-pad">
          <Button size="small" onClick={onMore}>
            {t("common.more")}
          </Button>
        </div>
      )}
    </section>
  );
}

// ── the versions ────────────────────────────────────────────────────────────

function NewVersionForm({ versions, onDone, onCancel }: { versions: readonly TermsVersion[]; onDone: (v: TermsVersion) => void; onCancel: () => void }) {
  const { t } = useI18n();
  const refusal = useRefusalText();
  const [from, setFrom] = useState<Day>(today());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unfinished, setUnfinished] = useState<Unfinished<TermsVersion> | null>(null);
  const source = copySource(versions);
  const finish = (out: Outcome<TermsVersion>) => {
    setBusy(false);
    if (!out.ok) {
      setUnfinished(out.unfinished);
      setError(refusal(out));
      return;
    }
    const v = out.value;
    toast(source === null ? t("terms.new.startedEmpty", { n: String(v.version ?? "") }) : t("terms.new.started", { n: String(v.version ?? ""), from: String(versionNumber(source, versions)) }));
    onDone(v);
  };
  const onStart = async () => {
    setBusy(true);
    setError(null);
    try {
      if (source !== null) await loadTermsVersion(source.id);
    } catch {
      setBusy(false);
      setError(t("save.offline"));
      return;
    }
    const clauses = source === null ? [] : copyClauses(clausesOf(Object.values(useDesk.getState().rows.terms_clauses), source.id));
    finish(await newTermsVersion({ in_force_from: from === "" ? null : from, note: note.trim() === "" ? null : note, clauses }));
  };
  return (
    <div className="tm-form" role="group" aria-labelledby="tm-new-title">
      <span className="tm-form-title" id="tm-new-title">
        {t("terms.newVersion")}
      </span>
      <Field label={t("terms.new.from")}>
        {({ id }) => <input id={id} type="date" className="input tm-mono" value={from} onChange={(e) => setFrom(e.target.value)} />}
      </Field>
      <Field label={t("terms.new.note")} hint={t("terms.new.noteHint")}>
        {({ id, describedBy }) => <textarea id={id} className="input" rows={2} value={note} aria-describedby={describedBy} onChange={(e) => setNote(e.target.value)} />}
      </Field>
      {error !== null && unfinished === null && <Alert>{error}</Alert>}
      {unfinished !== null && (
        <UnfinishedLine
          unfinished={unfinished}
          busy={busy}
          onFinish={() => {
            setBusy(true);
            void unfinished.resume().then(finish);
          }}
        />
      )}
      <div className="tm-form-actions">
        <Button size="small" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button size="small" kind="primary" icon={FilePlus} busy={busy} disabled={unfinished !== null} onClick={() => void onStart()}>
          {t("terms.new.start")}
        </Button>
      </div>
    </div>
  );
}

export function VersionList({ versions, counts, manager, openId, onOpen }: { versions: readonly TermsVersion[]; counts: Record<Id, number | null>; manager: boolean; openId: Id | null; onOpen: (id: Id) => void }) {
  const { t, locale } = useI18n();
  const [adding, setAdding] = useState(false);
  const newestFirst = [...versionsInOrder(versions)].reverse();
  const monthYear = (day: Day) => new Intl.DateTimeFormat(locale, { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
  return (
    <section className="tm-card" aria-labelledby="tm-versions">
      <div className="tm-card-head">
        <History size={15} aria-hidden="true" />
        <h2 id="tm-versions">{t("terms.versions")}</h2>
        {manager && !adding && (
          <Button size="small" icon={FilePlus} className="tm-head-btn" onClick={() => setAdding(true)}>
            {t("terms.newVersion")}
          </Button>
        )}
      </div>
      {adding && (
        <NewVersionForm
          versions={versions}
          onCancel={() => setAdding(false)}
          onDone={(v) => {
            setAdding(false);
            onOpen(v.id);
          }}
        />
      )}
      {versions.length === 0 && <p className="tm-empty">{t("terms.versionsEmpty")}</p>}
      <ul className="tm-list" role="list">
        {newestFirst.map((v) => {
          const retired = retiredOn(v, versions);
          const count = counts[v.id];
          const tag = v.status === "in_force" ? t("status.inForce") : v.status === "draft" ? t("status.draft") : retired === null ? t("status.retired") : t("terms.retiredOn", { month: monthYear(retired) });
          const canEdit = manager && editable(v, count ?? null);
          return (
            <li key={v.id} className="tm-version" aria-current={v.id === openId ? "true" : undefined}>
              <span className="tm-version-top">
                <span className="tm-mono tm-version-name">{t("terms.versionTag", { n: String(versionNumber(v, versions)) })}</span>
                <Pill tone={v.status === "in_force" ? "pos" : "neutral"}>{tag}</Pill>
                {count !== undefined && count !== null && count > 0 && (
                  <span className="tm-version-used">
                    <Lock size={11} aria-hidden="true" />
                    {t("terms.used", undefined, count)}
                  </span>
                )}
              </span>
              {v.note !== null && v.note !== "" && <span className="tm-version-note">{v.note}</span>}
              <span className="tm-version-actions">
                <button type="button" className="tm-link ol-gi" onClick={() => onOpen(v.id)}>
                  {canEdit ? <PenLine size={13} aria-hidden="true" /> : <ScrollText size={13} aria-hidden="true" />}
                  {canEdit ? t("terms.editWording", { n: String(versionNumber(v, versions)) }) : t("terms.readVersion", { n: String(versionNumber(v, versions)) })}
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      <p className="tm-note">{t("terms.versionsFoot")}</p>
    </section>
  );
}

// ── one agreement ───────────────────────────────────────────────────────────

function TrailCard({ proposal, versions, rows, signedState }: { proposal: Proposal; versions: readonly TermsVersion[]; rows: TrailRow[]; signedState: AgreementState }) {
  const { t, locale } = useI18n();
  const messages = useRows("messages");
  const clients = useDesk((s) => s.rows.clients);
  const projects = useRows("projects");
  const project = projects.find((p) => p.proposal_id === proposal.id) ?? null;
  const client = clients[proposal.client_id];
  const version = versions.find((v) => v.id === proposal.terms_version_id);
  const n = version === undefined ? null : String(versionNumber(version, versions));
  const time = (at: string | null) => (at === null ? "" : instantLabel(at, studioZone(), locale, { hour: "numeric", minute: "2-digit" }));
  const sentTo = sentMessage(messages, proposal.id)?.to ?? null;
  const how = proposal.accepted_how === "email" || proposal.accepted_how === "call" || proposal.accepted_how === "meeting" ? proposal.accepted_how : "other";
  const text = (r: TrailRow): { title: string; sub: string } => {
    switch (r.kind) {
      case "sent":
        return { title: t("terms.trail.sent"), sub: n === null ? "" : sentTo === null ? t("terms.trail.sentTerms", { n }) : t("terms.trail.sentTo", { email: sentTo, n }) };
      case "acceptedSigned":
        return { title: t("terms.trail.acceptedSigned"), sub: t("terms.trail.signedSub", { name: proposal.signed_name ?? "", time: time(r.at) }) };
      case "acceptedBy":
        return { title: t(`terms.trail.acceptedBy.${how}` as MessageKey), sub: t("terms.trail.noSignature") };
      case "signed":
        return { title: t("terms.trail.signed"), sub: t("terms.trail.signedSub", { name: proposal.signed_name ?? "", time: time(r.at) }) };
      case "asked":
        return { title: t("terms.trail.asked"), sub: t("terms.trail.askedSub", { name: client?.contact_name ?? "" }) };
      case "started":
        return { title: t("terms.trail.started"), sub: project?.number ?? "" };
      case "closed":
        return { title: t("terms.trail.closed"), sub: n === null ? "" : project?.handover_sent === true ? t("terms.trail.closedHandover", { n }) : t("terms.trail.closedKept", { n }) };
    }
  };
  const ICON = { sent: Send, acceptedSigned: PenLine, acceptedBy: TriangleAlert, signed: PenLine, asked: Send, started: FilePlus, closed: FileSignature } as const;
  return (
    <section className="tm-card" aria-labelledby="tm-trail">
      <div className="tm-card-head">
        <Footprints size={15} aria-hidden="true" />
        <h2 id="tm-trail">{t("terms.trail")}</h2>
      </div>
      <ol className="tm-list" role="list">
        {rows.map((r) => {
          const { title, sub } = text(r);
          const Icon = ICON[r.kind];
          return (
            <li key={r.key} className="tm-trail-row">
              <span className={`tm-dot tm-dot--${r.tone}`} aria-hidden="true">
                <Icon size={12} />
              </span>
              <span className="tm-mono tm-trail-on">{r.on === null ? t("status.queued") : dayLabel(r.on, locale)}</span>
              <span className="tm-trail-text">
                <span className="tm-trail-title">{title}</span>
                {sub !== "" && <span className="tm-trail-sub">{sub}</span>}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="tm-note">{signedState === "signed" ? t("terms.trail.footSigned") : t("terms.trail.footUnsigned")}</p>
    </section>
  );
}

function DiffCard({ version, versions, clauses, held }: { version: TermsVersion; versions: readonly TermsVersion[]; clauses: readonly TermsClause[]; held: boolean }) {
  const { t } = useI18n();
  const prev = previousVersion(version, versions);
  const n = String(versionNumber(version, versions));
  const rows = diffRows(version, clauses, versions);
  return (
    <section className="tm-card" aria-labelledby="tm-diff">
      <div className="tm-card-head">
        <GitCompare size={15} aria-hidden="true" />
        <h2 id="tm-diff">{prev === null ? t("terms.diff.first", { n }) : t("terms.diff.title", { n, prev: String(versionNumber(prev, versions)) })}</h2>
      </div>
      {rows.length === 0 && <p className="tm-empty">{t("terms.diff.none")}</p>}
      <ul className="tm-list" role="list">
        {rows.map((d) => (
          <li key={d.key} className="tm-diff-row">
            <span className={`tm-mark tm-mark--${d.mark === "+" ? "added" : d.mark === "~" ? "changed" : "same"}`} aria-hidden="true">
              {d.mark}
            </span>
            <span className="tm-diff-text">
              {d.title !== "" && (
                <span className="tm-diff-title">
                  <span className="ol-sr-only">{t(d.mark === "+" ? "terms.change.added" : d.mark === "~" ? "terms.change.changed" : "terms.change.same")}: </span>
                  {d.title}
                </span>
              )}
              <span className="tm-diff-body">{d.body}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="tm-note">{held ? t("terms.diff.footHeld", { n }) : t("terms.diff.footCurrent")}</p>
    </section>
  );
}

function ClausesCard({ version, versions, clauses, title }: { version: TermsVersion; versions: readonly TermsVersion[]; clauses: readonly TermsClause[]; title: string }) {
  const { t } = useI18n();
  const list = clausesOf(clauses, version.id);
  const n = String(versionNumber(version, versions));
  const isFirst = previousVersion(version, versions) === null;
  return (
    <section className="tm-card tm-print" aria-labelledby="tm-clauses">
      <div className="tm-card-head">
        <ScrollText size={15} aria-hidden="true" />
        <h2 id="tm-clauses">{title}</h2>
        <Button size="small" icon={Printer} className="tm-head-btn ol-noprint" onClick={() => window.print()}>
          {t("terms.print")}
        </Button>
      </div>
      {list.length === 0 && <p className="tm-empty">{t("terms.clausesEmpty")}</p>}
      <ol className="tm-list" role="list">
        {list.map((c, i) => (
          <li key={c.id} className="tm-clause">
            <span className="tm-mono tm-clause-n">{i + 1}</span>
            <span className="tm-clause-text">
              <span className="tm-clause-top">
                <span className="tm-clause-title">{c.title}</span>
                {!isFirst && c.change === "added" && <Pill tone="accent">{t("terms.clause.newIn", { n })}</Pill>}
                {!isFirst && c.change === "changed" && <Pill tone="info">{t("terms.clause.changedIn", { n })}</Pill>}
              </span>
              {c.body !== null && <span className="tm-clause-body">{c.body}</span>}
            </span>
          </li>
        ))}
      </ol>
      {list.length > 0 && <p className="tm-note">{t("terms.clausesFoot", undefined, list.length)}</p>}
    </section>
  );
}

export function AgreementPanel({ proposal, versions }: { proposal: Proposal; versions: readonly TermsVersion[] }) {
  const { t, locale } = useI18n();
  const refusal = useRefusalText();
  const clients = useDesk((s) => s.rows.clients);
  const messages = useRows("messages");
  const projects = useRows("projects");
  const clauses = useRows("terms_clauses");
  const [busy, setBusy] = useState(false);
  const client = clients[proposal.client_id];
  const first = (client?.contact_name ?? "").trim().split(/\s+/)[0] ?? "";
  const version = versions.find((v) => v.id === proposal.terms_version_id) ?? null;
  const state = agreementState(proposal);

  useEffect(() => {
    void Promise.all([
      ensureRows("clients", [proposal.client_id]),
      loadWhere("messages", { column: "proposal_id", op: "eq", value: proposal.id }, undefined, 50),
      loadWhere("projects", { column: "proposal_id", op: "eq", value: proposal.id }, undefined, 1),
      proposal.terms_version_id === null ? Promise.resolve() : loadTermsVersion(proposal.terms_version_id),
    ]).catch(() => undefined);
  }, [proposal.id, proposal.client_id, proposal.terms_version_id]);

  const project = projects.find((p) => p.proposal_id === proposal.id) ?? null;
  const rows = trailOf(proposal, { messages, project, zone: studioZone() });
  const asked = askedState(messages, proposal.id, today(), studioZone());
  const fp = shortFingerprint(proposal.fingerprint);
  const n = version === null ? null : String(versionNumber(version, versions));
  const how = proposal.accepted_how === "email" || proposal.accepted_how === "call" || proposal.accepted_how === "meeting" ? proposal.accepted_how : "other";
  const decided = proposal.decided_at === null ? "" : dayLabel(venueDay(instant(proposal.decided_at), studioZone()), locale, "long");

  const onAsk = async () => {
    setBusy(true);
    const out = await askToSign(proposal.id);
    setBusy(false);
    if (out.ok) toast(t("terms.askSent", { first }), { icon: "send" });
    else toast(refusal(out), { tone: "danger" });
  };
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(proposal.fingerprint ?? "");
      toast(t("terms.rec.fpCopied"));
    } catch {
      toast(t("terms.rec.fpBlocked"), { tone: "warn" });
    }
  };

  const pill = state === "signed" ? { tone: "pos" as const, key: "terms.pill.signed" as const } : state === "out" ? { tone: "info" as const, key: "terms.pill.nothing" as const } : { tone: "warn" as const, key: "terms.pill.unsigned" as const };
  const record: { k: MessageKey; v: string; mono?: boolean; muted?: boolean }[] =
    state === "signed"
      ? [
          { k: "terms.rec.who", v: proposal.signed_name ?? "" },
          { k: "terms.rec.email", v: proposal.signed_email ?? "", mono: true },
          { k: "terms.rec.when", v: instantLabel(proposal.signed_at, studioZone(), locale, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) },
          { k: "terms.rec.how", v: t("terms.rec.howPortal"), muted: true },
          ...(version === null ? [] : [{ k: "terms.rec.inForce" as MessageKey, v: version.in_force_from === null ? t("terms.versionTag", { n: n ?? "" }) : t("terms.rec.inForceValue", { n: n ?? "", date: dayLabel(version.in_force_from, locale, "long") }) }]),
          ...(fp === null ? [] : [{ k: "terms.rec.fingerprint" as MessageKey, v: fp, mono: true }]),
        ]
      : [];

  return (
    <>
      <section className="tm-card tm-card--strong" aria-labelledby="tm-selected">
        <div className="tm-sel-head">
          <Avatar name={client?.company ?? ""} tint={client?.tint ?? null} size={38} />
          <span className="tm-sel-titles">
            <h2 id="tm-selected" className="tm-sel-title">
              {client?.company ?? ""}
            </h2>
            <span className="tm-sel-sub">{t("terms.docLine", { number: proposal.number ?? "—", title: proposal.title })}</span>
          </span>
          <span className="tm-sel-pill">
            <Pill tone={pill.tone}>{t(pill.key)}</Pill>
          </span>
        </div>
        {state === "signed" && (
          <>
            <dl className="tm-record">
              {record.map((r) => (
                <div key={r.k} className="tm-record-row">
                  <dt>{t(r.k)}</dt>
                  <dd className={r.mono === true ? "tm-mono tm-record-mono" : r.muted === true ? "tm-record-muted" : undefined}>{r.v}</dd>
                </div>
              ))}
            </dl>
            {fp !== null && (
              <div className="tm-record-copy">
                <button type="button" className="tm-link ol-gi" onClick={() => void onCopy()}>
                  <Copy size={14} aria-hidden="true" />
                  {t("terms.rec.copyFp")}
                </button>
              </div>
            )}
          </>
        )}
        {state === "unsigned" && (
          <div className="tm-gap">
            <div className="tm-gap-line">
              <TriangleAlert size={16} aria-hidden="true" />
              <span>{t(`terms.gap.${how}` as MessageKey, { date: decided })}</span>
            </div>
            <Button kind="primary" icon={Send} busy={busy} disabled={asked === "today"} onClick={() => void onAsk()}>
              {asked === "today" ? t("terms.asked", { first }) : asked === "before" ? t("terms.askAgain") : t("terms.ask")}
            </Button>
          </div>
        )}
        {state === "out" && (
          <div className="tm-gap">
            <span className="tm-out">{t("terms.out", { number: proposal.number ?? "—", contact: client?.contact_name ?? "" })}</span>
            <Button icon={ArrowUpRight} onClick={() => open("proposal", proposal.id)}>
              {t("terms.openDoc", { number: proposal.number ?? "—" })}
            </Button>
          </div>
        )}
      </section>
      <TrailCard proposal={proposal} versions={versions} rows={rows} signedState={state} />
      {version === null ? (
        <p className="tm-card tm-empty">{t("terms.noTerms")}</p>
      ) : (
        <>
          <DiffCard version={version} versions={versions} clauses={clauses} held={version.status !== "in_force"} />
          <ClausesCard version={version} versions={versions} clauses={clauses} title={t("terms.clauses.title", { n: n ?? "" })} />
        </>
      )}
    </>
  );
}

// ── one version (read, or edit clause by clause) ────────────────────────────

function ClauseForm({ initial, onSave, onCancel, busy, error, saveLabel }: { initial: { title: string; body: string; note: string }; onSave: (v: { title: string; body: string; note: string }) => void; onCancel: () => void; busy: boolean; error: string | null; saveLabel: string }) {
  const { t } = useI18n();
  const [v, setV] = useState(initial);
  const [missing, setMissing] = useState(false);
  return (
    <div className="tm-form tm-form--inline">
      <Field label={t("terms.clause.title")} error={missing ? t("terms.clause.titleMissing") : undefined}>
        {({ id, describedBy, invalid }) => (
          <input
            id={id}
            className="input"
            value={v.title}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            onChange={(e) => {
              setV({ ...v, title: e.target.value });
              setMissing(false);
            }}
          />
        )}
      </Field>
      <Field label={t("terms.clause.body")}>{({ id }) => <textarea id={id} className="input" rows={3} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} />}</Field>
      <Field label={t("terms.clause.note")} hint={t("terms.clause.noteHint")}>
        {({ id, describedBy }) => <input id={id} className="input" value={v.note} aria-describedby={describedBy} onChange={(e) => setV({ ...v, note: e.target.value })} />}
      </Field>
      {error !== null && <Alert>{error}</Alert>}
      <div className="tm-form-actions">
        <Button size="small" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button
          size="small"
          kind="primary"
          busy={busy}
          onClick={() => {
            if (v.title.trim() === "") return setMissing(true);
            onSave(v);
          }}
        >
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}

export function VersionPanel({ version, versions, count, manager, onBack }: { version: TermsVersion; versions: readonly TermsVersion[]; count: number | null | undefined; manager: boolean; onBack: () => void }) {
  const { t } = useI18n();
  const refusal = useRefusalText();
  const clauses = useRows("terms_clauses");
  const [editing, setEditing] = useState<Id | "new" | null>(null);
  const [removing, setRemoving] = useState<Id | null>(null);
  const [confirmPut, setConfirmPut] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void loadTermsVersion(version.id).catch(() => undefined);
  }, [version.id]);

  const list = clausesOf(clauses, version.id);
  const n = String(versionNumber(version, versions));
  const canEdit = manager && editable(version, count ?? null);
  const locked = count !== undefined && count !== null && count > 0;
  const current = inForce(versions);

  const run = async <T,>(save: () => Promise<Outcome<T>>, done: string): Promise<boolean> => {
    setBusy(true);
    setError(null);
    const out = await save();
    setBusy(false);
    if (!out.ok) {
      setError(refusal(out));
      return false;
    }
    toast(done);
    return true;
  };

  const onEditSave = async (c: TermsClause, v: { title: string; body: string; note: string }) => {
    const change = changeAfterEdit(c, { title: v.title, body: v.body });
    if (await run(() => editClause(c.id, { title: v.title.trim(), body: v.body.trim() === "" ? null : v.body.trim(), change, change_note: v.note.trim() === "" ? null : v.note.trim() }), t("terms.clause.saved"))) setEditing(null);
  };
  const onAdd = async (v: { title: string; body: string; note: string }) => {
    const position = list.reduce((m, c) => Math.max(m, c.position), -1) + 1;
    if (await run(() => addClause(version.id, { title: v.title, body: v.body, change: "added", change_note: v.note.trim() === "" ? null : v.note, position }), t("terms.clause.added"))) setEditing(null);
  };
  const onRemove = async (c: TermsClause) => {
    if (await run(() => removeClause(c.id), t("terms.clause.removed"))) setRemoving(null);
  };
  const onPut = async () => {
    if (await run(() => putTermsInForce(version.id), t("terms.put.done", { n }))) setConfirmPut(false);
  };

  return (
    <section className="tm-card tm-card--strong" aria-labelledby="tm-version">
      <div className="tm-card-head">
        <button type="button" className="tm-link ol-gi" onClick={onBack}>
          <ArrowLeft size={14} aria-hidden="true" className="tm-back-icon" />
          {t("terms.panel.back")}
        </button>
      </div>
      <div className="tm-sel-head">
        <span className="tm-sel-titles">
          <h2 id="tm-version" className="tm-sel-title">
            {t("terms.versionTag", { n })}
          </h2>
          {version.in_force_from !== null && (
            <span className="tm-sel-sub">
              {t("terms.panel.from")} <DayText day={version.in_force_from} style="long" />
            </span>
          )}
        </span>
        <span className="tm-sel-pill">
          <Pill tone={version.status === "in_force" ? "pos" : "neutral"}>{t(version.status === "in_force" ? "status.inForce" : version.status === "draft" ? "status.draft" : "status.retired")}</Pill>
        </span>
      </div>
      {locked && (
        <div className="tm-pad">
          <p className="tm-locked">
            <Lock size={14} aria-hidden="true" />
            {t("terms.panel.locked")}
          </p>
        </div>
      )}
      {error !== null && (
        <div className="tm-pad">
          <Alert>{error}</Alert>
        </div>
      )}
      {list.length === 0 && editing !== "new" && <p className="tm-empty">{t("terms.clausesEmpty")}</p>}
      <ol className="tm-list" role="list">
        {list.map((c, i) => (
          <li key={c.id} className="tm-clause">
            <span className="tm-mono tm-clause-n">{i + 1}</span>
            {editing === c.id ? (
              <ClauseForm initial={{ title: c.title, body: c.body ?? "", note: c.change_note ?? "" }} busy={busy} error={null} saveLabel={t("terms.clause.save")} onCancel={() => setEditing(null)} onSave={(v) => void onEditSave(c, v)} />
            ) : (
              <span className="tm-clause-text">
                <span className="tm-clause-top">
                  <span className="tm-clause-title">{c.title}</span>
                  <Pill tone={CHANGE_TONE[c.change]}>{t(`terms.change.${c.change}` as MessageKey)}</Pill>
                  {canEdit && (
                    <span className="tm-clause-tools">
                      <IconButton icon={PenLine} label={t("terms.clause.editLabel", { n: String(i + 1) })} onClick={() => setEditing(c.id)} />
                      <IconButton icon={Trash2} label={t("terms.clause.removeLabel", { n: String(i + 1) })} onClick={() => setRemoving(c.id)} />
                    </span>
                  )}
                </span>
                {c.body !== null && <span className="tm-clause-body">{c.body}</span>}
                {c.change !== "same" && c.change_note !== null && <span className="tm-clause-note">{c.change_note}</span>}
                {removing === c.id && (
                  <span className="tm-confirm" role="group" aria-label={t("terms.clause.removeAsk", { title: c.title })}>
                    <span className="tm-confirm-text">{t("terms.clause.removeAsk", { title: c.title })}</span>
                    <Button size="small" onClick={() => setRemoving(null)}>
                      {t("common.cancel")}
                    </Button>
                    <Button size="small" kind="danger" busy={busy} onClick={() => void onRemove(c)}>
                      {t("terms.clause.remove")}
                    </Button>
                  </span>
                )}
              </span>
            )}
          </li>
        ))}
      </ol>
      {canEdit && editing === "new" && (
        <div className="tm-pad">
          <ClauseForm initial={{ title: "", body: "", note: "" }} busy={busy} error={null} saveLabel={t("terms.clause.add")} onCancel={() => setEditing(null)} onSave={(v) => void onAdd(v)} />
        </div>
      )}
      {canEdit && (
        <div className="tm-panel-foot">
          {editing !== "new" && (
            <Button size="small" icon={FilePlus} onClick={() => setEditing("new")}>
              {t("terms.clause.add")}
            </Button>
          )}
          {version.status === "draft" &&
            (confirmPut ? (
              <span className="tm-confirm">
                <span className="tm-confirm-text tm-confirm-text--plain">{current === null ? t("terms.put.askFirst") : t("terms.put.ask", { current: String(versionNumber(current, versions)) })}</span>
                <Button size="small" onClick={() => setConfirmPut(false)}>
                  {t("common.cancel")}
                </Button>
                <Button size="small" kind="primary" busy={busy} onClick={() => void onPut()}>
                  {t("terms.put.yes", { n })}
                </Button>
              </span>
            ) : (
              <Button size="small" kind="primary" className="tm-put" onClick={() => setConfirmPut(true)}>
                {t("terms.put.button")}
              </Button>
            ))}
        </div>
      )}
      {list.length > 0 && <p className="tm-note">{t("terms.clausesFoot", undefined, list.length)}</p>}
    </section>
  );
}

// ── the screen ──────────────────────────────────────────────────────────────

export default function Terms() {
  const { t } = useI18n();
  const manager = useManager();
  const versionRows = useRows("terms_versions");
  const versions = useMemo(() => versionsInOrder(versionRows), [versionRows]);
  const proposals = useDesk((s) => s.rows.proposals);
  const agreements = useAgreements();
  const counts = useVersionCounts(versions);
  const [selected, setSelected] = useState<Id | null>(null);
  const [openVersion, setOpenVersion] = useState<Id | null>(null);

  const list = useMemo(
    () => (agreements.ids === null ? null : agreements.ids.map((id) => proposals[id]).filter((p): p is Proposal => p !== undefined && (AGREEMENT_STATUSES as readonly string[]).includes(p.status))),
    [agreements.ids, proposals],
  );
  const chosen = (selected === null ? null : (list?.find((p) => p.id === selected) ?? null)) ?? (list === null ? null : defaultAgreement(list));
  const version = openVersion === null ? null : (versions.find((v) => v.id === openVersion) ?? null);

  return (
    <section className="screen ol-screen tm-screen" data-screen="terms" aria-labelledby="terms-title">
      <div className="ol-noprint">
        <ScreenHead id="terms-title" title={t("nav.terms")} lead={t("terms.lead")} />
      </div>
      <div className="tm-cols">
        <div className="tm-col ol-noprint">
          <AgreementList
            list={list}
            selected={chosen?.id ?? null}
            onSelect={(id) => {
              setSelected(id);
              setOpenVersion(null);
            }}
            total={agreements.total}
            signed={agreements.signed}
            failed={agreements.failed}
            onMore={() => void agreements.more(agreements.ids?.length ?? 0)}
            versions={versions}
          />
          <VersionList versions={versions} counts={counts} manager={manager} openId={openVersion} onOpen={setOpenVersion} />
        </div>
        <div className="tm-col">
          {version !== null ? (
            <VersionPanel version={version} versions={versions} count={counts[version.id]} manager={manager} onBack={() => setOpenVersion(null)} />
          ) : chosen !== null ? (
            <AgreementPanel proposal={chosen} versions={versions} />
          ) : (
            list !== null && <p className="tm-card tm-empty">{t("terms.agreementsEmpty")}</p>
          )}
        </div>
      </div>
    </section>
  );
}
