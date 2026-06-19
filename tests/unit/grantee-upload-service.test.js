/**
 * writeGranteeDeliverables — validate → scan → upload → ETag-PATCH → rollback.
 *
 * @jest-environment node
 */
jest.mock('../../lib/services/dynamics-service', () => ({ DynamicsService: { updateRecord: jest.fn() } }));
jest.mock('../../lib/services/graph-service', () => ({
  GraphService: { getDriveId: jest.fn(), uploadFile: jest.fn(), deleteFile: jest.fn(), listFiles: jest.fn() },
}));
jest.mock('../../lib/services/cloudmersive-scan', () => ({ scanBytes: jest.fn() }));
jest.mock('../../lib/utils/virus-scan-config', () => ({ isVirusScanEnabled: jest.fn(() => false) }));

import { DynamicsService } from '../../lib/services/dynamics-service';
import { GraphService } from '../../lib/services/graph-service';
import { scanBytes } from '../../lib/services/cloudmersive-scan';
import { isVirusScanEnabled } from '../../lib/utils/virus-scan-config';
import { writeGranteeDeliverables } from '../../lib/services/grantee-upload';
import { GRANTEE_DELIVERABLE_STATUS } from '../../shared/config/granteeDeliverableStatus';

const REQ = {
  akoya_requestid: '11111111-1111-1111-1111-111111111111',
  akoya_requestnum: '1002794',
  wmkf_granteeimagefileref: null,
  _etag: 'W/"1"',
};
const ABSTRACT = 'The team will measure the thing in a sufficiently long approved abstract sentence.';
const png = () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const imageFile = (name = 'fig.png') => ({ buffer: png(), filename: name });

beforeEach(() => {
  DynamicsService.updateRecord.mockReset().mockResolvedValue({});
  GraphService.getDriveId.mockReset().mockResolvedValue('drive-1');
  GraphService.uploadFile.mockReset().mockResolvedValue({ id: 'item-new', name: 'n.png', webUrl: 'https://sp/new.png' });
  GraphService.deleteFile.mockReset().mockResolvedValue();
  GraphService.listFiles.mockReset().mockResolvedValue([]);
  scanBytes.mockReset().mockResolvedValue({ scan_result: 'clean' });
  isVirusScanEnabled.mockReset().mockReturnValue(false);
});

test('happy path: uploads image + PATCHes all four fields conditionally, status Submitted', async () => {
  const r = await writeGranteeDeliverables({ request: REQ, editedAbstract: ABSTRACT, caption: 'A figure.', imageFile: imageFile() });
  expect(r).toEqual({ ok: true });

  const upName = GraphService.uploadFile.mock.calls[0][2];
  expect(upName).toMatch(/^1002794_grantee_image_[0-9a-f]{8}\.png$/); // server-controlled, unique
  expect(GraphService.uploadFile.mock.calls[0][1]).toMatch(/Grantee_Uploads$/);

  const [, , patch, opts] = DynamicsService.updateRecord.mock.calls[0];
  expect(patch).toMatchObject({
    wmkf_abstractapproved: ABSTRACT,
    wmkf_granteeimagecaption: 'A figure.',
    wmkf_granteeimagefileref: 'https://sp/new.png',
    wmkf_granteedeliverablestatus: GRANTEE_DELIVERABLE_STATUS.SUBMITTED,
  });
  expect(opts).toEqual({ ifMatch: 'W/"1"' });
});

test('abstract + caption required', async () => {
  expect((await writeGranteeDeliverables({ request: REQ, editedAbstract: 'short', caption: 'c', imageFile: imageFile() })).reason).toBe('abstract_required');
  expect((await writeGranteeDeliverables({ request: REQ, editedAbstract: ABSTRACT, caption: '', imageFile: imageFile() })).reason).toBe('caption_required');
});

test('image required when none on file; optional when one exists', async () => {
  expect((await writeGranteeDeliverables({ request: REQ, editedAbstract: ABSTRACT, caption: 'c', imageFile: null })).reason).toBe('image_required');

  // existing image on file → image optional; PATCH omits the ref
  const withImg = { ...REQ, wmkf_granteeimagefileref: 'https://sp/old.png' };
  const r = await writeGranteeDeliverables({ request: withImg, editedAbstract: ABSTRACT, caption: 'c', imageFile: null });
  expect(r.ok).toBe(true);
  expect(GraphService.uploadFile).not.toHaveBeenCalled();
  expect(DynamicsService.updateRecord.mock.calls[0][2]).not.toHaveProperty('wmkf_granteeimagefileref');
});

test('rejects an image whose magic bytes mismatch its extension', async () => {
  const fake = { buffer: Buffer.from([0xff, 0xd8, 0xff]), filename: 'fig.png' }; // jpeg bytes, .png name
  const r = await writeGranteeDeliverables({ request: REQ, editedAbstract: ABSTRACT, caption: 'c', imageFile: fake });
  expect(r.reason).toBe('image_invalid');
  expect(GraphService.uploadFile).not.toHaveBeenCalled();
});

test('rejects an oversized image', async () => {
  const big = { buffer: Buffer.concat([png(), Buffer.alloc(16 * 1024 * 1024)]), filename: 'fig.png' };
  expect((await writeGranteeDeliverables({ request: REQ, editedAbstract: ABSTRACT, caption: 'c', imageFile: big })).reason).toBe('image_too_large');
});

test('infected scan → 422, no upload', async () => {
  isVirusScanEnabled.mockReturnValue(true);
  scanBytes.mockResolvedValue({ scan_result: 'infected' });
  const r = await writeGranteeDeliverables({ request: REQ, editedAbstract: ABSTRACT, caption: 'c', imageFile: imageFile() });
  expect(r).toEqual({ ok: false, reason: 'infected', status: 422 });
  expect(GraphService.uploadFile).not.toHaveBeenCalled();
});

test('no _etag → 503 fail-closed (no PATCH, no upload)', async () => {
  const r = await writeGranteeDeliverables({ request: { ...REQ, _etag: undefined }, editedAbstract: ABSTRACT, caption: 'c', imageFile: imageFile() });
  expect(r).toEqual({ ok: false, reason: 'no_etag', status: 503 });
  expect(GraphService.uploadFile).not.toHaveBeenCalled();
});

test('PATCH failure rolls back the uploaded image', async () => {
  DynamicsService.updateRecord.mockRejectedValue(new Error('boom'));
  const r = await writeGranteeDeliverables({ request: REQ, editedAbstract: ABSTRACT, caption: 'c', imageFile: imageFile() });
  expect(r).toMatchObject({ ok: false, reason: 'dataverse_failed' });
  expect(GraphService.deleteFile).toHaveBeenCalledWith('drive-1', 'item-new');
});

test('412 conflict → rollback + reason conflict (409)', async () => {
  DynamicsService.updateRecord.mockRejectedValue(Object.assign(new Error('precondition'), { status: 412 }));
  const r = await writeGranteeDeliverables({ request: REQ, editedAbstract: ABSTRACT, caption: 'c', imageFile: imageFile() });
  expect(r).toEqual({ ok: false, reason: 'conflict', status: 409 });
  expect(GraphService.deleteFile).toHaveBeenCalledWith('drive-1', 'item-new');
});

test('on replace-success, best-effort prunes the prior (stale) image', async () => {
  const withImg = { ...REQ, wmkf_granteeimagefileref: 'https://sp/old.jpg' };
  GraphService.uploadFile.mockResolvedValue({ id: 'item-new', name: '1002794_grantee_image_newnewne.png', webUrl: 'https://sp/new.png' });
  GraphService.listFiles.mockResolvedValue([
    { id: 'old-1', name: '1002794_grantee_image_oldoldol.jpg' },
    { id: 'item-new', name: '1002794_grantee_image_newnewne.png' },
  ]);
  const r = await writeGranteeDeliverables({ request: withImg, editedAbstract: ABSTRACT, caption: 'c', imageFile: imageFile() });
  expect(r.ok).toBe(true);
  // deletes the stale one, not the new one
  expect(GraphService.deleteFile).toHaveBeenCalledWith('drive-1', 'old-1');
  expect(GraphService.deleteFile).not.toHaveBeenCalledWith('drive-1', 'item-new');
});
