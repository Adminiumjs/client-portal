-- Client Portal — seed data.
--
-- Mirrors src/data/demo.ts one-for-one: the same six clients, the same three
-- proposals and four projects, the same seven invoices down to the cent, and
-- the same three payments. Open the portal and the generated dashboard side by
-- side and they are the same studio — Outline, a fictional two-person
-- brand-design studio.
--
-- The app pins its clock to Tuesday 28 July 2026 and nothing reads the wall
-- clock, so the dates below are the literal dates the app shows. Against that
-- pinned day the aging strip has real shape: INV-2038 is 12 days late and
-- INV-2037 is 47, which lands them in two different buckets; INV-2039 is part
-- paid; INV-2041 is still a draft. Nothing is stored as "late" — see the note
-- on `invoices.status` in schema.sql.
--
-- Money arrives here in dollars and cents because the column is
-- numeric(12, 2); the app holds the same figures as integer cents. 1533.00
-- here is 153_300 there, and both round at the line.
--
-- The app stores translatable prose as an i18n key. A database holds content,
-- not message keys, so every string below is the English text from
-- src/i18n/strings/data.ts.
--
-- Ids are explicit so the rows are stable to reference and stable to diff;
-- each sequence is reset at the end, so the next document the studio writes
-- does not collide with a seeded one.
--
-- Instants are anchored to 09:00 UTC. The app deals in whole days, and 09:00
-- keeps the day unambiguous for a reader whose dashboard renders in almost
-- any zone.
--
-- Everything here is demo fiction: the companies, the people, the amounts and
-- the filenames are props. No property, real-estate or lettings business
-- appears in this client list — that is a standing constraint on the fiction,
-- not an accident.

BEGIN;

-- Clients ---------------------------------------------------------------------
--
-- `created_at` is the first engagement — the "client since" line in the app.
-- The portal never asks a client for a telephone number, so there is none in
-- the app to mirror and the column is left empty rather than invented.

INSERT INTO clients (id, company, contact_name, email, phone, kind, tint, icon, created_at) VALUES
  (1, 'Drift & Fern',        'Amara Osei',      'amara@driftandfern.example',     '', 'Neighbourhood florist',      '#4e8a5f', 'flower-2',     '2024-03-12 09:00+00'),
  (2, 'Cinder & Sage',       'Jonah Marsh',     'jonah@cinderandsage.example',    '', 'Corner café',                '#a3583a', 'coffee',       '2024-11-02 09:00+00'),
  (3, 'Low Orbit',           'Tessa Nakamura',  'tessa@loworbit.example',         '', 'Space-history podcast',      '#6d5fc4', 'mic',          '2025-02-18 09:00+00'),
  (4, 'Ovenbird Bakehouse',  'Elio Ferrante',   'elio@ovenbird.example',          '', 'Sourdough bakery',           '#b0813f', 'croissant',    '2025-09-29 09:00+00'),
  (5, 'Paper Lantern',       'Mei Tan',         'mei@paperlantern.example',       '', 'Stationery studio',          '#4a7ab5', 'notebook-pen', '2026-01-08 09:00+00'),
  (6, 'Night Shift Records', 'Rowan Petit',     'rowan@nightshiftrecords.example', '', 'Independent record label',  '#7d7f9c', 'disc-3',       '2026-04-21 09:00+00');

-- Proposals -------------------------------------------------------------------
--
-- Numbers run PRO-114x and the seeds end at PRO-1146, so the next one the
-- studio writes is PRO-1147. One accepted (it spawned the Drift & Fern
-- project), one out with the bakery and waiting, one still a draft.

INSERT INTO proposals (id, number, client_id, title, status, valid_until, tax_rate, scope, decline_note, created_at, sent_at, decided_at) VALUES
  (1, 'PRO-1142', 1, 'Spring identity refresh', 'accepted', '2026-06-26', 8.00,
   'A full refresh of the Drift & Fern identity — logo, wordmark, colour and type — built around the shop’s hand-tied, seasonal character. We keep what regulars love and sharpen everything else.

Deliverables land in three rounds: research and moodboards first, logo concepts second, then a 32-page guidelines document and a stationery suite ready for print.',
   '', '2026-05-28 09:00+00', '2026-05-29 09:00+00', '2026-06-12 09:00+00'),

  (2, 'PRO-1145', 4, 'Packaging system for the pastry line', 'sent', '2026-08-15', 8.00,
   'A packaging system for the new pastry line: boxes in two sizes, bags, and a label sheet that one person can apply on a busy Saturday morning without a ruler.

We design around your existing kraft stock so the first print run stays affordable, and we hand off dielines your printer can use as-is.

Timeline is four weeks from acceptance, with a press check before anything goes to volume.',
   '', '2026-07-16 09:00+00', '2026-07-18 09:00+00', NULL),

  (3, 'PRO-1146', 6, 'Sleeve art series — fall releases', 'draft', '2026-09-04', 8.00,
   'Three single sleeves for the fall slate, art-directed as a series: shared grid, one palette per release, and a motion loop for each cover so the drops read as a family on every platform.',
   '', '2026-07-24 09:00+00', NULL, NULL);

-- Line 3 of PRO-1142 carries the returning-client courtesy as a visible 10%
-- rather than a quietly lower rate. Subtotal 3066.00, tax 245.28, total
-- 3311.28 — and the deposit on INV-2035 is half the subtotal.
INSERT INTO proposal_items (id, proposal_id, position, description, qty, rate, discount_pct) VALUES
  (1, 1, 1, 'Research, moodboards & concepts',            1,  1800.00,  0),
  (2, 1, 2, 'Brand guidelines (32 pp)',                   1,   960.00,  0),
  (3, 1, 3, 'Stationery suite — returning-client rate',   1,   340.00, 10),

  (4, 2, 1, 'Packaging concepts — boxes & bags',          1,  2200.00,  0),
  (5, 2, 2, 'Label system & dielines',                    1,  1300.00,  0),
  (6, 2, 3, 'Press check & handoff',                      1,   450.00,  0),

  (7, 3, 1, 'Sleeve artwork — three singles',             3,   520.00,  0),
  (8, 3, 2, 'Animated cover loops',                       3,   180.00,  0);

-- Projects --------------------------------------------------------------------
--
-- Only the first came from a proposal; the other three predate the portal or
-- started on a handshake, which is why `proposal_id` is nullable.

INSERT INTO projects (id, client_id, proposal_id, name, status, due_on) VALUES
  (1, 1, 1,    'Spring identity refresh',  'active', '2026-08-21'),
  (2, 2, NULL, 'Café menu & signage',      'active', '2026-08-12'),
  (3, 5, NULL, 'Web shop art direction',   'paused', '2026-09-18'),
  (4, 3, NULL, 'Season 4 cover system',    'done',   '2026-07-10');

INSERT INTO milestones (id, project_id, position, title, due_on, done) VALUES
  (1,  1, 1, 'Kickoff & research',  '2026-06-18', true),
  (2,  1, 2, 'Moodboards',          '2026-06-26', true),
  (3,  1, 3, 'Logo concepts',       '2026-07-10', true),
  (4,  1, 4, 'Brand guidelines',    '2026-08-07', false),
  (5,  1, 5, 'Launch kit',          '2026-08-21', false),

  (6,  2, 1, 'Kickoff',             '2026-07-02', true),
  (7,  2, 2, 'Menu system',         '2026-07-22', true),
  (8,  2, 3, 'Signage artwork',     '2026-08-05', false),
  (9,  2, 4, 'Print handoff',       '2026-08-12', false),

  (10, 3, 1, 'Kickoff',             '2026-06-30', true),
  (11, 3, 2, 'Shop art direction',  '2026-08-28', false),
  (12, 3, 3, 'Rollout kit',         '2026-09-18', false),

  (13, 4, 1, 'Kickoff',             '2026-05-22', true),
  (14, 4, 2, 'Cover concepts',      '2026-06-12', true),
  (15, 4, 3, 'Episode templates',   '2026-07-03', true),
  (16, 4, 4, 'Final handoff',       '2026-07-10', true);

-- One deliverable is waiting on Drift & Fern, one came back with a note, and
-- the rest are signed off. The note is the client's own words — the card the
-- studio has to answer.
INSERT INTO deliverables (id, milestone_id, title, file, icon, status, note) VALUES
  (1, 3,  'Logo — round 3',        'logo_v3.pdf',            'pen-tool',        'pending',            ''),
  (2, 2,  'Moodboard A',           'moodboard_a.pdf',        'images',          'approved',           ''),
  (3, 3,  'Wordmark on dark',      'wordmark_dark.svg',      'type',            'changes_requested',  'Could we try the heavier cut from option B?'),
  (4, 7,  'Menu — draft 2',        'menu_draft2.pdf',        'book-open',       'pending',            ''),
  (5, 8,  'Window signage',        'window_sign.pdf',        'store',           'approved',           ''),
  (6, 10, 'Shelf story frames',    'shelf_story.pdf',        'layout-grid',     'approved',           ''),
  (7, 14, 'Season 4 cover',        'cover_s4.png',           'disc-3',          'approved',           ''),
  (8, 15, 'Episode template pack', 'episode_templates.pdf',  'layout-template', 'approved',           '');

-- Invoices --------------------------------------------------------------------
--
-- Numbers run INV-20xx and the seeds end at INV-2041, so the next one is
-- INV-2042. Terms are the studio's standing fortnight, give or take the day
-- the studio actually pressed send.
--
-- Totals, for anyone reconciling against the app:
--   INV-2035  1533.00 + 122.64 tax = 1655.64   settled by card
--   INV-2036   907.50 +  72.60 tax =  980.10   settled by transfer
--   INV-2037   900.00 +  72.00 tax =  972.00   47 days late at the pinned day
--   INV-2038  1950.00 + 156.00 tax = 2106.00   12 days late
--   INV-2039  2900.00 + 232.00 tax = 3132.00   1200.00 paid, 1932.00 to run
--   INV-2040  1230.00 +  98.40 tax = 1328.40   not yet due
--   INV-2041  1266.00 + 101.28 tax = 1367.28   draft, so never late

INSERT INTO invoices (id, number, client_id, project_id, title, status, issued_on, due_on, tax_rate, created_at) VALUES
  (1, 'INV-2035', 1, 1,    'Spring identity refresh — deposit',      'paid',  '2026-06-16', '2026-06-30', 8.00, '2026-06-16 09:00+00'),
  (2, 'INV-2036', 2, 2,    'Café menu & signage — deposit',          'paid',  '2026-06-20', '2026-07-04', 8.00, '2026-06-20 09:00+00'),
  (3, 'INV-2037', 6, NULL, 'Single sleeve — rush turnaround',        'sent',  '2026-05-29', '2026-06-11', 8.00, '2026-05-29 09:00+00'),
  (4, 'INV-2038', 5, 3,    'Art direction — phase 1',                'sent',  '2026-07-01', '2026-07-16', 8.00, '2026-07-01 09:00+00'),
  (5, 'INV-2039', 3, 4,    'Season 4 cover system — final',          'sent',  '2026-07-20', '2026-08-03', 8.00, '2026-07-20 09:00+00'),
  (6, 'INV-2040', 2, 2,    'Menu & signage — milestone 2',           'sent',  '2026-07-24', '2026-08-07', 8.00, '2026-07-24 09:00+00'),
  (7, 'INV-2041', 1, 1,    'Identity refresh — guidelines milestone','draft', '2026-07-27', '2026-08-10', 8.00, '2026-07-27 09:00+00');

-- INV-2038 is the only hourly line in the studio's history: 18 hours at 95.00.
-- INV-2041 copies its lines from the accepted proposal, courtesy discount and
-- all, which is why the two documents agree to the cent.
INSERT INTO invoice_items (id, invoice_id, position, description, qty, rate, discount_pct) VALUES
  (1,  1, 1, 'Deposit — 50% of accepted proposal',        1,  1533.00,  0),

  (2,  2, 1, 'Deposit — menu & signage engagement',       1,   907.50,  0),

  (3,  3, 1, 'Single sleeve design — rush',               1,   680.00,  0),
  (4,  3, 2, 'Print-ready packaging files',               1,   220.00,  0),

  (5,  4, 1, 'Art direction — phase 1 (hours)',          18,    95.00,  0),
  (6,  4, 2, 'Reference boards',                          1,   240.00,  0),

  (7,  5, 1, 'Season 4 cover system — final',             1,  2100.00,  0),
  (8,  5, 2, 'Episode template pack',                     1,   800.00,  0),

  (9,  6, 1, 'Menu system — milestone 2',                 1,   840.00,  0),
  (10, 6, 2, 'Window signage artwork',                    2,   195.00,  0),

  (11, 7, 1, 'Brand guidelines — milestone',              1,   960.00,  0),
  (12, 7, 2, 'Stationery suite — returning-client rate',  1,   340.00, 10);

-- Two documents settled in full and one part payment: Low Orbit sent 1200.00
-- against a 3132.00 invoice, which is the row that makes the studio's
-- outstanding figure interesting.
INSERT INTO payments (id, invoice_id, amount, method, paid_at) VALUES
  (1, 1, 1655.64, 'card',     '2026-06-24 09:00+00'),
  (2, 2,  980.10, 'transfer', '2026-07-02 09:00+00'),
  (3, 5, 1200.00, 'transfer', '2026-07-24 09:00+00');

-- Sequences -------------------------------------------------------------------
--
-- Every id above was written by hand, so the sequences never advanced. Reset
-- them or the first row the dashboard creates collides with a seeded one.

SELECT setval(pg_get_serial_sequence('clients',        'id'), (SELECT max(id) FROM clients));
SELECT setval(pg_get_serial_sequence('proposals',      'id'), (SELECT max(id) FROM proposals));
SELECT setval(pg_get_serial_sequence('proposal_items', 'id'), (SELECT max(id) FROM proposal_items));
SELECT setval(pg_get_serial_sequence('projects',       'id'), (SELECT max(id) FROM projects));
SELECT setval(pg_get_serial_sequence('milestones',     'id'), (SELECT max(id) FROM milestones));
SELECT setval(pg_get_serial_sequence('deliverables',   'id'), (SELECT max(id) FROM deliverables));
SELECT setval(pg_get_serial_sequence('invoices',       'id'), (SELECT max(id) FROM invoices));
SELECT setval(pg_get_serial_sequence('invoice_items',  'id'), (SELECT max(id) FROM invoice_items));
SELECT setval(pg_get_serial_sequence('payments',       'id'), (SELECT max(id) FROM payments));

COMMIT;
