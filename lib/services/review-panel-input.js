/**
 * Virtual Review Panel Phase A input resolver.
 * docs/plans/VIRTUAL_REVIEW_PANEL_PHASE_A_BUILD_PLAN_2026-09-12.md §5 A.4 (D2: proposal narrative only).
 *
 * A DEDICATED resolver, not cycle-dossier-generation.js's prepareRequestInput,
 * because that function bundles the four `priorAiContext` memos
 * (wmkf_ai_fitrationale/summary/dataextract/fieldprimer) that D2 excludes from
 * Phase A. This module never selects those columns and never calls
 * parseAiContext. The DTO is built from an explicit object literal (never a
 * spread of the request row) so an accidental extra column on the row can
 * never reach the prompt, the snapshot, or Blob storage.
 */
import { createHash } from 'crypto';
import * as grantRequestAdapter from '../dataverse/adapters/grant-request.js';
import { getAiProposalNarrativeText } from './workbench-proposal-documents.js';
import { isGuid } from '../utils/guid.js';

export const REVIEW_PANEL_MAX_NARRATIVE_CHARS = 100000;

// Exact key allowlist for the input DTO. Exported so tests and the snapshot
// builder can assert the DTO never gains an extra key.
export const REVIEW_PANEL_INPUT_KEYS = Object.freeze(['requestId', 'requestNumber', 'narrative', 'institution', 'title']);
export const REVIEW_PANEL_NARRATIVE_KEYS = Object.freeze(['text', 'sha256', 'sourcePath']);

// Deliberately excludes wmkf_ai_fitrationale/summary/dataextract/fieldprimer (the four D2-excluded memos).
const REQUEST_SELECT = ['akoya_requestid', 'akoya_requestnum', 'akoya_title', '_akoya_applicantid_value'].join(',');

export class ReviewPanelInputError extends Error {
  constructor(message, code = 'review_panel_input_invalid') {
    super(message);
    this.name = 'ReviewPanelInputError';
    this.code = code;
  }
}

const text = (value, max = 1000) => String(value ?? '').trim().slice(0, max);
const sha256 = (value) => createHash('sha256').update(String(value || '')).digest('hex');

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freezeDeep);
  return Object.freeze(value);
}

/** Resolve and freeze the exact review-panel input DTO: proposal narrative plus request identity, nothing else. */
export async function prepareReviewPanelInput(requestId, { requestNumber = null } = {}) {
  if (!isGuid(requestId)) throw new ReviewPanelInputError('requestId must be a valid GUID');
  const row = await grantRequestAdapter.getById(requestId, { select: REQUEST_SELECT });
  if (!row) throw new ReviewPanelInputError('Request was not found', 'review_panel_request_missing');
  const number = text(requestNumber || row.akoya_requestnum, 120);
  if (!number) throw new ReviewPanelInputError('Request is missing its request number');
  const narrative = await getAiProposalNarrativeText(requestId, number);
  if (!narrative?.text || narrative.text.trim().length < 100) {
    throw new ReviewPanelInputError('The exact Proposal Narrative is missing or too short', 'review_panel_narrative_missing');
  }
  if (narrative.text.length > REVIEW_PANEL_MAX_NARRATIVE_CHARS) {
    throw new ReviewPanelInputError('The exact Proposal Narrative exceeds the supported context bound', 'review_panel_narrative_too_large');
  }
  const sourcePath = [narrative.siteId, narrative.driveId, narrative.itemId].filter(Boolean).join('/') || text(narrative.filename, 500);
  const dto = {
    requestId,
    requestNumber: number,
    narrative: {
      text: narrative.text,
      sha256: narrative.contentHash || sha256(narrative.text),
      sourcePath,
    },
    // Applicant lookup only: wmkf_organizationname is a Bill.com field (PR #201 decision, mirrors cycle-dossier-generation.js).
    institution: text(row._akoya_applicantid_value_formatted, 1000),
    title: text(row.akoya_title, 1000),
  };
  return freezeDeep(dto);
}
