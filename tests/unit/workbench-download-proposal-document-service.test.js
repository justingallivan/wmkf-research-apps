/**
 * @jest-environment node
 *
 * lib/services/workbench/download-proposal-document-service — logic-level
 * tests (adapter/Graph/list mocked), Stage 4 series A extraction. Pins the
 * membership allow-set derivation and every typed error branch
 * (404 request, 403 membership, 403 allowlist, 404 file, 502 Graph).
 */

const getById = jest.fn();
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({
  getById: (...a) => getById(...a),
  SELECT_PROFILES: { DOCUMENT_SCOPE: 'akoya_requestid,akoya_requestnum,wmkf_meetingdate' },
}));

const downloadFileByPath = jest.fn();
jest.mock('../../lib/services/graph-service', () => ({
  GraphService: { downloadFileByPath: (...a) => downloadFileByPath(...a) },
}));

const listProposalDocuments = jest.fn();
jest.mock('../../lib/services/workbench-proposal-documents', () => ({
  listProposalDocuments: (...a) => listProposalDocuments(...a),
}));

import { downloadProposalDocument } from '../../lib/services/workbench/download-proposal-document-service';
import { ServiceHttpError } from '../../lib/services/service-http-error';

const REQ = '11111111-1111-1111-1111-111111111111';
const FOLDER = '1002794_X/Phase I';
const args = (over = {}) => ({ requestId: REQ, library: 'Documents', folder: FOLDER, filename: 'proposal.pdf', ...over });

beforeEach(() => {
  jest.clearAllMocks();
  getById.mockResolvedValue({ akoya_requestid: REQ, akoya_requestnum: '1002794', wmkf_meetingdate: '2026-06-01' });
  listProposalDocuments.mockResolvedValue({
    slots: [
      { found: true, library: 'Documents', folder: FOLDER, name: 'proposal.pdf' },
      { found: false, library: 'Documents', folder: FOLDER, name: 'missing.pdf' }, // not-found slots excluded
    ],
    otherDocuments: [{ library: 'Documents', folder: FOLDER, name: 'other.docx' }],
  });
  downloadFileByPath.mockResolvedValue({ buffer: Buffer.from('pdf'), mimeType: 'application/pdf', filename: 'proposal.pdf', size: 3 });
});

test('request not found → 404, no listing/download attempted', async () => {
  getById.mockRejectedValue(new Error('nope'));
  const err = await downloadProposalDocument(args()).catch((e) => e);
  expect(err).toBeInstanceOf(ServiceHttpError);
  expect(err.httpStatus).toBe(404);
  expect(err.message).toBe(`No request found for ${REQ}`);
  expect(listProposalDocuments).not.toHaveBeenCalled();
});

test('membership: found slots + otherDocuments allowed; unlisted or found:false → 403 pre-download', async () => {
  await expect(downloadProposalDocument(args({ filename: 'other.docx' }))).resolves.toBeTruthy();
  for (const filename of ['missing.pdf', 'not-listed.pdf']) {
    const err = await downloadProposalDocument(args({ filename })).catch((e) => e);
    expect(err.httpStatus).toBe(403);
    expect(err.message).toBe('File is not a Proposal-tab document for this request');
  }
  expect(downloadFileByPath).toHaveBeenCalledTimes(1);
});

test('golden path returns the plain file descriptor (never touches res)', async () => {
  const file = await downloadProposalDocument(args());
  expect(downloadFileByPath).toHaveBeenCalledWith('Documents', FOLDER, 'proposal.pdf');
  expect(file).toEqual({ buffer: Buffer.from('pdf'), mimeType: 'application/pdf', filename: 'proposal.pdf', size: 3 });
});

test('Graph error translation: allowlist → 403, file-not-found/(404) → 404, other → 502', async () => {
  downloadFileByPath.mockRejectedValueOnce(new Error('library not in the allowlist'));
  let err = await downloadProposalDocument(args()).catch((e) => e);
  expect(err.httpStatus).toBe(403);
  expect(err.message).toBe('Access to this document library is not permitted');

  downloadFileByPath.mockRejectedValueOnce(new Error('File not found in folder'));
  err = await downloadProposalDocument(args()).catch((e) => e);
  expect(err.httpStatus).toBe(404);
  expect(err.message).toBe('File not found');

  downloadFileByPath.mockRejectedValueOnce(new Error('Graph timeout'));
  err = await downloadProposalDocument(args()).catch((e) => e);
  expect(err.httpStatus).toBe(502);
  expect(err.message).toBe('Failed to download document from SharePoint');
});

test('listing failure propagates untyped (historical: no 500 mapping in this route)', async () => {
  listProposalDocuments.mockRejectedValue(new Error('graph listing down'));
  const err = await downloadProposalDocument(args()).catch((e) => e);
  expect(err).not.toBeInstanceOf(ServiceHttpError);
  expect(err.message).toBe('graph listing down');
});
