import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as siteVisitAdapter from '../../dataverse/adapters/site-visit.js';
import * as contactAdapter from '../../dataverse/adapters/contact.js';
import * as appRequestPersonAdapter from '../../dataverse/adapters/app-request-person.js';
import { getSiteVisitRecipientDirectory } from '../site-visit/recipient-directory-service.js';
import { isGuid } from '../../utils/guid.js';
import { isVisibleRequestRow } from '../../../shared/config/workbenchVisibility.js';
import { ServiceHttpError } from '../service-http-error.js';

function fail(message, code, httpStatus = 409) {
  throw new ServiceHttpError(message, { httpStatus, code, body: { error: message, code } });
}
function sameId(a, b) { return String(a || '').toLowerCase() === String(b || '').toLowerCase(); }
function fullName(row) { return String(row?.fullname || [row?.firstname, row?.lastname].filter(Boolean).join(' ') || '').trim(); }
function parseSavedAttendees(raw) {
  if (!raw) return { organizer: null, refs: [], available: false };
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1 || !Array.isArray(parsed.requiredAttendees) || !Array.isArray(parsed.optionalAttendees)) {
      return { refs: [], available: false };
    }
    return { organizer: parsed.organizer || null,
      refs: [...parsed.requiredAttendees, ...parsed.optionalAttendees], available: true };
  } catch { return { refs: [], available: false }; }
}

export async function loadMeetingTranscriptionBinding(requestId, expectedVisitId = null, dependencies = {}) {
  if (!isGuid(requestId)) fail('A valid request id is required.', 'invalid_request_id', 400);
  const getRequest = dependencies.getRequest || ((id) => grantRequestAdapter.getById(id, {
    select: ['akoya_requestid','akoya_requeststatus','wmkf_triagestatus','wmkf_meetingdate',
      '_wmkf_projectleader_value','_wmkf_researchleader_value'],
  }));
  const findVisits = dependencies.findActiveByRequest || siteVisitAdapter.findActiveByRequest;
  let request;
  let visits;
  try { [request, visits] = await Promise.all([getRequest(requestId), findVisits(requestId)]); } catch {
    fail('The request and Site Visit could not be verified.', 'meeting_transcription_binding_unavailable', 503);
  }
  if (!request?.akoya_requestid || !sameId(request.akoya_requestid, requestId)) fail('Request not found.', 'meeting_transcription_request_not_found', 404);
  if (!request.wmkf_meetingdate || !isVisibleRequestRow(request, false)) {
    fail('Transcription is unavailable for this request.', 'meeting_transcription_request_ineligible', 404);
  }
  const rows = (visits?.records || []).filter(row => sameId(row?._regardingobjectid_value, requestId));
  if (rows.length !== 1) fail(rows.length ? 'Multiple active Site Visits require reconciliation.' : 'An active Site Visit is required.',
    rows.length ? 'meeting_transcription_site_visit_ambiguous' : 'meeting_transcription_site_visit_required');
  const visit = rows[0];
  if (!isGuid(visit.activityid)) fail('The active Site Visit has no stable identity.', 'meeting_transcription_site_visit_invalid', 503);
  if (expectedVisitId && !sameId(visit.activityid, expectedVisitId)) fail('The active Site Visit changed. Reload this request before continuing.', 'meeting_transcription_site_visit_changed', 409);
  return { request, siteVisit: visit, requestId: requestId.toLowerCase(), siteVisitActivityId: visit.activityid.toLowerCase() };
}

/** Optional name suggestions are grounded in local request/contact and saved-attendee records. */
export async function getMeetingTranscriptionCandidates(binding, dependencies = {}) {
  const sources = {
    pi: { status: 'unavailable', reason: 'lookup_failed' },
    coPIs: { status: 'unavailable', reason: 'lookup_failed' },
    savedAttendees: { status: 'unavailable', reason: 'lookup_failed' },
  };
  const candidates = [];
  const seen = new Set();
  const requestContactId = binding.request?._wmkf_projectleader_value || binding.request?._wmkf_researchleader_value;
  if (requestContactId) {
    try {
      const rows = await (dependencies.getContactsByIds || contactAdapter.getByIds)([requestContactId]);
      const row = (rows || []).find(item => sameId(item.contactid, requestContactId));
      const name = fullName(row);
      if (name && !name.includes('@')) {
        candidates.push({ id: `pi:${String(row.contactid).toLowerCase()}`, source: 'pi', displayName: name });
        seen.add(String(row.contactid).toLowerCase());
      }
      sources.pi = { status: name ? 'ready' : 'empty' };
    } catch { sources.pi = { status: 'unavailable', reason: 'lookup_failed' }; }
  } else sources.pi = { status: 'empty' };

  try {
    const result = await (dependencies.queryCoPIs || appRequestPersonAdapter.queryCoPIs)(binding.requestId);
    const rows = result?.records || [];
    const coPiCandidates = [];
    for (const row of rows) {
      const contactId = String(row?._wmkf_contact_value || '').toLowerCase();
      const contact = row?.wmkf_Contact || {};
      const name = fullName(contact);
      if (!contactId || !name || name.includes('@') || seen.has(contactId)) continue;
      seen.add(contactId);
      coPiCandidates.push({ id: `co_pi:${contactId}`, source: 'co_pi', displayName: name });
    }
    if (!result?.capped) candidates.push(...coPiCandidates);
    sources.coPIs = { status: result?.capped ? 'unavailable' : coPiCandidates.length ? 'ready' : 'empty', ...(result?.capped ? { reason: 'directory_capped' } : {}) };
  } catch { sources.coPIs = { status: 'unavailable', reason: 'lookup_failed' }; }

  const saved = parseSavedAttendees(binding.siteVisit.wmkf_attendeerefsjson);
  if (!saved.available) sources.savedAttendees = { status: 'unavailable', reason: binding.siteVisit.wmkf_attendeerefsjson ? 'saved_map_invalid' : 'no_saved_invitation' };
  else {
    try {
      const directory = await (dependencies.getRecipientDirectory || getSiteVisitRecipientDirectory)();
      const staff = new Map((directory.staff || []).map(row => [String(row.profileId), row.name]));
      const roster = new Map((directory.external || []).map(row => [String(row.rosterId), row.name]));
      const before = candidates.length;
      for (const ref of [saved.organizer, ...saved.refs].filter(Boolean)) {
        let id; let name; let source;
        if (ref?.kind === 'staff') { id = `staff:${Number(ref.profileId)}`; name = staff.get(String(Number(ref.profileId))); source = 'saved_staff'; }
        else if (ref?.kind === 'roster') { id = `roster:${Number(ref.rosterId)}`; name = roster.get(String(Number(ref.rosterId))); source = 'saved_attendee'; }
        else if (ref?.kind === 'manual' && typeof ref.name === 'string' && ref.name.trim() && !ref.name.includes('@')) {
          id = `manual:${binding.siteVisitActivityId}:${saved.refs.indexOf(ref)}`; name = ref.name.trim(); source = 'saved_attendee';
        }
        if (!id || !name || name.includes('@')) continue;
        candidates.push({ id: `attendee:${id}`, source, displayName: name.slice(0, 255) });
      }
      sources.savedAttendees = { status: candidates.length > before ? 'ready' : 'empty' };
    } catch { sources.savedAttendees = { status: 'unavailable', reason: 'directory_unavailable' }; }
  }
  return { candidates, candidateSources: sources };
}
