/**
 * Pre-Research Presentation Brief input projection.
 *
 * Pure request/roster -> frozen snapshot envelope builder
 * (docs/plans/PRE_RESEARCH_PRESENTATION_BRIEF_PLAN_2026-09-16.md §3.4a).
 * Read-only: no writes, no claim, no render. Called before any generation
 * claim is created, so a data-completeness failure (e.g. a missing
 * abstract) has no durable side effect — the same ordering Pre-Site uses
 * (lib/services/pre-site-visit/artifact-service.js
 * generatePreSiteVisitArtifact: inputs are loaded and validated before a
 * row is claimed).
 *
 * Institution resolution mirrors the briefing page's fail-soft pattern
 * (lib/services/deliberation-briefing/briefing-page-service.js loadHeader):
 * default to the applicant lookup's formatted value, then prefer the
 * resolved Account name when the lookup succeeds, keeping the annotation
 * name on a lookup failure — a display label, not an access decision.
 */

import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as accountAdapter from '../../dataverse/adapters/account.js';
import { getWriteupRoster } from '../review-manager/reviewers-service.js';
import { isGuid } from '../../utils/guid.js';
import { meetingDateToCycleCode } from '../../utils/cycle-code.js';
import { ServiceHttpError } from '../service-http-error.js';
import {
  PRE_RP_BRIEF_CONTRACT,
} from '../../../shared/config/requestDocument.js';

const REQUEST_SELECT = [
  'akoya_requestid',
  'akoya_requestnum',
  'akoya_title',
  '_akoya_applicantid_value',
  '_akoya_applicantid_value_formatted',
  '_wmkf_projectleader_value_formatted',
  '_wmkf_programdirector_value_formatted',
  'wmkf_abstract',
  'wmkf_meetingdate',
].join(',');

const DEFAULT_DEPENDENCIES = Object.freeze({
  getRequest: (requestId) => grantRequestAdapter.getById(requestId, { select: REQUEST_SELECT }),
  getAccount: (accountId) => accountAdapter.getById(accountId, { select: 'name' }),
  getWriteupRoster: (requestId) => getWriteupRoster({ requestId }),
});

function trimmedOrNull(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

/**
 * Load and validate every input the brief needs, and build the frozen
 * snapshot envelope the renderer and fingerprint both consume.
 *
 * @returns {Promise<{requestNumber: string, cycleCode: string, envelope: object}>}
 */
export async function loadPreRpBriefInputs({ requestId }, dependencies = DEFAULT_DEPENDENCIES) {
  if (!isGuid(requestId)) {
    throw new ServiceHttpError('A valid requestId is required.', {
      httpStatus: 400,
      code: 'invalid_request_id',
    });
  }

  const request = await dependencies.getRequest(requestId);
  if (!request || String(request.akoya_requestid || '').toLowerCase() !== requestId.toLowerCase()) {
    throw new ServiceHttpError('The request could not be resolved.', {
      httpStatus: 404,
      code: 'pre_rp_brief_request_not_found',
    });
  }

  const cycleCode = meetingDateToCycleCode(request.wmkf_meetingdate);
  if (!cycleCode) {
    throw new ServiceHttpError('The request needs a meeting-date cycle before generating the brief.', {
      httpStatus: 409,
      code: 'pre_rp_brief_cycle_missing',
    });
  }

  const abstract = trimmedOrNull(request.wmkf_abstract);
  if (!abstract) {
    throw new ServiceHttpError('Add the abstract on the Reviews tab first.', {
      httpStatus: 409,
      code: 'pre_rp_brief_abstract_missing',
      body: {
        error: 'Add the abstract on the Reviews tab first.',
        code: 'pre_rp_brief_abstract_missing',
      },
    });
  }

  let institutionName = trimmedOrNull(request._akoya_applicantid_value_formatted);
  if (request._akoya_applicantid_value) {
    try {
      const account = await dependencies.getAccount(request._akoya_applicantid_value);
      institutionName = trimmedOrNull(account?.name) || institutionName;
    } catch {
      // Keep the annotation name; institution is a display label here, not
      // an access decision, matching the briefing page's own fallback.
    }
  }

  // getWriteupRoster returns { reviewers, blockers } (reviewers-service.js);
  // the envelope's field is named `reviews` (plan §3.4a).
  const { reviewers: reviews } = await dependencies.getWriteupRoster(requestId);

  return {
    requestNumber: request.akoya_requestnum,
    cycleCode,
    envelope: {
      schemaVersion: PRE_RP_BRIEF_CONTRACT.snapshotSchemaVersion,
      artifactType: PRE_RP_BRIEF_CONTRACT.snapshotArtifactType,
      request: {
        institutionName,
        projectTitle: trimmedOrNull(request.akoya_title),
        principalInvestigator: trimmedOrNull(request._wmkf_projectleader_value_formatted),
        programDirector: trimmedOrNull(request._wmkf_programdirector_value_formatted),
        abstract,
      },
      reviews,
    },
  };
}

export { DEFAULT_DEPENDENCIES };
