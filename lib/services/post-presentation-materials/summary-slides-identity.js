/**
 * Which applicant slide PDF a presentation summary run picked, and whether the
 * slides on file now differ (docs/plans/STAFF_APPLICANT_MATERIALS_REPLACEMENT_PLAN_2026-10-05.md
 * §3.5). Kept free of Graph/Blob imports so the Staff Deliberations feed can
 * use it. Staff-only signal; outside pages never read it.
 */
import {
  REQUEST_DOCUMENT_ARTIFACT_TYPE, REQUEST_DOCUMENT_LIFECYCLE_STATE, REQUEST_DOCUMENT_OPERATION_STATUS,
  isPreSiteDistributionSnapshot,
} from '../../../shared/config/requestDocument.js';
import { isGuid } from '../../utils/guid.js';
import { materialBacking } from './material-model.js';
import * as draftStore from './summary-draft-store.js';

const { APPLICANT_SLIDES, TRANSCRIPT_SUMMARY } = REQUEST_DOCUMENT_ARTIFACT_TYPE;
// Applicant and staff uploads both keep the portal producer (staff replacement plan §3.2).
const APPLICANT_PRODUCER = 'site-visit-materials-portal';
const SHA256_HEX = /^[0-9a-f]{64}$/;

function sameId(left, right) {
  return String(left || '').toLowerCase() === String(right || '').toLowerCase();
}

/** The newest Ready applicant slide PDF with a verifiable content hash, or null. */
export function pickSlidesRow(rows, requestId) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => sameId(row?._wmkf_request_value, requestId)
      && Number(row.wmkf_artifacttype) === APPLICANT_SLIDES
      && row.wmkf_producer === APPLICANT_PRODUCER
      && row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
      && row.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED
      && !isPreSiteDistributionSnapshot(row)
      && materialBacking(row).kind === 'file'
      && String(row.wmkf_contenttype || '').toLowerCase().startsWith('application/pdf')
      && SHA256_HEX.test(String(row.wmkf_contenthash || '')))
    .sort((a, b) => String(b.createdon || '').localeCompare(String(a.createdon || '')))[0] || null;
}

export const SUMMARY_SLIDES_DEPENDENCIES = Object.freeze({ drafts: draftStore });

/**
 * True when the published summary's run picked different slides than are on file now
 * (replaced, newly added, or removed); false when they match; null when unknown (no
 * published summary, or a run from before migration 071).
 */
export async function presentationSummarySlidesChanged({ requestId, rows, publishedArtifactId }, dependencies = SUMMARY_SLIDES_DEPENDENCIES) {
  if (!isGuid(publishedArtifactId || '')) return null;
  const run = await dependencies.drafts.getPublishedSummaryDraft({ requestId, artifactType: TRANSCRIPT_SUMMARY, publishedArtifactId });
  if (!run || run.slides_recorded !== true) return null;
  const current = pickSlidesRow(rows, requestId);
  const recordedId = run.slides_artifact_id || null;
  if (!current || !recordedId) return Boolean(current) !== Boolean(recordedId);
  return !sameId(current.wmkf_requestdocumentid, recordedId) || current.wmkf_contenthash !== run.slides_content_hash;
}
