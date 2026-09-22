/** Pre-Site distribution source, input, calendar, and briefing context. */
import { buildSiteVisitIcs } from '../../../external/calendar-invite.js';
import {
  isPreSiteDistributionSnapshot,
  PRE_RP_BRIEF_CONTRACT,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../../../shared/config/requestDocument.js';
import { SITE_VISIT_ACTIVE_STATE_CODES, SITE_VISIT_PARTICIPATION_MASK } from '../../../../shared/config/siteVisit.js';
import {
  DELIBERATION_SHARE_BRIEFING_DESCRIPTION_KEY, DELIBERATION_SHARE_BRIEFING_EXPIRY_LEAD_IN_KEY,
  DELIBERATION_SHARE_BRIEFING_HEADING_KEY, DELIBERATION_SHARE_BRIEFING_LINK_TEXT_KEY,
  DELIBERATION_SHARE_REVIEW_BUNDLE_LINK_TEXT_KEY, DELIBERATION_SHARE_BODY_KEY,
  DELIBERATION_SHARE_SEED_BRIEFING_COPY, DELIBERATION_SHARE_SEED_BODY, DELIBERATION_SHARE_SEED_SUBJECT,
  DELIBERATION_SHARE_SUBJECT_KEY,
} from '../../../../shared/config/deliberationShareEmail.js';
import { MATERIAL_TYPES, distributionError, sameId } from './model.js';
import { DEFAULT_DEPENDENCIES } from './dependencies.js';
import * as siteVisitAdapter from '../../../dataverse/adapters/site-visit.js';
import { REQUEST_DOCUMENT_ARTIFACT_LABEL } from '../../../../shared/config/requestDocument.js';
import { resolveCurrentPreRpBriefForDistribution } from '../../pre-rp-brief/artifact-service.js';
import { compareReviewersByName } from '../../../../shared/utils/review-writeup-paragraphs.js';
import {
  briefInputFingerprint, canonicalBriefInputState, isSupportedBriefSnapshotVersion,
  reviewFingerprintFieldsFor, REQUEST_FINGERPRINT_FIELDS,
} from '../../pre-rp-brief/docx-renderer.js';
import { sha256, parseStoredObject, parseStoredArray, materialLinksMatch } from './model.js';
import { sessionSnapshotOf, sessionSnapshotsMatch } from './composition.js';
async function readDeliberationShareDefault(key, fallback, dependencies) {
  if (typeof dependencies.getSettingStrict !== 'function') {
    return { value: fallback, configured: false, unavailable: false };
  }
  try {
    const result = await dependencies.getSettingStrict(key);
    const stored = result?.found ? String(result.value ?? '') : '';
    return stored.trim()
      ? { value: stored, configured: true, unavailable: false }
      : { value: fallback, configured: false, unavailable: false };
  } catch (error) {
    console.error(`[pre-site distribution] email default read failed for ${key}:`, error?.message || error);
    return { value: fallback, configured: false, unavailable: true };
  }
}

async function readDeliberationShareDefaults(dependencies = DEFAULT_DEPENDENCIES) {
  const [
    subject,
    body,
    briefingHeading,
    briefingLinkText,
    briefingDescription,
    briefingExpiryLeadIn,
    reviewBundleLinkText,
  ] = await Promise.all([
    readDeliberationShareDefault(
      DELIBERATION_SHARE_SUBJECT_KEY,
      DELIBERATION_SHARE_SEED_SUBJECT,
      dependencies,
    ),
    readDeliberationShareDefault(
      DELIBERATION_SHARE_BODY_KEY,
      DELIBERATION_SHARE_SEED_BODY,
      dependencies,
    ),
    readDeliberationShareDefault(
      DELIBERATION_SHARE_BRIEFING_HEADING_KEY,
      DELIBERATION_SHARE_SEED_BRIEFING_COPY.heading,
      dependencies,
    ),
    readDeliberationShareDefault(
      DELIBERATION_SHARE_BRIEFING_LINK_TEXT_KEY,
      DELIBERATION_SHARE_SEED_BRIEFING_COPY.linkText,
      dependencies,
    ),
    readDeliberationShareDefault(
      DELIBERATION_SHARE_BRIEFING_DESCRIPTION_KEY,
      DELIBERATION_SHARE_SEED_BRIEFING_COPY.description,
      dependencies,
    ),
    readDeliberationShareDefault(
      DELIBERATION_SHARE_BRIEFING_EXPIRY_LEAD_IN_KEY,
      DELIBERATION_SHARE_SEED_BRIEFING_COPY.expiryLeadIn,
      dependencies,
    ),
    readDeliberationShareDefault(
      DELIBERATION_SHARE_REVIEW_BUNDLE_LINK_TEXT_KEY,
      DELIBERATION_SHARE_SEED_BRIEFING_COPY.reviewBundleLinkText,
      dependencies,
    ),
  ]);
  const settings = [
    subject,
    body,
    briefingHeading,
    briefingLinkText,
    briefingDescription,
    briefingExpiryLeadIn,
    reviewBundleLinkText,
  ];
  return {
    subjectTemplate: subject.value,
    bodyTemplate: body.value,
    briefingCopy: {
      heading: briefingHeading.value,
      linkText: briefingLinkText.value,
      description: briefingDescription.value,
      expiryLeadIn: briefingExpiryLeadIn.value,
      reviewBundleLinkText: reviewBundleLinkText.value,
    },
    configured: settings.every((setting) => setting.configured),
    unavailable: settings.some((setting) => setting.unavailable),
  };
}

async function readSessionSnapshot(requestId, dependencies) {
  if (typeof dependencies.getSession !== 'function') return null;
  try {
    return sessionSnapshotOf(await dependencies.getSession(requestId));
  } catch {
    return null;
  }
}

function eligibleMaterial(row, requestId) {
  let safeWebUrl = false;
  try {
    safeWebUrl = new URL(row?.wmkf_sharepointweburl).protocol === 'https:';
  } catch {}
  return sameId(row?._wmkf_request_value, requestId)
    && MATERIAL_TYPES.has(row.wmkf_artifacttype)
    && row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
    && row.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED
    && safeWebUrl
    && !isPreSiteDistributionSnapshot(row);
}

async function resolveMaterialLinks(requestId, selectedIds, dependencies) {
  if (!selectedIds.length) return [];
  const result = await dependencies.findDocumentsByRequest(requestId);
  const rows = (result?.records || []).filter((row) => eligibleMaterial(row, requestId));
  const byId = new Map(rows.map((row) => [String(row.wmkf_requestdocumentid).toLowerCase(), row]));
  return selectedIds.map((id) => {
    const row = byId.get(id);
    if (!row) {
      throw distributionError(
        'A selected material is no longer an eligible Ready request document.',
        'distribution_material_stale',
      );
    }
    return {
      artifactId: row.wmkf_requestdocumentid,
      artifactType: row.wmkf_artifacttype,
      artifactTypeLabel: REQUEST_DOCUMENT_ARTIFACT_LABEL[row.wmkf_artifacttype] || 'Material',
      filename: row.wmkf_filename || row.wmkf_name || 'Material',
      webUrl: row.wmkf_sharepointweburl,
      driveId: row.wmkf_sharepointdriveid || null,
      itemId: row.wmkf_sharepointitemid || null,
      versionId: row.wmkf_sharepointversionid || null,
    };
  });
}

function calendarSnapshot(row, requestId) {
  if (!row || !sameId(row._regardingobjectid_value, requestId)
    || !SITE_VISIT_ACTIVE_STATE_CODES.includes(Number(row.statecode))
    || !row._etag || !row.activityid || !row.scheduledstart || !row.scheduledend) {
    throw distributionError(
      'The saved Site Visit activity is no longer eligible for a calendar attachment.',
      'distribution_site_visit_stale',
    );
  }
  const parties = Array.isArray(row[siteVisitAdapter.PARTY_NAVIGATION_PROPERTY])
    ? row[siteVisitAdapter.PARTY_NAVIGATION_PROPERTY]
    : [];
  const organizers = parties.filter((party) => (
    Number(party.participationtypemask) === SITE_VISIT_PARTICIPATION_MASK.ORGANIZER
  ));
  const organizerEmail = String(organizers[0]?.addressused || '').trim().toLowerCase();
  if (organizers.length !== 1 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(organizerEmail)) {
    throw distributionError(
      'The saved Site Visit must have exactly one staff organizer with an email address.',
      'distribution_site_visit_organizer_invalid',
    );
  }
  let attendeeRefs;
  try {
    attendeeRefs = JSON.parse(row.wmkf_attendeerefsjson || '');
  } catch {
    attendeeRefs = null;
  }
  if (attendeeRefs?.version !== 1) {
    throw distributionError(
      'The saved Site Visit attendee identity map requires reconciliation.',
      'distribution_site_visit_attendee_map_invalid',
    );
  }
  const modifiedAt = row.modifiedon || row.createdon;
  if (!Number.isFinite(Date.parse(modifiedAt || ''))) {
    throw distributionError('The Site Visit has no stable calendar timestamp.', 'distribution_site_visit_stale');
  }
  return {
    version: 1,
    activityId: row.activityid,
    etag: row._etag,
    subject: row.subject || 'Site Visit',
    description: row.description || '',
    startIso: row.scheduledstart,
    endIso: row.scheduledend,
    timeZone: row.wmkf_ianatimezone || null,
    format: row.wmkf_visitformat ?? null,
    location: row.wmkf_locationorlink || '',
    organizerEmail,
    attendeeRefs,
    modifiedAt,
  };
}

function buildCalendar(snapshot) {
  const built = buildSiteVisitIcs({
    activityId: snapshot.activityId,
    startIso: snapshot.startIso,
    endIso: snapshot.endIso,
    subject: snapshot.subject,
    description: snapshot.description,
    location: snapshot.location,
    organizerEmail: snapshot.organizerEmail,
    nowIso: snapshot.modifiedAt,
  });
  return {
    filename: built.filename,
    contentType: built.contentType,
    content: built.content,
    byteHash: sha256(built.content),
    size: built.content.length,
  };
}

async function resolveCalendar(requestId, compose, dependencies) {
  if (!compose.includeCalendar) return null;
  if (!dependencies.schemaReady()) {
    throw distributionError(
      'Site Visit calendar attachments are not enabled for this environment.',
      'distribution_calendar_schema_not_ready',
      503,
    );
  }
  const row = await dependencies.getSiteVisitById(compose.siteVisitId);
  const snapshot = calendarSnapshot(row, requestId);
  return { snapshot, attachment: buildCalendar(snapshot) };
}

async function resolveSource(requestId, expectedArtifactId, dependencies) {
  // Adapt this file's dependency names to the shape
  // resolveCurrentPreRpBriefForDistribution's own dependency-injection
  // contract expects (lib/services/pre-rp-brief/artifact-service.js). Fall
  // back to the real function when a caller's dependencies object doesn't
  // inject `resolveCurrentBrief` (e.g. an existing test fixture built before
  // this seam existed) so its own getRequest/findDocumentsByRequest mocks
  // still drive real resolution logic.
  const resolveCurrentBrief = dependencies.resolveCurrentBrief || resolveCurrentPreRpBriefForDistribution;
  const { request, row } = await resolveCurrentBrief(
    requestId,
    expectedArtifactId,
    { getRequest: dependencies.getRequest, findByRequest: dependencies.findDocumentsByRequest },
  );
  return { request, row };
}

function receivedBoolean(review) {
  return Boolean(review?.reviewReceivedAt);
}

/**
 * Bounded audit delta between the generated and live snapshots: changed
 * request-field names, an `abstractChanged` boolean, and added/removed/
 * changed reviewer suggestion ids plus counts. Both sides use the exact
 * canonical representation hashed by `briefInputFingerprint`, both reduced
 * to the STORED snapshot's schemaVersion field list, so a legacy (v1)
 * generated snapshot is compared to the live snapshot on the same 8 fields
 * it was ever fingerprinted with; no prose, reviewer names, or abstract
 * text enter the delta.
 */
function computeStaleInputsDelta(generatedEnvelope, liveEnvelope, schemaVersion) {
  const generatedCanonical = canonicalBriefInputState(generatedEnvelope, { schemaVersion });
  const liveCanonical = canonicalBriefInputState(liveEnvelope, { schemaVersion });
  const reviewFields = reviewFingerprintFieldsFor(schemaVersion);
  const changedRequestFields = REQUEST_FINGERPRINT_FIELDS.filter((field) => (
    generatedCanonical.request[field] !== liveCanonical.request[field]
  ));
  const byId = (list) => new Map((list || []).map((review) => [review.suggestionId, review]));
  const generatedById = byId(generatedCanonical.reviews);
  const liveById = byId(liveCanonical.reviews);
  const addedReviewerSuggestionIds = [...liveById.keys()].filter((id) => !generatedById.has(id));
  const removedReviewerSuggestionIds = [...generatedById.keys()].filter((id) => !liveById.has(id));
  const changedReviewerSuggestionIds = [...liveById.keys()].filter((id) => {
    if (!generatedById.has(id)) return false;
    const generatedReview = generatedById.get(id);
    const liveReview = liveById.get(id);
    return reviewFields.some((field) => (
      generatedReview[field] !== liveReview[field]
    ));
  });
  return {
    changedRequestFields,
    abstractChanged: changedRequestFields.includes('abstract'),
    addedReviewerSuggestionIds,
    removedReviewerSuggestionIds,
    changedReviewerSuggestionIds,
    generatedReviewCount: generatedById.size,
    liveReviewCount: liveById.size,
  };
}

/**
 * Prepare-time review/drift gate. It validates the stored snapshot and its
 * received-review requirement, compares the live fingerprint, and accepts
 * only an exact live-fingerprint acknowledgement before any write begins.
 */
async function assertBriefInputsReady({ sourceRow, requestId, acknowledgeStaleInputs }, dependencies) {
  const storedSnapshot = parseStoredObject(sourceRow.wmkf_presiteinputsnapshotjson);
  let generatedFingerprint;
  try {
    if (!storedSnapshot
      || !isSupportedBriefSnapshotVersion(storedSnapshot.schemaVersion)
      || storedSnapshot.artifactType !== PRE_RP_BRIEF_CONTRACT.snapshotArtifactType) {
      throw new Error('malformed');
    }
    generatedFingerprint = briefInputFingerprint(storedSnapshot);
  } catch {
    throw distributionError(
      "The brief's stored input snapshot is invalid.",
      'brief_snapshot_invalid',
    );
  }
  if (generatedFingerprint !== sourceRow.wmkf_inputfingerprint) {
    throw distributionError(
      "The brief's stored input snapshot does not match its recorded fingerprint.",
      'brief_snapshot_invalid',
    );
  }

  const receivedReviews = (storedSnapshot.reviews || []).filter((review) => receivedBoolean(review));
  if (receivedReviews.length === 0) {
    throw distributionError(
      'The brief has no received reviews yet. Share is blocked until at least one review is received.',
      'brief_reviews_required',
    );
  }

  const liveInputs = await dependencies.loadPreRpBriefInputs({ requestId });
  // Compare the live envelope under the STORED row's schemaVersion: a
  // legacy (v1) brief only ever fingerprinted the 8-field legacy list, so
  // it must only be judged stale by drift in those fields, not by the
  // current (v2) list gaining lastName/keywords/areaOfExpertise. This is
  // also the value later echoed back as `acknowledgeStaleInputs` (see the
  // 409 body below and PreSiteDistributionPanel.js), so the handshake
  // stays self-consistent across the reject-then-retry round trip.
  const liveFingerprint = briefInputFingerprint(liveInputs.envelope, {
    schemaVersion: storedSnapshot.schemaVersion,
  });
  // Plan §11 (Step C1): the raw (non-canonicalized) received, name-sorted
  // live reviews, for the review bundle. `canonicalBriefInputState`'s
  // reviews are reduced to the schema version's review field list (which
  // excludes `reviewSharePointFolder`/`reviewFilename` on purpose — adding
  // a field there is now a schemaVersion bump, see docx-renderer.js), so
  // the bundle reads the live envelope's reviews directly instead.
  const liveReviews = (liveInputs.envelope.reviews || [])
    .filter((review) => receivedBoolean(review))
    .sort(compareReviewersByName);
  const institutionName = liveInputs.envelope.request?.institutionName || null;
  if (liveFingerprint === generatedFingerprint) {
    return {
      generatedFingerprint, liveFingerprint, delta: null, acknowledgedFingerprint: null, liveReviews, institutionName,
    };
  }

  const delta = computeStaleInputsDelta(storedSnapshot, liveInputs.envelope, storedSnapshot.schemaVersion);
  if (acknowledgeStaleInputs !== liveFingerprint) {
    throw distributionError(
      "The request's inputs changed since the brief was generated. Review the changes before sharing.",
      'brief_inputs_stale',
      409,
      { generatedFingerprint, liveFingerprint, delta },
    );
  }
  return {
    generatedFingerprint,
    liveFingerprint,
    delta,
    acknowledgedFingerprint: acknowledgeStaleInputs,
    liveReviews,
    institutionName,
  };
}

async function resolveBriefingLink(input, dependencies) {
  if (typeof dependencies.briefingReady !== 'function' || !dependencies.briefingReady()
    || typeof dependencies.ensureBriefingLink !== 'function') {
    throw distributionError(
      'The deliberation email carries the briefing page link instead of attachments, and the briefing page is not enabled in this environment.',
      'distribution_briefing_required',
      503,
    );
  }
  const { link } = await dependencies.ensureBriefingLink(input.requestId, input.actingUserSystemId);
  if (!link?.id || !link?.url) {
    throw distributionError('The briefing link could not be created.', 'distribution_briefing_unavailable', 502);
  }
  return { id: link.id, url: link.url, expiresAt: link.expiresAt };
}

async function resolveBoundBriefingUrl(attempt, dependencies) {
  if (!attempt.briefing_link_id) {
    // A preview prepared without a link (before the flag, or before the link
    // became mandatory on 2026-09-10) cannot be sent now; only an attempt whose
    // send intent is already durable passes, and that retry only reconciles
    // Dynamics status for an email that may have gone out.
    if (!attempt.send_requested_at) {
      throw distributionError(
        'This preview was prepared without a briefing page link. Prepare a new exact preview so the email carries the link.',
        'distribution_briefing_stale',
      );
    }
    return null;
  }
  const live = typeof dependencies.getLiveBriefingLink === 'function'
    ? await dependencies.getLiveBriefingLink(attempt.request_id)
    : null;
  if (!live?.url || !sameId(live.id, attempt.briefing_link_id)) {
    throw distributionError(
      'The briefing link in this preview was replaced or expired. Prepare a new exact preview.',
      'distribution_briefing_stale',
    );
  }
  return live.url;
}

async function assertAttemptSourceCurrent(attempt, dependencies) {
  const { row } = await resolveSource(
    attempt.request_id,
    attempt.source_document_id,
    dependencies,
  );
  const metadata = await dependencies.getFileMetadataById(
    row.wmkf_sharepointdriveid,
    row.wmkf_sharepointitemid,
    { siteId: row.wmkf_sharepointsiteid || null },
  );
  if (!metadata
    || !sameId(metadata.driveId, attempt.source_drive_id)
    || !sameId(metadata.id, attempt.source_item_id)
    || !attempt.source_version_id
    || metadata.versionId !== attempt.source_version_id) {
    throw distributionError(
      'The prepared distribution source is no longer current. Prepare a new exact preview.',
      'distribution_stale_source',
    );
  }
}

async function assertAttemptExtensionsCurrent(attempt, dependencies) {
  // The email states the deliberation session; if the slot moved, appeared,
  // or was removed since preview, the preview is dead, like a moved visit.
  if ('session_snapshot' in attempt) {
    const live = await readSessionSnapshot(attempt.request_id, dependencies);
    if (!sessionSnapshotsMatch(parseStoredObject(attempt.session_snapshot), live)) {
      throw distributionError(
        'The deliberation session changed after preview. Prepare a new exact preview.',
        'distribution_session_stale',
      );
    }
  }
  const storedLinks = parseStoredArray(attempt.material_links);
  if (storedLinks.length) {
    const current = await resolveMaterialLinks(
      attempt.request_id,
      storedLinks.map((row) => row.artifactId),
      dependencies,
    );
    if (!materialLinksMatch(current, storedLinks)) {
      throw distributionError(
        'A linked Site Visit material changed after preview. Prepare a new exact preview.',
        'distribution_material_stale',
      );
    }
  }
  if (attempt.calendar_enabled) {
    if (!dependencies.schemaReady()) {
      throw distributionError('Site Visit calendar attachments are not enabled.', 'distribution_calendar_schema_not_ready', 503);
    }
    const row = await dependencies.getSiteVisitById(attempt.site_visit_id);
    const current = calendarSnapshot(row, attempt.request_id);
    if (current.etag !== attempt.site_visit_etag) {
      throw distributionError(
        'The Site Visit schedule changed after preview. Prepare a new exact preview.',
        'distribution_site_visit_stale',
      );
    }
  }
}
export {
  readDeliberationShareDefault, readDeliberationShareDefaults, readSessionSnapshot,
  eligibleMaterial, resolveMaterialLinks, calendarSnapshot, buildCalendar, resolveCalendar,
  resolveSource, receivedBoolean, computeStaleInputsDelta, assertBriefInputsReady,
  resolveBriefingLink, resolveBoundBriefingUrl, assertAttemptSourceCurrent,
  assertAttemptExtensionsCurrent,
};
