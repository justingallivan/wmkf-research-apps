import fs from 'node:fs';
import path from 'node:path';
import {
  assertCopiedSourceValues,
  assertSourceUnchanged,
  projectCloneSource,
  requireUniqueSourceRequest,
  resolveCloneCycle,
  verifyCloneRequestReadback,
} from '../../lib/services/test-requests/sandbox-clone.js';

const source = (overrides = {}) => ({
  akoya_requestid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  akoya_requestnum: '1000339',
  akoya_requesttype: 100000000,
  akoya_purpose: 'Synthetic source purpose',
  akoya_request: 125000,
  akoya_fiscalyear: 'December 2026',
  wmkf_meetingdate: '2026-12-04T00:00:00Z',
  '@odata.etag': 'W/"source-7"',
  akoya_requeststatus: 'Approved',
  _akoya_primarycontactid_value: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  akoya_paid: 999,
  ...overrides,
});

describe('sandbox clone source fence', () => {
  test('projects only copyable fields and copies the source fiscal year and meeting date by default', () => {
    const projected = projectCloneSource(source());
    expect(projected).toEqual({
      akoya_requestid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      akoya_requestnum: '1000339',
      akoya_requesttype: 100000000,
      akoya_purpose: 'Synthetic source purpose',
      akoya_request: 125000,
      akoya_fiscalyear: 'December 2026',
      wmkf_meetingdate: '2026-12-04',
      revision: 'W/"source-7"',
    });
    expect(projected).not.toHaveProperty('akoya_requeststatus');
    expect(projected).not.toHaveProperty('_akoya_primarycontactid_value');
    expect(projected).not.toHaveProperty('akoya_paid');
    expect(resolveCloneCycle(projected)).toEqual({ fiscalYear: 'December 2026', meetingDate: '2026-12-04' });
  });

  test('requires an explicit override for each missing source cycle value', () => {
    const projected = projectCloneSource(source({ akoya_fiscalyear: null, wmkf_meetingdate: null }));
    expect(() => resolveCloneCycle(projected)).toThrow('--fiscal-year');
    expect(() => resolveCloneCycle(projected, { fiscalYear: 'June 2027' })).toThrow('--meeting-date');
    expect(resolveCloneCycle(projected, { fiscalYear: 'June 2027', meetingDate: '2027-06-11' }))
      .toEqual({ fiscalYear: 'June 2027', meetingDate: '2027-06-11' });
  });

  test('explicit cycle overrides win after calendar validation', () => {
    expect(resolveCloneCycle(projectCloneSource(source()), {
      fiscalYear: 'June 2027', meetingDate: '2027-06-11',
    })).toEqual({ fiscalYear: 'June 2027', meetingDate: '2027-06-11' });
    expect(() => resolveCloneCycle(projectCloneSource(source()), { meetingDate: '2027-02-30' }))
      .toThrow('--meeting-date');
  });

  test('source lookup fails closed for missing, ambiguous, or truncated result sets', () => {
    expect(() => requireUniqueSourceRequest([])).toThrow('found 0');
    expect(() => requireUniqueSourceRequest([source(), source({ akoya_requestid: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' })]))
      .toThrow('found 2');
    expect(() => requireUniqueSourceRequest([source()], true)).toThrow('found 1+');
  });

  test('pre-write fence rejects changed revision, changed copied values, wrong type, and missing source', () => {
    const prepared = projectCloneSource(source());
    const provenance = {
      requestId: prepared.akoya_requestid,
      requestType: prepared.akoya_requesttype,
      revision: prepared.revision,
    };
    expect(assertSourceUnchanged(provenance, source(), 100000000)).toEqual(prepared);
    expect(() => assertSourceUnchanged(provenance, source({ versionnumber: '8', '@odata.etag': 'W/"source-8"' }), 100000000))
      .toThrow('changed since prepare');
    expect(() => assertSourceUnchanged(provenance, source({ akoya_requesttype: 100000001 }), 100000000))
      .toThrow('no longer the same Grant');
    expect(() => assertSourceUnchanged(provenance, null, 100000000)).toThrow('missing or invalid');
    expect(() => assertCopiedSourceValues(projectCloneSource(source({ akoya_request: 1 })), {
      akoya_purpose: 'Synthetic source purpose', akoya_request: 125000,
    })).toThrow('copied values changed');
  });

  test('readback rejects drift in marker, run, date, creator, or owner while accepting the complete planned row', () => {
    const manifest = {
      values: {
        requestId: '11111111-1111-4111-8111-111111111111',
        runId: '22222222-2222-4222-8222-222222222222',
        meetingDate: '2026-12-04',
      },
      expectedOrganization: { accountid: '33333333-3333-4333-8333-333333333333' },
      expectedAppUserId: '44444444-4444-4444-8444-444444444444',
      createBody: {
        akoya_title: 'TEST: safe fixture',
        akoya_fiscalyear: 'December 2026',
        akoya_purpose: 'Synthetic purpose',
        akoya_request: 125000,
        akoya_requesttype: 100000000,
        wmkf_respondreminderenabled: false,
        wmkf_reviewduereminderenabled: false,
      },
    };
    const row = {
      akoya_requestid: manifest.values.requestId,
      akoya_title: manifest.createBody.akoya_title,
      akoya_fiscalyear: manifest.createBody.akoya_fiscalyear,
      akoya_purpose: manifest.createBody.akoya_purpose,
      akoya_request: manifest.createBody.akoya_request,
      akoya_requesttype: manifest.createBody.akoya_requesttype,
      wmkf_meetingdate: manifest.values.meetingDate,
      _akoya_applicantid_value: manifest.expectedOrganization.accountid,
      _createdby_value: manifest.expectedAppUserId,
      _ownerid_value: manifest.expectedAppUserId,
      wmkf_istestrequest: true,
      wmkf_testcreationrunid: manifest.values.runId,
      wmkf_respondreminderenabled: false,
      wmkf_reviewduereminderenabled: false,
    };
    expect(verifyCloneRequestReadback(manifest, row)).toEqual([]);
    const drifted = verifyCloneRequestReadback(manifest, {
      ...row,
      wmkf_istestrequest: false,
      wmkf_testcreationrunid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      wmkf_meetingdate: '2024-12-13',
      _createdby_value: '55555555-5555-4555-8555-555555555555',
      _ownerid_value: '66666666-6666-4666-8666-666666666666',
    });
    expect(drifted).toEqual(expect.arrayContaining([
      'test marker not true', 'run ID mismatch', 'meeting date mismatch', 'creator mismatch', 'owner mismatch',
    ]));
  });
});

describe('sandbox operator write boundary', () => {
  const scriptPath = path.resolve(process.cwd(), 'scripts/rehearse-test-request-sandbox.mjs');
  const script = fs.readFileSync(scriptPath, 'utf8');

  test('keeps one Request create and routes it through execute only', () => {
    expect(script.match(/client\.post\('\/akoya_requests'/g)).toHaveLength(1);
    expect(script).toContain('Only a source-bound v3 manifest can execute a sandbox clone.');
    expect(script).toContain('assertSourceUnchanged(manifest.source, sourceRow, preflightBefore.grantOption.value)');
    expect(script).toContain('const receiptDescriptor = reserveJsonReceipt(receiptPath, receipt)');
    expect(script).toContain('manifest.values.locationId');
    expect(script).toContain('expectedFolder');
    expect(script).toContain('SharePoint location parent identity mismatch');
    expect(script).toContain('Preallocated request GUID is not absent');
    expect(script).toContain('READ_ONLY_PREFLIGHT');
    expect(script).toContain('writeNewJson(args.prepare, manifest)');
    const bypassIntent = script.indexOf('updateReservedJson(receiptDescriptor, receipt);\n        const workflowDeactivated');
    const bypassWrite = script.indexOf('await setGoverifyWorkflowState(' , bypassIntent);
    expect(bypassIntent).toBeGreaterThan(-1);
    expect(bypassWrite).toBeGreaterThan(bypassIntent);
    const requestIntent = script.indexOf('receipt.createAttempted = true;');
    const receiptPersist = script.indexOf('updateReservedJson(receiptDescriptor, receipt);', requestIntent);
    const requestWrite = script.indexOf("client.post('/akoya_requests'", receiptPersist);
    expect(receiptPersist).toBeGreaterThan(requestIntent);
    expect(requestWrite).toBeGreaterThan(receiptPersist);
    const mainBody = script.slice(script.indexOf('async function main()'), script.indexOf('main().catch'));
    expect(mainBody).not.toMatch(/client\.(post|patch|delete)\s*\(/);
    expect(script).toContain('verifyCloneRequestReadback(manifest, request)');
  });
});
