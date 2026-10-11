/*
 * VENDORED VERBATIM from packages/manifest/src/steps.ts.
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
 * WHAT A MANIFEST CAN CHECK OF AN ADD-ON'S STEPS (`addOn.steps`).
 *
 * The shape of a step is the contracts package's (`addOnStepSchema`). Here it
 * is held against the add-on's own tables: the row a step writes is one of
 * them, every column it fills is there and is not one Adminium decides, every
 * input is used, and no column the row cannot be saved without is left
 * unfilled. So a step that installs is a step that can run.
 */
import type { AddOnStep } from './add-on-steps.ts';

/** What the checks read of a table. */
export interface StepTableShape {
  ref: string;
  columns: readonly {
    ref: string;
    type: string;
    role?: string | undefined;
    nullable?: boolean | undefined;
    default?: unknown;
    rules?: Readonly<Record<string, unknown>> | undefined;
  }[];
}

/** The column rules through which Adminium fills a column itself: a step cannot write one. */
const DECIDED_BY = ['copy', 'default', 'sequence', 'format', 'code', 'codeLast4', 'customerKey', 'rollup', 'formula', 'stamp', 'perNight'] as const;
/**
 * The column rules that only judge or tidy a value somebody gives. A column
 * that must hold a value and carries none but these has to be filled by the
 * step; one with any other rule is left to the save, which knows that rule.
 */
const ONLY_JUDGES: ReadonlySet<string> = new Set(['options', 'validation', 'required', 'requiredWhen', 'notAfter', 'notBefore', 'personal', 'plainText', 'normalize']);

type Issue = { path: (string | number)[]; message: string };

/** Everything wrong with an add-on's steps that only its own tables can say. */
export function stepsIssues(steps: readonly AddOnStep[], tables: readonly StepTableShape[]): Issue[] {
  const out: Issue[] = [];
  const byRef = new Map(tables.map((table) => [table.ref, table]));
  steps.forEach((step, s) => {
    const at = (...rest: (string | number)[]) => ['addOn', 'steps', s, ...rest];
    const inputs = new Map(step.inputs.map((input) => [input.key, input]));
    step.inputs.forEach((input, i) => {
      if (input.table !== undefined && !byRef.has(input.table)) out.push({ path: at('inputs', i, 'table'), message: `"${input.table}" is not one of this add-on's tables` });
    });
    const table = byRef.get(step.writes.table);
    if (table === undefined) {
      out.push({ path: at('writes', 'table'), message: `"${step.writes.table}" is not one of this add-on's tables: a step writes a row of the add-on's own` });
      return;
    }
    const used = new Set<string>();
    for (const [ref, value] of Object.entries(step.writes.values)) {
      const column = table.columns.find((candidate) => candidate.ref === ref);
      if (column === undefined) {
        out.push({ path: at('writes', 'values', ref), message: `"${table.ref}" has no column "${ref}"` });
        continue;
      }
      const decided = DECIDED_BY.find((rule) => column.rules?.[rule] !== undefined);
      if (column.role === 'pk' || decided !== undefined) {
        out.push({ path: at('writes', 'values', ref), message: `"${table.ref}.${ref}" is decided by Adminium${decided === undefined ? ' (its key)' : ` (its ${decided} rule)`}: a step cannot write it` });
      }
      if ('input' in value) {
        if (inputs.has(value.input)) used.add(value.input);
        else out.push({ path: at('writes', 'values', ref, 'input'), message: `"${value.input}" is not one of this step's inputs` });
      }
    }
    step.inputs.forEach((input, i) => {
      if (!used.has(input.key)) out.push({ path: at('inputs', i), message: `no value of the row reads the input "${input.key}": write it to a column, or take it out` });
    });
    for (const column of table.columns) {
      if (step.writes.values[column.ref] !== undefined) continue;
      if (column.role === 'pk' || column.nullable === true || column.default !== undefined) continue;
      if (!Object.keys(column.rules ?? {}).every((rule) => ONLY_JUDGES.has(rule))) continue;
      out.push({ path: at('writes', 'values'), message: `"${table.ref}.${column.ref}" must hold a value and nothing fills it: give it a value, or the step fails every time it runs` });
    }
    // A column a row cannot be saved without is not left to an input a person may skip.
    for (const [ref, value] of Object.entries(step.writes.values)) {
      const column = table.columns.find((candidate) => candidate.ref === ref);
      if (column === undefined || !('input' in value)) continue;
      const input = inputs.get(value.input);
      if (input === undefined || input.required === true) continue;
      if (column.role === 'pk' || column.nullable === true || column.default !== undefined) continue;
      out.push({ path: at('writes', 'values', ref, 'input'), message: `"${table.ref}.${ref}" must hold a value: mark the input "${input.key}" as required` });
    }
  });
  return out;
}
