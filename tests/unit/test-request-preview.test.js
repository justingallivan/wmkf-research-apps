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

function trusted(overrides = {}) {
  return {
    filePolicy: {
      allowedMimeTypes: ['application/pdf'],
      maxFileBytes: 10_000,
      maxFiles: 2,
      maxTotalBytes: 20_000,
    },
    metadata: metadata(),
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
    sourceRequest: {
      akoya_requestid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      akoya_purpose: 'Synthetic purpose',
      akoya_request: 1250,
    },
    sourceRequestNumber: '1000123',
    ...ids,
    ...overrides,
  };
}

function requested(overrides = {}) {
  return {
    recipe: 'basic',
    testLabel: 'Clone preview',
    fiscalYear: 'December 2026',
    requestType: 100000000,
    meetingDate: '2026-12-01',
    selectedDocumentIds: ['project-description'],
    ...overrides,
  };
}

describe('compileBasicTestRequestPreview', () => {
  test('composes a valid request and file plan without becoming executable', () => {
    const result = compileBasicTestRequestPreview(trusted(), requested());
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
      filenameTemplate: null,
    });
  });

  test('a request-only blocker strips both actionable sub-plans', () => {
    const result = compileBasicTestRequestPreview(trusted(), requested({ recipe: 'paid-workflow' }));
    expect(result.blockers).toContainEqual(expect.objectContaining({
      code: 'RECIPE_UNSUPPORTED',
      scope: 'request',
    }));
    expect(result.planReady).toBe(false);
    expect(result.requestPlan.createBody).toBeNull();
    expect(result.filePlan.planReady).toBe(false);
    expect(result.filePlan.plannedFiles).toEqual([]);
    expect(result.preview.files).toHaveLength(1);
  });

  test('a file-only blocker strips the otherwise valid request body', () => {
    const result = compileBasicTestRequestPreview(trusted(), requested({ selectedDocumentIds: ['missing'] }));
    expect(result.blockers).toContainEqual(expect.objectContaining({
      code: 'FILE_SELECTION_UNKNOWN',
      scope: 'files',
    }));
    expect(result.planReady).toBe(false);
    expect(result.requestPlan.createBody).toBeNull();
    expect(result.filePlan.planReady).toBe(false);
    expect(result.filePlan.plannedFiles).toEqual([]);
    expect(result.preview.requestBody).toEqual(expect.objectContaining({ akoya_requestid: ids.requestId }));
  });

  test('a top-level trust-boundary blocker strips both actionable sub-plans', () => {
    const result = compileBasicTestRequestPreview(
      trusted({ arbitraryServerValue: true }),
      requested(),
    );
    expect(result.blockers).toContainEqual(expect.objectContaining({
      code: 'PREVIEW_INPUT_INVALID',
      field: 'arbitraryServerValue',
      scope: 'preview',
    }));
    expect(result.requestPlan.createBody).toBeNull();
    expect(result.filePlan.planReady).toBe(false);
    expect(result.filePlan.plannedFiles).toEqual([]);
  });

  test('rejects browser attempts to supply trusted inventory or policy', () => {
    const result = compileBasicTestRequestPreview(trusted(), requested({
      filePolicy: { maxFiles: 999 },
      sourceDocuments: [],
    }));
    expect(result.blockers.filter(item => item.code === 'PREVIEW_INPUT_INVALID')).toEqual([
      expect.objectContaining({ field: 'filePolicy', scope: 'preview' }),
      expect.objectContaining({ field: 'sourceDocuments', scope: 'preview' }),
    ]);
    expect(result.requestPlan.createBody).toBeNull();
    expect(result.filePlan.plannedFiles).toEqual([]);
  });

  test.each([null, [], false, 'bad'])('rejects non-object trusted preview input %p', value => {
    const result = compileBasicTestRequestPreview(value, requested());
    expect(result.planReady).toBe(false);
    expect(result.executionReady).toBe(false);
    expect(result.blockers[0]).toEqual(expect.objectContaining({ code: 'PREVIEW_INPUT_INVALID' }));
  });

  test.each([null, [], false, 'bad'])('rejects non-object browser preview input %p', value => {
    const result = compileBasicTestRequestPreview(trusted(), value);
    expect(result.planReady).toBe(false);
    expect(result.executionReady).toBe(false);
    expect(result.blockers[0]).toEqual(expect.objectContaining({ code: 'PREVIEW_INPUT_INVALID' }));
  });
});
