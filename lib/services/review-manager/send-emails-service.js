/**
 * Review Manager — reviewer email send service
 * (Route→Service Consolidation Plan, stage 2b — Decision 1a streaming route,
 * following the ratified 2s streaming template).
 *
 * Holds ALL business logic for POST /api/review-manager/send-emails; the
 * route is a thin shell (method dispatch, auth guard, sender-identity check,
 * rate limit, ALL SSE framing — headers, `event:`/`data:` serialization,
 * `res.end()` — and one `withDalContext('review-manager-send', …)` around
 * the single service call).
 *
 * Streaming contract (plan Decision 1a):
 *   - takes a plain argument object, never req/res;
 *   - emits every SSE event through `onEvent({ event, data })` — the shell
 *     owns serialization and the wire;
 *   - NEVER THROWS for flow errors: every fail-closed input guard (drafts
 *     shape, unknown templateType, GUID validation, delivery-mode
 *     misconfiguration) and the generic mid-batch failure emit ONE terminal
 *     `error` event and RESOLVE — the guards run in the exact pre-extraction
 *     order (drafts array → templateType → button label → delivery mode →
 *     per-draft field/GUID loop) so the characterization suite's event
 *     contract is byte-identical;
 *   - non-terminal per-recipient failures accumulate in `failed[]`
 *     (`email_failed` events) and the loop continues — the stream still ends
 *     `result` → `complete`, never `error`;
 *   - lifecycle writes happen AFTER the successful send for each recipient;
 *     invitation writes run inline; non-invitation bookkeeping re-reads the
 *     recipient's row and uses its exact ETag in the best-effort post-loop pass.
 *     Only numeric 412 conflicts retry bookkeeping (at most three attempts),
 *     never transport. A failed stamp keeps sent[] intact and emits the existing
 *     progress warning before result/complete;
 *   - campaign-config persistence is a best-effort post-send side effect
 *     (logged, never terminal);
 *   - ASSUMES a trusted DAL context already exists — never establishes one.
 *
 * Event vocabulary (pinned by tests/integration/send-emails-route.test.js and
 * tests/unit/send-emails-service.test.js):
 *   - progress { stage, message, current?, total? } — stages: starting,
 *     resolving_recipients, fetching_attachments, sending, updating_lifecycle
 *   - email_sent { suggestionId, candidateName, candidateEmail, emailId,
 *     regardingLinked, contactPromoted, orcidBackprop, deliveryMode,
 *     capturedEmail?, inviteRecorded?, emailConfidence } — inviteRecorded
 *     (invitation only): false means the email shipped but the invited-stamp
 *     write failed, so a retry could double-send (surface as "verify")
 *   - email_failed { suggestionId, candidateName, candidateEmail, error, code? }
 *     — `code` is optional and currently only set by the send-time token
 *     authority gate below: `external_link_missing`, `external_link_ambiguous`,
 *     `external_link_expectation_missing`, `external_link_recipient_mismatch`,
 *     `external_link_superseded`, `external_link_invalid`,
 *     `external_link_mint_failed`, `external_link_forbidden`
 *   - email_unconfirmed { suggestionId, candidateName, candidateEmail, error }
 *     — invitation only: the send threw AFTER a possible dispatch, so it may or
 *     may not have gone out; "possibly sent, verify before retry", never failed
 *   - result { sent, failed, skipped, unconfirmed, stats, orcidBackprop }
 *     — `skipped[].reason` is one of `SEND_SKIP_REASON`'s values
 *     (shared/utils/reviewer-send-skip-reasons.js — the parity gate,
 *     scripts/check-status-enum-parity.js, enforces every value there has a
 *     label): `no_email`, `program_director_sender_unavailable`,
 *     `not_accepted`, `materials_already_sent`, `materials_release_ineligible`,
 *     `address_conflict_pending`, `email_research_only`, `email_unconfirmed`,
 *     `already_invited`, `draft_fingerprint_missing`, `draft_stale` (Stage
 *     6D — see draft-fingerprint.js), `unresolved_placeholder`,
 *     `missing_secure_link`, `invalid_secure_link`
 *   - complete { message, sent, failed, skipped, unconfirmed }
 *   - error { message, details? } — terminal; no result/complete follows
 *
 * Domain semantics preserved verbatim from the pre-extraction route:
 * server-authoritative invite-confidence gate (Slice G), materials
 * accepted-only gate (§3.A), duplicate-invitation guard, request-number leak
 * refusal, attachment strip gate (recipientMayReceiveAttachments), capture
 * delivery mode, per-templateType lifecycle stamps, and first-invite
 * campaign-config non-clobber. Contact promotion is deliberately absent:
 * sending a message does not establish a canonical CRM relationship.
 *
 * Send-time token authority gate (v4): rendering supplies a JWT-shaped,
 * deliberately non-live placeholder and performs no token write. Immediately
 * before dispatch this service validates the FINAL edited subject+body,
 * defense-in-depth verifies any real JWT carried by a legacy/edited draft,
 * mints/stores the recipient's authoritative token with the established TTL
 * policy, and substitutes only the JWT path segment(s). No application await
 * separates the completed mint from invoking Dynamics dispatch. A missing,
 * ambiguous, invalid, recipient-mismatched, or mint-failed token authority
 * fails only that row via `email_failed`; healthy siblings continue. The
 * earlier invitation-only shared validator withholds malformed/unexpected
 * hardcoded paths in `skipped` before any mint or transport attempt.
 */

import { BASE_CONFIG } from '../../../shared/config/baseConfig';
import { isGuid } from '../../utils/guid';
import { ContactParser } from '../../utils/contact-parser';
import { isYmd } from '../../utils/date-ymd';
import { safeFetch, isAllowedUrl } from '../../utils/safe-fetch';
import { readUploadedBlobBuffer } from '../../utils/uploaded-blob';
import { isPrivateCycleMaterialPathname } from '../../utils/cycle-material-ref';
import { verifySuggestionToken } from '../../external/verify-suggestion-token';
import { mintAndStore, SEND_TIME_TOKEN_PLACEHOLDER_JWT } from '../../external/token-lifecycle';
import { computeReviewerTokenExpiry } from '../../external/reviewer-token-ttl';
import { resolveEffectiveReviewDueDate } from '../../external/reviewer-due-date.js';
import { DynamicsService } from '../dynamics-service';
import { meetingDateToCycleCode } from '../../utils/cycle-code';
import * as suggestionAdapter from '../../dataverse/adapters/reviewer-suggestion';
import * as potentialReviewerAdapter from '../../dataverse/adapters/potential-reviewer';
import * as systemUserAdapter from '../../dataverse/adapters/system-user';
import { getById as getRequestById, updateById as updateRequestById } from '../../dataverse/adapters/grant-request';
import { getSettingStrict } from '../settings-service';
import { getReviewerCampaignTimeline } from '../reviewer-campaign-timeline';
import { shouldSkipDuplicateInvitation, sendAllowsAttachments, isKnownTemplateType, recipientMayReceiveAttachments, emailConfidence } from '../../utils/reviewer-invite';
import { loadCycleConfigs } from './cycle-config-loader';
import { fetchCoPIs } from '../proposal-participants';
import { getHonorariumAmount } from '../honorarium-config';
import { buildDraftFingerprintInputs, fingerprintDraft } from './draft-fingerprint';
import { SEND_SKIP_REASON } from '../../../shared/utils/reviewer-send-skip-reasons';
import { REVIEW_STATUS_MAP } from '../../../shared/config/reviewerLifecycle.js';
import {
  classifyInvitationLinks,
  extractExternalReviewJwts,
  replaceExternalReviewJwts,
  INVITATION_LINK_INVALID_REASON,
} from '../../utils/invitation-link-validator';

const EMAIL_DELIVERY_MODES = new Set(['send', 'capture']);
const LINK_MINTING_TEMPLATE_TYPES = new Set(['invitation', 'materials']);
const MATERIALS_ALREADY_DELIVERED_STATUSES = new Set([
  REVIEW_STATUS_MAP.materials_sent,
  REVIEW_STATUS_MAP.under_review,
  REVIEW_STATUS_MAP.review_received,
  REVIEW_STATUS_MAP.complete,
]);
const POST_SEND_OPEN_REVIEW_STATUSES = new Set([
  REVIEW_STATUS_MAP.accepted,
  REVIEW_STATUS_MAP.materials_sent,
  REVIEW_STATUS_MAP.under_review,
  REVIEW_STATUS_MAP.review_received,
]);

// This records an already-delivered message, never sends one. Each conditional
// attempt re-evaluates the row so a receipt/closeout or another reminder cannot
// be overwritten using the earlier recipient-hydration snapshot.
async function recordDeliveredEmail({ suggestionId, originalSuggestion, templateType, sentAt, actingUserSystemId }) {
  const timestampField = {
    materials: 'wmkf_materialssentat',
    followup: 'wmkf_remindersentat',
    thankyou: 'wmkf_thankyousentat',
  }[templateType];
  if (typeof timestampField !== 'string') throw new Error(`Unsupported post-send template: ${templateType}`);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const fresh = await suggestionAdapter.findById(suggestionId);
    if (!fresh) throw new Error('Suggestion is no longer available');
    for (const lookup of ['_wmkf_request_value', '_wmkf_potentialreviewer_value']) {
      const originalId = originalSuggestion?.[lookup];
      const freshId = fresh[lookup];
      if (typeof originalId !== 'string' || !originalId.trim()
          || typeof freshId !== 'string' || !freshId.trim()
          || originalId.toLowerCase() !== freshId.toLowerCase()) {
        throw new Error('Suggestion request or reviewer binding changed after delivery');
      }
    }
    // Same concrete-version contract as the invitation expiry writer. Never
    // downgrade a missing/malformed version to the adapter's fallback or '*'.
    if (typeof fresh._etag !== 'string'
        || fresh._etag !== fresh._etag.trim()
        || !/^(?:W\/)?"[\x21\x23-\x7e\x80-\xff]+"$/.test(fresh._etag)) {
      throw new Error('Suggestion version is unavailable for email bookkeeping');
    }

    const status = fresh.wmkf_reviewstatus;
    if (templateType !== 'thankyou'
        && (fresh.wmkf_completedat || (status != null && !POST_SEND_OPEN_REVIEW_STATUSES.has(status)))) {
      throw new Error('Suggestion is closed or has an unknown review status');
    }
    const received = Boolean(fresh.wmkf_reviewreceivedat) || status === REVIEW_STATUS_MAP.review_received;
    // Another completed send may have recorded a newer timestamp while this
    // attempt was in flight. Preserve it while still counting this delivery.
    const recordedAt = fresh[timestampField];
    const timestamp = Date.parse(recordedAt) > Date.parse(sentAt) ? recordedAt : sentAt;
    let updates;
    if (templateType === 'materials') {
      const shouldBump = !received && (status == null || status === REVIEW_STATUS_MAP.accepted);
      updates = { materialsSentAt: timestamp, ...(shouldBump ? { reviewStatus: 'materials_sent' } : {}) };
    } else if (templateType === 'followup') {
      const count = fresh.wmkf_remindercount ?? 0;
      if (!Number.isInteger(count) || count < 0 || count >= 2147483647) {
        throw new Error('Suggestion reminder count is invalid or exhausted');
      }
      const shouldBump = !received
        && (status === REVIEW_STATUS_MAP.accepted || status === REVIEW_STATUS_MAP.materials_sent);
      updates = {
        reminderSentAt: timestamp,
        reminderCount: count + 1,
        ...(shouldBump ? { reviewStatus: 'under_review' } : {}),
      };
    } else {
      // Manual courtesy bookkeeping is delivery-only, including after closeout;
      // it is not the cron's pre-send claim and does not require a receipt.
      updates = { thankYouSentAt: timestamp };
    }

    try {
      await suggestionAdapter.updateLifecycle(suggestionId, updates, {
        actingUserSystemId,
        ifMatch: fresh._etag,
      });
      return;
    } catch (err) {
      // Only a known rejected conditional write is safe to retry. Ambiguous
      // transport/server errors keep the existing sent-with-warning outcome.
      if (err?.status !== 412 || attempt === 2) throw err;
    }
  }
}

// Preserve the complete edited subject/body byte-for-byte except for the JWT
// path segment recognized by the shared validator. Query strings and all
// surrounding prose/HTML remain untouched.
function substituteExternalReviewJwt(text, authoritativeJwt) {
  return replaceExternalReviewJwts(text, authoritativeJwt);
}

function outgoingTextContainsRequestNumber({ subject, body, requestNumber }) {
  const n = String(requestNumber || '').trim();
  if (!n) return false;
  return String(subject || '').includes(n) || String(body || '').includes(n);
}

/**
 * Send reviewer emails for a batch of pre-rendered drafts, emitting SSE
 * events through `onEvent`.
 *
 * @param {Object} args
 * @param {Object} args.requestBody - the validated-by-shape POST body
 *   ({ drafts, templateType, attachmentUrls, markAsSent, allowResend,
 *     confirmedLowConfidenceIds, campaignConfig })
 * @param {string} args.fromEmail - sender identity from the caller's session
 * @param {string|null} args.actingUserSystemId - Dynamics systemuser of the staff actor
 * @param {Function} onEvent - ({ event, data }) => void; the shell serializes to the wire
 * @returns {Promise<void>} always resolves; terminal failures emit `error` and return
 */
export async function sendEmails({ requestBody, fromEmail, actingUserSystemId }, onEvent) {
  const sendEvent = (event, data) => onEvent({ event, data });

  try {
    const {
      drafts,
      templateType = 'materials',
      attachmentUrls = [],
      markAsSent = true,
      // Invitation only: by default we refuse to re-send an invitation to a
      // candidate already marked invited (guards an accidental re-click / retry
      // from firing a second real email). A deliberate "Re-invite" sets this.
      allowResend = false,
      // Slice G — invite-confidence: the server independently computes each recipient's
      // address action and REFUSES research-only addresses. Quick-check addresses
      // require the staff to explicitly acknowledge the exact recipient.
      // acknowledged THAT recipient (the one-click "confirm & send", which named them). This
      // is a recipient-specific allowlist of suggestionIds, NOT a batch boolean — so a row
      // that became LOW after the staff previewed (and was never shown/confirmed) is still
      // refused, instead of being authorized by another row's confirmation.
      confirmedLowConfidenceIds = [],
      // Reviewer-engagement Phase 1: per-request campaign config from the invite panel
      // ({ respondOffsetDays, reviewDueDate }). Persisted to the request on the FIRST
      // invitation send only (never clobbers a later editor change). Ignored for any
      // non-invitation templateType. See the persistence block after the lifecycle loop.
      campaignConfig = null,
    } = requestBody;
    const confirmedLowConfidenceIdSet = new Set(
      Array.isArray(confirmedLowConfidenceIds) ? confirmedLowConfidenceIds : []
    );

    if (!Array.isArray(drafts) || drafts.length === 0) {
      sendEvent('error', { message: 'drafts array is required' });
      return;
    }
    // Reject an unknown templateType BEFORE any real email goes out — an unhandled
    // type would otherwise send with no lifecycle stamp and (allowlist) no materials
    // (Codex chunk-6 #4). Fail closed.
    if (!isKnownTemplateType(templateType)) {
      sendEvent('error', { message: `Unknown templateType: ${templateType}` });
      return;
    }
    // Stage-aware single-button label for non-invitation templates. Invitation
    // rendering uses fixed paired response actions; this value is ignored there.
    // Resolve once here since templateType is batch-level.
    const reviewButtonLabel = templateType === 'invitation' || !LINK_MINTING_TEMPLATE_TYPES.has(templateType)
      ? ''
      : await resolveReviewButtonLabel(templateType);
    let deliveryMode;
    try {
      deliveryMode = getReviewerEmailDeliveryMode();
    } catch (modeErr) {
      sendEvent('error', { message: modeErr.message });
      return;
    }
    for (const d of drafts) {
      if (!d || !d.suggestionId || !d.subject || !d.body) {
        sendEvent('error', { message: 'each draft must have suggestionId, subject, body' });
        return;
      }
      // GUID-validate before findById/updateLifecycle (record-id selector
      // interpolated raw into the request URL). Fail closed before any send.
      if (!isGuid(d.suggestionId)) {
        sendEvent('error', { message: 'each draft suggestionId must be a valid GUID' });
        return;
      }
      // The materials template is intentionally multi-paragraph. A browser/tool
      // that rewrites the preview as one line can otherwise produce a valid send
      // whose greeting, body, and signature are all collapsed in Outlook. Refuse
      // that malformed draft before any recipient lookup or irreversible send.
      if (
        templateType === 'materials'
        && /\/external\/review\/[A-Za-z0-9._~-]+/.test(d.body)
        && !/[\r\n]/.test(d.body)
      ) {
        sendEvent('error', {
          message: 'Materials email body lost its line breaks. Regenerate the preview before sending.',
        });
        return;
      }
    }

    // Dedup by suggestionId, keeping the first occurrence: a batch that repeats a
    // suggestionId would otherwise double-send a REAL invitation to the same
    // reviewer. The duplicate-invitation guard hydrates `wmkf_invited` once at
    // batch start (recipientBySuggestion, below) and the inline invited-stamp
    // updates Dataverse but not that in-memory row, so every copy of a repeated id
    // sees "not invited" and sends. render-emails dedups upstream; this is the
    // server-side backstop for the first real external send. In-place so the
    // downstream loops and the `total` below all see the deduped batch.
    const seenSuggestion = new Set();
    const dedupedDrafts = drafts.filter((d) => {
      if (seenSuggestion.has(d.suggestionId)) return false;
      seenSuggestion.add(d.suggestionId);
      return true;
    });
    if (dedupedDrafts.length !== drafts.length) {
      drafts.splice(0, drafts.length, ...dedupedDrafts);
    }

    sendEvent('progress', {
      stage: 'starting',
      message: `Preparing ${drafts.length} email(s)...`,
      total: drafts.length,
    });

    // Hydrate each suggestion: load the suggestion row, the linked
    // potentialreviewer (for name/email), and the linked akoya_request (for
    // the regarding link + meeting date → cycle code).
    sendEvent('progress', { stage: 'resolving_recipients', message: 'Loading recipients from Dataverse...' });
    const recipientBySuggestion = new Map();
    for (const d of drafts) {
      const sug = await suggestionAdapter.findById(d.suggestionId);
      if (!sug) {
        recipientBySuggestion.set(d.suggestionId, { error: 'suggestion_not_found' });
        continue;
      }
      const personId = sug._wmkf_potentialreviewer_value;
      const requestId = sug._wmkf_request_value;
      const [person, request] = await Promise.all([
        // Stage 6D: `wmkf_primaryaffiliation, wmkf_organizationname` added so
        // send-time candidate resolution matches render's exactly (fingerprint input).
        personId ? potentialReviewerAdapter.getByIdWithSelect(personId, {
          select: 'wmkf_potentialreviewersid,wmkf_name,wmkf_emailaddress,wmkf_firstname,wmkf_lastname,_wmkf_contact_value,wmkf_orcid,wmkf_identitystatus,wmkf_emailsource,wmkf_addresstruststatejson,wmkf_primaryaffiliation,wmkf_organizationname',
        }).catch(() => null) : null,
        // Stage 6D: `akoya_title, wmkf_abstract, _wmkf_projectleader_value,
        // wmkf_organizationname, _akoya_applicantid_value` added so send-time
        // proposal resolution matches render's exactly (fingerprint input).
        requestId ? getRequestById(requestId, {
          select: 'akoya_requestid,akoya_requestnum,wmkf_meetingdate,wmkf_respondoffsetdays,wmkf_reviewduedate,wmkf_desiredcount,_wmkf_programdirector_value,akoya_title,wmkf_abstract,_wmkf_projectleader_value,wmkf_organizationname,_akoya_applicantid_value',
        }).catch(() => null) : null,
      ]);
      recipientBySuggestion.set(d.suggestionId, { suggestion: sug, person, request });
    }

    const programDirectorById = new Map();
    const distinctProgramDirectorIds = [...new Set(
      [...recipientBySuggestion.values()]
        .map((v) => v?.request?._wmkf_programdirector_value)
        .filter(Boolean)
    )];
    await Promise.all(distinctProgramDirectorIds.map(async (pdId) => {
      try {
        const pd = await systemUserAdapter.getByIdWithSelect(
          pdId,
          'systemuserid,fullname,internalemailaddress,isdisabled',
        );
        if (pd?.isdisabled === false && String(pd.internalemailaddress || '').trim()) {
          programDirectorById.set(pdId, {
            systemUserId: pd.systemuserid || pdId,
            name: pd.fullname || null,
            email: String(pd.internalemailaddress).trim(),
          });
        }
      } catch {
        // Invitation handling below fails closed for this recipient. Other
        // template types preserve their historical authenticated-sender fallback.
      }
    }));

    // Cycle-level config (template URL + additional attachments) loaded
    // from Dataverse `wmkf_appgrantcycle` (W3 cutover). Look up once per
    // distinct cycleCode.
    const distinctCycleCodes = [...new Set(
      [...recipientBySuggestion.values()]
        .map((v) => v?.request?.wmkf_meetingdate ? meetingDateToCycleCode(v.request.wmkf_meetingdate) : null)
        .filter(Boolean)
    )];
    // Shared loader (stage 2b extraction); this caller's historical snake_case
    // projection is preserved exactly — see cycle-config-loader.js.
    // Stage 6D: `program_name` / `custom_fields` added, matching render's map,
    // so the recomputed fingerprint's cycle leg reads the same projection.
    const cycleConfigByCode = await loadCycleConfigs(distinctCycleCodes, {
      fields: {
        review_template_blob_url: 'reviewTemplateBlobUrl',
        additional_attachments: 'additionalAttachments',
        review_deadline: 'reviewDeadline',
        program_name: 'programName',
        custom_fields: 'customFields',
      },
    });

    // Stage 6D: co-PIs and the honorarium amount are fingerprint inputs the
    // send-time hydration above did not previously read. Fetch co-PIs once
    // per distinct request (memoised map, `.catch(() => [])`, mirroring
    // render-emails-service.js exactly) and the honorarium amount once per
    // batch (a single admin setting, not per-recipient). Both run inside the
    // caller-established trusted DAL context.
    const coPIsByRequest = new Map();
    const distinctRequestIds = [...new Set(
      [...recipientBySuggestion.values()].map((v) => v?.request?.akoya_requestid).filter(Boolean)
    )];
    await Promise.all(distinctRequestIds.map(async (rid) => {
      coPIsByRequest.set(rid, await fetchCoPIs(rid).catch(() => []));
    }));
    let honorariumAmount = null;
    try {
      honorariumAmount = await getHonorariumAmount();
    } catch (e) {
      console.warn('[send-emails] honorarium amount read failed; fingerprint uses null:', e.message);
    }

    // Fetch shared attachments once (caller-supplied + first cycle's template).
    // INVARIANT: a pre-acceptance invitation carries NO attachments at all — not
    // caller-supplied, not cycle materials — so proposal materials can never leave
    // before the reviewer accepts (defense-in-depth around the modal sending none).
    sendEvent('progress', { stage: 'fetching_attachments', message: 'Fetching attachments...' });
    const attachmentCache = new Map();
    const sharedAttachments = [];
    const allowAttachments = sendAllowsAttachments(templateType);

    if (allowAttachments) {
      for (const url of attachmentUrls) {
        if (!url) continue;
        try {
          const att = await fetchAttachment(url, attachmentCache);
          if (att) sharedAttachments.push(att);
        } catch (err) {
          console.warn('Failed to fetch attachment:', url, err.message);
        }
      }
    }

    // Pull cycle template + additional attachments from the first available cycle.
    // (Today every batch in the UI is single-cycle; multi-cycle batches would
    // need per-recipient attachment selection — out of scope.)
    // Cycle materials (review template + additional attachments) must NOT ride on
    // a pre-acceptance INVITATION — the reviewer hasn't agreed (or acked COI/AI
    // policy) yet, so proposal materials can't leave the building. They go out
    // post-acceptance via the materials email (Codex S211 stop-gate catch). The
    // caller-supplied `attachmentUrls` above are still honored (the invite modal
    // sends none).
    const firstCycle = cycleConfigByCode[distinctCycleCodes[0]];
    if (allowAttachments) {
      if (firstCycle?.review_template_blob_url && !attachmentCache.has(firstCycle.review_template_blob_url)) {
        try {
          const att = await fetchAttachment(firstCycle.review_template_blob_url, attachmentCache);
          if (att) sharedAttachments.push(att);
        } catch (err) {
          console.warn('Failed to fetch review template:', err.message);
        }
      }
      if (Array.isArray(firstCycle?.additional_attachments)) {
        for (const a of firstCycle.additional_attachments) {
          // Private attachments carry a cycle-materials/ pathname; legacy public ones
          // carry blobUrl/url. The classifier is the prefix (uniform across consumers
          // — Codex SLICE2-5-VERIFY), not the JSON access field. Pass the JSON filename
          // through for private refs.
          const ref = isPrivateCycleMaterialPathname(a.pathname) ? a.pathname : (a.blobUrl || a.url);
          if (ref && !attachmentCache.has(ref)) {
            try {
              const att = await fetchAttachment(ref, attachmentCache, a.filename);
              if (att) sharedAttachments.push(att);
            } catch (err) {
              console.warn('Failed to fetch additional attachment:', ref, err.message);
            }
          }
        }
      }
    }

    sendEvent('progress', {
      stage: 'sending',
      message: deliveryMode === 'capture'
        ? `Capturing ${drafts.length} email(s)...`
        : `Sending ${drafts.length} email(s)...`,
      total: drafts.length,
    });

    const sent = [];
    const failed = [];
    const skipped = [];
    // Invitation sends only: a send that threw AFTER the dispatch step may or may
    // not have left the building (e.g. Dynamics SendEmail POSTed but the HTTP
    // response was lost). Recording these as `failed` invites a blind retry that
    // double-emails a real external reviewer, so they go to a distinct
    // "possibly sent — verify before retry" bucket instead. Non-invitation
    // templateTypes keep plain failed[] semantics.
    const unconfirmed = [];
    // Legacy response field retained for consumers. Send-time ORCID propagation
    // was removed with send-time contact promotion, so every bucket stays zero.
    const orcidStats = { written: 0, noop: 0, conflict: 0, malformed: 0, ineligible: 0, no_contact: 0, error: 0 };
    let processed = 0;

    for (const draft of drafts) {
      processed++;
      const ctx = recipientBySuggestion.get(draft.suggestionId);
      if (!ctx || ctx.error) {
        failed.push({
          suggestionId: draft.suggestionId,
          candidateName: '(unknown)',
          candidateEmail: null,
          error: ctx?.error || 'Suggestion not found',
        });
        sendEvent('email_failed', failed[failed.length - 1]);
        continue;
      }

      const { suggestion, person, request } = ctx;
      const name = ContactParser.normalizeDisplayName(person?.wmkf_name);
      const email = person?.wmkf_emailaddress || null;

      if (!email) {
        skipped.push({ suggestionId: draft.suggestionId, candidateName: name, candidateEmail: null, reason: SEND_SKIP_REASON.no_email });
        sendEvent('progress', {
          stage: 'sending',
          current: processed,
          total: drafts.length,
          message: `Skipped ${name || '(unnamed)'} (no email)`,
        });
        continue;
      }

      const assignedProgramDirector = programDirectorById.get(request?._wmkf_programdirector_value) || null;
      if (templateType === 'invitation' && !assignedProgramDirector) {
        skipped.push({
          suggestionId: draft.suggestionId,
          candidateName: name,
          candidateEmail: email,
          reason: SEND_SKIP_REASON.program_director_sender_unavailable,
        });
        sendEvent('progress', {
          stage: 'sending',
          current: processed,
          total: drafts.length,
          message: `Skipped ${name || '(unnamed)'} (assigned Program Director sender unavailable)`,
        });
        continue;
      }
      const programDirectorContact = assignedProgramDirector || {
        systemUserId: actingUserSystemId,
        name: null,
        email: fromEmail,
      };

      // Slice G — invite-confidence gate (SERVER-authoritative; the API is the real
      // boundary, not the modal). Compute confidence from the person row's source +
      // identity; never trust a client-sent level. A quick-check address (manually
      // entered, affiliation-derived, unknown source, or a search email on an unconfirmed
      // identity) is REFUSED unless the caller acknowledged it via `confirmedLowConfidence`
      // — the staff one-click "confirm & send". This is what stops an unknowing invite to a
      // wrong/namesake address (the S234 pianist-Chen failure).
      //
      // Scoped to FIRST CONTACT (invitation): once a reviewer engages via the
      // magic link sent to this address, it's proven, so post-engagement sends
      // (materials/followup/thankyou, the ReviewerManagePanel flow) are NOT
      // re-gated — same scope as shouldSkipDuplicateInvitation.

      // Release-to-reviewers accepted-only gate (reviewer-engagement §3.A / DECISION #10):
      // proposal materials go ONLY to a reviewer who has ACCEPTED. SERVER-authoritative —
      // independent of the caller/UI — so a non-accepted reviewer can never receive the
      // materials email (and therefore never gets a long-lived materials token at
      // the send-time mint boundary). The existing attachment gate strips materials FILES from a
      // mislabeled send; this refuses the materials EMAIL itself. Mirrors the
      // recipientMayReceiveAttachments accepted check (wmkf_accepted === true).
      if (templateType === 'materials' && suggestion?.wmkf_accepted !== true) {
        skipped.push({ suggestionId: draft.suggestionId, candidateName: name, candidateEmail: email, reason: SEND_SKIP_REASON.not_accepted });
        sendEvent('progress', {
          stage: 'sending',
          current: processed,
          total: drafts.length,
          message: `Skipped ${name || '(unnamed)'} (has not accepted — materials withheld)`,
        });
        continue;
      }

      // Incident containment: materials delivery is a one-time transition, not a
      // generic re-send surface. A second materials send would mint a replacement
      // bearer token and invalidate the link the reviewer is already using. Refuse
      // before token mint or email dispatch when either the durable receipt or a
      // post-materials lifecycle status proves delivery already occurred. There is
      // intentionally no allowResend bypass; recovery is a separate explicit flow.
      if (
        templateType === 'materials'
        && (
          Boolean(suggestion?.wmkf_materialssentat)
          || MATERIALS_ALREADY_DELIVERED_STATUSES.has(suggestion?.wmkf_reviewstatus)
        )
      ) {
        skipped.push({
          suggestionId: draft.suggestionId,
          candidateName: name,
          candidateEmail: email,
          reason: SEND_SKIP_REASON.materials_already_sent,
        });
        sendEvent('progress', {
          stage: 'sending',
          current: processed,
          total: drafts.length,
          message: `Skipped ${name || '(unnamed)'} (materials were already sent)`,
        });
        continue;
      }

      // Accepted/null are the only pre-release status shapes, and explicit token
      // revocation is a staff hold even when the lifecycle row still says
      // accepted. Neither a terminal/unknown status nor a revoked row may fall
      // through to mintAndStore, which clears the revocation while issuing a
      // materials link.
      if (
        templateType === 'materials'
        && (
          suggestion?.wmkf_externaltokenrevoked === true
          || (
            suggestion?.wmkf_reviewstatus != null
            && suggestion.wmkf_reviewstatus !== REVIEW_STATUS_MAP.accepted
          )
        )
      ) {
        skipped.push({
          suggestionId: draft.suggestionId,
          candidateName: name,
          candidateEmail: email,
          reason: SEND_SKIP_REASON.materials_release_ineligible,
        });
        sendEvent('progress', {
          stage: 'sending',
          current: processed,
          total: drafts.length,
          message: `Skipped ${name || '(unnamed)'} (reviewer is not awaiting materials)`,
        });
        continue;
      }

      const confidence = emailConfidence(person);
      const lowConfidenceConfirmed = confirmedLowConfidenceIdSet.has(draft.suggestionId);
      const isFirstContact = templateType === 'invitation';
      if (confidence.action === 'blocked') {
        skipped.push({
          suggestionId: draft.suggestionId,
          candidateName: name,
          candidateEmail: email,
          reason: SEND_SKIP_REASON.address_conflict_pending,
          emailConfidence: confidence,
          remediation: confidence.remediation || [],
        });
        sendEvent('progress', {
          stage: 'sending',
          current: processed,
          total: drafts.length,
          message: `Skipped ${name || '(unnamed)'} (address conflict requires review)`,
        });
        continue;
      }
      if (isFirstContact && confidence.action === 'research_only') {
        skipped.push({
          suggestionId: draft.suggestionId,
          candidateName: name,
          candidateEmail: email,
          reason: SEND_SKIP_REASON.email_research_only,
          emailConfidence: confidence,
        });
        sendEvent('progress', {
          stage: 'sending',
          current: processed,
          total: drafts.length,
          message: `Skipped ${name || '(unnamed)'} (research-only address evidence)`,
        });
        continue;
      }
      if (isFirstContact && confidence.action === 'quick_check' && !lowConfidenceConfirmed) {
        skipped.push({
          suggestionId: draft.suggestionId,
          candidateName: name,
          candidateEmail: email,
          reason: SEND_SKIP_REASON.email_unconfirmed,
          emailConfidence: confidence,
        });
        sendEvent('progress', {
          stage: 'sending',
          current: processed,
          total: drafts.length,
          message: `Skipped ${name || '(unnamed)'} (address not confirmed)`,
        });
        continue;
      }

      // Duplicate-invitation guard: never re-send an invitation to a candidate
      // already marked invited unless the caller explicitly opts in (Re-invite).
      // Protects against an accidental re-click / retry firing a second real
      // email. Only applies to the invitation flow; materials have their own
      // non-bypassable one-time-delivery guard above.
      if (shouldSkipDuplicateInvitation({ templateType, allowResend, invited: suggestion?.wmkf_invited === true })) {
        skipped.push({ suggestionId: draft.suggestionId, candidateName: name, candidateEmail: email, reason: SEND_SKIP_REASON.already_invited });
        sendEvent('progress', {
          stage: 'sending',
          current: processed,
          total: drafts.length,
          message: `Skipped ${name || '(unnamed)'} (already invited)`,
        });
        continue;
      }

      // Stage 6D — server-side draft fingerprint. render-emails-service.js
      // stamps every sendable draft with a fingerprint of the server-observed
      // inputs its body depends on; recompute the same fingerprint from THIS
      // service's own (independently re-read) inputs and refuse a draft
      // whose inputs drifted since the preview was rendered — a CRM edit to
      // the title, abstract, PI, institution, co-PI list, reviewer name or
      // affiliation, per-engagement due-date override, or cycle config
      // between preview and send. Placed before any token mint, attachment
      // fetch, or transport (and before the invitation link classification
      // below, so a stale body is never separately classified). Applies to
      // all four template types uniformly — see the build plan's "Decided
      // under the owner's autonomy grant" note.
      if (typeof draft.draftFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(draft.draftFingerprint)) {
        skipped.push({
          suggestionId: draft.suggestionId,
          candidateName: name,
          candidateEmail: email,
          reason: SEND_SKIP_REASON.draft_fingerprint_missing,
        });
        sendEvent('progress', {
          stage: 'sending',
          current: processed,
          total: drafts.length,
          message: `Skipped ${name || '(unnamed)'} (draft needs to be re-rendered)`,
        });
        continue;
      }
      {
        const cycleCode = request?.wmkf_meetingdate ? meetingDateToCycleCode(request.wmkf_meetingdate) : null;
        const cycle = cycleConfigByCode[cycleCode] || {};
        const coPINames = coPIsByRequest.get(request?.akoya_requestid) || [];
        const recomputedFingerprint = fingerprintDraft(buildDraftFingerprintInputs({
          templateType,
          suggestionId: draft.suggestionId,
          suggestion,
          person,
          request,
          coPINames,
          cycle,
          honorariumAmount,
        }));
        if (recomputedFingerprint !== draft.draftFingerprint) {
          skipped.push({
            suggestionId: draft.suggestionId,
            candidateName: name,
            candidateEmail: email,
            reason: SEND_SKIP_REASON.draft_stale,
          });
          sendEvent('progress', {
            stage: 'sending',
            current: processed,
            total: drafts.length,
            message: `Skipped ${name || '(unnamed)'} (details changed since this preview was rendered)`,
          });
          continue;
        }
      }

      const invitationLinkText = `${draft.subject || ''}\n${draft.body || ''}`;
      const invitationLinkValidation = classifyInvitationLinks({
        subject: draft.subject,
        body: draft.body,
        externalLinkExpected: draft.externalLinkExpected,
      });

      // Invitation body-integrity gate (SERVER-authoritative, first contact only).
      // Preserve the established missing/unresolved skip reasons. Malformed or
      // unexpected reviewer paths use one actionable invalid-link reason. Cases
      // already owned by the stronger token-authority failure codes (missing
      // expectation metadata or >1 valid JWT) continue into that gate unchanged.
      if (templateType === 'invitation') {
        let reason = null;
        let message = null;
        if (invitationLinkValidation.reason === INVITATION_LINK_INVALID_REASON.UNRESOLVED_PLACEHOLDER) {
          reason = SEND_SKIP_REASON.unresolved_placeholder;
          message = `Skipped ${name || '(unnamed)'} (invitation has an unfilled {{field}} — not sent)`;
        } else if (invitationLinkValidation.occurrenceCount === 0) {
          reason = SEND_SKIP_REASON.missing_secure_link;
          message = `Skipped ${name || '(unnamed)'} (invitation is missing its secure link — not sent)`;
        } else if (
          invitationLinkValidation.reason === INVITATION_LINK_INVALID_REASON.MALFORMED
          || invitationLinkValidation.reason === INVITATION_LINK_INVALID_REASON.UNEXPECTED
        ) {
          // MULTIPLE (distinct tokens) deliberately falls through to the
          // token-authority gate below, which fails the row as
          // external_link_ambiguous — the established bucket for it.
          reason = SEND_SKIP_REASON.invalid_secure_link;
          message = `Skipped ${name || '(unnamed)'} (invitation has an invalid secure link — restore {{externalLink}} in the template)`;
        }
        if (reason) {
          skipped.push({ suggestionId: draft.suggestionId, candidateName: name, candidateEmail: email, reason });
          sendEvent('progress', {
            stage: 'sending',
            current: processed,
            total: drafts.length,
            message,
          });
          continue;
        }
      }

      const regardingId = request?.akoya_requestid || null;
      if (outgoingTextContainsRequestNumber({
        subject: draft.subject,
        body: draft.body,
        requestNumber: request?.akoya_requestnum,
      })) {
        failed.push({
          suggestionId: draft.suggestionId,
          candidateName: name,
          candidateEmail: email,
          error: 'Email subject/body contains the internal request number.',
        });
        sendEvent('email_failed', failed[failed.length - 1]);
        sendEvent('progress', {
          stage: 'sending',
          current: processed,
          total: drafts.length,
          message: `Failed to send to ${name}`,
        });
        continue;
      }

      // Attachment safety is SERVER-authoritative, not caller-controlled: proposal
      // materials only ride on an email to a recipient who has actually ACCEPTED
      // (`wmkf_accepted === true` on their suggestion row) — independent of the
      // caller-supplied templateType. A pre-acceptance recipient (an invitation,
      // or any mislabeled send) gets NO attachments (Codex S211 stop-gate). The
      // `allowAttachments` (templateType) gate above just avoids fetching them.
      const materialAttachments = recipientMayReceiveAttachments(suggestion) ? sharedAttachments : [];
      const recipientAttachments = materialAttachments;

      // Send-time token authority gate (v4). Preview rendering does not write
      // durable token state. Validate the final edited draft, retain verification
      // for any real JWT a legacy/edited draft carries, then mint the final token
      // and replace only JWT path segments. The mint is the last application
      // await before invoking Dynamics dispatch below.
      const extractedJwts = extractExternalReviewJwts(invitationLinkText);
      let tokenFailureCode = null;
      let authoritativeSubject = draft.subject;
      let authoritativeBody = draft.body;
      const templateMayMintLink = LINK_MINTING_TEMPLATE_TYPES.has(templateType);
      const containsReviewerPath = /\/external\/review\//.test(invitationLinkText)
        || invitationLinkText.includes('{{externalLink}}');
      if (!templateMayMintLink && containsReviewerPath) {
        tokenFailureCode = 'external_link_forbidden';
      } else if (typeof draft.externalLinkExpected !== 'boolean') {
        // Draft came from a render that predates this gate (deploy transition)
        // or omitted the marker some other way. Fail closed rather than guess.
        tokenFailureCode = 'external_link_expectation_missing';
      } else if (extractedJwts.length > 1) {
        tokenFailureCode = 'external_link_ambiguous';
      } else if (extractedJwts.length === 0) {
        if (draft.externalLinkExpected) tokenFailureCode = 'external_link_missing';
        // externalLinkExpected === false and no JWT: no token expected, don't mint.
      } else {
        const presentedJwt = extractedJwts[0];

        // New renders carry the exact non-live sentinel. Any other JWT came
        // from a legacy preview or a PD edit, so retain the v3 verifier as a
        // defense-in-depth recipient/request binding check before replacing it.
        if (presentedJwt !== SEND_TIME_TOKEN_PLACEHOLDER_JWT) {
          let verified;
          try {
            verified = await verifySuggestionToken(presentedJwt);
          } catch (verifyErr) {
            console.error(`[send-emails] token verification threw for ${draft.suggestionId}:`, verifyErr.message);
            verified = { ok: false, reason: 'verifier_exception' };
          }
          if (!verified.ok) {
            tokenFailureCode = verified.reason === 'hash_mismatch'
              ? 'external_link_superseded'
              : 'external_link_invalid';
          } else {
            const payloadSuggestionId = String(verified.payload?.suggestionId || '').toLowerCase();
            const payloadRequestId = String(verified.payload?.requestId || '').toLowerCase();
            const matchesSuggestion = payloadSuggestionId === String(draft.suggestionId || '').toLowerCase();
            const matchesRequest = payloadRequestId === String(request?.akoya_requestid || '').toLowerCase();
            if (!matchesSuggestion || !matchesRequest) {
              tokenFailureCode = 'external_link_recipient_mismatch';
            }
          }
        }

        if (!tokenFailureCode) {
          const requestId = request?.akoya_requestid || null;
          if (!requestId) {
            tokenFailureCode = 'external_link_invalid';
          } else {
            const expiresAt = computeReviewerTokenExpiry({
              accepted: suggestion?.wmkf_accepted === true,
              reviewDueDate: resolveEffectiveReviewDueDate({
                overrideDate: suggestion?.wmkf_reviewduedateoverride,
                defaultDate: request?.wmkf_reviewduedate,
              }),
            });
            try {
              const { jwt: authoritativeJwt } = await mintAndStore({
                suggestionId: draft.suggestionId,
                requestId,
                expiresAt,
                actingUserSystemId,
              });
              authoritativeSubject = substituteExternalReviewJwt(draft.subject, authoritativeJwt);
              authoritativeBody = substituteExternalReviewJwt(draft.body, authoritativeJwt);
            } catch (mintErr) {
              console.error(`[send-emails] token mint failed for ${draft.suggestionId}:`, mintErr.message);
              tokenFailureCode = 'external_link_mint_failed';
            }
          }
        }
      }

      if (tokenFailureCode) {
        failed.push({
          suggestionId: draft.suggestionId,
          candidateName: name,
          candidateEmail: email,
          code: tokenFailureCode,
          error: tokenFailureCode === 'external_link_forbidden'
            ? 'This message type must use the reviewer’s existing materials-email link and cannot issue a replacement link.'
            : tokenFailureCode === 'external_link_superseded'
            ? 'This email’s secure reviewer link was replaced by a newer preview. Regenerate the preview and send this recipient again.'
            : tokenFailureCode === 'external_link_mint_failed'
              ? 'This email’s secure reviewer link could not be created. Try sending this recipient again.'
              : 'This email’s secure reviewer link is missing or no longer valid. Regenerate the preview and send this recipient again.',
        });
        sendEvent('email_failed', failed[failed.length - 1]);
        sendEvent('progress', {
          stage: 'sending',
          current: processed,
          total: drafts.length,
          message: `Failed to send to ${name}`,
        });
        continue;
      }

      try {
        const emailPayload = {
          subject: authoritativeSubject,
          body: plainTextToHtml(authoritativeBody, { programDirectorContact, reviewButtonLabel, templateType }),
          from: templateType === 'invitation' ? programDirectorContact.email : fromEmail,
          to: email,
          regardingId: regardingId || undefined,
          regardingType: regardingId ? 'akoya_request' : undefined,
          attachments: recipientAttachments,
          // The invitation must originate from the assigned PD's mailbox. Keep
          // subsequent lifecycle/contact writes attributed to the staff actor via
          // their existing `actingUserSystemId`; only the email transport runs as PD.
          actingUserSystemId: templateType === 'invitation'
            ? programDirectorContact.systemUserId
            : actingUserSystemId,
          // Invitations must never silently downgrade to service-principal
          // identity when impersonation is off (outbound-email inventory
          // 2026-08-26): fail the send instead. Other templateTypes send as
          // the acting staff member and keep the default fallback.
          noFallback: templateType === 'invitation',
        };
        const { emailId, capturedEmail } = deliveryMode === 'capture'
          ? captureReviewerEmail(emailPayload, { suggestionId: draft.suggestionId, candidateName: name })
          : await DynamicsService.createAndSendEmail(emailPayload);
        // Owner decision S389: successful delivery does not establish a
        // canonical CRM relationship. Keep these legacy response fields stable
        // for consumers, but contact creation/linking and ORCID propagation only
        // happen after an identity-bearing acceptance.
        const contactPromoted = false;
        const orcidBackprop = null;

        // Invitation: stamp `wmkf_invited` INLINE, immediately after this send, not
        // in a post-loop pass. The duplicate-invitation guard reads this flag, so
        // stamping as close to the send as possible shrinks the window in which a
        // retry (or a mid-batch timeout that skips a later pass) re-emails an
        // already-contacted reviewer. If the stamp itself fails the email has
        // already shipped, so we record the send as `inviteRecorded: false` — a
        // "sent but not recorded, verify before re-inviting" signal for the UI —
        // rather than losing that fact to a scrolling warning. Other templateTypes
        // stay in the post-loop lifecycle pass (they are re-sendable by design).
        let inviteRecorded;
        if (templateType === 'invitation' && markAsSent) {
          try {
            await suggestionAdapter.updateLifecycle(draft.suggestionId, {
              invited: true,
              emailSentAt: new Date().toISOString(),
              respondReminderSentAt: null,
            }, { actingUserSystemId });
            inviteRecorded = true;
          } catch (stampErr) {
            inviteRecorded = false;
            console.error(`Invitation sent but lifecycle stamp failed for ${draft.suggestionId} (do NOT blind-retry):`, stampErr.message);
          }
        }

        sent.push({
          suggestionId: draft.suggestionId,
          candidateName: name,
          candidateEmail: email,
          emailId,
          regardingLinked: Boolean(regardingId),
          contactPromoted,
          orcidBackprop,
          deliveryMode,
          ...(capturedEmail ? { capturedEmail } : {}),
          ...(inviteRecorded === undefined ? {} : { inviteRecorded }),
          // Slice G — record the confidence the send went out under (HIGH, or LOW that
          // staff explicitly acknowledged) so a quick-check invite is auditable.
          emailConfidence: confidence,
        });
        sendEvent('email_sent', sent[sent.length - 1]);
        sendEvent('progress', {
          stage: 'sending',
          current: processed,
          total: drafts.length,
          message: `Sent to ${name}`,
        });
      } catch (err) {
        // An invitation send that threw may have dispatched before failing (e.g.
        // the SendEmail POST reached Dynamics but the response was lost). We cannot
        // prove it did NOT go out, so an invitation is recorded as "possibly sent —
        // verify before retry", never plain `failed`, to keep staff from blindly
        // re-emailing a real external reviewer. Re-sendable templateTypes keep
        // ordinary failed[] semantics (a duplicate there is harmless by design).
        // Exception: a throw tagged `dispatched: false` by the email transport
        // (env preflight, create-activity, or attachment stage — everything
        // before the SendEmail POST) provably never sent, so it takes the
        // plain failed[] path.
        if (templateType === 'invitation' && err?.dispatched !== false) {
          console.error(`Invitation send to ${name} <${email}> failed after a possible dispatch (verify before retry):`, err.message);
          unconfirmed.push({
            suggestionId: draft.suggestionId,
            candidateName: name,
            candidateEmail: email,
            error: err.message,
          });
          sendEvent('email_unconfirmed', unconfirmed[unconfirmed.length - 1]);
          sendEvent('progress', {
            stage: 'sending',
            current: processed,
            total: drafts.length,
            message: `Possibly sent to ${name} — verify before retrying`,
          });
        } else {
          console.error(`Failed to send to ${name} <${email}>:`, err.message);
          failed.push({
            suggestionId: draft.suggestionId,
            candidateName: name,
            candidateEmail: email,
            error: err?.code === 'impersonation_disabled'
              ? 'Sending as the program director is currently disabled, so this invitation was not sent. Contact an administrator.'
              : err.message,
          });
          sendEvent('email_failed', failed[failed.length - 1]);
          sendEvent('progress', {
            stage: 'sending',
            current: processed,
            total: drafts.length,
            message: `Failed to send to ${name}`,
          });
        }
      }
    }

    // Invitations are stamped inline in the send loop (above); this post-loop pass
    // handles the non-invitation templateTypes (materials/followup/thankyou) only.
    // Keeping invitations outside the retry helper preserves their immediate
    // invited-stamp ordering and inviteRecorded outcome.
    if (markAsSent && sent.length > 0 && templateType !== 'invitation') {
      sendEvent('progress', { stage: 'updating_lifecycle', message: 'Updating tracking data...' });
      const now = new Date().toISOString();

      for (const s of sent) {
        try {
          await recordDeliveredEmail({
            suggestionId: s.suggestionId,
            originalSuggestion: recipientBySuggestion.get(s.suggestionId)?.suggestion,
            templateType,
            sentAt: now,
            actingUserSystemId,
          });
        } catch (err) {
          console.error(`Lifecycle update failed for ${s.suggestionId} (email already sent):`, err.message);
          sendEvent('progress', {
            stage: 'updating_lifecycle',
            message: `Warning: lifecycle update failed for ${s.candidateName}: ${err.message}`,
          });
        }
      }
    }

    // Reviewer-engagement Phase 1: persist the per-request campaign config on the FIRST
    // invitation send. Discrete columns (NOT a JSON blob) so the Phase-3 reminder cron and
    // Phase-4 quota sweep can OData $filter server-side. Guards:
    //   - invitation sends only (never materials/followup/etc.);
    //   - only requests with at least one successfully-sent invitation this batch;
    //   - only requests with NO config yet (wmkf_respondoffsetdays null) — a later edit via
    //     the campaign-config editor must never be clobbered by a subsequent invite wave.
    // Non-fatal: the invitations already shipped; a config-write failure is logged, not raised.
    // Re-invite (allowResend) is excluded: a re-invite re-mints/re-stamps but leaves
    // request-level config untouched (spec §3.E); only a genuine first-time invite wave
    // seeds the config.
    // Same first-send/non-clobbering gating also seeds wmkf_desiredcount (reviewer quota)
    // from the admin campaign-timeline default (never from the client campaignConfig
    // payload) whenever the request has no quota set yet.
    if (templateType === 'invitation' && !allowResend && campaignConfig && sent.length > 0) {
      const offsetRaw = campaignConfig.respondOffsetDays;
      const offset = Number.isInteger(offsetRaw) && offsetRaw >= 0 ? offsetRaw : null;
      const dueDate = isYmd(campaignConfig.reviewDueDate) ? campaignConfig.reviewDueDate : null;
      // Reviewer quota (wmkf_desiredcount) seed: server-side admin default ONLY — never
      // taken from the client-supplied campaignConfig payload. Read once per batch (not
      // per-request) and best-effort: a timeline-read failure must not block the
      // invitations that already shipped, so it's caught here rather than left to
      // propagate into the per-request write loop below.
      let defaultDesiredCount = null;
      try {
        const { timeline } = await getReviewerCampaignTimeline();
        defaultDesiredCount = Number.isInteger(timeline?.desiredCount) ? timeline.desiredCount : null;
      } catch (timelineErr) {
        console.warn('Reviewer campaign timeline read failed (quota seed skipped):', timelineErr.message);
      }
      if (offset != null || dueDate != null || defaultDesiredCount != null) {
        const configuredRequests = new Set();
        for (const s of sent) {
          const reqRec = recipientBySuggestion.get(s.suggestionId)?.request;
          const reqId = reqRec?.akoya_requestid;
          if (!reqId || configuredRequests.has(reqId)) continue;
          configuredRequests.add(reqId);
          // Per-column "set only if unset" — the columns are independent, so never
          // clobber a value the editor (or a prior wave) already set, and fill a column
          // even if its sibling was pre-set. Codex Phase-1 finding #1.
          const patch = {};
          if (offset != null && reqRec.wmkf_respondoffsetdays == null) patch.wmkf_respondoffsetdays = offset;
          if (dueDate != null && reqRec.wmkf_reviewduedate == null) patch.wmkf_reviewduedate = dueDate;
          if (defaultDesiredCount != null && reqRec.wmkf_desiredcount == null) patch.wmkf_desiredcount = defaultDesiredCount;
          if (Object.keys(patch).length === 0) continue;
          try {
            await updateRequestById(reqId, patch, { actingUserSystemId });
          } catch (cfgErr) {
            console.warn(`Campaign-config write failed for request ${reqId} (invites already sent):`, cfgErr.message);
          }
        }
      }
    }

    sendEvent('result', {
      sent,
      failed,
      skipped,
      unconfirmed,
      stats: {
        sent: sent.length,
        failed: failed.length,
        skipped: skipped.length,
        unconfirmed: unconfirmed.length,
        total: drafts.length,
      },
      orcidBackprop: orcidStats,
    });

    sendEvent('complete', {
      message: `Sent ${sent.length} of ${drafts.length} ${templateType} email(s)`
        + (failed.length ? `; ${failed.length} failed` : '')
        + (unconfirmed.length ? `; ${unconfirmed.length} possibly sent (verify before retry)` : '')
        + (skipped.length ? `; ${skipped.length} skipped` : ''),
      sent: sent.length,
      failed: failed.length,
      skipped: skipped.length,
      unconfirmed: unconfirmed.length,
    });
  } catch (error) {
    // Terminal flow failure: emit ONE error event and RESOLVE (2s streaming
    // template) — the shell's catch handles only shell-level failures and
    // this path never double-emits.
    console.error('Review Manager send-emails error:', error);
    sendEvent('error', {
      message: BASE_CONFIG.ERROR_MESSAGES?.EMAIL_GENERATION_FAILED || 'Failed to send emails',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
}

export function plainTextToHtml(text, { programDirectorContact, reviewButtonLabel, templateType } = {}) {
  if (!text) return '';
  const normalized = normalizeEmailPlainText(String(text));
  if (templateType === 'invitation') {
    return invitationPlainTextToHtml(normalized, { programDirectorContact });
  }
  if (templateType === 'materials' && reviewButtonLabel) {
    return materialsPlainTextToHtml(normalized, { reviewButtonLabel });
  }
  return reviewerEmailPlainTextToHtml(normalized, { programDirectorContact, reviewButtonLabel });
}

function linkifyEmailText(normalized, { programDirectorContact, reviewButtonLabel } = {}) {
  const urlPattern = /(https?:\/\/[^\s<]+)/g;
  let html = '';
  let cursor = 0;
  let match;

  while ((match = urlPattern.exec(normalized)) !== null) {
    const url = match[0];
    html += plainTextFragmentToHtml(normalized.slice(cursor, match.index));
    // Only external-review URLs render as the styled CTA button, and only when a
    // stage label resolved (empty label — e.g. `thankyou` — falls through to a plain
    // link so the URL is preserved, never a button and never dropped).
    html += isExternalReviewUrl(url) && reviewButtonLabel
      ? reviewPortalButtonHtml(url, { programDirectorContact, label: reviewButtonLabel })
      : `<a href="${escapeAttribute(url)}">${escapeHtml(url)}</a>`;
    cursor = match.index + url.length;
  }

  html += plainTextFragmentToHtml(normalized.slice(cursor));
  return html;
}

function materialsPlainTextToHtml(normalized, { reviewButtonLabel } = {}) {
  const match = normalized.match(/https?:\/\/[^\s<]*\/external\/review\/[A-Za-z0-9._~-]+[^\s<]*/);
  if (!match) {
    return reviewerEmailPlainTextToHtml(normalized);
  }

  // The admin-authored message controls the prose order. The secure action is a
  // fixed delivery footer: remove its URL placeholder result from the authored
  // position, render the complete message (including signature), then append the
  // button and technical fallback. This keeps the raw URL as the final content.
  const withoutReviewUrl = normalizeEmailPlainText(
    `${normalized.slice(0, match.index)}${normalized.slice(match.index + match[0].length)}`,
  );
  const bodyHtml = reviewerEmailPlainTextToHtml(withoutReviewUrl);
  const actionHtml = reviewPortalButtonHtml(match[0], {
    label: reviewButtonLabel,
    includeProgramDirectorContact: false,
  });
  return `${bodyHtml}${actionHtml}`;
}

function reviewerEmailPlainTextToHtml(normalized, { programDirectorContact, reviewButtonLabel } = {}) {
  return normalized
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => reviewerEmailParagraphHtml(
      paragraph,
      { programDirectorContact, reviewButtonLabel },
    ))
    .join('');
}

function reviewerEmailParagraphHtml(paragraph, { programDirectorContact, reviewButtonLabel } = {}) {
  const urlPattern = /(https?:\/\/[^\s<]+)/g;
  let html = '';
  let inlineHtml = '';
  let cursor = 0;
  let match;

  while ((match = urlPattern.exec(paragraph)) !== null) {
    const url = match[0];
    const beforeUrl = paragraph.slice(cursor, match.index);
    if (isExternalReviewUrl(url) && reviewButtonLabel) {
      inlineHtml += plainTextFragmentToHtml(beforeUrl.replace(/\n+$/, ''));
      if (inlineHtml) {
        html += `<p style="margin:0 0 16px 0;">${inlineHtml}</p>`;
      }
      html += reviewPortalButtonHtml(url, { programDirectorContact, label: reviewButtonLabel });
      inlineHtml = '';
      cursor = match.index + url.length;
      while (paragraph[cursor] === '\n') cursor += 1;
      urlPattern.lastIndex = cursor;
      continue;
    }

    inlineHtml += plainTextFragmentToHtml(beforeUrl);
    inlineHtml += `<a href="${escapeAttribute(url)}">${escapeHtml(url)}</a>`;
    cursor = match.index + url.length;
  }

  inlineHtml += plainTextFragmentToHtml(paragraph.slice(cursor));
  if (inlineHtml) {
    html += `<p style="margin:0 0 16px 0;">${inlineHtml}</p>`;
  }
  return html;
}

const INVITATION_ACTION_MARKER = '[[WMKF_REVIEWER_RESPONSE_ACTIONS]]';

function invitationPlainTextToHtml(normalized, { programDirectorContact } = {}) {
  const urlPattern = /(https?:\/\/[^\s<]+)/g;
  let portalUrl = null;
  const bodyWithMarker = normalized.replace(urlPattern, (url) => {
    if (!isExternalReviewUrl(url)) return url;
    if (!portalUrl) {
      portalUrl = reviewerPortalBaseUrl(url);
      return INVITATION_ACTION_MARKER;
    }
    // The response buttons and fallback are structural. If an edited template
    // repeats the raw secure URL, suppress the duplicate rather than emitting
    // extra buttons or exposing multiple copies of the same credential.
    return '';
  });

  // The invitation send gate rejects a missing secure link before this renderer
  // is reached. Keep a defensive fallback for direct helper callers/tests.
  if (!portalUrl) return linkifyEmailText(normalized);

  const bodyParts = [];
  for (const paragraph of bodyWithMarker.split(/\n{2}/)) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;
    if (!trimmed.includes(INVITATION_ACTION_MARKER)) {
      bodyParts.push(invitationParagraphHtml(trimmed));
      continue;
    }
    const pieces = trimmed.split(INVITATION_ACTION_MARKER);
    if (pieces[0]?.trim()) bodyParts.push(invitationParagraphHtml(pieces[0].trim()));
    bodyParts.push(reviewResponseButtonsHtml(portalUrl));
    if (pieces.slice(1).join('').trim()) {
      bodyParts.push(invitationParagraphHtml(pieces.slice(1).join('').trim()));
    }
  }

  bodyParts.push(reviewerPortalFooterHtml(portalUrl, programDirectorContact));

  return [
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;">',
    '<tr>',
    '<td style="padding:0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;color:#222222;">',
    bodyParts.join(''),
    '</td>',
    '</tr>',
    '</table>',
  ].join('');
}

function invitationParagraphHtml(paragraph) {
  const lines = paragraph.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return '';

  if (lines.every((line) => /^(Honorarium|Response needed by):/i.test(line))) {
    const rows = lines.map((line) => {
      const colon = line.indexOf(':');
      const label = line.slice(0, colon);
      const value = line.slice(colon + 1).trim();
      return [
        '<tr>',
        `<td style="padding:4px 12px 4px 0;font-size:12px;line-height:18px;text-transform:uppercase;letter-spacing:.03em;color:#5a6472;">${escapeHtml(label)}</td>`,
        `<td style="padding:4px 0;font-size:15px;line-height:20px;font-weight:600;color:#222222;">${escapeHtml(value)}</td>`,
        '</tr>',
      ].join('');
    }).join('');
    return [
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin:0 0 18px 0;border:1px solid #dbe4f0;background:#f4f7fb;border-collapse:separate;border-radius:6px;">',
      `<tr><td style="padding:12px 16px;"><table role="presentation" cellspacing="0" cellpadding="0" border="0">${rows}</table></td></tr>`,
      '</table>',
    ].join('');
  }

  const heading = lines[0].toLowerCase();
  if (heading === 'proposal details') {
    return invitationDetailBlockHtml('Proposal details', lines.slice(1));
  }
  if (heading === 'abstract') {
    return invitationDetailBlockHtml('Abstract', lines.slice(1));
  }
  if (heading.startsWith('here’s the timeline') || heading.startsWith("here's the timeline")) {
    return invitationDetailBlockHtml(lines[0], lines.slice(1));
  }

  return `<p style="margin:0 0 16px 0;">${linkifyEmailText(paragraph)}</p>`;
}

function invitationDetailBlockHtml(title, lines) {
  const content = lines.length
    ? lines.map((line) => linkifyEmailText(line)).join('<br>')
    : '';
  return [
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin:0 0 18px 0;border:1px solid #e2e5ea;background:#fafbfc;border-collapse:separate;border-radius:6px;">',
    '<tr><td style="padding:14px 16px;">',
    `<p style="margin:0 0 8px 0;font-size:12px;line-height:18px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;color:#5a6472;">${escapeHtml(title)}</p>`,
    `<p style="margin:0;font-size:14px;line-height:22px;color:#333333;">${content}</p>`,
    '</td></tr>',
    '</table>',
  ].join('');
}

function reviewerPortalBaseUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete('action');
    return parsed.toString();
  } catch {
    return url;
  }
}

function reviewerActionUrl(url, action) {
  try {
    const parsed = new URL(reviewerPortalBaseUrl(url));
    parsed.searchParams.set('action', action);
    return parsed.toString();
  } catch {
    return url;
  }
}

function reviewResponseButtonsHtml(portalUrl) {
  const acceptHref = escapeAttribute(reviewerActionUrl(portalUrl, 'accept'));
  const declineHref = escapeAttribute(reviewerActionUrl(portalUrl, 'decline'));
  return [
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin:18px 0 20px 0;border-collapse:separate;">',
    '<tr>',
    '<td width="48%" align="center" valign="middle" bgcolor="#1f3a5f" style="width:48%;border-radius:5px;text-align:center;mso-padding-alt:13px 16px;">',
    `<a href="${acceptHref}" style="display:block;padding:13px 16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:20px;color:#ffffff;text-decoration:none;font-weight:700;text-align:center;">Yes, I Can Review</a>`,
    '</td>',
    '<td width="4%" style="width:4%;font-size:1px;line-height:1px;">&nbsp;</td>',
    '<td width="48%" align="center" valign="middle" style="width:48%;border:2px solid #1f3a5f;border-radius:5px;text-align:center;mso-padding-alt:11px 14px;">',
    `<a href="${declineHref}" style="display:block;padding:11px 14px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:20px;color:#1f3a5f;text-decoration:none;font-weight:700;text-align:center;">No, Not This Time</a>`,
    '</td>',
    '</tr>',
    '</table>',
  ].join('');
}

function reviewerPortalFooterHtml(portalUrl, programDirectorContact) {
  const href = escapeAttribute(portalUrl);
  const displayUrl = escapeHtml(portalUrl);
  return [
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin-top:8px;border-top:1px solid #e2e5ea;border-collapse:collapse;">',
    '<tr><td style="padding-top:14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:19px;color:#5a6472;">',
    `<p style="margin:0 0 12px 0;">${reviewerPortalContactLine(programDirectorContact)}</p>`,
    `<p style="margin:0;">If a button does not work, copy and paste this secure link into your browser:<br><a href="${href}" style="color:#1f3a5f;word-break:break-all;">${displayUrl}</a></p>`,
    '</td></tr>',
    '</table>',
  ].join('');
}

function normalizeEmailPlainText(text) {
  return String(text)
    .replace(/\r\n|\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

function plainTextFragmentToHtml(value) {
  return escapeHtml(value).replace(/\n/g, '<br>');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttribute(value) {
  return String(value)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isExternalReviewUrl(url) {
  return /\/external\/review\/[A-Za-z0-9._~-]+/.test(url);
}

// Stage-aware fallback labels for secure-link buttons. Invitation is listed for
// compatibility with the existing setting lookup, but its specialized renderer
// always emits the fixed paired response labels. For materials/follow-up these are
// the LAST resort when the admin setting is blank/unavailable. A templateType with
// NO entry here (e.g. `thankyou`) resolves to '' and its link stays plain text.
const DEFAULT_REVIEW_BUTTON_LABELS = {
  invitation: 'Yes, I Can Review',
  materials: 'Start Review',
  followup: 'Go to Review',
};

// Resolve the button label once per send batch (templateType is batch-level).
// Returns '' for a type with no configured/fallback label → the caller suppresses
// the button entirely rather than rendering an empty or mis-staged one.
async function resolveReviewButtonLabel(templateType) {
  const fallback = DEFAULT_REVIEW_BUTTON_LABELS[templateType] || '';
  try {
    const result = await getSettingStrict(`email.reviewer_${templateType}.button_label`);
    const value = result?.found ? String(result.value ?? '').trim() : '';
    return value || fallback;
  } catch {
    return fallback;
  }
}

function reviewPortalButtonHtml(
  url,
  { programDirectorContact, label = 'Start Review', includeProgramDirectorContact = true } = {},
) {
  const href = escapeAttribute(url);
  const displayUrl = escapeHtml(url);
  const securityLine = includeProgramDirectorContact
    ? reviewerPortalContactLine(programDirectorContact)
    : 'For your security, please do not forward this link.';
  return [
    '<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:14px 0 16px 0;border-collapse:separate;">',
    '<tr>',
    '<td align="center" valign="middle" bgcolor="#234c8c" style="border-radius:4px;text-align:center;mso-padding-alt:12px 18px;">',
    `<a href="${href}" style="display:inline-block;min-width:132px;padding:12px 18px;font-family:Arial,sans-serif;font-size:15px;line-height:20px;color:#ffffff;text-decoration:none;font-weight:600;text-align:center;">`,
    `<span style="color:#ffffff;text-decoration:none;">${escapeHtml(label)}</span>`,
    '</a>',
    '</td>',
    '</tr>',
    '</table>',
    `<p style="margin:0 0 12px 0;">${securityLine}</p>`,
    `<p style="margin:0 0 16px 0;">If the button does not work, copy and paste this secure link into your browser:<br><a href="${href}">${displayUrl}</a></p>`,
  ].join('');
}

function reviewerPortalContactLine(programDirectorContact = {}) {
  const name = String(programDirectorContact.name || '').trim();
  const email = String(programDirectorContact.email || '').trim();
  if (!name && !email) {
    return 'This secure link is unique to you and was sent by a W. M. Keck Foundation Program Director. Please contact the Foundation with any questions.';
  }
  const nameText = name ? escapeHtml(name) : 'Program Director';
  const emailText = email
    ? ` (<a href="mailto:${escapeAttribute(email)}" style="color:#1f3a5f;">${escapeHtml(email)}</a>)`
    : '';
  return `This secure link is unique to you and was sent by W. M. Keck Foundation Program Director ${nameText}${emailText}. Please contact them with any questions.`;
}

function getReviewerEmailDeliveryMode() {
  const mode = String(process.env.REVIEWER_EMAIL_DELIVERY_MODE || 'send').toLowerCase();
  if (!EMAIL_DELIVERY_MODES.has(mode)) {
    throw new Error(`Unknown REVIEWER_EMAIL_DELIVERY_MODE: ${mode}`);
  }
  if (mode === 'capture' && process.env.VERCEL_ENV === 'production') {
    throw new Error('REVIEWER_EMAIL_DELIVERY_MODE=capture is not allowed in Vercel production');
  }
  return mode;
}

function captureReviewerEmail(payload, { suggestionId, candidateName } = {}) {
  const capturedEmail = {
    suggestionId,
    candidateName,
    subject: payload.subject,
    htmlBody: payload.body,
    from: payload.from,
    to: payload.to,
    cc: payload.cc || null,
    regardingId: payload.regardingId || null,
    regardingType: payload.regardingType || null,
    attachmentNames: (payload.attachments || []).map((a) => a.filename).filter(Boolean),
    capturedAt: new Date().toISOString(),
  };
  return {
    emailId: `captured-${suggestionId || Date.now()}`,
    capturedEmail,
  };
}

// `ref` is either a legacy public blob URL or a private cycle-material pathname
// (cycle-materials/ prefix). Private refs are read server-side from the private
// store (Phase 1) and would otherwise be blocked by isAllowedUrl and silently
// dropped. `explicitFilename` (from the attachment JSON) wins when provided.
async function fetchAttachment(ref, cache, explicitFilename) {
  if (cache.has(ref)) return cache.get(ref);

  let buffer;
  let contentType;
  let filename;

  if (isPrivateCycleMaterialPathname(ref)) {
    buffer = await readUploadedBlobBuffer({ access: 'private', pathname: ref });
    contentType = 'application/octet-stream';
    filename = explicitFilename || ref.split('/').pop() || 'attachment';
  } else {
    if (!isAllowedUrl(ref)) {
      console.warn('fetchAttachment blocked non-allowed URL:', ref);
      return null;
    }
    const response = await safeFetch(ref);
    if (!response.ok) return null;
    buffer = Buffer.from(await response.arrayBuffer());
    contentType = response.headers.get('content-type') || 'application/octet-stream';
    filename = explicitFilename || new URL(ref).pathname.split('/').pop() || 'attachment';
  }

  const attachment = { filename, contentType, content: buffer };
  cache.set(ref, attachment);
  return attachment;
}
