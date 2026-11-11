import { getById, updateById } from '../../dataverse/adapters/grant-request';
import { linkedCycleCode, linkedCycleExpand } from '../../dataverse/adapters/operations-grant-cycle';
import { isJ27ScopeCycle } from './j27-read-model';
import { isAcceptedPresentationRow, presentationBinding, storedRosters } from './j27-later-facts';
import { findSummariesByRequests } from '../../dataverse/adapters/site-visit';
import { findByRequest } from '../../dataverse/adapters/request-document';
import { isGuid } from '../../utils/guid';
import { isMeetingTranscriptBundleSchemaReady } from '../../utils/meeting-transcript-bundle-readiness';
import { projectPostPresentationMaterials } from '../post-presentation-materials/material-model';
import { bindPresentationTranscript } from '../post-presentation-materials/presentation-transcript-binding';
import { validateMeetingTranscriptManifest } from '../meeting-tracker-transcription/bundle';
import { resolveSourceProvenance } from '../meeting-tracker-transcription/source-provenance';
import { getMeetingAttendance } from '../meeting-tracker-recordings/zoom-client';
import { ServiceHttpError } from '../service-http-error';

const sameId = (left, right) => String(left || '').toLowerCase() === String(right || '').toLowerCase();
const fail = (message, httpStatus) => new ServiceHttpError(message, { httpStatus });
const conflict = () => fail('The presentation or roster changed. Reload before confirming attendance.', 409);

export function rosterNames(value) {
  if (!Array.isArray(value) || value.length > 40) throw fail('Each list can contain up to 40 names.', 400);
  const seen = new Set();
  return value.map(name => {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 100 || /[@\u0000-\u001f\u007f]/.test(name)) {
      throw fail('Enter one display name per line, without email addresses.', 400);
    }
    return name.trim();
  }).filter(name => {
    const key = name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function attendanceSentence({ wmkf, consultants }) {
  const format = names => new Intl.ListFormat('en-US', { style: 'long', type: 'conjunction' }).format(names);
  const staff = wmkf.length ? `WMKF attendees included ${format(wmkf)}.` : '';
  const external = consultants.length ? `${format(consultants)} attended as ${consultants.length === 1 ? 'a consultant' : 'consultants'}.` : '';
  return [staff, external].filter(Boolean).join(' ');
}

async function currentPresentation(requestId, includeZoom = false) {
  const request = await getById(requestId, {
    select: 'akoya_requestid,wmkf_confirmedmeetingroster', expand: linkedCycleExpand(),
  });
  if (!request?.akoya_requestid || !isJ27ScopeCycle(linkedCycleCode(request))) throw fail('Request not found.', 404);
  const visits = await findSummariesByRequests([requestId]);
  if (visits.capped || visits.hasMore) throw fail('Presentation records could not be verified.', 503);
  // One rule with the J27 later-phase facts, so the phase and this panel agree.
  const rows = (visits.records || []).filter(row => sameId(row._regardingobjectid_value, requestId)
    && isAcceptedPresentationRow(row));
  if (!rows.length) return null;
  if (rows.length !== 1) throw fail('A single presentation is required to confirm the roster.', 409);
  const visit = rows[0];
  const visitId = visit.activityid;
  if (!isGuid(visitId)) throw fail('The presentation has no stable identity.', 503);

  let zoom = null;
  if (includeZoom && isMeetingTranscriptBundleSchemaReady()) {
    const documents = await findByRequest(requestId, { includeMeetingTranscriptBundle: true });
    if (documents.capped || documents.hasMore) throw fail('The presentation records could not be verified.', 503);
    const { transcript, boundary } = bindPresentationTranscript(
      projectPostPresentationMaterials(documents.records || [], requestId).winners, requestId,
    );
    if (transcript && boundary) {
      let manifest;
      try {
        manifest = validateMeetingTranscriptManifest(JSON.parse(transcript.wmkf_transcriptbundlejson), {
          requestId, siteVisitActivityId: visitId,
        });
      } catch { /* Manual confirmation remains available. */ }
      const source = resolveSourceProvenance(manifest?.sourceProvenance);
      if (source.status === 'verified_zoom') {
        const { zoom: recording, audioDurationMs } = source.provenance;
        const start = Date.parse(recording.audioFile.recordingStart);
        const duration = Date.parse(recording.audioFile.recordingEnd) - start;
        const endMs = boundary.presentationEnd.endMs;
        if (recording.audioOnlyFileCount === 1 && Math.abs(duration - audioDurationMs) <= 2000
            && endMs > 0 && endMs <= duration + 2000) {
          zoom = { uuid: recording.meetingUuid, start, end: start + endMs };
        }
      }
    }
  }
  const binding = presentationBinding(visit);
  return { request, visitId, binding, zoom };
}

export function presentationAttendeeNames(report, zoom) {
  if (report?.status !== 'complete' || !Array.isArray(report.participants) || report.participants.length > 300) return null;
  const names = report.participants.filter(row => {
    const joined = Date.parse(row.join_time);
    const left = Date.parse(row.leave_time);
    return row.status === 'in_meeting' && joined < zoom.end && left > zoom.start && joined < left
      && typeof row.name === 'string' && row.name.trim() && row.name.trim().length <= 100
      && !/[@\u0000-\u001f\u007f]/.test(row.name);
  }).map(row => row.name.trim());
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

export async function readMeetingRoster(requestId, { suggest = false } = {}) {
  const current = await currentPresentation(requestId, suggest);
  if (!current) return { presentation: null };
  const { request, visitId, binding, zoom } = current;
  let saved;
  let stale = false;
  let roster = null;
  try {
    saved = storedRosters(request.wmkf_confirmedmeetingroster)[visitId];
    stale = Boolean(saved && saved.binding !== binding);
    if (saved) roster = { wmkf: rosterNames(saved.wmkf), consultants: rosterNames(saved.consultants) };
  } catch { stale = true; }
  let suggestions = null;
  if (suggest && zoom) {
    const report = await getMeetingAttendance(zoom.uuid, { timeoutMs: 5000 }).catch(() => null);
    suggestions = presentationAttendeeNames(report, zoom);
  }
  return {
    presentation: { id: visitId, version: request._etag || null, binding },
    roster, stale, suggestions, canSuggest: isMeetingTranscriptBundleSchemaReady(),
    sentence: roster && !stale ? attendanceSentence(roster) : '',
  };
}

export async function saveMeetingRoster({ requestId, visitId, version, binding, wmkf, consultants, actor }) {
  const roster = { wmkf: rosterNames(wmkf), consultants: rosterNames(consultants) };
  const names = new Set(roster.wmkf.map(name => name.toLowerCase()));
  if (roster.consultants.some(name => names.has(name.toLowerCase()))) {
    throw fail('List each attendee in only one category.', 400);
  }
  const current = await currentPresentation(requestId);
  if (!current || !sameId(visitId, current.visitId) || version !== current.request._etag || binding !== current.binding) throw conflict();
  let records;
  try { records = storedRosters(current.request.wmkf_confirmedmeetingroster); }
  catch { throw fail('The existing roster needs repair before saving.', 409); }
  records[current.visitId] = {
    binding, ...roster, confirmedBy: actor, confirmedAt: new Date().toISOString(),
  };
  const serialized = JSON.stringify(records);
  if (serialized.length > 100000) throw fail('The roster history is full.', 409);
  try {
    await updateById(requestId, { wmkf_confirmedmeetingroster: serialized }, {
      ifMatch: version, actingUserSystemId: actor, noFallback: true,
    });
  } catch (error) {
    if (error?.status === 412) throw conflict();
    throw error;
  }
}
