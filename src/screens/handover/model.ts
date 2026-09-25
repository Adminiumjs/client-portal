/**
 * What the studio's handover page works out from the rows it holds:
 *
 *   the link's state   stopped (the studio stopped it) · ended (its last day
 *                      has passed) · live (the handover went out) · not sent yet
 *   the address        the clients' side's own address + `h#<token>` — the
 *                      token rides in the fragment, which no server sees
 *   how long it lives  never (no last day) or 90 days (a last day)
 *   the files          the approved deliverables' newest versions, then the
 *                      files the studio added
 *   the notes          paragraphs split on a blank line
 *   the fonts          what "Save fonts" changes: rows gone, rows changed, rows new
 */
import type { Day, Deliverable, DeliverableVersion, HandoverFile, Id, Invoice, Project, ProjectFont } from "../../data/types.ts";
import { addDays, daysBetween } from "../../data/venueTime.ts";
import { sumDecimals } from "../../lib/money.ts";
import { addFont, editFont, removeFont, type Outcome } from "../../state/actions.ts";
import { versionsOf } from "../review/model.ts";

export type LinkState = "stopped" | "ended" | "live" | "notSent";

export function linkState(p: Pick<Project, "share_stopped" | "share_expires_on" | "handover_sent" | "handover_sent_at">, today: Day): LinkState {
  if (p.share_stopped) return "stopped";
  if (p.share_expires_on !== null && daysBetween(p.share_expires_on, today) > 0) return "ended";
  return p.handover_sent || p.handover_sent_at !== null ? "live" : "notSent";
}

/** Where the clients' side lives, from where the desk is served (`…/staff/` → `…/customer/`). */
export function clientsBase(origin: string, base: string): string {
  const path = base.endsWith("/") ? base : `${base}/`;
  return `${origin}${path.replace(/\/staff\/$/, "/customer/")}`;
}

/** The link the studio sends: the clients' side's address, then the token in the fragment. */
export const shareAddress = (token: string, origin: string, base: string): string => `${clientsBase(origin, base)}h#${token}`;

/** The address without its scheme, as the page shows it. */
export const shownAddress = (address: string): string => address.replace(/^https?:\/\//, "");

export type Expiry = "never" | "days90";

export const expiryOf = (p: Pick<Project, "share_expires_on">): Expiry => (p.share_expires_on === null ? "never" : "days90");

/** The last day a choice sets: none, or ninety days from today. */
export const expiryDay = (choice: Expiry, today: Day): Day | null => (choice === "never" ? null : addDays(today, 90));

/** The notes as paragraphs: a blank line starts a new one. */
export const paragraphs = (notes: string | null): string[] =>
  (notes ?? "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p !== "");

/** One row of the handover's file list. */
export type HandoverRow =
  | { key: string; source: "deliverable"; deliverableId: Id; title: string; value: string; link: false }
  | { key: string; source: "deliverable"; deliverableId: Id; title: string; value: string; link: true }
  | { key: string; source: "added"; fileId: Id; value: string; note: string | null; link: false };

/** The approved deliverables' newest versions (their file, or their link), then the files the studio added. */
export function handoverRows(projectId: Id, deliverables: readonly Deliverable[], versions: readonly DeliverableVersion[], files: readonly HandoverFile[]): HandoverRow[] {
  const rows: HandoverRow[] = [];
  const approved = deliverables.filter((d) => d.project_id === projectId && d.status === "approved").sort((a, b) => a.position - b.position || a.id - b.id);
  for (const d of approved) {
    const newest = versionsOf(versions, d.id).at(-1);
    if (newest === undefined) continue;
    if (newest.file !== null && newest.file !== "") rows.push({ key: `d${String(d.id)}`, source: "deliverable", deliverableId: d.id, title: d.title, value: newest.file, link: false });
    else if (newest.link !== null && newest.link !== "") rows.push({ key: `d${String(d.id)}`, source: "deliverable", deliverableId: d.id, title: d.title, value: newest.link, link: true });
  }
  for (const f of files.filter((x) => x.project_id === projectId).sort((a, b) => a.position - b.position || a.id - b.id)) {
    if (f.file !== null && f.file !== "") rows.push({ key: `f${String(f.id)}`, source: "added", fileId: f.id, value: f.file, note: f.note, link: false });
  }
  return rows;
}

/** "Invoiced": the project's invoices that were sent, their stored totals added up (void ones left out). */
export function invoiced(invoices: readonly Invoice[], projectId: Id): { total: string; currency: string | null } {
  const mine = invoices.filter((i) => i.project_id === projectId && i.status === "sent");
  return { total: sumDecimals(mine.map((i) => i.total)), currency: mine[0]?.currency ?? null };
}

/** The zip's name: `{client}_{project number}_handover.zip`, in plain letters. */
export function zipName(company: string, number: string | null): string {
  const slug = (s: string) =>
    s
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  return `${slug(company) || "client"}_${slug(number ?? "") || "project"}_handover.zip`;
}

// ── the fonts ───────────────────────────────────────────────────────────────

export interface FontRow {
  id?: Id;
  name: string;
  licence: string;
}

export interface FontChanges {
  remove: Id[];
  edit: { id: Id; name: string; licence: string | null; position: number }[];
  add: { name: string; licence: string | null; position: number }[];
}

/** What saving the edited rows changes: a row without a name is dropped; an empty licence is stored empty. */
export function fontChanges(held: readonly ProjectFont[], rows: readonly FontRow[]): FontChanges {
  const kept = rows.map((r) => ({ ...r, name: r.name.trim(), licence: r.licence.trim() })).filter((r) => r.name !== "");
  const keptIds = new Set(kept.flatMap((r) => (r.id === undefined ? [] : [r.id])));
  const changes: FontChanges = { remove: held.filter((f) => !keptIds.has(f.id)).map((f) => f.id), edit: [], add: [] };
  kept.forEach((r, position) => {
    const licence = r.licence === "" ? null : r.licence;
    if (r.id === undefined) {
      changes.add.push({ name: r.name, licence, position });
      return;
    }
    const before = held.find((f) => f.id === r.id);
    if (before === undefined) return;
    if (before.name !== r.name || (before.licence ?? null) !== licence || before.position !== position) changes.edit.push({ id: r.id, name: r.name, licence, position });
  });
  return changes;
}

/**
 * Save the edited fonts: gone ones removed, changed ones patched, new ones
 * added — each one of the desk's own actions. Pressing again after a failure
 * works the difference out again from what saved, so nothing is written twice.
 */
export async function saveFonts(projectId: Id, held: readonly ProjectFont[], rows: readonly FontRow[]): Promise<Outcome<void>> {
  const changes = fontChanges(held, rows);
  for (const id of changes.remove) {
    const out = await removeFont(id);
    if (!out.ok) return { ...out, unfinished: null };
  }
  for (const e of changes.edit) {
    const out = await editFont(e.id, { name: e.name, licence: e.licence, position: e.position });
    if (!out.ok) return { ...out, unfinished: null };
  }
  for (const a of changes.add) {
    const out = await addFont(projectId, a);
    if (!out.ok) return { ...out, unfinished: null };
  }
  return { ok: true, value: undefined };
}
