import { reviewSetFingerprint } from '../review-bundle-service.js';
import { isGuid } from '../../../utils/guid.js';
import {
  PRE_RP_BRIEF_CONTRACT,
} from '../../../../shared/config/requestDocument.js';
import { DEFAULT_DEPENDENCIES } from './dependencies.js';
import { DOCX, PDF, TEMPLATE_VERSION, canonicalHash, distributionError, projectDistributionAttempt, sameId } from './model.js';
import {
  normalizeComposeInput, includeCalendarOrganizer, distributionBodyHtml,
} from './composition.js';
import {
  readDeliberationShareDefaults, readSessionSnapshot, resolveMaterialLinks,
  resolveCalendar, resolveSource, assertBriefInputsReady, resolveBriefingLink,
} from './context.js';
import {
  assertStableFrozenWord, captureCurrentSource, loadCapturedSource,
  ensureSnapshot, retainReviewBundle,
} from './retained-snapshot.js';

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
