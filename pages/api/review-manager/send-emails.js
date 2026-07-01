/**
 * Review Manager - Send Emails (Dataverse-backed)
 *
 * POST /api/review-manager/send-emails
 *
 * Sends per-recipient emails via Dynamics email activities. Recipient data
 * comes from `wmkf_appreviewersuggestion` joined to `wmkf_potentialreviewers`
 * (suggestionId is now a Dataverse GUID). Cycle-level config (review template
 * blob, additional attachments) moved to Dataverse `wmkf_appgrantcycle` at W3
 * cutover (2026-05-12); the snake_case return shape of `loadCycleConfigs` is
 * preserved for backwards-compat with the sender below.
 *
 * After a successful send, the recipient `wmkf_potentialreviewers` row is
 * promoted to a CRM `contact` (find-or-create by email), and its
 * `wmkf_contact` lookup is filled if currently empty.
 *
 * Lifecycle timestamps land on `wmkf_appreviewersuggestion` via
 * `suggestionAdapter.updateLifecycle`.
 *
 * Request body:
 *   - drafts: Array<{ suggestionId, subject, body }> — pre-rendered per recipient
 *   - templateType: 'invitation' | 'materials' | 'followup' | 'thankyou'
 *   - attachmentUrls: string[] — additional attachment URLs (optional)
 *   - markAsSent: boolean — whether to update lifecycle (default true)
 *
 * SSE events:
 *   - progress { stage, message, current?, total? }
 *   - email_sent { suggestionId, candidateName, candidateEmail, emailId, contactPromoted? }
 *   - email_failed { suggestionId, candidateName, candidateEmail, error }
 *   - result { sent, failed, skipped, stats }
 *   - complete { message, sent, failed }
 *   - error { message }
 *
 * Data boundary: staff-shared. Any `review-manager` user can send to any
 * suggestion's reviewer; the sender attribution is the caller's session
 * email (Dynamics email activity sender + MSCRMCallerID on lifecycle and
 * contact-promotion writes when impersonation is enabled). Dynamics
 * restrictions are bypassed because reviewer outreach is a foundation-
 * owned workflow, not user-private.
 */

import { BASE_CONFIG } from '../../../shared/config/baseConfig';
import { findByShortCode as findCycleByShortCode } from '../../../lib/services/grant-cycles-dataverse';
import { requireAppAccess } from '../../../lib/utils/auth';
import { isGuid } from '../../../lib/utils/guid';
import { ContactParser } from '../../../lib/utils/contact-parser';
import { isYmd } from '../../../lib/utils/date-ymd';
import { nextRateLimiter } from '../../../shared/api/middleware/rateLimiter';
import { safeFetch, isAllowedUrl } from '../../../lib/utils/safe-fetch';
import { readUploadedBlobBuffer } from '../../../lib/utils/uploaded-blob';
import { isPrivateCycleMaterialPathname } from '../../../lib/utils/cycle-material-ref';
import { DynamicsService } from '../../../lib/services/dynamics-service';
import { bypassDynamicsRestrictions } from '../../../lib/services/dynamics-context';
import { meetingDateToCycleCode } from '../../../lib/utils/cycle-code';
import * as suggestionAdapter from '../../../lib/dataverse/adapters/reviewer-suggestion';
import * as contactAdapter from '../../../lib/dataverse/adapters/contact';
import * as potentialReviewerAdapter from '../../../lib/dataverse/adapters/potential-reviewer';
import { backPropReviewerOrcidToContact } from '../../../lib/services/backprop-reviewer-orcid';
import { getSettingStrict } from '../../../lib/services/settings-service';
import { shouldSkipDuplicateInvitation, sendAllowsAttachments, isKnownTemplateType, recipientMayReceiveAttachments, emailConfidence } from '../../../lib/utils/reviewer-invite';

const limiter = nextRateLimiter({ max: 10 });
const EMAIL_DELIVERY_MODES = new Set(['send', 'capture']);

function outgoingTextContainsRequestNumber({ subject, body, requestNumber }) {
  const n = String(requestNumber || '').trim();
  if (!n) return false;
  return String(subject || '').includes(n) || String(body || '').includes(n);
}

export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } },
  maxDuration: 300,
};

function splitName(fullName) {
  const trimmed = (fullName || '').trim();
  if (!trimmed) return { firstName: '', lastName: '' };
  const cleaned = trimmed.replace(/^(dr\.?|prof\.?|professor)\s+/i, '');
  const parts = cleaned.split(/\s+/);
  if (parts.length === 1) return { firstName: '', lastName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'review-manager', 'reviewers');
  if (!access) return;

  const fromEmail = access.session?.user?.azureEmail;
  const actingUserSystemId = access.session?.user?.dynamicsSystemuserId || null;
  if (!fromEmail) {
    return res.status(400).json({
      error: 'Could not determine sender email from your session. Please sign out and back in.',
    });
  }

  const allowed = await limiter(req, res);
  if (allowed !== true) return;

  return bypassDynamicsRestrictions('review-manager-send', async () => {

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

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
      // email confidence and REFUSES a LOW-confidence address unless the staff explicitly
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
    } = req.body;
    const confirmedLowConfidenceIdSet = new Set(
      Array.isArray(confirmedLowConfidenceIds) ? confirmedLowConfidenceIds : []
    );

    if (!Array.isArray(drafts) || drafts.length === 0) {
      sendEvent('error', { message: 'drafts array is required' });
      return res.end();
    }
    // Reject an unknown templateType BEFORE any real email goes out — an unhandled
    // type would otherwise send with no lifecycle stamp and (allowlist) no materials
    // (Codex chunk-6 #4). Fail closed.
    if (!isKnownTemplateType(templateType)) {
      sendEvent('error', { message: `Unknown templateType: ${templateType}` });
      return res.end();
    }
    // Stage-aware secure-link button label (admin-editable per templateType, blank →
    // stage default). Resolved once here since templateType is batch-level.
    const reviewButtonLabel = await resolveReviewButtonLabel(templateType);
    let deliveryMode;
    try {
      deliveryMode = getReviewerEmailDeliveryMode();
    } catch (modeErr) {
      sendEvent('error', { message: modeErr.message });
      return res.end();
    }
    for (const d of drafts) {
      if (!d || !d.suggestionId || !d.subject || !d.body) {
        sendEvent('error', { message: 'each draft must have suggestionId, subject, body' });
        return res.end();
      }
      // GUID-validate before findById/updateLifecycle (record-id selector
      // interpolated raw into the request URL). Fail closed before any send.
      if (!isGuid(d.suggestionId)) {
        sendEvent('error', { message: 'each draft suggestionId must be a valid GUID' });
        return res.end();
      }
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
        personId ? DynamicsService.getRecord('wmkf_potentialreviewerses', personId, {
          select: 'wmkf_potentialreviewersid,wmkf_name,wmkf_emailaddress,wmkf_firstname,wmkf_lastname,_wmkf_contact_value,wmkf_orcid,wmkf_identitystatus,wmkf_emailsource',
        }).catch(() => null) : null,
        requestId ? DynamicsService.getRecord('akoya_requests', requestId, {
          select: 'akoya_requestid,akoya_requestnum,wmkf_meetingdate,wmkf_respondoffsetdays,wmkf_reviewduedate,_wmkf_programdirector_value',
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
        const pd = await DynamicsService.getRecord('systemusers', pdId, {
          select: 'fullname,internalemailaddress,isdisabled',
        });
        if (pd && pd.isdisabled !== true) {
          programDirectorById.set(pdId, {
            name: pd.fullname || null,
            email: pd.internalemailaddress || null,
          });
        }
      } catch {
        // Non-fatal: the email still sends with a generic contact line.
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
    const cycleConfigByCode = await loadCycleConfigs(distinctCycleCodes);

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
        ? `Capturing ${drafts.length} email(s) from ${fromEmail}...`
        : `Sending ${drafts.length} email(s) from ${fromEmail}...`,
      total: drafts.length,
    });

    const sent = [];
    const failed = [];
    const skipped = [];
    // Aggregate ORCID back-prop outcomes so a per-recipient failure isn't a
    // vanished console.warn (design §8.2, Codex #21). Native Dataverse audit on
    // contact.wmkf_orcid is the durable record (§7); these are the run summary.
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
        skipped.push({ suggestionId: draft.suggestionId, candidateName: name, candidateEmail: null, reason: 'no_email' });
        sendEvent('progress', {
          stage: 'sending',
          current: processed,
          total: drafts.length,
          message: `Skipped ${name || '(unnamed)'} (no email)`,
        });
        continue;
      }

      // Slice G — invite-confidence gate (SERVER-authoritative; the API is the real
      // boundary, not the modal). Compute confidence from the person row's source +
      // identity; never trust a client-sent level. A LOW-confidence address (manually
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
      // materials email (and, via render-emails, never gets upgraded to the long-lived
      // materials token). The existing attachment gate strips materials FILES from a
      // mislabeled send; this refuses the materials EMAIL itself. Mirrors the
      // recipientMayReceiveAttachments accepted check (wmkf_accepted === true).
      if (templateType === 'materials' && suggestion?.wmkf_accepted !== true) {
        skipped.push({ suggestionId: draft.suggestionId, candidateName: name, candidateEmail: email, reason: 'not_accepted' });
        sendEvent('progress', {
          stage: 'sending',
          current: processed,
          total: drafts.length,
          message: `Skipped ${name || '(unnamed)'} (has not accepted — materials withheld)`,
        });
        continue;
      }

      const confidence = emailConfidence(person);
      const lowConfidenceConfirmed = confirmedLowConfidenceIdSet.has(draft.suggestionId);
      const isFirstContact = templateType === 'invitation';
      if (isFirstContact && confidence.level === 'low' && !lowConfidenceConfirmed) {
        skipped.push({
          suggestionId: draft.suggestionId,
          candidateName: name,
          candidateEmail: email,
          reason: 'email_unconfirmed',
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
      // email. Only applies to the invitation flow — materials/followup/thankyou
      // are intentionally re-sendable.
      if (shouldSkipDuplicateInvitation({ templateType, allowResend, invited: suggestion?.wmkf_invited === true })) {
        skipped.push({ suggestionId: draft.suggestionId, candidateName: name, candidateEmail: email, reason: 'already_invited' });
        sendEvent('progress', {
          stage: 'sending',
          current: processed,
          total: drafts.length,
          message: `Skipped ${name || '(unnamed)'} (already invited)`,
        });
        continue;
      }

      const regardingId = request?.akoya_requestid || null;
      const programDirectorContact = programDirectorById.get(request?._wmkf_programdirector_value) || {
        name: null,
        email: fromEmail,
      };
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

      try {
        const emailPayload = {
          subject: draft.subject,
          body: plainTextToHtml(draft.body, { programDirectorContact, reviewButtonLabel }),
          from: fromEmail,
          to: email,
          regardingId: regardingId || undefined,
          regardingType: regardingId ? 'akoya_request' : undefined,
          attachments: recipientAttachments,
          actingUserSystemId,
        };
        const { emailId, capturedEmail } = deliveryMode === 'capture'
          ? captureReviewerEmail(emailPayload, { suggestionId: draft.suggestionId, candidateName: name })
          : await DynamicsService.createAndSendEmail(emailPayload);

        // Contact promotion: only if the potentialreviewer doesn't already
        // have a wmkf_contact link. Failures are non-fatal — the email
        // already shipped.
        let contactPromoted = false;
        let promotedContactId = null;
        try {
          if (person && !person._wmkf_contact_value) {
            if (deliveryMode === 'capture') {
              contactPromoted = 'skipped_capture';
            } else {
              const fn = person.wmkf_firstname || splitName(name).firstName;
              const ln = person.wmkf_lastname || splitName(name).lastName || name || 'Unknown';
              const { id: contactId, created } = await contactAdapter.findOrCreateByEmail({
                firstName: fn || null,
                lastName: ln || null,
                email,
              }, { actingUserSystemId });
              await potentialReviewerAdapter.setContactLink(person.wmkf_potentialreviewersid, contactId, { actingUserSystemId });
              promotedContactId = contactId;
              contactPromoted = created ? 'created' : 'linked';
            }
          }
        } catch (promoteErr) {
          console.warn(`Contact promotion failed for ${name} <${email}>:`, promoteErr.message);
        }

        // ORCID back-propagation onto the contact (design §5). Runs against the
        // just-promoted contact OR an existing pointer — so already-linked
        // reviewers with an empty-ORCID contact are still filled. Non-fatal: the
        // email already shipped, and the helper's operational throws are caught
        // here (does NOT move the recipient to `failed` — confirmation pass).
        let orcidBackprop = null;
        try {
          const cid = promotedContactId || person?._wmkf_contact_value || null;
          if (deliveryMode === 'capture') {
            orcidBackprop = 'skipped_capture';
          } else if (person && cid) {
            const r = await backPropReviewerOrcidToContact({ reviewer: person, contactId: cid, actingUserSystemId });
            orcidBackprop = r.action || r.skipped || null;
            if (r.action === 'write') orcidStats.written++;
            else if (r.action === 'noop') orcidStats.noop++;
            else if (r.action === 'conflict') { orcidStats.conflict++; console.warn(`ORCID back-prop conflict for ${name} <${email}>: contact has ${r.existing}, reviewer ${r.incoming}`); }
            else if (r.action === 'malformed') { orcidStats.malformed++; console.warn(`ORCID back-prop malformed target for ${name} <${email}>: ${r.existing}`); }
            else if (r.skipped === 'ineligible') orcidStats.ineligible++;
            else if (r.skipped === 'no_contact') orcidStats.no_contact++;
          }
        } catch (bpErr) {
          orcidStats.error++;
          orcidBackprop = 'error';
          console.warn(`ORCID back-prop failed for ${name} <${email}>:`, bpErr.message);
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
          // Slice G — record the confidence the send went out under (HIGH, or LOW that
          // staff explicitly confirmed) so a low-confidence invite is auditable.
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
        console.error(`Failed to send to ${name} <${email}>:`, err.message);
        failed.push({
          suggestionId: draft.suggestionId,
          candidateName: name,
          candidateEmail: email,
          error: err.message,
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

    if (markAsSent && sent.length > 0) {
      sendEvent('progress', { stage: 'updating_lifecycle', message: 'Updating tracking data...' });
      const now = new Date().toISOString();

      for (const s of sent) {
        try {
          if (templateType === 'materials') {
            const ctx = recipientBySuggestion.get(s.suggestionId);
            const currentStatusValue = ctx?.suggestion?.wmkf_reviewstatus;
            // 100000000 = accepted; null = no status. Bump these to materials_sent.
            const shouldBump = currentStatusValue == null || currentStatusValue === 100000000;
            await suggestionAdapter.updateLifecycle(s.suggestionId, {
              materialsSentAt: now,
              ...(shouldBump ? { reviewStatus: 'materials_sent' } : {}),
            }, { actingUserSystemId });
          } else if (templateType === 'followup') {
            const ctx = recipientBySuggestion.get(s.suggestionId);
            const currentStatusValue = ctx?.suggestion?.wmkf_reviewstatus;
            const currentReminderCount = ctx?.suggestion?.wmkf_remindercount ?? 0;
            // 100000000 (accepted) or 100000001 (materials_sent) → bump to under_review
            const shouldBump = currentStatusValue === 100000000 || currentStatusValue === 100000001;
            await suggestionAdapter.updateLifecycle(s.suggestionId, {
              reminderSentAt: now,
              reminderCount: currentReminderCount + 1,
              ...(shouldBump ? { reviewStatus: 'under_review' } : {}),
            }, { actingUserSystemId });
          } else if (templateType === 'thankyou') {
            await suggestionAdapter.updateLifecycle(s.suggestionId, {
              thankYouSentAt: now,
              reviewStatus: 'complete',
            }, { actingUserSystemId });
          } else if (templateType === 'invitation') {
            // First contact: mark invited + when the email
            // went out, but do NOT touch wmkf_reviewstatus and do NOT set
            // wmkf_responsetype — the reviewer sets accepted/declined themselves
            // in the external portal.
            //
            // Reviewer-engagement Phase 3 (spec §3.B required side-effect): clear the
            // respond-by reminder fire-once marker in the SAME write as the emailSentAt
            // re-stamp. A Re-invite opens a NEW offer window (new emailSentAt → new
            // deadline); without clearing it, the prior wave's marker would block the
            // new window's reminder forever. (First-time invite: it's already null.)
            await suggestionAdapter.updateLifecycle(s.suggestionId, {
              invited: true,
              emailSentAt: now,
              respondReminderSentAt: null,
            }, { actingUserSystemId });
          }
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
    if (templateType === 'invitation' && !allowResend && campaignConfig && sent.length > 0) {
      const offsetRaw = campaignConfig.respondOffsetDays;
      const offset = Number.isInteger(offsetRaw) && offsetRaw >= 0 ? offsetRaw : null;
      const dueDate = isYmd(campaignConfig.reviewDueDate) ? campaignConfig.reviewDueDate : null;
      if (offset != null || dueDate != null) {
        const configuredRequests = new Set();
        for (const s of sent) {
          const reqRec = recipientBySuggestion.get(s.suggestionId)?.request;
          const reqId = reqRec?.akoya_requestid;
          if (!reqId || configuredRequests.has(reqId)) continue;
          configuredRequests.add(reqId);
          // Per-column "set only if unset" — the two columns are independent, so never
          // clobber a value the editor (or a prior wave) already set, and fill a column
          // even if its sibling was pre-set. Codex Phase-1 finding #1.
          const patch = {};
          if (offset != null && reqRec.wmkf_respondoffsetdays == null) patch.wmkf_respondoffsetdays = offset;
          if (dueDate != null && reqRec.wmkf_reviewduedate == null) patch.wmkf_reviewduedate = dueDate;
          if (Object.keys(patch).length === 0) continue;
          try {
            await DynamicsService.updateRecord('akoya_requests', reqId, patch, { actingUserSystemId });
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
      stats: { sent: sent.length, failed: failed.length, skipped: skipped.length, total: drafts.length },
      orcidBackprop: orcidStats,
    });

    sendEvent('complete', {
      message: `Sent ${sent.length} of ${drafts.length} ${templateType} email(s)`
        + (failed.length ? `; ${failed.length} failed` : '')
        + (skipped.length ? `; ${skipped.length} skipped (no email)` : ''),
      sent: sent.length,
      failed: failed.length,
      skipped: skipped.length,
    });

    res.end();
  } catch (error) {
    console.error('Review Manager send-emails error:', error);
    sendEvent('error', {
      message: BASE_CONFIG.ERROR_MESSAGES?.EMAIL_GENERATION_FAILED || 'Failed to send emails',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
    res.end();
  }
  });
}

// Dataverse-backed at W3 cutover. Returns the same snake_case shape the
// sender consumes (short_code, review_template_blob_url,
// additional_attachments). Duplicate-shortcode resolution is now enforced
// by the wmkf_shortcode alt-key — there can only be one match per code.
// Transport errors propagate to the SSE handler (parity with pre-cutover
// SQL behavior); only row-not-found stays silent.
async function loadCycleConfigs(cycleCodes) {
  const out = {};
  if (!cycleCodes.length) return out;
  const results = await Promise.all(cycleCodes.map(code => findCycleByShortCode(code)));
  for (const cycle of results) {
    if (!cycle || !cycle.shortCode) continue;
    if (out[cycle.shortCode]) continue;
    out[cycle.shortCode] = {
      short_code: cycle.shortCode,
      review_template_blob_url: cycle.reviewTemplateBlobUrl,
      additional_attachments: cycle.additionalAttachments,
    };
  }
  return out;
}

export function plainTextToHtml(text, { programDirectorContact, reviewButtonLabel } = {}) {
  if (!text) return '';
  const normalized = normalizeEmailPlainText(String(text));
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

// Stage-aware fallback labels for the secure-link button, keyed by templateType.
// These are the LAST resort when the admin `email.reviewer_<type>.button_label`
// setting is blank/unavailable — the DB (seeded from the same wording) is the
// source of truth. Unlike subject/body (blank renders blank, by design), a blank
// button label would render an empty button in the SENT email — which the PD never
// previews — so we deliberately fall back to a non-empty, stage-appropriate label.
// A templateType with NO entry here (e.g. `thankyou`) resolves to '' → NO button:
// if such a body ever contains a review link, it renders as a plain link, never a
// CTA button (see plainTextToHtml). `thankyou` has no {{externalLink}} in its seed,
// but the template editor advertises the token for it, so this path is reachable.
const DEFAULT_REVIEW_BUTTON_LABELS = {
  invitation: 'Respond to Invitation',
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

function reviewPortalButtonHtml(url, { programDirectorContact, label = 'Start Review' } = {}) {
  const href = escapeAttribute(url);
  const displayUrl = escapeHtml(url);
  const contactLine = reviewerPortalContactLine(programDirectorContact);
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
    `<p style="margin:0 0 12px 0;">${contactLine}</p>`,
    `<p style="margin:0;">If the button does not work, copy and paste this secure link into your browser:<br><a href="${href}">${displayUrl}</a></p>`,
  ].join('');
}

function reviewerPortalContactLine(programDirectorContact = {}) {
  const name = String(programDirectorContact.name || '').trim();
  const email = String(programDirectorContact.email || '').trim();
  const contact = [name, email].filter(Boolean).join(' ');
  if (!contact) {
    return 'This secure link is unique to you and was sent by W.M. Keck Foundation Program Director. Please contact them with any questions.';
  }
  return `This secure link is unique to you and was sent by W.M. Keck Foundation Program Director ${escapeHtml(contact)}. Please contact them with any questions.`;
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
