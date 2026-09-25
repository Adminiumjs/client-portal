/**
 * The handover, the studio's side: the page a client's share link opens,
 * with the studio's controls around it — which project, a way to preview
 * exactly what they see, the link itself (copy it, stop it, make a new one,
 * how long it lives), sending it, every file in one place (the approved work
 * and whatever the studio adds; all of it as one zip), the notes for the next
 * time it is printed, and the fonts licensed in the client's name.
 *
 * The link's token is Adminium's; a new one is made by Adminium and the old
 * one stops working at once.
 */
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, BookOpen, Check, Copy, Download, Eye, File as FileIcon, FileCode, FileImage, FileText, FolderDown, Link as LinkIcon, Link2Off, Package, PencilLine, Plus, Send, Type, X } from "lucide-react";

import type { Id, Project } from "../data/types.ts";
import { useI18n } from "../i18n/index.tsx";
import { dayLabel } from "../lib/dates.ts";
import { today } from "../lib/clock.ts";
import { Button, Empty, Money } from "../components/ui.tsx";
import { newShareLink, removeHandoverFile, saveHandoverNotes, sendHandover, setShareExpiry } from "../state/actions.ts";
import { loadPage, loadProject, loadWhere, useCan, useRow, useRows } from "../state/desk.ts";
import { refusalKey } from "../state/outcome.ts";
import { previewClient } from "../state/preview.ts";
import { openSheet } from "../state/sheets.ts";
import { open, toast, useUi } from "../state/ui.ts";
import { AddFileSheet } from "./handover/AddFileSheet.tsx";
import { expiryDay, expiryOf, handoverRows, invoiced, linkState, paragraphs, saveFonts, shareAddress, shownAddress, zipName, type Expiry, type FontRow, type HandoverRow } from "./handover/model.ts";
import { makeZip, uniqueNames } from "./handover/zip.ts";
import { doneCount, firstName, milestonesOf } from "./project/model.ts";
import { tileStyle } from "./project/DeliverableIcon.tsx";
import { fileInfo, iconFor, sizeLabel, useFileInfo } from "./review/files.ts";

const STATE_TONE = { stopped: "", ended: " pill--warn", live: " pill--pos", notSent: "" } as const;

export default function Handover() {
  const { t, number, locale } = useI18n();
  const selected = useUi((s) => s.selected.project);
  const projects = useRows("projects");
  const clients = useRows("clients");
  const fallback = useMemo(() => [...projects].sort((a, b) => (a.status === "done" ? 1 : 0) - (b.status === "done" ? 1 : 0) || a.id - b.id)[0]?.id ?? null, [projects]);
  const id = selected ?? fallback;
  const project = useRow("projects", id);
  const client = useRow("clients", project?.client_id);
  const milestones = useRows("milestones");
  const deliverables = useRows("deliverables");
  const versions = useRows("deliverable_versions");
  const files = useRows("handover_files");
  const invoices = useRows("invoices");
  const canEdit = useCan("projects", "update");
  const [loaded, setLoaded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<null | "send" | "link" | "expiry" | "zip">(null);

  // The picker names every project, finished ones too.
  useEffect(() => {
    void loadPage("projects", { where: { column: "status", op: "eq", value: "done" }, order: "done_on.desc", limit: 24, offset: 0 })
      .then((page) => (page.ids.length === 0 ? [] : loadWhere("milestones", { column: "project_id", op: "in", value: page.ids }, "position.asc")))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (id === null) return;
    setLoaded(false);
    void loadProject(id).finally(() => setLoaded(true));
  }, [id]);

  const day = today();
  const picker = useMemo(() => [...projects].sort((a, b) => a.id - b.id), [projects]);

  if (project === undefined || id === null) {
    return (
      <section className="screen ol-screen" data-screen="handover" aria-labelledby="handover-title">
        <h1 className="ol-sr-only" id="handover-title">
          {t("screen.handover")}
        </h1>
        {(id === null || loaded) && <Empty title={t("projects.page.missing")} body={t("projects.page.missingBody")} />}
      </section>
    );
  }

  const first = firstName(client?.contact_name);
  const company = client?.company ?? "";
  const number_ = project.number ?? t("projects.noNumber");
  const ms = milestonesOf(milestones, project.id);
  const state = linkState(project, day);
  /*
   * Adminium hides a column whose name reads like a credential from every
   * staff read (`share_token` among them), so the desk cannot see the code —
   * nor whether there is one yet (the sample's projects have none until a
   * link is made). The page says the link goes out in the handover email,
   * offers Stop and Make a new link, and never prints an address that opens
   * nothing.
   */
  const hidden = typeof project.share_token !== "string";
  const address = hidden ? null : shareAddress(project.share_token as string, typeof window === "undefined" ? "" : window.location.origin, import.meta.env.BASE_URL);
  const expiry = expiryOf(project);
  const rows = handoverRows(project.id, deliverables, versions, files);
  const sum = invoiced(invoices, project.id);
  const name = locale === "en-US" ? project.name.charAt(0).toLowerCase() + project.name.slice(1) : project.name;
  const companyOf = (clientId: Id) => clients.find((c) => c.id === clientId)?.company ?? "";

  const fail = (reason: Parameters<typeof refusalKey>[0]) => toast(t(refusalKey(reason), { id: number_ }), { icon: "circle-alert", tone: "danger" });

  const copy = async () => {
    if (address === null) return;
    try {
      await navigator.clipboard.writeText(address);
      toast(t("handover.link.copied"), { icon: "copy" });
    } catch {
      toast(t("handover.link.copyFailed"), { icon: "circle-alert", tone: "danger" });
    }
  };
  const makeNew = async () => {
    setBusy("link");
    const out = await newShareLink(project.id);
    setBusy(null);
    if (!out.ok) return fail(out.reason);
    toast(t("handover.link.renewed"), { icon: "link" });
  };
  const choose = async (choice: Expiry) => {
    if (choice === expiry && project.share_expires_on === expiryDay(choice, day)) return;
    setBusy("expiry");
    const out = await setShareExpiry(project.id, expiryDay(choice, day));
    setBusy(null);
    if (!out.ok) return fail(out.reason);
    toast(choice === "never" ? t("handover.expiry.setNever") : t("handover.expiry.set90", { day: dayLabel(expiryDay(choice, day), locale, "long") }), { icon: "calendar" });
  };
  const send = async () => {
    if (state === "stopped") return toast(t("handover.send.stopped"), { icon: "link-2-off" });
    if (project.handover_sent) return toast(t("handover.send.already"), { icon: "check" });
    setBusy("send");
    const out = await sendHandover(project.id);
    setBusy(null);
    if (!out.ok) return fail(out.reason);
    toast(t("handover.send.sent", { first }), { icon: "send" });
  };
  const takeAll = async () => {
    setBusy("zip");
    const zip = zipName(company, project.number);
    try {
      const infos = await Promise.all(rows.map((r) => (r.link ? Promise.resolve(null) : fileInfo(r.value))));
      const got = await Promise.all(
        rows.map(async (r, i) => {
          const info = infos[i] ?? null;
          if (r.link || info === null || info.download === null) return null;
          try {
            const reply = await fetch(info.download, { credentials: "same-origin" });
            return reply.ok ? { name: info.name, data: new Uint8Array(await reply.arrayBuffer()) } : null;
          } catch {
            return null;
          }
        }),
      );
      const real = got.flatMap((g) => (g === null ? [] : [g]));
      const names = uniqueNames(real.map((r) => r.name));
      const listing = rows.map((r, i) => `${r.link ? r.value : (infos[i]?.name ?? r.value)}  ·  ${t(kindKey(r, infos[i]?.name ?? ""))}${infos[i]?.size != null ? `  ·  ${sizeLabel(infos[i]!.size, number)}` : ""}`).join("\n");
      const contents = new TextEncoder().encode(`${t("handover.hero.title", { name })} — ${company}\n\n${listing}\n`);
      const bytes = makeZip([{ name: "contents.txt", data: contents }, ...real.map((r, i) => ({ name: names[i]!, data: r.data }))]);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/zip" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = zip;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast(t("handover.files.zipped", { zip, count: number(rows.length) }, rows.length), { icon: "download" });
    } catch {
      toast(t("handover.files.zipFailed"), { icon: "circle-alert", tone: "danger" });
    }
    setBusy(null);
  };

  const preview = () => void previewClient(project.client_id, "handover", "handover");

  return (
    <section className="screen ol-screen ho-page" data-screen="handover" aria-labelledby="handover-title">
      <div className="ho-banner">
        <Eye size={15} aria-hidden="true" />
        <button type="button" className="ho-preview ol-gi" onClick={preview}>
          {t("handover.preview")}
          <ArrowUpRight size={13} aria-hidden="true" />
        </button>
        <span className="ho-picker" role="group" aria-label={t("handover.picker")}>
          {picker.map((p) => (
            <button key={p.id} type="button" className="rv-chip ol-chip" aria-pressed={p.id === project.id} title={`${p.number ?? ""} · ${p.name}`} onClick={() => open("handover", p.id)}>
              {pickerLabel(p, picker, companyOf)}
            </button>
          ))}
        </span>
      </div>

      <div className="card ho-hero-card">
        <div className="ho-hero" style={tileStyle(client?.tint ?? null)}>
          <span className="ho-kicker">{[company, project.number].filter((x) => x !== null && x !== "").join(" · ")}</span>
          <h1 className="ho-title" id="handover-title">
            {t("handover.hero.title", { name })}
          </h1>
          <p className="ho-intro">{project.status === "done" ? t("handover.hero.done", { day: dayLabel(project.done_on, locale, "long") }) : t("handover.hero.running")}</p>
        </div>
        <dl className="ho-stats">
          <div className="ho-stat">
            <dt>{t("handover.stats.ran")}</dt>
            <dd>
              {project.done_on !== null
                ? `${dayLabel(project.started_on, locale)} – ${dayLabel(project.done_on, locale)}`
                : project.started_on === null
                  ? "—"
                  : t("handover.stats.since", { day: dayLabel(project.started_on, locale) })}
            </dd>
          </div>
          <div className="ho-stat">
            <dt>{t("handover.stats.milestones")}</dt>
            <dd>{t("handover.stats.of", { done: number(doneCount(ms)), total: number(ms.length) })}</dd>
          </div>
          <div className="ho-stat">
            <dt>{t("handover.stats.invoiced")}</dt>
            <dd>
              <Money value={sum.total} currency={sum.currency} />
            </dd>
          </div>
        </dl>
      </div>

      <section className="card ho-link" aria-labelledby="ho-link-title">
        <div className="prj-panel-head">
          <LinkIcon size={15} aria-hidden="true" />
          <h2 id="ho-link-title">{t("handover.link.title")}</h2>
          <span className={`pill ho-state${STATE_TONE[state]}`}>{t(`handover.link.state.${state}`)}</span>
        </div>
        <div className="ho-link-body">
          <div className="ho-link-box">
            <span className={`ho-address${state === "stopped" ? " ho-address--stopped" : ""}${address === null ? " ho-address--words" : ""}`}>{address !== null ? shownAddress(address) : hidden && state !== "stopped" ? t("handover.link.hidden") : t("handover.link.none")}</span>
            {state !== "stopped" && (address !== null || hidden) && (
              <>
                {address !== null && (
                  <Button size="small" icon={Copy} onClick={() => void copy()}>
                    {t("handover.link.copy")}
                  </Button>
                )}
                {canEdit && (
                  <Button size="small" kind="danger" icon={Link2Off} onClick={() => openSheet({ kind: "stopShare", projectId: project.id })}>
                    {t("handover.link.stop")}
                  </Button>
                )}
              </>
            )}
            {(state === "stopped" || address === null) && (
              <>
                {project.share_stopped_at !== null && <span className="ho-stopped-on">{t("handover.link.stoppedOn", { day: dayLabel(project.share_stopped_at.slice(0, 10), locale) })}</span>}
                {canEdit && (
                  <Button size="small" icon={LinkIcon} busy={busy === "link"} onClick={() => void makeNew()}>
                    {t("handover.link.renew")}
                  </Button>
                )}
              </>
            )}
          </div>
          <div className="ho-expiry">
            <span className="rv-kicker" id="ho-expiry-label">
              {t("handover.expiry.title")}
            </span>
            <div className="ho-chips" role="group" aria-labelledby="ho-expiry-label">
              {(["never", "days90"] as const).map((choice) => (
                <button key={choice} type="button" className="rv-chip ol-chip" aria-pressed={expiry === choice} disabled={!canEdit || busy === "expiry"} onClick={() => void choose(choice)}>
                  {t(`handover.expiry.${choice}`)}
                </button>
              ))}
            </div>
            <span className="ho-expiry-note">
              {expiry === "never"
                ? t("handover.expiry.neverNote")
                : state === "ended"
                  ? t("handover.expiry.endedNote", { day: dayLabel(project.share_expires_on, locale, "long") })
                  : t("handover.expiry.days90Note", { day: dayLabel(project.share_expires_on, locale, "long") })}
            </span>
          </div>
          {canEdit && (
            <Button kind="primary" icon={project.handover_sent ? Check : Send} busy={busy === "send"} className={`ho-send${project.handover_sent ? " ho-send--sent" : ""}`} onClick={() => void send()}>
              {project.handover_sent ? t("handover.send.sentTo", { first }) : t("handover.send.action")}
            </Button>
          )}
        </div>
      </section>

      <div className="ho-cols">
        <section className="card ho-files" aria-labelledby="ho-files-title">
          <div className="prj-panel-head">
            <FolderDown size={15} aria-hidden="true" />
            <h2 id="ho-files-title">{t("handover.files.title")}</h2>
            <span className="ho-head-actions">
              <AddFileButton onClick={() => setAdding(true)} />
              <Button size="small" icon={Download} busy={busy === "zip"} disabled={rows.length === 0} onClick={() => void takeAll()}>
                {t("handover.files.all")}
              </Button>
            </span>
          </div>
          {rows.length === 0 ? <p className="prj-panel-empty">{t("handover.files.empty")}</p> : (
            <ul className="ho-file-list" role="list">
              {rows.map((row) => (
                <FileRow key={row.key} row={row} deliverableTitle={row.source === "deliverable" ? row.title : null} />
              ))}
            </ul>
          )}
        </section>

        <div className="ho-side">
          <Notes project={project} canEdit={canEdit} numberText={number_} />
          <Fonts project={project} numberText={number_} />
        </div>
      </div>
      {adding && <AddFileSheet project={project} company={company} onClose={() => setAdding(false)} />}
    </section>
  );
}

function pickerLabel(p: Project, all: readonly Project[], companyOf: (id: Id) => string): string {
  const company = companyOf(p.client_id);
  return all.filter((x) => x.client_id === p.client_id).length > 1 && p.number !== null ? `${company} · ${p.number}` : company || (p.number ?? "");
}

function AddFileButton({ onClick }: { onClick: () => void }) {
  const { t } = useI18n();
  const can = useCan("handover_files", "create");
  if (!can) return null;
  return (
    <Button size="small" icon={Plus} onClick={onClick}>
      {t("handover.files.add")}
    </Button>
  );
}

function kindKey(row: HandoverRow, name: string): "handover.files.kind.link" | "handover.files.kind.added" | "handover.files.kind.vector" | "handover.files.kind.artwork" {
  if (row.link) return "handover.files.kind.link";
  if (row.source === "added") return "handover.files.kind.added";
  return /\.svg$/i.test(name) ? "handover.files.kind.vector" : "handover.files.kind.artwork";
}

const ROW_ICONS = { link: LinkIcon, "file-code": FileCode, "file-image": FileImage, "file-text": FileText, "file-archive": Package, file: FileIcon } as const;

function FileRow({ row, deliverableTitle }: { row: HandoverRow; deliverableTitle: string | null }) {
  const { t, number } = useI18n();
  const info = useFileInfo(row.value);
  const canRemove = useCan("handover_files", "delete");
  const [busy, setBusy] = useState(false);
  const name = info?.name ?? deliverableTitle ?? "";
  const href = row.link ? row.value : (info?.download ?? null);
  const iconName = row.link ? "link" : iconFor({ mime: info?.mime ?? null, name });
  const Icon = ROW_ICONS[iconName as keyof typeof ROW_ICONS] ?? FileIcon;
  const kind = [t(kindKey(row, name)), row.source === "added" && row.note !== null && row.note !== "" ? row.note : null, deliverableTitle === name ? null : deliverableTitle].filter((x) => x !== null && x !== "").join(" · ");
  const size = row.link || info?.size == null ? "" : sizeLabel(info.size, number);

  const remove = async () => {
    if (row.source !== "added") return;
    setBusy(true);
    const out = await removeHandoverFile(row.fileId);
    setBusy(false);
    if (!out.ok) toast(t(refusalKey(out.reason), { id: "" }), { icon: "circle-alert", tone: "danger" });
    else toast(t("handover.files.removed", { name }), { icon: "x" });
  };

  const body = (
    <>
      <Icon size={16} aria-hidden="true" className="ho-file-icon" />
      <span className="ho-file-main">
        <span className="ho-file-name">{name}</span>
        <span className="ho-file-kind">{kind}</span>
      </span>
      <span className="ho-file-size">{size}</span>
      {href !== null && (row.link ? <ArrowUpRight size={15} aria-hidden="true" className="ho-file-go" /> : <Download size={15} aria-hidden="true" className="ho-file-go" />)}
    </>
  );
  return (
    <li className="ho-file">
      {href === null ? (
        <span className="ho-file-row ho-file-row--static" title={t("handover.files.unavailable")}>
          {body}
        </span>
      ) : (
        <a className="ho-file-row ol-row" href={href} target="_blank" rel="noopener noreferrer" {...(row.link ? {} : { download: name })} aria-label={t(row.link ? "handover.files.openLabel" : "handover.files.downloadLabel", { name, size })}>
          {body}
        </a>
      )}
      {row.source === "added" && canRemove && (
        <button type="button" className="ho-file-remove ol-gi" aria-label={t("handover.files.removeLabel", { name })} title={t("handover.files.removeLabel", { name })} disabled={busy} onClick={() => void remove()}>
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </li>
  );
}

// ── notes ───────────────────────────────────────────────────────────────────

function Notes({ project, canEdit, numberText }: { project: Project; canEdit: boolean; numberText: string }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = paragraphs(project.handover_notes);
  const save = async () => {
    setBusy(true);
    const out = await saveHandoverNotes(project.id, (draft ?? "").trim());
    setBusy(false);
    if (!out.ok) return setError(t(refusalKey(out.reason), { id: numberText }));
    setDraft(null);
    toast(t("handover.notes.saved", { id: numberText }), { icon: "check" });
  };
  return (
    <section className="card ho-panel" aria-labelledby="ho-notes-title">
      <div className="prj-panel-head">
        <BookOpen size={15} aria-hidden="true" />
        <h2 id="ho-notes-title">{t("handover.notes.title")}</h2>
        {draft === null && canEdit && (
          <Button size="small" icon={PencilLine} className="prj-head-btn" onClick={() => { setDraft(shown.join("\n\n")); setError(null); }}>
            {t("handover.edit")}
          </Button>
        )}
      </div>
      {draft === null ? (
        <div className="ho-notes">{shown.length === 0 ? <p className="rv-quiet">{t("handover.notes.empty")}</p> : shown.map((p, i) => <p key={i}>{p}</p>)}</div>
      ) : (
        <div className="ho-edit">
          <textarea className="input" rows={8} value={draft} aria-label={t("handover.notes.label")} aria-describedby="ho-notes-hint" onChange={(e) => setDraft(e.target.value)} />
          <span className="field-hint" id="ho-notes-hint">
            {t("handover.notes.hint")}
          </span>
          {error !== null && <span className="field-error" role="alert">{error}</span>}
          <div className="rv-row">
            <Button kind="primary" icon={Check} busy={busy} onClick={() => void save()}>
              {t("handover.notes.save")}
            </Button>
            <Button onClick={() => setDraft(null)}>{t("common.cancel")}</Button>
          </div>
        </div>
      )}
    </section>
  );
}

// ── fonts ───────────────────────────────────────────────────────────────────

function Fonts({ project, numberText }: { project: Project; numberText: string }) {
  const { t } = useI18n();
  const all = useRows("project_fonts");
  const fonts = useMemo(() => all.filter((f) => f.project_id === project.id).sort((a, b) => a.position - b.position || a.id - b.id), [all, project.id]);
  const canAdd = useCan("project_fonts", "create");
  const canChange = useCan("project_fonts", "update");
  const canRemove = useCan("project_fonts", "delete");
  const [rows, setRows] = useState<FontRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (i: number, patch: Partial<FontRow>) => setRows((r) => (r === null ? r : r.map((row, j) => (j === i ? { ...row, ...patch } : row))));
  const save = async () => {
    if (rows === null) return;
    setBusy(true);
    const out = await saveFonts(project.id, fonts, rows);
    setBusy(false);
    if (!out.ok) return setError(t(refusalKey(out.reason), { id: numberText }));
    setRows(null);
    toast(t("handover.fonts.saved", { id: numberText }), { icon: "check" });
  };
  return (
    <section className="card ho-panel" aria-labelledby="ho-fonts-title">
      <div className="prj-panel-head">
        <Type size={15} aria-hidden="true" />
        <h2 id="ho-fonts-title">{t("handover.fonts.title")}</h2>
        {rows === null && (canAdd || canChange) && (
          <Button size="small" icon={PencilLine} className="prj-head-btn" onClick={() => { setRows(fonts.map((f) => ({ id: f.id, name: f.name, licence: f.licence ?? "" }))); setError(null); }}>
            {t("handover.edit")}
          </Button>
        )}
      </div>
      {rows === null ? (
        fonts.length === 0 ? (
          <p className="prj-panel-empty">{t("handover.fonts.empty")}</p>
        ) : (
          <ul className="ho-fonts" role="list">
            {fonts.map((f) => (
              <li key={f.id} className="ho-font">
                <span className="ho-font-main">
                  <span className="ho-font-name">{f.name}</span>
                  <span className="ho-font-licence">{f.licence ?? t("handover.fonts.onFile")}</span>
                </span>
                <span className="pill pill--pos">{t("handover.fonts.yours")}</span>
              </li>
            ))}
          </ul>
        )
      ) : (
        <div className="ho-edit">
          {rows.map((row, i) => (
            <div key={row.id ?? `new-${String(i)}`} className="ho-font-edit">
              <input className="input" value={row.name} maxLength={120} placeholder={t("handover.fonts.namePh")} aria-label={t("handover.fonts.nameLabel", { n: i + 1 })} disabled={row.id !== undefined && !canChange} onChange={(e) => set(i, { name: e.target.value })} />
              <input className="input" value={row.licence} maxLength={200} placeholder={t("handover.fonts.licencePh")} aria-label={t("handover.fonts.licenceLabel", { n: i + 1 })} disabled={row.id !== undefined && !canChange} onChange={(e) => set(i, { licence: e.target.value })} />
              {(row.id === undefined || canRemove) && (
                <button type="button" className="ho-file-remove ol-gi" aria-label={t("handover.fonts.removeLabel", { n: i + 1 })} title={t("handover.fonts.removeLabel", { n: i + 1 })} onClick={() => setRows((r) => (r === null ? r : r.filter((_, j) => j !== i)))}>
                  <X size={14} aria-hidden="true" />
                </button>
              )}
            </div>
          ))}
          {error !== null && <span className="field-error" role="alert">{error}</span>}
          <div className="rv-row">
            {canAdd && (
              <Button size="small" icon={Plus} onClick={() => setRows((r) => [...(r ?? []), { name: "", licence: "" }])}>
                {t("handover.fonts.add")}
              </Button>
            )}
            <span className="ho-edit-end">
              <Button kind="primary" icon={Check} busy={busy} onClick={() => void save()}>
                {t("handover.fonts.save")}
              </Button>
              <Button onClick={() => setRows(null)}>{t("common.cancel")}</Button>
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
