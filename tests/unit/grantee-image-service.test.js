/**
 * lib/services/workbench/grantee-deliverables/image-service — S411 increment 2.
 *
 * The security of this route lives in this service: the folder is re-derived
 * server-side and only the FILENAME comes from stored data, so these pin the
 * filename allowlist (traversal, scheme, extension) and the content-type
 * derivation, plus every failure mapping.
 *
 * @jest-environment node
 */
jest.mock('../../lib/services/graph-service', () => ({
  GraphService: { downloadFileByPath: jest.fn() },
}));
jest.mock('../../lib/services/grantee-deliverable-record', () => ({
  getDeliverableForRequest: jest.fn(),
}));
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({
  getById: jest.fn(),
}));

import { GraphService } from '../../lib/services/graph-service';
import { getDeliverableForRequest } from '../../lib/services/grantee-deliverable-record';
import * as grantRequestAdapter from '../../lib/dataverse/adapters/grant-request';
import { loadGranteeImage, imageFilenameFromRef } from '../../lib/services/workbench/grantee-deliverables/image-service';

const GUID = '22222222-2222-2222-2222-222222222222';
const REQNUM = '1002365';
const NAME = `${REQNUM}_grantee_image_a1b2c3d4.png`;
// The folder the writer uploads to: {reqNum}_{GUID no dashes, upper}/Grantee_Uploads
const FOLDER = `${REQNUM}_22222222222222222222222222222222/Grantee_Uploads`;

// Minimal valid magic bytes per type.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(16)]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(16),
]);

beforeEach(() => {
  jest.clearAllMocks();
  grantRequestAdapter.getById.mockResolvedValue({ akoya_requestid: GUID, akoya_requestnum: REQNUM });
  getDeliverableForRequest.mockResolvedValue({ wmkf_imagefileref: NAME });
  GraphService.downloadFileByPath.mockResolvedValue({ buffer: PNG });
});

describe('imageFilenameFromRef', () => {
  test('accepts the relative-path fallback the writer stores', () => {
    expect(imageFilenameFromRef(`${FOLDER}/${NAME}`)).toBe(NAME);
  });

  test('accepts an absolute SharePoint webUrl and percent-decodes the segment', () => {
    expect(imageFilenameFromRef(`https://wmkf.sharepoint.com/sites/g/${FOLDER}/${NAME}`)).toBe(NAME);
    expect(imageFilenameFromRef(`https://wmkf.sharepoint.com/x/${encodeURIComponent(NAME)}`)).toBe(NAME);
  });

  test('strips a query string or fragment from a webUrl', () => {
    expect(imageFilenameFromRef(`https://wmkf.sharepoint.com/x/${NAME}?web=1`)).toBe(NAME);
    expect(imageFilenameFromRef(`https://wmkf.sharepoint.com/x/${NAME}#frag`)).toBe(NAME);
  });

  test.each(['jpg', 'webp'])('accepts the other stored extension: %s', (ext) => {
    const n = `${REQNUM}_grantee_image_00ff11aa.${ext}`;
    expect(imageFilenameFromRef(n)).toBe(n);
  });

  test.each([
    ['traversal segments', '../../../../etc/passwd'],
    ['traversal after a valid folder', `${FOLDER}/../../secrets.png`],
    ['an encoded separator', `https://x/y/${encodeURIComponent('../secret.png')}`],
    ['a non-image extension', `${REQNUM}_grantee_image_a1b2c3d4.svg`],
    ['a double extension', `${REQNUM}_grantee_image_a1b2c3d4.png.svg`],
    ['an arbitrary name', 'company-payroll.png'],
    ['a wrong-length nonce', `${REQNUM}_grantee_image_a1b2.png`],
    ['a non-hex nonce', `${REQNUM}_grantee_image_zzzzzzzz.png`],
    ['malformed percent-encoding', 'https://x/y/%E0%A4%A'],
    ['an empty string', ''],
    ['a non-string', null],
  ])('refuses %s', (_label, ref) => {
    expect(imageFilenameFromRef(ref)).toBeNull();
  });
});

describe('loadGranteeImage', () => {
  test('addresses the writer-derived folder and serves the validated content type', async () => {
    const out = await loadGranteeImage({ requestId: GUID });
    expect(GraphService.downloadFileByPath).toHaveBeenCalledWith('akoya_request', FOLDER, NAME);
    expect(out.contentType).toBe('image/png');
    expect(out.filename).toBe(NAME);
    expect(out.buffer).toBe(PNG);
  });

  test.each([
    ['jpg', JPEG, 'image/jpeg'],
    ['webp', WEBP, 'image/webp'],
  ])('serves %s bytes as %s', async (ext, bytes, contentType) => {
    const n = `${REQNUM}_grantee_image_a1b2c3d4.${ext}`;
    getDeliverableForRequest.mockResolvedValue({ wmkf_imagefileref: n });
    GraphService.downloadFileByPath.mockResolvedValue({ buffer: bytes });
    const out = await loadGranteeImage({ requestId: GUID });
    expect(out.contentType).toBe(contentType);
  });

  test('the content type comes from the stored extension, never from Graph', async () => {
    // Graph reporting something else must not change what we serve.
    GraphService.downloadFileByPath.mockResolvedValue({ buffer: PNG, mimeType: 'text/html' });
    const out = await loadGranteeImage({ requestId: GUID });
    expect(out.contentType).toBe('image/png');
  });

  test('404 when the request is missing or carries no request number', async () => {
    grantRequestAdapter.getById.mockResolvedValue(null);
    await expect(loadGranteeImage({ requestId: GUID })).rejects.toMatchObject({ httpStatus: 404 });

    grantRequestAdapter.getById.mockResolvedValue({ akoya_requestid: GUID });
    await expect(loadGranteeImage({ requestId: GUID })).rejects.toMatchObject({ httpStatus: 404 });
  });

  test('404 when the request read throws', async () => {
    grantRequestAdapter.getById.mockRejectedValue(new Error('dataverse down'));
    await expect(loadGranteeImage({ requestId: GUID })).rejects.toMatchObject({ httpStatus: 404 });
  });

  test('404 with no deliverable row and with no image ref', async () => {
    getDeliverableForRequest.mockResolvedValue(null);
    await expect(loadGranteeImage({ requestId: GUID })).rejects.toMatchObject({ httpStatus: 404 });

    getDeliverableForRequest.mockResolvedValue({ wmkf_imagefileref: null });
    await expect(loadGranteeImage({ requestId: GUID })).rejects.toMatchObject({ httpStatus: 404 });
  });

  test('an unrecognized ref 404s and never reaches SharePoint', async () => {
    getDeliverableForRequest.mockResolvedValue({ wmkf_imagefileref: '../../../etc/passwd' });
    await expect(loadGranteeImage({ requestId: GUID })).rejects.toMatchObject({ httpStatus: 404 });
    expect(GraphService.downloadFileByPath).not.toHaveBeenCalled();
  });

  test('502 when Graph throws, without leaking its message', async () => {
    GraphService.downloadFileByPath.mockRejectedValue(new Error('File not found: secret-tenant-detail'));
    await expect(loadGranteeImage({ requestId: GUID })).rejects.toMatchObject({
      httpStatus: 502,
      message: 'Could not fetch the image from SharePoint.',
    });
  });

  test('502 on an empty or non-buffer body', async () => {
    GraphService.downloadFileByPath.mockResolvedValue({ buffer: Buffer.alloc(0) });
    await expect(loadGranteeImage({ requestId: GUID })).rejects.toMatchObject({ httpStatus: 502 });

    GraphService.downloadFileByPath.mockResolvedValue({ buffer: 'not-a-buffer' });
    await expect(loadGranteeImage({ requestId: GUID })).rejects.toMatchObject({ httpStatus: 502 });
  });

  test('502 when the stored bytes do not match the stored extension', async () => {
    // .png in the name, JPEG on disk — an out-of-band replacement in the library.
    GraphService.downloadFileByPath.mockResolvedValue({ buffer: JPEG });
    await expect(loadGranteeImage({ requestId: GUID })).rejects.toMatchObject({ httpStatus: 502 });
  });

  test('HTML bytes behind an image name are refused, not served', async () => {
    GraphService.downloadFileByPath.mockResolvedValue({ buffer: Buffer.from('<script>alert(1)</script>') });
    await expect(loadGranteeImage({ requestId: GUID })).rejects.toMatchObject({ httpStatus: 502 });
  });
});
