// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The data every screen reads, taken from the seam exactly once.
 *
 * §5.3 recorded this repo's seam as ORPHANED. It was written, and the store,
 * `screens/Portal.tsx`, `screens/Studio.tsx` and `lib/format.ts` reached past
 * it into `data/demo.ts` — for the clock, the studio's tax rate and the demo
 * portal credentials. Swapping the source would have changed the documents and
 * left the date, the tax and the tap-to-fill e-mail addresses seeded.
 *
 * So there is now exactly ONE reader of `source`, here. Read at module scope,
 * which is what makes the boot ordering in `main.tsx` load-bearing: the swap
 * has to happen before this module is evaluated, and `setDataSource` throws if
 * it does not.
 *
 * Pure helpers (`ser`, `serDate`, `fromSer`) still come from `demo.ts` — they
 * are arithmetic on day serials, not rows.
 */

import { source } from "./source.ts";

/** Today as a day serial, in the studio's own timezone. */
export const TODAY = source.today();

/** The standing rate applied to a NEW document. Each stored one carries its own. */
export const TAX_RATE = source.taxRate();

/** Tap-to-fill portal credentials. Empty on a connected build, deliberately. */
export const PORTAL_HINTS = source.portalHints();

export const CLIENTS = source.clients();
export const SEED_PROPOSALS = source.proposals();
export const SEED_PROJECTS = source.projects();
export const SEED_INVOICES = source.invoices();
export const SEED_ACTIVITY = source.activity();
