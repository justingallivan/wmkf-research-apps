/** Server-selected ordinary Research sources; no stage/PD acknowledgement prerequisite. */
import crypto from 'node:crypto';
import * as requests from '../../dataverse/adapters/grant-request.js';
import * as documents from '../../dataverse/adapters/request-document.js';
import { meetingDateToCycleCode, cycleCodeToOdataFilter } from '../../utils/cycle-code.js';
import { TEST_REQUEST_ORDINARY_OData_FILTER } from '../test-requests/isolation.js';
import { REQUEST_DOCUMENT_ARTIFACT_TYPE as TYPE, REQUEST_DOCUMENT_OPERATION_STATUS as OP, REQUEST_DOCUMENT_LIFECYCLE_STATE as LIFE, FINAL_WRITEUP_CONTRACT } from '../../../shared/config/requestDocument.js';
import { requestInstitution } from '../../../shared/utils/institution.js';
import { GraphService } from '../graph-service.js';
import { hashGovernedDocxContent } from '../documents/governed-docx-hash.js';
import { PROGRAM_ID, MAX_BYTES, cycleCode, guid, fail, filename } from './model.js';
export const REQUEST_SELECT = ['akoya_requestid', 'akoya_requestnum', '_akoya_applicantid_value', '_wmkf_programdirector_value', '_wmkf_grantprogram_value', '_wmkf_currentfinalwriteup_value', '_wmkf_currentpresitevisit_value', 'wmkf_meetingdate', 'wmkf_istestrequest', 'wmkf_testcreationrunid'].join(',');
export const sourceDependencies = { getRequest: id => requests.getById(id, { select: REQUEST_SELECT }), queryRequests: options => requests.queryAllRequests(options), getDocuments: ids => documents.findByIds(ids), findHistory: id => documents.findByRequest(id, { artifactType: TYPE.FINAL_WRITEUP }), metadata: (...args) => GraphService.getFileMetadataById(...args), download: (...args) => GraphService.downloadFile(...args), hash: hashGovernedDocxContent };
export function ordinary(request, cycle) {
  return request && request._wmkf_grantprogram_value?.toLowerCase() === PROGRAM_ID && meetingDateToCycleCode(request.wmkf_meetingdate) === cycle
    && (request.wmkf_istestrequest === false || request.wmkf_istestrequest === null) && request.wmkf_testcreationrunid === null;
}
export function requestLabels(request) { return { number: request.akoya_requestnum, institution: requestInstitution(request), leadPD: request._wmkf_programdirector_value_formatted || 'Not assigned' }; }
export async function candidates(cycle, overrides = {}) {
  const d = { ...sourceDependencies, ...overrides };
  const result = await d.queryRequests({ select: REQUEST_SELECT, filter: `_wmkf_grantprogram_value eq ${PROGRAM_ID} and (${cycleCodeToOdataFilter(cycleCode(cycle))}) and ${TEST_REQUEST_ORDINARY_OData_FILTER}`, orderby: 'akoya_requestnum asc' });
  if (result.capped || result.records.length > 1000) fail('board_roster_scan_capped');
  return result.records.filter(row => ordinary(row, cycle)).map(row => ({ requestId: row.akoya_requestid.toLowerCase(), ...requestLabels(row) }));
}
export async function sourceFor(cycle, requestId, overrides = {}) {
  const d = { ...sourceDependencies, ...overrides };
  const request = await d.getRequest(guid(requestId));
  if (!ordinary(request, cycle) || request.akoya_requestid?.toLowerCase() !== requestId.toLowerCase()) fail('board_request_ineligible', 'Request is not an ordinary Research proposal in this cycle.');
  const finalId = request._wmkf_currentfinalwriteup_value;
  const id = finalId || request._wmkf_currentpresitevisit_value;
  if (!id) return { request, source: null };
  guid(id);
  const result = await d.getDocuments([id]);
  const records = result.records || [];
  if (result.capped || records.length !== 1) fail('board_source_ambiguous');
  const row = records[0];
  if (row.wmkf_requestdocumentid?.toLowerCase() !== id.toLowerCase() || row._wmkf_request_value?.toLowerCase() !== requestId.toLowerCase()
    || row.wmkf_artifacttype !== (finalId ? TYPE.FINAL_WRITEUP : TYPE.PRE_SITE_VISIT) || row.wmkf_cyclecode !== cycle
    || row.wmkf_operationstatus !== OP.READY || row.wmkf_lifecyclestate === LIFE.SUPERSEDED
    || row.wmkf_contenttype !== FINAL_WRITEUP_CONTRACT.contentType || !row.wmkf_sharepointdriveid || !row.wmkf_sharepointitemid) fail('board_source_invalid', 'The current writeup is unavailable or not ready.');
  const metadata = await d.metadata(row.wmkf_sharepointdriveid, row.wmkf_sharepointitemid);
  if (!metadata?.eTag || !metadata.versionId || !(metadata.size > 0 && metadata.size <= MAX_BYTES)) fail('board_source_invalid');
  const source = { documentId: id.toLowerCase(), driveId: row.wmkf_sharepointdriveid, itemId: row.wmkf_sharepointitemid, eTag: metadata.eTag, versionId: metadata.versionId,
    size: metadata.size, webUrl: metadata.webUrl, earlyDraft: !finalId && [LIFE.DRAFT, LIFE.REVIEW].includes(row.wmkf_lifecyclestate), stage: finalId ? (row.wmkf_leadershipreviewstartedat ? 'Leadership review' : 'Group review') : 'Drafting',
    filename: filename(request.akoya_requestnum, requestInstitution(request)), ...requestLabels(request) };
  return { request, source };
}
export function sourceMatches(a, b) {
  return a && b && ['documentId', 'driveId', 'itemId', 'eTag', 'versionId'].every(key => a[key] === b[key]);
}
export async function approvedBytes(source, overrides = {}) {
  const d = { ...sourceDependencies, ...overrides };
  const before = await d.metadata(source.driveId, source.itemId);
  if (!before || before.eTag !== source.eTag || before.versionId !== source.versionId) fail('board_source_changed', 'The document changed. Review and select it again.');
  const { buffer } = await d.download(source.driveId, source.itemId, { maxBytes: MAX_BYTES });
  const after = await d.metadata(source.driveId, source.itemId);
  if (!after || after.eTag !== source.eTag || after.versionId !== source.versionId || buffer.length !== Number(after.size)) fail('board_source_changed');
  return { buffer, hash: await d.hash(buffer), byteHash: crypto.createHash('sha256').update(buffer).digest('hex') };
}
export async function earliestHandoff(cycle, ids, overrides = {}) {
  const d = { ...sourceDependencies, ...overrides };
  let earliest = null;
  for (const id of ids) {
    if (!ordinary(await d.getRequest(id), cycle)) fail('board_cycle_membership_changed');
    const history = await d.findHistory(id);
    if (history.capped) fail('board_handoff_history_capped');
    for (const row of history.records || []) {
      const at = row.wmkf_leadershipreviewstartedat;
      if (row.wmkf_cyclecode === cycle && row._wmkf_request_value?.toLowerCase() === id && Number.isFinite(Date.parse(at)) && Date.parse(at) <= Date.now() && (!earliest || Date.parse(at) < Date.parse(earliest))) earliest = at;
    }
  }
  return earliest;
}
