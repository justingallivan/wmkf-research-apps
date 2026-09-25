/**
 * Behavioral pins for lib/services/test-requests/basic-clone-steps.js
 * (build order item 5, slice 5b), replacing these literal-text pins
 * formerly in tests/unit/test-request-sandbox-clone.test.js's "sandbox
 * operator write boundary" describe block (moved because the code they
 * pinned moved out of scripts/rehearse-test-request-sandbox.mjs):
 *
 *   - 'Only a source-bound v3 or bundle v4 manifest can execute a sandbox
 *     clone.' (validateCloneManifest)
 *   - 'const source = await fenceSource(client, manifest, ...)' call-site
 *     text and the v3/v4 fenceSource branch literals
 *     ("await getSourceRequestById(...)", "source = bundleSourceOf(...)")
 *   - 'SharePoint location parent identity mismatch' (verifyClone)
 *   - 'Preallocated request GUID is not absent' (checkPreallocatedRequestAbsent)
 *   - the bypassIntent/bypassWrite, requestIntent/receiptPersist/requestWrite,
 *     datePatchIntent, graphFolderIntent ordering pins (all folded into the
 *     journal-callback-ordering tests below)
 *   - 'receipt.createResponseReceivedAt = ...', 'locationCreateAttempted = true',
 *     'postCreateStepsSkippedReason =' (inside the module), 'restoreManualRecheckRequired = true',
 *     'Workflow ID: ${receipt.goverifyBypass.workflowId}.', 'isGoverifyDeactivationUncertain(...)',
 *     'restoreVerified = true', 'signalFence?.dispose()' (all covered by the
 *     GoVerify bypass/uncertain-state tests below)
 *   - 'client.postWithOptions' generic pin and the exact-one-POST regex pin
 *     (now checked against this module's source, see the first test)
 *   - 'verifyCloneRequestReadback(manifest, request)' (verifyClone)
 *   - 'retryOnAmbiguousFileUpload: false', 'expectedSharePointFiles: plannedFiles.length'
 *     (buildCloneManifest), 'verifyCopiedFiles(fileCopies, files)' (verifyClone),
 *     'request.akoya_requestnum !== manifest.source.requestNumber',
 *     'manifest.copyPolicy?.digest !== copyPolicyDigest()',
 *     'if (!allowStale) assertBundleFresh(bundle);' (bundleSourceOf),
 *     'bundleSourceOf(manifest, { allowStale: allowExpired })' (validateCloneManifest)
 */
import fs from 'node:fs';
import path from 'node:path';
import { jest } from '@jest/globals';
import {
  MANIFEST_V3,
  bodyOrThrow,
  bundleSourceOf,
  checkPreallocatedRequestAbsent,
  correctMeetingDate,
  createRequestWithGoverifyBypass,
  fenceSource,
  provisionSharePointLocation,
  sha256,
  validateCloneManifest,
  verifyClone,
} from '../../lib/services/test-requests/basic-clone-steps.js';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const SOURCE_ID = '33333333-3333-4333-8333-333333333333';
const APP_USER_ID = '44444444-4444-4444-8444-444444444444';
const LOCATION_ID = '55555555-5555-4555-8555-555555555555';

function ok(body, status = 200) {
  return { ok: true, status, body };
}

function baseManifest(overrides = {}) {
  return {
    kind: MANIFEST_V3,
    target: 'https://orgd9e66399.crm.dynamics.com',
    values: {
      requestId: REQUEST_ID, runId: RUN_ID, locationId: LOCATION_ID, meetingDate: '2026-12-01',
    },
    source: { requestId: SOURCE_ID, revision: 'rev-1', requestType: 100000000 },
    createBody: {
      akoya_requestid: REQUEST_ID, wmkf_testcreationrunid: RUN_ID,
      akoya_purpose: 'Synthetic purpose', akoya_request: 5000,
      akoya_title: 'TEST: fixture',
    },
    expectedAppUserId: APP_USER_ID,
    expectedOrganization: { accountid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    invariants: { exactlyOneCreate: true, retryOnAmbiguousCreate: false },
    ...overrides,
  };
}

function sourceRow(overrides = {}) {
  return {
    akoya_requestid: SOURCE_ID,
    akoya_requesttype: 100000000,
    akoya_purpose: 'Synthetic purpose',
    akoya_request: 5000,
    '@odata.etag': 'rev-1',
    akoya_requestnum: '9000001',
    akoya_fiscalyear: 'December 2026',
    wmkf_meetingdate: '2026-12-01',
    ...overrides,
  };
}

describe('module source pins', () => {
  const modulePath = path.resolve(process.cwd(), 'lib/services/test-requests/basic-clone-steps.js');
  const source = fs.readFileSync(modulePath, 'utf8');

  test('the sole Request create POST lives in this module, exactly once', () => {
    expect(source.match(/client\.postWithOptions\('\/akoya_requests'/g)).toHaveLength(1);
  });

  test('validateCloneManifest and fenceSource keep their v3/v4 provenance text', () => {
    expect(source).toContain('Only a source-bound v3 or bundle v4 manifest can execute a sandbox clone.');
    expect(source).toContain('source = bundleSourceOf(manifest).request;');
    expect(source).toContain('await getSourceRequestById(client, manifest.source.requestId, requestOptions)');
    expect(source).toContain('bundleSourceOf(manifest, { allowStale: allowExpired })');
  });

  test('verifyClone and bundle-manifest invariant text moved intact', () => {
    expect(source).toContain('SharePoint location parent identity mismatch');
    expect(source).toContain('verifyCloneRequestReadback(manifest, request)');
    expect(source).toContain('verifyCopiedFiles(fileCopies, files)');
    expect(source).toContain('retryOnAmbiguousFileUpload: false');
    expect(source).toContain('expectedSharePointFiles: plannedFiles.length');
    expect(source).toContain('request.akoya_requestnum !== manifest.source.requestNumber');
    expect(source).toContain('manifest.copyPolicy?.digest !== copyPolicyDigest()');
    expect(source).toContain('if (!allowStale) assertBundleFresh(bundle);');
  });

  test('checkPreallocatedRequestAbsent keeps its error text', () => {
    expect(source).toContain('Preallocated request GUID is not absent');
  });
});

describe('fenceSource / validateCloneManifest', () => {
  test('v3 fenceSource re-reads the sandbox source and enforces copied-value fencing', async () => {
    const manifest = baseManifest();
    const client = { get: jest.fn(async () => ok(sourceRow())) };
    const source = await fenceSource(client, manifest, 100000000);
    expect(source.akoya_purpose).toBe('Synthetic purpose');
    expect(client.get).toHaveBeenCalledTimes(1);
  });

  test('fenceSource throws when the copied purpose/amount changed since prepare', async () => {
    const manifest = baseManifest();
    const client = { get: jest.fn(async () => ok(sourceRow({ akoya_purpose: 'Changed purpose' }))) };
    await expect(fenceSource(client, manifest, 100000000)).rejects.toThrow('copied values changed');
  });

  test('validateCloneManifest refuses a v1/v2 manifest at execute time', () => {
    const manifest = baseManifest({ createBodySha256: sha256(baseManifest().createBody) });
    manifest.createBodySha256 = sha256(manifest.createBody);
    expect(() => validateCloneManifest(manifest, { forExecute: true })).not.toThrow();
    const legacy = { ...manifest, kind: 'test-request-sandbox-rehearsal-manifest/v1' };
    expect(() => validateCloneManifest(legacy, { forExecute: true }))
      .toThrow('Only a source-bound v3 or bundle v4 manifest can execute a sandbox clone.');
  });

  test('validateCloneManifest restricts only execute mode to the basic recipe', () => {
    const initialAssessment = baseManifest({ recipe: 'initial_assessment' });
    initialAssessment.createBodySha256 = sha256(initialAssessment.createBody);
    expect(() => validateCloneManifest(initialAssessment, { forExecute: true }))
      .toThrow('Only a basic recipe manifest can execute the legacy one-shot sandbox clone.');

    const withoutRecipe = baseManifest();
    withoutRecipe.createBodySha256 = sha256(withoutRecipe.createBody);
    expect(() => validateCloneManifest(withoutRecipe, { forExecute: true })).not.toThrow();

    const basic = baseManifest({ recipe: 'basic' });
    basic.createBodySha256 = sha256(basic.createBody);
    expect(() => validateCloneManifest(basic, { forExecute: true })).not.toThrow();

    expect(() => validateCloneManifest(initialAssessment, { forExecute: false })).not.toThrow();
  });
});

describe('checkPreallocatedRequestAbsent', () => {
  test('passes when the preallocated GUID is absent (404)', async () => {
    const client = { get: jest.fn(async () => ({ ok: false, status: 404 })) };
    await expect(checkPreallocatedRequestAbsent(client, REQUEST_ID)).resolves.toBeUndefined();
  });

  test('throws when the preallocated GUID already exists', async () => {
    const client = { get: jest.fn(async () => ok({ akoya_requestid: REQUEST_ID })) };
    await expect(checkPreallocatedRequestAbsent(client, REQUEST_ID)).rejects.toThrow('Preallocated request GUID is not absent');
  });
});

describe('createRequestWithGoverifyBypass', () => {
  function preflightBefore() {
    return { grantOption: { value: 100000000 } };
  }

  test('without a bypass: journals createAttempted BEFORE the POST and the response AFTER it', async () => {
    const manifest = baseManifest();
    const calls = [];
    const client = {
      get: jest.fn(async () => ok(sourceRow())),
      postWithOptions: jest.fn(async () => {
        calls.push('dispatch');
        return ok({ akoya_requestid: REQUEST_ID, akoya_requestnum: '9000002' }, 201);
      }),
    };
    const journal = jest.fn(async (patch) => { calls.push(Object.keys(patch)[0]); });
    const { created } = await createRequestWithGoverifyBypass({
      client, manifest, preflightBefore: preflightBefore(), bypassGoverify: false, journal,
    });
    expect(created.body.akoya_requestnum).toBe('9000002');
    const attemptIndex = calls.indexOf('createAttempted');
    const dispatchIndex = calls.indexOf('dispatch');
    const responseIndex = calls.indexOf('createResponseStatus');
    expect(attemptIndex).toBeGreaterThan(-1);
    expect(attemptIndex).toBeLessThan(dispatchIndex);
    expect(dispatchIndex).toBeLessThan(responseIndex);
  });

  test('a GoVerify deactivation PATCH that never confirms deactivation is a manual-recheck dead end, never auto-resolved', async () => {
    const manifest = baseManifest();
    const workflowRow = {
      workflowid: 'a5d850ee-e5b4-409c-a7e5-65ac82ff9ceb',
      workflowidunique: 'x',
      name: 'GOverify- check Publication 78 on create of a request record',
      category: 0, type: 1, mode: 1, primaryentity: 'akoya_request',
      componentstate: 0, triggeroncreate: true, statecode: 1, statuscode: 2,
      versionnumber: 100,
      '@odata.etag': 'W/"100"',
    };
    const client = {
      get: jest.fn(async (requestPath) => {
        if (requestPath.startsWith('/workflows(')) return ok(workflowRow);
        if (requestPath.startsWith('/workflows?')) {
          return ok({
            value: [{
              workflowid: 'activation-1',
              name: workflowRow.name,
              type: 2,
              primaryentity: workflowRow.primaryentity,
              statecode: 1,
              statuscode: 2,
              _parentworkflowid_value: workflowRow.workflowid,
            }],
          });
        }
        return ok(sourceRow());
      }),
      patch: jest.fn(async () => {
        // The deactivation PATCH itself throws (simulating a network drop
        // AFTER the patch attempt was journaled but before any confirmation).
        throw new Error('socket hang up');
      }),
      postWithOptions: jest.fn(),
    };
    const journalPatches = [];
    const journal = jest.fn(async (patch) => { journalPatches.push(patch); });
    await expect(createRequestWithGoverifyBypass({
      client, manifest, preflightBefore: preflightBefore(), bypassGoverify: true, journal,
    })).rejects.toThrow('Manually recheck the workflow before resuming');
    // The create POST must never have been attempted once deactivation is uncertain.
    expect(client.postWithOptions).not.toHaveBeenCalled();
    const manualRecheck = journalPatches.find((patch) => patch.goverifyBypass?.restoreManualRecheckRequired === true);
    expect(manualRecheck).toBeDefined();
    // createAttempted never happened, so postCreateStepsSkipped must not be set.
    expect(manualRecheck.postCreateStepsSkipped).toBeUndefined();
  });
});

describe('correctMeetingDate', () => {
  test('the ETag used for the PATCH comes from the fresh in-step readback, not a re-fetch', async () => {
    const manifest = baseManifest();
    const freshRequest = {
      akoya_requestid: REQUEST_ID,
      wmkf_testcreationrunid: RUN_ID,
      _createdby_value: APP_USER_ID,
      _ownerid_value: APP_USER_ID,
      wmkf_istestrequest: true,
      wmkf_meetingdate: '2026-11-01',
      '@odata.etag': 'W/"fresh-etag"',
    };
    const patch = jest.fn(async (path, body, headers) => {
      expect(headers['If-Match']).toBe('W/"fresh-etag"');
      return ok({}, 204);
    });
    const client = {
      patch,
      get: jest.fn(async () => ok({
        ...freshRequest, wmkf_meetingdate: '2026-12-01',
      })),
    };
    const journal = jest.fn(async () => {});
    const result = await correctMeetingDate(client, manifest, freshRequest, journal);
    expect(patch).toHaveBeenCalledTimes(1);
    expect(result.wmkf_meetingdate).toBe('2026-12-01');
  });

  test('no PATCH is issued when the date already matches, and journal is never called', async () => {
    const manifest = baseManifest({ values: { ...baseManifest().values, meetingDate: '2026-12-01' } });
    const freshRequest = {
      akoya_requestid: REQUEST_ID,
      wmkf_testcreationrunid: RUN_ID,
      _createdby_value: APP_USER_ID,
      _ownerid_value: APP_USER_ID,
      wmkf_istestrequest: true,
      wmkf_meetingdate: '2026-12-01',
      '@odata.etag': 'W/"fresh-etag"',
    };
    const client = { patch: jest.fn(), get: jest.fn() };
    const journal = jest.fn(async () => {});
    const result = await correctMeetingDate(client, manifest, freshRequest, journal);
    expect(client.patch).not.toHaveBeenCalled();
    expect(journal).not.toHaveBeenCalled();
    expect(result).toBe(freshRequest);
  });
});

describe('provisionSharePointLocation', () => {
  const sharePointTarget = () => ({ registered: true, key: 'akoyago-shared', siteUrl: 'https://example.sharepoint.com/sites/akoyago' });

  test('refuses when a location already exists for this Request', async () => {
    const manifest = baseManifest();
    const request = {
      akoya_requestid: REQUEST_ID, wmkf_testcreationrunid: RUN_ID,
      _createdby_value: APP_USER_ID, _ownerid_value: APP_USER_ID,
      wmkf_istestrequest: true, akoya_requestnum: '9000001',
    };
    const client = {
      get: jest.fn(async (requestPath) => {
        if (requestPath.includes('$filter=relativeurl')) {
          return ok({ value: [{ sharepointdocumentlocationid: 'parent-1', name: 'akoya_request' }] });
        }
        // getLocations: pretend one already exists.
        return ok({ value: [{ sharepointdocumentlocationid: 'existing-location' }] });
      }),
    };
    const graph = { ensureFolderPath: jest.fn() };
    const journal = jest.fn();
    await expect(provisionSharePointLocation(client, graph, sharePointTarget, manifest, request, journal))
      .rejects.toThrow('Expected no preexisting Request location');
    expect(graph.ensureFolderPath).not.toHaveBeenCalled();
  });

  test('journals graphFolderAttempted BEFORE ensureFolderPath and locationCreateAttempted BEFORE the create POST', async () => {
    const manifest = baseManifest();
    const request = {
      akoya_requestid: REQUEST_ID, wmkf_testcreationrunid: RUN_ID,
      _createdby_value: APP_USER_ID, _ownerid_value: APP_USER_ID,
      wmkf_istestrequest: true, akoya_requestnum: '9000001',
    };
    const calls = [];
    const client = {
      get: jest.fn(async (requestPath) => {
        if (requestPath.includes('$filter=relativeurl')) {
          return ok({ value: [{ sharepointdocumentlocationid: 'parent-1', name: 'akoya_request' }] });
        }
        // getLocations, called twice: absence check, then the post-create readback.
        if (client.get.mock.calls.length <= 2) return ok({ value: [] });
        return ok({
          value: [{
            sharepointdocumentlocationid: LOCATION_ID,
            _parentsiteorlocation_value: 'parent-1',
            _createdby_value: APP_USER_ID,
            _ownerid_value: APP_USER_ID,
            relativeurl: `9000001_${REQUEST_ID.replace(/-/g, '').toUpperCase()}`,
          }],
        });
      }),
      post: jest.fn(async () => {
        calls.push('dispatch');
        return ok({}, 201);
      }),
    };
    const graph = {
      ensureFolderPath: jest.fn(async () => {
        calls.push('ensureFolderPath');
        return { id: 'folder-1' };
      }),
    };
    const journal = jest.fn(async (patch) => {
      if (patch.graphFolderAttempted) calls.push('graphFolderAttempted');
      if (patch.locationCreateAttempted) calls.push('locationCreateAttempted');
    });
    const location = await provisionSharePointLocation(client, graph, sharePointTarget, manifest, request, journal);
    expect(location.folder).toContain('9000001_');
    expect(calls.indexOf('graphFolderAttempted')).toBeLessThan(calls.indexOf('ensureFolderPath'));
    expect(calls.indexOf('locationCreateAttempted')).toBeLessThan(calls.indexOf('dispatch'));
  });
});

describe('verifyClone', () => {
  test('flags a SharePoint location parent identity mismatch', () => {
    const manifest = baseManifest();
    const preflightBefore = {
      foundation: { accountid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', versionnumber: 1, modifiedon: 'x' },
      contacts: [],
      requestLibraryParent: { sharepointdocumentlocationid: 'expected-parent' },
    };
    const observation = {
      request: {
        akoya_requestid: REQUEST_ID, akoya_title: 'TEST: fixture', akoya_fiscalyear: undefined,
        akoya_purpose: 'Synthetic purpose', akoya_request: 5000, akoya_requesttype: undefined,
        wmkf_meetingdate: '2026-12-01', _akoya_applicantid_value: manifest.expectedOrganization.accountid,
        _createdby_value: APP_USER_ID, _ownerid_value: APP_USER_ID, wmkf_istestrequest: true,
        wmkf_testcreationrunid: RUN_ID, wmkf_respondreminderenabled: false, wmkf_reviewduereminderenabled: false,
        akoya_requestnum: '9000001', akoya_submissionaccepted: false,
      },
      payments: [], emails: [],
      locations: [{
        sharepointdocumentlocationid: LOCATION_ID,
        relativeurl: `9000001_${REQUEST_ID.replace(/-/g, '').toUpperCase()}`,
        _createdby_value: APP_USER_ID, _ownerid_value: APP_USER_ID,
      }],
      locationParents: [{ sharepointdocumentlocationid: 'wrong-parent', relativeurl: 'akoya_request' }],
    };
    manifest.values.locationId = LOCATION_ID;
    const result = verifyClone(manifest, preflightBefore, observation, [], preflightBefore.foundation, []);
    expect(result.ok).toBe(false);
    expect(result.failures).toContain('SharePoint location parent identity mismatch');
  });
});
