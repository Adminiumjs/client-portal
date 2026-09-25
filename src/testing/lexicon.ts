/*
 * COPIED from add-ons/packages/host-kit/src/guards/lexicon.ts by scripts/sync-lexicon.mjs.
 * Never hand-edit: change the kit and re-run the script. Tests only; nothing that ships imports it.
 */
export const SUBSTRING_BANNED = [
  'pricing',
  'plan',
  'tier',
  'billing',
  'upgrade',
  'free',
  'premium',
  '/mo',
] as const;

/**
 * The one the add-on rules add that is a WORD rather than a substring.
 *
 * "pro" is not in the release sweep's run of substrings and must not be turned
 * into one: a shop that makes things says "proof", "process", "product" and
 * "properties" on nearly every screen, and a substring rule over those would
 * trade a real defect for an imaginary one. What the rule forbids is the
 * marketing word — a "Pro" add-on, a "Pro" account — so it is checked as a
 * standalone token, and the places a translator legitimately wrote it are
 * allowed by exact phrase in `PRO_PHRASES`.
 */
export const WORD_BANNED = ['pro'] as const;

/** One non-English word that happens to spell an English marketing word. */
export interface HomographToken {
  token: string;
  language: string;
  means: string;
}

/**
 * The only tokens allowed to carry a banned substring.
 *
 * Each entry is an EXACT token, matched case-insensitively against the whole
 * run of word characters around the hit — never a loosened pattern. "planen" is
 * allowed; "plan", "planning" and "planned" are not, and an English sentence
 * that reaches for any of them fails the gate exactly as the release would.
 *
 * Everything here is a word in one of the seven non-English locales. Forcing a
 * translator away from the ordinary word in their own language would be trading
 * a real defect for an imaginary one; naming the word costs one line.
 */
export const HOMOGRAPH_TOKENS: readonly HomographToken[] = [
  {
    token: 'eingeplant',
    language: 'German',
    means: '“scheduled in” — the past participle of einplanen, used of work that has a slot',
  },
  {
    token: 'planen',
    language: 'Danish (also German)',
    means: 'Danish “the schedule” (the definite form of plan); German “to plan”',
  },
  {
    token: 'Planches',
    language: 'French',
    means: '“sheets”, the plural of planche — a sheet of die-cut stickers',
  },
  {
    token: 'tarifs',
    language: 'French',
    means:
      '“rates” — what a carrier charges to carry a parcel, the plural of tarif. ' +
      'The German Tarif is a PLAN and is banned; this exact plural is not a German ' +
      'word, so the singular, Tarife and Tarifwechsel all still fail',
  },
];

/** One phrase in which a standalone "pro" is a preposition rather than a tier. */
export interface ProPhrase {
  phrase: string;
  language: string;
  means: string;
}

/**
 * The only phrases allowed to contain a standalone "pro".
 *
 * A phrase and not a token, because the token IS "pro" in every case and an
 * allow-list of the bare token would wave the English marketing word straight
 * through. Each entry must match from the "pro" onwards, case-insensitively.
 *
 * THESE BELONG TO THE LANGUAGES AND NOT TO ANY SHOP, which is the whole reason
 * they are in the kit. `maker-shop`'s copy of this list was empty, with a
 * comment saying its eight locales had been written around the ban and needed
 * no allowance — true of that app's own copy, and the wrong thing to encode.
 * Registering a portable add-on whose Czech permission line reads
 * "Číst zakázku, pro kterou se návrh dělá" turned that host's gate RED, while
 * the same add-on passed in the print works, which happened to carry the
 * phrase. One list, every host, no edits on install.
 */
export const PRO_PHRASES: readonly ProPhrase[] = [
  { phrase: 'pro Stück', language: 'German', means: '“per item”, i.e. each' },
  { phrase: 'pro kterou', language: 'Czech', means: '“for which”' },
  { phrase: 'pro účetnictví', language: 'Czech', means: '“for the accounts”' },
  {
    phrase: 'pro {ref}',
    language: 'Czech',
    means: 'the preposition “for” in front of a reference placeholder',
  },
];

/**
 * ── THE BANNED IDEAS, SPELT IN EVERY LANGUAGE ───────────────────────────────
 *
 * What this replaced, in the repos it was extracted from, was a table holding
 * per language the spelling of ONE idea — "premium". It was a fingerprint, and
 * it was proven blind: planting "الترقية إلى الباقة المدفوعة" ("upgrade to the
 * paid plan") in an ar-EG bundle and "Jetzt auf den bezahlten Tarif wechseln"
 * ("switch to the paid tariff now") in a de-DE one left every built-output case
 * green. Neither sentence contains an English banned run, and neither is the
 * word "premium".
 *
 * So the table below is `IDEA × LANGUAGE` and it is TOTAL BY TYPE: every idea
 * has a cell in every non-English language, and adding a language or an idea is
 * a compile failure until somebody fills the cells in.
 *
 * ── AND TOTAL BY TYPE IS NOT COMPLETE, WHICH IS THIS FILE'S OWN TRAP ────────
 *
 * YOU CANNOT FORGET A CELL; YOU CAN LEAVE EVERY CELL SHORT. Each one is a
 * hand-picked list of stems, so the table catches its own examples and looks
 * finished while doing it. Two plants walked through it:
 *
 *     "Wechseln Sie jetzt zur kostenpflichtigen Vollversion."   (de-DE)
 *     "انتقل إلى النسخة المدفوعة للحصول على مزايا إضافية."        (ar-EG)
 *
 * "Switch now to the paid full version" and "move to the paid version for extra
 * benefits" — a paid-tier upsell in two shipped locales, with every case green.
 * Neither says Tarif, Abo, Preisstufe, باقة or ترقية. They did not have to: a
 * language has more than one way to say a thing, and a stem list knows the ways
 * its author thought of.
 *
 * ── A COMPLETE MECHANICAL RULE HERE IS IMPOSSIBLE, AND SAYING SO IS THE ─────
 * ── ONLY HONEST THING TO DO ─────────────────────────────────────────────────
 *
 * The rule being enforced is: v1 ships completely free of charge, so no
 * sentence anywhere may raise the subject of paying for the product. Deciding
 * whether an arbitrary sentence in seven languages raises that subject is
 * reading for MEANING. No list of stems can do it and a bigger table would only
 * be a slower way to arrive back here.
 *
 * SO THIS TABLE IS A REGRESSION SET. It holds every spelling that has actually
 * got through, and it will go on growing that way. A green run means "nothing
 * we have been bitten by before", never "no upsell in this bundle". A reviewer
 * still has to ask, of every new or changed string in any locale: does this
 * sentence tell the reader that something costs money, or that more of the
 * product can be had by paying — in any words at all?
 *
 * ── AND WHY THE STEMS ARE THE COMMERCIAL ONES, NOT THE ORDINARY ONES ────────
 *
 * A shop says "price" on every page and must go on saying it: the English ban
 * is on `pricing`, not `price`, and the same distinction has to be kept in each
 * language or the gate fails on copy that is simply copy. So German is
 * `Preisgestaltung` and not `Preis`, French is `tarification` and not `tarif`,
 * Czech is `cenový plán` and not `cena`. Three words that would have been
 * obvious choices are DELIBERATELY ABSENT, each because it means something
 * ordinary in a shop that posts parcels: German `Paket`, Czech `balíček` and
 * Danish `pakke` all mean "parcel", and banning them would ban a delivery
 * add-on's own vocabulary in three languages.
 */

/**
 * The ideas the release sweep and the add-on rules forbid, named once.
 *
 * `paid` ON ITS OWN IS DELIBERATELY NOT ONE OF THEM, and the attempt is worth
 * recording. It was in this list for one run and came straight back out: a shop
 * is PAID for what it makes, so a confirm screen reads "المدفوع" and an add-on
 * shelf has a "المدفوعات" category, both ordinary and both hits.
 *
 * `paid-version` IS one of them. "The paid version" and "the full version" are
 * how an upsell is written when the writer is not reaching for a plan or a
 * tier — which is what both plants above did. The phrase is the unit: `paid`
 * alone is a shop's own word, `paid version` is never anything else.
 */
export const BANNED_IDEAS = [
  'pricing',
  'plan',
  'tier',
  'billing',
  'upgrade',
  'free',
  'premium',
  'paid-version',
] as const;

export type BannedIdea = (typeof BANNED_IDEAS)[number];

/** The seven languages whose spellings the English substring ban cannot see. */
export const OTHER_LANGUAGES = [
  'de-DE',
  'fr-FR',
  'cs-CZ',
  'da-DK',
  'zh-CN',
  'zh-TW',
  'ar-EG',
] as const;

export type OtherLanguage = (typeof OTHER_LANGUAGES)[number];

/**
 * TOTAL BY TYPE, WHICH IS WHAT MAKES IT A RULE RATHER THAN A LIST.
 *
 * `Record<Language, Record<BannedIdea, …>>` over the two arrays above: delete a
 * cell and `tsc` names the missing idea; add a language or an idea and every
 * gap is a compile error until somebody fills it in. A list can be short and
 * look finished — that is exactly what the one-word table it replaced did.
 */
export const IDEA_IN_LANGUAGE: Record<OtherLanguage, Record<BannedIdea, RegExp[]>> = {
  'de-DE': {
    // Preisgestaltung/Preismodell — never bare `Preis`, which is what every
    // product page says, and never `Preisliste`: a delivery add-on's German
    // copy says "Die Preisliste dahinter wird … gepflegt" of a carrier's own
    // rate card, and a PRICE LIST is a thing a shop has. English bans `pricing`
    // and does not ban `price list` either.
    pricing: [/preisgestaltung/i, /preismodell/i],
    // `Tarif` is the word the first plant used. A shop never says it; a mobile
    // network does.
    plan: [/\btarif/i, /\babo\b/i, /abonnement/i],
    tier: [/preisstufe/i, /\bstufenpreis/i, /\btarif/i],
    billing: [/abrechnung/i, /rechnungsstellung/i],
    // German borrows "Upgrade", which the English substring ban already sees;
    // these are the German-formed alternatives it does not.
    upgrade: [/höherstufen/i, /hochstufen/i, /aufwerten auf/i],
    free: [/kostenlos/i, /\bgratis/i, /umsonst/i],
    premium: [/premium/i, /\bprofi/i],
    // THE SECOND PLANT: "Wechseln Sie jetzt zur kostenpflichtigen
    // Vollversion." `kostenpflichtig` is "subject to a charge" and a shop never
    // says it; `Vollversion`/`Bezahlversion` are the software-upsell words.
    // Bare `Kosten` is absent on purpose — a shop talks about costs.
    'paid-version': [/kostenpflichtig/i, /vollversion/i, /bezahlversion/i],
  },
  'fr-FR': {
    // `tarif` alone is French for "rate" and is legitimate on a delivery page.
    pricing: [/tarification/i, /grille tarifaire/i],
    plan: [/forfait/i, /abonnement/i],
    // NEVER bare `palier`: it is the French for a quantity BREAK, and a price
    // page is legitimately headed "Paliers de quantité". English calls those
    // "breaks" and does not ban the word either.
    tier: [/palier tarifaire/i, /niveau tarifaire/i],
    billing: [/facturation/i],
    upgrade: [/mise à niveau/i, /surclassement/i, /passer à l'offre/i],
    free: [/gratuit/i],
    premium: [/premium/i],
    // `payant` qualifies a THING that costs; a shop quotes prices without it.
    'paid-version': [/version payante/i, /version complète/i, /offre payante/i],
  },
  'cs-CZ': {
    // `ceník` is an ordinary price list and a shop has one; `cenový plán` is
    // the commercial idea.
    pricing: [/cenový plán/i, /cenová politika/i],
    plan: [/\btarif/i, /předplatn/i],
    tier: [/cenová hladina/i, /\btarif/i],
    billing: [/fakturace/i, /vyúčtování/i],
    upgrade: [/povýšit na/i, /vyšší tarif/i],
    free: [/zdarma/i, /zadarmo/i, /bezplatn/i],
    premium: [/prémiov/i, /profesionál/i],
    // `placená verze` / `plná verze`. `\S*` rather than `\w*`: Czech endings
    // are accented and `\w` is ASCII, so `plná verze` slipped a `\w*` pattern.
    'paid-version': [/placen\S*\s+verz/i, /pln\S*\s+verz/i],
  },
  'da-DK': {
    // `prisliste` is an ordinary price list; `prisplan`/`prismodel` are not.
    pricing: [/prisplan/i, /prismodel/i],
    plan: [/abonnement/i],
    tier: [/prisniveau/i, /pristrin/i],
    billing: [/fakturering/i, /betalingsplan/i],
    // Danish borrows "upgrade" as `opgradering`, which the substring ban does
    // NOT see — `opgrader` is not `upgrade`.
    upgrade: [/opgrader/i],
    free: [/\bgratis/i, /vederlagsfri/i],
    premium: [/premium/i],
    'paid-version': [/betalingsversion/i, /betalt version/i, /fuld version/i],
  },
  'zh-CN': {
    pricing: [/定价/, /价格方案/],
    plan: [/套餐/, /订阅/],
    // NEVER bare `档位`: delivery copy legitimately says 档位由我们替您选好 of the
    // weight bracket a parcel falls into, which is a bracket and not a plan.
    tier: [/价格档/, /套餐档/],
    billing: [/账单/, /计费/],
    upgrade: [/升级/],
    free: [/免费/],
    premium: [/高级版/, /专业版/],
    'paid-version': [/付费版/, /完整版/],
  },
  'zh-TW': {
    pricing: [/定價/, /價格方案/],
    plan: [/方案/, /訂閱/],
    // NEVER bare `級距`, for the same reason as zh-CN's 档位.
    tier: [/價格級/, /方案級/],
    billing: [/帳單/, /計費/],
    upgrade: [/升級/],
    free: [/免費/],
    premium: [/高級版/, /專業版/],
    'paid-version': [/付費版/, /完整版/],
  },
  'ar-EG': {
    pricing: [/التسعير/, /تسعير/],
    // `باقة` — the first plant's word for a package a shop pays for.
    plan: [/باقة/, /الباقة/, /اشتراك/],
    tier: [/فئة سعرية/, /مستوى سعري/],
    billing: [/فوترة/, /الفوترة/],
    // `ترقية` — the first plant's word for "upgrade".
    upgrade: [/ترقية/],
    free: [/مجان/],
    premium: [/احترافي/, /مميز/],
    // THE OTHER PLANT: "انتقل إلى النسخة المدفوعة …". The PHRASE, never bare
    // مدفوع — a shop's own confirm screen says المدفوع of an order.
    'paid-version': [/النسخة المدفوعة/, /نسخة مدفوعة/, /الإصدار المدفوع/, /النسخة الكاملة/],
  },
};

/**
 * The per-locale view a message-bundle gate wants.
 *
 * `en-US` is the English substring ban's own job, so its only entry is what the
 * add-on rules add on top plus the phrase an adversarial review planted,
 * WRITTEN IN ENGLISH: the sweep's substring run covers
 * `pricing plan tier billing upgrade free /mo` and none of them appears in
 * "switch to the paid version for more". The hole was in every language
 * including this one.
 */
export const TIERING_WORDS: Readonly<Record<string, readonly RegExp[]>> = {
  'en-US': [/premium/i, /paid version/i, /full version/i, /paid account/i],
  ...Object.fromEntries(
    OTHER_LANGUAGES.map((language) => [
      language,
      BANNED_IDEAS.flatMap((idea) => IDEA_IN_LANGUAGE[language][idea]),
    ]),
  ),
};

/**
 * Every pattern above, flattened.
 *
 * A built file carries all eight locales interleaved and there is no way to
 * attribute a byte back to the language it came from, so a check over built
 * output runs the UNION. That is stricter than the per-locale check, which is
 * the right direction.
 */
export const TIERING_PATTERNS: readonly RegExp[] = Object.values(TIERING_WORDS).flat();
