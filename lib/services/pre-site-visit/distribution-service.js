/**
 * Frozen Pre-Site informational distribution coordinator.
 *
 * Captures one exact editable Word version, retains an immutable DOCX snapshot,
 * optionally derives PDF under native version/eTag fences, binds the selected
 * bytes and compose fields into an exact preview, and resumes one Dynamics
 * activity through granular attachment/send steps. Non-sent sends require
 * literal impersonation, current-source readback, durable activity identity,
 * and a renewed pre-transport lease. READY snapshot reuse refreshes registry
 * metadata only after a stable read and exact byte/hash verification.
 * SharePoint + Request Document own file identity, Postgres owns recovery
 * state, and Dynamics owns transport.
 * Distribution history and preview preparation read the admin-governed
 * Share-for-deliberation subject/body and briefing-section copy; blank or
 * unavailable settings retain the code-owned fallback. The bound URL and
 * expiration date remain server-owned.
 */
import { isGuid } from '../../utils/guid.js';
import { reviewSetFingerprint } from './review-bundle-service.js';
import {
  assertStableSource, assertStableFrozenWord, captureCurrentSource, loadCapturedSource,
  ensureSnapshot, retainReviewBundle,
} from './distribution/retained-snapshot.js';
import {
  PRE_RP_BRIEF_CONTRACT,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../../shared/config/requestDocument.js';
import { DEFAULT_DEPENDENCIES } from './distribution/dependencies.js';
import {
  DOCX, PDF, TEMPLATE_VERSION, SEND_ACCEPTED_STATUS_CODES,
  distributionError, sameId, sha256, canonicalHash, parseStoredArray,
  attemptAttachments, assertPreparedAttachments,
  projectDistributionAttempt,
} from './distribution/model.js';
import {
  normalizeDistributionRecipients, includeCalendarOrganizer,
  BRIEFING_LINK_PLACEHOLDER, REVIEW_BUNDLE_LINK_PLACEHOLDER, reviewBundleDocumentUrl,
  renderBriefingBody, sessionSnapshotOf, sessionSnapshotsMatch, sessionLineText,
  distributionBodyHtml, normalizeComposeInput,
} from './distribution/composition.js';
import {
  readDeliberationShareDefaults, readSessionSnapshot, resolveMaterialLinks,
  buildCalendar, resolveCalendar, resolveSource,
  assertBriefInputsReady, resolveBriefingLink, resolveBoundBriefingUrl,
  assertAttemptSourceCurrent, assertAttemptExtensionsCurrent,
} from './distribution/context.js';






























/**
 * Briefing page section of the Share email (docs/DELIBERATION_BRIEFING_PAGE_PLAN.md
 * §2.2): present only when the deliberation briefing link was minted for this
 * exact preview. The link is the carrier for reviews and the proposal;
 * they are never attached.
 */
// The stored body never carries the raw briefing token: the href holds this
// marker and `renderBriefingBody` substitutes the live URL only while building
// or comparing the Dynamics activity (Codex adversarial review, 2026-09-09).

// Plan §11 (Step C2): the review-bundle document link, resolved from the
// SAME briefing token — no second token is ever minted.


/**
 * Derive the review-bundle document route URL from the briefing page URL,
 * reusing its exact token: `.../external/briefing/<jwt>` becomes
 * `.../api/external/briefing/<jwt>/document?member=review-bundle`. Returns
 * null when `briefingUrl` isn't a recognizable briefing page URL.
 */




/**
 * The deliberation-session snapshot the preview binds to (tracker plan §5.6).
 * Only https meeting links are carried; anything else renders as no link.
 */


























// The source is the Pre-Research Presentation Brief (plan §3, slice 4). The
// Pre-Site pointer (`_wmkf_currentpresitevisit_value`) is no longer read
// anywhere in this file; a pre-existing unsent attempt whose
// `source_document_id` names a Pre-Site row therefore fails closed as
// `distribution_stale_source` here (that row can never resolve through the
// brief pointer) — see `assertAttemptSourceCurrent`, which calls this same
// function, and the round-1 test for that fall-through.


export async function preparePreSiteDistribution(input, dependencies = DEFAULT_DEPENDENCIES) {
  if (!isGuid(input.requestId) || !isGuid(input.expectedArtifactId) || !isGuid(input.operationId)) {
    throw distributionError(
      'requestId, expectedArtifactId, and operationId must be GUIDs.',
      'distribution_identity_invalid',
      400,
    );
  }
  if (!input.fromEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.fromEmail)) {
    throw distributionError('Your account has no valid sending address.', 'distribution_sender_invalid', 400);
  }
  if (!isGuid(input.actingUserSystemId)) {
    throw distributionError(
      'Your staff account is not linked to a Dynamics sender identity.',
      'distribution_staff_identity_required',
      403,
    );
  }
  const compose = normalizeComposeInput(input);
  const { request, row: sourceRow } = await resolveSource(
    input.requestId,
    input.expectedArtifactId,
    dependencies,
  );
  // Plan §3.4b: the review/drift gate runs immediately after resolveSource
  // and this read-only live-input load, before any write below (material/
  // calendar resolution, briefing-link mint, createOrGetAttempt,
  // ensureSnapshot).
  const briefGate = await assertBriefInputsReady({
    sourceRow,
    requestId: input.requestId,
    acknowledgeStaleInputs: input.acknowledgeStaleInputs || null,
  }, dependencies);
  const [materialLinks, calendar, emailDefaults] = await Promise.all([
    resolveMaterialLinks(input.requestId, compose.selectedMaterialIds, dependencies),
    resolveCalendar(input.requestId, compose, dependencies),
    readDeliberationShareDefaults(dependencies),
  ]);
  const recipients = calendar
    ? includeCalendarOrganizer(compose.recipients, calendar.snapshot.organizerEmail)
    : compose.recipients;
  const briefingLink = await resolveBriefingLink(input, dependencies);
  // Tracker §5.6: the email carries the request's latest deliberation slot,
  // snapshotted here so the body and both hashes bind to it; send rechecks it.
  const sessionSnapshot = await readSessionSnapshot(input.requestId, dependencies);
  const briefingCopy = emailDefaults.briefingCopy;
  const bodyHtml = distributionBodyHtml(
    compose.bodyText,
    input.operationId,
    materialLinks,
    briefingLink,
    sessionSnapshot,
    briefingCopy,
  );
  const draftHash = canonicalHash({
    requestId: input.requestId,
    sourceDocumentId: sourceRow.wmkf_requestdocumentid,
    session: sessionSnapshot,
    attachmentMode: compose.attachmentMode,
    // Plan §3.4b step 4: bind the generated/live fingerprints, the bounded
    // delta, and the acknowledged fingerprint into the operation-id
    // conflict identity, so a same-operation-id retry with a DIFFERENT
    // acknowledgement conflicts instead of silently reusing the prior
    // attempt, while a lost-response retry with the SAME acknowledgement
    // (or none) still recovers it.
    briefInputFingerprintGenerated: briefGate.generatedFingerprint,
    briefInputFingerprintLive: briefGate.liveFingerprint,
    briefInputsAcknowledgedFingerprint: briefGate.acknowledgedFingerprint,
    briefInputsDelta: briefGate.delta,
    // Plan §11 (Step C1): bind the live received review set's identity so a
    // same-operation-id retry after the review set changed conflicts
    // instead of silently reusing the prior (now stale) bundle.
    reviewBundleSetFingerprint: reviewSetFingerprint(briefGate.liveReviews),
    ...(briefingLink ? { briefingLinkId: briefingLink.id } : {}),
    to: recipients.to,
    cc: recipients.cc,
    subject: compose.subject,
    bodyText: compose.bodyText,
    briefingCopy,
    materialLinks,
    calendar: calendar ? {
      siteVisitId: calendar.snapshot.activityId,
      siteVisitEtag: calendar.snapshot.etag,
      byteHash: calendar.attachment.byteHash,
    } : null,
    fromEmail: input.fromEmail.toLowerCase(),
    actingUserSystemId: input.actingUserSystemId || null,
    templateVersion: TEMPLATE_VERSION,
  });
  let attempt = await dependencies.createOrGetAttempt({
    operationId: input.operationId,
    requestId: input.requestId,
    sourceDocumentId: sourceRow.wmkf_requestdocumentid,
    attachmentMode: compose.attachmentMode,
    toRecipients: recipients.to,
    ccRecipients: recipients.cc,
    subject: compose.subject,
    bodyText: compose.bodyText,
    bodyHtml,
    fromEmail: input.fromEmail.toLowerCase(),
    actingUserSystemId: input.actingUserSystemId || null,
    draftHash,
    templateVersion: TEMPLATE_VERSION,
    calendarEnabled: Boolean(calendar),
    siteVisitId: calendar?.snapshot.activityId || null,
    siteVisitEtag: calendar?.snapshot.etag || null,
    siteVisitSnapshot: calendar?.snapshot || null,
    sessionSnapshot,
    materialLinks,
    calendar: calendar?.attachment || null,
    inputFingerprintGenerated: briefGate.generatedFingerprint,
    inputFingerprintLive: briefGate.liveFingerprint,
    staleInputsDelta: briefGate.delta,
    staleInputsAcknowledgedAt: briefGate.delta ? dependencies.now().toISOString() : null,
    staleInputsAcknowledgedBy: briefGate.delta ? (input.actingUserSystemId || null) : null,
  });
  if (!attempt || attempt.draft_hash !== draftHash
    || !sameId(attempt.request_id, input.requestId)
    || !sameId(attempt.source_document_id, sourceRow.wmkf_requestdocumentid)) {
    throw distributionError(
      'This operation ID is already bound to a different preview. Start a new preview.',
      'distribution_operation_conflict',
    );
  }
  if (attempt.state !== 'preparing') {
    return { attempt: projectDistributionAttempt(attempt), reused: true, briefingLink };
  }
  if (briefingLink && !sameId(attempt.briefing_link_id, briefingLink.id)) {
    attempt = await dependencies.recordBriefingLink(input.operationId, briefingLink.id);
    if (!attempt) {
      throw distributionError('The briefing link could not be bound to this preview.', 'distribution_briefing_persist_failed', 502);
    }
  }

  const captured = await loadCapturedSource(attempt, sourceRow, dependencies);
  attempt = await dependencies.recordSource(input.operationId, captured);
  if (!attempt) {
    throw distributionError('The exact source identity could not be persisted.', 'distribution_source_persist_failed', 502);
  }

  // Recheck the current pointer after the source identity is durable and before
  // creating the downstream Request Document that closes guarded reopen.
  await resolveSource(input.requestId, sourceRow.wmkf_requestdocumentid, dependencies);

  const sourceHashTag = captured.byteHash.slice(0, 16);
  const folderPath = `${sourceRow.wmkf_sharepointfolderpath.replace(/\/+$/, '')}/Distribution Snapshots`;
  const baseName = `PreRPBrief_${String(request.akoya_requestnum || input.requestId).replace(/[^A-Za-z0-9_-]/g, '_')}`
    + `_${sourceHashTag}`;
  const word = await ensureSnapshot({
    format: 'docx',
    requestId: input.requestId,
    requestNumber: request.akoya_requestnum || input.requestId,
    cycleCode: sourceRow.wmkf_cyclecode,
    sourceDocumentId: sourceRow.wmkf_requestdocumentid,
    sourceVersionId: captured.versionId,
    sourceContentHash: captured.contentHash,
    sourceByteHash: captured.byteHash,
    contentType: DOCX,
    contentHash: captured.contentHash,
    byteHash: captured.byteHash,
    expectedByteHash: captured.byteHash,
    folderPath,
    filename: `${baseName}.docx`,
    buffer: captured.buffer,
  }, dependencies, input.actingUserSystemId || null);

  let pdf = null;
  if (compose.attachmentMode !== 'docx') {
    pdf = await ensureSnapshot({
      format: 'pdf',
      requestId: input.requestId,
      requestNumber: request.akoya_requestnum || input.requestId,
      cycleCode: sourceRow.wmkf_cyclecode,
      sourceDocumentId: word.documentId,
      sourceVersionId: word.versionId,
      sourceContentHash: captured.contentHash,
      sourceByteHash: word.byteHash,
      contentType: PDF,
      contentHash: null,
      folderPath,
      filename: `${baseName}.pdf`,
      buildBuffer: async () => {
        const before = await dependencies.getFileMetadataById(
          word.driveId,
          word.itemId,
          { siteId: word.siteId || null },
        );
        const pdfBuffer = await dependencies.downloadFileAsPdf(word.driveId, word.itemId);
        const after = await dependencies.getFileMetadataById(
          word.driveId,
          word.itemId,
          { siteId: word.siteId || null },
        );
        assertStableFrozenWord(before, after, word);
        if (!pdfBuffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
          throw distributionError('Microsoft Graph did not return a PDF.', 'distribution_pdf_invalid', 502);
        }
        return pdfBuffer;
      },
    }, dependencies, input.actingUserSystemId || null);
  }

  // Plan §11 (Step C1): the "every review" bundle is assembled and retained
  // unconditionally (regardless of attachmentMode — the briefing page serves
  // it, the same way it serves the DOCX/PDF snapshots). A Graph failure or
  // an invalid part throws out of `retainReviewBundle` before `recordPrepared`
  // is ever called, so no attempt reaches `prepared` without a bundle (fail
  // closed).
  const {
    snapshot: reviewBundleSnapshot,
    assembly: reviewBundleAssembly,
    setFingerprint: reviewBundleSetFingerprintValue,
  } = await retainReviewBundle({
    requestId: input.requestId,
    requestNumber: request.akoya_requestnum || input.requestId,
    cycleCode: sourceRow.wmkf_cyclecode,
    sourceDocumentId: sourceRow.wmkf_requestdocumentid,
    folderPath,
    institutionName: briefGate.institutionName,
    reviews: briefGate.liveReviews,
  }, dependencies, input.actingUserSystemId || null);

  const selected = [
    ...(['docx', 'both'].includes(compose.attachmentMode) ? [{ kind: 'docx', ...word }] : []),
    ...(['pdf', 'both'].includes(compose.attachmentMode) ? [{ kind: 'pdf', ...pdf }] : []),
  ];
  const snapshotIdentity = (file) => (file ? {
    documentId: file.documentId,
    driveId: file.driveId,
    itemId: file.itemId,
    versionId: file.versionId,
    byteHash: file.byteHash,
    size: file.size,
  } : null);
  const previewHash = canonicalHash({
    operationId: input.operationId,
    requestId: input.requestId,
    sourceDocumentId: sourceRow.wmkf_requestdocumentid,
    sourceVersionId: captured.versionId,
    sourceByteHash: captured.byteHash,
    attachmentMode: compose.attachmentMode,
    briefInputFingerprintGenerated: briefGate.generatedFingerprint,
    briefInputFingerprintLive: briefGate.liveFingerprint,
    briefInputsAcknowledgedFingerprint: briefGate.acknowledgedFingerprint,
    briefInputsDelta: briefGate.delta,
    // Plan §11 (Step C1): the pinned review bundle identity is part of the
    // exact preview the briefing page serves, same rationale as the
    // DOCX/PDF snapshots below.
    reviewBundle: {
      documentId: reviewBundleSnapshot.documentId,
      driveId: reviewBundleSnapshot.driveId,
      itemId: reviewBundleSnapshot.itemId,
      versionId: reviewBundleSnapshot.versionId,
      byteHash: reviewBundleSnapshot.byteHash,
      size: reviewBundleSnapshot.size,
      setFingerprint: reviewBundleSetFingerprintValue,
      reviewCount: reviewBundleAssembly.reviewCount,
    },
    ...(briefingLink ? { briefingLinkId: briefingLink.id } : {}),
    // The pinned snapshots are part of the exact preview even when nothing is
    // attached: the briefing page serves these bytes, so a snapshot swap must
    // invalidate the preview the same way an attachment swap always has.
    snapshots: { docx: snapshotIdentity(word), pdf: snapshotIdentity(pdf) },
    session: sessionSnapshot,
    attachments: selected.map((file) => ({
      kind: file.kind,
      documentId: file.documentId,
      driveId: file.driveId,
      itemId: file.itemId,
      versionId: file.versionId,
      filename: file.filename,
      contentType: file.contentType,
      byteHash: file.byteHash,
      size: file.size,
    })).concat(calendar ? [{
      kind: 'calendar',
      filename: calendar.attachment.filename,
      contentType: calendar.attachment.contentType,
      byteHash: calendar.attachment.byteHash,
      size: calendar.attachment.size,
    }] : []),
    materialLinks,
    siteVisit: calendar ? {
      activityId: calendar.snapshot.activityId,
      etag: calendar.snapshot.etag,
    } : null,
    to: recipients.to,
    cc: recipients.cc,
    subject: compose.subject,
    bodyText: compose.bodyText,
    briefingCopy,
    fromEmail: input.fromEmail.toLowerCase(),
    actingUserSystemId: input.actingUserSystemId || null,
    templateVersion: TEMPLATE_VERSION,
  });
  attempt = await dependencies.recordPrepared(input.operationId, {
    // The finalizing UPDATE fences on this exact capture (store docblock).
    source: {
      driveId: captured.driveId,
      itemId: captured.itemId,
      versionId: captured.versionId,
      contentHash: captured.contentHash,
      byteHash: captured.byteHash,
    },
    docx: word,
    pdf,
    reviewBundle: {
      documentId: reviewBundleSnapshot.documentId,
      driveId: reviewBundleSnapshot.driveId,
      itemId: reviewBundleSnapshot.itemId,
      versionId: reviewBundleSnapshot.versionId,
      filename: reviewBundleSnapshot.filename,
      size: reviewBundleSnapshot.size,
      byteHash: reviewBundleSnapshot.byteHash,
      setFingerprint: reviewBundleSetFingerprintValue,
      reviewCount: reviewBundleAssembly.reviewCount,
    },
    calendar: calendar?.attachment || null,
    previewHash,
  });
  if (!attempt) {
    throw distributionError('The exact preview could not be persisted.', 'distribution_preview_persist_failed', 502);
  }
  return { attempt: projectDistributionAttempt(attempt), reused: false, briefingLink };
}

/**
 * Deliberation briefing link for this exact preview
 * (docs/DELIBERATION_BRIEFING_PAGE_PLAN.md §2.2). Required since 2026-09-10:
 * the email carries no attachment, so a preview that cannot carry a live link
 * refuses here, before anything is persisted, rather than sending a bare
 * email. Flag off (or link service unwired) is a 503 the composer shows
 * verbatim; a mint failure stays a 502.
 */


/**
 * The attempt's bound briefing link must still be THE live link for the
 * request. Returns its URL (unsealed by the link service) so the email body
 * can be rendered at activity creation and re-rendered for recovery matching;
 * the raw token is never persisted on the attempt. Runs at claim time and
 * again immediately before transport so a reissue during attachment work
 * cannot email a dead link.
 */


async function recoverEmailActivity(attempt, dependencies) {
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

async function persistEmailIdentity(attempt, emailId, dependencies) {
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





function assertEmailActivityMatches(attempt, email, expectedBody = attempt.body_html) {
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

/**
 * Attachment identity at send. A frozen Word attachment is identified by its
 * governed content hash (the captured source's `source_content_hash`, which
 * the Word snapshot inherits at prepare), never by package bytes: SharePoint
 * rewrites a generated .docx after upload, so the bytes served later (and the
 * bytes Dynamics stored from an earlier attempt) legitimately differ from the
 * pinned `docx_byte_hash` (plan §12 Finding A, 2026-09-17). PDF and calendar
 * attachments are verbatim and keep the byte identity.
 */
async function attachmentContentMatches(attempt, file, content, dependencies) {
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

async function ensureEmailAttachment(attempt, file, dependencies, actingUserSystemId) {
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

// Distinct acknowledging-actor GUIDs → full names for the staff history
// (B14). Best effort: a failed or missing lookup leaves the name null and
// never fails the history read.
async function resolveAcknowledgingActorNames(attempts, dependencies) {
  if (typeof dependencies.getSystemUserName !== 'function') return null;
  const ids = [...new Set(
    attempts
      .map((attempt) => String(attempt.stale_inputs_acknowledged_by || '').toLowerCase())
      .filter((id) => isGuid(id)),
  )];
  if (ids.length === 0) return null;
  const names = new Map();
  await Promise.all(ids.map(async (id) => {
    try {
      const name = await dependencies.getSystemUserName(id);
      if (name) names.set(id, String(name));
    } catch (error) {
      console.error('[pre-site distribution history] actor name read failed:', error?.message || error);
    }
  }));
  return names;
}

export async function getPreSiteDistributionHistory(
  { requestId },
  dependencies = DEFAULT_DEPENDENCIES,
) {
  if (!isGuid(requestId)) {
    throw distributionError('requestId must be a GUID.', 'distribution_request_invalid', 400);
  }
  const [attempts, currentSource, briefingLink, emailDefaults] = await Promise.all([
    dependencies.listAttempts(requestId),
    (async () => {
      try {
        const request = await dependencies.getRequest(requestId);
        const documentId = request?._wmkf_currentprerpbrief_value || null;
        if (!documentId) return null;
        const result = await dependencies.findDocumentsByRequest(requestId, {
          artifactType: PRE_RP_BRIEF_CONTRACT.artifactType,
        });
        const row = (result.records || []).find((candidate) => (
          sameId(candidate.wmkf_requestdocumentid, documentId)
        ));
        if (!row?.wmkf_sharepointdriveid || !row?.wmkf_sharepointitemid) {
          return { documentId, versionId: null };
        }
        const metadata = await dependencies.getFileMetadataById(
          row.wmkf_sharepointdriveid,
          row.wmkf_sharepointitemid,
          { siteId: row.wmkf_sharepointsiteid || null },
        );
        return { documentId, versionId: metadata?.versionId || null };
      } catch {
        return null;
      }
    })(),
    // Live briefing link for the staff header (plan §2.4); null when the flag
    // is off or the caller's dependency set does not wire the link service.
    (async () => {
      if (typeof dependencies.briefingReady !== 'function' || !dependencies.briefingReady()) return null;
      if (typeof dependencies.getLiveBriefingLink !== 'function') return null;
      try {
        return await dependencies.getLiveBriefingLink(requestId);
      } catch (error) {
        console.error('[pre-site distribution history] briefing link read failed:', error?.message || error);
        return null;
      }
    })(),
    readDeliberationShareDefaults(dependencies),
  ]);
  const actorNames = await resolveAcknowledgingActorNames(attempts, dependencies);
  return {
    briefingLink,
    emailDefaults,
    attempts: attempts.map((attempt) => {
      let sourceFreshness = 'unknown';
      if (attempt.source_version_id && currentSource?.documentId) {
        sourceFreshness = !sameId(currentSource.documentId, attempt.source_document_id)
          || (currentSource.versionId && currentSource.versionId !== attempt.source_version_id)
          ? 'changed'
          : currentSource.versionId ? 'current' : 'unknown';
      }
      return projectDistributionAttempt(attempt, { sourceFreshness, actorNames });
    }),
    // Wrap Up derivation input (S466): uncapped EXISTS scoped to the CURRENT
    // source document, so display-limit truncation cannot regress the stage
    // and a superseded document's sends cannot promote its reopen successor.
    currentSourceEverSent: currentSource?.documentId
      ? await dependencies.hasSentAttemptForSource(requestId, currentSource.documentId)
      : false,
  };
}

export const PRE_SITE_DISTRIBUTION_TEMPLATE_VERSION = TEMPLATE_VERSION;

export {
  BRIEFING_LINK_PLACEHOLDER,
  REVIEW_BUNDLE_LINK_PLACEHOLDER,
  distributionBodyHtml,
  normalizeDistributionRecipients,
  projectDistributionAttempt,
  retainReviewBundle,
  readDeliberationShareDefaults,
  renderBriefingBody,
  reviewBundleDocumentUrl,
  sessionLineText,
  sessionSnapshotOf,
  sessionSnapshotsMatch,
};
