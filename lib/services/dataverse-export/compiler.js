/**
 * Dataverse Power Tools — Track B — QuerySpec → FetchXML compiler.
 *
 * The spine invariant (design doc §"Shared spine"; build plan §2): a
 * structured spec is COMPILED deterministically; nothing interprets intent
 * and acts. This module is a pure function — no I/O, no taxonomy fetch, no
 * paging. It (1) validates a QuerySpec against the closed §2.1 contract and
 * (2) compiles a valid spec to FetchXML + a parallel aggregate-count
 * FetchXML, returning `appliedRules[]` so the methods sheet can state in
 * plain English exactly what was applied.
 *
 * Status / semantic determinations are OWNED by
 * docs/DATAVERSE_POWER_TOOLS_DESIGN.md ("Residuals — AUTHORITATIVE LIST")
 * and bound here via lib/services/dataverse-export/constants.js. This file
 * does NOT re-derive them.
 */

import {
  ERA,
  ERA_CUTOVER_DATE,
  AMOUNT_WHICH,
  OPERATIONAL_EXCLUSION,
  TEST_RECORD_APPLICANT_NAME,
  PROGRAM_ROLLUP,
} from './constants.js';
import { TEST_REQUEST_ORDINARY_FETCHXML_FILTER } from '../test-requests/isolation.js';

const ENTITY = 'akoya_request';

// ─────────────────────────────────────────────────────────────────────────
// §2.1 — the closed axis set + operators-by-axis-kind
// ─────────────────────────────────────────────────────────────────────────

// axis → { field, kind }. `kind` selects the legal-operator set.
//   guid     : GUID/optionset-valued (eq,in,notnull,null)
//   money    : currency (eq,gt,gte,lt,lte,between)
//   date     : (between,onorafter,onorbefore)
//   identity : string/identity (eq,contains,in)
const AXES = {
  program: { field: 'akoya_programid', kind: 'guid' },
  fundingCategory: { field: 'wmkf_grantprogram', kind: 'guid' },
  // dateBasis: akoya_decisiondate ONLY. createdon is provenance, never a
  // history filter — a hard reject below (CREATEDON_AS_DATE).
  dateBasis: { field: 'akoya_decisiondate', kind: 'date' },
  amount: { field: null, kind: 'money' }, // field resolved from `which`
  // akoya_requeststatus is a String field but its values are a DISCRETE live
  // taxonomy — treated as enum-kind (eq/in/notnull/null), not free-text
  // (Codex S160 P1: `contains` on a taxonomy value is not meaningful). A
  // filter literal is still compiled literally; living-taxonomy currency is a
  // PREVIEW concern, never a compiler 422 (§2.1 point 4).
  status: { field: 'akoya_requeststatus', kind: 'enum' },
  type: { field: 'wmkf_type', kind: 'guid' },
  institution: { field: 'akoya_applicantid', kind: 'identity' },
  // §2.1 lists BOTH wmkf_request_type AND akoya_requesttype — the filter
  // picks via `field` (default wmkf_request_type); a field outside the pair
  // is rejected (Codex S160 P1).
  requestType: { field: 'wmkf_request_type', kind: 'guid',
    fields: ['wmkf_request_type', 'akoya_requesttype'] },
};

const LEGAL_OPS = {
  guid: new Set(['eq', 'in', 'notnull', 'null']),
  enum: new Set(['eq', 'in', 'notnull', 'null']),
  money: new Set(['eq', 'gt', 'gte', 'lt', 'lte', 'between']),
  date: new Set(['between', 'onorafter', 'onorbefore']),
  identity: new Set(['eq', 'contains', 'in']),
};

const AMOUNT_WHICH_VALUES = new Set(Object.keys(AMOUNT_WHICH));
const KNOWN_VERSION = 1;
const VALID_ERA_SCOPE = new Set(['all', ERA.MIGRATED, ERA.NATIVE]);
const VALID_PROGRAM_ROLLUP = new Set([PROGRAM_ROLLUP.OPTION_B]);

// QuerySpec op → FetchXML operator (single-value ops; multi-value/range
// handled structurally in compileFilter).
const FX_OP = {
  eq: 'eq',
  gt: 'gt',
  gte: 'ge',
  lt: 'lt',
  lte: 'le',
  notnull: 'not-null',
  null: 'null',
  onorafter: 'on-or-after',
  onorbefore: 'on-or-before',
  contains: 'like',
};

// ─────────────────────────────────────────────────────────────────────────
// Validation (§2.1) — preview & run both run this; identical.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Validate a QuerySpec against the closed §2.1 contract.
 * @returns {{ valid: true }} | { valid:false, status:422, body:{ error, violations } }
 *
 * The builder cannot emit an invalid spec by construction; this exists
 * because the spec is the public Phase-2 seam (AI will emit it) and a
 * hand-rolled/AI spec MUST fail closed and legibly, never partially execute.
 */
function validateQuerySpec(spec) {
  const v = [];
  const push = (code, path, detail) => v.push({ code, path, detail });

  if (spec == null || typeof spec !== 'object') {
    push('VERSION_UNKNOWN', 'version', 'QuerySpec must be an object');
    return invalid(v);
  }

  // (1) version known
  if (spec.version !== KNOWN_VERSION) {
    push('VERSION_UNKNOWN', 'version',
      `unknown QuerySpec version ${JSON.stringify(spec.version)} (known: ${KNOWN_VERSION})`);
  }

  // entity is fixed in v1
  if (spec.entity !== undefined && spec.entity !== ENTITY) {
    push('AXIS_UNKNOWN', 'entity', `entity must be "${ENTITY}" in v1`);
  }

  // (2)(3)(5)(6) per-filter
  const filters = Array.isArray(spec.filters) ? spec.filters : null;
  if (spec.filters !== undefined && filters === null) {
    push('AXIS_UNKNOWN', 'filters', 'filters must be an array when present');
  }
  (filters || []).forEach((f, i) => {
    const base = `filters[${i}]`;
    if (f == null || typeof f !== 'object') {
      push('AXIS_UNKNOWN', base, 'filter must be an object');
      return;
    }
    const axisDef = AXES[f.axis];
    // (2) axis in the closed set
    if (!axisDef) {
      push('AXIS_UNKNOWN', `${base}.axis`,
        `unknown axis ${JSON.stringify(f.axis)} (closed set: ${Object.keys(AXES).join(', ')})`);
      return;
    }
    // requestType: field must be one of the §2.1 pair when specified.
    if (f.axis === 'requestType' && f.field && !axisDef.fields.includes(f.field)) {
      push('AXIS_UNKNOWN', `${base}.field`,
        `requestType.field must be one of {${axisDef.fields.join(', ')}} `
        + `(got ${JSON.stringify(f.field)})`);
    }
    // (5) dateBasis hard reject of createdon — createdon is provenance, never
    //     a business-history filter.
    if (f.axis === 'dateBasis' && f.field && f.field !== 'akoya_decisiondate') {
      if (f.field === 'createdon') {
        push('CREATEDON_AS_DATE', `${base}.field`,
          'createdon is creation provenance, never a business-history filter — '
          + 'time-slice on akoya_decisiondate');
      } else {
        push('AXIS_UNKNOWN', `${base}.field`,
          `dateBasis.field must be akoya_decisiondate (got ${JSON.stringify(f.field)})`);
      }
    }
    // (6) amount requires `which`
    let kind = axisDef.kind;
    if (f.axis === 'amount') {
      if (f.which === undefined || f.which === null) {
        push('AMOUNT_WHICH_MISSING', `${base}.which`,
          `amount filter requires which ∈ {${[...AMOUNT_WHICH_VALUES].join(', ')}}`);
      } else if (!AMOUNT_WHICH_VALUES.has(f.which)) {
        push('AMOUNT_WHICH_MISSING', `${base}.which`,
          `unknown amount.which ${JSON.stringify(f.which)}`);
      }
    }
    // (3) (axis, op) legal
    const legal = LEGAL_OPS[kind];
    if (!f.op || !legal.has(f.op)) {
      push('OP_ILLEGAL', `${base}.op`,
        `operator ${JSON.stringify(f.op)} illegal for axis ${f.axis} `
        + `(${kind}-kind: ${[...legal].join(', ')})`);
    }
    // value presence (null/notnull take no value; everything else requires one)
    const valuelessOps = new Set(['null', 'notnull']);
    if (f.op && !valuelessOps.has(f.op)) {
      const hasVal = f.value !== undefined
        || (f.op === 'between' && f.from !== undefined && f.to !== undefined);
      if (!hasVal) {
        push('OP_ILLEGAL', `${base}.value`,
          `operator ${f.op} on axis ${f.axis} requires a value`
          + (f.op === 'between' ? ' ({from,to})' : ''));
      }
    }
    // NOTE (§2.1 point 4): a GUID/optionset/status literal that is not in the
    // live taxonomy is NOT a violation here — it compiles literally and the
    // PREVIEW route surfaces a "0-match / not-in-taxonomy" warning. Filter
    // literals and the post-query UNCLASSIFIED sentinel are DIFFERENT
    // mechanisms; do not conflate them in validation.
  });

  // (7) programRollup ∈ {optionB}
  if (spec.programRollup !== undefined && !VALID_PROGRAM_ROLLUP.has(spec.programRollup)) {
    push('PROGRAM_ROLLUP_UNKNOWN', 'programRollup',
      `programRollup must be one of {${[...VALID_PROGRAM_ROLLUP].join(', ')}}`);
  }

  // (8) booleans present — no implicit default that hides a choice.
  for (const key of ['excludeOperational', 'excludeTestRecords']) {
    if (typeof spec[key] !== 'boolean') {
      push('BOOL_REQUIRED', key,
        `${key} must be an explicit boolean (no hidden default)`);
    }
  }
  if (spec.columns == null || typeof spec.columns !== 'object'
      || typeof spec.columns.default !== 'boolean') {
    push('BOOL_REQUIRED', 'columns.default',
      'columns.default must be an explicit boolean');
  }

  // eraScope ∈ {all,migrated,native} — a PROVENANCE filter only.
  if (spec.eraScope !== undefined && !VALID_ERA_SCOPE.has(spec.eraScope)) {
    push('ERA_SCOPE_UNKNOWN', 'eraScope',
      `eraScope must be one of {${[...VALID_ERA_SCOPE].join(', ')}} (provenance only)`);
  }

  return v.length ? invalid(v) : { valid: true };
}

function invalid(violations) {
  return {
    valid: false,
    status: 422,
    body: { error: 'INVALID_QUERYSPEC', violations },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// FetchXML emission helpers (deterministic, escaped, snapshot-stable)
// ─────────────────────────────────────────────────────────────────────────

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function condition({ attribute, operator, value, values, entityname }) {
  const en = entityname ? ` entityname="${xmlEscape(entityname)}"` : '';
  if (operator === 'null' || operator === 'not-null') {
    return `<condition${en} attribute="${xmlEscape(attribute)}" operator="${operator}" />`;
  }
  if (Array.isArray(values)) {
    const vs = values.map(x => `<value>${xmlEscape(x)}</value>`).join('');
    return `<condition${en} attribute="${xmlEscape(attribute)}" operator="${operator}">${vs}</condition>`;
  }
  return `<condition${en} attribute="${xmlEscape(attribute)}" operator="${operator}" value="${xmlEscape(value)}" />`;
}

/**
 * Compile a single validated filter to one-or-more FetchXML condition strings.
 * Range/multi ops expand structurally (between → ge+le; in → multi-value).
 */
function compileFilter(f) {
  const axisDef = AXES[f.axis];

  // institution — akoya_applicantid is a LOOKUP (GUID); a bare condition on
  // it with a typed name is invalid FetchXML. The identity match is against
  // the APPLICANT ACCOUNT's name/AKA via a link-entity (alias "instf",
  // declared in compile()), using the same self-closed-link + entityname
  // condition pattern as the test-record exclusion. OR(name, akoya_aka)
  // mirrors the §3c key precedence (account.akoya_aka → account.name; the
  // §3c-first wmkf_legalname does not exist on akoya_request — verified
  // live). Dataverse string eq/like are case-insensitive.
  if (f.axis === 'institution') {
    const arm = (attribute, operator, value, values) =>
      condition({ entityname: 'instf', attribute, operator, value, values });
    if (f.op === 'in') {
      const values = Array.isArray(f.value) ? f.value : [f.value];
      return [`<filter type="or">`
        + arm('name', 'in', undefined, values)
        + arm('akoya_aka', 'in', undefined, values)
        + `</filter>`];
    }
    if (f.op === 'contains') {
      const v = `%${f.value}%`;
      return [`<filter type="or">`
        + arm('name', 'like', v)
        + arm('akoya_aka', 'like', v)
        + `</filter>`];
    }
    // eq (the only remaining identity op — validator bars null/notnull here)
    return [`<filter type="or">`
      + arm('name', 'eq', f.value)
      + arm('akoya_aka', 'eq', f.value)
      + `</filter>`];
  }

  const field = f.axis === 'amount'
    ? AMOUNT_WHICH[f.which]
    : (f.axis === 'requestType' && f.field && axisDef.fields.includes(f.field)
        ? f.field
        : axisDef.field);

  if (f.op === 'null') return [condition({ attribute: field, operator: 'null' })];
  if (f.op === 'notnull') return [condition({ attribute: field, operator: 'not-null' })];

  if (f.op === 'in') {
    const values = Array.isArray(f.value) ? f.value : [f.value];
    return [condition({ attribute: field, operator: 'in', values })];
  }

  if (f.op === 'between') {
    if (axisDef.kind === 'date') {
      return [
        condition({ attribute: field, operator: 'on-or-after', value: f.from }),
        condition({ attribute: field, operator: 'on-or-before', value: f.to }),
      ];
    }
    // money between → ge + le
    return [
      condition({ attribute: field, operator: 'ge', value: f.from }),
      condition({ attribute: field, operator: 'le', value: f.to }),
    ];
  }

  if (f.op === 'contains') {
    return [condition({ attribute: field, operator: 'like', value: `%${f.value}%` })];
  }

  return [condition({ attribute: field, operator: FX_OP[f.op], value: f.value })];
}

// ─────────────────────────────────────────────────────────────────────────
// Resolver seam — operational-exclusion clauses reference LOOKUP/PICKLIST
// values by LABEL; label→GUID/optionvalue is a LIVE-taxonomy concern (the
// Phase-2 metadata route). A resolver may be injected (tests + Phase-2);
// without one, the clauses are recorded as DEFERRED in appliedRules and the
// result carries requiresResolver:true — never silently dropped.
// ─────────────────────────────────────────────────────────────────────────

function resolveExclusionClause(clause, resolver, appliedRules) {
  if (!resolver || typeof resolver.resolve !== 'function') {
    appliedRules.push(
      `Operational exclusion DEFERRED — "${clause.field} ${clause.op} `
      + `${clause.label || (clause.labels || []).join('/')}" requires live-taxonomy `
      + `resolution (metadata route); not yet applied to this compile.`);
    return null; // requiresResolver
  }
  if (clause.op === 'not-in') {
    const values = clause.labels.map(l => resolver.resolve(clause.field, l));
    if (values.some(x => x == null)) {
      appliedRules.push(
        `Operational exclusion DEFERRED — one or more of [${clause.labels.join(', ')}] `
        + `on ${clause.field} did not resolve in the live taxonomy (fail-loud, not guessed).`);
      return null;
    }
    appliedRules.push(`Excluded ${clause.field} ∈ {${clause.labels.join(', ')}} — ${clause.note}.`);
    return condition({ attribute: clause.field, operator: 'not-in', values });
  }
  // single-label ne
  const value = resolver.resolve(clause.field, clause.label);
  if (value == null) {
    appliedRules.push(
      `Operational exclusion DEFERRED — ${clause.field}="${clause.label}" did not `
      + `resolve in the live taxonomy (fail-loud, not guessed).`);
    return null;
  }
  appliedRules.push(`Excluded ${clause.field} = "${clause.label}" — ${clause.note}.`);
  return condition({ attribute: clause.field, operator: 'ne', value });
}

// ─────────────────────────────────────────────────────────────────────────
// compile() — the pure compiler
// ─────────────────────────────────────────────────────────────────────────

const COUNT_ALIAS = 'cnt';

/**
 * @param {object} querySpec  a spec that PASSED validateQuerySpec
 * @param {object} [opts]
 * @param {{resolve:(field,label)=>string|number|null}} [opts.resolver]
 *        live-taxonomy resolver for operational-exclusion labels (Phase-2 /
 *        tests). Absent ⇒ those clauses are recorded DEFERRED, never dropped.
 * @returns {{ fetchXml, countFetchXml, appliedRules:string[], requiresResolver:boolean }}
 *
 * Encodes every resolved hard invariant by binding reference to the design
 * doc (build plan §3b table) — it does NOT re-derive them.
 */
function compile(querySpec, opts = {}) {
  const check = validateQuerySpec(querySpec);
  if (!check.valid) {
    const err = new Error('INVALID_QUERYSPEC');
    err.status = 422;
    err.body = check.body;
    throw err;
  }

  const resolver = opts.resolver || null;
  const appliedRules = [];
  const conditions = [];
  let requiresResolver = false;

  // ── user filters ──
  for (const f of querySpec.filters || []) {
    conditions.push(...compileFilter(f));
    appliedRules.push(describeFilter(f));
  }

  // ── eraScope — a PROVENANCE (createdon) partition ONLY, never a
  //    business-period filter. Business history is sliced by the dateBasis
  //    axis on akoya_decisiondate (above), independent of this.
  const eraScope = querySpec.eraScope || 'all';
  if (eraScope === ERA.MIGRATED) {
    conditions.push(condition({ attribute: 'createdon', operator: 'on', value: ERA_CUTOVER_DATE }));
    appliedRules.push(
      `Era scope = migrated (createdon = ${ERA_CUTOVER_DATE}) — a CREATION-PROVENANCE `
      + `partition, NOT a business period.`);
  } else if (eraScope === ERA.NATIVE) {
    conditions.push(condition({ attribute: 'createdon', operator: 'on-or-after', value: '2023-12-04' }));
    appliedRules.push(
      `Era scope = native (createdon > ${ERA_CUTOVER_DATE}) — a CREATION-PROVENANCE `
      + `partition, NOT a business period.`);
  } else {
    appliedRules.push('Era scope = all (no createdon partition) — era is a disclosure column.');
  }

  // ── operational exclusion (default ON) — axis-by-axis, NOT one predicate.
  if (querySpec.excludeOperational) {
    for (const clause of OPERATIONAL_EXCLUSION) {
      const c = resolveExclusionClause(clause, resolver, appliedRules);
      if (c) conditions.push(c);
      else requiresResolver = true;
    }
  } else {
    appliedRules.push('Operational rows INCLUDED (excludeOperational=false) — '
      + 'interaction logs / honoraria are in this result.');
  }

  // ── test-record exclusion (default ON) — applicant account.name =
  //    "W. M. Keck Foundation" ∧ NATIVE era. Precise predicate via an outer
  //    link + entityname condition: keep rows where applicant ≠ Foundation
  //    OR migrated (createdon = cutover) ⇒ excludes exactly the native
  //    Foundation-applicant test clones.
  let linkEntities = '';
  if (querySpec.excludeTestRecords) {
    linkEntities =
      `<link-entity name="account" from="accountid" to="akoya_applicantid" `
      + `link-type="outer" alias="appl" />`;
    // Keep a row unless (applicant.name == Foundation ∧ native). The OR keeps
    // it when: applicant ≠ Foundation, OR migrated, OR applicant is NULL
    // (a null-applicant native row is NOT a Foundation test clone — Codex
    // S160 P2: without this branch `ne` would drop null-applicant rows).
    const orFilter =
      `<filter type="or">`
      + condition({ entityname: 'appl', attribute: 'name', operator: 'ne',
        value: TEST_RECORD_APPLICANT_NAME })
      + condition({ entityname: 'appl', attribute: 'name', operator: 'null' })
      + condition({ attribute: 'createdon', operator: 'on', value: ERA_CUTOVER_DATE })
      + `</filter>`;
    conditions.push(orFilter);
    appliedRules.push(
      `Test records EXCLUDED — applicant "${TEST_RECORD_APPLICANT_NAME}" ∧ native era `
      + `(point-in-time predicate; maintenance note: revisit if WMKF ever legitimately self-grants).`);
  } else {
    appliedRules.push('Test records INCLUDED (excludeTestRecords=false) — with disclosure.');
  }

  // Stage 1d isolation is a deployment-owned export rule, independent of the
  // legacy applicant-name QuerySpec option above. Routes set this option only
  // after the target has the marker columns.
  if (opts.excludeMarkedTestRequests === true) {
    conditions.push(TEST_REQUEST_ORDINARY_FETCHXML_FILTER);
    appliedRules.push('Marked Test Requests EXCLUDED by the Stage 1d marker contract.');
  }

  // institution filter ⇒ declare the applicant-account link the institution
  // conditions (entityname="instf", emitted in compileFilter) reference.
  // INNER: an institution filter implies the row HAS a matching applicant
  // account. Independent of the outer "appl" test-record link (distinct
  // alias; both may coexist). Carried in linkEntities so the count FetchXML
  // (linkEntities + filterBlock) stays consistent with the data fetch.
  if ((querySpec.filters || []).some(f => f.axis === 'institution')) {
    linkEntities +=
      `<link-entity name="account" from="accountid" to="akoya_applicantid" `
      + `link-type="inner" alias="instf" />`;
  }

  // ── program roll-up — Option B is a DISCLOSURE-engine aggregate rule, not
  //    a query filter. Recorded so the methods sheet states it; the actual
  //    in/out math is disclosure.js.
  if (querySpec.programRollup === PROGRAM_ROLLUP.OPTION_B) {
    appliedRules.push(
      'Program roll-up = Option B — a program total counts wmkf_type="Program" '
      + 'rows ONLY; Special Projects/Grants etc. report as separate lines '
      + '(applied by the disclosure engine, not this filter).');
  }

  const filterBlock = conditions.length
    ? `<filter type="and">${conditions.join('')}</filter>`
    : '';

  const fetchXml =
    `<fetch>`
    + `<entity name="${ENTITY}">`
    + `<all-attributes />`
    + linkEntities
    + filterBlock
    + `</entity>`
    + `</fetch>`;

  // True total via FetchXML aggregate count — NEVER OData /$count (a hard
  // correctness invariant; /$count silently caps at 5,000). The count fetch
  // MUST carry the SAME link-entity as the data fetch — filterBlock can
  // contain entityname="appl" predicates (test-record exclusion); omitting
  // the link makes the aggregate FetchXML invalid and the true-count path
  // fails at runtime (Codex S160 P1). No all-attributes (aggregate-minimal).
  const countFetchXml =
    `<fetch aggregate="true">`
    + `<entity name="${ENTITY}">`
    + `<attribute name="akoya_requestid" alias="${COUNT_ALIAS}" aggregate="count" />`
    + linkEntities
    + filterBlock
    + `</entity>`
    + `</fetch>`;

  return { fetchXml, countFetchXml, appliedRules, requiresResolver, countAlias: COUNT_ALIAS };
}

function describeFilter(f) {
  if (f.axis === 'amount') {
    return `Amount (${f.which} → ${AMOUNT_WHICH[f.which]}) ${f.op} `
      + `${f.op === 'between' ? `${f.from}…${f.to}` : JSON.stringify(f.value ?? '')}`;
  }
  if (f.axis === 'institution') {
    const v = f.op === 'in'
      ? JSON.stringify(Array.isArray(f.value) ? f.value : [f.value])
      : JSON.stringify(f.value ?? '');
    return `Institution — applicant account name/AKA (account.name OR `
      + `account.akoya_aka via akoya_applicantid) ${f.op} ${v}`;
  }
  if (f.op === 'between') {
    return `${f.axis} (${AXES[f.axis].field}) between ${f.from} … ${f.to}`;
  }
  if (f.op === 'null' || f.op === 'notnull') {
    return `${f.axis} (${AXES[f.axis].field}) is ${f.op === 'null' ? 'null' : 'not null'}`;
  }
  return `${f.axis} (${AXES[f.axis].field}) ${f.op} ${JSON.stringify(f.value ?? '')}`;
}

export {
  validateQuerySpec,
  compile,
  // exported for the headless test suite (probes are the oracle)
  AXES,
  LEGAL_OPS,
  ENTITY,
  COUNT_ALIAS,
  xmlEscape,
};
