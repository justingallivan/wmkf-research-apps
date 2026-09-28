/**
 * Test Request Factory production target (production plan, MVP build list
 * item 1, S546): pinned target, production create-body additions, meeting-date
 * no-write, GoVerify bypass refusal, lease-time target check, CLI refusals.
 *
 * @jest-environment node
 */
import { jest } from '@jest/globals';
import { compileTestRequestDraft, TEST_REQUEST_FIXED_FIELDS } from '../../lib/services/test-requests/policy.js';
import {
  MANIFEST_V3,
  MANIFEST_V4,
  PRODUCTION_URL,
  SANDBOX_URL,
  buildCloneManifest,
  clientTargetEnvironment,
  computeRunPlanDigest,
  correctMeetingDate,
  createRequestWithGoverifyBypass,
  validateCloneManifest,
  verifyClone,
} from '../../lib/services/test-requests/basic-clone-steps.js';
import { verifyCloneRequestReadback } from '../../lib/services/test-requests/sandbox-clone.js';
import { assertRunTarget } from '../../lib/services/test-requests/run-runner.js';
import { parseArgs } from '../../scripts/rehearse-test-request-sandbox.mjs';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const ORG_ID = '33333333-3333-4333-8333-333333333333';
const APP_USER_ID = '44444444-4444-4444-8444-444444444444';
const PD_ID = '66666666-6666-4666-8666-666666666666';
const PROGRAM_ID = '77777777-7777-4777-8777-777777777777';

const BASE_FIELDS = [
  'akoya_requestid', 'akoya_title', 'akoya_purpose', 'akoya_request', 'akoya_fiscalyear',
  TEST_REQUEST_FIXED_FIELDS.requestType, 'wmkf_meetingdate', TEST_REQUEST_FIXED_FIELDS.marker,
  TEST_REQUEST_FIXED_FIELDS.runId, TEST_REQUEST_FIXED_FIELDS.responseReminder, TEST_REQUEST_FIXED_FIELDS.reviewReminder,
];

function typeOf(field) {
  if (field === 'akoya_request') return 'Money';
  if (field === 'akoya_purpose') return 'Memo';
  if (field === 'akoya_requestid' || field === TEST_REQUEST_FIXED_FIELDS.runId) return 'Uniqueidentifier';
  if (field === TEST_REQUEST_FIXED_FIELDS.requestType) return 'Picklist';
  if (field.includes('reminder') || field === TEST_REQUEST_FIXED_FIELDS.marker) return 'Boolean';
  if (field === 'wmkf_meetingdate') return 'DateOnly';
  return 'String';
}

function metadata({ production = true, overrides = {} } = {}) {
  const fields = Object.fromEntries(BASE_FIELDS.map((field) => [field, {
    createable: true, requiredLevel: 'None', type: typeOf(field),
    ...(field === 'akoya_request' ? { minValue: 0, maxValue: 1e9 } : {}),
    ...(['akoya_title', 'akoya_fiscalyear'].includes(field) ? { maxLength: 120 } : {}),
    ...(field === 'akoya_purpose' ? { maxLength: 100000 } : {}),
  }]));
  fields.akoya_applicantid = { createable: true, requiredLevel: 'None', type: 'Lookup', lookupTarget: 'accounts' };
  if (production) {
    fields.akoya_requeststatus = { createable: true, requiredLevel: 'None', type: 'String', maxLength: 100 };
    fields.wmkf_programdirector = {
      createable: true, requiredLevel: 'None', type: 'Lookup', lookupEntity: 'systemuser', navigationProperty: 'wmkf_ProgramDirector',
    };
    fields.wmkf_grantprogram = {
      createable: true, requiredLevel: 'None', type: 'Lookup', lookupEntity: 'wmkf_grantprogram', navigationProperty: 'wmkf_GrantProgram',
    };
  }
  return { entity: 'akoya_request', fields: { ...fields, ...overrides } };
}

function draftInput(overrides = {}) {
  return {
    recipe: 'basic',
    sourceRequest: { akoya_requestid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', akoya_purpose: 'Synthetic purpose', akoya_request: 1250 },
    testLabel: 'Fixture', fiscalYear: 'December 2026', requestType: 100000000, meetingDate: '2026-12-01',
    metadata: metadata(), requestId: REQUEST_ID, runId: RUN_ID, testOrganizationId: ORG_ID,
    ...overrides,
  };
}

const production = { requestStatus: 'Phase II Pending', programDirectorId: PD_ID, grantProgramId: PROGRAM_ID };

describe('policy: production create-body additions', () => {
  test('binds the program director and grant program through the metadata navigation properties', () => {
    const result = compileTestRequestDraft(draftInput({ production }));
    expect(result.blockers).toEqual([]);
    expect(result.createBody.akoya_requeststatus).toBe('Phase II Pending');
    expect(result.createBody['wmkf_ProgramDirector@odata.bind']).toBe(`/systemusers(${PD_ID})`);
    expect(result.createBody['wmkf_GrantProgram@odata.bind']).toBe(`/wmkf_grantprograms(${PROGRAM_ID})`);
  });

  test('a sandbox draft (no production input) carries none of the additions', () => {
    const result = compileTestRequestDraft(draftInput({ metadata: metadata({ production: false }) }));
    expect(result.blockers).toEqual([]);
    expect(Object.keys(result.createBody).some((key) => /requeststatus|ProgramDirector|GrantProgram/.test(key))).toBe(false);
  });

  test.each([
    ['an unlisted status', { ...production, requestStatus: 'Approved' }, 'akoya_requeststatus'],
    ['a non-GUID director', { ...production, programDirectorId: 'me@wmkeck.org' }, 'wmkf_programdirector'],
    ['an extra key', { ...production, payee: PD_ID }, 'production'],
  ])('refuses %s', (_label, value, field) => {
    const result = compileTestRequestDraft(draftInput({ production: value }));
    expect(result.createBody).toBeNull();
    expect(result.blockers.map((b) => b.field)).toContain(field);
  });

  test('refuses a lookup whose live target entity is not the expected one', () => {
    const md = metadata();
    md.fields.wmkf_programdirector = { ...md.fields.wmkf_programdirector, lookupEntity: 'contact' };
    const result = compileTestRequestDraft(draftInput({ metadata: md, production }));
    expect(result.createBody).toBeNull();
    expect(result.blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'LOOKUP_TARGET_UNKNOWN', field: 'wmkf_programdirector' })]));
  });

  test('refuses when the production columns are absent from metadata', () => {
    const result = compileTestRequestDraft(draftInput({ metadata: metadata({ production: false }), production }));
    expect(result.createBody).toBeNull();
    expect(result.blockers.map((b) => b.code)).toContain('METADATA_UNKNOWN');
  });
});

function productionManifest(overrides = {}) {
  return {
    kind: MANIFEST_V4,
    target: PRODUCTION_URL,
    targetEnvironment: 'production',
    recipe: 'basic',
    values: { requestId: REQUEST_ID, runId: RUN_ID, meetingDate: '2026-12-01', programDirectorId: PD_ID, grantProgramId: PROGRAM_ID },
    createBody: { akoya_requeststatus: 'Phase II Pending' },
    expectedAppUserId: APP_USER_ID,
    ...overrides,
  };
}

describe('manifest target', () => {
  test('buildCloneManifest refuses a production target without a bundle, a program director, or with a non-basic recipe', () => {
    const preflight = { targetEnvironment: 'production', grantProgram: { grantprogramid: PROGRAM_ID } };
    const director = { systemuserid: PD_ID };
    expect(() => buildCloneManifest(preflight, { programDirector: director })).toThrow(/requires a source bundle/);
    expect(() => buildCloneManifest(preflight, { bundle: {}, programDirector: director, recipe: 'reviews' })).toThrow(/only the basic recipe/);
    expect(() => buildCloneManifest(preflight, { bundle: {} })).toThrow(/program director and grant program/);
    expect(() => buildCloneManifest({ targetEnvironment: 'sandbox' }, { programDirector: director })).toThrow(/only on a production target/);
  });

  test('validateCloneManifest refuses a production manifest on the legacy one-shot execute path', () => {
    expect(() => validateCloneManifest(productionManifest(), { forExecute: true })).toThrow(/legacy one-shot execute is sandbox-only/);
  });

  test('validateCloneManifest refuses a target URL that does not match its environment', () => {
    expect(() => validateCloneManifest(productionManifest({ target: SANDBOX_URL }))).toThrow(/not a registered Factory target/);
    expect(() => validateCloneManifest({ kind: MANIFEST_V3, target: PRODUCTION_URL })).toThrow(/not a registered Factory target/);
  });

  test('validateCloneManifest refuses a production manifest without a pinned program director', () => {
    const manifest = productionManifest({ values: { ...productionManifest().values, programDirectorId: undefined } });
    expect(() => validateCloneManifest(manifest)).toThrow(/program director and grant program/);
  });

  test('the plan digest binds a production target and leaves a sandbox digest unchanged', () => {
    const sandbox = {
      values: { runId: RUN_ID, requestId: REQUEST_ID, locationId: REQUEST_ID }, recipe: 'basic',
      source: { requestId: ORG_ID, revision: 'r', bundleSha256: 'b' }, copyPolicy: { digest: 'c' }, createBodySha256: 'd',
      target: SANDBOX_URL,
    };
    expect(computeRunPlanDigest({ manifest: sandbox })).toBe(computeRunPlanDigest({ manifest: { ...sandbox, target: undefined } }));
    const prod = { ...sandbox, target: PRODUCTION_URL, targetEnvironment: 'production' };
    expect(computeRunPlanDigest({ manifest: prod })).not.toBe(computeRunPlanDigest({ manifest: sandbox }));
  });
});

describe('clientTargetEnvironment', () => {
  test('identifies the registered hosts, refuses others, and treats a client without a base URL as the sandbox', () => {
    expect(clientTargetEnvironment({ baseUrl: `${PRODUCTION_URL}/api/data/v9.2` })).toBe('production');
    expect(clientTargetEnvironment({ baseUrl: `${SANDBOX_URL}/api/data/v9.2` })).toBe('sandbox');
    expect(() => clientTargetEnvironment({ baseUrl: 'https://other.crm.dynamics.com/api/data/v9.2' })).toThrow(/not a registered Factory target/);
    expect(clientTargetEnvironment({})).toBe('sandbox');
  });
});

describe('correctMeetingDate on a production target', () => {
  const fresh = (date) => ({
    akoya_requestid: REQUEST_ID, wmkf_testcreationrunid: RUN_ID, _createdby_value: APP_USER_ID, _ownerid_value: APP_USER_ID,
    wmkf_istestrequest: true, wmkf_meetingdate: date, '@odata.etag': 'W/"e"',
  });

  test('a mismatched date stops the run and issues no PATCH', async () => {
    const client = { patch: jest.fn(), get: jest.fn() };
    const journal = jest.fn(async () => {});
    await expect(correctMeetingDate(client, productionManifest(), fresh('2024-12-13'), journal))
      .rejects.toMatchObject({ code: 'meeting_date_readback_mismatch' });
    expect(client.patch).not.toHaveBeenCalled();
    expect(client.get).not.toHaveBeenCalled();
    expect(journal).not.toHaveBeenCalled();
  });

  test('a matching date advances with no PATCH', async () => {
    const client = { patch: jest.fn(), get: jest.fn() };
    const request = fresh('2026-12-01');
    await expect(correctMeetingDate(client, productionManifest(), request, jest.fn())).resolves.toBe(request);
    expect(client.patch).not.toHaveBeenCalled();
  });
});

describe('GoVerify bypass on a production target', () => {
  test('createRequestWithGoverifyBypass refuses before any Dataverse call', async () => {
    const client = { get: jest.fn(), post: jest.fn(), patch: jest.fn(), patchWithOptions: jest.fn() };
    await expect(createRequestWithGoverifyBypass({
      client, manifest: productionManifest(), preflightBefore: {}, bypassGoverify: true, journal: jest.fn(),
    })).rejects.toMatchObject({ code: 'create_rejected' });
    for (const method of Object.values(client)) expect(method).not.toHaveBeenCalled();
  });
});

describe('verifyCloneRequestReadback on a production target', () => {
  test('accepts the status production\'s create plug-in leaves ("Pending"), refuses any other', () => {
    const manifest = productionManifest({ expectedOrganization: { accountid: 'a' } });
    const failuresFor = (status) => verifyCloneRequestReadback(manifest, { akoya_requeststatus: status });
    expect(failuresFor('Pending')).not.toContain('request status mismatch');
    expect(failuresFor('Phase II Pending')).not.toContain('request status mismatch');
    expect(failuresFor('Declined')).toContain('request status mismatch');
  });

  test('flags a status, program director or grant program the platform changed', () => {
    const manifest = {
      ...productionManifest(),
      createBody: { akoya_requeststatus: 'Phase II Pending', akoya_title: 'T', akoya_fiscalyear: 'F', akoya_requesttype: 1 },
      expectedOrganization: { accountid: ORG_ID },
    };
    const failures = verifyCloneRequestReadback(manifest, {
      akoya_requestid: REQUEST_ID, akoya_title: 'T', akoya_fiscalyear: 'F', akoya_requesttype: 1, wmkf_meetingdate: '2026-12-01',
      _akoya_applicantid_value: ORG_ID, _createdby_value: APP_USER_ID, _ownerid_value: APP_USER_ID, wmkf_istestrequest: true,
      wmkf_testcreationrunid: RUN_ID, wmkf_respondreminderenabled: false, wmkf_reviewduereminderenabled: false,
      akoya_requeststatus: 'Concept Pending', _wmkf_programdirector_value: APP_USER_ID, _wmkf_grantprogram_value: null,
    });
    expect(failures).toEqual(['request status mismatch', 'program director mismatch', 'grant program mismatch']);
  });
});

describe('assertRunTarget (checked before every lease)', () => {
  const prodClient = { baseUrl: `${PRODUCTION_URL}/api/data/v9.2` };
  const sandboxClient = { baseUrl: `${SANDBOX_URL}/api/data/v9.2` };
  const prodRun = { destinationEnvironment: 'production', destinationDataverseHost: new URL(PRODUCTION_URL).hostname };

  test('accepts a production run, manifest and client that agree', () => {
    expect(() => assertRunTarget(prodRun, productionManifest(), prodClient)).not.toThrow();
  });

  test.each([
    ['a sandbox client', prodRun, productionManifest(), sandboxClient],
    ['a sandbox ledger row', { ...prodRun, destinationEnvironment: 'sandbox' }, productionManifest(), prodClient],
    ['a missing ledger host', { destinationEnvironment: 'production' }, productionManifest(), prodClient],
    ['a sandbox manifest driving a production client', { destinationEnvironment: 'sandbox' }, { target: SANDBOX_URL }, prodClient],
    ['a target-less (legacy) manifest driving a production client', {}, {}, prodClient],
  ])('refuses %s', (_label, run, manifest, client) => {
    expect(() => assertRunTarget(run, manifest, client)).toThrow(/Run target does not match/);
  });

  test('refuses the GoVerify bypass for a production run', () => {
    expect(() => assertRunTarget(prodRun, productionManifest(), prodClient, { bypassGoverify: true })).toThrow(/never used on a production target/);
  });
});

describe('CLI --target', () => {
  const reserve = (...extra) => [
    'node', 'x', '--reserve', '--source-request-number=1003222', '--bundle=/a/b.json', '--manifest-out=/a/m.json',
    '--idempotency-key=k1', '--target=production', ...extra,
  ];
  test('production reserve requires --director and the basic recipe', () => {
    expect(() => parseArgs(reserve())).toThrow(/--director/);
    expect(() => parseArgs(reserve('--director=me@wmkeck.org', '--recipe=reviews'))).toThrow(/--recipe=basic/);
    expect(parseArgs(reserve('--director=me@wmkeck.org')).target).toBe('production');
  });
  test('production refuses the bypass and the legacy one-shot paths', () => {
    expect(() => parseArgs(['node', 'x', '--advance=r', '--manifest=/a', '--bundle=/b', '--target=production', '--bypass-goverify'])).toThrow(/never valid/);
    expect(() => parseArgs(['node', 'x', '--execute=/a', '--receipt=/b', '--target=production'])).toThrow(/sandbox-only/);
  });
  test('--run-recheck is production-only, takes a run GUID, and is its own mode', () => {
    const runId = '11111111-1111-4111-8111-111111111111';
    expect(parseArgs(['node', 'x', `--run-recheck=${runId}`, '--target=production']).runRecheck).toBe(runId);
    expect(() => parseArgs(['node', 'x', `--run-recheck=${runId}`])).toThrow(/only with --target=production/);
    expect(() => parseArgs(['node', 'x', '--run-recheck=nope', '--target=production'])).toThrow(/run ID GUID/);
    expect(() => parseArgs(['node', 'x', `--run-recheck=${runId}`, `--run-inspect=${runId}`, '--target=production'])).toThrow(/Choose exactly one/);
  });

  test('--director is refused outside a production reserve, and unknown targets are refused', () => {
    expect(() => parseArgs(['node', 'x', '--reserve', '--source-request-number=1', '--bundle=/a', '--manifest-out=/m', '--idempotency-key=k', '--director=me@wmkeck.org'])).toThrow(/--director is valid only/);
    expect(() => parseArgs(['node', 'x', '--target=staging'])).toThrow(/sandbox or production/);
  });
});

describe('verifyClone on a production target', () => {
  const manifest = (overrides = {}) => productionManifest({ expectedOrganization: { accountid: 'a' }, invariants: { expectedSharePointFiles: 0 }, ...overrides });
  const observation = (emails) => ({ request: {}, payments: [], emails, locations: [], locationParents: [] });
  const preflightBefore = { foundation: { accountid: 'a', versionnumber: 1 }, contacts: [] };

  test('names each regarding email by state, direction, creator and time, never by subject', () => {
    const { failures } = verifyClone(manifest(), preflightBefore, observation([{
      activityid: 'e1', subject: 'Private subject', statecode: 0, statuscode: 1, directioncode: true, senton: null,
      createdon: '2026-09-28T18:10:00Z', _createdby_value: APP_USER_ID,
    }]), [], preflightBefore.foundation, []);
    const message = failures.find((failure) => failure.startsWith('created 1 regarding email'));
    expect(message).toBe(`created 1 regarding email row(s): outgoing status 0/1 unsent, created 2026-09-28T18:10:00Z by ${APP_USER_ID}`);
    expect(failures.join(' ')).not.toMatch(/Private subject/);
  });

  test('leaves the Foundation comparison to the runner pre-create baseline', () => {
    const result = verifyClone(manifest(), preflightBefore, observation([]), [], { accountid: 'a', versionnumber: 2 }, [{ contactid: 'c', versionnumber: 1 }]);
    expect(result.failures).not.toContain('Foundation account changed during rehearsal');
    expect(result.accountChanges).toEqual([]);
    const sandbox = verifyClone(manifest({ targetEnvironment: 'sandbox' }), preflightBefore, observation([]), [], { accountid: 'a', versionnumber: 2 }, []);
    expect(sandbox.failures).toContain('Foundation account changed during rehearsal');
  });
});
