/**
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
jest.mock('../../lib/services/execute-prompt.js', () => ({
  executePrompt: jest.fn(),
}));
jest.mock('../../lib/services/workbench-proposal-documents.js', () => ({
  getProposalText: jest.fn(),
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
jest.mock('../../lib/utils/sharepoint-buckets.js', () => ({
  getRequestSharePointBuckets: jest.fn(),
}));
jest.mock('../../lib/services/initial-assessment/template.js', () => ({
  renderInitialAssessmentDocx: jest.fn(),
}));

import crypto from 'crypto';
import JSZip from 'jszip';
import * as grantRequestAdapter from '../../lib/dataverse/adapters/grant-request.js';
import * as requestDocumentAdapter from '../../lib/dataverse/adapters/request-document.js';
import { runChangeset } from '../../lib/dataverse/core/changeset.js';
import { executePrompt } from '../../lib/services/execute-prompt.js';
import { GraphService } from '../../lib/services/graph-service.js';
import { getProposalText } from '../../lib/services/workbench-proposal-documents.js';
import { getRequestSharePointBuckets } from '../../lib/utils/sharepoint-buckets.js';
import { renderInitialAssessmentDocx } from '../../lib/services/initial-assessment/template.js';
import {
  buildInitialAssessmentIdentity,
  commitReadyLineage,
  generateInitialAssessment,
  hashGovernedDocxContent,
  listInitialAssessmentArtifacts,
  listInitialAssessmentCycles,
  projectArtifact,
} from '../../lib/services/initial-assessment/artifact-service.js';
import {
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../shared/config/requestDocument.js';

const REQUEST_ID = '33333333-3333-3333-3333-333333333333';
const ARTIFACT_ID = '44444444-4444-4444-4444-444444444444';
let DOCX;

async function buildDocx({
  documentXml = '<w:document><w:body><w:p>Governed content</w:p></w:body></w:document>',
  commentsTarget = 'comments.xml',
  sharePointMetadata = false,
} = {}) {
  const archive = new JSZip();
  archive.file('word/document.xml', documentXml);
  archive.file('word/styles.xml', '<w:styles><w:style w:styleId="Normal"/></w:styles>');
  archive.file('word/comments.xml', '<w:comments/>');
  const relationships = [
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="${commentsTarget}"/>`,
  ];
  if (sharePointMetadata) {
    relationships.reverse();
    relationships.unshift(
      '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../customXml/item1.xml"/>',
    );
    archive.file('customXml/item1.xml', '<p:properties xmlns:p="urn:sharepoint"/>');
    archive.file('docProps/core.xml', '<cp:coreProperties/>');
    archive.file('[trash]/0000.dat', Buffer.from('sharepoint metadata'));
  }
  archive.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0"?><Relationships>${relationships.join('')}</Relationships>`,
  );
  archive.file('[Content_Types].xml', sharePointMetadata
    ? '<Types><Override PartName="/customXml/item1.xml"/></Types>'
    : '<Types/>');
  return archive.generateAsync({ type: 'nodebuffer' });
}

const request = {
  akoya_requestid: REQUEST_ID,
  akoya_requestnum: '1003001',
  akoya_title: 'Mechanisms of Discovery',
  wmkf_meetingdate: '2026-06-15',
  wmkf_organizationname: 'Example University',
  _wmkf_currentinitialassessment_value: null,
  _etag: 'W/"request-1"',
};

function registryRow(overrides = {}) {
  return {
    wmkf_requestdocumentid: ARTIFACT_ID,
    wmkf_name: '1003001 Initial Assessment',
    wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.INITIAL_ASSESSMENT,
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
    wmkf_generationkey: 'a'.repeat(64),
    wmkf_cyclecode: 'D26',
    wmkf_inputfingerprint: 'b'.repeat(64),
    wmkf_claimtoken: 'claim-initial',
    wmkf_producer: 'request-workbench',
    wmkf_templateid: 'initial-assessment-standard-business-brief',
    wmkf_templateversion: '1.0.0',
    wmkf_promptname: 'initial-assessment.generate',
    wmkf_promptversion: 1,
    wmkf_sharepointfolderpath:
      '1003001_33333333333333333333333333333333/Artifacts/Initial Assessment',
    wmkf_filename: '1003001 Initial Assessment aaaaaaaa.docx',
    wmkf_attemptcount: 1,
    _wmkf_request_value: REQUEST_ID,
    _etag: 'W/"1"',
    modifiedon: new Date().toISOString(),
    ...overrides,
  };
}

const generated = {
  summary: 'A concise proposal summary.',
  significance_impact: 'The proposal identifies an important scientific problem.',
  research_plan: 'The team will test the proposal through linked experiments.',
  team_expertise: 'The proposal describes complementary team capabilities.',
};

let currentRegistryRow;
let etagVersion;
let defaultRegistryUpdate;

beforeEach(() => {
  jest.clearAllMocks();
  request._wmkf_currentinitialassessment_value = null;
  request._etag = 'W/"request-1"';
  currentRegistryRow = null;
  etagVersion = 1;
  grantRequestAdapter.getById.mockResolvedValue(request);
  grantRequestAdapter.findByIds.mockResolvedValue({ records: [request] });
  getProposalText.mockResolvedValue({
    text: 'Proposal source material '.repeat(20),
    filename: 'Proposal_1003001.pdf',
  });
  getRequestSharePointBuckets.mockResolvedValue([{
    source: 'dynamics',
    library: 'akoya_request',
    folder: '1003001_33333333333333333333333333333333',
  }]);
  requestDocumentAdapter.findByGenerationKey.mockImplementation(async () => ({
    records: currentRegistryRow ? [currentRegistryRow] : [],
  }));
  requestDocumentAdapter.findByRequest.mockImplementation(async () => ({
    records: currentRegistryRow ? [currentRegistryRow] : [],
  }));
  requestDocumentAdapter.create.mockImplementation(async (payload) => {
    const now = new Date().toISOString();
    currentRegistryRow = registryRow({
      ...payload,
      _etag: `W/"${etagVersion}"`,
      createdon: now,
      modifiedon: now,
    });
    return currentRegistryRow;
  });
  defaultRegistryUpdate = async (_id, patch, options = {}) => {
    if (!currentRegistryRow || options.ifMatch !== currentRegistryRow._etag) {
      const error = new Error('precondition failed');
      error.status = 412;
      throw error;
    }
    etagVersion += 1;
    currentRegistryRow = {
      ...currentRegistryRow,
      ...patch,
      _etag: `W/"${etagVersion}"`,
      modifiedon: new Date().toISOString(),
    };
  };
  requestDocumentAdapter.update.mockImplementation(defaultRegistryUpdate);
  runChangeset.mockImplementation(async (operations) => {
    for (const operation of operations) {
      if (operation.entitySet === 'akoya_requests') {
        if (operation.ifMatch !== request._etag) {
          const error = new Error('request precondition failed');
          error.status = 412;
          throw error;
        }
        request._wmkf_currentinitialassessment_value = operation.body[
          'wmkf_CurrentInitialAssessment@odata.bind'
        ].match(/\(([^)]+)\)$/)?.[1] || null;
        request._etag = 'W/"request-2"';
      } else {
        await requestDocumentAdapter.update(
          operation.key,
          operation.body,
          { ifMatch: operation.ifMatch },
        );
      }
    }
    return { ok: true, operations };
  });
  renderInitialAssessmentDocx.mockResolvedValue(DOCX);
  executePrompt.mockResolvedValue({
    parsed: generated,
    runId: '55555555-5555-5555-5555-555555555555',
    blocked: false,
    meta: {
      promptName: 'initial-assessment.generate',
      promptVersion: 1,
      promptId: '66666666-6666-6666-6666-666666666666',
    },
  });
  GraphService.getFileMetadataByPath.mockResolvedValue(null);
  GraphService.getFileMetadataById.mockResolvedValue(null);
  GraphService.deleteFile.mockResolvedValue(undefined);
  GraphService.ensureFolderPath.mockResolvedValue({
    siteId: 'site',
    driveId: 'drive',
    id: 'folder',
  });
  GraphService.uploadFile.mockResolvedValue({
    siteId: 'site',
    driveId: 'drive',
    id: 'item',
    name: '1003001 Initial Assessment aaaaaaaa.docx',
    size: DOCX.length,
    webUrl: 'https://example.sharepoint.com/item',
    eTag: '"etag"',
    versionId: '1.0',
    lastModified: '2026-07-29T12:00:00Z',
  });
});

beforeAll(async () => {
  DOCX = await buildDocx();
});

it('hashes SharePoint-normalized packaging as the same governed DOCX content', async () => {
  const sharePointVersion = await buildDocx({ sharePointMetadata: true });

  await expect(hashGovernedDocxContent(DOCX))
    .resolves.toMatch(/^gdc1:[A-Za-z0-9_-]{43}$/);
  await expect(hashGovernedDocxContent(DOCX))
    .resolves.toBe(await hashGovernedDocxContent(sharePointVersion));
});

it('changes the governed DOCX hash when Word content changes', async () => {
  const edited = await buildDocx({
    documentXml: '<w:document><w:body><w:p>Staff-edited content</w:p></w:body></w:document>',
    sharePointMetadata: true,
  });

  await expect(hashGovernedDocxContent(edited))
    .resolves.not.toBe(await hashGovernedDocxContent(DOCX));
});

it('changes the governed DOCX hash when a non-SharePoint document relationship changes', async () => {
  const edited = await buildDocx({ commentsTarget: 'comments-edited.xml' });

  await expect(hashGovernedDocxContent(edited))
    .resolves.not.toBe(await hashGovernedDocxContent(DOCX));
});

it('fails closed when content is not a DOCX package', async () => {
  await expect(hashGovernedDocxContent(Buffer.from('not a DOCX')))
    .rejects.toThrow('invalid DOCX package');
});

it('accepts whitespace-only paired relationship elements but rejects unparsed content', async () => {
  const pairedArchive = await JSZip.loadAsync(DOCX);
  pairedArchive.file(
    'word/_rels/document.xml.rels',
    '<Relationships>'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml">\n</Relationship>'
      + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
      + '</Relationships>',
  );
  const paired = await pairedArchive.generateAsync({ type: 'nodebuffer' });
  await expect(hashGovernedDocxContent(paired))
    .resolves.toBe(await hashGovernedDocxContent(DOCX));

  pairedArchive.file(
    'word/_rels/document.xml.rels',
    '<Relationships>'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml">unexpected</Relationship>'
      + '</Relationships>',
  );
  const unparsed = await pairedArchive.generateAsync({ type: 'nodebuffer' });
  await expect(hashGovernedDocxContent(unparsed))
    .rejects.toThrow('unrecognized document relationship');
});

it('returns a Ready row without rerunning AI or overwriting SharePoint', async () => {
  currentRegistryRow = registryRow({
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_sharepointsiteid: 'site',
    wmkf_sharepointdriveid: 'drive',
    wmkf_sharepointitemid: 'item',
  });
  request._wmkf_currentinitialassessment_value = ARTIFACT_ID;

  const result = await generateInitialAssessment({ requestId: REQUEST_ID });

  expect(getProposalText).toHaveBeenCalledWith(REQUEST_ID, '1003001');
  expect(result.reused).toBe(true);
  expect(result.artifact.operationStatus).toBe(REQUEST_DOCUMENT_OPERATION_STATUS.READY);
  expect(executePrompt).not.toHaveBeenCalled();
  expect(GraphService.uploadFile).not.toHaveBeenCalled();
  expect(requestDocumentAdapter.update).not.toHaveBeenCalled();
});

it('fails closed before persistence or AI when the canonical reviewer proposal is absent', async () => {
  getProposalText.mockResolvedValue(null);

  await expect(generateInitialAssessment({ requestId: REQUEST_ID })).rejects.toMatchObject({
    httpStatus: 409,
    message:
      'No usable canonical reviewer proposal was found at Reviewer Materials/Proposal_1003001.pdf.',
  });
  expect(requestDocumentAdapter.create).not.toHaveBeenCalled();
  expect(executePrompt).not.toHaveBeenCalled();
  expect(GraphService.uploadFile).not.toHaveBeenCalled();
});

it('atomically reactivates an exact superseded Ready artifact when inputs revert', async () => {
  const currentlyActive = registryRow({
    wmkf_requestdocumentid: 'aaaaaaaa-1111-1111-1111-111111111111',
    wmkf_generationkey: 'd'.repeat(64),
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_sharepointdriveid: 'drive',
    wmkf_sharepointitemid: 'newer-item',
    wmkf_claimtoken: 'other-claim',
    _etag: 'W/"other-1"',
  });
  currentRegistryRow = registryRow({
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED,
    wmkf_sharepointdriveid: 'drive',
    wmkf_sharepointitemid: 'reverted-item',
  });
  request._wmkf_currentinitialassessment_value = currentlyActive.wmkf_requestdocumentid;
  requestDocumentAdapter.findByRequest.mockResolvedValue({
    records: [currentlyActive, currentRegistryRow],
  });
  requestDocumentAdapter.update.mockImplementation(async (id, patch, options) => {
    if (id === currentlyActive.wmkf_requestdocumentid) {
      if (options.ifMatch !== currentlyActive._etag) {
        const error = new Error('precondition failed');
        error.status = 412;
        throw error;
      }
      Object.assign(currentlyActive, patch, { _etag: 'W/"other-2"' });
      return;
    }
    return defaultRegistryUpdate(id, patch, options);
  });

  const result = await generateInitialAssessment({ requestId: REQUEST_ID });

  expect(result).toMatchObject({ reused: true, recovered: false });
  expect(result.artifact.lifecycleState).toBe(REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT);
  expect(currentlyActive.wmkf_lifecyclestate)
    .toBe(REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED);
  expect(executePrompt).not.toHaveBeenCalled();
  expect(GraphService.uploadFile).not.toHaveBeenCalled();
});

it('writes the approved Artifacts/Initial Assessment path and confirms registry Ready', async () => {
  const result = await generateInitialAssessment({
    requestId: REQUEST_ID,
    actingUserSystemId: '77777777-7777-7777-7777-777777777777',
  });

  expect(result.reused).toBe(false);
  expect(GraphService.uploadFile).toHaveBeenCalledWith(
    'akoya_request',
    expect.stringMatching(/\/Artifacts\/Initial Assessment$/),
    expect.stringMatching(/^1003001 Initial Assessment [0-9a-f]{8}-[0-9a-f]{8}\.docx$/),
    DOCX,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );
  expect(GraphService.ensureFolderPath).toHaveBeenCalledWith(
    'akoya_request',
    expect.stringMatching(/\/Artifacts\/Initial Assessment$/),
  );
  expect(executePrompt).toHaveBeenCalledWith(expect.objectContaining({
    promptName: 'initial-assessment.generate',
    requestId: REQUEST_ID,
    requireNoPersistence: true,
  }));
  expect(result.artifact.file).toMatchObject({ driveId: 'drive', itemId: 'item' });
});

it('does not return success when SharePoint upload succeeds but final registry PATCH fails', async () => {
  runChangeset.mockRejectedValueOnce(new Error('Dataverse unavailable after upload'));

  await expect(generateInitialAssessment({ requestId: REQUEST_ID })).rejects.toMatchObject({
    httpStatus: 500,
  });
  expect(GraphService.uploadFile).toHaveBeenCalledTimes(1);
  expect(requestDocumentAdapter.update).toHaveBeenCalledWith(
    ARTIFACT_ID,
    expect.objectContaining({
      wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.FAILED,
    }),
    expect.any(Object),
  );
});

it('links an Executor failure to the failed AI run recorded on the thrown error', async () => {
  const failedRunId = '88888888-8888-8888-8888-888888888888';
  const executorError = new Error('provider rejected the request');
  executorError.runId = failedRunId;
  executePrompt.mockRejectedValueOnce(executorError);

  await expect(generateInitialAssessment({ requestId: REQUEST_ID })).rejects.toMatchObject({
    httpStatus: 500,
    body: { runId: failedRunId },
  });
  expect(requestDocumentAdapter.update).toHaveBeenCalledWith(
    ARTIFACT_ID,
    expect.objectContaining({
      wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.FAILED,
      'wmkf_AIRun@odata.bind': `/wmkf_ai_runs(${failedRunId})`,
    }),
    expect.any(Object),
  );
});

it('replaces stale run provenance with the current failed Executor run on retry', async () => {
  const failedRunId = '99999999-8888-8888-8888-888888888888';
  currentRegistryRow = registryRow({
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.FAILED,
    _wmkf_airun_value: '11111111-8888-8888-8888-888888888888',
  });
  const executorError = new Error('retry provider failure');
  executorError.runId = failedRunId;
  executePrompt.mockRejectedValueOnce(executorError);

  await expect(generateInitialAssessment({ requestId: REQUEST_ID })).rejects.toMatchObject({
    body: { runId: failedRunId },
  });
  expect(currentRegistryRow).toMatchObject({
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.FAILED,
    'wmkf_AIRun@odata.bind': `/wmkf_ai_runs(${failedRunId})`,
  });
});

it('accepts a committed Ready changeset when only the transport response is lost', async () => {
  runChangeset.mockImplementationOnce(async (operations) => {
    for (const operation of operations) {
      if (operation.entitySet === 'akoya_requests') {
        request._wmkf_currentinitialassessment_value = operation.body[
          'wmkf_CurrentInitialAssessment@odata.bind'
        ].match(/\(([^)]+)\)$/)?.[1] || null;
        request._etag = 'W/"request-transport-lost"';
      } else {
        await requestDocumentAdapter.update(
          operation.key,
          operation.body,
          { ifMatch: operation.ifMatch },
        );
      }
    }
    throw new Error('transport response lost after commit');
  });

  const result = await generateInitialAssessment({ requestId: REQUEST_ID });

  expect(result.artifact.operationStatus).toBe(REQUEST_DOCUMENT_OPERATION_STATUS.READY);
  expect(result.artifact.file).toMatchObject({ driveId: 'drive', itemId: 'item' });
  expect(request._wmkf_currentinitialassessment_value).toBe(ARTIFACT_ID);
});

it('preserves the canonical upload when post-commit verification initially fails', async () => {
  let failVerificationRead = false;
  requestDocumentAdapter.findByGenerationKey.mockImplementation(async () => {
    if (failVerificationRead) {
      failVerificationRead = false;
      throw new Error('Dataverse verification read unavailable');
    }
    return { records: currentRegistryRow ? [currentRegistryRow] : [] };
  });
  runChangeset.mockImplementationOnce(async (operations) => {
    for (const operation of operations) {
      if (operation.entitySet === 'akoya_requests') {
        request._wmkf_currentinitialassessment_value = operation.body[
          'wmkf_CurrentInitialAssessment@odata.bind'
        ].match(/\(([^)]+)\)$/)?.[1] || null;
        request._etag = 'W/"request-post-commit-read-failure"';
      } else {
        await requestDocumentAdapter.update(
          operation.key,
          operation.body,
          { ifMatch: operation.ifMatch },
        );
      }
    }
    failVerificationRead = true;
    throw new Error('transport response lost after commit');
  });

  await expect(generateInitialAssessment({ requestId: REQUEST_ID }))
    .rejects.toMatchObject({
      body: { code: 'initial_assessment_failed' },
    });
  expect(currentRegistryRow.wmkf_operationstatus)
    .toBe(REQUEST_DOCUMENT_OPERATION_STATUS.READY);
  expect(request._wmkf_currentinitialassessment_value).toBe(ARTIFACT_ID);
  expect(GraphService.deleteFile).not.toHaveBeenCalled();
});

it('rejects an ambiguous transport error when the canonical pointer does not match', async () => {
  currentRegistryRow = registryRow({
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_sharepointdriveid: 'drive',
    wmkf_sharepointitemid: 'item',
  });
  request._wmkf_currentinitialassessment_value = '99999999-9999-9999-9999-999999999999';
  runChangeset.mockRejectedValueOnce(new Error('transport failed before commit'));

  await expect(generateInitialAssessment({ requestId: REQUEST_ID }))
    .rejects.toThrow('transport failed before commit');
});

it('rejects an ambiguous transport error while another active Ready row remains', async () => {
  const duplicateReady = registryRow({
    wmkf_requestdocumentid: '99999999-9999-9999-9999-999999999999',
    wmkf_generationkey: '9'.repeat(64),
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_sharepointdriveid: 'drive',
    wmkf_sharepointitemid: 'duplicate-item',
    _etag: 'W/"duplicate-1"',
  });
  currentRegistryRow = registryRow({
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_sharepointdriveid: 'drive',
    wmkf_sharepointitemid: 'item',
  });
  request._wmkf_currentinitialassessment_value = ARTIFACT_ID;
  requestDocumentAdapter.findByRequest.mockResolvedValue({
    records: [currentRegistryRow, duplicateReady],
  });
  runChangeset.mockRejectedValueOnce(new Error('transport failed before commit'));

  await expect(generateInitialAssessment({ requestId: REQUEST_ID }))
    .rejects.toThrow('transport failed before commit');
});

it('classifies a Ready-changeset 412 from a newer claim and removes the losing upload', async () => {
  runChangeset.mockImplementationOnce(async () => {
    currentRegistryRow = {
      ...currentRegistryRow,
      wmkf_claimtoken: 'newer-worker-claim',
      _etag: 'W/"99"',
      modifiedon: new Date().toISOString(),
    };
    const error = new Error('changeset precondition failed 412');
    error.status = 412;
    throw error;
  });

  await expect(generateInitialAssessment({ requestId: REQUEST_ID })).rejects.toMatchObject({
    httpStatus: 409,
    body: { code: 'claim_lost' },
  });
  expect(GraphService.deleteFile).toHaveBeenCalledWith('drive', 'item');
  expect(currentRegistryRow.wmkf_claimtoken).toBe('newer-worker-claim');
});

it('removes the losing upload when a non-412 finalize failure coincides with claim loss', async () => {
  runChangeset.mockImplementationOnce(async () => {
    currentRegistryRow = {
      ...currentRegistryRow,
      wmkf_claimtoken: 'newer-worker-claim',
      _etag: 'W/"99"',
      modifiedon: new Date().toISOString(),
    };
    throw new Error('Dataverse transport failed before the response');
  });

  await expect(generateInitialAssessment({ requestId: REQUEST_ID })).rejects.toMatchObject({
    httpStatus: 409,
    body: { code: 'claim_lost' },
  });
  expect(GraphService.deleteFile).toHaveBeenCalledWith('drive', 'item');
  expect(currentRegistryRow.wmkf_claimtoken).toBe('newer-worker-claim');
});

it('durably records exact cleanup work if a claim-lost upload cannot be deleted', async () => {
  GraphService.uploadFile.mockImplementation(async () => {
    const existingCleanup = Array.from({ length: 2 }, (_, index) => ({
      driveId: `drive-${index}`,
      itemId: `item-${index}`,
      name: `old-${index}.docx`,
      recordedAt: '2026-07-29T12:00:00.000Z',
      reason: 'claim_lost_delete_failed',
      error: 'prior cleanup',
    }));
    currentRegistryRow = {
      ...currentRegistryRow,
      wmkf_claimtoken: 'newer-worker-claim',
      wmkf_orphancleanupjson: JSON.stringify(existingCleanup),
      _etag: 'W/"99"',
      modifiedon: new Date().toISOString(),
    };
    return {
      siteId: 'site',
      driveId: 'drive',
      id: 'orphan-item',
      name: 'orphan.docx',
      size: DOCX.length,
      webUrl: 'https://example.sharepoint.com/orphan-item',
      eTag: '"orphan-etag"',
      versionId: '1.0',
      lastModified: '2026-07-29T12:00:00Z',
    };
  });
  GraphService.deleteFile.mockRejectedValueOnce(new Error('Graph unavailable'));

  await expect(generateInitialAssessment({ requestId: REQUEST_ID })).rejects.toMatchObject({
    httpStatus: 500,
    body: { code: 'claim_lost_cleanup_required' },
  });
  const cleanupQueue = JSON.parse(currentRegistryRow.wmkf_orphancleanupjson);
  expect(currentRegistryRow.wmkf_orphancleanupjson.length).toBeLessThanOrEqual(10000);
  expect(cleanupQueue.at(-1)).toEqual(expect.objectContaining({
    driveId: 'drive',
    itemId: 'orphan-item',
    name: 'orphan.docx',
    reason: 'claim_lost_delete_failed',
  }));
  expect(projectArtifact(currentRegistryRow).cleanupRequired).toHaveLength(3);
});

it('retains exact overflow cleanup work without discarding older identifiers', async () => {
  const existingCleanup = Array.from({ length: 20 }, (_, index) => ({
    driveId: `drive-${index}`,
    itemId: `item-${index}`,
    name: `old-${index}.docx`,
    recordedAt: '2026-07-29T12:00:00.000Z',
    reason: 'claim_lost_delete_failed',
    error: 'x'.repeat(350),
  }));
  const originalQueue = JSON.stringify(existingCleanup);
  GraphService.uploadFile.mockImplementation(async () => {
    currentRegistryRow = {
      ...currentRegistryRow,
      wmkf_claimtoken: 'newer-worker-claim',
      wmkf_orphancleanupjson: originalQueue,
      _etag: 'W/"99"',
      modifiedon: new Date().toISOString(),
    };
    return {
      siteId: 'site',
      driveId: 'drive',
      id: 'overflow-item',
      name: 'overflow.docx',
      size: DOCX.length,
      webUrl: 'https://example.sharepoint.com/overflow-item',
      eTag: '"overflow-etag"',
      versionId: '1.0',
      lastModified: '2026-07-29T12:00:00Z',
    };
  });
  GraphService.deleteFile.mockRejectedValueOnce(new Error('Graph unavailable'));

  await expect(generateInitialAssessment({ requestId: REQUEST_ID })).rejects.toMatchObject({
    httpStatus: 500,
    body: { code: 'orphan_cleanup_capacity_exceeded' },
  });
  expect(currentRegistryRow.wmkf_orphancleanupjson).toBe(originalQueue);
  expect(JSON.parse(currentRegistryRow.wmkf_orphancleanupoverflowjson)).toEqual([
    expect.objectContaining({
      driveId: 'drive',
      itemId: 'overflow-item',
      name: 'overflow.docx',
      reason: 'claim_lost_delete_failed',
    }),
  ]);
  expect(projectArtifact(currentRegistryRow).cleanupRequired).toHaveLength(21);
});

it('blocks another upload for a generation with unresolved cleanup overflow', async () => {
  currentRegistryRow = registryRow({
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.FAILED,
    wmkf_orphancleanupoverflowjson: JSON.stringify([{
      driveId: 'drive',
      itemId: 'unresolved-overflow-item',
      name: 'unresolved.docx',
      recordedAt: '2026-07-29T12:00:00.000Z',
      reason: 'claim_lost_delete_failed',
      error: 'Graph unavailable',
    }]),
  });

  await expect(generateInitialAssessment({ requestId: REQUEST_ID })).rejects.toMatchObject({
    httpStatus: 409,
    body: { code: 'orphan_cleanup_required' },
  });
  expect(executePrompt).not.toHaveBeenCalled();
  expect(GraphService.uploadFile).not.toHaveBeenCalled();
});

it('stops an active successor when cleanup overflow appears after preparation', async () => {
  currentRegistryRow = registryRow({
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.FAILED,
  });
  executePrompt.mockImplementationOnce(async () => {
    currentRegistryRow = {
      ...currentRegistryRow,
      wmkf_orphancleanupoverflowjson: JSON.stringify([{
        driveId: 'drive',
        itemId: 'stale-worker-orphan',
        recordedAt: '2026-07-29T12:00:00.000Z',
        reason: 'claim_lost_delete_failed',
        error: 'Graph unavailable',
      }]),
      _etag: 'W/"overflow-after-prepare"',
    };
    return {
      parsed: generated,
      runId: '55555555-5555-5555-5555-555555555555',
      blocked: false,
      meta: {
        promptName: 'initial-assessment.generate',
        promptVersion: 1,
        promptId: '66666666-6666-6666-6666-666666666666',
      },
    };
  });

  await expect(generateInitialAssessment({ requestId: REQUEST_ID })).rejects.toMatchObject({
    httpStatus: 409,
    body: { code: 'orphan_cleanup_required' },
  });
  expect(GraphService.uploadFile).not.toHaveBeenCalled();
});

it('removes an upload if cleanup overflow appears after the final pre-upload fence', async () => {
  currentRegistryRow = registryRow({
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.FAILED,
  });
  GraphService.uploadFile.mockImplementationOnce(async () => {
    currentRegistryRow = {
      ...currentRegistryRow,
      wmkf_orphancleanupoverflowjson: JSON.stringify([{
        driveId: 'drive',
        itemId: 'stale-worker-orphan',
        recordedAt: '2026-07-29T12:00:00.000Z',
        reason: 'claim_lost_delete_failed',
        error: 'Graph unavailable',
      }]),
      _etag: 'W/"overflow-after-upload"',
    };
    return {
      siteId: 'site',
      driveId: 'drive',
      id: 'racing-upload',
      name: currentRegistryRow.wmkf_filename,
      size: DOCX.length,
      webUrl: 'https://example.sharepoint.com/racing-upload',
      eTag: '"racing-upload-etag"',
      versionId: '1.0',
      lastModified: '2026-07-29T12:00:00Z',
    };
  });

  await expect(generateInitialAssessment({ requestId: REQUEST_ID })).rejects.toMatchObject({
    httpStatus: 409,
    body: { code: 'orphan_cleanup_required' },
  });
  expect(GraphService.deleteFile).toHaveBeenCalledWith('drive', 'racing-upload');
});

it('repairs a prior post-upload registry failure by content hash without rerunning AI', async () => {
  const contentHash = await hashGovernedDocxContent(DOCX);
  const failed = registryRow({
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.FAILED,
    wmkf_contenthash: contentHash,
  });
  currentRegistryRow = failed;
  GraphService.getFileMetadataByPath.mockResolvedValue({
    siteId: 'site',
    driveId: 'drive',
    id: 'item',
    name: failed.wmkf_filename,
    size: DOCX.length,
    webUrl: 'https://example.sharepoint.com/item',
    eTag: '"etag"',
    versionId: '1.0',
    lastModified: '2026-07-29T12:00:00Z',
  });
  GraphService.downloadFile.mockResolvedValue({ buffer: DOCX });

  const result = await generateInitialAssessment({ requestId: REQUEST_ID });

  expect(result).toMatchObject({ reused: true, recovered: true });
  expect(executePrompt).not.toHaveBeenCalled();
  expect(GraphService.uploadFile).not.toHaveBeenCalled();
});

it('recovers a legacy whole-package hash only when downloaded bytes still match exactly', async () => {
  const failed = registryRow({
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.FAILED,
    wmkf_contenthash: crypto.createHash('sha256').update(DOCX).digest('hex'),
  });
  currentRegistryRow = failed;
  GraphService.getFileMetadataByPath.mockResolvedValue({
    siteId: 'site',
    driveId: 'drive',
    id: 'legacy-item',
    name: failed.wmkf_filename,
    size: DOCX.length,
    webUrl: 'https://example.sharepoint.com/legacy-item',
    eTag: '"legacy-etag"',
    versionId: '1.0',
    lastModified: '2026-07-29T12:00:00Z',
  });
  GraphService.downloadFile.mockResolvedValue({ buffer: DOCX });

  const result = await generateInitialAssessment({ requestId: REQUEST_ID });

  expect(result).toMatchObject({ reused: true, recovered: true });
  expect(executePrompt).not.toHaveBeenCalled();
  expect(GraphService.uploadFile).not.toHaveBeenCalled();
});

it('blocks unverifiable legacy recovery without rerunning AI or uploading a duplicate', async () => {
  const failed = registryRow({
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.FAILED,
    wmkf_contenthash: crypto.createHash('sha256').update(DOCX).digest('hex'),
  });
  currentRegistryRow = failed;
  GraphService.getFileMetadataByPath.mockResolvedValue({
    siteId: 'site',
    driveId: 'drive',
    id: 'legacy-normalized-item',
    name: failed.wmkf_filename,
    size: DOCX.length,
    webUrl: 'https://example.sharepoint.com/legacy-normalized-item',
    eTag: '"legacy-normalized-etag"',
    versionId: '1.0',
    lastModified: '2026-07-29T12:00:00Z',
  });
  GraphService.downloadFile.mockResolvedValue({
    buffer: await buildDocx({ sharePointMetadata: true }),
  });

  await expect(generateInitialAssessment({ requestId: REQUEST_ID })).rejects.toMatchObject({
    httpStatus: 409,
    body: { code: 'legacy_content_hash_unverifiable' },
  });

  expect(currentRegistryRow.wmkf_operationstatus).toBe(
    REQUEST_DOCUMENT_OPERATION_STATUS.FAILED,
  );
  expect(executePrompt).not.toHaveBeenCalled();
  expect(GraphService.uploadFile).not.toHaveBeenCalled();
  expect(projectArtifact(currentRegistryRow).cleanupRequired).toEqual([
    expect.objectContaining({
      driveId: 'drive',
      itemId: 'legacy-normalized-item',
      reason: 'legacy_content_hash_unverifiable_retained',
    }),
  ]);

  await expect(generateInitialAssessment({ requestId: REQUEST_ID })).rejects.toMatchObject({
    httpStatus: 409,
    body: { code: 'legacy_content_hash_unverifiable' },
  });
  expect(projectArtifact(currentRegistryRow).cleanupRequired).toHaveLength(1);
});

it('records a recovery download failure instead of leaving the row Generating', async () => {
  const failed = registryRow({
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.FAILED,
    wmkf_contenthash: await hashGovernedDocxContent(DOCX),
  });
  currentRegistryRow = failed;
  GraphService.getFileMetadataByPath.mockResolvedValue({
    siteId: 'site',
    driveId: 'drive',
    id: 'download-failure-item',
    name: failed.wmkf_filename,
    size: DOCX.length,
    webUrl: 'https://example.sharepoint.com/download-failure-item',
    eTag: '"download-failure-etag"',
    versionId: '1.0',
    lastModified: '2026-07-29T12:00:00Z',
  });
  GraphService.downloadFile.mockRejectedValue(new Error('Graph download unavailable'));

  await expect(generateInitialAssessment({ requestId: REQUEST_ID })).rejects.toMatchObject({
    httpStatus: 500,
    body: { code: 'initial_assessment_failed' },
  });

  expect(currentRegistryRow.wmkf_operationstatus).toBe(
    REQUEST_DOCUMENT_OPERATION_STATUS.FAILED,
  );
  expect(currentRegistryRow.wmkf_lasterrormessage).toContain('Graph download unavailable');
  expect(executePrompt).not.toHaveBeenCalled();
  expect(GraphService.uploadFile).not.toHaveBeenCalled();
});

it('retains a hash-mismatched recovery item for cleanup and generates a fresh claim file', async () => {
  const failed = registryRow({
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.FAILED,
    wmkf_contenthash: await hashGovernedDocxContent(DOCX),
  });
  const priorFilename = failed.wmkf_filename;
  currentRegistryRow = failed;
  GraphService.getFileMetadataByPath.mockResolvedValue({
    siteId: 'site',
    driveId: 'drive',
    id: 'edited-item',
    name: priorFilename,
    size: DOCX.length,
    webUrl: 'https://example.sharepoint.com/edited-item',
    eTag: '"edited-etag"',
    versionId: '2.0',
    lastModified: '2026-07-29T13:00:00Z',
  });
  GraphService.downloadFile.mockResolvedValue({
    buffer: await buildDocx({
      documentXml:
        '<w:document><w:body><w:p>Staff-edited content</w:p></w:body></w:document>',
      sharePointMetadata: true,
    }),
  });

  const result = await generateInitialAssessment({ requestId: REQUEST_ID });

  expect(result.artifact.operationStatus).toBe(REQUEST_DOCUMENT_OPERATION_STATUS.READY);
  expect(executePrompt).toHaveBeenCalledTimes(1);
  expect(GraphService.uploadFile).toHaveBeenCalledWith(
    'akoya_request',
    failed.wmkf_sharepointfolderpath,
    expect.not.stringContaining(priorFilename),
    DOCX,
    expect.any(String),
  );
  expect(projectArtifact(currentRegistryRow).cleanupRequired).toEqual([
    expect.objectContaining({
      driveId: 'drive',
      itemId: 'edited-item',
      reason: 'content_hash_mismatch_retained',
    }),
  ]);
});

it('retains an invalid recovery package for cleanup and generates a fresh claim file', async () => {
  const failed = registryRow({
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.FAILED,
    wmkf_contenthash: await hashGovernedDocxContent(DOCX),
  });
  const priorFilename = failed.wmkf_filename;
  currentRegistryRow = failed;
  GraphService.getFileMetadataByPath.mockResolvedValue({
    siteId: 'site',
    driveId: 'drive',
    id: 'invalid-item',
    name: failed.wmkf_filename,
    size: 12,
    webUrl: 'https://example.sharepoint.com/invalid-item',
    eTag: '"invalid-etag"',
    versionId: '1.0',
    lastModified: '2026-07-29T13:00:00Z',
  });
  GraphService.downloadFile.mockResolvedValue({ buffer: Buffer.from('not a DOCX') });

  const result = await generateInitialAssessment({ requestId: REQUEST_ID });

  expect(result.artifact.operationStatus).toBe(REQUEST_DOCUMENT_OPERATION_STATUS.READY);
  expect(executePrompt).toHaveBeenCalledTimes(1);
  expect(GraphService.uploadFile).toHaveBeenCalledWith(
    'akoya_request',
    failed.wmkf_sharepointfolderpath,
    expect.not.stringContaining(priorFilename),
    DOCX,
    expect.any(String),
  );
  expect(projectArtifact(currentRegistryRow).cleanupRequired).toEqual([
    expect.objectContaining({
      driveId: 'drive',
      itemId: 'invalid-item',
      reason: 'invalid_docx_retained',
    }),
  ]);
});

it('does not let an expired worker overwrite or fail a newer claim', async () => {
  GraphService.uploadFile.mockImplementation(async () => {
    currentRegistryRow = {
      ...currentRegistryRow,
      wmkf_claimtoken: 'newer-worker-claim',
      _etag: 'W/"99"',
      modifiedon: new Date().toISOString(),
    };
    return {
      siteId: 'site',
      driveId: 'drive',
      id: 'old-worker-item',
      name: currentRegistryRow.wmkf_filename,
      size: DOCX.length,
      webUrl: 'https://example.sharepoint.com/old-worker-item',
      eTag: '"old-worker-etag"',
      versionId: '1.0',
      lastModified: '2026-07-29T12:00:00Z',
    };
  });

  await expect(generateInitialAssessment({ requestId: REQUEST_ID })).rejects.toMatchObject({
    httpStatus: 409,
    body: { code: 'claim_lost' },
  });
  expect(currentRegistryRow).toMatchObject({
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING,
    wmkf_claimtoken: 'newer-worker-claim',
  });
  expect(GraphService.deleteFile).toHaveBeenCalledWith('drive', 'old-worker-item');
  const failedWrites = requestDocumentAdapter.update.mock.calls.filter(
    ([, patch]) => patch.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.FAILED,
  );
  expect(failedWrites).toHaveLength(0);
});

it('supersedes an older Ready artifact only after the replacement reaches Ready', async () => {
  const prior = registryRow({
    wmkf_requestdocumentid: '88888888-8888-8888-8888-888888888888',
    wmkf_generationkey: 'c'.repeat(64),
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_claimtoken: 'older-claim',
    createdon: '2026-07-28T12:00:00Z',
    modifiedon: '2026-07-28T12:00:00Z',
    _etag: 'W/"prior-1"',
  });
  requestDocumentAdapter.findByRequest.mockImplementation(async () => ({
    records: currentRegistryRow ? [currentRegistryRow, prior] : [prior],
  }));
  requestDocumentAdapter.update.mockImplementation(async (id, patch, options) => {
    if (id === prior.wmkf_requestdocumentid) {
      if (options.ifMatch !== prior._etag) {
        const error = new Error('precondition failed');
        error.status = 412;
        throw error;
      }
      Object.assign(prior, patch, { _etag: 'W/"prior-2"', modifiedon: new Date().toISOString() });
      return;
    }
    return defaultRegistryUpdate(id, patch, options);
  });

  const result = await generateInitialAssessment({ requestId: REQUEST_ID });

  expect(result.artifact.operationStatus).toBe(REQUEST_DOCUMENT_OPERATION_STATUS.READY);
  expect(prior.wmkf_lifecyclestate).toBe(REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED);
  expect(runChangeset).toHaveBeenCalledWith(
    expect.arrayContaining([
      expect.objectContaining({
        method: 'PATCH',
        key: prior.wmkf_requestdocumentid,
        body: { wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED },
        ifMatch: 'W/"prior-1"',
      }),
      expect.objectContaining({
        method: 'PATCH',
        key: ARTIFACT_ID,
        body: expect.objectContaining({
          wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
          wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
        }),
      }),
    ]),
    {},
  );
  expect(GraphService.uploadFile.mock.invocationCallOrder[0])
    .toBeLessThan(runChangeset.mock.invocationCallOrder[0]);
});

it('uses the shared request pointer ETag to serialize concurrent first-time Ready activations', async () => {
  const rowA = registryRow({
    wmkf_requestdocumentid: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    wmkf_generationkey: '1'.repeat(64),
    wmkf_claimtoken: 'claim-a',
    _etag: 'W/"a-1"',
  });
  const rowB = registryRow({
    wmkf_requestdocumentid: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2',
    wmkf_generationkey: '2'.repeat(64),
    wmkf_claimtoken: 'claim-b',
    _etag: 'W/"b-1"',
  });
  const rows = new Map([
    [rowA.wmkf_generationkey, rowA],
    [rowB.wmkf_generationkey, rowB],
  ]);
  const requestState = {
    ...request,
    _wmkf_currentinitialassessment_value: null,
    _etag: 'W/"request-concurrent-1"',
  };
  grantRequestAdapter.getById.mockImplementation(async () => ({ ...requestState }));
  requestDocumentAdapter.findByGenerationKey.mockImplementation(async (generationKey) => ({
    records: [rows.get(generationKey)],
  }));
  requestDocumentAdapter.findByRequest.mockImplementation(async () => ({
    records: [...rows.values()],
  }));

  let firstArrival;
  const firstAtChangeset = new Promise((resolve) => { firstArrival = resolve; });
  let releaseFirst;
  const holdFirst = new Promise((resolve) => { releaseFirst = resolve; });
  let arrivals = 0;
  runChangeset.mockImplementation(async (operations) => {
    arrivals += 1;
    if (arrivals === 1) {
      firstArrival();
      await holdFirst;
    } else if (arrivals === 2) {
      await firstAtChangeset;
      releaseFirst();
    }

    for (const operation of operations) {
      if (operation.entitySet === 'akoya_requests') {
        if (operation.ifMatch !== requestState._etag) {
          const error = new Error('request pointer precondition failed');
          error.status = 412;
          throw error;
        }
      } else {
        const target = [...rows.values()].find(
          (candidate) => candidate.wmkf_requestdocumentid === operation.key,
        );
        if (!target || operation.ifMatch !== target._etag) {
          const error = new Error('artifact precondition failed');
          error.status = 412;
          throw error;
        }
      }
    }
    for (const operation of operations) {
      if (operation.entitySet === 'akoya_requests') {
        requestState._wmkf_currentinitialassessment_value = operation.body[
          'wmkf_CurrentInitialAssessment@odata.bind'
        ].match(/\(([^)]+)\)$/)?.[1] || null;
        requestState._etag = `W/"request-concurrent-${arrivals + 1}"`;
      } else {
        const target = [...rows.values()].find(
          (candidate) => candidate.wmkf_requestdocumentid === operation.key,
        );
        Object.assign(target, operation.body, {
          _etag: `${target._etag}-next`,
          modifiedon: new Date().toISOString(),
        });
      }
    }
    return { ok: true, operations };
  });

  const metadata = (id) => ({
    siteId: 'site',
    driveId: 'drive',
    id,
    webUrl: `https://example.sharepoint.com/${id}`,
    versionId: '1.0',
    eTag: `"${id}"`,
    size: DOCX.length,
    lastModified: '2026-07-29T12:00:00Z',
  });
  const outcomes = await Promise.allSettled([
    commitReadyLineage(rowA, { metadata: metadata('item-a'), claimToken: 'claim-a' }),
    commitReadyLineage(rowB, { metadata: metadata('item-b'), claimToken: 'claim-b' }),
  ]);

  expect(outcomes.some((outcome) => outcome.status === 'fulfilled')).toBe(true);
  const activeReady = [...rows.values()].filter((candidate) => (
    candidate.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
    && candidate.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED
  ));
  expect(activeReady).toHaveLength(1);
  expect(requestState._wmkf_currentinitialassessment_value)
    .toBe(activeReady[0].wmkf_requestdocumentid);
  expect(runChangeset.mock.calls.length).toBeGreaterThanOrEqual(2);
});

it('preserves non-404 Dataverse request-read failures', async () => {
  const upstream = new Error('Dataverse unavailable');
  upstream.status = 503;
  grantRequestAdapter.getById.mockRejectedValueOnce(upstream);

  await expect(generateInitialAssessment({ requestId: REQUEST_ID })).rejects.toBe(upstream);
});

it('changes deterministic artifact identity when the authoritative cycle changes', () => {
  const base = {
    requestId: REQUEST_ID,
    requestNumber: request.akoya_requestnum,
    title: request.akoya_title,
    institution: request.wmkf_organizationname,
    proposalFilename: 'Proposal_1003001.pdf',
    proposalText: 'Proposal source material '.repeat(20),
  };
  const d26 = buildInitialAssessmentIdentity({ ...base, cycleCode: 'D26' });
  const j27 = buildInitialAssessmentIdentity({ ...base, cycleCode: 'J27' });

  expect(j27.inputFingerprint).not.toBe(d26.inputFingerprint);
  expect(j27.generationKey).not.toBe(d26.generationKey);
});

it('projects a stale Generating lease as retryable while keeping an active lease locked', () => {
  const active = projectArtifact(registryRow({
    modifiedon: new Date(Date.now() - 60_000).toISOString(),
  }));
  const stale = projectArtifact(registryRow({
    modifiedon: new Date(Date.now() - (16 * 60_000)).toISOString(),
  }));

  expect(active).toMatchObject({ retryable: false });
  expect(active.retryAfterAt).toBeTruthy();
  expect(stale).toMatchObject({ retryable: true });
});

it('keeps the canonical Ready artifact while exposing a newer failed attempt separately', async () => {
  const older = registryRow({
    wmkf_requestdocumentid: '11111111-1111-1111-1111-111111111111',
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_sharepointdriveid: 'drive',
    wmkf_sharepointitemid: 'ready-item',
    createdon: '2026-07-28T12:00:00Z',
  });
  const newer = registryRow({
    wmkf_requestdocumentid: '22222222-2222-2222-2222-222222222222',
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.FAILED,
    createdon: '2026-07-29T12:00:00Z',
  });
  const superseded = registryRow({
    wmkf_requestdocumentid: '99999999-9999-9999-9999-999999999999',
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED,
    createdon: '2026-07-30T12:00:00Z',
  });
  requestDocumentAdapter.findByRequest.mockResolvedValue({
    records: [superseded, older, newer],
  });
  request._wmkf_currentinitialassessment_value = older.wmkf_requestdocumentid;

  const result = await listInitialAssessmentArtifacts({ requestId: REQUEST_ID });

  expect(result.artifacts).toHaveLength(1);
  expect(result.artifacts[0].artifactId).toBe(older.wmkf_requestdocumentid);
  expect(result.artifacts[0].operationStatus).toBe(REQUEST_DOCUMENT_OPERATION_STATUS.READY);
  expect(result.latestAttempts).toHaveLength(1);
  expect(result.latestAttempts[0].artifactId).toBe(newer.wmkf_requestdocumentid);
  expect(result.latestAttempts[0].operationStatus)
    .toBe(REQUEST_DOCUMENT_OPERATION_STATUS.FAILED);
});

it('refreshes file metadata from the stable Graph identity without writing Dataverse', async () => {
  const ready = registryRow({
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_sharepointsiteid: 'site',
    wmkf_sharepointdriveid: 'drive',
    wmkf_sharepointitemid: 'ready-item',
    wmkf_sharepointweburl: 'https://example.sharepoint.com/old',
    wmkf_sharepointversionid: '1.0',
    wmkf_sharepointetag: '"old-etag"',
    wmkf_filename: 'old-name.docx',
    wmkf_filesize: 100,
    wmkf_sharepointlastmodified: '2026-07-29T12:00:00Z',
  });
  requestDocumentAdapter.findByRequest.mockResolvedValue({ records: [ready] });
  request._wmkf_currentinitialassessment_value = ready.wmkf_requestdocumentid;
  GraphService.getFileMetadataById.mockResolvedValue({
    siteId: 'site',
    driveId: 'drive',
    id: 'ready-item',
    webUrl: 'https://example.sharepoint.com/current',
    versionId: '2.0',
    eTag: '"current-etag"',
    name: 'current-name.docx',
    size: 125,
    lastModified: '2026-07-31T01:33:55Z',
  });

  const result = await listInitialAssessmentArtifacts({ requestId: REQUEST_ID });

  expect(GraphService.getFileMetadataById).toHaveBeenCalledWith(
    'drive',
    'ready-item',
    {
      siteId: 'site',
      timeoutMs: expect.any(Number),
    },
  );
  expect(result.artifacts[0].file).toMatchObject({
    itemId: 'ready-item',
    webUrl: 'https://example.sharepoint.com/current',
    versionId: '2.0',
    eTag: '"current-etag"',
    name: 'current-name.docx',
    size: 125,
    lastModified: '2026-07-31T01:33:55Z',
    metadataStatus: 'current',
  });
  expect(result.artifacts[0].file.metadataCheckedAt).toBeTruthy();
  expect(requestDocumentAdapter.update).not.toHaveBeenCalled();
});

it('labels a missing Graph item without presenting the registry snapshot as current', async () => {
  const ready = registryRow({
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_sharepointsiteid: 'site',
    wmkf_sharepointdriveid: 'drive',
    wmkf_sharepointitemid: 'missing-item',
    wmkf_sharepointversionid: '1.0',
    wmkf_sharepointetag: '"snapshot-etag"',
    wmkf_sharepointlastmodified: '2026-07-29T12:00:00Z',
  });
  requestDocumentAdapter.findByRequest.mockResolvedValue({ records: [ready] });
  request._wmkf_currentinitialassessment_value = ready.wmkf_requestdocumentid;
  GraphService.getFileMetadataById.mockResolvedValue(null);

  const result = await listInitialAssessmentArtifacts({ requestId: REQUEST_ID });

  expect(result.artifacts[0].file).toMatchObject({
    itemId: 'missing-item',
    versionId: '1.0',
    eTag: '"snapshot-etag"',
    lastModified: '2026-07-29T12:00:00Z',
    metadataStatus: 'missing',
  });
  expect(result.artifacts[0].file.metadataCheckedAt).toBeTruthy();
});

it('labels transient Graph failures without discarding the registry snapshot', async () => {
  const ready = registryRow({
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_sharepointsiteid: 'site',
    wmkf_sharepointdriveid: 'drive',
    wmkf_sharepointitemid: 'temporarily-unavailable-item',
    wmkf_sharepointversionid: '1.0',
    wmkf_sharepointetag: '"snapshot-etag"',
  });
  requestDocumentAdapter.findByRequest.mockResolvedValue({ records: [ready] });
  request._wmkf_currentinitialassessment_value = ready.wmkf_requestdocumentid;
  GraphService.getFileMetadataById.mockRejectedValue(Object.assign(
    new Error('Graph unavailable'),
    { status: 503, code: 'graph_unavailable' },
  ));
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});

  const result = await listInitialAssessmentArtifacts({ requestId: REQUEST_ID });

  expect(result.success).toBe(true);
  expect(result.artifacts[0].file).toMatchObject({
    itemId: 'temporarily-unavailable-item',
    versionId: '1.0',
    eTag: '"snapshot-etag"',
    metadataStatus: 'unavailable',
  });
  expect(warning).toHaveBeenCalledWith(
    '[initial-assessment] current SharePoint metadata unavailable',
    expect.objectContaining({
      artifactId: ready.wmkf_requestdocumentid,
      status: 503,
      code: 'graph_unavailable',
    }),
  );
});

it('labels an incomplete stable identity unavailable without guessing by path', async () => {
  const ready = registryRow({
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_sharepointdriveid: null,
    wmkf_sharepointitemid: 'item-without-drive',
    wmkf_sharepointversionid: '1.0',
  });
  requestDocumentAdapter.findByRequest.mockResolvedValue({ records: [ready] });
  request._wmkf_currentinitialassessment_value = ready.wmkf_requestdocumentid;

  const result = await listInitialAssessmentArtifacts({ requestId: REQUEST_ID });

  expect(result.artifacts[0].file).toMatchObject({
    itemId: 'item-without-drive',
    versionId: '1.0',
    metadataStatus: 'unavailable',
  });
  expect(GraphService.getFileMetadataById).not.toHaveBeenCalled();
});

it('fails closed when a non-null request pointer does not resolve to the active Ready row', async () => {
  const ready = registryRow({
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_sharepointdriveid: 'drive',
    wmkf_sharepointitemid: 'ready-item',
  });
  requestDocumentAdapter.findByRequest.mockResolvedValue({ records: [ready] });
  request._wmkf_currentinitialassessment_value = '99999999-9999-9999-9999-999999999999';

  await expect(listInitialAssessmentArtifacts({ requestId: REQUEST_ID }))
    .rejects.toThrow('invalid request-level canonical pointer');
});

it('fails closed when more than one non-superseded Ready row is active', async () => {
  const pointed = registryRow({
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_sharepointdriveid: 'drive',
    wmkf_sharepointitemid: 'pointed-item',
  });
  const duplicate = registryRow({
    wmkf_requestdocumentid: '99999999-9999-9999-9999-999999999999',
    wmkf_generationkey: '9'.repeat(64),
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_sharepointdriveid: 'drive',
    wmkf_sharepointitemid: 'duplicate-item',
  });
  requestDocumentAdapter.findByRequest.mockResolvedValue({
    records: [pointed, duplicate],
  });
  request._wmkf_currentinitialassessment_value = pointed.wmkf_requestdocumentid;

  await expect(listInitialAssessmentArtifacts({ requestId: REQUEST_ID }))
    .rejects.toThrow('invalid request-level canonical pointer');
});

it('fails closed when the request pointer targets a superseded Ready row', async () => {
  const supersededReady = registryRow({
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED,
    wmkf_sharepointdriveid: 'drive',
    wmkf_sharepointitemid: 'superseded-item',
  });
  requestDocumentAdapter.findByRequest.mockResolvedValue({
    records: [supersededReady],
  });
  request._wmkf_currentinitialassessment_value = supersededReady.wmkf_requestdocumentid;

  await expect(listInitialAssessmentArtifacts({ requestId: REQUEST_ID }))
    .rejects.toThrow('invalid request-level canonical pointer');
});

it('loads request pointers in bounded batches when a cycle contains more than 100 artifacts', async () => {
  const requestIds = Array.from({ length: 101 }, (_, index) => (
    `${String(index + 1).padStart(8, '0')}-1111-1111-1111-111111111111`
  ));
  const rows = requestIds.map((ownerRequestId, index) => registryRow({
    wmkf_requestdocumentid:
      `${String(index + 1001).padStart(8, '0')}-2222-2222-2222-222222222222`,
    wmkf_generationkey: String(index).padStart(64, '0'),
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    _wmkf_request_value: ownerRequestId,
    createdon: `2026-07-29T12:${String(index % 60).padStart(2, '0')}:00Z`,
  }));
  const rowByRequest = new Map(rows.map((row) => [row._wmkf_request_value, row]));
  requestDocumentAdapter.findByCycle.mockResolvedValue({ records: rows });
  grantRequestAdapter.findByIds.mockImplementation(async (ids) => ({
    records: ids.map((id) => ({
      ...request,
      akoya_requestid: id,
      _wmkf_currentinitialassessment_value: rowByRequest.get(id).wmkf_requestdocumentid,
    })),
  }));

  const result = await listInitialAssessmentArtifacts({ cycleCode: 'D26' });

  expect(result.artifacts).toHaveLength(101);
  expect(grantRequestAdapter.findByIds).toHaveBeenCalledTimes(3);
  expect(grantRequestAdapter.findByIds.mock.calls.map(([ids]) => ids.length))
    .toEqual([50, 50, 1]);
});

it('bounds and deduplicates current Graph metadata reads across a cycle', async () => {
  const requestIds = Array.from({ length: 10 }, (_, index) => (
    `${String(index + 1).padStart(8, '0')}-1111-1111-1111-111111111111`
  ));
  const rows = requestIds.map((ownerRequestId, index) => registryRow({
    wmkf_requestdocumentid:
      `${String(index + 2001).padStart(8, '0')}-2222-2222-2222-222222222222`,
    wmkf_generationkey: String(index).padStart(64, '0'),
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_sharepointsiteid: 'site',
    wmkf_sharepointdriveid: 'drive',
    wmkf_sharepointitemid: index === 9 ? 'item-8' : `item-${index}`,
    _wmkf_request_value: ownerRequestId,
    createdon: `2026-07-29T12:${String(index).padStart(2, '0')}:00Z`,
  }));
  const rowByRequest = new Map(rows.map((row) => [row._wmkf_request_value, row]));
  requestDocumentAdapter.findByCycle.mockResolvedValue({ records: rows });
  grantRequestAdapter.findByIds.mockImplementation(async (ids) => ({
    records: ids.map((id) => ({
      ...request,
      akoya_requestid: id,
      _wmkf_currentinitialassessment_value: rowByRequest.get(id).wmkf_requestdocumentid,
    })),
  }));
  let activeReads = 0;
  let maxActiveReads = 0;
  GraphService.getFileMetadataById.mockImplementation(async (driveId, itemId, { siteId }) => {
    activeReads += 1;
    maxActiveReads = Math.max(maxActiveReads, activeReads);
    await new Promise((resolve) => setTimeout(resolve, 1));
    activeReads -= 1;
    return {
      siteId,
      driveId,
      id: itemId,
      name: `${itemId}.docx`,
      size: 100,
      webUrl: `https://example.sharepoint.com/${itemId}`,
      eTag: `"${itemId}"`,
      versionId: '2.0',
      lastModified: '2026-07-31T01:33:55Z',
    };
  });

  const result = await listInitialAssessmentArtifacts({ cycleCode: 'D26' });

  expect(result.artifacts).toHaveLength(10);
  expect(result.artifacts.every((artifact) => artifact.file.metadataStatus === 'current'))
    .toBe(true);
  expect(GraphService.getFileMetadataById).toHaveBeenCalledTimes(9);
  expect(maxActiveReads).toBeLessThanOrEqual(8);
  expect(maxActiveReads).toBeGreaterThan(1);
});

it('stops scheduling cycle metadata reads when the total refresh budget expires', async () => {
  jest.useFakeTimers();
  const requestIds = Array.from({ length: 101 }, (_, index) => (
    `${String(index + 1).padStart(8, '0')}-1111-1111-1111-111111111111`
  ));
  const rows = requestIds.map((ownerRequestId, index) => registryRow({
    wmkf_requestdocumentid:
      `${String(index + 3001).padStart(8, '0')}-2222-2222-2222-222222222222`,
    wmkf_generationkey: String(index).padStart(64, '0'),
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_sharepointsiteid: 'site',
    wmkf_sharepointdriveid: 'drive',
    wmkf_sharepointitemid: `item-${index}`,
    _wmkf_request_value: ownerRequestId,
    createdon: `2026-07-29T12:${String(index % 60).padStart(2, '0')}:00Z`,
  }));
  const rowByRequest = new Map(rows.map((row) => [row._wmkf_request_value, row]));
  requestDocumentAdapter.findByCycle.mockResolvedValue({ records: rows });
  grantRequestAdapter.findByIds.mockImplementation(async (ids) => ({
    records: ids.map((id) => ({
      ...request,
      akoya_requestid: id,
      _wmkf_currentinitialassessment_value: rowByRequest.get(id).wmkf_requestdocumentid,
    })),
  }));
  GraphService.getFileMetadataById.mockImplementation(
    async (_driveId, _itemId, { timeoutMs }) => (
      new Promise((_resolve, reject) => {
        setTimeout(() => reject(Object.assign(new Error('timed out'), {
          code: 'graph_timeout',
        })), timeoutMs);
      })
    ),
  );
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});

  try {
    const pending = listInitialAssessmentArtifacts({ cycleCode: 'D26' });
    await jest.advanceTimersByTimeAsync(10_000);
    const result = await pending;

    expect(result.artifacts).toHaveLength(101);
    expect(result.artifacts.every((artifact) => (
      artifact.file.metadataStatus === 'unavailable'
    ))).toBe(true);
    expect(GraphService.getFileMetadataById).toHaveBeenCalledTimes(8);
    expect(Math.max(...GraphService.getFileMetadataById.mock.calls.map(
      ([, , options]) => options.timeoutMs,
    ))).toBeLessThanOrEqual(10_000);
  } finally {
    warning.mockRestore();
    jest.useRealTimers();
  }
});

it('derives staff-wide dashboard cycles from the artifact registry, not PD-scoped requests', async () => {
  requestDocumentAdapter.findArtifactCycles.mockResolvedValue({
    records: [
      { wmkf_cyclecode: 'J27', createdon: '2026-07-29T12:00:00Z' },
      { wmkf_cyclecode: 'J27', createdon: '2026-07-29T11:00:00Z' },
      { wmkf_cyclecode: 'D26', createdon: '2026-07-28T12:00:00Z' },
    ],
  });

  await expect(listInitialAssessmentCycles()).resolves.toEqual({
    success: true,
    cycles: [
      { code: 'J27', label: 'J27' },
      { code: 'D26', label: 'D26' },
    ],
    defaultCycleCode: 'J27',
  });
});
