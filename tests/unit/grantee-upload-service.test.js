/**
 * writeGranteeDeliverables — validate → scan → upload → ATOMIC changeset →
 * cross-store recovery. The two Dataverse PATCHes (akoya_request + deliverable)
 * commit together via runChangeset with per-op If-Match; SharePoint is outside
 * the changeset and reconciled in the catch.
 *
 * @jest-environment node
 */
jest.mock('../../lib/dataverse/core/changeset', () => ({ runChangeset: jest.fn() }));
jest.mock('../../lib/services/grantee-deliverable-record', () => ({
  getDeliverableForRequest: jest.fn(),
  GRANTEE_DELIVERABLE_ENTITY_SET: 'wmkf_granteedeliverables',
}));
jest.mock('../../lib/services/graph-service', () => ({
  GraphService: { getDriveId: jest.fn(), uploadFile: jest.fn(), deleteFile: jest.fn(), listFiles: jest.fn() },
}));
jest.mock('../../lib/services/cloudmersive-scan', () => ({ scanBytes: jest.fn() }));
jest.mock('../../lib/utils/virus-scan-config', () => ({ isVirusScanEnabled: jest.fn(() => false) }));

import { runChangeset } from '../../lib/dataverse/core/changeset';
import { getDeliverableForRequest } from '../../lib/services/grantee-deliverable-record';
import { GraphService } from '../../lib/services/graph-service';
import { scanBytes } from '../../lib/services/cloudmersive-scan';
import { isVirusScanEnabled } from '../../lib/utils/virus-scan-config';
import { writeGranteeDeliverables } from '../../lib/services/grantee-upload';
import { GRANTEE_DELIVERABLE_STATUS } from '../../shared/config/granteeDeliverableStatus';
import {
  MAX_GRANTEE_ABSTRACT_MARKDOWN_LENGTH,
  MAX_GRANTEE_CAPTION_MARKDOWN_LENGTH,
} from '../../shared/config/granteeAbstract';

const REQ = {
  akoya_requestid: '11111111-1111-1111-1111-111111111111',
  akoya_requestnum: '1002794',
  _etag: 'W/"1"',
};
const DELIVERABLE = {
  wmkf_granteedeliverableid: 'deliv-1',
  wmkf_imagefileref: null,
  _etag: 'W/"2"',
};
const VER = '33333333-3333-3333-3333-333333333333';
const ABSTRACT = 'The team will measure the thing in a sufficiently long approved abstract sentence.';
const png = () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const imageFile = (name = 'fig.png') => ({ buffer: png(), filename: name });
const BODY_HASH = 'a'.repeat(64);
const call = (over = {}) => writeGranteeDeliverables({
  request: REQ, deliverable: DELIVERABLE, editedAbstract: ABSTRACT, caption: 'A figure.',
  imageFile: imageFile(), waiverVersionId: VER, waiverBodyHash: BODY_HASH, ...over,
});

beforeEach(() => {
  runChangeset.mockReset().mockResolvedValue({ ok: true, operations: [] });
  getDeliverableForRequest.mockReset().mockResolvedValue(null);
  GraphService.getDriveId.mockReset().mockResolvedValue('drive-1');
  GraphService.uploadFile.mockReset().mockResolvedValue({ id: 'item-new', name: 'n.png', webUrl: 'https://sp/new.png' });
  GraphService.deleteFile.mockReset().mockResolvedValue();
  GraphService.listFiles.mockReset().mockResolvedValue([]);
  scanBytes.mockReset().mockResolvedValue({ scan_result: 'clean' });
  isVirusScanEnabled.mockReset().mockReturnValue(false);
});

test('happy path: uploads image + one atomic changeset of both PATCHes, per-op If-Match, waiver pinned', async () => {
  const r = await call();
  expect(r).toEqual({ ok: true });

  const upName = GraphService.uploadFile.mock.calls[0][2];
  expect(upName).toMatch(/^1002794_grantee_image_[0-9a-f]{8}\.png$/); // server-controlled, unique

  expect(runChangeset).toHaveBeenCalledTimes(1);
  const [ops] = runChangeset.mock.calls[0];
  // request PATCH (abstract) with its ETag
  expect(ops[0]).toEqual({
    method: 'PATCH', entitySet: 'akoya_requests', key: REQ.akoya_requestid,
    body: { wmkf_abstractapproved: ABSTRACT }, ifMatch: 'W/"1"',
  });
  // deliverable PATCH with waiver bind + acked timestamp + its ETag
  expect(ops[1]).toMatchObject({
    method: 'PATCH', entitySet: 'wmkf_granteedeliverables', key: 'deliv-1', ifMatch: 'W/"2"',
    body: {
      wmkf_imagecaption: 'A figure.',
      wmkf_deliverablestatus: GRANTEE_DELIVERABLE_STATUS.SUBMITTED,
      wmkf_imagefileref: 'https://sp/new.png',
      'wmkf_WaiverPolicyVersion@odata.bind': `/wmkf_policyversions(${VER})`,
      wmkf_waiverbodyhash: BODY_HASH,
    },
  });
  expect(typeof ops[1].body.wmkf_waiverackedat).toBe('string');
});

test('durability hook records exact SharePoint candidate before Dataverse commit', async () => {
  const order = [];
  const onCandidateUploaded = jest.fn(async (candidate) => {
    order.push('candidate');
    expect(candidate).toMatchObject({
      driveId: 'drive-1',
      itemId: 'item-new',
      imageRef: 'https://sp/new.png',
    });
  });
  runChangeset.mockImplementation(async () => { order.push('changeset'); return { ok: true }; });
  await call({ onCandidateUploaded });
  expect(order).toEqual(['candidate', 'changeset']);
});

test('durability hook failure removes candidate and prevents Dataverse commit', async () => {
  const result = await call({
    onCandidateUploaded: jest.fn(async () => { throw new Error('ledger unavailable'); }),
  });
  expect(result).toMatchObject({ ok: false, reason: 'staging_failed', status: 503 });
  expect(GraphService.deleteFile).toHaveBeenCalledWith('drive-1', 'item-new');
  expect(runChangeset).not.toHaveBeenCalled();
});

test('omits the body hash column when none is supplied (still writes the version lookup)', async () => {
  await call({ waiverBodyHash: undefined });
  const [ops] = runChangeset.mock.calls[0];
  expect(ops[1].body).not.toHaveProperty('wmkf_waiverbodyhash');
  expect(ops[1].body['wmkf_WaiverPolicyVersion@odata.bind']).toBe(`/wmkf_policyversions(${VER})`);
});

test('missing waiverVersionId → fail closed (policy_misconfigured), no upload/changeset', async () => {
  const r = await writeGranteeDeliverables({ request: REQ, deliverable: DELIVERABLE, editedAbstract: ABSTRACT, caption: 'c', imageFile: imageFile(), waiverVersionId: undefined });
  expect(r).toEqual({ ok: false, reason: 'policy_misconfigured', status: 500 });
  expect(GraphService.uploadFile).not.toHaveBeenCalled();
  expect(runChangeset).not.toHaveBeenCalled();
});

test('abstract + caption required', async () => {
  expect((await call({ editedAbstract: 'short' })).reason).toBe('abstract_required');
  expect((await call({ caption: '' })).reason).toBe('caption_required');
});

test('abstract length boundary rejects before image scan, upload, or Dataverse write', async () => {
  const withImg = { ...DELIVERABLE, wmkf_imagefileref: 'https://sp/existing.png' };
  const accepted = await call({
    deliverable: withImg,
    imageFile: null,
    editedAbstract: 'é'.repeat(MAX_GRANTEE_ABSTRACT_MARKDOWN_LENGTH),
  });
  expect(accepted).toEqual({ ok: true });
  expect(runChangeset).toHaveBeenCalledTimes(1);

  jest.clearAllMocks();
  const rejected = await call({
    editedAbstract: 'é'.repeat(MAX_GRANTEE_ABSTRACT_MARKDOWN_LENGTH + 1),
  });
  expect(rejected).toEqual({ ok: false, reason: 'abstract_too_long', status: 400 });
  expect(scanBytes).not.toHaveBeenCalled();
  expect(GraphService.getDriveId).not.toHaveBeenCalled();
  expect(GraphService.uploadFile).not.toHaveBeenCalled();
  expect(runChangeset).not.toHaveBeenCalled();
});

test('caption length boundary rejects before image scan, upload, or Dataverse write', async () => {
  const rejected = await call({
    caption: 'é'.repeat(MAX_GRANTEE_CAPTION_MARKDOWN_LENGTH + 1),
  });
  expect(rejected).toEqual({ ok: false, reason: 'caption_too_long', status: 400 });
  expect(scanBytes).not.toHaveBeenCalled();
  expect(GraphService.getDriveId).not.toHaveBeenCalled();
  expect(GraphService.uploadFile).not.toHaveBeenCalled();
  expect(runChangeset).not.toHaveBeenCalled();
});

test('image required when none on file; optional when one exists (PATCH omits ref)', async () => {
  expect((await call({ imageFile: null })).reason).toBe('image_required');

  const withImg = { ...DELIVERABLE, wmkf_imagefileref: 'https://sp/old.png' };
  const r = await call({ deliverable: withImg, imageFile: null });
  expect(r.ok).toBe(true);
  expect(GraphService.uploadFile).not.toHaveBeenCalled();
  const [ops] = runChangeset.mock.calls[0];
  expect(ops[1].body).not.toHaveProperty('wmkf_imagefileref');
});

test('rejects an image whose magic bytes mismatch its extension', async () => {
  const fake = { buffer: Buffer.from([0xff, 0xd8, 0xff]), filename: 'fig.png' }; // jpeg bytes, .png name
  const r = await call({ imageFile: fake });
  expect(r.reason).toBe('image_invalid');
  expect(GraphService.uploadFile).not.toHaveBeenCalled();
});

test('rejects an oversized image', async () => {
  const big = { buffer: Buffer.concat([png(), Buffer.alloc(16 * 1024 * 1024)]), filename: 'fig.png' };
  expect((await call({ imageFile: big })).reason).toBe('image_too_large');
});

test('infected scan → 422, no upload', async () => {
  isVirusScanEnabled.mockReturnValue(true);
  scanBytes.mockResolvedValue({ scan_result: 'infected', scanner: 'cloudmersive', detectedThreats: ['embedded macro'] });
  const r = await call();
  expect(r).toMatchObject({
    ok: false,
    reason: 'infected',
    status: 422,
    diagnostics: {
      stage: 'virus_scan',
      service: 'cloudmersive',
      scanResult: 'infected',
      detectedThreats: ['embedded macro'],
    },
  });
  expect(GraphService.uploadFile).not.toHaveBeenCalled();
});

test('transient scan failure carries sanitized diagnostics', async () => {
  isVirusScanEnabled.mockReturnValue(true);
  scanBytes.mockRejectedValue(Object.assign(new Error('timeout'), {
    serviceName: 'cloudmersive',
    isTransient: true,
    status: 503,
  }));
  const r = await call();
  expect(r).toMatchObject({
    ok: false,
    reason: 'scan_unavailable',
    status: 503,
    diagnostics: {
      stage: 'virus_scan',
      service: 'cloudmersive',
      transient: true,
      status: 503,
    },
  });
  expect(GraphService.uploadFile).not.toHaveBeenCalled();
});

test('no _etag on either row → 503 fail-closed (no changeset, no upload)', async () => {
  expect(await call({ request: { ...REQ, _etag: undefined } })).toEqual({ ok: false, reason: 'no_etag', status: 503 });
  expect(await call({ deliverable: { ...DELIVERABLE, _etag: undefined } })).toEqual({ ok: false, reason: 'no_etag', status: 503 });
  expect(GraphService.uploadFile).not.toHaveBeenCalled();
});

test('SharePoint upload failure → sharepoint_failed, no changeset', async () => {
  GraphService.uploadFile.mockRejectedValue(Object.assign(new Error('graph 500'), {
    serviceName: 'graph',
    isTransient: true,
    status: 503,
  }));
  const r = await call();
  expect(r).toMatchObject({
    ok: false,
    reason: 'sharepoint_failed',
    status: 502,
    diagnostics: {
      stage: 'sharepoint_upload',
      service: 'graph',
      transient: true,
      status: 503,
      uploadedItemCreated: false,
      cleanupAttempted: false,
    },
  });
  expect(runChangeset).not.toHaveBeenCalled();
});

test('412 anywhere in the changeset → whole thing rolls back → conflict (409) + upload cleaned up', async () => {
  runChangeset.mockRejectedValue(Object.assign(new Error('precondition'), { status: 412 }));
  const r = await call();
  expect(r).toEqual({ ok: false, reason: 'conflict', status: 409 });
  expect(GraphService.deleteFile).toHaveBeenCalledWith('drive-1', 'item-new');
  expect(getDeliverableForRequest).not.toHaveBeenCalled(); // 412 = nothing committed; no re-read
});

test('non-412 error with nothing committed → cleans up upload → dataverse_failed', async () => {
  runChangeset.mockRejectedValue(new Error('batch 500'));
  getDeliverableForRequest.mockResolvedValue({ wmkf_imagefileref: null, wmkf_deliverablestatus: null });
  const r = await call();
  expect(r).toMatchObject({
    ok: false,
    reason: 'dataverse_failed',
    status: 502,
    diagnostics: {
      stage: 'dataverse_changeset',
      uploadedItemCreated: true,
      postErrorCommitState: 'not_committed',
      cleanupOutcome: 'deleted',
    },
  });
  expect(GraphService.deleteFile).toHaveBeenCalledWith('drive-1', 'item-new');
});

test('non-412 error but re-read shows it committed (response drop) → success, upload kept', async () => {
  runChangeset.mockRejectedValue(new Error('socket hang up'));
  getDeliverableForRequest.mockResolvedValue({
    wmkf_imagefileref: 'https://sp/new.png',
    wmkf_deliverablestatus: GRANTEE_DELIVERABLE_STATUS.SUBMITTED,
  });
  const r = await call();
  expect(r).toEqual({ ok: true });
  expect(GraphService.deleteFile).not.toHaveBeenCalledWith('drive-1', 'item-new');
});

test('non-412 error and re-read FAILS → leave upload in place (never delete a maybe-referenced image)', async () => {
  runChangeset.mockRejectedValue(new Error('socket hang up'));
  getDeliverableForRequest.mockRejectedValue(new Error('re-read failed'));
  const r = await call();
  expect(r).toMatchObject({
    ok: false,
    reason: 'dataverse_failed',
    status: 502,
    diagnostics: {
      stage: 'dataverse_changeset',
      uploadedItemCreated: true,
      postErrorCommitState: 'unknown',
      cleanupOutcome: 'not_attempted',
    },
  });
  expect(GraphService.deleteFile).not.toHaveBeenCalledWith('drive-1', 'item-new');
});

test('on replace-success, best-effort prunes the prior (stale) image', async () => {
  const withImg = { ...DELIVERABLE, wmkf_imagefileref: 'https://sp/old.jpg' };
  GraphService.uploadFile.mockResolvedValue({ id: 'item-new', name: '1002794_grantee_image_newnewne.png', webUrl: 'https://sp/new.png' });
  GraphService.listFiles.mockResolvedValue([
    { id: 'old-1', name: '1002794_grantee_image_oldoldol.jpg' },
    { id: 'item-new', name: '1002794_grantee_image_newnewne.png' },
  ]);
  const r = await call({ deliverable: withImg });
  expect(r.ok).toBe(true);
  expect(GraphService.deleteFile).toHaveBeenCalledWith('drive-1', 'old-1');
  expect(GraphService.deleteFile).not.toHaveBeenCalledWith('drive-1', 'item-new');
});
