/** Dynamics email activity and attachment recovery for distribution sends. */
import { isGuid } from '../../../utils/guid.js';
import { buildCalendar } from './context.js';
import { distributionError, sameId, parseStoredArray, sha256 } from './model.js';

export async function recoverEmailActivity(attempt, dependencies) {
  const correlationKey = `wmkf-pre-site-distribution:${attempt.operation_id}`;
  if (attempt.dynamics_email_id) {
    return dependencies.getEmailActivity(attempt.dynamics_email_id);
  }
  const matches = await dependencies.findEmailByCorrelation(correlationKey);
  if (matches.length > 1) {
    throw distributionError(
      'Multiple Dynamics email activities share this distribution identity.',
      'distribution_email_ambiguous',
      500,
    );
  }
  return matches[0] || null;
}
export async function persistEmailIdentity(attempt, emailId, dependencies) {
  if (!isGuid(emailId)) {
    throw distributionError(
      'Dynamics returned an invalid email activity identity.',
      'distribution_email_identity_invalid',
      502,
    );
  }
  if (attempt.dynamics_email_id) {
    if (!sameId(attempt.dynamics_email_id, emailId)) {
      throw distributionError(
        'The distribution ledger and Dynamics correlation resolved to different activities.',
        'distribution_email_identity_mismatch',
        500,
      );
    }
    return attempt;
  }

  let recordError = null;
  try {
    const persisted = await dependencies.recordEmailActivity(attempt, emailId);
    if (persisted) return persisted;
  } catch (error) {
    recordError = error;
  }

  const recovered = await recoverEmailActivity(attempt, dependencies);
  if (!recovered) {
    if (recordError) throw recordError;
    throw distributionError(
      'The Dynamics activity ID could not be persisted.',
      'distribution_email_persist_failed',
      502,
    );
  }
  if (!sameId(recovered.activityid, emailId)) {
    throw distributionError(
      'The distribution correlation resolved to a different Dynamics activity.',
      'distribution_email_identity_mismatch',
      500,
    );
  }
  const retried = await dependencies.recordEmailActivity(attempt, recovered.activityid);
  if (!retried) {
    throw distributionError(
      'The recovered Dynamics activity ID could not be persisted.',
      'distribution_email_persist_failed',
      502,
    );
  }
  return retried;
}
export function assertEmailActivityMatches(attempt, email, expectedBody = attempt.body_html) {
  const correlationKey = `wmkf-pre-site-distribution:${attempt.operation_id}`;
  const parties = Array.isArray(email?.email_activity_parties)
    ? email.email_activity_parties
    : [];
  const addresses = (mask) => parties
    .filter((party) => Number(party.participationtypemask) === mask)
    .map((party) => String(party.addressused || '').trim().toLowerCase())
    .filter(Boolean)
    .sort();
  const expectedTo = parseStoredArray(attempt.to_recipients).slice().sort();
  const expectedCc = parseStoredArray(attempt.cc_recipients).slice().sort();
  const expectedFrom = [attempt.from_email];
  if (email?.subject !== attempt.subject
    || email?.description !== expectedBody
    || email?.subcategory !== correlationKey
    || JSON.stringify(addresses(1)) !== JSON.stringify(expectedFrom)
    || JSON.stringify(addresses(2)) !== JSON.stringify(expectedTo)
    || JSON.stringify(addresses(3)) !== JSON.stringify(expectedCc)) {
    throw distributionError(
      'The recovered Dynamics activity no longer matches this exact preview.',
      'distribution_email_mismatch',
      500,
    );
  }
}
export async function attachmentContentMatches(attempt, file, content, dependencies) {
  if (!content) return false;
  if (file.kind === 'docx') {
    let governed = null;
    try {
      governed = await dependencies.hashDocx(content);
    } catch {
      governed = null;
    }
    return Boolean(governed) && governed === attempt.source_content_hash;
  }
  if (file.kind === 'calendar' && content.length !== file.size) return false;
  return sha256(content) === file.byteHash;
}
export async function ensureEmailAttachment(attempt, file, dependencies, actingUserSystemId) {
  const assertRecoveredAttachment = async (attachmentId) => {
    const recovered = await dependencies.getEmailAttachmentContent(attachmentId);
    let recoveredBytes;
    try {
      recoveredBytes = Buffer.from(String(recovered?.body || ''), 'base64');
    } catch {
      recoveredBytes = null;
    }
    if (!recoveredBytes
      || recovered?.filename !== file.filename
      || String(recovered?.mimetype || '').toLowerCase() !== file.contentType.toLowerCase()
      || (file.kind !== 'docx' && Number(recovered?.filesize) !== file.size)
      || !(await attachmentContentMatches(attempt, file, recoveredBytes, dependencies))) {
      throw distributionError(
        `The recovered Dynamics ${file.kind.toUpperCase()} attachment does not match the confirmed preview.`,
        'distribution_attachment_recovery_mismatch',
        500,
      );
    }
  };
  const found = await dependencies.findEmailAttachments(attempt.dynamics_email_id, file.filename);
  if (found.length > 1) {
    throw distributionError(
      `Dynamics contains duplicate ${file.kind.toUpperCase()} attachments for this activity.`,
      'distribution_attachment_ambiguous',
      500,
    );
  }
  if (found.length === 1) {
    await assertRecoveredAttachment(found[0].activitymimeattachmentid);
    return;
  }
  let content;
  if (file.kind === 'calendar') {
    const snapshot = typeof attempt.site_visit_snapshot === 'string'
      ? JSON.parse(attempt.site_visit_snapshot)
      : attempt.site_visit_snapshot;
    content = buildCalendar(snapshot).content;
  } else {
    const downloaded = await dependencies.downloadFile(file.driveId, file.itemId);
    content = downloaded.buffer;
  }
  if (!(await attachmentContentMatches(attempt, file, content, dependencies))) {
    throw distributionError(
      `The frozen ${file.kind.toUpperCase()} no longer matches the confirmed preview.`,
      'distribution_attachment_hash_mismatch',
    );
  }
  try {
    await dependencies.addEmailAttachment(attempt.dynamics_email_id, {
      filename: file.filename,
      contentType: file.contentType,
      content,
      actingUserSystemId,
      noFallback: true,
    });
  } catch (error) {
    const after = await dependencies.findEmailAttachments(attempt.dynamics_email_id, file.filename)
      .catch(() => []);
    if (after.length !== 1) throw error;
    await assertRecoveredAttachment(after[0].activitymimeattachmentid);
  }
}
