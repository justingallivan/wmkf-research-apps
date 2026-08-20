/**
 * lib/services/workbench/grantee-deliverables/replace-submission-service — S412.
 *
 * Staff replacement of the grantee-returned image/caption, after a revision
 * agreed off-portal by email. This is a NEW write surface into SharePoint and
 * Dataverse, so these pin the things that would be silent and expensive if wrong:
 *
 *   - the status gate (fail-closed, and specifically that Revision Requested is
 *     NOT replaceable — the grantee has the ball there),
 *   - that the write NEVER touches status or any waiver field (the original
 *     consent stands; owner decision 2026-08-10),
 *   - the SharePoint filename pattern, which the staff image proxy's allowlist
 *     and the prior-image prune both depend on being byte-identical to the
 *     portal writer's,
 *   - the rollback seam: an upload is removed when the PATCH did not commit, and
 *     is NOT removed when it did (the response-drop case), which differs from the
 *     portal writer because this path writes no status to confirm against.
 *
 * @jest-environment node
 */
jest.mock('../../lib/services/graph-service', () => ({
  GraphService: {
    getDriveId: jest.fn(),
    uploadFile: jest.fn(),
    listFiles: jest.fn(),
  },
}));
jest.mock('../../lib/services/sharepoint-cleanup', () => ({
  cleanupSharePointItems: jest.fn(),
}));
jest.mock('../../lib/services/grantee-deliverable-record', () => ({
  getDeliverableForRequest: jest.fn(),
  patchDeliverable: jest.fn(),
}));
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({
  getById: jest.fn(),
}));
jest.mock('../../lib/utils/virus-scan-config', () => ({
  isVirusScanEnabled: jest.fn(() => false),
}));
jest.mock('../../lib/services/cloudmersive-scan', () => ({
  scanBytes: jest.fn(),
}));

import { GraphService } from '../../lib/services/graph-service';
import { cleanupSharePointItems } from '../../lib/services/sharepoint-cleanup';
import { getDeliverableForRequest, patchDeliverable } from '../../lib/services/grantee-deliverable-record';
import * as grantRequestAdapter from '../../lib/dataverse/adapters/grant-request';
import { isVirusScanEnabled } from '../../lib/utils/virus-scan-config';
import { scanBytes } from '../../lib/services/cloudmersive-scan';
import { GRANTEE_DELIVERABLE_STATUS } from '../../shared/config/granteeDeliverableStatus';
import { ServiceHttpError } from '../../lib/services/service-http-error';
import { replaceGranteeSubmission } from '../../lib/services/workbench/grantee-deliverables/replace-submission-service';

const GUID = '22222222-2222-2222-2222-222222222222';
const REQNUM = '1002365';
const FOLDER = `${REQNUM}_22222222222222222222222222222222/Grantee_Uploads`;
const ETAG = 'W/"d1"';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
const imageFile = () => ({ filename: 'whatever-the-user-called-it.png', buffer: PNG });

const pkg = (over = {}) => ({
  wmkf_granteedeliverableid: 'd1',
  wmkf_deliverablestatus: GRANTEE_DELIVERABLE_STATUS.SUBMITTED,
  wmkf_imagecaption: 'Original caption.',
  wmkf_imagefileref: `${FOLDER}/${REQNUM}_grantee_image_aaaaaaaa.png`,
  _etag: ETAG,
  ...over,
});

const call = (over = {}) => replaceGranteeSubmission({
  requestId: GUID, caption: null, imageFile: null, clientEtag: ETAG, ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  isVirusScanEnabled.mockReturnValue(false);
  grantRequestAdapter.getById.mockResolvedValue({ akoya_requestid: GUID, akoya_requestnum: REQNUM });
  getDeliverableForRequest.mockResolvedValue(pkg());
  patchDeliverable.mockResolvedValue({});
  GraphService.getDriveId.mockResolvedValue('drive-1');
  GraphService.uploadFile.mockResolvedValue({ id: 'new-item', webUrl: 'https://sp/new.png' });
  GraphService.listFiles.mockResolvedValue([]);
});

test('durability hook records exact candidate before conditional package PATCH', async () => {
  const order = [];
  const onCandidateUploaded = jest.fn(async (candidate) => {
    order.push('candidate');
    expect(candidate).toMatchObject({ driveId: 'drive-1', itemId: 'new-item', imageRef: 'https://sp/new.png' });
  });
  patchDeliverable.mockImplementation(async () => { order.push('patch'); return {}; });
  await call({ imageFile: imageFile(), onCandidateUploaded });
  expect(order).toEqual(['candidate', 'patch']);
});

test('durability hook failure removes candidate and prevents package PATCH', async () => {
  cleanupSharePointItems.mockResolvedValue(true);
  await expect(call({
    imageFile: imageFile(),
    onCandidateUploaded: jest.fn(async () => { throw new Error('ledger unavailable'); }),
  })).rejects.toMatchObject({ httpStatus: 503, code: 'staging_failed' });
  expect(cleanupSharePointItems).toHaveBeenCalledWith('drive-1', [expect.objectContaining({ id: 'new-item' })], 'grantee-replace-candidate');
  expect(patchDeliverable).not.toHaveBeenCalled();
});

// ── Status gate ──

test('Revision Requested is NOT staff-replaceable — the grantee has the ball', async () => {
  getDeliverableForRequest.mockResolvedValue(pkg({
    wmkf_deliverablestatus: GRANTEE_DELIVERABLE_STATUS.REVISION_REQUESTED,
  }));
  await expect(call({ caption: 'new' })).rejects.toMatchObject({
    httpStatus: 409,
    body: { code: 'not_replaceable' },
  });
  expect(patchDeliverable).not.toHaveBeenCalled();
});

test.each([
  ['null (not started)', null],
  ['Drafted', GRANTEE_DELIVERABLE_STATUS.DRAFTED],
  ['Invited', GRANTEE_DELIVERABLE_STATUS.INVITED],
  ['Reminder Sent', GRANTEE_DELIVERABLE_STATUS.REMINDER_SENT],
  ['Complete', GRANTEE_DELIVERABLE_STATUS.COMPLETE],
  ['Closed No Response', GRANTEE_DELIVERABLE_STATUS.CLOSED_NO_RESPONSE],
])('%s is refused (fail-closed status gate)', async (_label, status) => {
  getDeliverableForRequest.mockResolvedValue(pkg({ wmkf_deliverablestatus: status }));
  await expect(call({ caption: 'new' })).rejects.toBeInstanceOf(ServiceHttpError);
  expect(patchDeliverable).not.toHaveBeenCalled();
});

test.each([
  ['Submitted', GRANTEE_DELIVERABLE_STATUS.SUBMITTED],
  ['Staff Review', GRANTEE_DELIVERABLE_STATUS.STAFF_REVIEW],
])('%s is allowed', async (_label, status) => {
  getDeliverableForRequest.mockResolvedValue(pkg({ wmkf_deliverablestatus: status }));
  await expect(call({ caption: 'new' })).resolves.toMatchObject({ ok: true });
});

// ── What the write may and may not touch ──

test('a caption replacement writes ONLY the caption — no status, no waiver fields', async () => {
  await call({ caption: '  Revised caption.  ' });
  expect(patchDeliverable).toHaveBeenCalledTimes(1);
  const [, fields, opts] = patchDeliverable.mock.calls[0];
  expect(fields).toEqual({ wmkf_imagecaption: 'Revised caption.' });
  expect(opts).toMatchObject({ ifMatch: ETAG });
  // The negative that matters: the original consent stands.
  for (const key of Object.keys(fields)) {
    expect(key).not.toMatch(/waiver/i);
    expect(key).not.toBe('wmkf_deliverablestatus');
  }
});

test('an image replacement writes only the ref (and caption when supplied)', async () => {
  await call({ imageFile: imageFile() });
  const [, fields] = patchDeliverable.mock.calls[0];
  expect(fields).toEqual({ wmkf_imagefileref: 'https://sp/new.png' });
  expect(fields.wmkf_deliverablestatus).toBeUndefined();
});

test('the uploaded filename matches the portal writer pattern exactly', async () => {
  await call({ imageFile: imageFile() });
  const [library, folder, filename] = GraphService.uploadFile.mock.calls[0];
  expect(library).toBe('akoya_request');
  expect(folder).toBe(FOLDER);
  // The proxy allowlist and the prune regex both depend on this shape.
  expect(filename).toMatch(new RegExp(`^${REQNUM}_grantee_image_[0-9a-f]{8}\\.png$`));
  // The client-supplied name is ignored entirely.
  expect(filename).not.toContain('whatever-the-user-called-it');
});

// ── Input validation ──

test('refuses a request that replaces nothing', async () => {
  await expect(call()).rejects.toMatchObject({ httpStatus: 400 });
  expect(patchDeliverable).not.toHaveBeenCalled();
});

test('refuses a blank caption rather than clearing the record', async () => {
  await expect(call({ caption: '   ' })).rejects.toMatchObject({ httpStatus: 400 });
  expect(patchDeliverable).not.toHaveBeenCalled();
});

test('refuses without a client etag (no bare last-write)', async () => {
  await expect(call({ caption: 'new', clientEtag: '' })).rejects.toMatchObject({ httpStatus: 400 });
  expect(patchDeliverable).not.toHaveBeenCalled();
});

test('refuses bytes that do not match the declared extension', async () => {
  await expect(call({ imageFile: { filename: 'x.png', buffer: Buffer.from('not an image') } }))
    .rejects.toMatchObject({ httpStatus: 400 });
  expect(GraphService.uploadFile).not.toHaveBeenCalled();
});

test('refuses an infected upload before it reaches SharePoint', async () => {
  isVirusScanEnabled.mockReturnValue(true);
  scanBytes.mockResolvedValue({ scan_result: 'infected' });
  await expect(call({ imageFile: imageFile() })).rejects.toMatchObject({ httpStatus: 422 });
  expect(GraphService.uploadFile).not.toHaveBeenCalled();
});

test('404s when the request has no deliverable package', async () => {
  getDeliverableForRequest.mockResolvedValue(null);
  await expect(call({ caption: 'new' })).rejects.toMatchObject({ httpStatus: 404 });
});

// ── Concurrency + rollback ──

test('a stale etag maps to 409 and removes the orphaned upload', async () => {
  patchDeliverable.mockRejectedValue(Object.assign(new Error('precondition'), { status: 412 }));
  await expect(call({ imageFile: imageFile() })).rejects.toMatchObject({
    httpStatus: 409,
    body: { code: 'stale' },
  });
  expect(cleanupSharePointItems).toHaveBeenCalledWith('drive-1', [{ id: 'new-item', webUrl: 'https://sp/new.png' }], 'grantee-replace');
});

test('a non-412 failure that did NOT commit removes the upload', async () => {
  patchDeliverable.mockRejectedValue(new Error('boom'));
  getDeliverableForRequest
    .mockResolvedValueOnce(pkg())                                  // pre-write read
    .mockResolvedValueOnce(pkg());                                 // post-error re-read: ref unchanged
  await expect(call({ imageFile: imageFile() })).rejects.toMatchObject({ httpStatus: 502 });
  expect(cleanupSharePointItems).toHaveBeenCalledWith('drive-1', expect.any(Array), 'grantee-replace');
});

// The divergence from the portal writer, and the reason this test uses a
// STAFF_REVIEW package rather than SUBMITTED.
//
// The portal writer confirms a commit with `ref === new && status === SUBMITTED`.
// This path writes no status, so copying that check would misread a real commit
// as a rollback and delete an image the committed row now references. On a
// SUBMITTED row the buggy check happens to agree, so it proves nothing — a
// STAFF_REVIEW row is the case that discriminates. Verified by mutation: adding
// the status term to the service makes THIS test fail and no other.
test('a committed response-drop on a Staff Review row keeps the image and succeeds', async () => {
  const reviewing = (over = {}) => pkg({ wmkf_deliverablestatus: GRANTEE_DELIVERABLE_STATUS.STAFF_REVIEW, ...over });
  patchDeliverable.mockRejectedValue(new Error('socket hang up'));
  getDeliverableForRequest
    .mockResolvedValueOnce(reviewing())                                            // pre-write read
    .mockResolvedValueOnce(reviewing({ wmkf_imagefileref: 'https://sp/new.png' })) // committed
    .mockResolvedValueOnce(reviewing({ wmkf_imagefileref: 'https://sp/new.png' })); // success re-read
  await expect(call({ imageFile: imageFile() })).resolves.toMatchObject({ ok: true });
  expect(cleanupSharePointItems).not.toHaveBeenCalled();
});

test('a committed caption-only response-drop succeeds with a fresh etag', async () => {
  patchDeliverable.mockRejectedValue(new Error('socket hang up'));
  getDeliverableForRequest
    .mockResolvedValueOnce(pkg())
    .mockResolvedValueOnce(pkg({ wmkf_imagecaption: 'Revised caption.', _etag: 'W/"2"' }))
    .mockResolvedValueOnce(pkg({ wmkf_imagecaption: 'Revised caption.', _etag: 'W/"2"' }));

  await expect(call({ caption: '  Revised caption.  ' })).resolves.toMatchObject({
    ok: true,
    caption: 'Revised caption.',
    etag: 'W/"2"',
  });
  expect(GraphService.uploadFile).not.toHaveBeenCalled();
  expect(cleanupSharePointItems).not.toHaveBeenCalled();
});

test('an unknown post-error state leaves the upload in place', async () => {
  patchDeliverable.mockRejectedValue(new Error('boom'));
  getDeliverableForRequest
    .mockResolvedValueOnce(pkg())
    .mockRejectedValueOnce(new Error('re-read failed'));
  await expect(call({ imageFile: imageFile() })).rejects.toMatchObject({ httpStatus: 502 });
  // A possible orphan beats deleting an image a committed row may reference.
  expect(cleanupSharePointItems).not.toHaveBeenCalled();
});

// ── Prior-image prune ──

test('prunes only the exact prior image after a committed replacement', async () => {
  GraphService.listFiles.mockResolvedValue([
    { id: 'old-item', name: `${REQNUM}_grantee_image_aaaaaaaa.png` },
    { id: 'new-item', name: `${REQNUM}_grantee_image_bbbbbbbb.png` },
    { id: 'concurrent-item', name: `${REQNUM}_grantee_image_cccccccc.png` },
    { id: 'unrelated', name: 'some-other-document.pdf' },
  ]);
  await call({ imageFile: imageFile() });
  expect(cleanupSharePointItems).toHaveBeenCalledWith(
    'drive-1',
    [{ id: 'old-item', name: `${REQNUM}_grantee_image_aaaaaaaa.png` }],
    'grantee-replace-orphan',
  );
});

test('an interleaved replacement cannot prune the later committed image', async () => {
  const originalRef = `${FOLDER}/${REQNUM}_grantee_image_aaaaaaaa.png`;
  const imageARef = `https://sp.example/${FOLDER}/${REQNUM}_grantee_image_bbbbbbbb.png`;
  const imageBRef = `https://sp.example/${FOLDER}/${REQNUM}_grantee_image_cccccccc.png`;
  const listing = [
    { id: 'original-item', name: `${REQNUM}_grantee_image_aaaaaaaa.png` },
    { id: 'a-item', name: `${REQNUM}_grantee_image_bbbbbbbb.png` },
    { id: 'b-item', name: `${REQNUM}_grantee_image_cccccccc.png` },
  ];

  GraphService.uploadFile
    .mockResolvedValueOnce({ id: 'a-item', webUrl: imageARef })
    .mockResolvedValueOnce({ id: 'b-item', webUrl: imageBRef });
  getDeliverableForRequest
    .mockResolvedValueOnce(pkg({ wmkf_imagefileref: originalRef, _etag: ETAG }))
    .mockResolvedValueOnce(pkg({ wmkf_imagefileref: imageARef, _etag: 'W/"2"' }))
    .mockResolvedValueOnce(pkg({ wmkf_imagefileref: imageBRef, _etag: 'W/"3"' }))
    .mockResolvedValueOnce(pkg({ wmkf_imagefileref: imageBRef, _etag: 'W/"3"' }));

  let releaseAList;
  let markAListing;
  const aReachedPrune = new Promise((resolve) => { markAListing = resolve; });
  GraphService.listFiles
    .mockImplementationOnce(() => {
      markAListing();
      return new Promise((resolve) => { releaseAList = resolve; });
    })
    .mockResolvedValueOnce(listing);

  const replaceA = call({ imageFile: imageFile(), clientEtag: ETAG });
  await aReachedPrune;
  const replaceB = call({ imageFile: imageFile(), clientEtag: 'W/"2"' });
  await replaceB;
  releaseAList(listing);
  await replaceA;

  const prunedItems = cleanupSharePointItems.mock.calls
    .filter(([, , label]) => label === 'grantee-replace-orphan')
    .flatMap(([, items]) => items);
  expect(prunedItems).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'original-item' }),
    expect.objectContaining({ id: 'a-item' }),
  ]));
  expect(prunedItems).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'b-item' }),
  ]));
});

test('an unrecognized prior ref skips pruning rather than guessing from the folder', async () => {
  getDeliverableForRequest.mockResolvedValue(pkg({ wmkf_imagefileref: 'https://sp.example/not-a-writer-name.png' }));
  await call({ imageFile: imageFile() });
  expect(GraphService.listFiles).not.toHaveBeenCalled();
  expect(cleanupSharePointItems).not.toHaveBeenCalled();
});

test('a prune failure does not fail the committed replacement', async () => {
  GraphService.listFiles.mockRejectedValue(new Error('graph down'));
  await expect(call({ imageFile: imageFile() })).resolves.toMatchObject({ ok: true });
});

test('a caption-only replacement never touches SharePoint', async () => {
  await call({ caption: 'Just the caption.' });
  expect(GraphService.uploadFile).not.toHaveBeenCalled();
  expect(GraphService.listFiles).not.toHaveBeenCalled();
  expect(cleanupSharePointItems).not.toHaveBeenCalled();
});
