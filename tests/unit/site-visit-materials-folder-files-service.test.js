/** @jest-environment node */
import { listSiteVisitMaterialFolderFiles } from '../../lib/services/site-visit-materials/folder-files-service';
import { REQUEST_DOCUMENT_ARTIFACT_TYPE, REQUEST_DOCUMENT_OPERATION_STATUS, REQUEST_DOCUMENT_LIFECYCLE_STATE } from '../../shared/config/requestDocument';
import { ServiceHttpError } from '../../lib/services/service-http-error';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST = { akoya_requestid: REQUEST_ID, akoya_requestnum: '1002903' };
const ROOT = 'Neural dust_ABC123';

function notFound() {
  const error = new Error('Failed to list files (404)');
  error.code = 'graph_folder_not_found';
  return error;
}

function deps(overrides = {}) {
  return {
    getRequest: jest.fn(async () => REQUEST),
    getSharePointBuckets: jest.fn(async () => [
      { library: 'Archive', folder: 'x', source: 'archive' },
      { library: 'akoya_request', folder: `${ROOT}/`, source: 'dynamics' },
    ]),
    listFiles: jest.fn(async () => []),
    ...overrides,
  };
}

describe('listSiteVisitMaterialFolderFiles', () => {
  it('lists both folders under the active Dynamics bucket and projects name, link, time, size', async () => {
    const d = deps({
      listFiles: jest.fn(async (library, folder) => (folder.endsWith('Site Visit - Slides')
        ? [
          { name: 'Slides v2.pptx', webUrl: 'https://sp/slides-pptx', lastModified: '2026-09-20T10:00:00Z', size: 900, id: 'i2', folder },
          { name: 'Slides v2.pdf', webUrl: 'https://sp/slides-pdf', lastModified: '2026-09-20T10:00:00Z', size: 500, id: 'i1', folder },
        ]
        : [{ name: 'Bios.docx', webUrl: 'https://sp/bios', lastModified: '2026-09-21T10:00:00Z', size: 40, id: 'i3', folder }])),
    });
    const result = await listSiteVisitMaterialFolderFiles({ requestId: REQUEST_ID }, d);

    expect(d.getSharePointBuckets).toHaveBeenCalledWith(REQUEST_ID, '1002903');
    expect(d.listFiles).toHaveBeenCalledWith('akoya_request', `${ROOT}/Site Visit - Slides`);
    expect(d.listFiles).toHaveBeenCalledWith('akoya_request', `${ROOT}/Site Visit - Participant Bios`);
    expect(result).toEqual({
      success: true,
      folderFound: true,
      slides: [
        { name: 'Slides v2.pdf', webUrl: 'https://sp/slides-pdf', lastModified: '2026-09-20T10:00:00Z', size: 500 },
        { name: 'Slides v2.pptx', webUrl: 'https://sp/slides-pptx', lastModified: '2026-09-20T10:00:00Z', size: 900 },
      ],
      participantBios: [{ name: 'Bios.docx', webUrl: 'https://sp/bios', lastModified: '2026-09-21T10:00:00Z', size: 40 }],
    });
  });

  it('treats a missing subfolder as empty, not as a failure', async () => {
    const d = deps({
      listFiles: jest.fn(async (library, folder) => {
        if (folder.endsWith('Participant Bios')) throw notFound();
        return [{ name: 'a.pdf', webUrl: 'https://sp/a' }];
      }),
    });
    const result = await listSiteVisitMaterialFolderFiles({ requestId: REQUEST_ID }, d);
    expect(result.slides).toHaveLength(1);
    expect(result.participantBios).toEqual([]);
  });

  it('fails with a sanitized 502 on any other SharePoint error', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const d = deps({ listFiles: jest.fn(async () => { throw new Error('Failed to list files in akoya_request/secret (500)'); }) });
    const error = await listSiteVisitMaterialFolderFiles({ requestId: REQUEST_ID }, d).catch((e) => e);
    expect(error).toBeInstanceOf(ServiceHttpError);
    expect(error.httpStatus).toBe(502);
    expect(error.message).not.toMatch(/secret/);
    spy.mockRestore();
  });

  it('reports folderFound false without listing when the request has no Dynamics folder', async () => {
    const d = deps({ getSharePointBuckets: jest.fn(async () => [{ library: 'Archive', folder: 'x', source: 'archive' }]) });
    const result = await listSiteVisitMaterialFolderFiles({ requestId: REQUEST_ID }, d);
    expect(result).toEqual({ success: true, folderFound: false, slides: [], participantBios: [] });
    expect(d.listFiles).not.toHaveBeenCalled();
  });

  it('404s when the request does not resolve, from a throw or an empty record', async () => {
    for (const getRequest of [jest.fn(async () => { throw new Error('nope'); }), jest.fn(async () => null)]) {
      const error = await listSiteVisitMaterialFolderFiles({ requestId: REQUEST_ID }, deps({ getRequest })).catch((e) => e);
      expect(error).toBeInstanceOf(ServiceHttpError);
      expect(error.httpStatus).toBe(404);
    }
  });
});


describe('background materials registry links', () => {
  const oldRow = {
    _wmkf_request_value: REQUEST_ID, wmkf_requestdocumentid: 'old',
    wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.APPLICANT_SLIDES,
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED,
    wmkf_producer: 'site-visit-materials-portal',
    wmkf_filename: '1002903 Site Visit Presentation.pptx',
    wmkf_sharepointdriveid: 'drive', wmkf_sharepointitemid: 'old-item',
    wmkf_sharepointweburl: 'https://sp/old',
  };
  const current = { ...oldRow, wmkf_requestdocumentid: 'new', wmkf_lifecyclestate: null,
    wmkf_sharepointitemid: 'new-item', wmkf_sharepointweburl: 'https://sp/job/new',
    wmkf_sharepointfolderpath: `${ROOT}/Site Visit - Slides/job-id`, modifiedon: '2026-10-01' };
  const backgroundDeps = (rows = [oldRow, current], overrides = {}) => deps({
    backgroundSchemaReady: () => true,
    getDriveId: jest.fn(async () => 'drive'),
    findDocumentsByRequest: jest.fn(async () => ({ records: rows })),
    listFiles: jest.fn(async (_library, folder) => folder.endsWith('Site Visit - Slides') ? [
      { id: 'old-item', name: oldRow.wmkf_filename, webUrl: oldRow.wmkf_sharepointweburl },
      { id: 'manual', name: 'Staff copy.pptx', webUrl: 'https://sp/manual' },
    ] : []), ...overrides,
  });
  it('merges only published current links, hides superseded portal root files and preserves manual files', async () => {
    const d = backgroundDeps([oldRow, current, { ...current, wmkf_requestdocumentid: 'unready',
      wmkf_operationstatus: -1, wmkf_sharepointweburl: 'https://sp/uncommitted', modifiedon: '2027' }]);
    const result = await listSiteVisitMaterialFolderFiles({ requestId: REQUEST_ID }, d);
    expect(result.slides.map((file) => file.webUrl)).toEqual(['https://sp/job/new', 'https://sp/manual']);
    expect(d.listFiles).toHaveBeenCalledTimes(2);
    expect(d.listFiles.mock.calls.every(([, folder]) => !folder.includes('job-id'))).toBe(true);
  });
  it('keeps the prior item when replacement is not registered', async () => {
    const result = await listSiteVisitMaterialFolderFiles({ requestId: REQUEST_ID }, backgroundDeps([
      { ...oldRow, wmkf_lifecyclestate: null },
    ]));
    expect(result.slides.map((file) => file.webUrl)).toContain('https://sp/old');
    expect(result.slides.filter((file) => file.webUrl === 'https://sp/old')).toHaveLength(1);
  });
  it('never hides root files for a different request or drive identity', async () => {
    for (const mismatch of [{ _wmkf_request_value: 'other' }, { wmkf_sharepointdriveid: 'other' }]) {
      const result = await listSiteVisitMaterialFolderFiles({ requestId: REQUEST_ID }, backgroundDeps([{ ...oldRow, ...mismatch }, current]));
      expect(result.slides.map((file) => file.webUrl)).toContain('https://sp/old');
    }
  });
  it('rejects a malformed registry page instead of inventing empty files', async () => {
    const d = backgroundDeps([], { findDocumentsByRequest: jest.fn(async () => ({})) });
    await expect(listSiteVisitMaterialFolderFiles({ requestId: REQUEST_ID }, d)).rejects.toMatchObject({ httpStatus: 502 });
  });
  it('schema off does not read registry or resolve the drive', async () => {
    const d = backgroundDeps([], { backgroundSchemaReady: () => false });
    await listSiteVisitMaterialFolderFiles({ requestId: REQUEST_ID }, d);
    expect(d.findDocumentsByRequest).not.toHaveBeenCalled();
    expect(d.getDriveId).not.toHaveBeenCalled();
  });
  it('does not fabricate an empty success if the registry is unavailable', async () => {
    const d = backgroundDeps([], { findDocumentsByRequest: jest.fn(async () => { throw new Error('private details'); }) });
    await expect(listSiteVisitMaterialFolderFiles({ requestId: REQUEST_ID }, d)).rejects.toMatchObject({ httpStatus: 502 });
  });
});
