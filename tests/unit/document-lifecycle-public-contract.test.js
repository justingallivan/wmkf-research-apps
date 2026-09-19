/** @jest-environment node */

jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn(), getUserRole: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: jest.fn((_label, fn) => fn()) }));
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({ getById: jest.fn(), findByIds: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/request-document.js', () => ({
  findByRequest: jest.fn(), findByGenerationKey: jest.fn(), create: jest.fn(), update: jest.fn(),
}));
jest.mock('../../lib/dataverse/core/changeset.js', () => ({ runChangeset: jest.fn() }));
jest.mock('../../lib/services/graph-service.js', () => ({ GraphService: {
  getFileMetadataById: jest.fn(), uploadFile: jest.fn(), deleteFile: jest.fn(), downloadFile: jest.fn(),
} }));
jest.mock('../../lib/services/execute-prompt.js', () => ({ executePrompt: jest.fn() }));
jest.mock('../../lib/utils/final-writeup-readiness.js', () => ({ isFinalWriteupSchemaReady: jest.fn(() => true) }));
jest.mock('../../lib/utils/deliberation-briefing-readiness.js', () => ({ isDeliberationBriefingSchemaReady: jest.fn(() => false) }));
jest.mock('../../lib/services/settings-service.js', () => ({ getSettingStrict: jest.fn(async () => ({ found: false })) }));
jest.mock('../../lib/services/deliberation-stage-labels', () => ({ readDeliberationStageLabels: jest.fn(async () => ({})) }));
jest.mock('../../lib/services/deliberation-briefing/session-reader', () => ({ getDeliberationSessionForRequest: jest.fn(async () => null) }));
jest.mock('../../lib/services/site-visit-materials/summary-reader', () => ({ getMaterialsSummaryForRequest: jest.fn(async () => null) }));
jest.mock('../../lib/services/pre-site-visit/distribution-store.js', () => ({
  listDistributionAttempts: jest.fn(), hasSentAttemptForSource: jest.fn(),
}));

import { requireAppAccess, getUserRole } from '../../lib/utils/auth';
import * as requestAdapter from '../../lib/dataverse/adapters/grant-request.js';
import * as documentAdapter from '../../lib/dataverse/adapters/request-document.js';
import { runChangeset } from '../../lib/dataverse/core/changeset.js';
import { GraphService } from '../../lib/services/graph-service.js';
import { executePrompt } from '../../lib/services/execute-prompt.js';
import { listDistributionAttempts } from '../../lib/services/pre-site-visit/distribution-store.js';
import initialAssessmentRoute from '../../pages/api/workbench/initial-assessment';
import preSiteRoute from '../../pages/api/workbench/pre-site-visit';
import finalRoute from '../../pages/api/workbench/final-writeup';
import historyRoute from '../../pages/api/workbench/pre-site-visit/distribution/history';
import {
  PRE_SITE_VISIT_CONTRACT,
  REQUEST_DOCUMENT_ARTIFACT_TYPE as TYPE,
  REQUEST_DOCUMENT_OPERATION_STATUS as STATUS,
  REQUEST_DOCUMENT_LIFECYCLE_STATE as LIFE,
} from '../../shared/config/requestDocument';

import * as initialAssessment from '../../lib/services/initial-assessment/artifact-service.js';
import * as preSiteArtifact from '../../lib/services/pre-site-visit/artifact-service.js';
import * as distribution from '../../lib/services/pre-site-visit/distribution-service.js';
import * as finalWriteup from '../../lib/services/final-writeup/transition-service.js';
import { ServiceHttpError } from '../../lib/services/service-http-error.js';

// Keep this boundary test on service behavior: the distribution facade's
// optional briefing-link dependency pulls the browser build of jose, which is
// intentionally outside Jest's CommonJS transform set.
jest.mock('../../lib/services/deliberation-briefing/briefing-link-service', () => ({
  ensureLiveBriefingLink: jest.fn(),
  getLiveBriefingLink: jest.fn(),
}));

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';

describe('governed document lifecycle public boundaries (Stage 0)', () => {
  test('preserves the four facade export surfaces before extraction', () => {
    expect(Object.keys(initialAssessment).sort()).toEqual([
      'buildInitialAssessmentIdentity',
      'commitReadyLineage',
      'generateInitialAssessment',
      'hashGovernedDocxContent',
      'listInitialAssessmentArtifactVersions',
      'listInitialAssessmentArtifacts',
      'listInitialAssessmentCycles',
      'projectArtifact',
      'resolveCanonicalInitialAssessment',
      'validateGenerated',
    ]);
    expect(Object.keys(preSiteArtifact).sort()).toEqual([
      'SECTION_FIELDS',
      'buildPreSiteVisitIdentity',
      'buildPreSiteVisitInputSnapshot',
      'generatePreSiteVisitArtifact',
      'getPreSiteVisitArtifactStatus',
      'projectPreSiteVisitArtifact',
      'projectReopenHistory',
      'validateNarrativePrompt',
      'validateTemplateContract',
    ]);
    expect(Object.keys(distribution).sort()).toEqual([
      'BRIEFING_LINK_PLACEHOLDER',
      'PRE_SITE_DISTRIBUTION_TEMPLATE_VERSION',
      'REVIEW_BUNDLE_LINK_PLACEHOLDER',
      'distributionBodyHtml',
      'getPreSiteDistributionHistory',
      'normalizeDistributionRecipients',
      'preparePreSiteDistribution',
      'projectDistributionAttempt',
      'readDeliberationShareDefaults',
      'renderBriefingBody',
      'retainReviewBundle',
      'reviewBundleDocumentUrl',
      'sendPreSiteDistribution',
      'sessionLineText',
      'sessionSnapshotOf',
      'sessionSnapshotsMatch',
    ]);
    expect(Object.keys(finalWriteup).sort()).toEqual([
      'advanceToLeadershipReview',
      'buildFinalWriteupGenerationKey',
      'getFinalWriteupStatus',
      'projectFinalWriteupArtifact',
      'startFinalWriteup',
    ]);
  });

  test('real Pre-Site status service honors an explicit dependency seam', async () => {
    const getRequest = jest.fn(async () => ({ akoya_requestid: REQUEST_ID }));
    const findByRequest = jest.fn(async () => ({ records: [] }));

    const result = await preSiteArtifact.getPreSiteVisitArtifactStatus(
      { requestId: REQUEST_ID },
      { schemaReady: jest.fn(() => true), getRequest, findByRequest },
    );

    expect(result).toEqual({
      currentArtifact: null,
      pendingArtifact: null,
      reopenHistory: [],
    });
    expect(getRequest).toHaveBeenCalledWith(REQUEST_ID);
    expect(findByRequest).toHaveBeenCalledWith(REQUEST_ID, expect.objectContaining({ artifactType: expect.anything() }));
  });

  test('real Final status service honors an explicit schema-readiness override', async () => {
    const schemaReady = jest.fn(() => false);
    const result = await finalWriteup.getFinalWriteupStatus(
      { requestId: REQUEST_ID },
      { schemaReady },
    );

    expect(result).toEqual({
      available: false,
      phase: 'unavailable',
      canStart: false,
      canAdvance: false,
      artifact: null,
    });
    expect(schemaReady).toHaveBeenCalledTimes(1);
  });

  test('real distribution defaults service preserves injected settings and projection shape', async () => {
    const getSettingStrict = jest.fn(async (key) => ({
      found: key.endsWith('.subject'),
      value: key.endsWith('.subject') ? 'Configured subject' : null,
    }));
    const result = await distribution.readDeliberationShareDefaults({ getSettingStrict });

    expect(result).toMatchObject({
      subjectTemplate: 'Configured subject',
      bodyTemplate: expect.any(String),
      briefingCopy: expect.objectContaining({
        heading: expect.any(String),
        linkText: expect.any(String),
      }),
    });
    expect(getSettingStrict).toHaveBeenCalled();
  });

  test('public validation failures retain ServiceHttpError identity', async () => {
    expect(() => distribution.normalizeDistributionRecipients('', '')).toThrow(ServiceHttpError);
    await expect(
      initialAssessment.listInitialAssessmentArtifacts({ requestId: REQUEST_ID, cycleCode: 'A01' }),
    ).rejects.toBeInstanceOf(ServiceHttpError);
    await expect(
      preSiteArtifact.getPreSiteVisitArtifactStatus({ requestId: 'not-a-guid' }, {}),
    ).rejects.toBeInstanceOf(ServiceHttpError);
  });
});

const ARTIFACT_ID = '22222222-2222-4222-8222-222222222222';
const ACTOR_ID = '33333333-3333-4333-8333-333333333333';

function response() {
  const res = { statusCode: 200, body: null };
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  res.setHeader = jest.fn();
  return res;
}

function registryRow(overrides = {}) {
  return {
    wmkf_requestdocumentid: ARTIFACT_ID,
    _wmkf_request_value: REQUEST_ID,
    wmkf_artifacttype: TYPE.PRE_SITE_VISIT,
    wmkf_operationstatus: STATUS.READY,
    wmkf_lifecyclestate: LIFE.REVIEW,
    wmkf_contenttype: PRE_SITE_VISIT_CONTRACT.contentType,
    wmkf_sharepointdriveid: 'fixture-drive',
    wmkf_sharepointitemid: 'fixture-item',
    wmkf_sharepointweburl: 'https://sharepoint.test/document',
    wmkf_filename: 'Fixture.docx',
    _etag: 'W/"1"',
    ...overrides,
  };
}

describe('real routes compose default services and nonempty projections', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    requireAppAccess.mockResolvedValue({ profileId: ACTOR_ID, session: { user: { dynamicsSystemuserId: ACTOR_ID } } });
    getUserRole.mockResolvedValue('staff');
    requestAdapter.getById.mockResolvedValue({ akoya_requestid: REQUEST_ID });
    documentAdapter.findByRequest.mockResolvedValue({ records: [] });
  });

  afterEach(() => {
    for (const write of [documentAdapter.create, documentAdapter.update, runChangeset,
      GraphService.uploadFile, GraphService.deleteFile, executePrompt]) {
      expect(write).not.toHaveBeenCalled();
    }
  });

  test('IA GET projects an adapter row through the real default reader', async () => {
    documentAdapter.findByRequest.mockResolvedValue({ records: [registryRow({
      wmkf_artifacttype: TYPE.INITIAL_ASSESSMENT,
      wmkf_operationstatus: STATUS.FAILED,
      wmkf_lifecyclestate: LIFE.DRAFT,
      wmkf_sharepointitemid: null,
      wmkf_cyclecode: 'D26',
    })] });
    requestAdapter.findByIds.mockResolvedValue({ records: [{ akoya_requestid: REQUEST_ID, akoya_requestnum: 'TEST-REQUEST' }] });
    const res = response();
    await initialAssessmentRoute({ method: 'GET', query: { requestId: REQUEST_ID } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, artifacts: [{ artifactId: ARTIFACT_ID, requestNumber: 'TEST-REQUEST', retryable: true }], latestAttempts: [], milestones: [] });
    expect(documentAdapter.findByRequest).toHaveBeenCalledWith(REQUEST_ID, { artifactType: TYPE.INITIAL_ASSESSMENT });
    expect(requestAdapter.findByIds).toHaveBeenCalledWith([REQUEST_ID], expect.objectContaining({ top: 1 }));
  });

  test('Pre-Site GET uses defaults and removes a present correction from staff output', async () => {
    requestAdapter.getById.mockResolvedValue({ akoya_requestid: REQUEST_ID, _wmkf_currentpresitevisit_value: ARTIFACT_ID });
    documentAdapter.findByRequest.mockResolvedValue({ records: [registryRow({ wmkf_reopenreasoncode: 'fixture_reason' })] });
    const res = response();
    await preSiteRoute({ method: 'GET', query: { requestId: REQUEST_ID } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, currentArtifact: { artifactId: ARTIFACT_ID, file: { itemId: 'fixture-item' } }, pendingArtifact: null });
    expect(res.body.currentArtifact).not.toHaveProperty('correction');
    expect(res.body).not.toHaveProperty('reopenHistory');
    expect(documentAdapter.findByRequest).toHaveBeenCalledWith(REQUEST_ID, { artifactType: TYPE.PRE_SITE_VISIT });
  });

  test('Final GET resolves session authorization and projects a pending row through defaults', async () => {
    const pendingId = '44444444-4444-4444-8444-444444444444';
    requestAdapter.getById.mockResolvedValue({ akoya_requestid: REQUEST_ID, _wmkf_currentpresitevisit_value: ARTIFACT_ID, _wmkf_programdirector_value: ACTOR_ID });
    documentAdapter.findByRequest.mockResolvedValue({ records: [registryRow(), registryRow({
      wmkf_requestdocumentid: pendingId, wmkf_artifacttype: TYPE.FINAL_WRITEUP,
      _wmkf_sourcedocument_value: ARTIFACT_ID, wmkf_operationstatus: STATUS.FAILED,
      wmkf_lifecyclestate: LIFE.DRAFT,
    })] });
    const res = response();
    await finalRoute({ method: 'GET', query: { requestId: REQUEST_ID } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, available: true, phase: 'ready', canStart: true,
      sourceArtifactId: ARTIFACT_ID, pendingArtifact: { artifactId: pendingId, sourceArtifactId: ARTIFACT_ID } });
    expect(documentAdapter.findByRequest).toHaveBeenCalledWith(REQUEST_ID);
    expect(getUserRole).toHaveBeenCalledWith(ACTOR_ID);
  });

  test('distribution history GET trims query and projects a legacy sent ledger row', async () => {
    listDistributionAttempts.mockResolvedValue([{
      operation_id: ARTIFACT_ID, request_id: REQUEST_ID, state: 'sent',
      attachment_mode: 'both', to_recipients: JSON.stringify(['fixture@example.test']),
      cc_recipients: '[]', material_links: '[]', attempt_count: 2,
    }]);
    const res = response();
    await historyRoute({ method: 'GET', query: { requestId: ` ${REQUEST_ID} ` }, body: { ignored: true } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, currentSourceEverSent: false,
      attempts: [{ operationId: ARTIFACT_ID, attachmentMode: 'both', transportAccepted: true,
        to: ['fixture@example.test'], attempts: 2, sourceFreshness: 'unknown' }] });
    expect(listDistributionAttempts).toHaveBeenCalledWith(REQUEST_ID);
  });
});
