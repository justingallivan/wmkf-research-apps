/**
 * @jest-environment node
 */
jest.mock('../../lib/dataverse/adapters/request-document.js', () => ({ findByCycle: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({ findByIds: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/site-visit.js', () => ({ findActiveByRequests: jest.fn() }));
jest.mock('../../lib/services/pre-site-visit/distribution-store.js', () => ({ sentSourceDocumentIds: jest.fn() }));
jest.mock('../../lib/services/deliberation-stage-labels.js', () => ({ readDeliberationStageLabels: jest.fn() }));
jest.mock('../../lib/services/meeting-tracker/schedule-reader.js', () => ({ getDeliberationScheduleByRequests: jest.fn(async (ids) => new Map(ids.map((id) => [id, null]))) }));
jest.mock('../../lib/services/site-visit-materials/summary-reader.js', () => ({ getMaterialsSummaryByRequests: jest.fn(async ({ requestIds }) => new Map(requestIds.map((id) => [id, null]))) }));

import * as requestDocumentAdapter from '../../lib/dataverse/adapters/request-document.js';
import * as grantRequestAdapter from '../../lib/dataverse/adapters/grant-request.js';
import * as siteVisitAdapter from '../../lib/dataverse/adapters/site-visit.js';
import { sentSourceDocumentIds } from '../../lib/services/pre-site-visit/distribution-store.js';
import { readDeliberationStageLabels } from '../../lib/services/deliberation-stage-labels.js';
import { getDeliberationScheduleByRequests } from '../../lib/services/meeting-tracker/schedule-reader.js';
import { getMaterialsSummaryByRequests } from '../../lib/services/site-visit-materials/summary-reader.js';
import { listPreSiteVisitDrafts } from '../../lib/services/pre-site-visit/cycle-list-service';
import {
  PRE_RP_BRIEF_CONTRACT,
  PRE_SITE_VISIT_CONTRACT,
  PRE_SITE_DISTRIBUTION_CONTRACT,
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../shared/config/requestDocument';

const R1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const R2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const PD_A = 'bbbbbbbb-0000-4000-8000-0000000000aa';
const PD_B = 'bbbbbbbb-0000-4000-8000-0000000000bb';
const WORD = PRE_SITE_VISIT_CONTRACT.contentType;
const STAGE_LABELS = { draft: 'AI draft ready', shared: 'Shared', visit: 'Visit', final: 'Final' };

function row(overrides) {
  return {
    wmkf_requestdocumentid: 'doc',
    _wmkf_request_value: R1,
    wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT,
    wmkf_contenttype: WORD,
    wmkf_producer: PRE_SITE_VISIT_CONTRACT.producer,
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
    createdon: '2026-09-01T00:00:00Z',
    wmkf_sharepointitemid: 'item',
    wmkf_sharepointweburl: 'https://sp/doc.docx',
    wmkf_filename: 'doc.docx',
    ...overrides,
  };
}

function briefRow(overrides) {
  return {
    wmkf_requestdocumentid: 'brief-doc',
    _wmkf_request_value: R1,
    wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_RESEARCH_PRESENTATION_BRIEF,
    wmkf_contenttype: WORD,
    wmkf_producer: PRE_RP_BRIEF_CONTRACT.producer,
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
    createdon: '2026-09-01T00:00:00Z',
    wmkf_sharepointitemid: 'brief-item',
    wmkf_sharepointweburl: 'https://sp/brief.docx',
    wmkf_filename: 'brief.docx',
    ...overrides,
  };
}

// Splits a single findByCycle mock into brief/Pre-Site result sets keyed by
// the artifactType each call is made with, since the two artifact-type reads
// happen in parallel against the same mocked adapter function.
function mockByArtifactType({ preSite = [], brief = [] } = {}) {
  requestDocumentAdapter.findByCycle.mockImplementation(async (_code, { artifactType }) => ({
    records: artifactType === REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_RESEARCH_PRESENTATION_BRIEF ? brief : preSite,
  }));
}

function request(id, overrides = {}) {
  return {
    akoya_requestid: id,
    akoya_requestnum: id === R1 ? '1002959' : '1003001',
    akoya_title: 'Title',
    _akoya_applicantid_value_formatted: 'Uni',
    _wmkf_programdirector_value: PD_A,
    _wmkf_programdirector_value_formatted: 'PD',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  grantRequestAdapter.findByIds.mockImplementation(async (ids) => ({
    records: ids.map((id) => request(id, id === R1 ? { _wmkf_currentpresitevisit_value: 'CURRENT' } : {})),
  }));
  siteVisitAdapter.findActiveByRequests.mockResolvedValue([]);
  sentSourceDocumentIds.mockResolvedValue(new Set());
  readDeliberationStageLabels.mockResolvedValue(STAGE_LABELS);
});

it('rejects a malformed cycle code before any read', async () => {
  await expect(listPreSiteVisitDrafts({ cycleCode: 'december' })).rejects.toMatchObject({ httpStatus: 400 });
  expect(requestDocumentAdapter.findByCycle).not.toHaveBeenCalled();
});

it('lists one row per request: the pointer row when it resolves, else the newest active Word draft', async () => {
  requestDocumentAdapter.findByCycle.mockResolvedValue({ records: [
    row({ wmkf_requestdocumentid: 'newer', createdon: '2026-09-05T00:00:00Z', wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.FAILED }),
    row({ wmkf_requestdocumentid: 'current', wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW }),
    row({ wmkf_requestdocumentid: 'old', createdon: '2026-08-01T00:00:00Z', wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED }),
    row({ wmkf_requestdocumentid: 'r2-fail', _wmkf_request_value: R2, wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.FAILED, wmkf_sharepointitemid: null }),
    row({ wmkf_requestdocumentid: 'r2-older', _wmkf_request_value: R2, createdon: '2026-08-20T00:00:00Z', wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING, wmkf_sharepointitemid: null }),
  ] });

  const result = await listPreSiteVisitDrafts({ cycleCode: 'd26' });

  expect(requestDocumentAdapter.findByCycle).toHaveBeenCalledWith('D26', { artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT });
  expect(result.cycleCode).toBe('D26');
  expect(result.scope).toBe('all');
  expect(result.stageLabels).toEqual(STAGE_LABELS);
  expect(result.artifacts).toHaveLength(2);
  const [first, second] = result.artifacts;
  expect(first).toMatchObject({ artifactId: 'current', requestNumber: '1002959', isCurrent: true, lifecycleLabel: 'Review', operationLabel: 'Ready', institution: 'Uni', programDirector: 'PD', stage: 'shared', substate: 'not-sent' });
  expect(first.file).toMatchObject({ webUrl: 'https://sp/doc.docx', name: 'doc.docx', metadataStatus: 'unchecked' });
  expect(second).toMatchObject({ artifactId: 'r2-fail', requestNumber: '1003001', isCurrent: false, operationLabel: 'Failed', file: null, stage: 'draft' });
  expect(result.counts).toEqual({ draft: 1, shared: 1, visit: 0, final: 0 });
});

it('drops distribution snapshots and non-Word rows, and returns an empty list when nothing remains', async () => {
  requestDocumentAdapter.findByCycle.mockResolvedValue({ records: [
    row({ wmkf_producer: `${PRE_SITE_DISTRIBUTION_CONTRACT.producerPrefix}-pdf`, wmkf_contenttype: 'application/pdf' }),
    row({ wmkf_producer: `${PRE_SITE_DISTRIBUTION_CONTRACT.producerPrefix}-docx` }),
  ] });
  const result = await listPreSiteVisitDrafts({ cycleCode: 'D26' });
  expect(result.artifacts).toEqual([]);
  expect(grantRequestAdapter.findByIds).not.toHaveBeenCalled();
});

it('fails loud when a draft row has no resolvable owner request', async () => {
  requestDocumentAdapter.findByCycle.mockResolvedValue({ records: [row()] });
  grantRequestAdapter.findByIds.mockResolvedValue({ records: [] });
  await expect(listPreSiteVisitDrafts({ cycleCode: 'D26' })).rejects.toMatchObject({ httpStatus: 500 });
});

describe('scope filtering (D4 org-open posture, my/all)', () => {
  beforeEach(() => {
    requestDocumentAdapter.findByCycle.mockResolvedValue({ records: [
      row({ wmkf_requestdocumentid: 'r1-doc', _wmkf_request_value: R1 }),
      row({ wmkf_requestdocumentid: 'r2-doc', _wmkf_request_value: R2 }),
    ] });
    grantRequestAdapter.findByIds.mockImplementation(async (ids) => ({
      records: ids.map((id) => request(id, {
        _wmkf_programdirector_value: id === R1 ? PD_A : PD_B,
        _wmkf_currentpresitevisit_value: null,
      })),
    }));
  });

  it('scope=all returns both PDs\' rows', async () => {
    const result = await listPreSiteVisitDrafts({ cycleCode: 'D26', scope: 'all' });
    expect(result.artifacts.map((a) => a.requestId).sort()).toEqual([R1, R2].sort());
  });

  it('scope=my filters to the caller\'s own program-director rows (case-insensitive)', async () => {
    const result = await listPreSiteVisitDrafts({ cycleCode: 'D26', scope: 'my', callerSystemId: PD_A.toUpperCase() });
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0].requestId).toBe(R1);
  });

  it('scope=my with no caller id fails closed to an empty list without reading the registry', async () => {
    const result = await listPreSiteVisitDrafts({ cycleCode: 'D26', scope: 'my', callerSystemId: null });
    expect(result.artifacts).toEqual([]);
    expect(result.counts).toEqual({ draft: 0, shared: 0, visit: 0, final: 0 });
    expect(requestDocumentAdapter.findByCycle).not.toHaveBeenCalled();
  });
});

describe('site visit join', () => {
  beforeEach(() => {
    requestDocumentAdapter.findByCycle.mockResolvedValue({ records: [
      row({ wmkf_requestdocumentid: 'r1-doc', _wmkf_request_value: R1, wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW }),
      row({ wmkf_requestdocumentid: 'r2-doc', _wmkf_request_value: R2, wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW }),
    ] });
    grantRequestAdapter.findByIds.mockImplementation(async (ids) => ({
      records: ids.map((id) => request(id, { _wmkf_currentpresitevisit_value: null })),
    }));
  });

  it('a past visit moves the request to the visit stage; a future visit keeps it shared', async () => {
    siteVisitAdapter.findActiveByRequests.mockResolvedValue([
      { _regardingobjectid_value: R1, scheduledstart: '2020-01-01T00:00:00Z', scheduledend: null },
      { _regardingobjectid_value: R2, scheduledstart: '2099-01-01T00:00:00Z', scheduledend: null },
    ]);
    const result = await listPreSiteVisitDrafts({ cycleCode: 'D26' });
    const byRequest = Object.fromEntries(result.artifacts.map((a) => [a.requestId, a]));
    expect(byRequest[R1]).toMatchObject({ stage: 'visit', substate: 'awaiting-observations' });
    // Only startIso/endIso — the Wave-21-gated logistics fields (format,
    // locationOrLink) are never selected on this multi-request read.
    expect(byRequest[R1].siteVisit).toEqual({ startIso: '2020-01-01T00:00:00Z', endIso: null });
    expect(byRequest[R2]).toMatchObject({ stage: 'shared', substate: 'not-sent' });
    expect(byRequest[R2].visit).toMatchObject({ status: 'scheduled' });
  });

  it('does not select or project the Wave-21-gated logistics fields', async () => {
    siteVisitAdapter.findActiveByRequests.mockResolvedValue([
      { _regardingobjectid_value: R1, scheduledstart: '2020-01-01T00:00:00Z', scheduledend: '2020-01-01T02:00:00Z' },
    ]);
    const result = await listPreSiteVisitDrafts({ cycleCode: 'D26' });
    expect(result.artifacts[0].siteVisit).not.toHaveProperty('format');
    expect(result.artifacts[0].siteVisit).not.toHaveProperty('locationOrLink');
  });
});

describe('everSent join', () => {
  it('marks a shared, sent document as substate sent', async () => {
    requestDocumentAdapter.findByCycle.mockResolvedValue({ records: [
      row({ wmkf_requestdocumentid: 'r1-doc', _wmkf_request_value: R1, wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW }),
    ] });
    grantRequestAdapter.findByIds.mockResolvedValue({ records: [request(R1, { _wmkf_currentpresitevisit_value: null })] });
    sentSourceDocumentIds.mockResolvedValue(new Set(['r1-doc']));
    const result = await listPreSiteVisitDrafts({ cycleCode: 'D26' });
    expect(result.artifacts[0]).toMatchObject({ everSent: true, stage: 'shared', substate: 'sent' });
  });

  it('matches the sent-document GUID case-insensitively', async () => {
    requestDocumentAdapter.findByCycle.mockResolvedValue({ records: [
      row({ wmkf_requestdocumentid: 'R1-DOC', _wmkf_request_value: R1, wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW }),
    ] });
    grantRequestAdapter.findByIds.mockResolvedValue({ records: [request(R1, { _wmkf_currentpresitevisit_value: null })] });
    // The Postgres-side helper lowercases what it stores; simulate that here
    // rather than assuming the caller already matches case.
    sentSourceDocumentIds.mockResolvedValue(new Set(['r1-doc']));
    const result = await listPreSiteVisitDrafts({ cycleCode: 'D26' });
    expect(result.artifacts[0]).toMatchObject({ everSent: true, substate: 'sent' });
  });

  it('M5: everSent is keyed to the selected source id — a sent id belonging to a different row reads false', async () => {
    // Discriminating: replacing the per-document `sentIds.has(id)` check with
    // `sentIds.size > 0` would make every row read everSent: true as soon as
    // ANY document in the cycle had been sent, even one belonging to another
    // request entirely.
    requestDocumentAdapter.findByCycle.mockResolvedValue({ records: [
      row({ wmkf_requestdocumentid: 'r1-doc', _wmkf_request_value: R1, wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW }),
      row({ wmkf_requestdocumentid: 'r2-doc', _wmkf_request_value: R2, wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW }),
    ] });
    grantRequestAdapter.findByIds.mockResolvedValue({ records: [
      request(R1, { _wmkf_currentpresitevisit_value: null }),
      request(R2, { _wmkf_currentpresitevisit_value: null }),
    ] });
    // Only r2-doc was ever sent.
    sentSourceDocumentIds.mockResolvedValue(new Set(['r2-doc']));
    const result = await listPreSiteVisitDrafts({ cycleCode: 'D26' });
    const byRequest = Object.fromEntries(result.artifacts.map((a) => [a.requestId, a]));
    expect(byRequest[R1]).toMatchObject({ everSent: false, substate: 'not-sent' });
    expect(byRequest[R2]).toMatchObject({ everSent: true, substate: 'sent' });
  });
});

describe('projected row shape', () => {
  it('does not include programDirectorId (nothing consumes it)', async () => {
    requestDocumentAdapter.findByCycle.mockResolvedValue({ records: [row()] });
    const result = await listPreSiteVisitDrafts({ cycleCode: 'D26' });
    expect(result.artifacts[0]).not.toHaveProperty('programDirectorId');
  });
});

describe('counts', () => {
  it('tallies artifacts by stage', async () => {
    requestDocumentAdapter.findByCycle.mockResolvedValue({ records: [
      row({ wmkf_requestdocumentid: 'd1', _wmkf_request_value: R1, wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT }),
      row({ wmkf_requestdocumentid: 'd2', _wmkf_request_value: R2, wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL }),
    ] });
    grantRequestAdapter.findByIds.mockImplementation(async (ids) => ({
      records: ids.map((id) => request(id, { _wmkf_currentpresitevisit_value: null })),
    }));
    const result = await listPreSiteVisitDrafts({ cycleCode: 'D26' });
    expect(result.counts).toEqual({ draft: 1, shared: 0, visit: 0, final: 1 });
  });
});

it('joins the tracker schedule once per list (batched by request id) and projects the card-shaped session, null where nothing is scheduled', async () => {
  requestDocumentAdapter.findByCycle.mockResolvedValue({ records: [
    row({ wmkf_requestdocumentid: 'current', wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW, wmkf_milestonecreatedat: '2026-09-10T16:03:28Z' }),
    row({ wmkf_requestdocumentid: 'r2', _wmkf_request_value: R2 }),
  ] });
  getDeliberationScheduleByRequests.mockImplementationOnce(async (ids) => new Map(ids.map((id) => [id, id === R1 ? {
    sessionId: 's-1', scheduledStartIso: '2026-12-01T18:00:00Z', scheduledEndIso: '2026-12-01T18:30:00Z',
    ianaTimeZone: 'America/Los_Angeles', meetingLink: 'https://zoom.example/j/1', location: '', order: 1, minutes: 30,
    attendees: [{ name: 'A', email: 'a@example.org' }],
  } : null])));

  const result = await listPreSiteVisitDrafts({ cycleCode: 'D26' });

  expect(getDeliberationScheduleByRequests).toHaveBeenCalledTimes(1);
  expect(getDeliberationScheduleByRequests.mock.calls[0][0].sort()).toEqual([R1, R2].sort());
  const [first, second] = result.artifacts;
  expect(first.session).toEqual({
    scheduledStartIso: '2026-12-01T18:00:00Z', scheduledEndIso: '2026-12-01T18:30:00Z',
    ianaTimeZone: 'America/Los_Angeles', meetingLink: 'https://zoom.example/j/1', location: null,
  });
  expect(first.session).not.toHaveProperty('attendees');
  expect(first.sharedAtIso).toBe('2026-09-10T16:03:28Z');
  expect(second.session).toBeNull();
});

it('a schedule-reader failure leaves every session null instead of failing the list', async () => {
  requestDocumentAdapter.findByCycle.mockResolvedValue({ records: [row()] });
  getDeliberationScheduleByRequests.mockRejectedValueOnce(new Error('tracker down'));
  const result = await listPreSiteVisitDrafts({ cycleCode: 'D26' });
  expect(result.artifacts).toHaveLength(1);
  expect(result.artifacts[0].session).toBeNull();
});

it('joins the applicant-materials summary per request through the cycle read (request numbers supplied); null when absent or when the reader fails', async () => {
  const summary = { state: 'missing', receivedCount: 2, requiredCount: 3, otherCount: 0, dueAt: '2026-10-05T19:00:00.000Z', closesAt: '2026-10-14T19:00:00.000Z', overdue: true, invited: true };
  getMaterialsSummaryByRequests.mockImplementationOnce(async ({ requestIds }) => new Map(requestIds.map((id) => [id, id === R1 ? summary : null])));
  requestDocumentAdapter.findByCycle.mockResolvedValue({ records: [
    row({ wmkf_requestdocumentid: 'current', wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW }),
    row({ wmkf_requestdocumentid: 'r2', _wmkf_request_value: R2 }),
  ] });
  const result = await listPreSiteVisitDrafts({ cycleCode: 'D26' });
  expect(getMaterialsSummaryByRequests).toHaveBeenCalledWith({
    requestIds: expect.arrayContaining([R1, R2]),
    requestNumbers: new Map([[R1, '1002959'], [R2, '1003001']]),
    cycleCode: 'D26',
  });
  expect(result.artifacts.find((a) => a.requestId === R1).materials).toEqual(summary);
  expect(result.artifacts.find((a) => a.requestId === R2).materials).toBeNull();

  getMaterialsSummaryByRequests.mockRejectedValueOnce(new Error('pg down'));
  const degraded = await listPreSiteVisitDrafts({ cycleCode: 'D26' });
  expect(degraded.artifacts.map((a) => a.materials)).toEqual([null, null]);
});

// docs/plans/PRE_RESEARCH_PRESENTATION_BRIEF_PLAN_2026-09-16.md §3.5: the
// cycle list unions the brief and Pre-Site artifact-type reads and picks a
// per-request stage source, preferring the brief.
describe('brief union (plan §3.5)', () => {
  beforeEach(() => {
    grantRequestAdapter.findByIds.mockImplementation(async (ids) => ({
      records: ids.map((id) => request(id, {
        _wmkf_currentpresitevisit_value: null,
        _wmkf_currentprerpbrief_value: null,
      })),
    }));
  });

  it('brief-only Draft: a request with no Pre-Site rows at all is still listed', async () => {
    grantRequestAdapter.findByIds.mockResolvedValue({
      records: [request(R1, { _wmkf_currentpresitevisit_value: null, _wmkf_currentprerpbrief_value: 'brief-doc' })],
    });
    mockByArtifactType({ preSite: [], brief: [briefRow()] });
    const result = await listPreSiteVisitDrafts({ cycleCode: 'D26' });
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]).toMatchObject({
      artifactId: 'brief-doc', requestId: R1, stage: 'draft', substate: 'ready', isCurrent: true,
    });
  });

  it('brief-only Review, sent: the brief pointer resolves and everSent is keyed to the brief id', async () => {
    grantRequestAdapter.findByIds.mockResolvedValue({
      records: [request(R1, { _wmkf_currentpresitevisit_value: null, _wmkf_currentprerpbrief_value: 'brief-doc' })],
    });
    mockByArtifactType({
      preSite: [],
      brief: [briefRow({ wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW })],
    });
    sentSourceDocumentIds.mockResolvedValue(new Set(['brief-doc']));
    const result = await listPreSiteVisitDrafts({ cycleCode: 'D26' });
    expect(result.artifacts[0]).toMatchObject({
      artifactId: 'brief-doc', isCurrent: true, stage: 'shared', substate: 'sent', everSent: true,
    });
    expect(sentSourceDocumentIds).toHaveBeenCalledWith(['brief-doc']);
  });

  it('generating/failed brief before any pointer exists: newest non-Ready brief wins', async () => {
    mockByArtifactType({
      preSite: [],
      brief: [
        briefRow({
          wmkf_requestdocumentid: 'brief-failed',
          createdon: '2026-09-01T00:00:00Z',
          wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.FAILED,
          wmkf_sharepointitemid: null,
        }),
        briefRow({
          wmkf_requestdocumentid: 'brief-generating',
          createdon: '2026-09-05T00:00:00Z',
          wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING,
          wmkf_sharepointitemid: null,
        }),
      ],
    });
    const result = await listPreSiteVisitDrafts({ cycleCode: 'D26' });
    // No pointer and no orphaned Ready row: the newest non-Ready/non-superseded
    // row is the pending stage source per §3.5.
    expect(result.artifacts[0]).toMatchObject({ artifactId: 'brief-generating', stage: 'draft', substate: 'generating' });
  });

  it('invalid/missing brief pointer with a Ready brief: reconciliation row, never the Ready row picked by recency', async () => {
    mockByArtifactType({
      preSite: [],
      brief: [briefRow({ wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY })],
    });
    const result = await listPreSiteVisitDrafts({ cycleCode: 'D26' });
    expect(result.artifacts[0]).toMatchObject({
      artifactId: 'brief-doc', needsReconciliation: true, stage: 'beyond', substate: 'pointer-invalid',
    });

    // A pointer that is set but does not resolve among the brief rows is the
    // same fault, not a silent fallback to the newest Ready row.
    grantRequestAdapter.findByIds.mockResolvedValue({
      records: [request(R1, { _wmkf_currentpresitevisit_value: null, _wmkf_currentprerpbrief_value: 'missing-id' })],
    });
    const withBadPointer = await listPreSiteVisitDrafts({ cycleCode: 'D26' });
    expect(withBadPointer.artifacts[0]).toMatchObject({ needsReconciliation: true, stage: 'beyond', substate: 'pointer-invalid' });
  });

  it('legacy Pre-Site, no brief: unchanged pointer-or-newest derivation', async () => {
    mockByArtifactType({
      preSite: [row({ wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW })],
      brief: [],
    });
    const result = await listPreSiteVisitDrafts({ cycleCode: 'D26' });
    expect(result.artifacts[0]).toMatchObject({ artifactId: 'doc', stage: 'shared', needsReconciliation: false });
  });

  it('Final started while the brief stays Review: finalReached comes from the Pre-Site row, not the brief', async () => {
    grantRequestAdapter.findByIds.mockResolvedValue({
      records: [request(R1, { _wmkf_currentpresitevisit_value: 'presite-final', _wmkf_currentprerpbrief_value: 'brief-doc' })],
    });
    mockByArtifactType({
      preSite: [row({
        wmkf_requestdocumentid: 'presite-final',
        wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL,
        wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
      })],
      brief: [briefRow({ wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW })],
    });
    const result = await listPreSiteVisitDrafts({ cycleCode: 'D26' });
    // The brief stays the stage source (Review lifecycle), but finalReached
    // from the Pre-Site row wins per §3.5.
    expect(result.artifacts[0]).toMatchObject({ artifactId: 'brief-doc', stage: 'final', substate: 'moved' });
  });

  it('a FINAL Pre-Site pointer remains the finalReached source when a newer failed Pre-Site row exists', async () => {
    grantRequestAdapter.findByIds.mockResolvedValue({
      records: [request(R1, { _wmkf_currentpresitevisit_value: 'presite-final', _wmkf_currentprerpbrief_value: 'brief-doc' })],
    });
    mockByArtifactType({
      preSite: [
        row({
          wmkf_requestdocumentid: 'presite-failed-newer',
          createdon: '2026-09-16T12:00:00Z',
          wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.FAILED,
          wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
          wmkf_sharepointitemid: null,
        }),
        row({
          wmkf_requestdocumentid: 'presite-final',
          createdon: '2026-09-10T12:00:00Z',
          wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
          wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL,
        }),
      ],
      brief: [briefRow({ wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW })],
    });

    const result = await listPreSiteVisitDrafts({ cycleCode: 'D26' });

    expect(result.artifacts[0]).toMatchObject({
      artifactId: 'brief-doc',
      stage: 'final',
      substate: 'moved',
    });
  });

  it('both rails present: the brief pointer wins over the legacy Pre-Site row', async () => {
    grantRequestAdapter.findByIds.mockResolvedValue({
      records: [request(R1, { _wmkf_currentpresitevisit_value: 'presite-doc', _wmkf_currentprerpbrief_value: 'brief-doc' })],
    });
    mockByArtifactType({
      preSite: [row({ wmkf_requestdocumentid: 'presite-doc', wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW })],
      brief: [briefRow()],
    });
    const result = await listPreSiteVisitDrafts({ cycleCode: 'D26' });
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]).toMatchObject({ artifactId: 'brief-doc', isCurrent: true, stage: 'draft' });
  });
});
