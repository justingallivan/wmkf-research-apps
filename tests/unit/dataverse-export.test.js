/**
 * Dataverse Power Tools — Track B — Phase 1 spine + Phase 2 confirm-token tests.
 *
 * The Phase-1 exit criterion (build plan §10/§11): the deterministic spine is
 * provable against fixture QuerySpecs BEFORE any UI. The committed probes +
 * dated evidence are the ground-truth oracle for the compiler/engine; this
 * suite encodes that oracle. No network, no Dataverse, no Vercel.
 *
 * Node env (matches the repo's jose-using tests, e.g. external-token.test.js):
 * jose ships ESM that the jsdom transform does not parse. No test here needs a DOM.
 *
 * @jest-environment node
 */

import { jest } from '@jest/globals';
import {
  validateQuerySpec, compile,
} from '../../lib/services/dataverse-export/compiler.js';
import {
  annotate, normalizeInstitution, SENTINEL, INST_RESOLUTION, DECLINE_BUCKET,
} from '../../lib/services/dataverse-export/disclosure.js';
import {
  injectPaging, backoffMs, parseRetryAfter,
  fetchXmlAll, fetchXmlAggregateCount, FetchXmlError, PAGE_SIZE,
} from '../../lib/services/dataverse-export/fetch-client.js';
import { buildWorkbook } from '../../lib/services/dataverse-export/workbook.js';
import {
  mintResultToken, verifyResultToken,
} from '../../lib/services/dataverse-export/result-token.js';
import { SignJWT } from 'jose';
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import ExcelJS from 'exceljs';

// A minimal valid spec the §2.1 contract accepts.
const validSpec = () => ({
  version: 1,
  entity: 'akoya_request',
  filters: [
    { axis: 'program', field: 'akoya_programid', op: 'eq', value: '<guid>' },
    { axis: 'dateBasis', field: 'akoya_decisiondate', op: 'between',
      from: '2021-01-01', to: '2025-12-31' },
    { axis: 'amount', which: 'awarded', op: 'gt', value: 1500000 },
  ],
  programRollup: 'optionB',
  excludeOperational: true,
  excludeTestRecords: true,
  columns: { default: true, optIn: ['akoya_payee'] },
  eraScope: 'all',
});

// ─────────────────────────────────────────────────────────────────────────
describe('QuerySpec validation (§2.1) — fails closed and legibly', () => {
  test('a well-formed spec validates', () => {
    expect(validateQuerySpec(validSpec())).toEqual({ valid: true });
  });

  test('unknown axis → AXIS_UNKNOWN, HTTP 422', () => {
    const s = validSpec();
    s.filters = [{ axis: 'sentiment', op: 'eq', value: 'x' }];
    const r = validateQuerySpec(s);
    expect(r.valid).toBe(false);
    expect(r.status).toBe(422);
    expect(r.body.error).toBe('INVALID_QUERYSPEC');
    expect(r.body.violations.map(v => v.code)).toContain('AXIS_UNKNOWN');
  });

  test('illegal operator for an axis-kind → OP_ILLEGAL', () => {
    const s = validSpec();
    s.filters = [{ axis: 'program', op: 'contains', value: 'x' }]; // guid-kind: no contains
    const codes = validateQuerySpec(s).body.violations.map(v => v.code);
    expect(codes).toContain('OP_ILLEGAL');
  });

  test('createdon as dateBasis → CREATEDON_AS_DATE (hard reject)', () => {
    const s = validSpec();
    s.filters = [{ axis: 'dateBasis', field: 'createdon', op: 'between',
      from: '2021-01-01', to: '2022-01-01' }];
    const codes = validateQuerySpec(s).body.violations.map(v => v.code);
    expect(codes).toContain('CREATEDON_AS_DATE');
  });

  test('amount without `which` → AMOUNT_WHICH_MISSING', () => {
    const s = validSpec();
    s.filters = [{ axis: 'amount', op: 'gt', value: 1000 }];
    const codes = validateQuerySpec(s).body.violations.map(v => v.code);
    expect(codes).toContain('AMOUNT_WHICH_MISSING');
  });

  test('unknown version → VERSION_UNKNOWN', () => {
    const s = validSpec(); s.version = 99;
    const codes = validateQuerySpec(s).body.violations.map(v => v.code);
    expect(codes).toContain('VERSION_UNKNOWN');
  });

  test('missing explicit boolean → BOOL_REQUIRED (no hidden default)', () => {
    const s = validSpec(); delete s.excludeOperational;
    const codes = validateQuerySpec(s).body.violations.map(v => v.code);
    expect(codes).toContain('BOOL_REQUIRED');
  });

  test('bad programRollup / eraScope → their own codes', () => {
    const s = validSpec(); s.programRollup = 'optionZ'; s.eraScope = 'lastDecade';
    const codes = validateQuerySpec(s).body.violations.map(v => v.code);
    expect(codes).toContain('PROGRAM_ROLLUP_UNKNOWN');
    expect(codes).toContain('ERA_SCOPE_UNKNOWN');
  });

  test('an UNKNOWN filter taxonomy literal is NOT a reject and NOT UNCLASSIFIED '
    + '(§2.1 point 4 — the two mechanisms are distinct)', () => {
    const s = validSpec();
    s.filters = [{ axis: 'status', op: 'eq', value: 'A Brand New Status' }];
    // status is enum-kind, eq is legal — a not-in-taxonomy literal is a
    // PREVIEW warning, never a 422, never the post-query UNCLASSIFIED sentinel.
    expect(validateQuerySpec(s)).toEqual({ valid: true });
  });

  test('status is enum-kind: `contains` is illegal (Codex S160 P1)', () => {
    const s = validSpec();
    s.filters = [{ axis: 'status', op: 'contains', value: 'Pend' }];
    const codes = validateQuerySpec(s).body.violations.map(v => v.code);
    expect(codes).toContain('OP_ILLEGAL');
  });

  test('requestType targets EITHER wmkf_request_type OR akoya_requesttype; '
    + 'a field outside the §2.1 pair is rejected', () => {
    const ok = validSpec();
    ok.filters = [{ axis: 'requestType', field: 'akoya_requesttype', op: 'eq',
      value: 100000000 }];
    expect(validateQuerySpec(ok)).toEqual({ valid: true });
    expect(compile(ok).fetchXml).toContain('attribute="akoya_requesttype"');

    const bad = validSpec();
    bad.filters = [{ axis: 'requestType', field: 'akoya_nonsense', op: 'eq', value: 1 }];
    expect(validateQuerySpec(bad).body.violations.map(v => v.code))
      .toContain('AXIS_UNKNOWN');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('compile() — every §3b invariant, bound not re-derived', () => {
  test('compiles a valid spec; aggregate-count fetch never uses /$count', () => {
    const { fetchXml, countFetchXml, appliedRules } = compile(validSpec());
    expect(fetchXml).toContain('<fetch>');
    expect(fetchXml).toContain('name="akoya_request"');
    expect(countFetchXml).toContain('aggregate="true"');
    expect(countFetchXml).toContain('aggregate="count"');
    expect(countFetchXml).not.toContain('$count');
    expect(appliedRules.join(' ')).toMatch(/Option B/);
  });

  test('Stage 1d marker exclusion is opt-in and identical in data/count FetchXML', () => {
    const off = compile(validSpec());
    expect(off.fetchXml).not.toContain('wmkf_istestrequest');
    expect(off.countFetchXml).not.toContain('wmkf_testcreationrunid');

    const on = compile(validSpec(), { excludeMarkedTestRequests: true });
    for (const xml of [on.fetchXml, on.countFetchXml]) {
      expect(xml).toContain('attribute="wmkf_istestrequest"');
      expect(xml).toContain('attribute="wmkf_testcreationrunid"');
    }
  });

  test('amount fan-out maps `which` → the explicit field (no bare "$")', () => {
    const mk = (which) => {
      const s = validSpec();
      s.filters = [{ axis: 'amount', which, op: 'gt', value: 1 }];
      return compile(s).fetchXml;
    };
    expect(mk('awarded')).toContain('attribute="akoya_grant"');
    expect(mk('requested')).toContain('attribute="akoya_request"');
    expect(mk('total')).toContain('attribute="akoya_expenses"');
    expect(mk('recommended')).toContain('attribute="akoya_recommendedamount"');
    expect(mk('invited')).toContain('attribute="wmkf_invitedamount"');
  });

  test('createdon-as-date is rejected at compile (validation gate, 422)', () => {
    const s = validSpec();
    s.filters = [{ axis: 'dateBasis', field: 'createdon', op: 'onorafter', value: '2024-01-01' }];
    expect(() => compile(s)).toThrow(/INVALID_QUERYSPEC/);
    try { compile(s); } catch (e) {
      expect(e.status).toBe(422);
      expect(e.body.violations.map(v => v.code)).toContain('CREATEDON_AS_DATE');
    }
  });

  test('eraScope is a createdon PROVENANCE partition, never a business filter', () => {
    const s = validSpec(); s.eraScope = 'native';
    const { fetchXml, appliedRules } = compile(s);
    expect(fetchXml).toContain('attribute="createdon"');
    expect(appliedRules.join(' ')).toMatch(/CREATION-PROVENANCE/);
  });

  test('test-record exclusion = applicant Foundation ∧ native (precise '
    + 'predicate); count fetch carries the SAME link (Codex S160 P1) + a '
    + 'null-applicant keep branch (Codex S160 P2)', () => {
    const { fetchXml, countFetchXml } = compile(validSpec());
    expect(fetchXml).toContain('link-entity name="account"');
    expect(fetchXml).toContain('W. M. Keck Foundation');
    expect(fetchXml).toContain('<filter type="or">');
    // null-applicant keep branch
    expect(fetchXml).toContain('entityname="appl" attribute="name" operator="null"');
    // the aggregate count fetch MUST also carry the appl link, else the
    // entityname="appl" predicate makes it invalid FetchXML at runtime.
    expect(countFetchXml).toContain('aggregate="true"');
    expect(countFetchXml).toContain('link-entity name="account"');
    expect(countFetchXml).toContain('entityname="appl"');
  });

  test('institution filters the APPLICANT ACCOUNT name/AKA via an inner '
    + 'link-entity — akoya_applicantid is a lookup, so a bare condition on '
    + 'it is invalid FetchXML; the count fetch carries the SAME link', () => {
    const s = validSpec();
    s.filters = [{ axis: 'institution', op: 'eq',
      value: 'California Institute of Technology' }];
    const { fetchXml, countFetchXml, appliedRules } = compile(s);

    // NEVER a bare condition on the lookup attribute (the original defect).
    expect(fetchXml).not.toContain('attribute="akoya_applicantid" operator=');
    // inner applicant-account link, in BOTH the data and the count fetch.
    const link = 'link-entity name="account" from="accountid" '
      + 'to="akoya_applicantid" link-type="inner" alias="instf"';
    expect(fetchXml).toContain(link);
    expect(countFetchXml).toContain(link);
    // OR(name, akoya_aka) keyed off the instf link alias.
    expect(fetchXml).toContain(
      'entityname="instf" attribute="name" operator="eq" '
      + 'value="California Institute of Technology"');
    expect(fetchXml).toContain(
      'entityname="instf" attribute="akoya_aka" operator="eq" '
      + 'value="California Institute of Technology"');
    expect(appliedRules.join(' ')).toMatch(/Institution — applicant account name\/AKA/);

    // contains → like %v% on both arms.
    const c = validSpec();
    c.filters = [{ axis: 'institution', op: 'contains', value: 'Institute' }];
    const cf = compile(c).fetchXml;
    expect(cf).toContain('entityname="instf" attribute="name" operator="like" value="%Institute%"');
    expect(cf).toContain('entityname="instf" attribute="akoya_aka" operator="like" value="%Institute%"');

    // in → multi-value on both arms.
    const i = validSpec();
    i.filters = [{ axis: 'institution', op: 'in', value: ['Caltech', 'MIT'] }];
    const inf = compile(i).fetchXml;
    expect(inf).toMatch(
      /entityname="instf" attribute="name" operator="in"><value>Caltech<\/value><value>MIT<\/value>/);
    expect(inf).toMatch(
      /entityname="instf" attribute="akoya_aka" operator="in"><value>Caltech<\/value><value>MIT<\/value>/);
  });

  test('the Honorarium sharpest reviewer-exclusion is actually applied', () => {
    const resolver = { resolve: (field, label) => `${field}:${label}` };
    const { fetchXml } = compile(validSpec(), { resolver });
    expect(fetchXml).toContain('wmkf_grantprogram:Honorarium');
  });

  test('operational exclusion: no resolver ⇒ DEFERRED + requiresResolver, '
    + 'never silently dropped; a fixture resolver ⇒ real conditions', () => {
    const noResolver = compile(validSpec());
    expect(noResolver.requiresResolver).toBe(true);
    expect(noResolver.appliedRules.join(' ')).toMatch(/Operational exclusion DEFERRED/);

    const resolver = { resolve: (field, label) => `${field}:${label}` };
    const withR = compile(validSpec(), { resolver });
    expect(withR.requiresResolver).toBe(false);
    expect(withR.fetchXml).toContain('akoya_programid:Research Reviewer');
    expect(withR.appliedRules.join(' ')).toMatch(/Excluded wmkf_request_type/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('Normalize() — the EXACT deterministic institution algorithm (§3c)', () => {
  test('strips legal suffixes, leading "the", expands abbrevs, NFKD', () => {
    expect(normalizeInstitution('The University of Georgia')).toBe('university of georgia');
    expect(normalizeInstitution('UGA Research Foundation, Inc.')).toBe('uga research');
    expect(normalizeInstitution('Univ of Texas')).toBe('university of texas');
    expect(normalizeInstitution('Université de Montréal')).toBe('universite de montreal');
    expect(normalizeInstitution('  Acme   Co. ')).toBe('acme');
  });

  test('dotted legal suffixes l.l.c. / inc. collapse + strip (Codex S160 P1)', () => {
    expect(normalizeInstitution('Foo, L.L.C.')).toBe('foo');
    expect(normalizeInstitution('Bar Inc.')).toBe('bar');
    expect(normalizeInstitution('Baz L.L.C')).toBe('baz');
  });
});

describe('Folded Codex S160 findings — fail-loud restored', () => {
  test('a status absent from the authoritative map ⇒ UNCLASSIFIED, NOT '
    + 'suffix-reclassified (the suffix fallback was removed)', () => {
    const { rows, summary } = annotate([{
      akoya_requestnum: 'U-1', createdon: '2024-01-01T00:00:00Z',
      akoya_requeststatus: 'Phase III Declined', // plausible but NOT in the map
      _akoya_programid_value: 'g', _akoya_programid_value_formatted: 'Medical Research',
    }]);
    expect(rows[0].__statusClass).toBe('UNCLASSIFIED');
    expect(rows[0]['UNCLASSIFIED — status']).toBe('UNCLASSIFIED — status=Phase III Declined');
    expect(summary.unclassifiedSets.join(' ')).toMatch(/Phase III Declined/);
  });

  test('Withdrawn lifecycle null ⇒ path-agnostic WITHDRAWN sentinel, not '
    + '"UNKNOWN — not captured" (no actor attributed)', () => {
    const { rows } = annotate([{
      akoya_requestnum: 'W-1', createdon: '2024-02-01T00:00:00Z',
      akoya_requeststatus: 'Withdrawn',
      _akoya_programid_value: 'g', _akoya_programid_value_formatted: 'Medical Research',
    }]);
    expect(rows[0].akoya_grant__sentinel).toBe(SENTINEL.WITHDRAWN_NO_AWARD);
    expect(SENTINEL.WITHDRAWN_NO_AWARD).not.toMatch(/applicant|staff|administrative/i);
  });

  test('unannotated program on a declined row ⇒ its OWN UNCLASSIFIED-PROCESS '
    + 'decline bucket, not folded into reason-missing', () => {
    const { rows } = annotate([{
      akoya_requestnum: 'D-1', createdon: '2024-03-01T00:00:00Z',
      akoya_requeststatus: 'Phase I Declined',
      _akoya_programid_value: 'g-x', _akoya_programid_value_formatted: 'Mystery Program',
    }]);
    expect(rows[0].__decline.bucket).toBe(DECLINE_BUCKET.UNCLASSIFIED_PROCESS);
    expect(rows[0].__decline.bucket).not.toBe(DECLINE_BUCKET.REASON_MISSING);
  });

  test('institution collision counts DISTINCT raw names, not rows: 3 rows '
    + 'from the SAME account stay "resolved"; 2 distinct names ⇒ ambiguous', () => {
    const same = annotate(Array.from({ length: 3 }, (_, i) => ({
      akoya_requestnum: `S-${i}`, createdon: '2024-01-01T00:00:00Z',
      akoya_requeststatus: 'Approved',
      _akoya_programid_value: 'g', _akoya_programid_value_formatted: 'Medical Research',
      __applicant: { name: 'Stanford University' },
    })));
    expect(same.rows.every(r => r.institution_resolution === INST_RESOLUTION.RESOLVED))
      .toBe(true);

    const variants = annotate([
      { akoya_requestnum: 'V-1', createdon: '2024-01-01T00:00:00Z',
        akoya_requeststatus: 'Approved', __applicant: { name: 'Stanford University' } },
      { akoya_requestnum: 'V-2', createdon: '2024-01-01T00:00:00Z',
        akoya_requeststatus: 'Approved', __applicant: { name: 'Stanford Univ.' } },
    ]);
    expect(variants.rows[0].institution_resolution).toMatch(/^ambiguous — 2 variants/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('Disclosure golden — mixed era / program / declined-with-nulls', () => {
  // processAnnotations-shaped fixture rows.
  const rows = [
    { // migrated declined; B-structural migrated must be nulled + sentinel
      akoya_requestnum: 'R-1', createdon: '2023-12-03T17:50:00Z',
      akoya_requeststatus: 'Phase II Declined',
      _akoya_programid_value: 'g-mr', _akoya_programid_value_formatted: 'Medical Research',
      _wmkf_type_value_formatted: 'Program',
      akoya_denialreason_formatted: 'Out of scope',
      akoya_request: 5000, akoya_request_base: 5000,
      __applicant: { name: 'Stanford University', akoya_aka: null, wmkf_legalname: null },
    },
    { // native MR declined w/ notes; PI-bearing ⇒ PI value
      akoya_requestnum: 'R-2', createdon: '2024-06-01T09:00:00Z',
      akoya_requeststatus: 'Phase I Declined',
      _akoya_programid_value: 'g-mr', _akoya_programid_value_formatted: 'Medical Research',
      _wmkf_type_value_formatted: 'Program',
      _wmkf_projectleader_value: 'c-1', _wmkf_projectleader_value_formatted: 'Dr. Jane Smith',
      wmkf_denialnotes: 'Insufficient novelty',
      akoya_grant: 0, akoya_grant_base: 0,
      __applicant: { name: 'Stanford University', akoya_aka: null, wmkf_legalname: null },
    },
    { // native SoCal C&C declined; reason ONLY in the third field
      akoya_requestnum: 'R-3', createdon: '2024-07-15T09:00:00Z',
      akoya_requeststatus: 'Phase I Declined',
      _akoya_programid_value: 'g-cc', _akoya_programid_value_formatted: 'Civic & Community',
      _wmkf_type_value_formatted: 'Program',
      wmkf_denialnotes: null,
      wmkf_socalreasonsfordecline2_formatted: 'Capacity constraints',
      __applicant: { name: 'LA Nonprofit', akoya_aka: null, wmkf_legalname: null },
    },
    { // native NULL-program declined ⇒ program-unattributed fail-loud bucket
      akoya_requestnum: 'R-4', createdon: '2024-08-01T09:00:00Z',
      akoya_requeststatus: 'Concept Denied',
      _wmkf_type_value_formatted: 'Program',
      __applicant: { name: 'Unknown Org', akoya_aka: null, wmkf_legalname: null },
    },
    { // native UNANNOTATED program ⇒ PI UNCLASSIFIED PROCESS (never guessed)
      akoya_requestnum: 'R-5', createdon: '2024-09-01T09:00:00Z',
      akoya_requeststatus: 'Active',
      _akoya_programid_value: 'g-x', _akoya_programid_value_formatted: 'Mystery Program',
      _wmkf_type_value_formatted: 'Program',
      akoya_grant: 1000000, akoya_grant_base: 1000000,
      __applicant: { name: 'Caltech', akoya_aka: null, wmkf_legalname: null },
    },
    { // native in-flight Pending ⇒ B-lifecycle NOT YET DECIDED sentinel
      akoya_requestnum: 'R-6', createdon: '2024-10-01T09:00:00Z',
      akoya_requeststatus: 'Phase I Pending',
      _akoya_programid_value: 'g-mr', _akoya_programid_value_formatted: 'Medical Research',
      _wmkf_type_value_formatted: 'Special Projects',
      akoya_grant: 9000000, akoya_grant_base: 9000000,
      __applicant: { name: 'Stanford University', akoya_aka: null, wmkf_legalname: null },
    },
    { // payee differs from applicant (distinct keys) ⇒ ambiguous — payee differs
      akoya_requestnum: 'R-7', createdon: '2024-11-01T09:00:00Z',
      akoya_requeststatus: 'Approved',
      _akoya_programid_value: 'g-mr', _akoya_programid_value_formatted: 'Medical Research',
      _wmkf_type_value_formatted: 'Program',
      _wmkf_projectleader_value: 'c-2', _wmkf_projectleader_value_formatted: 'Dr. Q',
      akoya_grant: 2000000, akoya_grant_base: 2000000,
      _akoya_payee_value: 'p-1',
      __applicant: { akoya_aka: 'Stanford University' },
      __payee: { akoya_aka: 'SRI International' },
    },
    { // UGA case — applicant & payee cluster via the AKA tier ⇒ resolved
      akoya_requestnum: 'R-8', createdon: '2024-12-01T09:00:00Z',
      akoya_requeststatus: 'Approved',
      _akoya_programid_value: 'g-mr', _akoya_programid_value_formatted: 'Medical Research',
      _wmkf_type_value_formatted: 'Program',
      _wmkf_projectleader_value: 'c-3', _wmkf_projectleader_value_formatted: 'Dr. Z',
      akoya_grant: 750000, akoya_grant_base: 750000,
      _akoya_payee_value: 'p-2',
      __applicant: { name: 'University of Georgia', akoya_aka: 'University of Georgia' },
      __payee: { name: 'UGA Research Foundation, Inc.', akoya_aka: 'University of Georgia' },
    },
  ];

  const { rows: ann, summary } = annotate(rows, { programRollup: 'optionB' });
  const by = n => ann.find(r => r.akoya_requestnum === n);

  test('era column on every row; composition line counts migrated/native/in-flight', () => {
    expect(by('R-1').__era).toBe('migrated');
    expect(by('R-2').__era).toBe('native');
    expect(summary.migrated).toBe(1);
    expect(summary.native).toBe(7);
    expect(summary.inFlightNative).toBe(1); // R-6
    expect(summary.compositionLine).toContain('8 rows: 1 migrated');
    expect(summary.compositionLine).toContain('of native, 1 in-flight');
  });

  test('B-structural: migrated akoya_request is NEVER a real amount', () => {
    expect(by('R-1').akoya_request__sentinel).toBe(SENTINEL.STRUCT_MIGRATION_BACKFILL);
    expect(by('R-1').akoya_request_base).toBeNull();
  });

  test('B-lifecycle null caption keys off the status class (never bare blank)', () => {
    expect(by('R-6').akoya_grant__sentinel).toBeUndefined(); // R-6 has a real grant
    // R-2 awarded amount is 0/absent on a declined row ⇒ DECIDED — no award
    expect(by('R-2').akoya_grant__sentinel).toBeUndefined(); // base=0 is a real value
    // a declined row with a genuinely absent grant:
    const { rows: a2 } = annotate([{
      akoya_requestnum: 'X', createdon: '2024-01-01T00:00:00Z',
      akoya_requeststatus: 'Phase I Declined',
      _akoya_programid_value: 'g', _akoya_programid_value_formatted: 'Medical Research',
    }]);
    expect(a2[0].akoya_grant__sentinel).toBe(SENTINEL.DECIDED_NO_AWARD);
  });

  test('PI column is program-conditional via the dated pi_bearing seed', () => {
    expect(by('R-2').__pi).toBe('Dr. Jane Smith'); // Medical Research = PI-bearing
    expect(by('R-3').__pi).toBe(SENTINEL.PI_NONE_NONRESEARCH); // Civic & Community
    expect(by('R-5').__pi).toBe(SENTINEL.PI_UNCLASSIFIED_PROCESS); // unannotated ⇒ fail loud
    expect(summary.failLoud.join(' ')).toMatch(/Mystery Program/);
  });

  test('decline output is era-aware, per-program-segmented, trifurcated', () => {
    expect(by('R-1').__decline.bucket).toBe(DECLINE_BUCKET.WITH_REASON); // migrated picklist
    expect(by('R-1').__decline.source).toBe('akoya_denialreason');
    expect(by('R-2').__decline.source).toBe('wmkf_denialnotes'); // native research notes
    expect(by('R-3').__decline.source).toBe('wmkf_socalreasonsfordecline2'); // SoCal 3rd field
    expect(by('R-4').__decline.bucket).toBe(DECLINE_BUCKET.PROGRAM_UNATTRIBUTED);
    expect(summary.programUnattributedDeclines).toBe(1);
  });

  test('institution resolution: deterministic, fail-loud, never false-precise', () => {
    expect(by('R-7').institution_resolution).toBe(INST_RESOLUTION.PAYEE_DIFFERS);
    expect(by('R-8').institution_resolution).toBe(INST_RESOLUTION.RESOLVED); // AKA-tier cluster
    expect(by('R-8').resolved_institution).toBe('university of georgia');
  });

  test('program roll-up Option-B: Special Projects reported separately, not folded', () => {
    const mr = summary.programRollup.lines.find(l => l.program === 'Medical Research');
    expect(mr.line).toMatch(/excludes:.*Special Projects/);
  });

  test('every Methods-sheet provenance footnote is present + tagged', () => {
    const p = summary.provenance.join(' ');
    expect(p).toMatch(/USER-ATTESTED S159/);
    expect(p).toMatch(/probe-akoya-decline-by-program\.js/);
    expect(summary.primaryContactCaption).toMatch(/NOT the\s+PI/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('Workbook — two sheets, zero bare blanks, 40 MB ceiling', () => {
  test('Data + Methods sheets; NO cell is ever a bare blank', async () => {
    const src = [{
      akoya_requestnum: 'R-1', createdon: '2024-06-01T00:00:00Z',
      akoya_requeststatus: 'Phase I Pending',
      _akoya_programid_value: 'g', _akoya_programid_value_formatted: 'Medical Research',
      _wmkf_type_value_formatted: 'Program',
      __applicant: { name: 'Stanford University' },
    }];
    const { rows, summary } = annotate(src, { programRollup: 'optionB' });
    const buf = await buildWorkbook({
      rows, summary, querySpec: { columns: { default: true, optIn: [] } },
      appliedRules: ['Test rule applied.'],
      counts: { trueTotal: 1, returned: 1, capped: false },
    });
    expect(Buffer.isBuffer(buf)).toBe(true);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    expect(wb.getWorksheet('Data')).toBeTruthy();
    expect(wb.getWorksheet('Methods & Provenance')).toBeTruthy();

    const data = wb.getWorksheet('Data');
    const colCount = data.getRow(1).cellCount;
    for (let rn = 2; rn <= data.rowCount; rn += 1) {
      for (let cn = 1; cn <= colCount; cn += 1) {
        const v = data.getRow(rn).getCell(cn).value;
        expect(v === null || v === undefined || v === '').toBe(false);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('fetch-client — backoff-hardened FetchXML primitive', () => {
  beforeAll(() => { process.env.DYNAMICS_URL = 'https://test.crm.dynamics.com'; });
  // jest.setup.js owns a persistent global.fetch = jest.fn() + a shared
  // beforeEach mockClear(); reset it to a fresh jest.fn(), never delete it.
  afterEach(() => { jest.restoreAllMocks(); global.fetch = jest.fn(); });

  test('injectPaging adds count/page and XML-escapes the cookie', () => {
    const fx = '<fetch><entity name="akoya_request"><all-attributes /></entity></fetch>';
    const p1 = injectPaging(fx, { page: 1, pageSize: PAGE_SIZE, cookie: null });
    expect(p1).toContain(`count="${PAGE_SIZE}"`);
    expect(p1).toContain('page="1"');
    const cookie = '<cookie pagenumber="1" istracking="False"><foo last="&bar" /></cookie>';
    const p2 = injectPaging(fx, { page: 2, pageSize: PAGE_SIZE, cookie });
    expect(p2).toContain('page="2"');
    expect(p2).toContain('paging-cookie="');
    expect(p2).toContain('&lt;cookie'); // cookie XML-escaped into the attribute
    expect(p2).not.toContain('paging-cookie="<cookie'); // raw not embedded
  });

  test('backoffMs is bounded + jittered; parseRetryAfter handles secs & http-date', () => {
    for (let a = 0; a < 8; a += 1) {
      const ms = backoffMs(a);
      expect(ms).toBeGreaterThanOrEqual(0);
      expect(ms).toBeLessThanOrEqual(30_000);
    }
    expect(parseRetryAfter('2')).toBe(2000);
    expect(parseRetryAfter(null)).toBeNull();
    const future = new Date(Date.now() + 5000).toUTCString();
    expect(parseRetryAfter(future)).toBeGreaterThan(0);
  });

  test('fetchXmlAll pages via the FetchXML cookie (NOT @odata.nextLink)', async () => {
    jest.spyOn(DynamicsService, 'getAccessToken').mockResolvedValue('tok');
    const pages = [
      { value: [{ akoya_requestid: '1' }, { akoya_requestid: '2' }],
        '@Microsoft.Dynamics.CRM.morerecords': true,
        '@Microsoft.Dynamics.CRM.fetchxmlpagingcookie': '<cookie/>' },
      { value: [{ akoya_requestid: '3' }],
        '@Microsoft.Dynamics.CRM.morerecords': false },
    ];
    let n = 0;
    global.fetch = jest.fn(async () => ({
      ok: true, status: 200, json: async () => pages[n++],
    }));
    const r = await fetchXmlAll('akoya_requests',
      '<fetch><entity name="akoya_request"><all-attributes /></entity></fetch>');
    expect(r.fetched).toBe(3);
    expect(r.pages).toBe(2);
    expect(r.capped).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('hardCapRows ⇒ capped:true, never a silent over-read', async () => {
    jest.spyOn(DynamicsService, 'getAccessToken').mockResolvedValue('tok');
    global.fetch = jest.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({
        value: [{ akoya_requestid: 'a' }, { akoya_requestid: 'b' }, { akoya_requestid: 'c' }],
        '@Microsoft.Dynamics.CRM.morerecords': true,
        '@Microsoft.Dynamics.CRM.fetchxmlpagingcookie': '<c/>',
      }),
    }));
    const r = await fetchXmlAll('akoya_requests',
      '<fetch><entity name="akoya_request"><all-attributes /></entity></fetch>',
      { hardCapRows: 2 });
    expect(r.capped).toBe(true);
    expect(r.fetched).toBe(2);
  });

  test('a 429 is retried then succeeds (the broad query must SUCCEED)', async () => {
    jest.spyOn(DynamicsService, 'getAccessToken').mockResolvedValue('tok');
    let call = 0;
    global.fetch = jest.fn(async () => {
      call += 1;
      if (call === 1) {
        return { ok: false, status: 429, headers: { get: () => '0' },
          text: async () => 'throttled' };
      }
      return { ok: true, status: 200,
        json: async () => ({ value: [{ akoya_requestid: '1' }],
          '@Microsoft.Dynamics.CRM.morerecords': false }) };
    });
    const r = await fetchXmlAll('akoya_requests',
      '<fetch><entity name="akoya_request"><all-attributes /></entity></fetch>');
    expect(r.fetched).toBe(1);
    expect(call).toBe(2); // retried after the 429
  }, 10_000);

  test('a non-retryable HTTP error fails LOUD (never a silently-short file)', async () => {
    jest.spyOn(DynamicsService, 'getAccessToken').mockResolvedValue('tok');
    global.fetch = jest.fn(async () => ({
      ok: false, status: 400, headers: { get: () => null },
      text: async () => 'bad fetchxml',
    }));
    await expect(fetchXmlAll('akoya_requests',
      '<fetch><entity name="akoya_request"><all-attributes /></entity></fetch>'))
      .rejects.toThrow(FetchXmlError);
  });

  test('fetchXmlAggregateCount returns the true total; refuses to guess', async () => {
    jest.spyOn(DynamicsService, 'getAccessToken').mockResolvedValue('tok');
    global.fetch = jest.fn(async () => ({
      ok: true, status: 200, json: async () => ({ value: [{ cnt: 25561 }] }),
    }));
    expect(await fetchXmlAggregateCount('akoya_requests',
      '<fetch aggregate="true"></fetch>', 'cnt')).toBe(25561);

    global.fetch = jest.fn(async () => ({
      ok: true, status: 200, json: async () => ({ value: [{}] }),
    }));
    await expect(fetchXmlAggregateCount('akoya_requests',
      '<fetch aggregate="true"></fetch>', 'cnt')).rejects.toThrow(/refusing to guess/);
  });

  test('morerecords=true with NO paging cookie ⇒ fail LOUD, never a '
    + 'silently-short result (Codex S160 P1)', async () => {
    jest.spyOn(DynamicsService, 'getAccessToken').mockResolvedValue('tok');
    global.fetch = jest.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({
        value: [{ akoya_requestid: '1' }],
        '@Microsoft.Dynamics.CRM.morerecords': true,
        // NO @Microsoft.Dynamics.CRM.fetchxmlpagingcookie
      }),
    }));
    await expect(fetchXmlAll('akoya_requests',
      '<fetch><entity name="akoya_request"><all-attributes /></entity></fetch>'))
      .rejects.toThrow(/no paging cookie/);
  });

  test('hardBudgetMs exceeded ⇒ truncatedByBudget, rows-so-far, no hang', async () => {
    jest.spyOn(DynamicsService, 'getAccessToken').mockResolvedValue('tok');
    global.fetch = jest.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({
        value: [{ akoya_requestid: 'a' }],
        '@Microsoft.Dynamics.CRM.morerecords': true,
        '@Microsoft.Dynamics.CRM.fetchxmlpagingcookie': '<c/>',
      }),
    }));
    const r = await fetchXmlAll('akoya_requests',
      '<fetch><entity name="akoya_request"><all-attributes /></entity></fetch>',
      { hardBudgetMs: 0 });
    expect(r.truncatedByBudget).toBe(true);
    expect(r.fetched).toBeGreaterThanOrEqual(1);
  });

  test('aggregate-count over Dataverse 50k limit ⇒ loud actionable error, '
    + 'never a silent partial count', async () => {
    jest.spyOn(DynamicsService, 'getAccessToken').mockResolvedValue('tok');
    global.fetch = jest.fn(async () => ({
      ok: false, status: 400, headers: { get: () => null },
      text: async () => 'AggregateQueryRecordLimit exceeded. Cannot perform '
        + 'aggregate on more than 50000 rows.',
    }));
    await expect(fetchXmlAggregateCount('akoya_requests',
      '<fetch aggregate="true"></fetch>', 'cnt'))
      .rejects.toThrow(/50,000 aggregate-count limit/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('result-token — the stateless preview→run confirm gate', () => {
  beforeAll(() => { process.env.NEXTAUTH_SECRET = 'test-nextauth-secret-at-least-32-chars-long'; });

  const spec = () => ({
    version: 1, entity: 'akoya_request', filters: [],
    programRollup: 'optionB', excludeOperational: true,
    excludeTestRecords: true, columns: { default: true }, eraScope: 'all',
  });

  test('mint → verify round-trips and binds the exact spec', async () => {
    const { token, expiresInSec } = await mintResultToken(
      spec(),
      { trueTotal: 42 },
      { markedIsolation: true },
    );
    expect(expiresInSec).toBe(3600);
    const v = await verifyResultToken(token);
    expect(v.valid).toBe(true);
    expect(v.spec).toEqual(spec());
    expect(v.meta.trueTotal).toBe(42);
    expect(v.policy).toEqual({ markedIsolation: true });
  });

  test('a token without a policy claim is treated as isolation-off', async () => {
    const legacy = await new SignJWT({ typ: 'dvx-preview', spec: spec(), meta: {} })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + 600)
      .sign(new TextEncoder().encode(process.env.NEXTAUTH_SECRET));
    const verified = await verifyResultToken(legacy);
    expect(verified).toEqual(expect.objectContaining({
      valid: true,
      policy: { markedIsolation: false },
    }));
  });

  test('a tampered token ⇒ invalid_signature (cannot run an unforged spec)', async () => {
    const { token } = await mintResultToken(spec());
    const tampered = `${token.slice(0, -3)}AAA`;
    expect((await verifyResultToken(tampered)).reason)
      .toMatch(/invalid_signature|malformed/);
  });

  test('absent / empty token ⇒ no_token (the /run gate rejects it 403)', async () => {
    expect((await verifyResultToken(undefined)).reason).toBe('no_token');
    expect((await verifyResultToken('')).reason).toBe('no_token');
  });

  test('a NextAuth-style JWT (no dvx-preview typ) ⇒ wrong_type — a session '
    + 'token cannot be replayed as a confirm token', async () => {
    const foreign = await new SignJWT({ sub: 'user', role: 'staff' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + 600)
      .sign(new TextEncoder().encode(process.env.NEXTAUTH_SECRET));
    expect((await verifyResultToken(foreign)).reason).toBe('wrong_type');
  });

  test('an expired token ⇒ expired', async () => {
    const past = await new SignJWT({ typ: 'dvx-preview', spec: spec(), meta: {} })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(new TextEncoder().encode(process.env.NEXTAUTH_SECRET));
    expect((await verifyResultToken(past)).reason).toBe('expired');
  });

  test('a token signed with a DIFFERENT secret ⇒ invalid_signature', async () => {
    const wrong = await new SignJWT({ typ: 'dvx-preview', spec: spec(), meta: {} })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + 600)
      .sign(new TextEncoder().encode('a-totally-different-secret-32-chars-xx'));
    expect((await verifyResultToken(wrong)).reason).toBe('invalid_signature');
  });
});
