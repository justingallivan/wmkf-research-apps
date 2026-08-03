/**
 * Runtime pins for every named Reviewer Find warm negative-control seam.
 *
 * Each test enters the real AsyncLocalStorage scope and calls the real wrapped
 * boundary. Only the operation below that boundary is mocked, so removing a
 * wrapper disconnects the expected ledger event and fails this suite.
 */

jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));
jest.mock('@vercel/blob', () => ({ put: jest.fn(), get: jest.fn() }));
jest.mock('../../lib/utils/safe-fetch.js', () => ({ safeFetch: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({
  __esModule: true,
  getById: jest.fn(),
  SELECT_PROFILES: { IDENTITY: ['akoya_requestid', 'akoya_requestnum'] },
}));
jest.mock('../../lib/utils/sharepoint-buckets.js', () => ({
  getRequestSharePointBuckets: jest.fn(),
}));

const { sql } = require('@vercel/postgres');
const { put } = require('@vercel/blob');
const { safeFetch } = require('../../lib/utils/safe-fetch.js');
const grantRequestAdapter = require('../../lib/dataverse/adapters/grant-request.js');
const { getRequestSharePointBuckets } = require('../../lib/utils/sharepoint-buckets.js');
const {
  withReviewerFindWarmObservation,
} = require('../../lib/services/workbench/reviewer-find-warm-observation');
const { recordSurfaced } = require('../../lib/services/reviewer-roster-store');
const { _writeFetch } = require('../../lib/services/dynamics/write-core.js');
const { createEmailActivity, sendEmail } = require('../../lib/services/dynamics/email.js');
const { bypassDynamicsRestrictions } = require('../../lib/services/dynamics-context.js');
const { GraphService } = require('../../lib/services/graph-service.js');
const { readUploadedBlobBuffer } = require('../../lib/utils/uploaded-blob.js');
const { loadProposal } = require('../../lib/services/reviewer-finder/load-proposal-service.js');
const { LLMClient } = require('../../lib/services/llm-client.js');
const { PubMedService } = require('../../lib/services/pubmed-service.js');
const { DiscoveryService } = require('../../lib/services/discovery-service.js');
const { ContactEnrichmentService } = require('../../lib/services/contact-enrichment-service.js');
const { enqueueReviewerAcceptanceJob } = require('../../lib/services/reviewer-acceptance-job-service.js');
const { enqueueAutomaticReviewSynthesisJob } = require('../../lib/services/review-synthesis-job-service.js');

const OBSERVATION_ID = 'rfw_0123456789abcdef0123456789abcdef';
const REQUEST_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function response(body = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => Buffer.from('body'),
    headers: { get: () => null },
  };
}

async function observed(fn) {
  const info = jest.spyOn(console, 'info').mockImplementation(() => {});
  try {
    await withReviewerFindWarmObservation({
      observationId: OBSERVATION_ID,
      route: 'reviewer_roster',
      mode: 'cached',
    }, fn);
    return info.mock.calls
      .map(([message]) => JSON.parse(message))
      .filter((event) => event.event === 'effect')
      .map((event) => `${event.effectClass}:${event.operation}`);
  } finally {
    info.mockRestore();
  }
}

function expectEffect(events, effectClass, operation) {
  expect(events).toContain(`${effectClass}:${operation}`);
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn().mockResolvedValue(response());
  sql.mockResolvedValue({ rows: [{}], rowCount: 1 });
  safeFetch.mockResolvedValue(response());
  put.mockResolvedValue({ url: 'https://blob.example/proposal.pdf' });
  grantRequestAdapter.getById.mockResolvedValue({ akoya_requestid: REQUEST_ID, akoya_requestnum: '1002788' });
  getRequestSharePointBuckets.mockResolvedValue([{ library: 'akoya_request', folder: 'F', source: 'dynamics' }]);
  PubMedService.resetRequestGovernorForTests();
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('records the roster-store postgres-write wrapper', async () => {
  const events = await observed(() => recordSurfaced(REQUEST_ID, [{ name: 'Ada Lovelace', institution: 'Example' }]));
  expectEffect(events, 'postgres_write', 'reviewer_roster_write');
  expect(sql).toHaveBeenCalled();
});

test('records the real Dataverse write transport', async () => {
  const events = await observed(() => _writeFetch('https://example.test/write', { method: 'PATCH', headers: {} }, null));
  expectEffect(events, 'dataverse_write', 'dataverse_write_fetch');
  expect(global.fetch).toHaveBeenCalled();
});

test('records email creation and the SendEmail action through their real wrappers', async () => {
  const svc = {
    getAccessToken: jest.fn().mockResolvedValue('token'),
    resolveSystemUser: jest.fn().mockResolvedValue('sender-id'),
    resolveEntitySetName: jest.fn().mockResolvedValue('akoya_requests'),
    buildHeaders: jest.fn(() => ({ Authorization: 'Bearer token' })),
    _withCallerId: jest.fn((headers) => headers),
    _writeFetch: jest.fn()
      .mockResolvedValueOnce(response({ activityid: 'email-id' }))
      .mockResolvedValueOnce(response()),
  };
  const events = await observed(() => bypassDynamicsRestrictions('test-email-observation', async () => {
    await createEmailActivity(svc, { subject: 'x', body: 'x', from: 'from@example.org', to: 'to@example.org' });
    await sendEmail(svc, 'email-id');
  }));
  expectEffect(events, 'email', 'dataverse_email_create');
  expectEffect(events, 'dataverse_action', 'dataverse_send_email_action');
  expect(svc._writeFetch).toHaveBeenCalledTimes(2);
});

test('records the real Graph download wrapper', async () => {
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('graph-token');
  jest.spyOn(GraphService, 'buildHeaders').mockReturnValue({ Authorization: 'Bearer graph-token' });
  global.fetch
    .mockResolvedValueOnce(response({ name: 'proposal.pdf', size: 4, file: { mimeType: 'application/pdf' }, '@microsoft.graph.downloadUrl': 'https://download.example/file' }))
    .mockResolvedValueOnce(response());
  const events = await observed(() => GraphService.downloadFile('drive', 'item'));
  expectEffect(events, 'graph_download', 'graph_file_download');
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

test('records the real uploaded Blob reader wrapper', async () => {
  const events = await observed(() => readUploadedBlobBuffer({ url: 'https://safe.example/file.pdf' }));
  expectEffect(events, 'blob_read', 'uploaded_blob_read');
  expect(safeFetch).toHaveBeenCalled();
});

test('records proposal load and its Blob write through real service boundaries', async () => {
  jest.spyOn(GraphService, 'listFiles').mockResolvedValue([{
    name: 'Proposal_1002788.pdf', size: 4, mimeType: 'application/pdf', folder: 'F/Reviewer Materials',
  }]);
  jest.spyOn(GraphService, 'downloadFileByPath').mockResolvedValue({
    buffer: Buffer.from('pdf'), filename: 'Proposal_1002788.pdf', mimeType: 'application/pdf', size: 4,
  });
  const events = await observed(() => loadProposal({ requestId: REQUEST_ID }));
  expectEffect(events, 'proposal_load', 'reviewer_proposal_load');
  expectEffect(events, 'blob_write', 'reviewer_proposal_blob_put');
  expect(put).toHaveBeenCalled();
});

test('records the real Claude transport wrapper', async () => {
  safeFetch.mockResolvedValue(response({
    content: [{ type: 'text', text: 'ok' }], model: 'claude-haiku-4-5',
    usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn',
  }));
  const client = new LLMClient({ apiKey: 'test-key', model: 'claude-haiku-4-5' });
  const events = await observed(() => client.complete({ messages: [{ role: 'user', content: 'x' }] }));
  expectEffect(events, 'claude', 'claude_messages_request');
  expect(safeFetch).toHaveBeenCalled();
});

test('records the real PubMed request wrapper', async () => {
  const events = await observed(() => PubMedService.request('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi'));
  expectEffect(events, 'publication_provider', 'pubmed_request');
  expect(global.fetch).toHaveBeenCalled();
});

test('records the real coauthor COI wrapper around mocked PubMed work', async () => {
  jest.spyOn(PubMedService, 'search').mockResolvedValue([]);
  const events = await observed(() => DiscoveryService.checkCoauthorshipsForCandidates(
    [{ name: 'Reviewer Person' }], ['Proposal Author'], () => {},
  ));
  expectEffect(events, 'coi_provider', 'coauthor_coi_check');
  expect(PubMedService.search).toHaveBeenCalled();
});

test('records the real contact-enrichment wrapper around mocked candidate work', async () => {
  jest.spyOn(ContactEnrichmentService, 'enrichCandidate').mockResolvedValue({
    contactEnrichment: { tiersUsed: [], email: null, website: null, orcidId: null },
  });
  const events = await observed(() => ContactEnrichmentService.enrichCandidates([{ name: 'Reviewer Person' }]));
  expectEffect(events, 'contact_provider', 'contact_enrichment');
  expect(ContactEnrichmentService.enrichCandidate).toHaveBeenCalled();
});

test('records both named job enqueue wrappers', async () => {
  const events = await observed(async () => {
    await enqueueReviewerAcceptanceJob({
      acceptedAt: '2026-08-02T00:00:00.000Z',
      suggestion: { wmkf_appreviewersuggestionid: 'suggestion-id' },
    });
    await enqueueAutomaticReviewSynthesisJob({ requestId: REQUEST_ID, inputHash: 'a'.repeat(64) });
  });
  expectEffect(events, 'job_enqueue', 'reviewer_acceptance_job_enqueue');
  expectEffect(events, 'job_enqueue', 'review_synthesis_job_enqueue');
  expect(sql).toHaveBeenCalled();
});
