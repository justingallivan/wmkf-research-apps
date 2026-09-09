/**
 * @jest-environment node
 */
jest.mock('../../lib/dataverse/adapters/request-document.js', () => ({ findByCycle: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({ findByIds: jest.fn() }));

import * as requestDocumentAdapter from '../../lib/dataverse/adapters/request-document.js';
import * as grantRequestAdapter from '../../lib/dataverse/adapters/grant-request.js';
import { listPreSiteVisitDrafts } from '../../lib/services/pre-site-visit/cycle-list-service';
import {
  PRE_SITE_VISIT_CONTRACT,
  PRE_SITE_DISTRIBUTION_CONTRACT,
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../shared/config/requestDocument';

const R1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const R2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const WORD = PRE_SITE_VISIT_CONTRACT.contentType;

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

function request(id, overrides = {}) {
  return {
    akoya_requestid: id,
    akoya_requestnum: id === R1 ? '1002959' : '1003001',
    akoya_title: 'Title',
    _akoya_applicantid_value_formatted: 'Uni',
    _wmkf_programdirector_value_formatted: 'PD',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  grantRequestAdapter.findByIds.mockImplementation(async (ids) => ({
    records: ids.map((id) => request(id, id === R1 ? { _wmkf_currentpresitevisit_value: 'CURRENT' } : {})),
  }));
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
  expect(result.artifacts).toHaveLength(2);
  const [first, second] = result.artifacts;
  expect(first).toMatchObject({ artifactId: 'current', requestNumber: '1002959', isCurrent: true, lifecycleLabel: 'Review', operationLabel: 'Ready', institution: 'Uni', programDirector: 'PD' });
  expect(first.file).toMatchObject({ webUrl: 'https://sp/doc.docx', name: 'doc.docx', metadataStatus: 'unchecked' });
  expect(second).toMatchObject({ artifactId: 'r2-fail', requestNumber: '1003001', isCurrent: false, operationLabel: 'Failed', file: null });
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
