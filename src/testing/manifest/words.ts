/*
 * VENDORED VERBATIM from packages/manifest/src/words.ts.
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
 * The words of a manifest that only a newer Adminium reads.
 *
 * A manifest block or rule added after a release is refused by every older
 * server as an unknown key — a sentence that names the key and not the cure.
 * So a manifest that uses one says so in `compatibility.minAdminiumVersion`:
 * the older server then answers "needs Adminium <version>" before it parses
 * anything. This walker lists the words a document uses, each with the place
 * it is written; the validator turns the list into the floor rule, and the
 * server reads the same list to refuse a word it parses and does not run yet.
 *
 * It reads the plain document, not the typed manifest, so the schema file may
 * import it without the two files importing each other.
 */
import { placeholdersIn } from './placeholders.ts';

export interface ManifestWord {
  /** The word as a refusal names it: `pages`, `requiredSchema.prefixed`, `column.addOnLink`. */
  word: ManifestWordName;
  /** Dotted path to where the document writes it. */
  path: string;
}

type Doc = Readonly<Record<string, unknown>>;

const isDoc = (value: unknown): value is Doc => typeof value === 'object' && value !== null && !Array.isArray(value);
const list = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);

/** The most a file column took before guests could upload into it: past this, a column needs the release that reads it. */
export const FILE_COLUMN_EARLIER_MAX_BYTES = 25 * 1024 * 1024;

/** The top-level blocks an add-on shares with an app since the install floor. */
export const ADD_ON_INSTALL_BLOCKS = [
  'pages',
  'roles',
  'optionLists',
  'emailTemplates',
  'outbox',
  'documents',
  'sampleData',
  'publicAccess',
  'publicKeys',
  'navGroups',
  'seeds',
  'automations',
  'addOns',
] as const;

/**
 * Every word the walker can name. The walker's own type: a word it names and
 * this list lacks does not compile. A server keeps one answer per name — it
 * runs the word, or it refuses a manifest that uses it — and its tests read
 * this list to see that none is left without one.
 */
export const INSTALL_FLOOR_WORD_NAMES = [
  ...ADD_ON_INSTALL_BLOCKS,
  'requiredSchema.prefixed',
  'addOn.settingsTable',
  'addOn.ledgers',
  'addOn.adjuster',
  'addOn.words',
  'addOn.recordTabs',
  'addOn.hostApi.2',
  'addOn.lookUp',
  'ledger.decides',
  'table.indexes',
  'table.postings',
  'table.adjust',
  'states.actions',
  'states.planned',
  'column.addOnLink',
  'column.addOnLink.default',
  'column.tableRef',
  'column.announce',
  'column.plainText',
  'column.customerKey',
  'column.codeLast4',
  'code.givenByLedger',
  'rollup.capUnless',
  'rollup.latest',
  'roles.tables',
  'roles.writableFrom',
  'toolbar.links',
  'config.tabs',
  'config.bulk',
  'sampleData.addOns',
  'sampleData.people',
  'app.seeds',
  'table.occupies',
  'sequence.sample',
  'email.onlyWith',
  'email.onlyWithout',
  'outbox.pages.app',
  'rows.pair',
  'unlockBy.self',
  'availability.words',
  'addOn.steps',
  'addOn.assistant',
  'automations.addOnStep',
  'email.showWhen',
  'placeholder.backup',
  'frontend.mobile',
  'column.staff',
  'table.belongs',
  'table.private',
  'belongs.throughPrivate',
  'shape.create',
  'table.appGrants',
  'roles.rows',
  'rows.several',
  'listing.while',
  'states.handOver',
  'app.modules',
  'roles.names',
  'app.maps',
  'automations.staffRecipient',
  'automations.perSpell',
  'automations.urgent',
  'automations.digest',
  'digest.reach',
  'digest.sum',
  'digest.by',
  'digest.target',
  'digest.within',
  'automations.stepName',
  'automations.many',
  'automations.replyTo',
  'automations.lead',
  'automations.leadAlone',
  'automations.listed',
  'automations.staffName',
  'automations.recordUrl',
  'automations.was',
  'automations.settingAmount',
  'automations.settingValue',
  'automations.daysAfter',
  'automations.settingElse',
  'outbox.replyTo',
  'outbox.onDelete',
  'column.mentions',
  'column.place',
  'column.area',
  'column.linkable',
  'linkable.same',
  'column.file',
  'config.board',
  'board.toolbar',
  'board.secondAmount',
  'board.daysLabel',
  'states.notPast',
  'states.moveOnCreate',
  'publicAccess.requiresWhen',
  'frontend.records',
  'nav.offRail',
  'navLinks',
  'outbox.staffName',
  'card.module',
  'card.columnLabels',
  'link.staffPath',
  'column.changes',
  'rows.notBy',
  'rows.via',
  'rows.notThrough',
  'states.carries',
  'table.removal',
  'column.history',
  // Checked against another column: a number or a time of day against another, an end at most so many days after a start; a moment not before now.
  'bounds.other',
  'bounds.now',
  // A stamp no writer and no file may give a value of its own.
  'stamp.strict',
  // A column a stamp fills and `requiredWhen` asks for: a brought line must carry it.
  'requiredWhen.stamp',
  // Marketing or service: each outbox kind's class, and a rule's e-mail to the record's own address.
  'outbox.classes',
  'automations.emailClass',
  // The tables that hold an app's people, and where else a person is copied.
  'people',
  // A table whose rows the law keeps.
  'table.keep',
  // A consent tick a stranger gives on a public entry, with the sentence shown and its version.
  'publicAccess.consent',
  // More rules than a manifest could ship before (twenty-four).
  'automations.more',
  // An add-on's forms: the tables that hold its forms, answers, invitations and files.
  'addOn.forms',
  // A table an app opens to forms, through an entry under the reserved key `forms`.
  'publicAccess.forms',
  // An outbox kind's consent purpose, and the kinds whose template prints a survey's link.
  'outbox.purposes',
  'outbox.surveyLinks',
  // The column of a table opened to forms that a form's fixed "Source" value goes into.
  'publicAccess.forms.source',
  // An add-on step's person input and its fields, a record input named by a unique column and held to some rows, a
  // choice's help line, and the rule record's own table and key as tokens.
  'step.person',
  'step.recordBy',
  'step.recordWhere',
  'step.help',
  'step.recordTokens',
  // An add-on's entry held to the rows of the app whose key serves it; a copy of a person on an add-on's table; an add-on's
  // own rows let go some days after a moment of theirs.
  'publicAccess.appColumn',
  'people.addOnCopies',
  'table.expire',
  // A link filled with the band a number falls in; a date so many working days on; a formula rounded up or down.
  'column.band',
  'stamp.addWorkingDays',
  'formula.ceilFloor',
  // Whether an order line's design may be ordered: the line table's rule, and the add-on's side of it.
  'table.check',
  'addOn.checker',
  // A panel an add-on draws on the record pages of the tables that link into one of its own.
  'addOn.panels',
  // A guest's file uploaded into a file column through a public entry: the entry's list, the column's rule for it; a
  // column that takes TIFF, or files past the 25 MiB a column took before.
  'publicAccess.uploads',
  'file.upload',
  'file.tiff',
  'file.large',
  // A file column that takes a cleaned SVG, a model (GLB, STL, 3MF) or a web font (WOFF2); an entry's product assets,
  // loaded by every visitor's browser.
  'file.assetKinds',
  'publicAccess.assets',
  // An add-on's link key opening its row as the row's own link, which may change it while it is in a state; an add-on's
  // read for a session the app's own sign-in opened; a copy of a person's other details (a design's words, in JSON).
  'publicAccess.ownLink',
  'publicAccess.sessionRead',
  'people.copyDetails',
  // An add-on's own link removing its row (a shopper deleting their own draft) while it is in a state.
  'publicAccess.ownDelete',
  // An app role given a page or a record panel of an add-on the app names (`page:@customiser-line:view`).
  'roles.addOnPages',
  // An agreement on how many characters a text has (a line's lettering at most its product's limit).
  'agrees.length',
  // A copy of a person one or two links further into an add-on (a design's versions, and their files).
  'people.addOnCopyFrom',
  // A picture from a row's file column in an email (`email.image` with `fileId: "{{job.photo}}"`).
  'email.rowPicture',
  // A role's grant on an add-on's table that reads its personal columns or removes rows, or more than twelve such grants.
  'roles.addOnActions',
  // An add-on's `appGrants` that allows reading personal columns or removing rows, or adding and changing rows of a table
  // a ledger's code writes.
  'appGrants.more',
  // An app role that finds, downloads and erases a person's data (`privacy:@:people`).
  'roles.privacyPeople',
  // The columns a records page's list opens on, in order (`config.columns`).
  'config.columns',
  // An add-on kept once per server rather than installed per database.
  'addOn.scope',
  // A side that serves every install of its app (it sends the install it is).
  'frontend.instances',
  // A self-made app's page as a person arranged it, its shared views, and where the file was saved.
  'page.envelope',
  'page.views',
  'app.provenance',
  // A self-made app's icon.
  'app.icon',
  // The other apps a self-made app needs on its database, and its part that is the whole deployment's.
  'apps.requires',
  'instance',
  // A time of day, a decimal's places in all, a column kept off forms, an int read as a yes or a no.
  'column.time',
  'column.precision',
  'column.hidden',
  'column.yesNo',
  // A self-made app's column under the name it has in its own database (`orderDate`), not snake_case.
  'column.name',
  // A link's own name, a link Adminium does not show, a link no foreign key keeps.
  'relation.label',
  'relation.remove',
  'relation.noConstraint',
  // A table left out of Adminium, a people table whose existing customers were mailed, a posting kept switched off.
  'table.exclude',
  'table.existingCustomers',
  'table.switchedOff',
  // A self-made app's table under the real name a person gave it, and in its own Postgres schema.
  'table.name',
  'table.schema',
  // An answer's line under it.
  'optionList.description',
  // A mail's kind, what it is for, its own brand, and the package's files it carries.
  'email.kind',
  'email.category',
  'email.brand',
  'email.attachments',
  // A rule's call to a web address, its drawing of a document, its mail to addresses the owner types, a marketing
  // mail's purpose, and a record rule that also notices rows written around Adminium.
  'automations.webhook',
  'automations.documentRender',
  'automations.fixedAddress',
  'automations.purpose',
  'automations.watch',
  // A document's own options, the change that draws it, and where it goes once drawn.
  'documents.options',
  'documents.trigger',
  'documents.deliver',
  // What only a file made on an Adminium carries: its report documents, invoice layouts, scheduled reports and payments.
  'reports',
  'invoiceLayouts',
  'scheduledReports',
  'payments',
  // A public entry of such a file: a row replaced, removed or written many at a time, and its own address, pages, rate and reply.
  'publicAccess.put',
  'publicAccess.delete',
  'publicAccess.batch',
  'publicAccess.path',
  'publicAccess.pagination',
  'publicAccess.rateLimit',
  'publicAccess.response',
] as const;
export type ManifestWordName = (typeof INSTALL_FLOOR_WORD_NAMES)[number];

/**
 * The words that came after the install floor, each with the first Adminium
 * that reads it. Every other word is read from the install floor on. The
 * release before one of these refuses it as an unknown key, or as a rule it
 * forbids, so a manifest that uses one declares this floor instead.
 */
export const WORD_FLOORS: Readonly<Partial<Record<ManifestWordName, string>>> = {
  'column.addOnLink.default': '0.3.19',
  'roles.writableFrom': '0.3.19',
  // A step an add-on gives to Automations, and a rule that uses one.
  'addOn.steps': '0.3.22',
  // What an add-on tells the assistant: what its tables are, and questions for its pages.
  'addOn.assistant': '0.3.22',
  'automations.addOnStep': '0.3.22',
  // What a template writes when a value is missing: a block tied to a value, a backup after a bar.
  'email.showWhen': '0.3.22',
  'placeholder.backup': '0.3.22',
  // An app with a phone side: the side `mobile`, kind `expo`.
  'frontend.mobile': '0.3.26',
  // Whose a row is: a column that holds a staff member, the ways people belong to a table's rows,
  // a table read by those people alone, and a role whose read, update or delete reaches only some rows.
  'column.staff': '0.3.28',
  'table.belongs': '0.3.28',
  'table.private': '0.3.28',
  // A row hung on a private row, reached by a person that private row's own `belongs` names.
  'belongs.throughPrivate': '0.3.35',
  // A table built on a shape holding its create to a condition on a column the app added.
  'shape.create': '0.3.35',
  // What an app's role may be given of an add-on's table: the add-on's ceiling, cut to at every grant.
  'table.appGrants': '0.3.28',
  'roles.rows': '0.3.28',
  // An action that names several reaches, any one enough (every won deal, or an open one the person is listed on);
  // a listing that counts only while a column of it holds some values, or is empty.
  'rows.several': '0.3.28',
  'listing.while': '0.3.28',
  // A record's button that hands the row to anybody: the one write a role limited to its own rows names a colleague in.
  'states.handOver': '0.3.28',
  // A total that is the newest child row's value, not a sum or a count (a deal's amount from its last sent quote).
  'rollup.latest': '0.3.28',
  // Sample data that brings its own people and teams, and rows that name them.
  'sampleData.people': '0.3.28',
  // An app's starting rows: written once by its install, into tables that are still empty.
  'app.seeds': '0.3.28',
  // A row takes a resource for a time: no two overlap, within the resource's hours.
  'table.occupies': '0.3.28',
  // A running number the app's sample rows may take: the next real row follows them.
  'sequence.sample': '0.3.28',
  // The parts of an app its owner switches on and off, and everything that names one.
  'app.modules': '0.3.28',
  // A role's name in other languages.
  'roles.names': '0.3.28',
  // The app shows maps: its install asks whether they are shown.
  'app.maps': '0.3.28',
  // A rule that tells the person a staff column of its record names.
  'automations.staffRecipient': '0.3.28',
  // A row visited once for each spell it matches.
  'automations.perSpell': '0.3.28',
  // A notice told at once, also in a person's quiet hours.
  'automations.urgent': '0.3.28',
  // A summary for each person, of the rows that are theirs.
  'automations.digest': '0.3.28',
  // A section of a summary: the rows of the people its reader leads, a column added up, a line a person, a sum against a target.
  'digest.reach': '0.3.28',
  'digest.sum': '0.3.28',
  'digest.by': '0.3.28',
  'digest.target': '0.3.28',
  // A section held to the rows of this year, or of the last days, by a date column on the business's calendar.
  'digest.within': '0.3.35',
  // A row a step makes, read by a later step.
  'automations.stepName': '0.3.28',
  // More rules than a manifest could ship before (twelve).
  'automations.many': '0.3.28',
  // A reply that goes to the person a staff column of the row names: a rule's email, an outbox producer's message.
  'automations.replyTo': '0.3.28',
  // A notice to whoever leads a team the person a staff column names is in, and to roles when there is nobody.
  'automations.lead': '0.3.28',
  // A notice to a lead with no roles told when there is none: nobody is, and the run says so (a release before refused it).
  'automations.leadAlone': '0.3.35',
  // A notice or an e-mail to the people a table lists against the record, of them only who can open it when it goes.
  'automations.listed': '0.3.28',
  // A rule's text or its e-mail naming the person a staff column names; a rule's e-mail to a person carrying the record's address.
  'automations.staffName': '0.3.28',
  'automations.recordUrl': '0.3.28',
  // A rule run by a change reads its record as it was before it.
  'automations.was': '0.3.28',
  // An amount of time a condition reads from a column of the app's settings row.
  'automations.settingAmount': '0.3.28',
  // A value a step writes read from a column of the app's settings row; a day so many days after a date of the record, or after now.
  'automations.settingValue': '0.3.28',
  'automations.daysAfter': '0.3.28',
  'automations.settingElse': '0.3.29',
  'outbox.replyTo': '0.3.28',
  'outbox.onDelete': '0.3.28',
  // A text column in which people are mentioned.
  'column.mentions': '0.3.28',
  // A json column that holds a position on the map, read and checked on every write; one that holds an area.
  'column.place': '0.3.28',
  'column.area': '0.3.28',
  // A foreign key that may name only a row meeting some conditions (a price-list line still offered).
  'column.linkable': '0.3.28',
  // Such a link whose named row must hold what the row written holds (a visit's contact of the visit's deal's company).
  'linkable.same': '0.3.28',
  // A column that holds files a signed-in person uploaded for it: their kinds, their size, how many.
  'column.file': '0.3.28',
  // A board whose columns an app names: the rows of a table, or the values of an enum it picks.
  'config.board': '0.3.28',
  // A board's toolbar: the server's total of every card the reader reaches, and a filter by the person a staff column names.
  'board.toolbar': '0.3.35',
  // A second number or money line on a board's card, with its short label (a deal's weighted value).
  'board.secondAmount': '0.3.35',
  // What a card's days are, after the figure ("12 days in stage").
  'board.daysLabel': '0.3.35',
  // A move refused once a date of its row has passed, for every writer.
  'states.notPast': '0.3.28',
  // A new child row moves its parent to a state by the parent's own move (a job signed off by the sign-off made on site).
  'states.moveOnCreate': '0.3.30',
  // A column a public write must fill only with some values of another, and may write at no other time.
  'publicAccess.requiresWhen': '0.3.28',
  // Where a table's record opens on the app's own staff side: read by notices, their e-mails and search.
  'frontend.records': '0.3.28',
  // A page kept off the sidebar, and an entry of the app's section that is not a page.
  'nav.offRail': '0.3.28',
  'navLinks': '0.3.28',
  // An app's e-mail that names the person a staff column names (`{{visit.rep_id.name}}`): a release before fails the message.
  'outbox.staffName': '0.3.28',
  // A dashboard card of a part of the app, its column headings in the reader's language, and a link to one screen of the staff side.
  'card.module': '0.3.28',
  'card.columnLabels': '0.3.28',
  'link.staffPath': '0.3.28',
  // When, and by whom, a column may change: from some values, while another holds one, by or never by a person the row names.
  'column.changes': '0.3.35',
  // A change a role's reach leaves to everybody but the person a staff column of the row names (a manager's own target).
  'rows.notBy': '0.3.35',
  // A reach of a child table judged by a staff column of the row it hangs off (a manager's visits of the deals her team owns).
  'rows.via': '0.3.35',
  // A change a role's reach does not count a listing for (a helper on a deal reads it and changes nothing of it).
  'rows.notThrough': '0.3.36',
  // A hand-over that moves the old owner's child rows with the record, in the same write (a deal's booked visits).
  'states.carries': '0.3.35',
  // A removal's reason, and a removed row's history read through a row it linked to; a column whose earlier values only the audit log keeps.
  'table.removal': '0.3.35',
  'column.history': '0.3.35',
  // A number or a time of day kept on one side of another column, an end at most so many days after a start (a release before refuses all but dates).
  'bounds.other': '0.3.35',
  // A new row's moment not before now.
  'bounds.now': '0.3.35',
  // A stamp that is always the server's, on every door, for every writer.
  'stamp.strict': '0.3.35',
  // A stamp beside `requiredWhen`: stamped on a person's save, asked of a brought line (a release before refuses the pair).
  'requiredWhen.stamp': '0.3.35',
  // Each outbox kind's class beside its template, and a rule's e-mail to the record's own address marked marketing or service:
  // from this release on every one says which (see `mail-class.ts`).
  'outbox.classes': '0.3.38',
  'automations.emailClass': '0.3.38',
  // An app's people tables: their address, name, consent and copies, read by e-mail to contacts and a person's data.
  'people': '0.3.38',
  // A table whose rows the law keeps: an erasure leaves them and says why.
  'table.keep': '0.3.38',
  // A stranger's consent tick on a public entry: the row's bool, its purpose, the sentence shown and its version.
  'publicAccess.consent': '0.3.38',
  // More rules than a manifest could ship before (twenty-four, now thirty-two).
  'automations.more': '0.3.38',
  // An add-on's forms, which the engine draws and takes answers for, and a table an app opens to them.
  'addOn.forms': '0.3.40',
  'publicAccess.forms': '0.3.40',
  // An outbox kind sent for a consent purpose (a survey invitation skips a "no" to surveys, even as service mail), and a
  // kind whose template prints a survey's link, filled when it goes.
  'outbox.purposes': '0.3.40',
  'outbox.surveyLinks': '0.3.40',
  // The column of a table opened to forms that a form's fixed "Source" value goes into (an enquiry's "From form").
  'publicAccess.forms.source': '0.3.41',
  // A step about a person (the rule record, or one link of it): their address, name, language, company, table and key.
  'step.person': '0.3.41',
  // A record input that names its row by a unique column (a survey by its slug), and the rows it may pick (only live ones).
  'step.recordBy': '0.3.41',
  'step.recordWhere': '0.3.41',
  // A line under an input, and under each of a choice's options (the rule editor then draws them as cards).
  'step.help': '0.3.41',
  // The rule record's stored table name and its key, as an add-on's record tab and a survey's invitation keep them.
  'step.recordTokens': '0.3.41',
  // An add-on's entry on each app's key held to that app's rows, a person's copy kept on an add-on's table, and an add-on's
  // rows that expire. The release that reads them is the one that holds an add-on's foreign keys to its own tables
  // (`HOST_REFERENCES_FLOOR` in `schema.ts`, moved with it at the release).
  'publicAccess.appColumn': '0.3.43',
  'people.addOnCopies': '0.3.43',
  'table.expire': '0.3.43',
  // The band a number falls in, a date counted in working days, and a formula's ceil and floor: read by the same release.
  'column.band': '0.3.43',
  'stamp.addWorkingDays': '0.3.43',
  'formula.ceilFloor': '0.3.43',
  // A design checked by an add-on inside the save, and an add-on's panel on a record page: read by the same release.
  'table.check': '0.3.43',
  'addOn.checker': '0.3.43',
  'addOn.panels': '0.3.43',
  // A guest's upload into an app's file column, TIFF, and file columns up to 100 MiB: read by the same release.
  'publicAccess.uploads': '0.3.43',
  'file.upload': '0.3.43',
  'file.tiff': '0.3.43',
  'file.large': '0.3.43',
  // A cleaned SVG, a model and a web font in a file column, and an entry's product assets: read by the same release.
  'file.assetKinds': '0.3.43',
  'publicAccess.assets': '0.3.43',
  // A guest's draft changed in place through its own link, a design read by its code inside a session, and a copy of
  // a person's words kept as JSON: read by the same release.
  'publicAccess.ownLink': '0.3.43',
  'publicAccess.sessionRead': '0.3.43',
  'people.copyDetails': '0.3.43',
  // A guest's own draft removed through its own link: read by the same release.
  'publicAccess.ownDelete': '0.3.43',
  // An app role given an add-on's page or panel: a release before refuses the grant as a page the app does not declare.
  'roles.addOnPages': '0.3.44',
  // A length agreement: a release before refuses the key.
  'agrees.length': '0.3.44',
  // A copy reached through the add-on's own links: a release before refuses the key.
  'people.addOnCopyFrom': '0.3.44',
  // A picture from a row's file column in an email: a release before leaves the picture out, or refuses a long name.
  'email.rowPicture': '0.3.45',
  // A release before refuses the actions, the thirteenth grant, and an app's grant it cannot place.
  'roles.addOnActions': '0.3.47',
  'appGrants.more': '0.3.47',
  'roles.privacyPeople': '0.3.47',
  // A release before ignores the key, and the list opens on the columns Adminium picks.
  'config.columns': '0.3.47',
  'addOn.scope': '0.3.49',
  'frontend.instances': '0.3.49',
  // What a file saved from a dashboard carries, and the fields its tables and mails need: a release before refuses each key.
  'page.envelope': '0.3.49',
  'page.views': '0.3.49',
  'app.provenance': '0.3.49',
  'app.icon': '0.3.49',
  'apps.requires': '0.3.49',
  'instance': '0.3.49',
  'column.time': '0.3.49',
  'column.precision': '0.3.49',
  'column.hidden': '0.3.49',
  'column.yesNo': '0.3.49',
  'column.name': '0.3.49',
  'relation.label': '0.3.49',
  'relation.remove': '0.3.49',
  'relation.noConstraint': '0.3.49',
  'table.exclude': '0.3.49',
  'table.existingCustomers': '0.3.49',
  'table.switchedOff': '0.3.49',
  'table.name': '0.3.49',
  'table.schema': '0.3.49',
  'optionList.description': '0.3.49',
  'email.kind': '0.3.49',
  'email.category': '0.3.49',
  'email.brand': '0.3.49',
  'email.attachments': '0.3.49',
  // A rule's webhook, document, typed addresses, purpose and watch: a release before refuses the keys.
  'automations.webhook': '0.3.49',
  'automations.documentRender': '0.3.49',
  'automations.fixedAddress': '0.3.49',
  'automations.purpose': '0.3.49',
  'automations.watch': '0.3.49',
  // A document's options, trigger and delivery: a release before refuses the keys.
  'documents.options': '0.3.49',
  'documents.trigger': '0.3.49',
  'documents.deliver': '0.3.49',
  // A file's reports, invoice layouts, scheduled reports and payments: a release before refuses the blocks.
  'reports': '0.3.49',
  'invoiceLayouts': '0.3.49',
  'scheduledReports': '0.3.49',
  'payments': '0.3.49',
  // A public entry's wider methods and its own address, pages, rate and reply: a release before refuses them.
  'publicAccess.put': '0.3.49',
  'publicAccess.delete': '0.3.49',
  'publicAccess.batch': '0.3.49',
  'publicAccess.path': '0.3.49',
  'publicAccess.pagination': '0.3.49',
  'publicAccess.rateLimit': '0.3.49',
  'publicAccess.response': '0.3.49',
};

/** The kinds of file a column takes from the release that cleans SVG and reads models and fonts whole (`ASSET_FILE_KINDS`). */
const ASSET_KINDS: ReadonlySet<string> = new Set(['svg', 'glb', 'stl', '3mf', 'woff2']);

/** Whether a formula, at any depth, rounds up or down (`ceil`, `floor`). */
function roundsUpOrDown(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(roundsUpOrDown);
  if (!isDoc(node)) return false;
  return Object.entries(node).some(([key, value]) => key === 'ceil' || key === 'floor' || roundsUpOrDown(value));
}

/** Every word of `document` that needs the install floor, in document order. */
export function installFloorWords(document: unknown): ManifestWord[] {
  if (!isDoc(document)) return [];
  const out: ManifestWord[] = [];
  const addOn = document['kind'] === 'add-on';
  const schema = isDoc(document['requiredSchema']) ? document['requiredSchema'] : {};

  if (addOn) {
    for (const block of ADD_ON_INSTALL_BLOCKS) {
      if (document[block] !== undefined) out.push({ word: block, path: block });
    }
    if (schema['prefixed'] === true) out.push({ word: 'requiredSchema.prefixed', path: 'requiredSchema.prefixed' });
    const block = isDoc(document['addOn']) ? document['addOn'] : {};
    if (block['settingsTable'] !== undefined) out.push({ word: 'addOn.settingsTable', path: 'addOn.settingsTable' });
    if (block['ledgers'] !== undefined) out.push({ word: 'addOn.ledgers', path: 'addOn.ledgers' });
    if (block['adjuster'] !== undefined) out.push({ word: 'addOn.adjuster', path: 'addOn.adjuster' });
    if (block['checker'] !== undefined) out.push({ word: 'addOn.checker', path: 'addOn.checker' });
    if (block['panels'] !== undefined) out.push({ word: 'addOn.panels', path: 'addOn.panels' });
    if (block['words'] !== undefined) out.push({ word: 'addOn.words', path: 'addOn.words' });
    if (block['recordTabs'] !== undefined) out.push({ word: 'addOn.recordTabs', path: 'addOn.recordTabs' });
    // Pages that also need the data kit.
    if (block['hostApi'] === 2) out.push({ word: 'addOn.hostApi.2', path: 'addOn.hostApi' });
    if (block['lookUp'] !== undefined) out.push({ word: 'addOn.lookUp', path: 'addOn.lookUp' });
    if (block['steps'] !== undefined) out.push({ word: 'addOn.steps', path: 'addOn.steps' });
    if (block['assistant'] !== undefined) out.push({ word: 'addOn.assistant', path: 'addOn.assistant' });
    if (block['forms'] !== undefined) out.push({ word: 'addOn.forms', path: 'addOn.forms' });
    if (block['scope'] !== undefined) out.push({ word: 'addOn.scope', path: 'addOn.scope' });
    // A step's person, its record named by a column and filtered, a choice's help line, and the record's own table and key.
    list(block['steps']).forEach((step, s) => {
      if (!isDoc(step)) return;
      const at = `addOn.steps.${String(s)}`;
      list(step['inputs']).forEach((input, i) => {
        if (!isDoc(input)) return;
        if (input['kind'] === 'person') out.push({ word: 'step.person', path: `${at}.inputs.${String(i)}.kind` });
        if (input['by'] !== undefined) out.push({ word: 'step.recordBy', path: `${at}.inputs.${String(i)}.by` });
        if (input['where'] !== undefined) out.push({ word: 'step.recordWhere', path: `${at}.inputs.${String(i)}.where` });
        if (input['help'] !== undefined) out.push({ word: 'step.help', path: `${at}.inputs.${String(i)}.help` });
        if (list(input['options']).some((option) => isDoc(option) && option['help'] !== undefined)) out.push({ word: 'step.help', path: `${at}.inputs.${String(i)}.options` });
      });
      const writes = isDoc(step['writes']) && isDoc(step['writes']['values']) ? step['writes']['values'] : {};
      for (const [column, value] of Object.entries(writes)) {
        if (isDoc(value) && value['person'] !== undefined) out.push({ word: 'step.person', path: `${at}.writes.values.${column}` });
        if (isDoc(value) && (value['token'] === 'recordTable' || value['token'] === 'recordKey')) out.push({ word: 'step.recordTokens', path: `${at}.writes.values.${column}` });
      }
    });
    // Its link key opening a row as the row's own link; a read for a session of the app's own sign-in.
    list(document['publicAccess']).forEach((entry, e) => {
      if (!isDoc(entry)) return;
      if (isDoc(entry['claim']) && entry['claim']['own'] === true) out.push({ word: 'publicAccess.ownLink', path: `publicAccess.${String(e)}.claim.own` });
      if (Array.isArray(entry['methods']) && entry['methods'].includes('DELETE')) out.push({ word: 'publicAccess.ownDelete', path: `publicAccess.${String(e)}.methods` });
      if (entry['level'] !== undefined && entry['claim'] === undefined && entry['claimedBy'] === undefined && entry['visibleWith'] === undefined) {
        out.push({ word: 'publicAccess.sessionRead', path: `publicAccess.${String(e)}.level` });
      }
    });
    // An amount Adminium decides for a ledger's action (what a card may pay).
    list(block['ledgers']).forEach((ledger, l) => {
      for (const [name, action] of Object.entries(isDoc(ledger) && isDoc(ledger['actions']) ? ledger['actions'] : {})) {
        if (isDoc(action) && action['decides'] !== undefined) out.push({ word: 'ledger.decides', path: `addOn.ledgers.${String(l)}.actions.${name}.decides` });
      }
    });
  } else {
    // An app has always had the other blocks: these two it has only since the install floor.
    if (document['automations'] !== undefined) out.push({ word: 'automations', path: 'automations' });
    if (isDoc(document['sampleData']) && document['sampleData']['addOns'] !== undefined) out.push({ word: 'sampleData.addOns', path: 'sampleData.addOns' });
    for (const key of ['people', 'teams'] as const) {
      if (isDoc(document['sampleData']) && document['sampleData'][key] !== undefined) out.push({ word: 'sampleData.people', path: `sampleData.${key}` });
    }
    if (document['modules'] !== undefined) out.push({ word: 'app.modules', path: 'modules' });
    if (document['maps'] !== undefined) out.push({ word: 'app.maps', path: 'maps' });
    // Starting rows: a release before the floor takes the block and writes none of it.
    if (document['seeds'] !== undefined) out.push({ word: 'app.seeds', path: 'seeds' });
    // A phone side: a server that does not know the side refuses the whole manifest.
    list(document['frontends']).forEach((frontend, f) => {
      if (isDoc(frontend) && frontend['side'] === 'mobile') out.push({ word: 'frontend.mobile', path: `frontends.${String(f)}.side` });
      // Where a record opens on the side: a release before the floor refuses the key.
      if (isDoc(frontend) && frontend['records'] !== undefined) out.push({ word: 'frontend.records', path: `frontends.${String(f)}.records` });
      // A side that serves every install of its app.
      if (isDoc(frontend) && frontend['instances'] !== undefined) out.push({ word: 'frontend.instances', path: `frontends.${String(f)}.instances` });
    });
    // An entry of the app's section that is not a page.
    if (document['navLinks'] !== undefined) out.push({ word: 'navLinks', path: 'navLinks' });
    // A role's grant of a page that is not one of the app's own: an add-on's page or panel.
    const ownPages = new Set(list(document['pages']).flatMap((page) => (isDoc(page) && typeof page['ref'] === 'string' ? [page['ref']] : [])));
    list(document['roles']).forEach((role, r) => {
      list(isDoc(role) ? role['permissions'] : undefined).forEach((grant, g) => {
        const ref = typeof grant === 'string' ? /^page:@([a-z][a-z0-9-]*):view$/.exec(grant)?.[1] : undefined;
        if (ref !== undefined && !ownPages.has(ref)) out.push({ word: 'roles.addOnPages', path: `roles.${String(r)}.permissions.${String(g)}` });
        if (grant === 'privacy:@:people') out.push({ word: 'roles.privacyPeople', path: `roles.${String(r)}.permissions.${String(g)}` });
      });
    });
    // What only a file made on an Adminium carries.
    for (const block of ['reports', 'invoiceLayouts', 'scheduledReports', 'payments'] as const) {
      if (document[block] !== undefined) out.push({ word: block, path: block });
    }
    // A row removed through a public entry of an app (an add-on's own link says `publicAccess.ownDelete`).
    list(document['publicAccess']).forEach((entry, e) => {
      if (isDoc(entry) && Array.isArray(entry['methods']) && entry['methods'].includes('DELETE')) out.push({ word: 'publicAccess.delete', path: `publicAccess.${String(e)}.methods` });
    });
    // The app's people tables.
    if (document['people'] !== undefined) out.push({ word: 'people', path: 'people' });
    list(document['people']).forEach((entry, e) => {
      list(isDoc(entry) ? entry['copies'] : undefined).forEach((copy, c) => {
        if (isDoc(copy) && copy['addOn'] !== undefined) out.push({ word: 'people.addOnCopies', path: `people.${String(e)}.copies.${String(c)}.addOn` });
        if (isDoc(copy) && copy['holds'] === 'details') out.push({ word: 'people.copyDetails', path: `people.${String(e)}.copies.${String(c)}.holds` });
        if (isDoc(copy) && copy['from'] !== undefined) out.push({ word: 'people.addOnCopyFrom', path: `people.${String(e)}.copies.${String(c)}.from` });
      });
    });
  }

  // An agreement on a text's length, on an entry or on its child rows (two levels).
  list(document['publicAccess']).forEach((entry, e) => {
    const lengths = (holder: unknown, at: string): void => {
      if (!isDoc(holder)) return;
      list(holder['agrees']).forEach((agree, a) => {
        if (isDoc(agree) && agree['length'] !== undefined) out.push({ word: 'agrees.length', path: `${at}.agrees.${String(a)}.length` });
      });
      for (const [name, child] of Object.entries(isDoc(holder['children']) ? holder['children'] : {})) lengths(child, `${at}.children.${name}`);
    };
    lengths(entry, `publicAccess.${String(e)}`);
  });

  list(schema['tables']).forEach((table, t) => {
    if (!isDoc(table)) return;
    const at = `requiredSchema.tables.${String(t)}`;
    if (table['indexes'] !== undefined) out.push({ word: 'table.indexes', path: `${at}.indexes` });
    if (table['postings'] !== undefined) out.push({ word: 'table.postings', path: `${at}.postings` });
    if (table['adjust'] !== undefined) out.push({ word: 'table.adjust', path: `${at}.adjust` });
    if (table['check'] !== undefined) out.push({ word: 'table.check', path: `${at}.check` });
    if (table['belongs'] !== undefined) out.push({ word: 'table.belongs', path: `${at}.belongs` });
    list(table['belongs']).forEach((way, w) => {
      if (isDoc(way) && isDoc(way['through']) && way['through']['while'] !== undefined) out.push({ word: 'listing.while', path: `${at}.belongs.${String(w)}.through.while` });
    });
    if (table['private'] !== undefined) out.push({ word: 'table.private', path: `${at}.private` });
    list(table['belongs']).forEach((way, w) => {
      if (!isDoc(way) || typeof way['column'] !== 'string' || way['person'] === undefined) return;
      const link = list(table['columns']).find((column) => isDoc(column) && column['ref'] === way['column']);
      const target = isDoc(link) ? link['references'] : undefined;
      const parent = list(schema['tables']).find((other) => isDoc(other) && other['ref'] === target);
      if (isDoc(parent) && parent['private'] !== undefined) out.push({ word: 'belongs.throughPrivate', path: `${at}.belongs.${String(w)}.person` });
    });
    if (table['builtOn'] !== undefined && isDoc(table['states']) && table['states']['create'] !== undefined) out.push({ word: 'shape.create', path: `${at}.states.create` });
    if (table['appGrants'] !== undefined) out.push({ word: 'table.appGrants', path: `${at}.appGrants` });
    if (isDoc(table['appGrants'])) {
      const actions = list(table['appGrants']['actions']);
      // A table a ledger's code writes, by the add-on's own ledgers.
      const byLedger = addOn && isDoc(document['addOn']) && list(document['addOn']['ledgers']).some((ledger) => isDoc(ledger) && isDoc(ledger['writes']) && Object.prototype.hasOwnProperty.call(ledger['writes'], table['ref'] as string));
      if (actions.includes('read_pii') || actions.includes('delete') || (byLedger && (actions.includes('create') || actions.includes('update')))) out.push({ word: 'appGrants.more', path: `${at}.appGrants.actions` });
    }
    if (table['occupies'] !== undefined) out.push({ word: 'table.occupies', path: `${at}.occupies` });
    if (table['removal'] !== undefined) out.push({ word: 'table.removal', path: `${at}.removal` });
    if (table['keep'] !== undefined) out.push({ word: 'table.keep', path: `${at}.keep` });
    if (table['expire'] !== undefined) out.push({ word: 'table.expire', path: `${at}.expire` });
    if (isDoc(table['states']) && table['states']['actions'] !== undefined) out.push({ word: 'states.actions', path: `${at}.states.actions` });
    list(isDoc(table['states']) ? table['states']['actions'] : undefined).forEach((action, a) => {
      if (isDoc(action) && action['handOver'] !== undefined) out.push({ word: 'states.handOver', path: `${at}.states.actions.${String(a)}.handOver` });
      if (isDoc(action) && action['carries'] !== undefined) out.push({ word: 'states.carries', path: `${at}.states.actions.${String(a)}.carries` });
    });
    if (isDoc(table['states'])) {
      for (const [from, moves] of Object.entries(isDoc(table['states']['moves']) ? table['states']['moves'] : {})) {
        list(moves).forEach((move, m) => {
          if (isDoc(move) && move['planned'] === true) out.push({ word: 'states.planned', path: `${at}.states.moves.${from}.${String(m)}.planned` });
          if (isDoc(move) && isDoc(move['requires']) && move['requires']['notPast'] !== undefined) out.push({ word: 'states.notPast', path: `${at}.states.moves.${from}.${String(m)}.requires.notPast` });
        });
      }
      for (const [child, rule] of Object.entries(isDoc(table['states']['children']) ? table['states']['children'] : {})) {
        if (isDoc(rule) && rule['moveOnCreate'] !== undefined) out.push({ word: 'states.moveOnCreate', path: `${at}.states.children.${child}.moveOnCreate` });
      }
    }
    list(table['columns']).forEach((column, c) => {
      const rules = isDoc(column) && isDoc(column['rules']) ? column['rules'] : null;
      if (rules === null) return;
      const here = `${at}.columns.${String(c)}.rules`;
      if (rules['addOnLink'] !== undefined) out.push({ word: 'column.addOnLink', path: `${here}.addOnLink` });
      // A link filled from the settings row when nobody chooses one.
      if (rules['addOnLink'] !== undefined && rules['default'] !== undefined) out.push({ word: 'column.addOnLink.default', path: `${here}.default` });
      if (rules['tableRef'] !== undefined) out.push({ word: 'column.tableRef', path: `${here}.tableRef` });
      if (rules['staff'] !== undefined) out.push({ word: 'column.staff', path: `${here}.staff` });
      if (rules['mentions'] !== undefined) out.push({ word: 'column.mentions', path: `${here}.mentions` });
      if (rules['place'] !== undefined) out.push({ word: 'column.place', path: `${here}.place` });
      if (rules['area'] !== undefined) out.push({ word: 'column.area', path: `${here}.area` });
      if (rules['linkable'] !== undefined) out.push({ word: 'column.linkable', path: `${here}.linkable` });
      if (isDoc(rules['linkable']) && rules['linkable']['same'] !== undefined) out.push({ word: 'linkable.same', path: `${here}.linkable.same` });
      if (rules['file'] !== undefined) out.push({ word: 'column.file', path: `${here}.file` });
      const file = isDoc(rules['file']) ? rules['file'] : null;
      if (file !== null && file['upload'] !== undefined) out.push({ word: 'file.upload', path: `${here}.file.upload` });
      if (file !== null && list(file['accept']).includes('tiff')) out.push({ word: 'file.tiff', path: `${here}.file.accept` });
      if (file !== null && typeof file['maxBytes'] === 'number' && file['maxBytes'] > FILE_COLUMN_EARLIER_MAX_BYTES) out.push({ word: 'file.large', path: `${here}.file.maxBytes` });
      if (isDoc(rules['file']) && list(rules['file']['accept']).some((kind) => typeof kind === 'string' && ASSET_KINDS.has(kind))) out.push({ word: 'file.assetKinds', path: `${here}.file.accept` });
      if (rules['changes'] !== undefined) out.push({ word: 'column.changes', path: `${here}.changes` });
      if (rules['history'] !== undefined) out.push({ word: 'column.history', path: `${here}.history` });
      for (const key of ['announce', 'plainText', 'customerKey', 'codeLast4'] as const) {
        if (rules[key] !== undefined) out.push({ word: `column.${key}`, path: `${here}.${key}` });
      }
      if (isDoc(rules['code']) && rules['code']['givenByLedger'] !== undefined) out.push({ word: 'code.givenByLedger', path: `${here}.code.givenByLedger` });
      if (isDoc(rules['rollup']) && rules['rollup']['capUnless'] !== undefined) out.push({ word: 'rollup.capUnless', path: `${here}.rollup.capUnless` });
      if (isDoc(rules['sequence']) && rules['sequence']['sample'] !== undefined) out.push({ word: 'sequence.sample', path: `${here}.sequence.sample` });
      if (isDoc(rules['rollup']) && rules['rollup']['latest'] !== undefined) out.push({ word: 'rollup.latest', path: `${here}.rollup.latest` });
      if (isDoc(rules['lookup']) && isDoc(rules['lookup']['table'])) out.push({ word: 'column.addOnLink', path: `${here}.lookup.table` });
      // A bound on a column that is no date, or a span of days: only dates were kept within dates before.
      const type = isDoc(column) ? column['type'] : undefined;
      for (const side of ['notBefore', 'notAfter'] as const) {
        const bound = rules[side];
        if (bound === 'now') out.push({ word: 'bounds.now', path: `${here}.${side}` });
        else if (bound !== undefined && ((type !== 'date' && type !== 'timestamptz') || (isDoc(bound) && bound['days'] !== undefined))) out.push({ word: 'bounds.other', path: `${here}.${side}` });
      }
      if (isDoc(rules['stamp']) && rules['stamp']['strict'] !== undefined) out.push({ word: 'stamp.strict', path: `${here}.stamp.strict` });
      if (rules['band'] !== undefined) out.push({ word: 'column.band', path: `${here}.band` });
      if (isDoc(rules['stamp']) && isDoc(rules['stamp']['set']) && rules['stamp']['set']['addWorkingDays'] !== undefined) {
        out.push({ word: 'stamp.addWorkingDays', path: `${here}.stamp.set.addWorkingDays` });
      }
      if (rules['formula'] !== undefined && roundsUpOrDown(rules['formula'])) out.push({ word: 'formula.ceilFloor', path: `${here}.formula` });
      if (rules['stamp'] !== undefined && rules['requiredWhen'] !== undefined) out.push({ word: 'requiredWhen.stamp', path: `${here}.requiredWhen` });
    });
  });

  list(document['roles']).forEach((role, r) => {
    if (!isDoc(role)) return;
    if (role['tables'] !== undefined) out.push({ word: 'roles.tables', path: `roles.${String(r)}.tables` });
    if (role['names'] !== undefined) out.push({ word: 'roles.names', path: `roles.${String(r)}.names` });
    // An update that reaches a row only while one of its columns holds some value.
    for (const [ref, limit] of Object.entries(isDoc(role['limits']) ? role['limits'] : {})) {
      if (isDoc(limit) && limit['writableFrom'] !== undefined) out.push({ word: 'roles.writableFrom', path: `roles.${String(r)}.limits.${ref}.writableFrom` });
      // A read, an update or a delete that reaches only some rows.
      if (isDoc(limit) && limit['rows'] !== undefined) out.push({ word: 'roles.rows', path: `roles.${String(r)}.limits.${ref}.rows` });
      for (const [action, reach] of Object.entries(isDoc(limit) && isDoc(limit['rows']) ? limit['rows'] : {})) {
        if (Array.isArray(reach)) out.push({ word: 'rows.several', path: `roles.${String(r)}.limits.${ref}.rows.${action}` });
        if ((Array.isArray(reach) ? reach : [reach]).some((one) => isDoc(one) && one['notBy'] !== undefined)) out.push({ word: 'rows.notBy', path: `roles.${String(r)}.limits.${ref}.rows.${action}` });
        if ((Array.isArray(reach) ? reach : [reach]).some((one) => isDoc(one) && one['via'] !== undefined)) out.push({ word: 'rows.via', path: `roles.${String(r)}.limits.${ref}.rows.${action}` });
        if ((Array.isArray(reach) ? reach : [reach]).some((one) => isDoc(one) && one['notThrough'] !== undefined)) out.push({ word: 'rows.notThrough', path: `roles.${String(r)}.limits.${ref}.rows.${action}` });
      }
    }
    if (list(role['tables']).length > 12) out.push({ word: 'roles.addOnActions', path: `roles.${String(r)}.tables` });
    list(role['tables']).forEach((grant, g) => {
      if (isDoc(grant) && (list(grant['actions']).includes('read_pii') || list(grant['actions']).includes('delete'))) out.push({ word: 'roles.addOnActions', path: `roles.${String(r)}.tables.${String(g)}.actions` });
      if (isDoc(grant) && isDoc(grant['limit']) && grant['limit']['writableFrom'] !== undefined) {
        out.push({ word: 'roles.writableFrom', path: `roles.${String(r)}.tables.${String(g)}.limit.writableFrom` });
      }
      if (isDoc(grant) && isDoc(grant['limit']) && grant['limit']['rows'] !== undefined) {
        out.push({ word: 'roles.rows', path: `roles.${String(r)}.tables.${String(g)}.limit.rows` });
        for (const [action, reach] of Object.entries(isDoc(grant['limit']['rows']) ? grant['limit']['rows'] : {})) {
          if (Array.isArray(reach)) out.push({ word: 'rows.several', path: `roles.${String(r)}.tables.${String(g)}.limit.rows.${action}` });
          if ((Array.isArray(reach) ? reach : [reach]).some((one) => isDoc(one) && one['notBy'] !== undefined)) out.push({ word: 'rows.notBy', path: `roles.${String(r)}.tables.${String(g)}.limit.rows.${action}` });
          if ((Array.isArray(reach) ? reach : [reach]).some((one) => isDoc(one) && one['via'] !== undefined)) out.push({ word: 'rows.via', path: `roles.${String(r)}.tables.${String(g)}.limit.rows.${action}` });
          if ((Array.isArray(reach) ? reach : [reach]).some((one) => isDoc(one) && one['notThrough'] !== undefined)) out.push({ word: 'rows.notThrough', path: `roles.${String(r)}.tables.${String(g)}.limit.rows.${action}` });
        }
      }
    });
  });
  // The fields a dashboard's tables are described with: on a column, on a link, on a table.
  if (document['provenance'] !== undefined) out.push({ word: 'app.provenance', path: 'provenance' });
  if (document['icon'] !== undefined) out.push({ word: 'app.icon', path: 'icon' });
  if (isDoc(document['apps']) && document['apps']['requires'] !== undefined) out.push({ word: 'apps.requires', path: 'apps.requires' });
  if (document['instance'] !== undefined) out.push({ word: 'instance', path: 'instance' });
  list(schema['tables']).forEach((table, t) => {
    if (!isDoc(table)) return;
    const at = `requiredSchema.tables.${String(t)}`;
    for (const key of ['exclude', 'existingCustomers', 'switchedOff', 'name', 'schema'] as const) {
      if (table[key] !== undefined) out.push({ word: `table.${key}`, path: `${at}.${key}` });
    }
    list(table['columns']).forEach((column, c) => {
      if (!isDoc(column)) return;
      const here = `${at}.columns.${String(c)}`;
      if (column['type'] === 'time') out.push({ word: 'column.time', path: `${here}.type` });
      if (typeof column['ref'] === 'string' && !/^[a-z][a-z0-9_]*$/.test(column['ref'])) out.push({ word: 'column.name', path: `${here}.ref` });
      for (const key of ['precision', 'hidden', 'yesNo'] as const) {
        if (column[key] !== undefined) out.push({ word: `column.${key}`, path: `${here}.${key}` });
      }
      const relation = isDoc(column['relation']) ? column['relation'] : {};
      if (relation['label'] !== undefined) out.push({ word: 'relation.label', path: `${here}.relation.label` });
      if (relation['remove'] !== undefined) out.push({ word: 'relation.remove', path: `${here}.relation.remove` });
      if (relation['constraint'] !== undefined) out.push({ word: 'relation.noConstraint', path: `${here}.relation.constraint` });
    });
  });
  for (const [name, optionList] of Object.entries(isDoc(document['optionLists']) ? document['optionLists'] : {})) {
    list(isDoc(optionList) ? optionList['values'] : undefined).forEach((value, v) => {
      if (isDoc(value) && value['description'] !== undefined) out.push({ word: 'optionList.description', path: `optionLists.${name}.values.${String(v)}.description` });
    });
  }
  list(document['emailTemplates']).forEach((template, t) => {
    for (const key of ['kind', 'category', 'brand', 'attachments'] as const) {
      if (isDoc(template) && template[key] !== undefined) out.push({ word: `email.${key}`, path: `emailTemplates.${String(t)}.${key}` });
    }
  });
  // A dashboard's second toolbar link, a ranking's named pair, a record page's tab words, a list's bulk action, a board's columns.
  list(document['pages']).forEach((page, p) => {
    if (isDoc(page) && page['envelope'] !== undefined) out.push({ word: 'page.envelope', path: `pages.${String(p)}.envelope` });
    if (isDoc(page) && page['views'] !== undefined) out.push({ word: 'page.views', path: `pages.${String(p)}.views` });
    const config = isDoc(page) && isDoc(page['config']) ? page['config'] : {};
    const here = `pages.${String(p)}.config`;
    // A page kept off the sidebar.
    if (isDoc(page) && isDoc(page['nav']) && page['nav']['offRail'] !== undefined) out.push({ word: 'nav.offRail', path: `pages.${String(p)}.nav.offRail` });
    const toolbar = isDoc(config['layout']) && isDoc(config['layout']['toolbar']) ? config['layout']['toolbar'] : {};
    if (toolbar['links'] !== undefined) out.push({ word: 'toolbar.links', path: `${here}.layout.toolbar.links` });
    if (config['tabs'] !== undefined) out.push({ word: 'config.tabs', path: `${here}.tabs` });
    if (config['bulk'] !== undefined) out.push({ word: 'config.bulk', path: `${here}.bulk` });
    if (config['columns'] !== undefined) out.push({ word: 'config.columns', path: `${here}.columns` });
    if (config['board'] !== undefined) out.push({ word: 'config.board', path: `${here}.board` });
    const board = isDoc(config['board']) ? config['board'] : {};
    const boardCard = isDoc(board['card']) ? board['card'] : {};
    if (board['toolbar'] !== undefined) out.push({ word: 'board.toolbar', path: `${here}.board.toolbar` });
    if (boardCard['secondAmount'] !== undefined) out.push({ word: 'board.secondAmount', path: `${here}.board.card.secondAmount` });
    if (isDoc(boardCard['daysSince']) && (boardCard['daysSince']['label'] !== undefined || boardCard['daysSince']['labels'] !== undefined)) out.push({ word: 'board.daysLabel', path: `${here}.board.card.daysSince.label` });
    // A link to one screen of the app's staff side (`@staff/approvals`): on the toolbar, or a card's.
    const staffPath = (href: unknown): boolean => typeof href === 'string' && href.startsWith('@staff/');
    if (staffPath(isDoc(toolbar['link']) ? toolbar['link']['href'] : undefined)) out.push({ word: 'link.staffPath', path: `${here}.layout.toolbar.link.href` });
    list(toolbar['links']).forEach((link, l) => {
      if (isDoc(link) && staffPath(link['href'])) out.push({ word: 'link.staffPath', path: `${here}.layout.toolbar.links.${String(l)}.href` });
    });
    list(isDoc(config['layout']) ? config['layout']['items'] : undefined).forEach((item, i) => {
      if (!isDoc(item)) return;
      const at = `${here}.layout.items.${String(i)}`;
      if (item['module'] !== undefined) out.push({ word: 'card.module', path: `${at}.module` });
      const card = isDoc(item['config']) ? item['config'] : {};
      if (staffPath(card['href'])) out.push({ word: 'link.staffPath', path: `${at}.config.href` });
      list(card['columns']).forEach((column, c) => {
        if (isDoc(column) && column['labels'] !== undefined) out.push({ word: 'card.columnLabels', path: `${at}.config.columns.${String(c)}.labels` });
      });
    });
  });
  // An email block sent only with, or without, a variable; an add-on's links into its app; rows found by a table-and-row pair.
  const outbox = isDoc(document['outbox']) ? document['outbox'] : {};
  if (isDoc(outbox['pages']) && outbox['pages']['app'] !== undefined) out.push({ word: 'outbox.pages.app', path: 'outbox.pages.app' });
  if (outbox['classes'] !== undefined) out.push({ word: 'outbox.classes', path: 'outbox.classes' });
  if (outbox['purposes'] !== undefined) out.push({ word: 'outbox.purposes', path: 'outbox.purposes' });
  if (outbox['surveyLinks'] !== undefined) out.push({ word: 'outbox.surveyLinks', path: 'outbox.surveyLinks' });
  list(outbox['producers']).forEach((producer, p) => {
    if (isDoc(producer) && producer['replyTo'] !== undefined) out.push({ word: 'outbox.replyTo', path: `outbox.producers.${String(p)}.replyTo` });
    // A message about a row that was removed.
    if (isDoc(producer) && producer['onDelete'] !== undefined) out.push({ word: 'outbox.onDelete', path: `outbox.producers.${String(p)}.onDelete` });
  });
  list(document['emailTemplates']).forEach((template, t) => {
    for (const [locale, content] of Object.entries(isDoc(template) && isDoc(template['locales']) ? template['locales'] : {})) {
      list(isDoc(content) ? content['blocks'] : undefined).forEach((block, b) => {
        const data = isDoc(block) && isDoc(block['data']) ? block['data'] : {};
        const here = `emailTemplates.${String(t)}.locales.${locale}.blocks.${String(b)}.data`;
        if (isDoc(block) && block['showWhen'] !== undefined) out.push({ word: 'email.showWhen', path: `emailTemplates.${String(t)}.locales.${locale}.blocks.${String(b)}.showWhen` });
        for (const mark of ['onlyWith', 'onlyWithout'] as const) if (data[mark] !== undefined) out.push({ word: `email.${mark}`, path: `${here}.${mark}` });
        if (isDoc(data['from']) && data['from']['addOn'] !== undefined) out.push({ word: 'rows.pair', path: `${here}.from` });
        if (isDoc(block) && block['block'] === 'email.image' && typeof data['fileId'] === 'string' && data['fileId'].includes('{{')) out.push({ word: 'email.rowPicture', path: `${here}.fileId` });
      });
    }
  });
  // A placeholder that says its own backup (`{{name|words}}`): in a template, or in a rule's own texts.
  for (const part of ['emailTemplates', 'automations'] as const) {
    list(document[part]).forEach((entry, e) => {
      if (placeholdersIn(JSON.stringify(entry ?? null)).some((placeholder) => placeholder.backup !== undefined)) out.push({ word: 'placeholder.backup', path: `${part}.${String(e)}` });
    });
  }
  // The staff columns of the manifest's tables, by name, and the templates each rule's e-mails send.
  const staffRefs = new Set(
    list(isDoc(document['requiredSchema']) ? document['requiredSchema']['tables'] : undefined).flatMap((table) =>
      list(isDoc(table) ? table['columns'] : undefined).flatMap((column) => (isDoc(column) && isDoc(column['rules']) && column['rules']['staff'] === true && typeof column['ref'] === 'string' ? [column['ref']] : [])),
    ),
  );
  const ruleTemplates = (rule: unknown): string[] => {
    const out: string[] = [];
    const walk = (nodes: unknown): void => {
      for (const node of list(nodes)) {
        if (!isDoc(node)) continue;
        if (isDoc(node['action']) && node['action']['kind'] === 'email' && typeof node['action']['templateKey'] === 'string') out.push(node['action']['templateKey']);
        for (const branch of list(node['branches'])) walk(isDoc(branch) ? branch['nodes'] : undefined);
      }
    };
    walk(isDoc(rule) && isDoc(rule['graph']) ? rule['graph']['nodes'] : undefined);
    return out;
  };
  /** Whether a rule holds an amount of time read from a setting, anywhere in it. */
  const holdsSettingAmount = (value: unknown): boolean =>
    Array.isArray(value) ? value.some(holdsSettingAmount) : isDoc(value) && ((value['amount'] !== undefined && value['unit'] !== undefined && value['setting'] !== undefined) || Object.values(value).some(holdsSettingAmount));
  // More rules than a manifest could ship before.
  if (list(document['automations']).length > 12) out.push({ word: 'automations.many', path: 'automations' });
  if (list(document['automations']).length > 24) out.push({ word: 'automations.more', path: 'automations' });
  // A rule that uses a step an add-on gives.
  list(document['automations']).forEach((rule, r) => {
    const steps = (nodes: unknown, at: string): void => {
      list(nodes).forEach((node, n) => {
        if (!isDoc(node)) return;
        if (isDoc(node['action']) && node['action']['kind'] === 'add-on.step') out.push({ word: 'automations.addOnStep', path: `${at}.${String(n)}.action` });
        const action = isDoc(node['action']) ? node['action'] : {};
        const to = isDoc(action['to']) ? action['to'] : {};
        if ((action['kind'] === 'notification' && to['column'] !== undefined) || (action['kind'] === 'email' && to['kind'] === 'staff')) out.push({ word: 'automations.staffRecipient', path: `${at}.${String(n)}.action.to` });
        if (action['kind'] === 'email' && action['replyTo'] !== undefined) out.push({ word: 'automations.replyTo', path: `${at}.${String(n)}.action.replyTo` });
        if (action['kind'] === 'email' && action['class'] !== undefined) out.push({ word: 'automations.emailClass', path: `${at}.${String(n)}.action.class` });
        if (action['kind'] === 'notification' && (to['lead'] !== undefined || to['else'] !== undefined)) out.push({ word: 'automations.lead', path: `${at}.${String(n)}.action.to` });
        if (action['kind'] === 'notification' && to['lead'] === true && to['else'] === undefined) out.push({ word: 'automations.leadAlone', path: `${at}.${String(n)}.action.to` });
        if ((action['kind'] === 'notification' && to['listed'] !== undefined) || (action['kind'] === 'email' && to['kind'] === 'listed')) out.push({ word: 'automations.listed', path: `${at}.${String(n)}.action.to` });
        if (action['urgent'] !== undefined) out.push({ word: 'automations.urgent', path: `${at}.${String(n)}.action.urgent` });
        if (action['kind'] === 'digest') out.push({ word: 'automations.digest', path: `${at}.${String(n)}.action` });
        if (action['kind'] === 'digest') {
          list(action['sections']).forEach((section, s) => {
            for (const key of ['reach', 'sum', 'by', 'target', 'within'] as const) {
              if (isDoc(section) && section[key] !== undefined) out.push({ word: `digest.${key}`, path: `${at}.${String(n)}.action.sections.${String(s)}.${key}` });
            }
          });
        }
        if (action['kind'] === 'record.create' && action['name'] !== undefined) out.push({ word: 'automations.stepName', path: `${at}.${String(n)}.action.name` });
        if (action['kind'] === 'webhook') out.push({ word: 'automations.webhook', path: `${at}.${String(n)}.action` });
        if (action['kind'] === 'document.render') out.push({ word: 'automations.documentRender', path: `${at}.${String(n)}.action` });
        if (action['kind'] === 'email' && to['kind'] === 'fixed') out.push({ word: 'automations.fixedAddress', path: `${at}.${String(n)}.action.to` });
        if (action['kind'] === 'email' && action['purpose'] !== undefined) out.push({ word: 'automations.purpose', path: `${at}.${String(n)}.action.purpose` });
        // A value read from the settings row, a day so many days on.
        for (const [ref, value] of Object.entries(isDoc(action['values']) ? action['values'] : {})) {
          if (isDoc(value) && value['setting'] !== undefined) out.push({ word: 'automations.settingValue', path: `${at}.${String(n)}.action.values.${ref}` });
          if (isDoc(value) && value['setting'] !== undefined && value['else'] !== undefined) out.push({ word: 'automations.settingElse', path: `${at}.${String(n)}.action.values.${ref}` });
          if (isDoc(value) && value['daysAfter'] !== undefined) out.push({ word: 'automations.daysAfter', path: `${at}.${String(n)}.action.values.${ref}` });
        }
        list(node['branches']).forEach((branch, b) => steps(isDoc(branch) ? branch['nodes'] : undefined, `${at}.${String(n)}.branches.${String(b)}.nodes`));
      });
    };
    steps(isDoc(rule) && isDoc(rule['graph']) ? rule['graph']['nodes'] : undefined, `automations.${String(r)}.graph.nodes`);
    // What a rule reads in its own texts and in the templates its e-mails send: a person's name by a staff column, the record's address.
    const read = [JSON.stringify(rule ?? null), ...ruleTemplates(rule).map((key) => JSON.stringify(list(document['emailTemplates']).find((template) => isDoc(template) && template['key'] === key) ?? null))];
    const names = read.flatMap((text) => placeholdersIn(text).map((placeholder) => placeholder.name));
    if (names.some((name) => name.endsWith('.name') && staffRefs.has(name.split('.').at(-2) ?? ''))) out.push({ word: 'automations.staffName', path: `automations.${String(r)}` });
    if (names.includes('recordUrl')) out.push({ word: 'automations.recordUrl', path: `automations.${String(r)}` });
    if (names.some((name) => name.startsWith('was.'))) out.push({ word: 'automations.was', path: `automations.${String(r)}` });
    if (holdsSettingAmount(rule)) out.push({ word: 'automations.settingAmount', path: `automations.${String(r)}` });
    const forEach = isDoc(rule) && isDoc(rule['trigger']) && isDoc(rule['trigger']['forEach']) ? rule['trigger']['forEach'] : {};
    if (forEach['once'] === 'per-spell') out.push({ word: 'automations.perSpell', path: `automations.${String(r)}.trigger.forEach.once` });
    if (isDoc(rule) && isDoc(rule['trigger']) && rule['trigger']['watch'] !== undefined) out.push({ word: 'automations.watch', path: `automations.${String(r)}.trigger.watch` });
  });
  // An app's e-mail that names the person a staff column names: a template the outbox sends reading `<…>.<staff column>.name`.
  const outboxTemplates = new Set(Object.values(isDoc(outbox['kinds']) ? outbox['kinds'] : {}).filter((key): key is string => typeof key === 'string'));
  list(document['emailTemplates']).forEach((template, t) => {
    if (!isDoc(template) || typeof template['key'] !== 'string' || !outboxTemplates.has(template['key'])) return;
    const names = placeholdersIn(JSON.stringify(template)).map((placeholder) => placeholder.name);
    if (names.some((name) => name.endsWith('.name') && name.split('.').length >= 3 && staffRefs.has(name.split('.').at(-2) ?? ''))) out.push({ word: 'outbox.staffName', path: `emailTemplates.${String(t)}` });
  });
  list(document['documents']).forEach((entry, d) => {
    for (const key of ['options', 'trigger', 'deliver'] as const) {
      if (isDoc(entry) && entry[key] !== undefined) out.push({ word: `documents.${key}`, path: `documents.${String(d)}.${key}` });
    }
    for (const [slot, source] of Object.entries(isDoc(entry) && isDoc(entry['mapping']) ? entry['mapping'] : {})) {
      const sources = isDoc(source) ? [...(isDoc(source['collection']) ? [source['collection']] : []), ...list(source['collections'])] : [];
      if (sources.some((one) => isDoc(one) && one['addOn'] !== undefined)) out.push({ word: 'rows.pair', path: `documents.${String(d)}.mapping.${slot}` });
    }
  });

  list(document['publicAccess']).forEach((entry, e) => {
    if (isDoc(entry) && isDoc(entry['unlockBy']) && entry['unlockBy']['self'] === true) {
      out.push({ word: 'unlockBy.self', path: `publicAccess.${String(e)}.unlockBy` });
    }
    if (isDoc(entry) && entry['words'] !== undefined) out.push({ word: 'availability.words', path: `publicAccess.${String(e)}.words` });
    if (isDoc(entry) && entry['requiresWhen'] !== undefined) out.push({ word: 'publicAccess.requiresWhen', path: `publicAccess.${String(e)}.requiresWhen` });
    if (isDoc(entry) && entry['consent'] !== undefined) out.push({ word: 'publicAccess.consent', path: `publicAccess.${String(e)}.consent` });
    if (isDoc(entry) && entry['key'] === 'forms') out.push({ word: 'publicAccess.forms', path: `publicAccess.${String(e)}.key` });
    if (isDoc(entry) && entry['source'] !== undefined) out.push({ word: 'publicAccess.forms.source', path: `publicAccess.${String(e)}.source` });
    if (isDoc(entry) && entry['appColumn'] !== undefined) out.push({ word: 'publicAccess.appColumn', path: `publicAccess.${String(e)}.appColumn` });
    // A guest's uploads, on the entry or on any level of its child rows.
    const uploadsIn = (node: unknown, path: string): void => {
      if (!isDoc(node)) return;
      if (node['uploads'] !== undefined) out.push({ word: 'publicAccess.uploads', path: `${path}.uploads` });
      for (const [name, child] of Object.entries(isDoc(node['children']) ? node['children'] : {})) uploadsIn(child, `${path}.children.${name}`);
    };
    uploadsIn(entry, `publicAccess.${String(e)}`);
    if (isDoc(entry) && entry['assets'] !== undefined) out.push({ word: 'publicAccess.assets', path: `publicAccess.${String(e)}.assets` });
    // The wider methods and the endpoint's own address, pages, rate and reply.
    if (isDoc(entry) && Array.isArray(entry['methods'])) {
      if (entry['methods'].includes('PUT')) out.push({ word: 'publicAccess.put', path: `publicAccess.${String(e)}.methods` });
      if (entry['methods'].includes('BATCH')) out.push({ word: 'publicAccess.batch', path: `publicAccess.${String(e)}.methods` });
    }
    for (const [key, word] of [['path', 'publicAccess.path'], ['pagination', 'publicAccess.pagination'], ['rateLimit', 'publicAccess.rateLimit'], ['response', 'publicAccess.response']] as const) {
      if (isDoc(entry) && entry[key] !== undefined) out.push({ word, path: `publicAccess.${String(e)}.${key}` });
    }
  });
  return out;
}
