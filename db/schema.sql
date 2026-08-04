-- Client Portal — PostgreSQL schema (the manifest's §requiredSchema contract).
--
-- This is the real database behind the full self-host stack: the portal reads
-- it (through Adminium's records API) and the auto-generated Adminium
-- dashboard is the back office that runs it. Applied automatically on first
-- boot of the `clients-db` container via
-- /docker-entrypoint-initdb.d/01-schema.sql, then seeded by 02-seed.sql. The
-- seed mirrors src/data/demo.ts one-for-one — same clients, same documents,
-- same amounts, same dates — so the portal and the dashboard show the same
-- studio.
--
-- Nine tables. The split is deliberate: the app owns writing a proposal,
-- approving a deliverable and taking a payment; the generated dashboard owns
-- the records and the reporting across the whole history.
--
-- MONEY IS numeric(12, 2) — never float. The app does its arithmetic in
-- integer cents for exactly the same reason: an invoicing app that disagrees
-- with itself by a rounding penny is an invoicing app nobody trusts. Every
-- money column here is exact decimal, and the two `line_total` columns are
-- GENERATED from qty, rate and discount so no process can ever write a line
-- total that contradicts its own line.
--
-- Whole days are `date`; anything that happened at a moment is `timestamptz`.

DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS invoice_items CASCADE;
DROP TABLE IF EXISTS invoices CASCADE;
DROP TABLE IF EXISTS deliverables CASCADE;
DROP TABLE IF EXISTS milestones CASCADE;
DROP TABLE IF EXISTS projects CASCADE;
DROP TABLE IF EXISTS proposal_items CASCADE;
DROP TABLE IF EXISTS proposals CASCADE;
DROP TABLE IF EXISTS clients CASCADE;

-- Clients ---------------------------------------------------------------------

-- A client is a company plus the one person the studio actually writes to.
-- `email` is UNIQUE because it is half of the portal's credential: the gate
-- asks for an e-mail address and a document number, and a shared address
-- would make the second half meaningless.
--
-- `kind`, `tint` and `icon` are the portal's presentation of a client — the
-- trade line under the company name and the tinted monogram that stands in
-- for a logo the studio does not have on file.
CREATE TABLE clients (
  id           serial PRIMARY KEY,
  company      text        NOT NULL,
  contact_name text        NOT NULL,
  email        text        NOT NULL UNIQUE,
  phone        text        NOT NULL DEFAULT '',
  kind         text        NOT NULL DEFAULT '',
  tint         text        NOT NULL DEFAULT '#b25e09',
  icon         text        NOT NULL DEFAULT 'building-2',
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Proposals -------------------------------------------------------------------

-- `tax_rate` lives on the document, not only in settings. Change the studio's
-- standing rate tomorrow and every document issued yesterday still totals to
-- what the client agreed to — which is the whole point of copying it down.
--
-- The two CHECKs encode the lifecycle the app enforces in the store: a draft
-- has never been sent, and a document is decided exactly when it carries a
-- decision date. `decline_note` is the client's own words and belongs to the
-- declined branch only.
CREATE TABLE proposals (
  id           serial PRIMARY KEY,
  number       text        NOT NULL UNIQUE,             -- 'PRO-1142'
  client_id    integer     NOT NULL REFERENCES clients (id) ON DELETE RESTRICT,
  title        text        NOT NULL,
  status       text        NOT NULL DEFAULT 'draft'
                           CHECK (status IN ('draft', 'sent', 'accepted', 'declined')),
  valid_until  date        NOT NULL,
  tax_rate     numeric(5, 2) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 100),
  scope        text        NOT NULL DEFAULT '',         -- the scope paragraphs, blank line between
  decline_note text        NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  sent_at      timestamptz,
  decided_at   timestamptz,
  CONSTRAINT proposals_draft_unsent
    CHECK (status <> 'draft' OR sent_at IS NULL),
  CONSTRAINT proposals_decided_dates
    CHECK ((status IN ('accepted', 'declined')) = (decided_at IS NOT NULL)),
  CONSTRAINT proposals_decline_note_only_when_declined
    CHECK (status = 'declined' OR decline_note = '')
);

-- One line of a proposal. `discount_pct` is per line, so a returning-client
-- rate can be shown as the courtesy it is instead of being quietly baked into
-- a lower unit price.
--
-- `line_total` rounds AT THE LINE, once — the same order the app's engine
-- uses. Tax is never applied here; it lands once, on the summed subtotal, so
-- the printed lines always add up to the printed subtotal.
CREATE TABLE proposal_items (
  id           serial PRIMARY KEY,
  proposal_id  integer NOT NULL REFERENCES proposals (id) ON DELETE CASCADE,
  position     integer NOT NULL DEFAULT 0,
  description  text    NOT NULL,
  qty          numeric(10, 2) NOT NULL DEFAULT 1 CHECK (qty > 0),
  rate         numeric(12, 2) NOT NULL DEFAULT 0,
  discount_pct numeric(5, 2)  NOT NULL DEFAULT 0
                              CHECK (discount_pct >= 0 AND discount_pct <= 100),
  line_total   numeric(12, 2) GENERATED ALWAYS AS
                 (round(qty * rate * (1 - discount_pct / 100), 2)) STORED
);

-- Projects --------------------------------------------------------------------

-- A project may be born from an accepted proposal or may just exist, so
-- `proposal_id` is nullable — but it is UNIQUE, because accepting a proposal
-- twice must not spawn a second project. ON DELETE SET NULL keeps the work
-- when the paperwork behind it is thrown away.
CREATE TABLE projects (
  id          serial PRIMARY KEY,
  client_id   integer NOT NULL REFERENCES clients (id) ON DELETE RESTRICT,
  proposal_id integer UNIQUE REFERENCES proposals (id) ON DELETE SET NULL,
  name        text    NOT NULL,
  status      text    NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'paused', 'done')),
  due_on      date
);

-- `position` is what the client's progress bar counts along; the array order
-- in the app becomes an explicit column here so two readers never disagree
-- about which milestone is third.
CREATE TABLE milestones (
  id         serial PRIMARY KEY,
  project_id integer NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  title      text    NOT NULL,
  due_on     date,
  done       boolean NOT NULL DEFAULT false,
  position   integer NOT NULL DEFAULT 0
);

-- A deliverable hangs off a milestone, not off the project, because "what is
-- this for?" is the first question a client asks about a file.
--
-- `note` is the client's reason when they ask for changes, so a
-- changes_requested card without one is a card nobody can act on — the CHECK
-- refuses it.
CREATE TABLE deliverables (
  id           serial PRIMARY KEY,
  milestone_id integer NOT NULL REFERENCES milestones (id) ON DELETE CASCADE,
  title        text    NOT NULL,
  file         text    NOT NULL DEFAULT '',
  icon         text    NOT NULL DEFAULT 'file',
  status       text    NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'approved', 'changes_requested')),
  note         text    NOT NULL DEFAULT '',
  CONSTRAINT deliverables_changes_need_a_note
    CHECK (status <> 'changes_requested' OR note <> '')
);

-- Invoices --------------------------------------------------------------------

-- `status` carries the four members the install contract names, but the app
-- only ever WRITES draft | sent | paid: whether a document is late is derived
-- from `due_on` against the clock, every time it is asked. A stored late flag
-- is a flag that is wrong the moment the clock moves, and a draft is never
-- late however old it gets. The fourth member is here for importers that
-- disagree; the seed does not use it.
--
-- `project_id` is nullable — a one-off job gets invoiced without ever
-- becoming a project.
CREATE TABLE invoices (
  id         serial PRIMARY KEY,
  number     text        NOT NULL UNIQUE,               -- 'INV-2035'
  client_id  integer     NOT NULL REFERENCES clients (id) ON DELETE RESTRICT,
  project_id integer     REFERENCES projects (id) ON DELETE SET NULL,
  title      text        NOT NULL DEFAULT '',
  status     text        NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft', 'sent', 'paid', 'overdue')),
  issued_on  date        NOT NULL,
  due_on     date        NOT NULL,
  tax_rate   numeric(5, 2) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoices_due_after_issue CHECK (due_on >= issued_on)
);

-- Same shape and same rounding order as proposal_items: an accepted proposal
-- becomes an invoice by copying lines across, and the totals must not shift
-- in the copying.
CREATE TABLE invoice_items (
  id           serial PRIMARY KEY,
  invoice_id   integer NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  position     integer NOT NULL DEFAULT 0,
  description  text    NOT NULL,
  qty          numeric(10, 2) NOT NULL DEFAULT 1 CHECK (qty > 0),
  rate         numeric(12, 2) NOT NULL DEFAULT 0,
  discount_pct numeric(5, 2)  NOT NULL DEFAULT 0
                              CHECK (discount_pct >= 0 AND discount_pct <= 100),
  line_total   numeric(12, 2) GENERATED ALWAYS AS
                 (round(qty * rate * (1 - discount_pct / 100), 2)) STORED
);

-- Payments are a ledger, not a status: several rows may land against one
-- invoice and the balance is their sum subtracted from the document total.
-- Partial amounts are welcome, which is why nothing here caps a row at the
-- invoice total — the app refuses an OVERpayment at the door instead, and
-- tells the payer the maximum.
CREATE TABLE payments (
  id         serial PRIMARY KEY,
  invoice_id integer NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  amount     numeric(12, 2) NOT NULL CHECK (amount > 0),
  method     text    NOT NULL CHECK (method IN ('card', 'transfer')),
  paid_at    timestamptz NOT NULL DEFAULT now()
);

-- Indexes ---------------------------------------------------------------------
--
-- Every foreign key gets one (Postgres does not create them), plus the
-- columns the two surfaces actually filter and sort by: document status for
-- the chip bars, `due_on` for the aging strip, `paid_at` for the ledger.

CREATE INDEX idx_proposals_client      ON proposals (client_id);
CREATE INDEX idx_proposals_status      ON proposals (status);
CREATE INDEX idx_proposals_created     ON proposals (created_at DESC);
CREATE INDEX idx_proposal_items_doc    ON proposal_items (proposal_id, position);

CREATE INDEX idx_projects_client       ON projects (client_id);
CREATE INDEX idx_projects_status       ON projects (status);
CREATE INDEX idx_projects_due          ON projects (due_on);

CREATE INDEX idx_milestones_project    ON milestones (project_id, position);
CREATE INDEX idx_deliverables_ms       ON deliverables (milestone_id);
CREATE INDEX idx_deliverables_status   ON deliverables (status);

CREATE INDEX idx_invoices_client       ON invoices (client_id);
CREATE INDEX idx_invoices_project      ON invoices (project_id);
CREATE INDEX idx_invoices_status       ON invoices (status);
CREATE INDEX idx_invoices_due          ON invoices (due_on);
CREATE INDEX idx_invoices_issued       ON invoices (issued_on DESC);
CREATE INDEX idx_invoice_items_doc     ON invoice_items (invoice_id, position);

CREATE INDEX idx_payments_invoice      ON payments (invoice_id);
CREATE INDEX idx_payments_paid_at      ON payments (paid_at DESC);
