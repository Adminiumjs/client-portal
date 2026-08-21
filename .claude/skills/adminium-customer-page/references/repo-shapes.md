# What the fifteen repos actually look like

Findings from reading all fifteen. Check the repo in front of you rather than assuming — but
these are the shapes you will meet, and the traps are real ones somebody already hit.

## The data seam is not what its own header says

Every repo has `src/data/source.ts` exporting a `DataSource`, and every header claims
connecting is "a change to ONE file". Measured across the fleet, that is false:

- **twelve of fifteen bypass it** — screens import `src/data/demo.ts` directly, from two
  files in the tidiest repo to twenty in `support-desk`;
- **three have it orphaned** with no importers at all (`sales-crm`, `people-ops`,
  `client-portal`);
- **all fifteen are fully synchronous**, and several are called at *module scope*, so a
  network source cannot simply be dropped in.

**What to do:** read through `source.ts`. Never add an import of `demo.ts` to a screen. If
the page needs data the seam does not expose, add a method to the seam.

**Reads do not have to become async.** The working pattern is to fetch the whole read-set
once, before React mounts, and hand the store the same synchronous shapes it already reads —
then nothing below the seam changes. Only writes become async, and writes are already event
handlers.

## Demo mode and connected mode

One condition decides it: whether the API base URL and key are present at build time. The
hosted marketplace demos set neither and must keep working — they are static bundles with no
server behind them.

Anything that only makes sense in one mode (a demo dock, a "card will decline" cheat) must be
gated on that same single condition. Do not introduce a second flag; two sources of truth
drift.

## Two i18n layouts

Fourteen repos use `src/i18n/messages/<locale>.ts` with area files under `src/i18n/strings/`.
`point-of-sale` uses one file per locale. Look before you write.

Three rules that are not obvious:

1. **Non-English locales are typed against the English keys.** A key present in English and
   missing elsewhere is a *compile error*, not a soft fallback. Adding a key means touching
   every locale.
2. **Pasting the English text is the convention for untranslated strings** — but it is
   **invalid for ICU plurals**, because plural categories belong to the language. Chinese has
   no `one` category, so `{count, plural, one {# item} other {# items}}` pasted into `zh-CN`
   fails validation. Paste the English *text*; keep the target's *category set*.
3. `maker-shop` additionally fails when more than 4% of its keys equal their English, so
   pasting is not available there at all.

## i18n keys stored as data

Ten repos store i18n **keys** as values inside `demo.ts` — `"data.type.routine"` rather than
`"Routine check"` — and the screens pass them to `t()`. A real database row holds the
operator's own text instead.

So a connected page can end up rendering an English title above a translated description, in
one card. If you meet a field like this, say so rather than papering over it: whether the
column or the catalogue is authoritative is a decision, and it is per column.

## The id space

`db/seed.sql` uses integer primary keys; `src/data/demo.ts` uses string slugs (`"routine"`,
`"amara"`) in thirteen repos. Every keyed lookup breaks against real rows.

`maker-shop` and `print-shop` are the two that generate their SQL from the TypeScript, and
`factory-ops` carries the app's identifiers verbatim as text primary keys — that is the
pattern worth copying.

## Two repos ban network calls outright

`maker-shop` and `print-shop` enforce an egress gate that bans the *means of sending* —
`fetch(`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon` — across sources *and*
built output, independently of any address.

Adding an allowed origin does not help. Making a request from those two repos requires
changing the gate deliberately, in review. **Do not delete the gate to make a page work.**

## Configuration with nowhere to live

None of the fifteen has a settings table. Tax rates, opening hours, cutoffs, currency,
addresses, brand names — all constants in the bundle. Two schemas even reference a setting
their author never created.

If your page needs one of these, it is not a page problem. Flag it.

## Things that are correct and worth copying

- `factory-ops` has the best time model in the fleet: dates as dates, times as
  minutes-since-midnight, and a schema comment explaining why.
- `hotel-reservations` and `people-ops` made the same choice deliberately.
- `bom_lines` in `factory-ops` is the fleet's model child table: a unique constraint *and* a
  `position` column, so ordering survives.
