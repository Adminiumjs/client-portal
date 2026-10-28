/**
 * The studio's clients, as Adminium is told of them (the manifest's `people`).
 *
 * Not the `people` TABLE (`tables.ts`): that table is the studio's own team,
 * the names a project's lead and its time are kept against. The manifest word
 * `people` is unrelated to it: it says which table holds the people the
 * studio writes to, and where else they are copied. That table is `clients`.
 *
 * A client is a person at a company: their address is the one the outbox
 * writes to and the one their emailed sign-in link goes to; their name is the
 * contact the desk keeps (the company is the client's own name, not theirs);
 * their language is the one they are written to in. A mail's first name is
 * the first word of the contact's name.
 *
 * There is no consent column: the studio sends no newsletter, and every
 * email is about the client's own proposals, work and invoices. Nor is there
 * a customer column or an opt-out mark: everyone on file is a client.
 *
 * A client is also copied beside their record, each copy declared so that
 * finding, exporting and erasing a person reaches it:
 *
 *   - an enquiry keeps the name and address its sender typed (or the desk took
 *     from a call), and links to the client the Composer made of it;
 *   - a signed proposal keeps the name typed to sign it and the address the
 *     client was signed in with;
 *   - work approved and notes written on the clients' side keep the contact's
 *     name, as the client was signed in (a studio member's own name, when the
 *     desk marked it or wrote it).
 *
 * The proposals are a contract the law keeps (`keep` on their table): an
 * erasure leaves them, the copies on them included, as they are.
 */
export const PEOPLE = [
  {
    table: "clients",
    kind: "people",
    email: "email",
    name: "contact_name",
    firstName: "firstWordOfName",
    language: "language",
    copies: [
      { table: "enquiries", column: "name", holds: "name", via: "client_id" },
      { table: "enquiries", column: "email", holds: "email", via: "client_id" },
      { table: "proposals", column: "signed_name", holds: "name", via: "client_id" },
      { table: "proposals", column: "signed_email", holds: "email", via: "client_id" },
      { table: "deliverables", column: "approved_by", holds: "name", via: "client_id" },
      { table: "deliverable_notes", column: "author", holds: "name", via: "client_id" },
    ],
  },
];
