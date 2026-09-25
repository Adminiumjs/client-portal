/**
 * A file column's value, read the way the desk can draw it.
 *
 * What Adminium stores in a file column is one of three shapes (the column
 * decides): the file's id (`file_…`), a URL to its content
 * (`…/api/v1/files/<id>/content`), or a bucket key — or a link someone typed.
 * The desk runs at Adminium's own origin, signed in, so a file of the studio's
 * is read through Adminium's private file routes:
 *
 *   GET /api/v1/files/<id>                    its name, type and size
 *   GET /api/v1/files/<id>/content?inline=1   its bytes, shown in the page —
 *                                             images and PDFs only; an SVG is
 *                                             never served inline
 *   GET /api/v1/files/<id>/content            its bytes, as a download
 *
 * A file this browser has just uploaded is also kept here (`rememberUpload`),
 * so the page draws it at once — and the demo, whose stand-in world keeps no
 * bytes, can draw it at all.
 */
import { useEffect, useState } from "react";

export type FileRef = { kind: "adminium"; id: string } | { kind: "external"; href: string } | { kind: "local"; name: string } | { kind: "none" };

const FILE_ID = /^file_[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;
const CONTENT_PATH = /\/api\/v1\/files\/(file_[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26})\/content\/?(?:[?#].*)?$/;
const LOCAL = /^demo-file:/;

/** What a stored file value points at. */
export function parseFileRef(value: string | null | undefined): FileRef {
  const text = (value ?? "").trim();
  if (text === "") return { kind: "none" };
  if (FILE_ID.test(text)) return { kind: "adminium", id: text };
  const content = CONTENT_PATH.exec(text);
  if (content !== null) return { kind: "adminium", id: content[1]! };
  if (LOCAL.test(text)) return { kind: "local", name: text.replace(LOCAL, "") };
  if (/^https?:\/\//i.test(text)) return { kind: "external", href: text };
  return { kind: "local", name: text };
}

/** A file's name, type and size, as far as they are known. */
export interface FileInfo {
  name: string;
  mime: string | null;
  size: number | null;
  /** Where the page can read its bytes (same origin, or this browser's own copy). */
  url: string | null;
  /** Where a download link goes. */
  download: string | null;
}

/** How the review can draw a file: as an image, as a PDF's pages, or not at all (a card with a download). */
export type Drawable = "image" | "pdf" | "none";

const IMAGES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]);
const BY_EXTENSION: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", pdf: "application/pdf", svg: "image/svg+xml", zip: "application/zip" };

export const extensionOf = (name: string): string => (/\.([a-z0-9]{1,8})$/i.exec(name)?.[1] ?? "").toLowerCase();

/** A type for a name when the server did not say. */
export const mimeFromName = (name: string): string | null => BY_EXTENSION[extensionOf(name)] ?? null;

/** Images draw as they are; a PDF draws its pages; everything else — an SVG included — is a card. */
export function drawable(mime: string | null, name = ""): Drawable {
  const type = (mime ?? mimeFromName(name) ?? "").toLowerCase();
  if (IMAGES.has(type)) return "image";
  if (type === "application/pdf") return "pdf";
  return "none";
}

/** The icon name a file's kind suggests (a deliverable stores it when it is added). */
export function iconFor(kind: "link" | { mime: string | null; name: string }): string {
  if (kind === "link") return "link";
  const type = (kind.mime ?? mimeFromName(kind.name) ?? "").toLowerCase();
  if (type === "image/svg+xml") return "file-code";
  if (type.startsWith("image/")) return "file-image";
  if (type === "application/pdf") return "file-text";
  if (type === "application/zip") return "file-archive";
  return "file";
}

/** "8.4 MB", "48 KB", "512 B". */
export function sizeLabel(bytes: number | null, number: (n: number, opts?: Intl.NumberFormatOptions) => string = (n) => String(n)): string {
  if (bytes === null || !Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${number(bytes)} B`;
  if (bytes < 1048576) return `${number(Math.round(bytes / 1024))} KB`;
  return `${number(Math.round(bytes / 104857.6) / 10, { maximumFractionDigits: 1 })} MB`;
}

// ── this browser's own uploads ──────────────────────────────────────────────

const uploads = new Map<string, FileInfo>();
const listeners = new Set<() => void>();

/** Keep a file this browser just uploaded, under the value its column now holds. */
export function rememberUpload(value: string, file: Blob, name: string): void {
  let url: string | null = null;
  try {
    url = typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : null;
  } catch {
    url = null;
  }
  uploads.set(value, { name, mime: file.type || mimeFromName(name), size: file.size, url, download: url });
  cache.delete(value);
  listeners.forEach((l) => l());
}

// ── reading a file's facts ──────────────────────────────────────────────────

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

const contentUrl = (id: string, inline: boolean): string => `/api/v1/files/${encodeURIComponent(id)}/content${inline ? "?inline=true" : ""}`;

const cache = new Map<string, Promise<FileInfo | null>>();

/** A file's facts: this browser's copy, Adminium's record, the link itself, or what its value names. */
export function fileInfo(value: string | null | undefined, fetcher: Fetcher = (i, init) => fetch(i, init)): Promise<FileInfo | null> {
  const key = (value ?? "").trim();
  if (key === "") return Promise.resolve(null);
  const own = uploads.get(key);
  if (own !== undefined) return Promise.resolve(own);
  const held = cache.get(key);
  if (held !== undefined) return held;
  const ref = parseFileRef(key);
  const found = read(ref, fetcher);
  cache.set(key, found);
  // A failed read is not remembered: the next look tries again.
  void found.then((info) => {
    if (info === null) cache.delete(key);
  });
  return found;
}

async function read(ref: FileRef, fetcher: Fetcher): Promise<FileInfo | null> {
  if (ref.kind === "none") return null;
  if (ref.kind === "external") {
    const name = decodeURIComponent(ref.href.replace(/[?#].*$/, "").split("/").filter((p) => p !== "").pop() ?? ref.href);
    return { name: /^https?:$/i.test(name) ? ref.href : name, mime: null, size: null, url: null, download: ref.href };
  }
  if (ref.kind === "local") return { name: ref.name, mime: mimeFromName(ref.name), size: null, url: null, download: null };
  try {
    const reply = await fetcher(`/api/v1/files/${encodeURIComponent(ref.id)}`, { credentials: "same-origin", headers: { accept: "application/json" } });
    if (!reply.ok) return { name: ref.id, mime: null, size: null, url: contentUrl(ref.id, true), download: contentUrl(ref.id, false) };
    const body = (await reply.json()) as { data?: { filename?: string; mime?: string; sizeBytes?: number } };
    const data = body.data ?? {};
    const mime = data.mime ?? null;
    return { name: data.filename ?? ref.id, mime, size: data.sizeBytes ?? null, url: contentUrl(ref.id, drawable(mime) !== "none"), download: contentUrl(ref.id, false) };
  } catch {
    return null;
  }
}

/** `fileInfo`, as a hook: null while it is read, and when there is nothing to read. */
export function useFileInfo(value: string | null | undefined): FileInfo | null {
  const [info, setInfo] = useState<FileInfo | null>(() => uploads.get((value ?? "").trim()) ?? null);
  const [round, setRound] = useState(0);
  useEffect(() => {
    const again = () => setRound((n) => n + 1);
    listeners.add(again);
    return () => {
      listeners.delete(again);
    };
  }, []);
  useEffect(() => {
    let live = true;
    setInfo(uploads.get((value ?? "").trim()) ?? null);
    void fileInfo(value).then((found) => {
      if (live) setInfo(found);
    });
    return () => {
      live = false;
    };
  }, [value, round]);
  return info;
}

/** Forget every fact read (tests). */
export function forgetFiles(): void {
  cache.clear();
  uploads.clear();
}
