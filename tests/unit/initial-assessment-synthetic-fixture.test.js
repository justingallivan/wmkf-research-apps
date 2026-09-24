/**
 * Test Request Factory slice 6b, Stage B, item C — synthetic Initial
 * Assessment fixture contract test.
 *
 * Proves the fixture (lib/services/test-requests/fixtures/initial-assessment-synthetic.js)
 * is usable as a drop-in stand-in for a real AI proposal narrative: mocking
 * `getAiProposalNarrativeText` to resolve to the fixture's stand-in text, a
 * normal `generateInitialAssessment` call against a request whose generation
 * key (computed the SAME way the producer computes it, via
 * `buildInitialAssessmentIdentity`) already has a Ready row returns
 * `{ reused: true }` and never invokes the paid provider
 * (`executePrompt`) — i.e. the fixture never causes a real generation.
 *
 * @jest-environment node
 */

jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({
  ENTITY_SET_NAME: 'akoya_requests',
  getById: jest.fn(),
  findByIds: jest.fn(),
}));
jest.mock('../../lib/dataverse/adapters/request-document.js', () => ({
  ENTITY_SET_NAME: 'wmkf_requestdocuments',
  findByGenerationKey: jest.fn(),
  findByRequest: jest.fn(),
  findByCycle: jest.fn(),
  findArtifactCycles: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
}));
jest.mock('../../lib/dataverse/core/changeset.js', () => ({
  runChangeset: jest.fn(),
}));
jest.mock('../../lib/services/executor-budget-service.js', () => ({
  getExecutorBudget: jest.fn(async () => ({
    kind: 'standing', maxTokensOverride: 12000, timeoutMsOverride: 120000,
  })),
}));
jest.mock('../../lib/services/execute-prompt.js', () => ({
  executePrompt: jest.fn(),
}));
jest.mock('../../lib/services/workbench-proposal-documents.js', () => ({
  getAiProposalNarrativeText: jest.fn(),
}));
jest.mock('../../lib/services/graph-service.js', () => ({
  GraphService: {
    getFileMetadataById: jest.fn(),
    getFileMetadataByPath: jest.fn(),
    ensureFolderPath: jest.fn(),
    downloadFile: jest.fn(),
    uploadFile: jest.fn(),
    deleteFile: jest.fn(),
  },
}));
jest.mock('../../lib/services/initial-assessment/template.js', () => ({
  renderInitialAssessmentDocx: jest.fn(),
}));

import * as grantRequestAdapter from '../../lib/dataverse/adapters/grant-request.js';
import * as requestDocumentAdapter from '../../lib/dataverse/adapters/request-document.js';
import { executePrompt } from '../../lib/services/execute-prompt.js';
import { GraphService } from '../../lib/services/graph-service.js';
import { getAiProposalNarrativeText } from '../../lib/services/workbench-proposal-documents.js';
import {
  buildInitialAssessmentIdentity,
  generateInitialAssessment,
} from '../../lib/services/initial-assessment/artifact-service.js';
import {
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../shared/config/requestDocument.js';
import {
  SYNTHETIC_GENERATED,
  SYNTHETIC_PROPOSAL_FILENAME,
  SYNTHETIC_PROPOSAL_TEXT,
} from '../../lib/services/test-requests/fixtures/initial-assessment-synthetic.js';

const REQUEST_ID = '55555555-5555-5555-5555-555555555555';
const ARTIFACT_ID = '66666666-6666-6666-6666-666666666666';

const request = {
  akoya_requestid: REQUEST_ID,
  akoya_requestnum: '9009009',
  akoya_title: 'Synthetic Fixture Rehearsal Request',
  wmkf_meetingdate: '2026-06-15',
  wmkf_organizationname: 'N/A',
  _akoya_applicantid_value_formatted: 'Synthetic University',
  _wmkf_currentinitialassessment_value: ARTIFACT_ID,
  _etag: 'W/"request-1"',
};

beforeEach(() => {
  jest.clearAllMocks();
  grantRequestAdapter.getById.mockResolvedValue(request);
  getAiProposalNarrativeText.mockResolvedValue({
    filename: SYNTHETIC_PROPOSAL_FILENAME,
    text: SYNTHETIC_PROPOSAL_TEXT,
  });
});

it('SYNTHETIC_GENERATED satisfies the required-outputs contract', () => {
  const { validateGenerated } = jest.requireActual('../../lib/services/initial-assessment/artifact-model.js');
  expect(() => validateGenerated(SYNTHETIC_GENERATED)).not.toThrow();
});

it('a Ready row at the fixture-derived generation key is reused with zero provider calls', async () => {
  const { generationKey } = buildInitialAssessmentIdentity({
    requestId: REQUEST_ID,
    requestNumber: request.akoya_requestnum,
    title: request.akoya_title,
    institution: 'Synthetic University',
    cycleCode: 'D26',
    proposalFilename: SYNTHETIC_PROPOSAL_FILENAME,
    proposalText: SYNTHETIC_PROPOSAL_TEXT,
  });

  const readyRow = {
    wmkf_requestdocumentid: ARTIFACT_ID,
    wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.INITIAL_ASSESSMENT,
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL,
    wmkf_generationkey: generationKey,
    wmkf_sharepointsiteid: 'site',
    wmkf_sharepointdriveid: 'drive',
    wmkf_sharepointitemid: 'item',
    _wmkf_request_value: REQUEST_ID,
    _etag: 'W/"1"',
    modifiedon: new Date().toISOString(),
  };
  requestDocumentAdapter.findByGenerationKey.mockResolvedValue({ records: [readyRow] });
  requestDocumentAdapter.findByRequest.mockResolvedValue({ records: [readyRow] });

  const result = await generateInitialAssessment({ requestId: REQUEST_ID });

  expect(result.reused).toBe(true);
  expect(result.artifact.operationStatus).toBe(REQUEST_DOCUMENT_OPERATION_STATUS.READY);
  expect(executePrompt).not.toHaveBeenCalled();
  expect(GraphService.uploadFile).not.toHaveBeenCalled();
  expect(requestDocumentAdapter.create).not.toHaveBeenCalled();
  expect(requestDocumentAdapter.update).not.toHaveBeenCalled();
});
