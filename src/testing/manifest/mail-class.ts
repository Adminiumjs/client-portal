/*
 * VENDORED VERBATIM from packages/manifest/src/mail-class.ts.
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
 * MARKETING OR SERVICE: which of an app's mails the do-not-email list stops.
 *
 * Mail to a contact is one of two classes. `marketing` (a newsletter, a
 * thank-you that gives a code for the next order) is stopped for an address
 * on the install's do-not-email list and carries an unsubscribe link.
 * `service` (a quote, a booking confirmation, a receipt, a sign-in link) is
 * never stopped: a person who said no to marketing still gets their receipt.
 *
 * An app says the class of each outbox kind (`outbox.classes`) and of each
 * rule's e-mail to the record's own address (`class` on a `field` step).
 * From {@link MAIL_CLASS_FLOOR} on it must say it of every one: the validator
 * refuses a gap, so no mail is silently either. A manifest built for an older
 * Adminium says nothing, and its mail reads as service, which is how it
 * behaved when it was built.
 *
 * Mail to staff is a third answer, `staff`: a rule's e-mail to the person a
 * staff column names (`staff`) or to the people a listing names (`listed`),
 * and the engine's own digests and notices. It has no class and is never
 * stopped: a staff member who unsubscribed from a newsletter still gets the
 * day sheet. So is an outbox kind sent only to the house: every producer of
 * it sends to an address a setting holds (the studio's own). Such a kind
 * needs no class, and one it says is taken (service is never stopped either).
 *
 * Every other kind is mail to a contact and says its class: to the outbox's
 * person, to a supplier, to an address somebody typed (a friend a ticket is
 * offered to, a copy of a signed sheet), and a kind sent only by hand.
 *
 * Pure; it reads the typed manifest and imports only types.
 */
import type { ManifestAction, ManifestAutomation } from './automations.ts';
import type { Outbox } from './outbox.ts';
import { compareSemver } from './semver.ts';

import type { MailClass } from './mail-classes.ts';

export { MAIL_CLASSES, type MailClass } from './mail-classes.ts';

/** What `mailClassOf` answers: a class, or `staff` for mail to staff that has none. */
export type MailClassAnswer = MailClass | 'staff';

/** The first Adminium that reads the classes, and from which a manifest must say every one. */
export const MAIL_CLASS_FLOOR = '0.3.38';

/** What `mailClassOf` reads of a manifest. */
export interface MailClassManifest {
  outbox?: Pick<Outbox, 'kinds' | 'classes' | 'producers'> | undefined;
}

/** Whether a kind goes only to the house: it has producers, and each sends to an address a setting holds. */
export function sentToTheHouse(outbox: Pick<Outbox, 'producers'> | undefined, kind: string): boolean {
  const producers = (outbox?.producers ?? []).filter((producer) => producer.kind === kind);
  return producers.length > 0 && producers.every((producer) => producer.recipient !== undefined && 'setting' in producer.recipient);
}

type EmailStep = Extract<ManifestAction, { kind: 'email' }>;

/**
 * The class a mail is sent as: an outbox kind's, or a rule's e-mail step's.
 * A kind or a contact-addressed step that says none (a manifest for an older
 * Adminium) is `service`; a step to staff is `staff`.
 */
export function mailClassOf(manifest: MailClassManifest, of: { outboxKind: string } | { step: Pick<EmailStep, 'to' | 'class'> }): MailClassAnswer {
  if ('step' in of) {
    if (of.step.to.kind !== 'field') return 'staff';
    return of.step.class ?? 'service';
  }
  return manifest.outbox?.classes?.[of.outboxKind] ?? (sentToTheHouse(manifest.outbox, of.outboxKind) ? 'staff' : 'service');
}

/** Every e-mail step of a rule, with the path it is written at. */
function emailSteps(rule: ManifestAutomation, r: number): { step: EmailStep; path: (string | number)[] }[] {
  const out: { step: EmailStep; path: (string | number)[] }[] = [];
  const walk = (nodes: readonly unknown[], path: (string | number)[]): void => {
    nodes.forEach((node, n) => {
      const one = node as { kind?: string; action?: ManifestAction; branches?: readonly { nodes: readonly unknown[] }[] };
      if (one.kind === 'action' && one.action?.kind === 'email') out.push({ step: one.action, path: [...path, n, 'action'] });
      (one.branches ?? []).forEach((branch, b) => walk(branch.nodes, [...path, n, 'branches', b, 'nodes']));
    });
  };
  walk(rule.graph.nodes, ['automations', r, 'graph', 'nodes']);
  return out;
}

/**
 * From {@link MAIL_CLASS_FLOOR} on, a gap is refused: every outbox kind but one sent only to the house, and
 * every rule's e-mail to the record's own address, says `marketing` or
 * `service`. Below it nothing is asked (and a class may not be written at
 * all: the floor rule asks for the floor first).
 */
export function mailClassFloorIssues(m: {
  compatibility: { minAdminiumVersion: string };
  outbox?: Pick<Outbox, 'kinds' | 'classes' | 'producers'> | undefined;
  automations?: readonly ManifestAutomation[] | undefined;
}): { path: (string | number)[]; message: string }[] {
  if (compareSemver(m.compatibility.minAdminiumVersion, MAIL_CLASS_FLOOR) < 0) return [];
  const out: { path: (string | number)[]; message: string }[] = [];
  const floor = `compatibility.minAdminiumVersion is ${m.compatibility.minAdminiumVersion}`;
  for (const kind of Object.keys(m.outbox?.kinds ?? {})) {
    if (m.outbox?.classes?.[kind] === undefined && !sentToTheHouse(m.outbox, kind)) {
      out.push({ path: ['outbox', 'classes'], message: `the outbox's kind "${kind}" says no class, and ${floor}: say "marketing" or "service" for it in outbox.classes` });
    }
  }
  (m.automations ?? []).forEach((rule, r) => {
    for (const { step, path } of emailSteps(rule, r)) {
      if (step.to.kind === 'field' && step.class === undefined) {
        out.push({ path: [...path, 'class'], message: `the rule "${rule.key}" mails the record's own address and says no class, and ${floor}: say "marketing" or "service"` });
      }
    }
  });
  return out;
}
