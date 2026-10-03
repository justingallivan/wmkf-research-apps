/** @jest-environment node */

import {
  createSiteVisitMaterialsRecursiveReaderFilter,
  graphFileIdentity,
  getSupersededPortalMaterialIdentities,
  isDirectSiteVisitMaterialsFile,
  SITE_VISIT_MATERIALS_READER_FILTER_ERROR,
} from '../../lib/services/site-visit-materials/recursive-reader-filter.js';
import {
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../shared/config/requestDocument.js';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_NUMBER = '1002903';
const ROOT = '1002903_11111111111141118111111111111111';
const MATERIAL_FOLDER = `${ROOT}/Site Visit - Slides`;

function row(overrides = {}) {
  return {
    _wmkf_request_value: REQUEST_ID,
    wmkf_requestdocumentid: 'old-row',
    wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.APPLICANT_SLIDES,
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED,
    wmkf_producer: 'site-visit-materials-portal',
    wmkf_filename: `${REQUEST_NUMBER} Site Visit Presentation.pptx`,
    wmkf_sharepointdriveid: 'active-drive',
    wmkf_sharepointitemid: 'old-item',
    ...overrides,
  };
}

function listedFile(overrides = {}) {
  return {
    id: 'old-item',
    name: `${REQUEST_NUMBER} Site Visit Presentation.pptx`,
    folder: MATERIAL_FOLDER,
    webUrl: 'https://sharepoint.test/old',
    ...overrides,
  };
}

function deps(overrides = {}) {
  return {
    backgroundSchemaReady: () => true,
    findDocumentsByRequest: jest.fn(async () => ({ records: [row()], totalCount: 1, capped: false })),
    getDriveId: jest.fn(async () => 'active-drive'),
    ...overrides,
  };
}

describe('Site Visit recursive-reader stale-root suppression', () => {
  test('schema-off preserves the exact inventory without registry or drive reads', async () => {
    const d = deps({ backgroundSchemaReady: () => false });
    const files = [listedFile()];
    const filter = createSiteVisitMaterialsRecursiveReaderFilter(REQUEST_ID, REQUEST_NUMBER, d);

    await expect(filter('akoya_request', ROOT, files)).resolves.toEqual({
      files,
      omittedFiles: [],
      error: null,
    });
    expect(d.findDocumentsByRequest).not.toHaveBeenCalled();
    expect(d.getDriveId).not.toHaveBeenCalled();
  });

  test('removes only the exact request-bound portal superseded drive/item identity', async () => {
    const d = deps({ findDocumentsByRequest: jest.fn(async () => ({
      records: [
        row(),
        row({ _wmkf_request_value: '22222222-2222-4222-8222-222222222222', wmkf_sharepointitemid: 'wrong-request' }),
        row({ wmkf_sharepointdriveid: 'archive-drive', wmkf_sharepointitemid: 'same-id-other-drive' }),
        row({ wmkf_producer: 'staff', wmkf_sharepointitemid: 'manual-id' }),
        row({ wmkf_sharepointitemid: 'staff-overwrite' }),
      ],
      totalCount: 5,
      capped: false,
    })) });
    const files = [
      listedFile(),
      listedFile({ id: 'wrong-request' }),
      listedFile({ id: 'manual-id', name: '1002903 Site Visit Presentation.pptx' }),
      listedFile({ id: 'same-id-other-drive' }),
      listedFile({ id: 'staff-overwrite', name: 'Staff updated the old portal item.pptx' }),
      listedFile({ id: 'ordinary', name: 'Hand placed slides.pptx' }),
      listedFile({ id: 'nested', folder: `${MATERIAL_FOLDER}/Staff` }),
    ];
    const filter = createSiteVisitMaterialsRecursiveReaderFilter(REQUEST_ID, REQUEST_NUMBER, d);

    const result = await filter('akoya_request', ROOT, files);
    expect(result.files).toEqual(files.slice(1, 4).concat(files.slice(5)));
    expect(result.omittedFiles).toEqual([]);
    expect(result.error).toBeNull();
    expect(d.findDocumentsByRequest).toHaveBeenCalledTimes(1);
    expect(d.getDriveId).toHaveBeenCalledWith('akoya_request');
  });

  test('protects a superseded row when the canonical Ready matcher selects that same item identity', () => {
    const records = [
      row(),
      row({
        wmkf_requestdocumentid: 'current-row',
        wmkf_lifecyclestate: null,
        wmkf_sharepointitemid: 'old-item',
      }),
    ];
    expect(getSupersededPortalMaterialIdentities(records, REQUEST_ID, REQUEST_NUMBER).has(
      graphFileIdentity('active-drive', 'old-item'),
    )).toBe(false);
  });

  test('on registry outage, omits only direct canonical-folder candidates and reports a sanitized error', async () => {
    const d = deps({ findDocumentsByRequest: jest.fn(async () => { throw new Error('private Dynamics details'); }) });
    const files = [
      listedFile(),
      listedFile({ id: 'other-slot', folder: `${ROOT}/Site Visit - Other` }),
      listedFile({ id: 'nested', folder: `${MATERIAL_FOLDER}/Supporting` }),
      listedFile({ id: 'ordinary', folder: `${ROOT}/Phase I`, name: 'Narrative.pdf' }),
    ];
    const filter = createSiteVisitMaterialsRecursiveReaderFilter(REQUEST_ID, REQUEST_NUMBER, d);

    const result = await filter('akoya_request', ROOT, files);
    expect(result.files).toEqual(files.slice(2));
    expect(result.omittedFiles).toEqual(files.slice(0, 2));
    expect(result.error).toEqual(SITE_VISIT_MATERIALS_READER_FILTER_ERROR);
    expect(JSON.stringify(result)).not.toContain('private Dynamics details');
  });

  test('does not read the registry when a recursive inventory has no direct materials files', async () => {
    const d = deps();
    const files = [
      listedFile({ id: 'nested', folder: `${MATERIAL_FOLDER}/Supporting` }),
      listedFile({ id: 'ordinary', folder: `${ROOT}/Phase I`, name: 'Narrative.pdf' }),
    ];
    const filter = createSiteVisitMaterialsRecursiveReaderFilter(REQUEST_ID, REQUEST_NUMBER, d);

    await expect(filter('akoya_request', ROOT, files)).resolves.toEqual({
      files,
      omittedFiles: [],
      error: null,
    });
    expect(d.findDocumentsByRequest).not.toHaveBeenCalled();
    expect(d.getDriveId).not.toHaveBeenCalled();
  });

  test('caches one registry read across buckets but compares exact drive/item pairs', async () => {
    const d = deps({
      getDriveId: jest.fn(async (library) => (library === 'akoya_request' ? 'active-drive' : 'archive-drive')),
    });
    const filter = createSiteVisitMaterialsRecursiveReaderFilter(REQUEST_ID, REQUEST_NUMBER, d);
    const active = await filter('akoya_request', ROOT, [listedFile()]);
    const archive = await filter('RequestArchive1', ROOT, [listedFile()]);

    expect(active.files).toEqual([]);
    expect(active.omittedFiles).toEqual([]);
    expect(archive.files).toHaveLength(1);
    expect(d.findDocumentsByRequest).toHaveBeenCalledTimes(1);
    expect(d.getDriveId).toHaveBeenCalledTimes(2);
  });

  test('drive-resolution failure omits only the direct material file and reports uncertainty', async () => {
    const d = deps({ getDriveId: jest.fn(async () => { throw new Error('private Graph details'); }) });
    const files = [
      listedFile(),
      listedFile({ id: 'nested', folder: `${MATERIAL_FOLDER}/Supporting` }),
      listedFile({ id: 'ordinary', folder: `${ROOT}/Phase I`, name: 'Narrative.pdf' }),
    ];
    const filter = createSiteVisitMaterialsRecursiveReaderFilter(REQUEST_ID, REQUEST_NUMBER, d);

    const result = await filter('akoya_request', ROOT, files);
    expect(result.files).toEqual(files.slice(1));
    expect(result.omittedFiles).toEqual([files[0]]);
    expect(result.error).toEqual(SITE_VISIT_MATERIALS_READER_FILTER_ERROR);
    expect(JSON.stringify(result)).not.toContain('private Graph details');
  });

  test('missing Graph item identity is withheld rather than treated as manual', async () => {
    const d = deps();
    const file = listedFile({ id: null });
    const filter = createSiteVisitMaterialsRecursiveReaderFilter(REQUEST_ID, REQUEST_NUMBER, d);

    const result = await filter('akoya_request', ROOT, [file]);
    expect(result.files).toEqual([]);
    expect(result.omittedFiles).toEqual([file]);
    expect(result.error).toEqual(SITE_VISIT_MATERIALS_READER_FILTER_ERROR);
    expect(d.findDocumentsByRequest).not.toHaveBeenCalled();
    expect(d.getDriveId).not.toHaveBeenCalled();
  });

  test.each([
    ['missing records', { totalCount: 0, capped: false }],
    ['missing total count', { records: [], capped: false }],
    ['negative total count', { records: [], totalCount: -1, capped: false }],
    ['too few rows for the total count', { records: [], totalCount: 1, capped: false }],
    ['capped page', { records: [], totalCount: 0, capped: true }],
    ['malformed row', { records: [null], totalCount: 1, capped: false }],
  ])('treats %s as unavailable and withholds direct files', async (_label, response) => {
    const d = deps({ findDocumentsByRequest: jest.fn(async () => response) });
    const file = listedFile();
    const filter = createSiteVisitMaterialsRecursiveReaderFilter(REQUEST_ID, REQUEST_NUMBER, d);

    const result = await filter('akoya_request', ROOT, [file]);
    expect(result.files).toEqual([]);
    expect(result.omittedFiles).toEqual([file]);
    expect(result.error).toEqual(SITE_VISIT_MATERIALS_READER_FILTER_ERROR);
  });

  test('requires a direct canonical folder path, not a matching filename or nested path', () => {
    expect(isDirectSiteVisitMaterialsFile(listedFile(), ROOT)).toBe(true);
    expect(isDirectSiteVisitMaterialsFile(listedFile({ folder: `${MATERIAL_FOLDER}/Archive` }), ROOT)).toBe(false);
    expect(isDirectSiteVisitMaterialsFile(listedFile({ folder: `${ROOT}/Unrelated` }), ROOT)).toBe(false);
  });
});
