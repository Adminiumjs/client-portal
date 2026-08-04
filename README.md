# Client Portal

A complete, production-shaped client portal and invoicing app — built with
Vite + React + TypeScript, no CSS framework, no backend required. It's an
example app that ships with [Adminium](https://adminium.dev): write a
proposal, watch a client accept it and a project appear, approve a
deliverable, and take a partial payment that moves the studio's outstanding
total the moment it lands.

The demo is dressed as **Outline**, a fictional two-person brand-design
studio, so the proposals, projects and invoices read like a quarter already in
motion rather than lorem ipsum.

**Live demo → [adminium.dev/demo/client-portal](https://adminium.dev/demo/client-portal)**

## What it does

- **Two genuinely different shells.** The demo dock switches between the
  Studio — internal chrome, sidebar, document search — and the Client, who
  gets a minimal centered portal with no sidebar and no view of the studio's
  other work. The loop closes across the switch: accept a proposal as the
  client and the project is on the studio's board.

- **An invoicing engine in integer cents.**
  [`src/lib/invoice.ts`](src/lib/invoice.ts) does every calculation in whole
  cents and divides exactly once, at display. Line totals round at the line;
  tax rounds once on the subtotal. That ordering is why the studio's total and
  the client's total can never disagree by a rounding penny. 43 assertions in
  [`invoice.test.ts`](src/lib/invoice.test.ts) — and not one of them needs a
  floating-point tolerance.

- **Overdue is derived, never stored.** A record carries only
  `draft | sent | paid`. Whether it is late is answered from the pinned clock
  every time it is asked, so moving the clock changes the answer without
  touching the record — and a draft is never overdue however old it gets.

- **A payments ledger with a running balance.** An opening invoice-total row,
  then each payment with date, method and amount, carrying the balance down
  the end column. Partial payments are welcome; overpayment is *refused* with
  the maximum attached rather than silently clamped.

- **A portal gate that tells the truth.** An unknown number, a number that
  belongs to a different email, and a draft the studio has not sent yet each
  get their own honest error — not one generic "not found".

- **Eight languages, including a right-to-left one.** English, German, French,
  Czech, Danish, Simplified and Traditional Chinese, and Egyptian Arabic. The
  seeded fiction — scope paragraphs, line descriptions, milestone names — is
  translated too. Plurals go through `Intl.PluralRules` in each locale's own
  CLDR order.

- **RTL by construction.** Every positional rule is a CSS logical property, and
  money columns use `text-align: end` rather than `right`, so an invoice table
  aligns to the correct edge in Arabic while the digits inside each cell stay
  left-to-right.

- **Light / dark themes**, following the OS on first load with a toggle in
  both shells.

- **A pinned clock.** Nothing reads `Date.now()`. "Now" is Tuesday 28 July
  2026, so every machine sees the same two overdue invoices in the same two
  aging buckets.

- **No bitmaps, no external requests.** Deliverable thumbnails are layered
  gradients with a mono filename chip. Fonts are self-hosted woff2.

## Local development

```bash
npm install
```

```bash
npm run dev
```

Then open the URL Vite prints (default http://localhost:5173).

### Driving the demo

| Control | What it does |
| --- | --- |
| **Studio / Client** | Switches shell *and* persona. The loop closes across it. |
| **Language** | Eight locales, including Arabic, which flips the layout to RTL. |
| **Theme** | Latches light or dark over the OS preference. |
| **Reset** | Puts the seeded documents back the way they started. |

A sixty-second tour: Home → note the two populated aging buckets → switch to
**Client** → tap the `PRO-1145` hint chip → Open it → Accept proposal →
switch to **Studio** → Projects → the project is there. Then Invoices →
`INV-2039` → record a partial payment → the outstanding KPI on Home has moved.

## Deploy

- **Vercel** — import the repo. Build command `npm run build`, output `dist`.
- **DigitalOcean App Platform** — import the repo; same build command.
- **Host anywhere** — `npm run build` produces a static `dist/`. Or:

  ```bash
  docker build -t client-portal .
  ```

### Build scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the Vite dev server. |
| `npm run build` | Type-check + build to `dist/` at base `/`. |
| `npm run build:demo` | Build at base `/demo/client-portal/` (Adminium demo). |
| `npm run preview` | Preview a production build locally. |
| `npm test` | Run the invoicing engine suite. |

## Full implementation (self-host)

There are two ways to run this studio.

**One click — the frontend on its own.** The Vercel / DigitalOcean routes above
deploy the portal by itself, running on the bundled demo studio. No database,
no dashboard — a fully static preview.

**One command — the whole stack.**
[`docker-compose.yml`](docker-compose.yml) stands up Postgres (seeded with the
*same* clients, proposals, projects and invoices), an auto-generated Adminium
dashboard that runs that real database, and the portal:

```bash
cp .env.example .env      # then set ADMINIUM_SECRET — e.g. openssl rand -hex 32
docker compose up
```

- **Client portal** → http://localhost:8080
- **Adminium dashboard** → http://localhost:4600

On first boot, `clients-db` applies [`db/schema.sql`](db/schema.sql) then
[`db/seed.sql`](db/seed.sql), and Adminium imports the studio database as its
first source connection, introspects the schema, and generates the back
office. Finish the ~1-minute first-run wizard at `:4600` — it's pre-pointed at
the seeded studio DB. The install spec Adminium reads to configure itself is
[`manifest.json`](manifest.json).

The seed is the app's own fiction, not a second one: Drift & Fern is still
waiting on round 3 of the logo, `INV-2037` is still 47 days late, and Low
Orbit's $1,200.00 part payment is a row in `payments`. A reader who has used
the portal recognises every record.

The manifest scaffolds 9 tables, 5 dashboard pages, 1 access preset
(`studio-owner`) and 6 settings into your connected database.

## The split: the portal and the back office

| In this app | In the generated dashboard |
| --- | --- |
| Writing and sending a proposal | Every table as records, with full CRUD |
| The client's review, approval and payment | Bookkeeping and reconciliation |
| Project progress and deliverable sign-off | Reporting across the whole history |

## Connecting to Adminium

All data access goes through a thin `DataSource` interface
([`src/data/source.ts`](src/data/source.ts)) with a single `demoSource`
implementation. **Today the deployed demo is demo data only — nothing is
persisted, no card is charged and no email reaches a person.** Once Adminium's
browser-safe publishable key (`adm_pub_…`) ships, a second implementation reads
and writes live data without touching any screen or the store.

### What is deliberately out of scope

- **Real payments.** The card sheet is a visual fiction and says so, verbatim,
  every time it opens.
- **Sending email.** Sending a proposal flips its status and raises a toast
  that admits no message was sent.
- **PDF generation.** Documents render as HTML; export belongs to a later
  phase.
- **Recurring invoices.** They need a job runner this version does not have.

## Project structure

```
src/
  app/         App shell + the exhaustive 12-view switch
  state/       Zustand store (persona, documents, portal gate, toasts)
  data/        demo.ts (the seeded studio), types.ts, source.ts (DataSource seam)
  i18n/        8-locale runtime, locale registry, ambient bridge, strings/
  lib/         invoice.ts (the engine) + tests, format.ts (locale-aware output)
  screens/     Studio.tsx (7 studio views + shared tables), Portal.tsx (4 + 404)
  components/  the two shells, demo dock, overlays, primitives
  styles/      tokens.css (canonical tokens + bronze accent), base.css,
               components.css, screens.css
public/fonts/  self-hosted Manrope + JetBrains Mono (woff2)
```

## License

[AGPL-3.0](LICENSE) © 2026 Client Portal. A demo shipped with Adminium.
