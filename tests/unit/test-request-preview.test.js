import { compileBasicTestRequestPreview } from '../../lib/services/test-requests/preview.js';
import { TEST_REQUEST_FIXED_FIELDS } from '../../lib/services/test-requests/policy.js';

const ids = {
  requestId: '11111111-1111-4111-8111-111111111111',
  runId: '22222222-2222-4222-8222-222222222222',
  testOrganizationId: '33333333-3333-4333-8333-333333333333',
};

function metadata() {
  return {
    entity: 'akoya_request',
    fields: {
      akoya_requestid: { createable: true, requiredLevel: 'None', type: 'Uniqueidentifier' },
      akoya_applicantid: { createable: true, requiredLevel: 'None', type: 'Lookup', lookupTarget: 'accounts' },
      akoya_title: { createable: true, requiredLevel: 'None', type: 'String', maxLength: 120 },
      akoya_purpose: { createable: true, requiredLevel: 'None', type: 'Memo', maxLength: 100000 },
      akoya_request: { createable: true, requiredLevel: 'None', type: 'Money', minValue: 0, maxValue: 1000000000 },
      akoya_fiscalyear: { createable: true, requiredLevel: 'None', type: 'String', maxLength: 80 },
      akoya_requesttype: { createable: true, requiredLevel: 'None', type: 'Picklist' },
      wmkf_meetingdate: { createable: true, requiredLevel: 'None', type: 'DateOnly' },
      [TEST_REQUEST_FIXED_FIELDS.marker]: { createable: true, requiredLevel: 'None', type: 'Boolean' },
      [TEST_REQUEST_FIXED_FIELDS.runId]: { createable: true, requiredLevel: 'None', type: 'Uniqueidentifier' },
      [TEST_REQUEST_FIXED_FIELDS.responseReminder]: { createable: true, requiredLevel: 'None', type: 'Boolean' },
      [TEST_REQUEST_FIXED_FIELDS.reviewReminder]: { createable: true, requiredLevel: 'None', type: 'Boolean' },
    },
  };
}

function input() {
  return {
    draftInput: {
      recipe: 'basic',
      sourceRequest: {
        akoya_requestid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        akoya_purpose: 'Synthetic purpose',
        akoya_request: 1250,
      },
      testLabel: 'Clone preview',
      fiscalYear: 'December 2026',
      requestType: 100000000,
      meetingDate: '2026-12-01',
      metadata: metadata(),
      ...ids,
    },
    fileInput: {
      filePolicy: {
        allowedMimeTypes: ['application/pdf'],
        maxFileBytes: 10_000,
        maxFiles: 2,
        maxTotalBytes: 20_000,
      },
      selectedDocumentIds: ['project-description'],
      sourceDocuments: [{
        contentHash: 'a'.repeat(64),
        folder: '1000123_GUID/Phase I',
        id: 'project-description',
        kind: 'projectDescription',
        library: 'Documents',
        mimeType: 'application/pdf',
        name: 'ProjectDescription.pdf',
        size: 1_000,
        versionId: 'version-1',
      }],
      sourceRequestNumber: '1000123',
    },
  };
}

describe('compileBasicTestRequestPreview', () => {
  test('composes a valid request and file plan without becoming executable', () => {
    const result = compileBasicTestRequestPreview(input());
    expect(result.blockers).toEqual([]);
    expect(result.planReady).toBe(true);
    expect(result.executionReady).toBe(false);
    expect(result.requestPlan.createBody).toEqual(expect.objectContaining({
      akoya_requestid: ids.requestId,
      akoya_title: 'TEST: Clone preview',
      [TEST_REQUEST_FIXED_FIELDS.marker]: true,
    }));
    expect(result.filePlan.plannedFiles[0].destination).toEqual({
      folder: 'Phase I',
      filename: 'ProjectDescription.pdf',
    });
  });

  test('preserves scoped blockers from both compilers and unknown preview keys', () => {
    const bad = input();
    bad.draftInput.recipe = 'paid-workflow';
    bad.fileInput.selectedDocumentIds = ['missing'];
    bad.arbitraryPayload = { status: 'approved' };
    const result = compileBasicTestRequestPreview(bad);

    expect(result.planReady).toBe(false);
    expect(result.executionReady).toBe(false);
    expect(result.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PREVIEW_INPUT_INVALID', scope: 'preview' }),
      expect.objectContaining({ code: 'RECIPE_UNSUPPORTED', scope: 'request' }),
      expect.objectContaining({ code: 'FILE_SELECTION_UNKNOWN', scope: 'files' }),
    ]));
  });

  test.each([null, [], false, 'bad'])('rejects non-object preview input %p without throwing', value => {
    const result = compileBasicTestRequestPreview(value);
    expect(result.planReady).toBe(false);
    expect(result.executionReady).toBe(false);
    expect(result.blockers[0]).toEqual(expect.objectContaining({ code: 'PREVIEW_INPUT_INVALID' }));
  });
});
