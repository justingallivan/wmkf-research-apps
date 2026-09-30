/** @jest-environment node */
import { listSiteVisitMaterialFolderFiles } from '../../lib/services/site-visit-materials/folder-files-service';
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
