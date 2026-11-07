/*
 * VENDORED VERBATIM from packages/manifest/src/instance.ts.
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
 * `instance` — the part of a self-made app that is the whole deployment's.
 *
 * A dashboard is saved with its look: the name and mark on the menu, the
 * colours, which languages are on, the wording somebody changed, the system
 * emails somebody edited, and a few plain settings. None of it is an app's;
 * all of it is applied to the target as a whole, only when the person
 * installing ticks it (off by default), and only by someone who may change
 * the server's settings.
 *
 * What it never carries: any part of a secret setting (the mail server, the
 * assistant's key), people, keys or rows. Settings are an allow-list, so a
 * setting not on it is refused by name, whatever it holds.
 *
 * Files (the logo, the favicon) are package files, named by their path and
 * their sha256, so the target uses exactly the bytes that were saved.
 *
 * Read here; applied by the engine under its own guards (a diff of each
 * edited email with every link host, one transaction, the values it replaced
 * kept for an undo).
 */
import { z } from 'zod';

import { emailContentSchema } from './outbox.ts';

const LOCAL_PUBLISHER_ID = 'local';

/** A language as Adminium keeps it (`en_US`, `pt_BR`). */
const localeIdSchema = z.string().regex(/^[a-z]{2,3}(_[A-Za-z0-9]{2,8}){0,2}$/, 'a language id such as "en_US"');

/** A file of the package, by its relative path, with the sha256 of its bytes. */
export const instanceFileSchema = z
  .object({
    file: z
      .string()
      .min(1)
      .max(200)
      .regex(/^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9._/-]+$/, 'a file of the package, by its relative path'),
    sha256: z.string().regex(/^[0-9a-f]{64}$/, 'the sha256 of the file, in lower-case hex'),
  })
  .strict();

/**
 * The system emails Adminium sends itself, each of which a person may edit
 * (the engine's `BUILTIN_EMAIL_TEMPLATE_KEYS`; a server test keeps the two
 * lists the same).
 */
export const INSTANCE_SYSTEM_EMAIL_KEYS = [
  'password-reset',
  'user-invite',
  'notification',
  'document-ready',
  'booking-confirmation',
  'sign-in-code',
  'email-changed',
  'sign-in-link',
  'details-deleted',
  'payment-link',
  'payment-receipt',
  'sign-up-confirm',
] as const;

/**
 * The settings `instance` may carry: plain, portable words of the business,
 * none of them secret (a server test checks each against the registry).
 */
export const INSTANCE_SETTING_KEYS = ['assistant.name', 'privacy.businessName', 'privacy.noticeUrl', 'email.postalAddress'] as const;

export const instanceSchema = z
  .object({
    /** The menu's name and mark, and the look everybody starts with. */
    branding: z
      .object({
        appName: z.string().min(1).max(60).optional(),
        showVersion: z.boolean().optional(),
        theme: z.enum(['light', 'dark', 'system']).optional(),
        accent: z.enum(['indigo', 'blue', 'teal', 'violet', 'rose', 'red', 'orange', 'black']).optional(),
        density: z.enum(['comfortable', 'compact']).optional(),
        logo: instanceFileSchema.optional(),
        favicon: instanceFileSchema.optional(),
      })
      .strict()
      .optional(),
    /** The languages switched on, and the one everybody starts in. */
    languages: z
      .object({
        enabled: z.array(localeIdSchema).min(1).max(40),
        default: localeIdSchema.optional(),
      })
      .strict()
      .optional(),
    /** Words of the interface somebody changed: a blank value is a word left out on purpose. */
    wording: z
      .array(
        z
          .object({
            locale: localeIdSchema,
            namespace: z.string().regex(/^[a-z][A-Za-z0-9-]{0,39}$/, 'a wording namespace'),
            key: z.string().regex(/^[A-Za-z0-9_.-]{1,200}$/, 'a wording key'),
            value: z.string().max(4000),
          })
          .strict(),
      )
      .min(1)
      .max(5000)
      .optional(),
    /** System emails somebody edited, one language each. */
    systemEmails: z
      .array(
        z
          .object({
            key: z.enum(INSTANCE_SYSTEM_EMAIL_KEYS),
            locale: localeIdSchema,
            content: emailContentSchema,
          })
          .strict(),
      )
      .min(1)
      .max(INSTANCE_SYSTEM_EMAIL_KEYS.length * 40)
      .optional(),
    /** Plain settings of the business, from the allow-list only. */
    settings: z
      .object({
        'assistant.name': z.string().min(1).max(40).optional(),
        'privacy.businessName': z.string().trim().min(1).max(120).optional(),
        'privacy.noticeUrl': z.url({ protocol: /^https$/ }).max(500).optional(),
        'email.postalAddress': z.string().trim().min(1).max(300).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((instance) => Object.values(instance).some((part) => part !== undefined), { message: 'an instance part carries something' });
export type InstancePart = z.infer<typeof instanceSchema>;

interface Issue {
  path: (string | number)[];
  message: string;
}

/** Everything wrong with an app's `instance` part that its shape alone cannot see. */
export function instanceIssues(m: { publisher: { id: string }; instance?: InstancePart | undefined }): Issue[] {
  const out: Issue[] = [];
  const part = m.instance;
  if (part === undefined) return out;
  if (m.publisher.id !== LOCAL_PUBLISHER_ID) {
    out.push({ path: ['instance'], message: `"instance" is carried only by a self-made app (publisher "${LOCAL_PUBLISHER_ID}")` });
  }
  const languages = part.languages;
  if (languages !== undefined) {
    if (new Set(languages.enabled).size !== languages.enabled.length) out.push({ path: ['instance', 'languages', 'enabled'], message: 'a language is named once' });
    if (languages.default !== undefined && !languages.enabled.includes(languages.default)) {
      out.push({ path: ['instance', 'languages', 'default'], message: `"${languages.default}" is not one of the languages switched on` });
    }
  }
  const words = new Set<string>();
  (part.wording ?? []).forEach((word, w) => {
    const id = `${word.locale}\u0000${word.namespace}\u0000${word.key}`;
    if (words.has(id)) out.push({ path: ['instance', 'wording', w], message: `"${word.namespace}.${word.key}" in ${word.locale} is changed twice` });
    words.add(id);
  });
  const emails = new Set<string>();
  (part.systemEmails ?? []).forEach((email, e) => {
    const id = `${email.key}\u0000${email.locale}`;
    if (emails.has(id)) out.push({ path: ['instance', 'systemEmails', e], message: `"${email.key}" in ${email.locale} is edited twice` });
    emails.add(id);
  });
  return out;
}
