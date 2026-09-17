/**
 * Guarded regeneration of a Pre-RP Brief already sent to the Board.
 *
 * docs/plans/PRE_RESEARCH_PRESENTATION_BRIEF_PLAN_2026-09-16.md §10 (owner
 * decision 2026-09-16). Mirrors the shape of the Pre-Site guarded reopen
 * (lib/services/pre-site-visit/reopen-service.js) — superuser-only, six exact
 * body fields, an audited successor row — but does not copy bytes: the brief
 * always re-renders deterministically from the frozen input snapshot, so
 * this service validates the guarded-reopen preconditions and then delegates
 * to the ordinary `generatePreRpBrief` claim/render/upload/activate lineage
 * with its `reopen` option, rather than re-implementing that lineage here.
 *
 * Design choice (brief §1a): `validateInput` here mirrors, rather than
 * imports, the Pre-Site `validateInput` — the acceptance contract for this
 * feature wants `brief_reopen_*` codes, not `pre_site_reopen_*`, and the two
 * services validate different artifact identities.
 *
 * The in-flight refusal below has no code named in the design brief; this
 * picks `brief_reopen_in_flight` (409).
 */

import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import { ServiceHttpError } from '../service-http-error.js';
import { isGuardedReopenSchemaReady } from '../../utils/guarded-reopen-readiness.js';
import { isGuid } from '../../utils/guid.js';
import {
  attemptIsInFlight,
  generatePreRpBrief,
  projectPreRpBriefArtifact,
  resolveCanonicalPreRpBriefRow,
} from './artifact-service.js';
import {
  hasSentAttemptForSource,
  listDistributionAttempts,
} from '../pre-site-visit/distribution-store.js';
import {
  PRE_SITE_REOPEN_CONTRACT,
  PRE_SITE_REOPEN_REASON,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../../shared/config/requestDocument.js';

// resolveCanonicalPreRpBriefRow only reads `getRequest`/`findByRequest`
// (artifact-service.js:296-298); this select adds `akoya_requestnum`, which
// the artifact service's own lineage select omits since ordinary generation
// never needs it.
const REQUEST_SELECT = [
  'akoya_requestid',
  'akoya_requestnum',
  '_wmkf_currentprerpbrief_value',
].join(',');

const DEFAULT_DEPENDENCIES = Object.freeze({
  getRequest: (requestId) => grantRequestAdapter.getById(requestId, { select: REQUEST_SELECT }),
  findByRequest: requestDocumentAdapter.findByRequest,
  resolveCanonicalPreRpBriefRow,
  hasSentAttemptForSource,
  listDistributionAttempts,
  generatePreRpBrief,
  isGuardedReopenSchemaReady,
});

function sameId(left, right) {
  return Boolean(left) && Boolean(right)
    && String(left).toLowerCase() === String(right).toLowerCase();
}

function reopenError(message, code, httpStatus = 409, extra = {}) {
  return new ServiceHttpError(message, {
    httpStatus,
    code,
    body: { error: message, code, ...extra },
  });
}

function validateInput(input) {
  const requestId = String(input?.requestId || '').trim();
  const expectedArtifactId = String(input?.expectedArtifactId || '').trim();
  const clientOperationId = String(input?.clientOperationId || '').trim();
  const requestNumber = String(input?.requestNumber || '').trim();
  const reasonCode = String(input?.reasonCode || '').trim();
  const reasonNote = String(input?.reasonNote || '').trim();
  if (!isGuid(requestId) || !isGuid(expectedArtifactId) || !isGuid(clientOperationId)) {
    throw reopenError(
      'Valid request, artifact, and client operation IDs are required.',
      'brief_reopen_invalid_identity',
      400,
    );
  }
  if (!requestNumber || requestNumber.length > 80) {
    throw reopenError('A typed request number is required.', 'brief_reopen_request_number_invalid', 400);
  }
  if (!Object.values(PRE_SITE_REOPEN_REASON).includes(reasonCode)) {
    throw reopenError('Select a valid reopen reason.', 'brief_reopen_reason_invalid', 400);
  }
  if (reasonNote.length < PRE_SITE_REOPEN_CONTRACT.minimumReasonNoteLength
    || reasonNote.length > PRE_SITE_REOPEN_CONTRACT.maximumReasonNoteLength) {
    throw reopenError(
      `The reopen note must be ${PRE_SITE_REOPEN_CONTRACT.minimumReasonNoteLength}`
        + `-${PRE_SITE_REOPEN_CONTRACT.maximumReasonNoteLength} characters.`,
      'brief_reopen_note_invalid',
      400,
    );
  }
  return { requestId, expectedArtifactId, clientOperationId, requestNumber, reasonCode, reasonNote };
}

/**
 * Guarded regeneration of a brief already locked for Share (Review) and
 * already sent to the Board. All validation below is read-only; the only
 * write is the delegated `generatePreRpBrief` call in the last step.
 */
export async function reopenSentPreRpBrief(
  inputValue,
  { actingUserSystemId = null } = {},
  dependencies = DEFAULT_DEPENDENCIES,
) {
  const input = validateInput(inputValue);

  if (!dependencies.isGuardedReopenSchemaReady?.()) {
    throw reopenError(
      'Guarded reopen is unavailable until its Dataverse schema is verified.',
      'brief_reopen_schema_not_ready',
      503,
    );
  }

  const { request, row: currentRow } = await dependencies.resolveCanonicalPreRpBriefRow(input.requestId, {
    getRequest: dependencies.getRequest,
    findByRequest: dependencies.findByRequest,
  });

  // Idempotent retry: an exact resubmission of the same clientOperationId
  // after a first guarded reopen already succeeded finds the pointer moved
  // to that reopen's own successor row (which carries the cycle id). Mirrors
  // Pre-Site's audit-row replay (reopen-service.js findAuditRow/
  // committedResult) — without it, a retry's `expectedArtifactId` (the
  // pre-reopen row) can never match the new current row and every retry
  // would be refused as stale instead of returning `reused: true`.
  //
  // Codex adversarial review finding 2c: a matching cycle id alone is not
  // enough to call this the SAME operation replaying — the reason/note and
  // the superseded source (`wmkf_SourceDocument`, written at creation) must
  // also match exactly, else this is a different, unrelated operation that
  // happens to reuse a clientOperationId and must fail closed rather than
  // silently returning someone else's successor.
  if (currentRow && sameId(currentRow.wmkf_reopencycleid, input.clientOperationId)) {
    const auditMatches = currentRow.wmkf_reopenreasoncode === input.reasonCode
      && currentRow.wmkf_reopenreasonnote === input.reasonNote
      && sameId(currentRow._wmkf_sourcedocument_value, input.expectedArtifactId);
    if (!auditMatches) {
      throw reopenError(
        'This client operation id is already bound to different reopen inputs.',
        'brief_reopen_audit_mismatch',
        409,
      );
    }
    return { artifact: projectPreRpBriefArtifact(currentRow), reused: true };
  }

  if (!currentRow || !sameId(currentRow.wmkf_requestdocumentid, input.expectedArtifactId)) {
    throw reopenError(
      'This Pre-RP Brief has changed since this dialog opened. Reload and try again.',
      'brief_reopen_stale',
      409,
    );
  }
  if (currentRow.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW
    || currentRow.wmkf_operationstatus !== REQUEST_DOCUMENT_OPERATION_STATUS.READY) {
    throw reopenError(
      'This Pre-RP Brief is not currently shared, so it cannot be reopened this way.',
      'brief_reopen_not_shared',
      409,
    );
  }
  if (String(request?.akoya_requestnum || '').trim() !== input.requestNumber) {
    throw reopenError(
      'The typed request number does not match the current request.',
      'brief_reopen_request_number_mismatch',
      409,
    );
  }

  const sourceDocumentId = currentRow.wmkf_requestdocumentid;
  let sent;
  let attempts;
  try {
    [sent, attempts] = await Promise.all([
      dependencies.hasSentAttemptForSource(input.requestId, sourceDocumentId),
      dependencies.listDistributionAttempts(input.requestId, { limit: 100 }),
    ]);
  } catch {
    throw reopenError(
      'Pre-RP Brief distribution state could not be verified.',
      'brief_distribution_state_unavailable',
      503,
    );
  }
  if (!Array.isArray(attempts)) {
    throw reopenError(
      'Pre-RP Brief distribution state could not be verified.',
      'brief_distribution_state_unavailable',
      503,
    );
  }
  if (!sent) {
    throw reopenError(
      'This Pre-RP Brief has not been sent to the Board yet. Use the ordinary Regenerate Brief action instead.',
      'brief_reopen_not_sent',
      409,
    );
  }
  if (attempts.some((attempt) => attemptIsInFlight(attempt, sourceDocumentId))) {
    throw reopenError(
      'A send for this Pre-RP Brief is already in progress and it cannot be reopened right now.',
      'brief_reopen_in_flight',
      409,
    );
  }
  // The shared reader is display-bounded; refuse rather than infer absence
  // from a full page whose older rows were not inspected (same reasoning as
  // assertCurrentBriefReplaceable in artifact-service.js).
  if (attempts.length >= 100) {
    throw reopenError(
      'Pre-RP Brief distribution state could not be verified.',
      'brief_distribution_state_unavailable',
      503,
    );
  }

  return dependencies.generatePreRpBrief({
    requestId: input.requestId,
    clientOperationId: input.clientOperationId,
    actingUserSystemId,
    reopen: {
      cycleId: input.clientOperationId,
      // The exact row this operation was authorized against (== currentRow,
      // already confirmed to equal input.expectedArtifactId above).
      // generatePreRpBrief re-verifies its own pointer read against this
      // value before any claim (Codex adversarial review finding 1).
      sourceArtifactId: currentRow.wmkf_requestdocumentid,
      reasonCode: input.reasonCode,
      reasonNote: input.reasonNote,
    },
  });
}

export { validateInput };
