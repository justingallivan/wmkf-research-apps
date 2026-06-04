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
 *   - templateType: 'materials' | 'followup' | 'thankyou'
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
import { nextRateLimiter } from '../../../shared/api/middleware/rateLimiter';
import { safeFetch, isAllowedUrl } from '../../../lib/utils/safe-fetch';
import { DynamicsService } from '../../../lib/services/dynamics-service';
import { bypassDynamicsRestrictions } from '../../../lib/services/dynamics-context';
import { meetingDateToCycleCode } from '../../../lib/utils/cycle-code';
import * as suggestionAdapter from '../../../lib/dataverse/adapters/reviewer-suggestion';
import * as contactAdapter from '../../../lib/dataverse/adapters/contact';
import * as potentialReviewerAdapter from '../../../lib/dataverse/adapters/potential-reviewer';
import { backPropReviewerOrcidToContact } from '../../../lib/services/backprop-reviewer-orcid';
import { shouldSkipDuplicateInvitation, sendAllowsAttachments, recipientMayReceiveAttachments } from '../../../lib/utils/reviewer-invite';

const limiter = nextRateLimiter({ max: 10 });

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
    } = req.body;

    if (!Array.isArray(drafts) || drafts.length === 0) {
      sendEvent('error', { message: 'drafts array is required' });
      return res.end();
    }
    for (const d of drafts) {
      if (!d || !d.suggestionId || !d.subject || !d.body) {
        sendEvent('error', { message: 'each draft must have suggestionId, subject, body' });
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
          select: 'wmkf_potentialreviewersid,wmkf_name,wmkf_emailaddress,wmkf_firstname,wmkf_lastname,_wmkf_contact_value,wmkf_orcid,wmkf_identitystatus',
        }).catch(() => null) : null,
        requestId ? DynamicsService.getRecord('akoya_requests', requestId, {
          select: 'akoya_requestid,akoya_requestnum,wmkf_meetingdate',
        }).catch(() => null) : null,
      ]);
      recipientBySuggestion.set(d.suggestionId, { suggestion: sug, person, request });
    }

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
          const url = a.blobUrl || a.url;
          if (url && !attachmentCache.has(url)) {
            try {
              const att = await fetchAttachment(url, attachmentCache);
              if (att) sharedAttachments.push(att);
            } catch (err) {
              console.warn('Failed to fetch additional attachment:', url, err.message);
            }
          }
        }
      }
    }

    sendEvent('progress', {
      stage: 'sending',
      message: `Sending ${drafts.length} email(s) from ${fromEmail}...`,
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
      const name = person?.wmkf_name || null;
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

      // Attachment safety is SERVER-authoritative, not caller-controlled: proposal
      // materials only ride on an email to a recipient who has actually ACCEPTED
      // (`wmkf_accepted === true` on their suggestion row) — independent of the
      // caller-supplied templateType. A pre-acceptance recipient (an invitation,
      // or any mislabeled send) gets NO attachments (Codex S211 stop-gate). The
      // `allowAttachments` (templateType) gate above just avoids fetching them.
      const recipientAttachments = recipientMayReceiveAttachments(suggestion) ? sharedAttachments : [];

      try {
        const { emailId } = await DynamicsService.createAndSendEmail({
          subject: draft.subject,
          body: plainTextToHtml(draft.body),
          from: fromEmail,
          to: email,
          regardingId: regardingId || undefined,
          regardingType: regardingId ? 'akoya_request' : undefined,
          attachments: recipientAttachments,
          actingUserSystemId,
        });

        // Contact promotion: only if the potentialreviewer doesn't already
        // have a wmkf_contact link. Failures are non-fatal — the email
        // already shipped.
        let contactPromoted = false;
        let promotedContactId = null;
        try {
          if (person && !person._wmkf_contact_value) {
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
          if (person && cid) {
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
            // Pre-acceptance: mark invited + when the email went out, but do NOT
            // touch wmkf_reviewstatus — status only advances to 'accepted' when
            // the reviewer accepts in the external portal.
            await suggestionAdapter.updateLifecycle(s.suggestionId, {
              invited: true,
              emailSentAt: now,
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

function plainTextToHtml(text) {
  if (!text) return '';
  const escaped = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const linked = escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    (m) => `<a href="${m}">${m}</a>`,
  );
  return linked.replace(/\r\n|\r|\n/g, '<br>');
}

async function fetchAttachment(url, cache) {
  if (cache.has(url)) return cache.get(url);
  if (!isAllowedUrl(url)) {
    console.warn('fetchAttachment blocked non-allowed URL:', url);
    return null;
  }
  const response = await safeFetch(url);
  if (!response.ok) return null;

  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get('content-type') || 'application/octet-stream';
  const urlPath = new URL(url).pathname;
  const filename = urlPath.split('/').pop() || 'attachment';

  const attachment = { filename, contentType, content: buffer };
  cache.set(url, attachment);
  return attachment;
}
