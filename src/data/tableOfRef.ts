/**
 * Every table this app reads and writes, by the manifest's short name, and
 * the real name an install gave it.
 *
 * The manifest asks for prefixed tables, so Adminium makes `clients_invoices`
 * for `invoices` and hands the real names over at boot (`realTables`, from the
 * staff or the customer config). `TABLE_OF_REF` is the fallback an older
 * server and the demo use: the same prefix Adminium would have chosen.
 * `refCoverage.test.ts` checks it against what the desk reads.
 */
import { TABLE_REFS, type TableRef } from "./types.ts";

/** The prefix Adminium gives this app's tables (its key and an underscore). */
export const TABLE_PREFIX = "clients_";

export const TABLE_OF_REF: Readonly<Record<TableRef, string>> = Object.fromEntries(TABLE_REFS.map((ref) => [ref, `${TABLE_PREFIX}${ref}`])) as Record<TableRef, string>;

/** The real names Adminium sent, over the default ones for any it did not. */
export function realTables(fromConfig: Record<string, string>): Record<TableRef, string> {
  return { ...TABLE_OF_REF, ...Object.fromEntries(Object.entries(fromConfig).filter(([ref]) => ref in TABLE_OF_REF)) } as Record<TableRef, string>;
}
