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
  'automations.stepName',
  'automations.many',
  'automations.replyTo',
  'automations.lead',
  'automations.listed',
  'automations.staffName',
  'automations.recordUrl',
  'automations.was',
  'automations.settingAmount',
  'automations.settingValue',
  'automations.daysAfter',
  'outbox.replyTo',
  'outbox.onDelete',
  'column.mentions',
  'column.place',
  'column.area',
  'column.linkable',
  'linkable.same',
  'column.file',
  'config.board',
  'states.notPast',
  'publicAccess.requiresWhen',
  'frontend.records',
  'nav.offRail',
  'navLinks',
  'outbox.staffName',
  'card.module',
  'card.columnLabels',
  'link.staffPath',
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
  // A row a step makes, read by a later step.
  'automations.stepName': '0.3.28',
  // More rules than a manifest could ship before (twelve).
  'automations.many': '0.3.28',
  // A reply that goes to the person a staff column of the row names: a rule's email, an outbox producer's message.
  'automations.replyTo': '0.3.28',
  // A notice to whoever leads a team the person a staff column names is in, and to roles when there is nobody.
  'automations.lead': '0.3.28',
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
  // A move refused once a date of its row has passed, for every writer.
  'states.notPast': '0.3.28',
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
};

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
    if (block['words'] !== undefined) out.push({ word: 'addOn.words', path: 'addOn.words' });
    if (block['recordTabs'] !== undefined) out.push({ word: 'addOn.recordTabs', path: 'addOn.recordTabs' });
    // Pages that also need the data kit.
    if (block['hostApi'] === 2) out.push({ word: 'addOn.hostApi.2', path: 'addOn.hostApi' });
    if (block['lookUp'] !== undefined) out.push({ word: 'addOn.lookUp', path: 'addOn.lookUp' });
    if (block['steps'] !== undefined) out.push({ word: 'addOn.steps', path: 'addOn.steps' });
    if (block['assistant'] !== undefined) out.push({ word: 'addOn.assistant', path: 'addOn.assistant' });
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
    });
    // An entry of the app's section that is not a page.
    if (document['navLinks'] !== undefined) out.push({ word: 'navLinks', path: 'navLinks' });
  }

  list(schema['tables']).forEach((table, t) => {
    if (!isDoc(table)) return;
    const at = `requiredSchema.tables.${String(t)}`;
    if (table['indexes'] !== undefined) out.push({ word: 'table.indexes', path: `${at}.indexes` });
    if (table['postings'] !== undefined) out.push({ word: 'table.postings', path: `${at}.postings` });
    if (table['adjust'] !== undefined) out.push({ word: 'table.adjust', path: `${at}.adjust` });
    if (table['belongs'] !== undefined) out.push({ word: 'table.belongs', path: `${at}.belongs` });
    list(table['belongs']).forEach((way, w) => {
      if (isDoc(way) && isDoc(way['through']) && way['through']['while'] !== undefined) out.push({ word: 'listing.while', path: `${at}.belongs.${String(w)}.through.while` });
    });
    if (table['private'] !== undefined) out.push({ word: 'table.private', path: `${at}.private` });
    if (table['appGrants'] !== undefined) out.push({ word: 'table.appGrants', path: `${at}.appGrants` });
    if (table['occupies'] !== undefined) out.push({ word: 'table.occupies', path: `${at}.occupies` });
    if (isDoc(table['states']) && table['states']['actions'] !== undefined) out.push({ word: 'states.actions', path: `${at}.states.actions` });
    list(isDoc(table['states']) ? table['states']['actions'] : undefined).forEach((action, a) => {
      if (isDoc(action) && action['handOver'] !== undefined) out.push({ word: 'states.handOver', path: `${at}.states.actions.${String(a)}.handOver` });
    });
    if (isDoc(table['states'])) {
      for (const [from, moves] of Object.entries(isDoc(table['states']['moves']) ? table['states']['moves'] : {})) {
        list(moves).forEach((move, m) => {
          if (isDoc(move) && move['planned'] === true) out.push({ word: 'states.planned', path: `${at}.states.moves.${from}.${String(m)}.planned` });
          if (isDoc(move) && isDoc(move['requires']) && move['requires']['notPast'] !== undefined) out.push({ word: 'states.notPast', path: `${at}.states.moves.${from}.${String(m)}.requires.notPast` });
        });
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
      for (const key of ['announce', 'plainText', 'customerKey', 'codeLast4'] as const) {
        if (rules[key] !== undefined) out.push({ word: `column.${key}`, path: `${here}.${key}` });
      }
      if (isDoc(rules['code']) && rules['code']['givenByLedger'] !== undefined) out.push({ word: 'code.givenByLedger', path: `${here}.code.givenByLedger` });
      if (isDoc(rules['rollup']) && rules['rollup']['capUnless'] !== undefined) out.push({ word: 'rollup.capUnless', path: `${here}.rollup.capUnless` });
      if (isDoc(rules['sequence']) && rules['sequence']['sample'] !== undefined) out.push({ word: 'sequence.sample', path: `${here}.sequence.sample` });
      if (isDoc(rules['rollup']) && rules['rollup']['latest'] !== undefined) out.push({ word: 'rollup.latest', path: `${here}.rollup.latest` });
      if (isDoc(rules['lookup']) && isDoc(rules['lookup']['table'])) out.push({ word: 'column.addOnLink', path: `${here}.lookup.table` });
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
      }
    }
    list(role['tables']).forEach((grant, g) => {
      if (isDoc(grant) && isDoc(grant['limit']) && grant['limit']['writableFrom'] !== undefined) {
        out.push({ word: 'roles.writableFrom', path: `roles.${String(r)}.tables.${String(g)}.limit.writableFrom` });
      }
      if (isDoc(grant) && isDoc(grant['limit']) && grant['limit']['rows'] !== undefined) {
        out.push({ word: 'roles.rows', path: `roles.${String(r)}.tables.${String(g)}.limit.rows` });
        for (const [action, reach] of Object.entries(isDoc(grant['limit']['rows']) ? grant['limit']['rows'] : {})) {
          if (Array.isArray(reach)) out.push({ word: 'rows.several', path: `roles.${String(r)}.tables.${String(g)}.limit.rows.${action}` });
        }
      }
    });
  });
  // A dashboard's second toolbar link, a ranking's named pair, a record page's tab words, a list's bulk action, a board's columns.
  list(document['pages']).forEach((page, p) => {
    const config = isDoc(page) && isDoc(page['config']) ? page['config'] : {};
    const here = `pages.${String(p)}.config`;
    // A page kept off the sidebar.
    if (isDoc(page) && isDoc(page['nav']) && page['nav']['offRail'] !== undefined) out.push({ word: 'nav.offRail', path: `pages.${String(p)}.nav.offRail` });
    const toolbar = isDoc(config['layout']) && isDoc(config['layout']['toolbar']) ? config['layout']['toolbar'] : {};
    if (toolbar['links'] !== undefined) out.push({ word: 'toolbar.links', path: `${here}.layout.toolbar.links` });
    if (config['tabs'] !== undefined) out.push({ word: 'config.tabs', path: `${here}.tabs` });
    if (config['bulk'] !== undefined) out.push({ word: 'config.bulk', path: `${here}.bulk` });
    if (config['board'] !== undefined) out.push({ word: 'config.board', path: `${here}.board` });
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
        if (action['kind'] === 'notification' && (to['lead'] !== undefined || to['else'] !== undefined)) out.push({ word: 'automations.lead', path: `${at}.${String(n)}.action.to` });
        if ((action['kind'] === 'notification' && to['listed'] !== undefined) || (action['kind'] === 'email' && to['kind'] === 'listed')) out.push({ word: 'automations.listed', path: `${at}.${String(n)}.action.to` });
        if (action['urgent'] !== undefined) out.push({ word: 'automations.urgent', path: `${at}.${String(n)}.action.urgent` });
        if (action['kind'] === 'digest') out.push({ word: 'automations.digest', path: `${at}.${String(n)}.action` });
        if (action['kind'] === 'digest') {
          list(action['sections']).forEach((section, s) => {
            for (const key of ['reach', 'sum', 'by', 'target'] as const) {
              if (isDoc(section) && section[key] !== undefined) out.push({ word: `digest.${key}`, path: `${at}.${String(n)}.action.sections.${String(s)}.${key}` });
            }
          });
        }
        if (action['kind'] === 'record.create' && action['name'] !== undefined) out.push({ word: 'automations.stepName', path: `${at}.${String(n)}.action.name` });
        // A value read from the settings row, a day so many days on.
        for (const [ref, value] of Object.entries(isDoc(action['values']) ? action['values'] : {})) {
          if (isDoc(value) && value['setting'] !== undefined) out.push({ word: 'automations.settingValue', path: `${at}.${String(n)}.action.values.${ref}` });
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
  });
  // An app's e-mail that names the person a staff column names: a template the outbox sends reading `<…>.<staff column>.name`.
  const outboxTemplates = new Set(Object.values(isDoc(outbox['kinds']) ? outbox['kinds'] : {}).filter((key): key is string => typeof key === 'string'));
  list(document['emailTemplates']).forEach((template, t) => {
    if (!isDoc(template) || typeof template['key'] !== 'string' || !outboxTemplates.has(template['key'])) return;
    const names = placeholdersIn(JSON.stringify(template)).map((placeholder) => placeholder.name);
    if (names.some((name) => name.endsWith('.name') && name.split('.').length >= 3 && staffRefs.has(name.split('.').at(-2) ?? ''))) out.push({ word: 'outbox.staffName', path: `emailTemplates.${String(t)}` });
  });
  list(document['documents']).forEach((entry, d) => {
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
  });
  return out;
}
