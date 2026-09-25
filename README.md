# Client Portal

A studio's desk and a portal for its clients, installed by
[Adminium](https://adminium.dev) onto your own database. The studio writes a
proposal; the client reads it, accepts it and signs it; a project starts; the
client reviews the work and approves it; the invoices go out, the reminders
wait for a nod, and the client sees their statement and receipts. Every row
lives in your database, and every figure on every screen is one Adminium
stored.

The app is built on the **Invoices & Receipts** add-on. Its proposals and
invoices are the add-on's quote and invoice shapes, and the proposals,
invoices, receipts and statements a client prints are the add-on's own
documents. So the app **requires** that add-on: installing the app installs
(or connects) it first, and it cannot be removed while the app is installed.

The sample studio is **Outline**, a fictional two-person brand-design studio,
so the proposals, projects and invoices read like a quarter already in motion
rather than lorem ipsum.

**Live demo → [adminium.dev/demo/client-portal](https://adminium.dev/demo/client-portal)**

## What it needs

- **Adminium 0.3.3 or later.**
- **Invoices & Receipts 1.0.5 or later**, which installs with the app.
- A database on **SQLite, Postgres or MySQL**. The app creates its own tables
  there, under names Adminium gives them.
- **Email delivery** and **file storage** set up in Adminium. The app sends its
  emails through the first and keeps deliverables and handover files in the
  second.

## What it does

- **Two sides, two bundles.** The studio's **desk** and the **clients' side**
  are built separately, and the clients' bundle, which anyone on the internet
  can load, carries no desk screen at all. A test builds both and checks.
  The desk opens on its own address by default; an operator can move it inside
  Adminium's dashboard instead, where its own sidebar and header give way to
  the dashboard's.

- **The studio's desk.**
  - **Home**: the day in one sentence, what is owed, what is late and the
    work running, the open balances by how late they are, what happened
    lately, what is waiting on a client, and what falls due this week.
  - **Enquiries**: the inbox of people who asked about work. Start a
    proposal, send a reply drafted from the enquiry, park it for a month, or
    say a polite no. "Log a call" adds one by hand.
  - **Proposals** and the **Composer**: a proposal or an invoice written in
    one place, with its scope, its lines and a rail showing the figures while
    you type.
  - **Projects**: a board of running, paused and finished work. Each project
    has its milestones, its deliverables and the client's brief. The
    **deliverable review** shows the file with pins dropped on it, versions
    one at a time or two side by side, and the notes both sides wrote. The
    **handover** is one share link for a finished project, with every file
    (downloadable as one zip), the fonts licensed in the client's name, and
    notes for the next print run.
  - **Clients**: every client as a card, and each client's record: what is
    open and overdue, what they have paid, how fast they pay, private notes,
    every document, and their side of the portal to preview read-only.
  - **Invoices**: six filters (All, Open, Overdue, Draft, Paid, Void). Record
    a payment, including a part payment. A studio manager may void an unpaid
    invoice or a recorded payment.
  - **Chasing**, with held reminders. Every sent invoice gets three
    reminders, each due on its day of the invoice's ladder, and **none goes
    out until someone approves it**. Each one can be edited while it waits,
    sent early or skipped. A later reminder replaces an earlier one still
    waiting, and paying or voiding the invoice drops them. Sending the third
    pauses the project, as the terms the client agreed to say.
  - **Printed copy**: an invoice, proposal, receipt or statement as the
    client receives it, drawn by the add-on, on Letter or A4.
  - **Terms & signature**: accepted is not the same as signed. Who agreed,
    when, against which terms version, and the fingerprint Adminium stored.
    Terms are versioned, and a version is locked once a proposal naming it is
    sent.
  - **Settings** (studio manager only): the studio, the people clients deal
    with, the email sign-off, which notices the studio gets, the add-on's own
    invoice settings, and the rate card.

- **The clients' side.**
  - **Sign in by an emailed link or code.** The client types the address the
    studio writes to, and the page gives the same answer whatever they typed,
    so it never tells anyone whether an address belongs to a client. The
    email carries a link and a six-digit code for opening it on another
    device. The link only signs someone in when they press Continue, so a
    mail scanner that follows it spends nothing.
  - **Their proposals**: accept and sign by typing their name against the
    terms version the proposal names, decline with a note, or ask for a new
    price on one that is out of date.
  - **Their projects and the review**: milestones, and the work shared with
    them. They can open a file, write back, approve it, or ask for changes.
  - **Their invoices**: the lines, the payments so far, the balance, how to
    pay, and "I've sent a payment" to tell the studio.
  - **Statement & receipts**: everything invoiced and paid over a period,
    with a receipt for each payment.
  - **The brief**: the studio's questions, answered on the client's own
    time, saved as they type.
  - **A shared handover link**: one finished project's files, fonts and notes
    on one page, with no sign-in and nothing else of the client's, until the
    studio stops the link or it runs out.

  Everything a client reads is their own. Another client's document answers
  exactly like one that does not exist.

- **Every figure is Adminium's.** Line amounts, totals, tax, paid, balance,
  document numbers, states, who signed and when, and the fingerprint of what
  they agreed to are all worked out and stored by Adminium. After a write the
  screen reads the document back rather than trusting its own arithmetic. The
  composer's rail does show figures while you type, worked out the same way
  (exact fractions, rounded once), but it never sends them.

- **A write that stops half-way can be finished.** Starting a project writes
  the project, its milestones, the first stage's invoice and its line. If
  that fails part-way, "Finish it" runs the rest, and a retry never writes a
  row twice: every row carries its step's own key.

- **Two roles.** *Studio* runs the desk. *Studio manager* can also change
  the set-up, void, discard a draft and reopen a finished project. The desk
  hides a button by role, but it is Adminium's grant that refuses the write.

- **Nineteen emails, all in the outbox.** The `messages` table is the outbox,
  so every email can be seen, approved, edited, sent early or skipped. The
  notices to the studio each have their own switch in Settings.

- **Live.** A change made on another computer, or by a client on the portal,
  reaches the desk as it happens.

- **An Overview page of widgets** inside Adminium's dashboard: 23 cards drawn
  by Adminium's own widgets from the app's tables, showing the money and the
  work, how old the money owed is, what needs someone's attention, six months
  invoiced and collected, and this week's milestones. Every card that leads somewhere
  opens its list already filtered to exactly what the card counts. Beside it
  are record pages for clients, enquiries, proposals, projects,
  deliverables, invoices, payments, emails and the studio's set-up.

- **Sample data, at 28 July.** Outline's six clients and about six months of
  history, added from Adminium (at install, or later from the app's page) and
  removed again. Removing it keeps any sample row your own records depend on.
  Dates are relative to the day the sample is added, so its history keeps its
  shape. The figures are written for, and tested at, Tuesday 28 July 2026,
  which is the demo's day. Sample numbers carry an `S` (`INV-S2039`), so a
  real studio's first invoice is never one of them.

- **Eight languages, including one right-to-left.** English, German, French,
  Czech, Danish, Simplified and Traditional Chinese, and Egyptian Arabic,
  covering the screens, the emails, the dashboard pages' labels and the
  sample itself. Plurals go through `Intl.PluralRules` in each locale's own
  CLDR order.

- **RTL by construction.** Every positional rule is a CSS logical property,
  so in Arabic the layout mirrors while the digits inside a money cell stay
  left-to-right.

- **Light and dark themes**, following the OS at first, with a switch on
  both sides. Inside the dashboard, the dashboard's theme and language win.

- **Self-hosted fonts.** Manrope and JetBrains Mono ship as woff2 in
  `public/fonts/`.

## Installing it

Install Client Portal from Adminium's app catalog and pick the database it
should use. Adminium installs Invoices & Receipts first if it is not there
yet, then creates the app's tables, the Overview and record pages, the two
roles, the clients' browser key and the emails. Tick sample data at the
install step to start with Outline's studio, or add it later.

Once installed, the desk is served at `/apps/clients/staff/` and the clients'
side at `/apps/clients/customer/`. A studio can also give the clients' side a
domain of its own.

**Coming from 0.1.x?** 0.2.0 is a different app on new tables, and it cannot
update a 0.1.x install in place. Uninstall 0.1.x first (its tables stay
unless you choose to drop them), then install 0.2.0. Nothing is carried over
from the old tables.

## The demo

The [website demo](https://adminium.dev/demo/client-portal) runs with no
server. It loads the app's real sample in memory at 10:00 on Tuesday 28 July
2026, and a stand-in plays Adminium's part: the same rules for every write,
the same outbox, the same fingerprints. The demo's card offers:

| Control | What it does |
| --- | --- |
| **Studio / Client** | Switches between the desk and the client's side. The loop closes across it. |
| **Screens** | Jumps to any screen of the side on show. Some carry shortcuts: *The client accepts and signs*, *Part payment*, *Let the link expire* … |
| **Clock** | Moves the day on a week at a time, then puts it back with the sample as it was. |
| **Language** | Eight locales, including Arabic, which flips the layout to RTL. |
| **Theme** | Light or dark. |

The demo's printed copies are the ones the add-on drew at build time, and
nothing it "sends" reaches anyone.

## Local development

```bash
npm install
npm run dev
```

With no Adminium settings, `npm run dev` runs the demo at the URL Vite
prints (default http://localhost:5173). The address can open one screen
directly: `?persona=client&view=home&theme=dark&lang=ar-EG`.

`npm run dev:hosted` serves the desk with hot reload against a local
Adminium, proxying `/api` to `ADMINIUM_DEV_API` (default
`http://127.0.0.1:4600`). Sign in once on Adminium's own address; the
session cookie then works for the dev server too.

| Script | What it does |
| --- | --- |
| `npm run dev` | The demo, with hot reload. |
| `npm run dev:hosted` | The desk against a local Adminium, with hot reload. |
| `npm run build` | Type-check, then build the demo at base `/`. |
| `npm run build:demo` | Type-check, then build the website demo at `/demo/client-portal/app/`, with the card's `demo.json`. |
| `npm run build:surface` | Build both sides as Adminium serves them, into `dist-surface/clients/staff` and `dist-surface/clients/customer` (also `build:surface:staff` and `build:surface:customer`). |
| `npm run preview` | Preview a build locally. |
| `npm test` | The whole suite (Vitest). |
| `npm run manifest` | Rewrite `manifest.json` from `src/manifest/`. |
| `npm run sample` | Rewrite the part of `src/data/sampleRows.ts` that comes from the manifest (each column's default and the rules rows are settled by). |
| `npm run row-types` | Rewrite `src/data/types.ts` from the manifest. |
| `npm run lexicon` / `lexicon:check` | Copy, or check, the release word list the manifest's words are held to (from the add-ons checkout). |

`manifest.json`, `src/data/types.ts` and the manifest-derived part of
`src/data/sampleRows.ts` are written from source, and tests fail when the
checked-in copies drift from it.

### The three-engine contract

`src/contract/contract.test.ts` installs this repo's own manifest and sample
on a **built** Adminium with the Invoices & Receipts add-on, then walks
through the whole contract: install, the sample at 28 July, every invoice's
totals, two payments racing for the same balance, a void and its reminders,
a client signing in by link and accepting a proposal, and the sample
removed. The demo plays the same scenario and is held to the same figures,
so the demo cannot drift from what Adminium does.

It needs two checkouts and skips (saying why) without them:

| Variable | What it points at |
| --- | --- |
| `ADMINIUM_REPO` | An Adminium checkout with its server, dashboard and e2e script built (`pnpm turbo run build --filter="@adminium/e2e..."`). |
| `ADD_ONS_REPO` | An add-ons checkout with Invoices & Receipts built. Defaults to `../add-ons`. |
| `TEST_POSTGRES_URL` | Adds the Postgres run. SQLite always runs. |
| `TEST_MYSQL_URL` | Adds the MySQL run. |

```bash
ADMINIUM_REPO=../adminium ADD_ONS_REPO=../add-ons \
TEST_POSTGRES_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres \
TEST_MYSQL_URL=mysql://root@127.0.0.1:3306 \
npx vitest run src/contract
```

`ADMINIUM_REQUIRE_CONTRACT=1` turns a skip into a failure. CI's `contract`
workflow sets it and runs all three engines, alongside the drift checks for
the copies this repo keeps of other repos' files (the add-on's shapes, the
manifest validator, the word list and the demo's printed copies) and both
surface builds plus the demo. The `ci` workflow builds and runs the suite.

## Project structure

```
src/
  app/         App shell, the route table for both sides, deep links
  screens/     the desk's screens (one file per view) and client/ (the clients' side)
  sheets/      the desk's dialogs: record a payment, start a project, send …
  state/       the desk and portal stores; actions.ts (the desk's writes),
               clientActions.ts (the client's)
  data/        ports.ts (the doors every read and write goes through), sink.ts
               (where the desk's writes go), the Adminium and public-API sources,
               row types written from the manifest, the sample resolver
  manifest/    the typed modules manifest.json is written from
  demo/        the demo's stand-in world, rules, outbox and printed copies
  i18n/        8-locale runtime and strings per area
  components/  the two frames, sheets, toasts, shared pieces
  lib/         the studio's clock, money and dates for display
  styles/      tokens and one stylesheet per area
  contract/    the three-engine contract and its harness
  testing/     shared test helpers and the vendored manifest validator
seeds/         clients.sample.json, the sample Adminium adds
scripts/       manifest, sample and row-type writers, sync checks, release
public/fonts/  self-hosted Manrope + JetBrains Mono (woff2)
```

## License

[AGPL-3.0](LICENSE) © 2026 Client Portal. An example app for Adminium.
