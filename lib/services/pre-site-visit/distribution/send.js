/** Pre-Site distribution transport orchestration and recovery. */
import { isGuid } from '../../../utils/guid.js';
import { DEFAULT_DEPENDENCIES } from './dependencies.js';
import {
  SEND_ACCEPTED_STATUS_CODES, distributionError, sameId, parseStoredArray,
  attemptAttachments, assertPreparedAttachments, projectDistributionAttempt,
} from './model.js';
import { renderBriefingBody } from './composition.js';
import { assertAttemptSourceCurrent, assertAttemptExtensionsCurrent, resolveBoundBriefingUrl } from './context.js';
import {
  recoverEmailActivity, persistEmailIdentity, assertEmailActivityMatches, ensureEmailAttachment,
} from './email-recovery.js';

export async function sendPreSiteDistribution(input, dependencies = DEFAULT_DEPENDENCIES) {
  if (!isGuid(input.requestId) || !isGuid(input.operationId)
    || !/^[0-9a-f]{64}$/.test(String(input.previewHash || ''))) {
    throw distributionError('Valid requestId, operationId, and previewHash are required.', 'distribution_send_identity_invalid', 400);
  }
  if (!isGuid(input.actingUserSystemId)) {
    throw distributionError(
      'Your staff account is not linked to a Dynamics sender identity.',
      'distribution_staff_identity_required',
      403,
    );
  }
  let existing = await dependencies.getAttempt(input.operationId);
  if (!existing || !sameId(existing.request_id, input.requestId)) {
    throw distributionError('The prepared distribution was not found.', 'distribution_attempt_not_found', 404);
  }
  if (existing.preview_hash !== input.previewHash) {
    throw distributionError(
      'The email or attachment selection changed after preview. Prepare a new exact preview.',
      'distribution_preview_changed',
    );
  }
  if (existing.from_email !== String(input.fromEmail || '').toLowerCase()
    || !sameId(existing.acting_user_system_id, input.actingUserSystemId)) {
    throw distributionError('This preview belongs to a different staff sender.', 'distribution_actor_mismatch', 403);
  }
  if (existing.state === 'sent') return { attempt: projectDistributionAttempt(existing), reused: true };
  if (existing.state === 'preparing') {
    throw distributionError('Prepare and confirm the exact preview before sending.', 'distribution_not_prepared');
  }
  assertPreparedAttachments(existing);
  if (process.env.DYNAMICS_IMPERSONATION_ENABLED !== 'true') {
    throw distributionError(
      'Dynamics sender impersonation must be enabled before this distribution can be sent.',
      'distribution_impersonation_required',
      503,
    );
  }
  let attempt = await dependencies.claimSend(input.operationId);
  if (!attempt) {
    existing = await dependencies.getAttempt(input.operationId);
    if (existing?.state === 'sent') return { attempt: projectDistributionAttempt(existing), reused: true };
    throw distributionError(
      'This exact send is already in progress. Retry shortly to read its result.',
      'distribution_send_in_progress',
      202,
      { inProgress: true },
    );
  }
  try {
    // A retry of an attempt whose send intent is already durable reconciles
    // Dynamics transport status FIRST: if the email already went out, nothing
    // downstream (including briefing-link liveness) may block recording it.
    if (attempt.send_requested_at && attempt.dynamics_email_id) {
      const reconciled = await dependencies.getEmailActivity(attempt.dynamics_email_id).catch(() => null);
      if (SEND_ACCEPTED_STATUS_CODES.has(Number(reconciled?.statuscode))) {
        const sent = await dependencies.recordSent(attempt, reconciled);
        if (!sent) throw distributionError('Transport acceptance could not be persisted.', 'distribution_send_persist_failed', 502);
        return { attempt: projectDistributionAttempt(sent), reused: true };
      }
    }
    await assertAttemptSourceCurrent(attempt, dependencies);
    await assertAttemptExtensionsCurrent(attempt, dependencies);
    let briefingUrl = await resolveBoundBriefingUrl(attempt, dependencies);
    let email = await recoverEmailActivity(attempt, dependencies);
    if (!email && attempt.dynamics_email_id) {
      throw distributionError(
        'The persisted Dynamics email activity could not be found. Reconcile it before retrying.',
        'distribution_email_missing',
        409,
      );
    }
    if (email && !attempt.dynamics_email_id) {
      attempt = await persistEmailIdentity(attempt, email.activityid, dependencies);
    }
    if (!email) {
      const correlationKey = `wmkf-pre-site-distribution:${attempt.operation_id}`;
      try {
        const emailId = await dependencies.createEmailActivity({
          subject: attempt.subject,
          body: renderBriefingBody(attempt.body_html, briefingUrl),
          from: attempt.from_email,
          to: parseStoredArray(attempt.to_recipients),
          cc: parseStoredArray(attempt.cc_recipients),
          regardingId: attempt.request_id,
          regardingType: 'akoya_request',
          correlationKey,
          actingUserSystemId: input.actingUserSystemId || null,
          noFallback: true,
        });
        attempt = await persistEmailIdentity(attempt, emailId, dependencies);
        email = await dependencies.getEmailActivity(attempt.dynamics_email_id);
      } catch (error) {
        email = await recoverEmailActivity(attempt, dependencies);
        if (!email) throw error;
        attempt = await persistEmailIdentity(attempt, email.activityid, dependencies);
      }
    }
    if (!email) {
      throw distributionError(
        'The persisted Dynamics email activity could not be found. Reconcile it before retrying.',
        'distribution_email_missing',
        409,
      );
    }
    assertEmailActivityMatches(attempt, email, renderBriefingBody(attempt.body_html, briefingUrl));

    for (const file of attemptAttachments(attempt)) {
      const alreadyAttached = file.kind === 'docx'
        ? attempt.docx_attached_at
        : file.kind === 'pdf' ? attempt.pdf_attached_at : attempt.calendar_attached_at;
      if (!alreadyAttached) {
        await ensureEmailAttachment(attempt, file, dependencies, input.actingUserSystemId || null);
        attempt = await dependencies.recordAttachment(attempt, file.kind);
        if (!attempt) throw distributionError('Attachment completion could not be persisted.', 'distribution_attachment_persist_failed', 502);
      }
    }

    const statusBefore = await dependencies.getEmailActivity(attempt.dynamics_email_id);
    if (SEND_ACCEPTED_STATUS_CODES.has(Number(statusBefore?.statuscode))) {
      const sent = await dependencies.recordSent(attempt, statusBefore);
      if (!sent) throw distributionError('Transport acceptance could not be persisted.', 'distribution_send_persist_failed', 502);
      return { attempt: projectDistributionAttempt(sent), reused: true };
    }

    // Final rechecks run BEFORE send intent becomes durable: a failure here
    // (source, materials, schedule, or briefing link changed or expired during
    // attachment work) must leave the attempt provably unsent, not a
    // `send_requested` row that reads as an unresolved transport.
    await assertAttemptSourceCurrent(attempt, dependencies);
    await assertAttemptExtensionsCurrent(attempt, dependencies);
    briefingUrl = await resolveBoundBriefingUrl(attempt, dependencies);
    attempt = await dependencies.recordSendRequested(attempt);
    if (!attempt) {
      throw distributionError(
        'The exact send intent could not be persisted.',
        'distribution_send_request_persist_failed',
        502,
      );
    }
    attempt = await dependencies.renewSendLease(attempt);
    if (!attempt) {
      throw distributionError(
        'The exact send lease expired before transport. Retry to reconcile its state.',
        'distribution_send_lease_lost',
        409,
      );
    }
    try {
      await dependencies.sendEmail(attempt.dynamics_email_id, {
        actingUserSystemId: input.actingUserSystemId || null,
        noFallback: true,
      });
    } catch (error) {
      const ambiguous = await dependencies.getEmailActivity(attempt.dynamics_email_id).catch(() => null);
      if (!SEND_ACCEPTED_STATUS_CODES.has(Number(ambiguous?.statuscode))) {
        throw distributionError(
          'Dynamics has not confirmed this send. Check this exact email before trying again.',
          'distribution_send_unconfirmed',
          202,
          { outcome: 'uncertain', pendingSend: projectDistributionAttempt(attempt) },
        );
      }
    }
    const statusAfter = await dependencies.getEmailActivity(attempt.dynamics_email_id).catch(() => ({}));
    const sent = await dependencies.recordSent(attempt, statusAfter);
    if (!sent) throw distributionError('Transport acceptance could not be persisted.', 'distribution_send_persist_failed', 502);
    return { attempt: projectDistributionAttempt(sent), reused: false };
  } catch (error) {
    await dependencies.recordFailure(attempt, error, error?.code || 'distribution_send_failed').catch(() => {});
    throw error;
  }
}
