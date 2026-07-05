/**
 * @jest-environment node
 *
 * Unit tests for lib/services/reviewer-finder/load-proposal-service.js
 * (Route→Service Consolidation Plan, Stage 3 wave) — logic-level coverage
 * with adapters/Graph/Blob mocked: best-guess picking tiers, bucket dedupe,
 * per-bucket listing failure tolerance, and each LoadProposalError with its
 * pinned httpStatus/body.
 */

jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({
  __esModule: true,
  getById: jest.fn(),
  SELECT_PROFILES: { IDENTITY: ['akoya_requestid', 'akoya_requestnum'] },
}));
const listFiles = jest.fn();
const downloadFileByPath = jest.fn();
jest.mock('../../lib/services/graph-service', () => ({
  GraphService: {
    listFiles: (...a) => listFiles(...a),
    downloadFileByPath: (...a) => downloadFileByPath(...a),
  },
}));
jest.mock('../../lib/utils/sharepoint-buckets', () => ({
  getRequestSharePointBuckets: jest.fn(),
}));
const put = jest.fn();
jest.mock('@vercel/blob', () => ({ put: (...a) => put(...a) }));
// classifyFile is imported from the (unconverted) lookup-grant route — mock the
// module so this unit test does not load that route's import graph.
jest.mock('../../pages/api/grant-reporting/lookup-grant', () => ({
  classifyFile: (name) => (/narrative|proposal|phase/i.test(name) ? 'proposal' : 'other'),
}));

const grantRequestAdapter = require('../../lib/dataverse/adapters/grant-request.js');
const { getRequestSharePointBuckets } = require('../../lib/utils/sharepoint-buckets');
const { loadProposal, LoadProposalError } = require('../../lib/services/reviewer-finder/load-proposal-service');

const REQ = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function file(name, over = {}) {
  return { name, size: 10, mimeType: 'application/pdf', lastModified: '2026-01-01', folder: 'F', ...over };
}

beforeEach(() => {
  jest.clearAllMocks();
  grantRequestAdapter.getById.mockResolvedValue({ akoya_requestid: REQ, akoya_requestnum: '1002836' });
  getRequestSharePointBuckets.mockResolvedValue([{ library: 'lib1', folder: 'F' }]);
  downloadFileByPath.mockResolvedValue({
    buffer: Buffer.from('x'), filename: 'picked.pdf', mimeType: 'application/pdf', size: 10,
  });
  put.mockResolvedValue({ url: 'https://blob.example/x.pdf' });
});

test('404 LoadProposalError with default { error } body when the request is missing its number', async () => {
  grantRequestAdapter.getById.mockResolvedValue(null);
  const err = await loadProposal({ requestId: REQ }).catch((e) => e);
  expect(err).toBeInstanceOf(LoadProposalError);
  expect(err.httpStatus).toBe(404);
  expect(err.body).toBeUndefined();
  expect(err.message).toBe(`Request ${REQ} not found or missing request number.`);
});

test('404 with explicit { error, requestNumber, libraries } body when no files exist; per-bucket errors surfaced', async () => {
  getRequestSharePointBuckets.mockResolvedValue([
    { library: 'lib1', folder: 'F' },
    { library: 'lib2', folder: 'G' },
  ]);
  listFiles.mockImplementation(async (library) => {
    if (library === 'lib2') throw new Error('Graph 403');
    return [];
  });
  const err = await loadProposal({ requestId: REQ }).catch((e) => e);
  expect(err.httpStatus).toBe(404);
  expect(err.body).toEqual({
    error: 'No SharePoint files found for this request.',
    requestNumber: '1002836',
    libraries: [
      { library: 'lib1', folder: 'F', error: null },
      { library: 'lib2', folder: 'G', error: 'Graph 403' },
    ],
  });
});

test('400 with { error, allFiles } body when an explicit fileKey is not found', async () => {
  listFiles.mockResolvedValue([file('Narrative.pdf')]);
  const err = await loadProposal({ requestId: REQ, fileKey: 'nope::nope::nope' }).catch((e) => e);
  expect(err.httpStatus).toBe(400);
  expect(err.body.error).toBe("fileKey not found in this request's libraries: nope::nope::nope");
  expect(err.body.allFiles).toHaveLength(1);
});

test('404 with { error, allFiles } body when nothing classifies as a proposal', async () => {
  listFiles.mockResolvedValue([file('budget.xlsx')]);
  const err = await loadProposal({ requestId: REQ }).catch((e) => e);
  expect(err.httpStatus).toBe(404);
  expect(err.body.error).toBe('No proposal-classified file found. Pass fileKey to override.');
  expect(err.body.allFiles).toHaveLength(1);
});

test('best-guess tiers: project-narrative beats phase-II beats generic proposal; pdf beats docx', async () => {
  listFiles.mockResolvedValue([
    file('Generic Proposal.pdf'),
    file('Phase II Proposal.pdf'),
    file('Project Narrative.docx'),
    file('Project Narrative.pdf'),
  ]);
  const out = await loadProposal({ requestId: REQ });
  expect(out.picked).toBe('lib1::F::Project Narrative.pdf');
});

test('duplicate library::folder::name entries across buckets are deduped in allFiles', async () => {
  getRequestSharePointBuckets.mockResolvedValue([
    { library: 'lib1', folder: 'F' },
    { library: 'lib1', folder: 'F' },
  ]);
  listFiles.mockResolvedValue([file('Narrative.pdf')]);
  const out = await loadProposal({ requestId: REQ });
  expect(out.allFiles).toHaveLength(1);
});

test('golden path returns the exact payload and uploads with random suffix under reviewer-finder/<num>/', async () => {
  listFiles.mockResolvedValue([file('Narrative.pdf')]);
  const out = await loadProposal({ requestId: REQ });
  expect(out).toEqual({
    success: true,
    blobUrl: 'https://blob.example/x.pdf',
    filename: 'picked.pdf',
    contentType: 'application/pdf',
    size: 10,
    picked: 'lib1::F::Narrative.pdf',
    requestNumber: '1002836',
    allFiles: [expect.objectContaining({ name: 'Narrative.pdf', classification: 'proposal' })],
  });
  expect(put).toHaveBeenCalledWith(
    'reviewer-finder/1002836/Narrative.pdf',
    expect.any(Buffer),
    { access: 'public', contentType: 'application/pdf', addRandomSuffix: true },
  );
});

test('explicit fileKey override wins over the best-guess pick', async () => {
  listFiles.mockResolvedValue([file('Project Narrative.pdf'), file('other-proposal.docx')]);
  const out = await loadProposal({ requestId: REQ, fileKey: 'lib1::F::other-proposal.docx' });
  expect(out.picked).toBe('lib1::F::other-proposal.docx');
});

test('untyped failures (e.g. Blob upload) propagate for the shell 500 mapping', async () => {
  listFiles.mockResolvedValue([file('Narrative.pdf')]);
  put.mockRejectedValue(new Error('blob quota'));
  await expect(loadProposal({ requestId: REQ })).rejects.toThrow('blob quota');
});
