import fs from 'node:fs';
import path from 'node:path';
import {
  assertCopiedSourceValues,
  assertSourceUnchanged,
  expectedRequestFolder,
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
    expect(projectCloneSource(source({ akoya_purpose: '' })).akoya_purpose).toBeNull();
    expect(expectedRequestFolder('1000001', projected.akoya_requestid))
      .toBe('1000001_AAAAAAAAAAAA4AAA8AAAAAAAAAAAAAAA');
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
    expect(script.match(/client\.postWithOptions\('\/akoya_requests'/g)).toHaveLength(1);
    expect(script).toContain('Only a source-bound v3 or bundle v4 manifest can execute a sandbox clone.');
    expect(script).toContain('const source = await fenceSource(client, manifest, preflightBefore.grantOption.value)');
    // The fence re-reads a sandbox source (v3) or re-validates the embedded
    // bundle (v4); the sandbox client never reads production.
    expect(script).toContain('await getSourceRequestById(client, manifest.source.requestId, requestOptions)');
    expect(script).toContain('source = bundleSourceOf(manifest).request;');
    expect(script).toContain('reserveRehearsalReceipt(receiptPath, receipt)');
    expect(script).toContain('manifest.values.locationId');
    expect(script).toContain('expectedFolder');
    expect(script).toContain('SharePoint location parent identity mismatch');
    expect(script).toContain('Preallocated request GUID is not absent');
    expect(script).toContain('READ_ONLY_PREFLIGHT');
    expect(script).toContain('writeNewJson(args.prepare, manifest)');
    const bypassIntent = script.indexOf('updateRehearsalReceipt(receiptPath, receipt);', script.indexOf('signalFence = createBypassSignalFence()'));
    const bypassWrite = script.indexOf('const workflowDeactivated = await setGoverifyWorkflowState(', bypassIntent);
    expect(bypassIntent).toBeGreaterThan(-1);
    expect(bypassWrite).toBeGreaterThan(bypassIntent);
    const requestIntent = script.indexOf('receipt.createAttempted = true;');
    const receiptPersist = script.indexOf('updateRehearsalReceipt(receiptPath, receipt);', requestIntent);
    const requestWrite = script.indexOf("client.postWithOptions('/akoya_requests'", receiptPersist);
    expect(receiptPersist).toBeGreaterThan(requestIntent);
    expect(requestWrite).toBeGreaterThan(receiptPersist);
    expect(script).toContain('receipt.createResponseReceivedAt = new Date().toISOString()');
    const datePatchIntent = script.indexOf('receipt.meetingDateCorrection.patchAttempted = true;');
    expect(script.indexOf('updateRehearsalReceipt(receiptPath, receipt);', datePatchIntent))
      .toBeLessThan(script.indexOf('patched = await client.patch(', datePatchIntent));
    const graphFolderIntent = script.indexOf('graphFolderAttempted: true');
    expect(script.indexOf('updateRehearsalReceipt(receiptPath, receipt);', graphFolderIntent))
      .toBeLessThan(script.indexOf('GraphService.ensureFolderPath', graphFolderIntent));
    expect(script).toContain('locationCreateAttempted = true');
    expect(script).toContain('receipt.observationStartedAt = new Date().toISOString()');
    expect(script).toContain('expectedSharePointFolder: expectedFolder');
    expect(script).toContain('postCreateStepsSkippedReason =');
    expect(script).toContain('restoreManualRecheckRequired = true');
    expect(script).toContain('Workflow ID: ${receipt.goverifyBypass.workflowId}.');
    expect(script).toContain('isGoverifyDeactivationUncertain(receipt.goverifyBypass)');
    expect(script).toContain('restoreVerified = true');
    expect(script).toContain('signalFence?.dispose()');
    expect(script).toContain('client.postWithOptions');
    const mainBody = script.slice(script.indexOf('async function main()'), script.indexOf('main().catch'));
    expect(mainBody).not.toMatch(/client\.(post|patch|delete)\s*\(/);
    expect(script).toContain('verifyCloneRequestReadback(manifest, request)');
  });

  test('copies bundle files only after the location exists, through the journaled copy module', () => {
    // File copy runs after the Request and its location are proven, never before.
    const locationProvision = script.indexOf('const location = await provisionSharePointLocation(');
    const copyCall = script.indexOf('await copyBundleDocuments(manifest, datedRequest, location.folder, preflightBefore, receipt, receiptPath)');
    expect(locationProvision).toBeGreaterThan(-1);
    expect(copyCall).toBeGreaterThan(locationProvision);
    // The receipt journal is persisted synchronously on every copy-module callback.
    const journalAssign = script.indexOf('receipt.fileCopies = journal;');
    expect(journalAssign).toBeGreaterThan(-1);
    expect(script.indexOf('updateRehearsalReceipt(receiptPath, receipt);', journalAssign) - journalAssign).toBeLessThan(80);
    // The script itself never uploads; the copy module owns the single create-only PUT.
    expect(script).not.toMatch(/GraphService\.uploadFile\([^)]*\)\s*;/);
    expect(script).toContain('retryOnAmbiguousFileUpload: false');
    expect(script).toContain('expectedSharePointFiles: plannedFiles.length');
    expect(script).toContain('verifyCopiedFiles(fileCopies, files)');
    expect(script).toContain("destinationRequestNumber: request.akoya_requestnum");
    // Source attestation, policy binding and freshness fences for bundle manifests.
    expect(script).toContain('source.akoya_requestnum !== args.sourceRequestNumber');
    expect(script).toContain('request.akoya_requestnum !== manifest.source.requestNumber');
    expect(script).toContain("manifest.copyPolicy?.digest !== copyPolicyDigest()");
    expect(script).toContain('if (!allowStale) assertBundleFresh(bundle);');
    expect(script).toContain('bundleSourceOf(manifest, { allowStale: allowExpired })');
    // Receipt-bound inspection reconciles journaled stable IDs read-only.
    expect(script).toContain('reconcileJournaledCopies(receipt.fileCopies');
    expect(script).toContain("Receipt does not belong to this manifest.");
    // Final manifest-authoritative byte check by stable ID runs after observation and gates verification.ok.
    const observation = script.indexOf('const observation = await observe(client, manifest.values.requestId);');
    const reverify = script.indexOf('reverifyCopiedItems(receipt.fileCopies || []');
    const persisted = script.indexOf('updateRehearsalReceipt(receiptPath, receipt);', reverify);
    expect(reverify).toBeGreaterThan(observation);
    expect(persisted).toBeGreaterThan(reverify);
    expect(script).toContain("verification.failures.push(...reverifyFailures.map((failure) => `final file check: ${failure}`))");
  });
});
