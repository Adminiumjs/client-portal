/*
 * VENDORED VERBATIM from packages/add-on-contracts/src/add-on-block.ts.
 * Never hand-edit this copy: change the monorepo package and re-run
 * `node scripts/sync-manifest-validator.mjs`.
 *
 * WHY A COPY. `@adminium/manifest` is not published to npm and this app is a
 * standalone repo that must build from a clean clone, so it cannot depend on
 * the monorepo. It lives under `testing/` because `zod` is a devDependency
 * here and a runtime dependency the host does not carry (24 D7) — nothing in
 * the shipped bundle's import graph may reach it, which sources.test.ts gates.
 *
 * The only edits are import specifiers: `.js` becomes `.ts`, and the
 * `@adminium/add-on-contracts` package import becomes relative ones.
 */
/**
 * The `addOn` manifest block (24-marketplace-wave-4.md §5.3) and its validation
 * rules. Lives here rather than in `@adminium/manifest` because the rules are
 * assertions ABOUT the registries in this package — a slot id or a contract id
 * is only meaningful against the closed lists in `slots.ts` / `contracts.ts`.
 *
 * `@adminium/manifest` imports this to build the `kind: "add-on"` branch of its
 * discriminated union.
 */

import { z } from 'zod';

import { contractIdSchema, hasContractVersion } from './contracts.ts';
import { slotIdSchema } from './slots.ts';

/**
 * Add-ons get their OWN closed category vocabulary (D2), because an add-on is
 * not a vertical and forcing it into the app facet set would make a carrier a
 * "commerce" product. Wave 4 uses two of the five; the other three exist so a
 * second add-on wave does not have to reopen the vocabulary.
 */
export const ADD_ON_CATEGORIES = ['artwork', 'delivery', 'payments', 'email', 'data'] as const;
export const addOnCategorySchema = z.enum(ADD_ON_CATEGORIES);
export type AddOnCategory = (typeof ADD_ON_CATEGORIES)[number];

/** How the shop supplies credentials, if at all (§5.6). */
export const CONNECT_KINDS = ['none', 'api-key', 'oauth2'] as const;
export const connectKindSchema = z.enum(CONNECT_KINDS);
export type ConnectKind = (typeof CONNECT_KINDS)[number];

const SEMVER_RANGE = /^[\^~]?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$|^\*$/;

/**
 * Exact hostname — no wildcards, no bare IPs, no ports, no scheme (D14).
 *
 * The final label is alphabetic on purpose: it is what makes `203.0.113.10`
 * fail. Every real TLD is alphabetic, and an egress allow-list that quietly
 * accepts a literal IP is an allow-list with a hole in it.
 */
const HOSTNAME = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*\.[a-z]{2,63}$/;

export const attachTargetSchema = z
  .object({
    /** A known app key, or `"*"` when the contract is not host-specific. */
    app: z.union([z.literal('*'), z.string().regex(/^[a-z][a-z0-9-]{1,79}$/)]),
    range: z.string().regex(SEMVER_RANGE, 'range must be a simple semver range or "*"').optional(),
    /** Only for `record.editor.panel`: which host tables the panel mounts on. */
    table: z.string().regex(/^[a-z][a-z0-9_]*$/).optional(),
  })
  .strict();

export const providesSchema = z
  .object({
    contract: contractIdSchema,
    version: z.number().int().positive(),
    server: z.string().min(1),
  })
  .strict();

export const consumesSchema = z
  .object({
    contract: contractIdSchema,
    version: z.number().int().positive(),
  })
  .strict();

export const slotFillSchema = z
  .object({
    slot: slotIdSchema,
    client: z.string().min(1),
    order: z.number().int(),
  })
  .strict();

export const addOnEventSchema = z
  .object({
    on: z.string().min(1).max(80),
    server: z.string().min(1),
  })
  .strict();

export const addOnConnectSchema = z
  .object({
    kind: connectKindSchema,
    authorizeUrl: z.url().optional(),
    tokenUrl: z.url().optional(),
    scopes: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const addOnNetworkSchema = z
  .object({
    allow: z.array(z.string().regex(HOSTNAME, 'must be an exact https hostname')),
  })
  .strict();

export const addOnBlockSchema = z
  .object({
    attaches: z.array(attachTargetSchema).min(1),
    provides: z.array(providesSchema).optional(),
    consumes: z.array(consumesSchema).optional(),
    slots: z.array(slotFillSchema).optional(),
    events: z.array(addOnEventSchema).optional(),
    connect: addOnConnectSchema,
    /** Grants over host + own tables, checked against SCOPE_OUT_OF_RANGE. */
    scopes: z.array(z.string().min(1)).optional(),
    network: addOnNetworkSchema.optional(),
    /** D15 — the only settings the client bundle may read. */
    publicSettings: z.array(z.string().min(1)).optional(),
    /** D11 — required to ship a demo that makes no real third-party call. */
    demoTransport: z.string().min(1).optional(),
  })
  .strict()
  // Every `provides[].contract` must be in the registry AT the declared version.
  .refine((b) => (b.provides ?? []).every((p) => hasContractVersion(p.contract, p.version)), {
    message: 'CONTRACT_UNKNOWN: a provided contract is not in the registry at that version',
    path: ['provides'],
  })
  .refine((b) => (b.consumes ?? []).every((c) => hasContractVersion(c.contract, c.version)), {
    message: 'CONTRACT_UNKNOWN: a consumed contract is not in the registry at that version',
    path: ['consumes'],
  })
  // §5.6 — an oauth2 connect must name where it authorizes.
  .refine(
    (b) =>
      b.connect.kind !== 'oauth2' ||
      (b.connect.authorizeUrl !== undefined && b.connect.tokenUrl !== undefined),
    {
      message: 'an oauth2 connect must declare authorizeUrl and tokenUrl',
      path: ['connect'],
    },
  );

export type AddOnBlock = z.infer<typeof addOnBlockSchema>;

/** Issue codes the validators emit (13 §3.2 convention, extended by 24 §5.3). */
export const ADD_ON_ISSUE_CODES = [
  'ATTACH_TARGET_UNKNOWN',
  'SLOT_UNKNOWN',
  'CONTRACT_UNKNOWN',
  'SCOPE_OUT_OF_RANGE',
  'NETWORK_ALLOW_REQUIRED',
  'CAPABILITY_CONFLICT',
  'FRONTEND_SECRET_LEAK',
  'SLOT_CONFLICT',
] as const;
export type AddOnIssueCode = (typeof ADD_ON_ISSUE_CODES)[number];
