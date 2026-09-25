/**
 * Where a file the client may see comes from, and opening or saving it.
 *
 * A file the studio shared as a link opens at that link. A stored file is
 * private: it is fetched WITH the session (the port's `file`), never handed
 * out as a bare address, and shown from the browser's own copy — opened in a
 * new tab when it is something a browser draws (an image, a PDF), saved
 * under its own name otherwise.
 */
import type { PrivateFile } from "../../../data/ports.ts";
import { toast } from "../../../state/ui.ts";
import { openInNewTab } from "./page.ts";

export type FileSource = { kind: "link"; href: string } | { kind: "private"; fetch: () => Promise<PrivateFile>; name: string } | null;

/**
 * The source of a row's file: its shared link when it has one, else its
 * stored file through `fetch` (when this page can fetch one), else none.
 */
export function fileSource(row: { file: string | null; link?: string | null }, name: string, fetch: (() => Promise<PrivateFile>) | null): FileSource {
  if (row.link !== null && row.link !== undefined && row.link.trim() !== "") return { kind: "link", href: row.link };
  if (row.file !== null && row.file !== "" && fetch !== null) return { kind: "private", fetch, name };
  return null;
}

/** How long the browser's copy of a fetched file stays addressable. */
const KEEP_MS = 60_000;

function objectUrl(blob: Blob): string {
  const url = URL.createObjectURL(blob);
  setTimeout(() => URL.revokeObjectURL(url), KEEP_MS);
  return url;
}

/** Open a private file in a new tab (the tab opens on the click, so no pop-up blocker stops it). */
export function openPrivate(source: Extract<FileSource, { kind: "private" }>, blocked: string): Promise<boolean> {
  return openInNewTab(async () => objectUrl((await source.fetch()).blob), blocked);
}

/** Save a private file under its own name. */
export async function savePrivate(source: Extract<FileSource, { kind: "private" }>, failed: string): Promise<boolean> {
  try {
    const file = await source.fetch();
    const a = document.createElement("a");
    a.href = objectUrl(file.blob);
    a.download = file.filename ?? source.name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    return true;
  } catch {
    toast(failed, { icon: "warn", tone: "danger" });
    return false;
  }
}
