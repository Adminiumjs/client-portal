/*
 * VENDORED VERBATIM from packages/manifest/src/add-ons.ts.
 * Never hand-edit this copy: change the monorepo package and re-run
 * `node scripts/sync-manifest-validator.mjs`.
 *
 * WHY A COPY. `@adminium/manifest` is not published to npm and this app is a
 * standalone repo that must build from a clean clone, so it cannot depend on
 * the monorepo. It lives under `testing/` because `zod` is a devDependency
 * here and a runtime dependency the host does not carry — nothing in
 * the shipped bundle's import graph may reach it, which sources.test.ts gates.
 *
 * The only edits are import specifiers: `.js` becomes `.ts`, and the
 * `@adminium/add-on-contracts` package import becomes relative ones.
 */
/**
 * `addOns` — the add-ons an app needs, and the ones it works better with.
 *
 * ```json
 * "addOns": {
 *   "requires": [{ "key": "invoices", "range": ">=1.1.0",
 *                  "reason": { "en-US": "Proposals, invoices and receipts are made by this add-on." } }],
 *   "suggests": [{ "key": "holiday-calendars", "range": ">=1.1.0", "checked": true,
 *                  "reason": { "en-US": "Marks public holidays as days off." } }],
 *   "features": [{ "id": "capacity-holidays", "label": { "en-US": "Holidays in Capacity" },
 *                  "requires": ["holiday-calendars"] }]
 * }
 * ```
 *
 * Installing the app installs (or connects) every add-on it `requires`,
 * before its own tables; one that is missing and cannot be had refuses the
 * install before anything is written, and an add-on an installed app
 * requires cannot be removed. A `suggests` entry is offered with the app,
 * ticked when `checked`. A `feature` names what stops working without its
 * add-ons, so a page may say `"feature": "<id>"` and stay hidden until they
 * are there.
 *
 * Every `range` is a semver range over the add-on's version (`>=1.1.0`,
 * `^1.1.0`); the reasons and labels are in every language the app speaks,
 * US English always among them.
 */
import { z } from 'zod';

import { labelsSchema, type ReferenceIssue } from './refs.ts';
import { parseSemverRange } from './semver.ts';

const addOnKeySchema = z.string().regex(/^[a-z][a-z0-9-]{1,79}$/, 'an add-on key');

const rangeSchema = z
  .string()
  .min(1)
  .max(120)
  .refine((range) => parseSemverRange(range) !== null, { message: 'a semver range such as ">=1.1.0" or "^1.1.0"' });

const needSchema = z.object({ key: addOnKeySchema, range: rangeSchema, reason: labelsSchema }).strict();

export const addOnsSchema = z
  .object({
    requires: z.array(needSchema).min(1).max(8).optional(),
    suggests: z.array(needSchema.extend({ checked: z.boolean().optional() }).strict()).min(1).max(8).optional(),
    features: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/, 'a feature id is kebab-case'),
            label: labelsSchema,
            requires: z.array(addOnKeySchema).min(1).max(4),
          })
          .strict(),
      )
      .min(1)
      .max(16)
      .optional(),
  })
  .strict();
export type AddOnNeeds = z.infer<typeof addOnsSchema>;

/** The add-ons an app names at all: required first, then suggested. */
export function namedAddOns(needs: AddOnNeeds | undefined): { key: string; need: 'requires' | 'suggests' }[] {
  return [
    ...(needs?.requires ?? []).map((n) => ({ key: n.key, need: 'requires' as const })),
    ...(needs?.suggests ?? []).map((n) => ({ key: n.key, need: 'suggests' as const })),
  ];
}

/** Whether the app requires this add-on (so it is always there when the app runs). */
export function requiresAddOn(needs: AddOnNeeds | undefined, key: string): boolean {
  return (needs?.requires ?? []).some((n) => n.key === key);
}

/** Everything wrong with an app's `addOns` and the pages that name a feature. */
export function addOnNeedsIssues(m: {
  key: string;
  addOns?: AddOnNeeds | undefined;
  pages?: readonly { feature?: string | undefined }[] | undefined;
}): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  const needs = m.addOns;
  const seen = new Map<string, string>();
  for (const list of ['requires', 'suggests'] as const) {
    (needs?.[list] ?? []).forEach((need, i) => {
      const at = ['addOns', list, i, 'key'];
      if (need.key === m.key) out.push({ path: at, message: 'an app does not need itself' });
      const earlier = seen.get(need.key);
      if (earlier !== undefined) out.push({ path: at, message: `"${need.key}" is already named in ${earlier}` });
      seen.set(need.key, list);
    });
  }
  const features = new Set<string>();
  (needs?.features ?? []).forEach((feature, f) => {
    if (features.has(feature.id)) out.push({ path: ['addOns', 'features', f, 'id'], message: `"${feature.id}" is declared twice` });
    features.add(feature.id);
    feature.requires.forEach((key, k) => {
      if (!seen.has(key)) {
        out.push({ path: ['addOns', 'features', f, 'requires', k], message: `"${key}" is neither required nor suggested by the app` });
      }
    });
  });
  (m.pages ?? []).forEach((page, p) => {
    if (page.feature !== undefined && !features.has(page.feature)) {
      out.push({ path: ['pages', p, 'feature'], message: `"${page.feature}" is not one of the app's addOns.features` });
    }
  });
  return out;
}
