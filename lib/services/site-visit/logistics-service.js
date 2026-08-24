/**
 * Site Visit logistics coordinator.
 *
 * Dataverse owns the activity and ActivityParty rows. The custom JSON field
 * stores only the versioned stable reference map needed to round-trip staff
 * profile IDs, expertise_roster IDs, and manual recipients. Writes are stage-
 * gated and request-bound. Ordinary field edits use an ETag-fenced PATCH;
 * attendee-role edits use a sandbox-proved atomic same-ID replacement because
 * Dataverse rejects direct ActivityParty creates. Duplicate active activities
 * fail closed.
 */

import * as siteVisitAdapter from '../../dataverse/adapters/site-visit.js';
import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import { ServiceHttpError } from '../service-http-error.js';
import { getPreSiteVisitArtifactStatus } from '../pre-site-visit/artifact-service.js';
import {
  getSiteVisitRecipientDirectory,
  normalizeSiteVisitEmail,
  resolveSiteVisitRecipientRefs,
} from './recipient-directory-service.js';
import { isSiteVisitLogisticsSchemaReady } from '../../utils/site-visit-logistics-readiness.js';
import { formatZonedLocalInput, validateZonedRange } from '../../utils/zoned-date-time.js';
import { isGuid } from '../../utils/guid.js';
import {
  isPreSiteDistributionSnapshot,
  REQUEST_DOCUMENT_ARTIFACT_LABEL,
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../../shared/config/requestDocument.js';
import {
  isSiteVisitFormat,
  SITE_VISIT_LIMITS,
  SITE_VISIT_PARTICIPATION_MASK,
} from '../../../shared/config/siteVisit.js';

const REQUEST_BIND = 'regardingobjectid_akoya_request_wmkf_sitevisit@odata.bind';
const MATERIAL_TYPES = new Set([
  REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT,
  REQUEST_DOCUMENT_ARTIFACT_TYPE.APPLICANT_SLIDES,
  REQUEST_DOCUMENT_ARTIFACT_TYPE.OTHER_APPLICANT_MATERIALS,
  REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING,
  REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT,
  REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT_SUMMARY,
]);

const DEFAULT_DEPENDENCIES = Object.freeze({
  getArtifactStatus: getPreSiteVisitArtifactStatus,
  findDocumentsByRequest: requestDocumentAdapter.findByRequest,
  findActiveByRequest: siteVisitAdapter.findActiveByRequest,
  getSiteVisitById: siteVisitAdapter.getById,
  createSiteVisit: siteVisitAdapter.create,
  updateSiteVisit: siteVisitAdapter.update,
  replaceSiteVisitWithParties: siteVisitAdapter.replaceWithParties,
  getRecipientDirectory: getSiteVisitRecipientDirectory,
  resolveRecipientRefs: resolveSiteVisitRecipientRefs,
  schemaReady: isSiteVisitLogisticsSchemaReady,
});

function logisticsError(message, code, httpStatus = 409, extras = {}) {
  return new ServiceHttpError(message, {
    httpStatus,
    code,
    body: { error: message, code, ...extras },
  });
}

function sameId(left, right) {
  return String(left || '').toLowerCase() === String(right || '').toLowerCase();
}

function assertSchemaReady(dependencies) {
  if (!dependencies.schemaReady()) {
    throw logisticsError(
      'Site Visit logistics is not enabled for this environment.',
      'site_visit_logistics_schema_not_ready',
      503,
    );
  }
}

async function assertActiveStage(requestId, dependencies) {
  const status = await dependencies.getArtifactStatus({ requestId });
  if (status?.currentArtifact?.lifecycleState !== REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW) {
    throw logisticsError(
      'The Site Visit stage must be active before logistics can be edited.',
      'site_visit_stage_not_active',
    );
  }
  return status;
}

function normalizeRef(ref, { staffOnly = false } = {}) {
  if (ref?.kind === 'staff') {
    const profileId = Number(ref.profileId);
    if (Number.isSafeInteger(profileId) && profileId > 0) return { kind: 'staff', profileId };
  }
  if (!staffOnly && ref?.kind === 'roster') {
    const rosterId = Number(ref.rosterId);
    if (Number.isSafeInteger(rosterId) && rosterId > 0) return { kind: 'roster', rosterId };
  }
  if (!staffOnly && ref?.kind === 'manual') {
    const email = normalizeSiteVisitEmail(ref.email);
    const name = String(ref.name || '').trim().slice(0, 255);
    if (email) return { kind: 'manual', name: name || email, email };
  }
  throw logisticsError(
    staffOnly ? 'The organizer must be selected from WMKF staff.' : 'An attendee reference is invalid.',
    staffOnly ? 'site_visit_organizer_invalid' : 'site_visit_attendee_invalid',
    400,
  );
}

function normalizeRefs(input) {
  const requiredInput = input.requiredAttendees ?? [];
  const optionalInput = input.optionalAttendees ?? [];
  if (!Array.isArray(requiredInput) || !Array.isArray(optionalInput)
    || requiredInput.length > SITE_VISIT_LIMITS.attendeesPerRole
    || optionalInput.length > SITE_VISIT_LIMITS.attendeesPerRole) {
    throw logisticsError(
      `Required and optional attendees must each contain at most ${SITE_VISIT_LIMITS.attendeesPerRole} entries.`,
      'site_visit_attendee_count_invalid',
      400,
    );
  }
  return {
    version: 1,
    organizer: normalizeRef(input.organizer, { staffOnly: true }),
    requiredAttendees: requiredInput.map((ref) => normalizeRef(ref)),
    optionalAttendees: optionalInput.map((ref) => normalizeRef(ref)),
  };
}

function normalizeText(value, { field, max, required = false }) {
  const text = String(value || '').trim();
  if ((required && !text) || text.length > max) {
    throw logisticsError(
      `${field} ${required ? 'is required and ' : ''}must be at most ${max} characters.`,
      'site_visit_text_invalid',
      400,
      { field },
    );
  }
  return text;
}

async function normalizeSaveInput(input, dependencies) {
  const subject = normalizeText(input.subject, {
    field: 'subject', max: SITE_VISIT_LIMITS.subject, required: true,
  });
  const description = normalizeText(input.description, {
    field: 'description', max: SITE_VISIT_LIMITS.description,
  });
  const timeZone = normalizeText(input.timeZone, {
    field: 'timeZone', max: SITE_VISIT_LIMITS.timeZone, required: true,
  });
  const locationOrLink = normalizeText(input.locationOrLink, {
    field: 'locationOrLink', max: SITE_VISIT_LIMITS.locationOrLink, required: true,
  });
  const format = Number(input.format);
  if (!isSiteVisitFormat(format)) {
    throw logisticsError('Choose a valid Site Visit format.', 'site_visit_format_invalid', 400);
  }
  let range;
  try {
    range = validateZonedRange({
      startLocal: input.startLocal,
      endLocal: input.endLocal,
      timeZone,
      disambiguation: input.disambiguation || 'reject',
    });
  } catch (error) {
    throw logisticsError(error.message, error.code || 'site_visit_time_invalid', 422, error.details);
  }
  const refs = normalizeRefs(input);
  const directory = await dependencies.getRecipientDirectory();
  const [organizers, required, optional] = await Promise.all([
    dependencies.resolveRecipientRefs([refs.organizer], {
      staffOnly: true, allowManual: false, directory,
    }),
    dependencies.resolveRecipientRefs(refs.requiredAttendees, { directory }),
    dependencies.resolveRecipientRefs(refs.optionalAttendees, { directory }),
  ]);
  const all = [...organizers, ...required, ...optional];
  const duplicate = all.find((row, index) => (
    all.findIndex((candidate) => candidate.email === row.email) !== index
  ));
  if (duplicate) {
    throw logisticsError(
      `${duplicate.email} appears in more than one Site Visit role.`,
      'site_visit_attendee_duplicate',
      400,
    );
  }
  const refsJson = JSON.stringify(refs);
  if (refsJson.length > SITE_VISIT_LIMITS.attendeeRefsJson) {
    throw logisticsError('The attendee identity map is too large.', 'site_visit_attendee_map_too_large', 400);
  }
  return {
    subject,
    description,
    timeZone,
    locationOrLink,
    format,
    range,
    refs,
    refsJson,
    organizers,
    required,
    optional,
  };
}

function party(row, participationtypemask) {
  return {
    participationtypemask,
    addressused: row.email,
    unresolvedpartyname: row.name,
    ...(row.systemUserId ? { systemUserId: row.systemUserId } : {}),
  };
}

function buildParties(normalized) {
  return [
    ...normalized.organizers.map((row) => party(row, SITE_VISIT_PARTICIPATION_MASK.ORGANIZER)),
    ...normalized.required.map((row) => party(row, SITE_VISIT_PARTICIPATION_MASK.REQUIRED)),
    ...normalized.optional.map((row) => party(row, SITE_VISIT_PARTICIPATION_MASK.OPTIONAL)),
  ];
}

function payload(normalized) {
  return {
    subject: normalized.subject,
    description: normalized.description || null,
    scheduledstart: normalized.range.startIso,
    scheduledend: normalized.range.endIso,
    wmkf_visitformat: normalized.format,
    wmkf_ianatimezone: normalized.timeZone,
    wmkf_locationorlink: normalized.locationOrLink,
    wmkf_attendeerefsjson: normalized.refsJson,
  };
}

function parseRefs(row) {
  try {
    const parsed = JSON.parse(row?.wmkf_attendeerefsjson || '');
    if (parsed?.version !== 1) throw new Error('unsupported version');
    return normalizeRefs(parsed);
  } catch (error) {
    if (error instanceof ServiceHttpError) throw error;
    throw logisticsError(
      'The Site Visit attendee identity map requires reconciliation.',
      'site_visit_attendee_map_invalid',
    );
  }
}

function projectSiteVisit(row) {
  if (!row) return null;
  if (!row._etag) {
    throw logisticsError('The Site Visit activity is missing its write fence.', 'site_visit_etag_missing', 500);
  }
  const refs = parseRefs(row);
  const timeZone = String(row.wmkf_ianatimezone || '');
  return {
    activityId: row.activityid,
    etag: row._etag,
    subject: row.subject || '',
    description: row.description || '',
    startIso: row.scheduledstart || null,
    endIso: row.scheduledend || null,
    startLocal: formatZonedLocalInput(row.scheduledstart, timeZone),
    endLocal: formatZonedLocalInput(row.scheduledend, timeZone),
    timeZone,
    format: row.wmkf_visitformat,
    locationOrLink: row.wmkf_locationorlink || '',
    organizer: refs.organizer,
    requiredAttendees: refs.requiredAttendees,
    optionalAttendees: refs.optionalAttendees,
    modifiedAt: row.modifiedon || null,
  };
}

async function findOneActive(requestId, dependencies) {
  const result = await dependencies.findActiveByRequest(requestId);
  const rows = (result?.records || []).filter((row) => sameId(row._regardingobjectid_value, requestId));
  if (rows.length > 1) {
    throw logisticsError(
      'Multiple active Site Visit activities require reconciliation.',
      'site_visit_duplicate_active',
    );
  }
  return rows[0] || null;
}

function projectMaterials(rows, requestId, currentArtifactId) {
  return (rows || [])
    .filter((row) => (
      sameId(row._wmkf_request_value, requestId)
      && MATERIAL_TYPES.has(row.wmkf_artifacttype)
      && row.wmkf_operationstatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY
      && row.wmkf_lifecyclestate !== REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED
      && row.wmkf_sharepointweburl
      && (!isPreSiteDistributionSnapshot(row) || sameId(row.wmkf_requestdocumentid, currentArtifactId))
    ))
    .map((row) => ({
      artifactId: row.wmkf_requestdocumentid,
      artifactType: row.wmkf_artifacttype,
      artifactTypeLabel: REQUEST_DOCUMENT_ARTIFACT_LABEL[row.wmkf_artifacttype] || 'Material',
      filename: row.wmkf_filename || row.wmkf_name || 'Material',
      webUrl: row.wmkf_sharepointweburl,
      driveId: row.wmkf_sharepointdriveid || null,
      itemId: row.wmkf_sharepointitemid || null,
      versionId: row.wmkf_sharepointversionid || null,
    }));
}

export async function getSiteVisitLogistics({ requestId }, dependencies = DEFAULT_DEPENDENCIES) {
  if (!isGuid(requestId)) {
    throw logisticsError('A valid requestId is required.', 'invalid_request_id', 400);
  }
  assertSchemaReady(dependencies);
  const status = await assertActiveStage(requestId, dependencies);
  const [row, documents] = await Promise.all([
    findOneActive(requestId, dependencies),
    dependencies.findDocumentsByRequest(requestId),
  ]);
  return {
    siteVisit: projectSiteVisit(row),
    materials: projectMaterials(documents?.records, requestId, status.currentArtifact?.artifactId),
  };
}

export async function saveSiteVisitLogistics(
  input,
  { actingUserSystemId = null } = {},
  dependencies = DEFAULT_DEPENDENCIES,
) {
  const requestId = String(input?.requestId || '').trim();
  if (!isGuid(requestId)) {
    throw logisticsError('A valid requestId is required.', 'invalid_request_id', 400);
  }
  if (!isGuid(actingUserSystemId || '')) {
    throw logisticsError(
      'A mapped Dataverse staff identity is required to save Site Visit logistics.',
      'site_visit_actor_required',
      403,
    );
  }
  assertSchemaReady(dependencies);
  await assertActiveStage(requestId, dependencies);
  const normalized = await normalizeSaveInput(input, dependencies);
  const existing = await findOneActive(requestId, dependencies);
  const activityId = String(input.activityId || '').trim();
  const etag = String(input.etag || '').trim();
  let savedId;
  if (existing) {
    if (!isGuid(activityId) || !sameId(activityId, existing.activityid) || !etag || etag !== existing._etag) {
      throw logisticsError(
        'The Site Visit changed or a different activity is active. Reload before saving.',
        'site_visit_write_conflict',
      );
    }
    try {
      const nextPayload = payload(normalized);
      if (existing.wmkf_attendeerefsjson === normalized.refsJson) {
        await dependencies.updateSiteVisit(
          existing.activityid,
          existing._etag,
          nextPayload,
          { actingUserSystemId },
        );
      } else {
        await dependencies.replaceSiteVisitWithParties({
          activityId: existing.activityid,
          etag: existing._etag,
          payload: {
            ...nextPayload,
            [REQUEST_BIND]: `/akoya_requests(${requestId})`,
          },
          parties: buildParties(normalized),
          actingUserSystemId,
        });
      }
    } catch (error) {
      if (error?.status === 412) {
        throw logisticsError('The Site Visit changed while it was being saved.', 'site_visit_write_conflict');
      }
      throw error;
    }
    savedId = existing.activityid;
  } else {
    if (activityId || etag) {
      throw logisticsError('The referenced Site Visit activity is no longer active.', 'site_visit_write_conflict');
    }
    const created = await dependencies.createSiteVisit({
      ...payload(normalized),
      [REQUEST_BIND]: `/akoya_requests(${requestId})`,
    }, buildParties(normalized), { actingUserSystemId });
    savedId = created?.activityid;
    if (!isGuid(savedId || '')) {
      throw logisticsError('Dataverse did not return the created Site Visit identity.', 'site_visit_create_unconfirmed', 502);
    }
  }
  const saved = await dependencies.getSiteVisitById(savedId);
  if (!saved || !sameId(saved._regardingobjectid_value, requestId)) {
    throw logisticsError('The saved Site Visit could not be verified.', 'site_visit_save_unconfirmed', 502);
  }
  return { siteVisit: projectSiteVisit(saved) };
}

export const SITE_VISIT_LOGISTICS_DEPENDENCIES = DEFAULT_DEPENDENCIES;
