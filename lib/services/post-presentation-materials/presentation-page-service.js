/** Minimal read model and non-buffering resolver for the materials-only page. */
import { GraphService } from '../graph-service.js';
import { ServiceHttpError } from '../service-http-error.js';
import * as accountAdapter from '../../dataverse/adapters/account.js';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import { isGuid } from '../../utils/guid.js';
import {
  REQUEST_DOCUMENT_ARTIFACT_LABEL,
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
  isPreSiteDistributionSnapshot,
} from '../../../shared/config/requestDocument.js';
import {
  materialBacking,
  materialDescriptor,
  projectPostPresentationMaterials,
} from './material-model.js';

const MATERIAL_PREFIX = 'material:';
const APPLICANT_PRODUCER = 'site-visit-materials-portal';
const POST_PRESENTATION_PRODUCER = 'meeting-tracker-post-presentation';
const APPLICANT_TYPES = new Set([
  REQUEST_DOCUMENT_ARTIFACT_TYPE.APPLICANT_SLIDES,
  REQUEST_DOCUMENT_ARTIFACT_TYPE.OTHER_APPLICANT_MATERIALS,
]);
const TRANSCRIPT_TYPES = new Map([
  ['text/vtt', '.vtt'],
  ['text/plain', '.txt'],
  ['application/pdf', '.pdf'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
]);

const REQUEST_SELECT = [
  'akoya_requestid',
  'akoya_title',
  '_akoya_applicantid_value',
];

const DEFAULT_DEPENDENCIES = Object.freeze({
  getRequest: (requestId) => grantRequestAdapter.getById(requestId, { select: REQUEST_SELECT }),
  getAccount: (accountId) => accountAdapter.getById(accountId, { select: ['name'] }),
  findDocuments: (requestId) => requestDocumentAdapter.findByRequest(requestId),
  resolveMediaDownloadUrl: (driveId, itemId) => GraphService.resolveMediaDownloadUrl(driveId, itemId),
});

function sameId(left, right) {
  return String(left || '').toLowerCase() === String(right || '').toLowerCase();
}

function notFound() {
  return new ServiceHttpError('not found', { httpStatus: 404, body: { ok: false, reason: 'not_found' } });
}

async function loadRequest(requestId, dependencies) {
  if (!isGuid(requestId)) throw notFound();
  let request;
  try { request = await dependencies.getRequest(requestId); } catch (error) {
    if (error?.status === 404 || /Get record failed \(404\)/.test(error?.message || '')) throw notFound();
    throw error;
  }
  if (!request || !sameId(request.akoya_requestid, requestId)) throw notFound();
  return request;
}

function eligibleApplicantRows(rows, requestId) {
  return (rows || []).filter((row) => (
    sameId(row?._wmkf_request_value, requestId)
    && APPLICANT_TYPES.has(Number(row.wmkf_artifacttype))
    && row.wmkf_producer === APPLICANT_PRODUCER
    && row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
    && row.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED
    && !isPreSiteDistributionSnapshot(row)
    && materialBacking(row).kind === 'file'
  ));
}

function eligiblePresentationRows(rows, requestId) {
  return projectPostPresentationMaterials(rows, requestId).winners
    .filter((row) => row.wmkf_producer === POST_PRESENTATION_PRODUCER);
}

function pageDescriptor(row) {
  const descriptor = materialDescriptor(row);
  return {
    member: descriptor.member,
    label: descriptor.artifactTypeLabel,
    filename: descriptor.filename,
    contentType: descriptor.contentType,
    size: descriptor.size,
    backing: descriptor.backing,
    canWatch: Number(row.wmkf_artifacttype) === REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING,
    canDownload: descriptor.backing === 'file',
  };
}

function applicantDescriptor(row) {
  const size = Number(row.wmkf_filesize);
  return {
    member: `${MATERIAL_PREFIX}${row.wmkf_requestdocumentid}`,
    label: REQUEST_DOCUMENT_ARTIFACT_LABEL[row.wmkf_artifacttype] || 'Material',
    filename: row.wmkf_filename || row.wmkf_name || 'Material',
    contentType: row.wmkf_contenttype || null,
    size: Number.isFinite(size) && size > 0 ? size : null,
    backing: 'file',
    canWatch: false,
    canDownload: true,
  };
}

function currentRows(rows, requestId) {
  return [
    ...eligibleApplicantRows(rows, requestId),
    ...eligiblePresentationRows(rows, requestId),
  ];
}

export async function buildPresentationContext(
  { requestId, link },
  dependencies = DEFAULT_DEPENDENCIES,
) {
  const request = await loadRequest(requestId, dependencies);
  let institution = request['_akoya_applicantid_value_formatted'] || null;
  if (request._akoya_applicantid_value) {
    try {
      institution = (await dependencies.getAccount(request._akoya_applicantid_value))?.name || institution;
    } catch { /* display fallback only */ }
  }
  const result = await dependencies.findDocuments(requestId);
  const applicant = eligibleApplicantRows(result?.records || [], requestId).map(applicantDescriptor);
  const followUp = eligiblePresentationRows(result?.records || [], requestId).map(pageDescriptor);
  return {
    ok: true,
    title: institution || 'Research presentation materials',
    proposalTitle: request.akoya_title || null,
    expiresAt: link?.expires_at instanceof Date ? link.expires_at.toISOString() : link?.expires_at || null,
    materials: [...applicant, ...followUp],
  };
}

function validateFileMode(row, mode, mimeType, filename) {
  const artifactType = Number(row.wmkf_artifacttype);
  if (mode === 'watch') {
    if (artifactType !== REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING
      || mimeType !== 'video/mp4' || !/\.mp4$/i.test(filename)) throw notFound();
    return;
  }
  if (artifactType === REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING
    && (mimeType !== 'video/mp4' || !/\.mp4$/i.test(filename))) throw notFound();
  if ([REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT, REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT_SUMMARY].includes(artifactType)) {
    const extension = TRANSCRIPT_TYPES.get(mimeType);
    if (!extension || !filename.toLowerCase().endsWith(extension)) throw notFound();
  }
}

export async function resolvePresentationMember(
  { requestId, member, mode = 'open' },
  dependencies = DEFAULT_DEPENDENCIES,
) {
  if (!isGuid(requestId) || typeof member !== 'string' || member.length > 60
    || !member.startsWith(MATERIAL_PREFIX)
    || !['open', 'watch', 'download'].includes(mode)) throw notFound();
  const documentId = member.slice(MATERIAL_PREFIX.length);
  if (!isGuid(documentId)) throw notFound();
  await loadRequest(requestId, dependencies);
  const result = await dependencies.findDocuments(requestId);
  const row = currentRows(result?.records || [], requestId)
    .find((candidate) => sameId(candidate.wmkf_requestdocumentid, documentId));
  if (!row) throw notFound();
  const backing = materialBacking(row);
  if (backing.kind === 'external') {
    if (Number(row.wmkf_artifacttype) !== REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING
      || mode === 'download') throw notFound();
    return { kind: 'external', redirectUrl: backing.url };
  }
  if (backing.kind !== 'file') throw notFound();
  const media = await dependencies.resolveMediaDownloadUrl(
    row.wmkf_sharepointdriveid,
    row.wmkf_sharepointitemid,
  );
  if (media.malware || !sameId(media.driveId, row.wmkf_sharepointdriveid)
    || !sameId(media.itemId, row.wmkf_sharepointitemid)) throw notFound();
  const mimeType = media.mimeType || row.wmkf_contenttype || 'application/octet-stream';
  const filename = media.filename || row.wmkf_filename || row.wmkf_name || 'Material';
  validateFileMode(row, mode, mimeType, filename);
  let redirect;
  try { redirect = new URL(media.downloadUrl); } catch { throw notFound(); }
  if (redirect.protocol !== 'https:' || redirect.username || redirect.password) throw notFound();
  return { kind: 'file', redirectUrl: redirect.toString(), filename, mimeType };
}

export const _internal = {
  APPLICANT_PRODUCER,
  POST_PRESENTATION_PRODUCER,
  currentRows,
  eligibleApplicantRows,
  eligiblePresentationRows,
};
