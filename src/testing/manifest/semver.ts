/*
 * VENDORED VERBATIM from packages/manifest/src/semver.ts.
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
 * Version ordering and the one range form a manifest writes.
 *
 * Deliberately small: no dependency, and pure so a browser can validate a
 * manifest. Everything compares the RELEASE TRIPLE only — a pre-release or
 * build tail is ignored — which is what the compatibility window and the
 * upgrade ordering have always done.
 */

/**
 * Numeric semver compare on the release triple (pre-release/build ignored —
 * enough for the compatibility-window and upgrade ordering checks). Returns
 * <0, 0, >0. Exported for the installer's upgrade rule.
 */
export function compareSemver(a: string, b: string): number {
  const triple = (v: string): number[] =>
    v
      .split('+')[0]!
      .split('-')[0]!
      .split('.')
      .map((n) => Number.parseInt(n, 10));
  const [a1 = 0, a2 = 0, a3 = 0] = triple(a);
  const [b1 = 0, b2 = 0, b3 = 0] = triple(b);
  return a1 - b1 || a2 - b2 || a3 - b3;
}

const VERSION = String.raw`(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?`;
const COMPARATOR = new RegExp(`^(>=|<=|>|<|=|\\^|~)?(${VERSION})$`);

type Comparator = { op: '>=' | '<=' | '>' | '<' | '='; version: string };

/** `^1.2.3` → `>=1.2.3 <2.0.0` (`<0.3.0` below 1.0.0); `~1.2.3` → `>=1.2.3 <1.3.0`. */
function expand(op: string, version: string): Comparator[] {
  const [major = 0, minor = 0] = version.split('-')[0]!.split('.').map(Number);
  if (op === '^') {
    const upper = major > 0 ? `${String(major + 1)}.0.0` : `0.${String(minor + 1)}.0`;
    return [{ op: '>=', version }, { op: '<', version: upper }];
  }
  if (op === '~') return [{ op: '>=', version }, { op: '<', version: `${String(major)}.${String(minor + 1)}.0` }];
  return [{ op: (op === '' ? '=' : op) as Comparator['op'], version }];
}

/**
 * A range as sets of comparators: `||` separates alternatives, spaces join
 * comparators that must all hold. Accepts `>=0.2.0`, `>=0.2.0 <1.0.0`,
 * `^0.2.0`, `~0.2.1`, `0.2.0` and `*`. Null when the text is not one.
 */
export function parseSemverRange(range: string): Comparator[][] | null {
  const alternatives = range.split('||').map((part) => part.trim());
  const sets: Comparator[][] = [];
  for (const alternative of alternatives) {
    if (alternative === '*') {
      sets.push([]);
      continue;
    }
    if (alternative === '') return null;
    const set: Comparator[] = [];
    for (const word of alternative.split(/\s+/)) {
      const match = COMPARATOR.exec(word);
      if (match === null) return null;
      set.push(...expand(match[1] ?? '', match[2]!));
    }
    sets.push(set);
  }
  return sets;
}

/** Whether `version` falls inside `range`; false for a range that does not parse. */
export function satisfiesSemverRange(version: string, range: string): boolean {
  const sets = parseSemverRange(range);
  if (sets === null) return false;
  return sets.some((set) =>
    set.every(({ op, version: bound }) => {
      const order = compareSemver(version, bound);
      switch (op) {
        case '>=':
          return order >= 0;
        case '<=':
          return order <= 0;
        case '>':
          return order > 0;
        case '<':
          return order < 0;
        default:
          return order === 0;
      }
    }),
  );
}
