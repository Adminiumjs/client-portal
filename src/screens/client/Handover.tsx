/**
 * The shared handover, opened by its link: everything from a finished project
 * — the approved files and the studio's own handover files, the fonts, and
 * the notes for the next time it goes to print. No sign-in and nothing else of
 * the client's: the link opens this one page, read-only, until the studio
 * stops it or it runs out.
 */
import { useEffect, useState } from "react";
import { BookOpen, Download, File as FileIcon, FolderDown, Link2Off, Mail, Type, CalendarX } from "lucide-react";

import type { HandoverView, PrivateFile } from "../../data/ports.ts";
import { useI18n } from "../../i18n/index.tsx";
import { usePortal } from "../../state/portal.ts";
import { useUi } from "../../state/ui.ts";
import { Section } from "./shared/bits.tsx";
import { byPosition, fileName, versionFile, versionsOf } from "./shared/model.ts";
import NotFound from "./NotFound.tsx";
import { portOrNull } from "./shared/page.ts";
import { fileSource, savePrivate, type FileSource } from "./shared/files.ts";
import { linkToken } from "./shared/token.ts";

type Loaded = { kind: "loading" } | { kind: "live"; view: HandoverView } | { kind: "stopped" } | { kind: "expired" } | { kind: "unknown" };

/** The codes a share link that no longer opens comes back with. */
const EXPIRED = new Set(["LINK_EXPIRED", "SHARE_EXPIRED", "PUBLIC_TOKEN_EXPIRED"]);

export interface HandoverFileRow {
  key: string;
  name: string;
  what: string;
  source: FileSource;
}

/** Fetch one of the page's stored files through the share link's own session. */
export type HandoverFetch = (ref: "deliverable_versions" | "handover_files", id: number, column: "file") => Promise<PrivateFile>;

/**
 * The files the page offers: each approved deliverable's latest version, then
 * the studio's handover files — each from its shared link, else its stored
 * file fetched through the share link's session (when this page can).
 */
export function handoverFiles(view: HandoverView, fetch: HandoverFetch | null): HandoverFileRow[] {
  const via = (ref: "deliverable_versions" | "handover_files", id: number) => (fetch === null ? null : () => fetch(ref, id, "file"));
  const approved = [...view.deliverables].sort(byPosition).flatMap((d) => {
    const latest = versionsOf(view.versions, d.id)[0];
    if (latest === undefined) return [];
    const name = versionFile(latest) || d.title;
    return [{ key: `v${latest.id}`, name, what: d.title, source: fileSource(latest, name, via("deliverable_versions", latest.id)) }];
  });
  const extra = [...view.files].sort(byPosition).map((f) => {
    const name = fileName(f.file) || fileName(f.link);
    return { key: `f${f.id}`, name, what: f.note ?? "", source: fileSource(f, name, via("handover_files", f.id)) };
  });
  return [...approved, ...extra].filter((f) => f.name !== "");
}

export default function Handover() {
  const { t } = useI18n();
  const token = linkToken(useUi((s) => s.token), "share");
  const replyTo = usePortal((s) => s.studio?.settings?.reply_to ?? null);
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });

  useEffect(() => {
    const port = portOrNull();
    if (token === null || port === null) {
      setLoaded({ kind: "stopped" });
      return;
    }
    let live = true;
    port
      .openHandover(token)
      .then((view) => live && setLoaded({ kind: "live", view }))
      .catch((error: unknown) => {
        const code = (error as { code?: unknown } | null)?.code;
        if (live) setLoaded({ kind: code === "LINK_UNKNOWN" ? "unknown" : typeof code === "string" && EXPIRED.has(code) ? "expired" : "stopped" });
      });
    return () => {
      live = false;
    };
  }, [token]);

  const questions =
    replyTo === null ? null : (
      <p className="cl-questions">
        <Mail size={14} aria-hidden="true" />
        {t("client.handover.questions")}{" "}
        <a href={`mailto:${replyTo}`} className="cl-mono-inline">
          {replyTo}
        </a>
      </p>
    );

  if (loaded.kind === "loading") return <section className="screen ol-screen cl-page" data-screen="client-handover" aria-busy="true" />;

  // A code that opens nothing reads like any address that names nothing.
  if (loaded.kind === "unknown") return <NotFound />;

  if (loaded.kind !== "live") {
    const Icon = loaded.kind === "expired" ? CalendarX : Link2Off;
    return (
      <section className="screen ol-screen cl-page" data-screen="client-handover" aria-labelledby="cl-handover-title">
        <div className="dead-end dead-end--card">
          <span className="dead-end-badge" aria-hidden="true">
            <Icon size={24} />
          </span>
          <h1 className="dead-end-title" id="cl-handover-title">
            {t(loaded.kind === "expired" ? "client.handover.expired" : "client.handover.stopped")}
          </h1>
          <p className="dead-end-body">{t("client.handover.askNew")}</p>
        </div>
        {questions}
      </section>
    );
  }

  const { view } = loaded;
  // The share link's own session fetches its files; a page without one offers the shared links only.
  const fetchFile = (view as HandoverView & { file?: HandoverFetch }).file ?? null;
  const files = handoverFiles(view, fetchFile);
  const fonts = [...view.fonts].sort(byPosition);
  const notes = (view.project.handover_notes ?? "")
    .split(/\n\s*\n|\n/)
    .map((n) => n.trim())
    .filter((n) => n !== "");
  const studio = view.studio?.name ?? "";

  return (
    <section className="screen ol-screen cl-page" data-screen="client-handover" aria-labelledby="cl-handover-title">
      <div className="cl-card cl-hero">
        <span className="cl-mono-kicker">{[view.project.number, t("client.handover.from", { studio })].filter((x) => x !== null && x !== "").join(" · ")}</span>
        <h1 className="cl-hero-title" id="cl-handover-title">
          {t("client.handover.title", { project: view.project.name })}
        </h1>
        <p className="cl-muted cl-hero-intro">{t("client.handover.intro")}</p>
      </div>

      <Section icon={FolderDown} title={t("client.handover.files")} id="cl-handover-files">
        {files.length === 0 ? (
          <div className="cl-pad cl-subtle">{t("client.handover.noFiles")}</div>
        ) : (
          <ul className="cl-files">
            {files.map((f) => {
              const inner = (
                <>
                  <FileIcon size={16} aria-hidden="true" className="cl-list-icon" />
                  <span className="cl-list-main">
                    <span className="cl-file-name">{f.name}</span>
                    {f.what !== "" && <span className="cl-file-what">{f.what}</span>}
                  </span>
                  {f.source !== null && <Download size={15} aria-hidden="true" className="cl-chevron" />}
                </>
              );
              const label = t("client.handover.download", { file: f.name });
              return (
                <li key={f.key}>
                  {f.source === null ? (
                    <span className="cl-file">{inner}</span>
                  ) : f.source.kind === "link" ? (
                    <a className="cl-file ol-row" href={f.source.href} download target="_blank" rel="noopener noreferrer" aria-label={label}>
                      {inner}
                    </a>
                  ) : (
                    <button type="button" className="cl-file ol-row" aria-label={label} onClick={() => f.source?.kind === "private" && void savePrivate(f.source, t("client.fileFailed"))}>
                      {inner}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {fonts.length > 0 && (
        <Section icon={Type} title={t("client.handover.fonts")} id="cl-handover-fonts">
          <ul className="cl-fonts">
            {fonts.map((f) => (
              <li key={f.id} className="cl-font">
                <span className="cl-font-name">{f.name}</span>
                {f.licence !== null && <span className="cl-subtle">{f.licence}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {notes.length > 0 && (
        <Section icon={BookOpen} title={t("client.handover.notes")} id="cl-handover-notes">
          <div className="cl-pad cl-scope">
            {notes.map((n, i) => (
              <p key={i}>{n}</p>
            ))}
          </div>
        </Section>
      )}
      {questions}
    </section>
  );
}
