---
name: adminium-customer-page
description: Add a customer-facing or staff-facing page to an Adminium micro-SaaS app, wired to the scoped public API rather than to demo data. Use when someone wants to build, add, or connect a page in one of the Adminium marketplace apps (point-of-sale, clinic-desk, booking-scheduler, ecommerce-storefront and the rest), or asks how to let their customers book, order, track or submit something against their own database.
license: AGPL-3.0-only
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/compile-surface.mjs), Bash(${CLAUDE_SKILL_DIR}/scripts/verify.sh)
---

# Adminium customer page

Add one page to an Adminium micro-SaaS app and wire it to the scoped public API.

An Adminium micro-SaaS has up to three sides. The **dashboard** is mandatory and you never
build it — it comes from Adminium introspecting the database. The **staff** and **customer**
sides live in the app repo, and at least one must exist. This skill adds a page to one of
those two.

## Before anything else

**Run the surface compiler. Do not skip this and do not proceed if it fails.**

```bash
${CLAUDE_SKILL_DIR}/scripts/compile-surface.mjs
```

It reads the repo's `manifest.json` and prints the resources, columns and row types the page
may use. If the manifest does not validate, **stop and say so** — every line you would write
after that point is a guess about a schema you have not seen. Fixing the manifest is the
task; the page is not.

Two of the fifteen repos (`factory-ops`, `hotel-reservations`) have contract manifests with
no `pages` block. There the compiler will tell you what is missing, and authoring it is the
job before this one.

## What to ask

Ask these before writing anything. Each one changes the code.

1. **Which journey?** "Book a visit", "track my order", "submit a ticket". One journey, one
   page. If the answer is three journeys, build the first and say so.
2. **Which side — staff or customer?** It decides which `frontends[]` entry the page joins
   and therefore which publishable key it uses. A page cannot straddle both: a staff key and
   a customer key differ in scope, and one bundle cannot hold two keys.
3. **Which resources and columns?** Only what the compiler printed. If the page needs a
   column the scope does not expose, the scope has to change first — that is an operator
   decision, made in **Studio → Public API**, not something the page can route around.
4. **Does it need to know who the visitor is?** If it shows anything belonging to one person,
   it needs a claim. Ask which two facts identify them. If the data is medical, financial or
   otherwise sensitive, say plainly that reference-lookup is not enough for it.
5. **Does the journey compute money, hold stock, or take payment?** If yes, **stop**. The
   public API deliberately cannot do that — see *What this cannot do*.

## What to write

Follow the repo's own conventions; read two neighbouring screens before writing a third.

- **One screen module** in `src/screens/`, matching the naming of what is there.
- **The `View` union in `src/data/types.ts`** and the `SCREENS` record in `src/app/App.tsx`.
  These are mapped one-to-one on purpose — adding a view is a compile error until a screen
  exists for it, which is what keeps every link landing somewhere real.
- **Store actions** in `src/state/store.ts` for anything the page writes.
- **Reads through `src/data/source.ts`**, never by importing `src/data/demo.ts`. The seam is
  bypassed in twelve of the fifteen repos already; do not add to that.
- **i18n keys in English only.** Every user-visible string goes through the repo's `t()`.
  Author the English text; do not invent translations. Read `references/repo-shapes.md`
  before touching the locale files — the two i18n layouts differ, and ICU plurals need the
  target language's own category set even when the text stays English.

## Verify before you claim it works

```bash
${CLAUDE_SKILL_DIR}/scripts/verify.sh
```

It runs the repo's own `tsc -b && vite build && vitest run`. A page that has not built is
not a page. If the repo has a dev server, load the screen and read it.

## What this cannot do

Say so plainly rather than working around it.

- **No money.** No computed totals, no inventory decrements, no payment. The public API
  accepts *intent* rows — "this person asked for this" — and a human settles them in the
  dashboard. An app that genuinely needs a transaction uses a small server of its own.
- **No file uploads.** There is no public upload route. An artwork, an attachment or a
  document has nowhere to go yet.
- **No live updates.** Reads are polling. There is no public websocket.
- **No deletes.** The public surface has no delete verb.
- **Nothing outside the scope.** Not a column, not a table, not a filter. The server ignores
  a `select` it did not authorise and refuses a `where` on a column it did not list.

## Reference

- `references/public-api.md` — the endpoints, the query rules, the error codes, and the
  claim/session flow.
- `references/repo-shapes.md` — the two i18n layouts, the data seam, the demo/connected
  switch, and the egress gate that two repos enforce.
