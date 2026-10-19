/**
 * Read-only staff program briefing. Uses canonical SE/MR request membership and the Workbench
 * visibility predicate (ordinary, advancing/Phase II Pending, not set aside). No generation or writes.
 * Published summaries are read through the existing integrity-checked staff reader; stale text is
 * withheld. Discussion signals use only the accepted/current sentiment consumer contract.
 * Per-source failures remain explicit on the proposal; incomplete membership fails the whole read.
 */
import * as grantRequests from '../../dataverse/adapters/grant-request.js';
import * as requestDocuments from '../../dataverse/adapters/request-document.js';
import { RESEARCH_PROGRAM_IDS } from '../../../shared/config/researchPrograms.js';
import { buildVisibilityFilter } from '../../../shared/config/workbenchVisibility.js';
import { REQUEST_DOCUMENT_ARTIFACT_TYPE as TYPE } from '../../../shared/config/requestDocument.js';
import { requestInstitution } from '../../../shared/utils/institution.js';
import { cycleCodeToOdataFilter, cycleCodeToLabel, meetingDateToCycleCode, parseCycleCode, resolveWorkingCycle } from '../../utils/cycle-code.js';
import { withOrdinaryTestRequestODataFilter, withTestRequestIsolationSelect, testRequestCountsAsOrdinary } from '../test-requests/isolation.js';
import { ServiceHttpError } from '../service-http-error.js';
import { isGuid } from '../../utils/guid.js';
import { isMeetingTrackerSchemaReady } from '../../../shared/config/meetingTracker.js';
import { readStaffPresentationText } from '../post-presentation-materials/staff-text-service.js';
import { projectPostPresentationMaterials } from '../post-presentation-materials/material-model.js';
import { getDeliberationSentiments, DELIBERATION_SENTIMENT_MAX_REQUESTS } from '../post-presentation-materials/discussion-sentiment-reader.js';

const PROGRAMS = [
  { key: 'se', id: RESEARCH_PROGRAM_IDS[0], name: 'Science and Engineering' },
  { key: 'mr', id: RESEARCH_PROGRAM_IDS[1], name: 'Medical Research' },
];
const SELECT = 'akoya_requestid,akoya_requestnum,akoya_title,wmkf_meetingdate,_akoya_programid_value,_akoya_applicantid_value,_wmkf_projectleader_value,akoya_requeststatus,wmkf_triagestatus';
export const BRIEFING_MAX_PROPOSALS = 100;
const SUMMARY_CHARS = 800;
const TYPES = [TYPE.TRANSCRIPT, TYPE.TRANSCRIPT_SUMMARY, TYPE.STAFF_DISCUSSION_SUMMARY];
const DEFAULTS = {
  schemaReady: isMeetingTrackerSchemaReady,
  queryRequests: (options) => grantRequests.queryAllRequests(options),
  findDocuments: async (ids) => {
    const pages = await Promise.all(TYPES.map((artifactType) => requestDocuments.findByRequests(ids, { artifactType, includeMeetingTranscriptBundle: true })));
    return { records: pages.flatMap((page) => page.records || []), capped: pages.some((page) => page.capped || page.hasMore) };
  },
  readText: readStaffPresentationText,
  readSentiments: getDeliberationSentiments,
  now: () => new Date(),
};

function fail(message, code, httpStatus = 503) {
  return new ServiceHttpError(message, { httpStatus, body: { error: message, code } });
}

/** Exact opening excerpt, never a newly generated or paraphrased summary. */
export function summaryExcerpt(text) {
  const body = String(text || '').replace(/^\uFEFF/, '').trim()
    .replace(/^(What was presented|Main points raised)\s*\n+/i, '')
    .split(/\n\s*(?:Questions and answers|Open points|Questions and concerns|Follow-ups and decisions)\s*\n/i)[0].trim();
  if (body.length <= SUMMARY_CHARS) return { text: body, excerpt: false };
  const prefix = body.slice(0, SUMMARY_CHARS);
  const end = Math.max(prefix.lastIndexOf('. '), prefix.lastIndexOf('? '), prefix.lastIndexOf('! '));
  const cut = end > SUMMARY_CHARS / 2 ? end + 1 : prefix.lastIndexOf(' ');
  return { text: `${prefix.slice(0, cut > 0 ? cut : SUMMARY_CHARS).trim()}…`, excerpt: true };
}

async function readSummary(requestId, winner, dependencies) {
  if (!winner) return { status: 'missing', text: null };
  try {
    const body = await dependencies.readText({ requestId, documentId: winner.wmkf_requestdocumentid });
    if (body?.ok !== true) return { status: 'unavailable', text: null };
    if (body.item?.stale !== false) return { status: 'out_of_date', text: null };
    const excerpt = summaryExcerpt(body.text);
    if (!excerpt.text) return { status: 'missing', text: null };
    return { status: 'current', ...excerpt, documentId: winner.wmkf_requestdocumentid, publishedAt: body.item.publishedAt || null };
  } catch {
    return { status: 'unavailable', text: null };
  }
}

export async function loadProgramBriefing({ cycleCode, profileId }, dependencies = DEFAULTS) {
  if (!Number.isSafeInteger(profileId) || profileId < 1) throw fail('An active staff profile is required.', 'profile_required', 401);
  if (!dependencies.schemaReady()) throw fail('Meeting Tracker is not enabled in this environment.', 'meeting_tracker_schema_not_ready');
  if (cycleCode !== undefined && !parseCycleCode(cycleCode)) throw fail('Choose a valid grant cycle.', 'briefing_cycle_invalid', 400);
  const code = cycleCode?.trim().toUpperCase();
  const programFilter = `(${RESEARCH_PROGRAM_IDS.map((id) => `_akoya_programid_value eq ${id}`).join(' or ')})`;
  const result = await dependencies.queryRequests({
    select: withTestRequestIsolationSelect(SELECT),
    filter: withOrdinaryTestRequestODataFilter(`${programFilter} and (${buildVisibilityFilter(false)}) and (${code ? cycleCodeToOdataFilter(code) : 'wmkf_meetingdate ne null'})`),
    orderby: 'akoya_requestnum asc',
  });
  if (!Array.isArray(result?.records) || result.capped || result.hasMore) throw fail('The proposal list is incomplete. Refresh before printing.', 'briefing_membership_incomplete');
  const rows = result.records.filter((row) => testRequestCountsAsOrdinary(row));
  if (!code) {
    const byCode = new Map();
    for (const row of rows) {
      const c = meetingDateToCycleCode(row.wmkf_meetingdate);
      if (!c) continue;
      const previous = byCode.get(c);
      if (!previous || row.wmkf_meetingdate > previous.meetingDate) byCode.set(c, { code: c, label: cycleCodeToLabel(c), meetingDate: row.wmkf_meetingdate });
    }
    const cycles = [...byCode.values()].sort((a, b) => b.meetingDate.localeCompare(a.meetingDate));
    return { cycles, defaultCycleCode: resolveWorkingCycle(cycles, dependencies.now()) };
  }
  if (rows.length > BRIEFING_MAX_PROPOSALS) throw fail('This cycle has too many proposals for one briefing.', 'briefing_too_large', 413);
  if (rows.some((row) => !isGuid(row.akoya_requestid) || !PROGRAMS.some((p) => p.id === row._akoya_programid_value?.toLowerCase()) || meetingDateToCycleCode(row.wmkf_meetingdate) !== code)) {
    throw fail('The proposal list could not be verified. Refresh before printing.', 'briefing_membership_invalid');
  }
  const ids = rows.map((row) => row.akoya_requestid.toLowerCase());
  let documents = null;
  if (ids.length) {
    try {
      const page = await dependencies.findDocuments(ids);
      if (Array.isArray(page?.records) && !page.capped && !page.hasMore) documents = page.records;
    } catch { /* Preserve each proposal with explicit unavailable summary states. */ }
  } else documents = [];
  const sentiments = {};
  for (let offset = 0; offset < ids.length; offset += DELIBERATION_SENTIMENT_MAX_REQUESTS) {
    const batch = ids.slice(offset, offset + DELIBERATION_SENTIMENT_MAX_REQUESTS);
    try {
      Object.assign(sentiments, await dependencies.readSentiments(batch, { profileId }));
    } catch (error) {
      if (error?.code === 'sentiment_read_forbidden') throw error;
      for (const id of batch) sentiments[id] = { status: 'unavailable', sentiment: null };
    }
  }
  // Three proposal reads at a time; each has at most two SharePoint text reads.
  const proposals = [];
  for (let offset = 0; offset < rows.length; offset += 3) {
    proposals.push(...await Promise.all(rows.slice(offset, offset + 3).map(async (row) => {
      const requestId = row.akoya_requestid.toLowerCase();
      const projection = documents ? projectPostPresentationMaterials(documents, requestId) : null;
      const summary = async (type) => {
        if (!projection) return { status: 'unavailable', text: null };
        const winner = projection.winners.find((item) => Number(item.wmkf_artifacttype) === type);
        // A published row with broken backing is an unavailable source, not an absent summary.
        if (!winner && projection.conflicts.some((item) => item.artifactType === type)) return { status: 'unavailable', text: null };
        return readSummary(requestId, winner, dependencies);
      };
      const [proposalSummary, discussionSummary] = await Promise.all([summary(TYPE.TRANSCRIPT_SUMMARY), summary(TYPE.STAFF_DISCUSSION_SUMMARY)]);
      const read = sentiments[requestId];
      const sentiment = read?.status === 'current' && read.sentiment ? read : { status: read?.status === 'out_of_date' ? 'out_of_date' : read?.status === 'none' ? 'none' : 'unavailable', sentiment: null };
      return {
        requestId, requestNumber: row.akoya_requestnum || '', title: row.akoya_title || 'Untitled proposal',
        institution: requestInstitution(row), projectLeader: row._wmkf_projectleader_value_formatted || null,
        programKey: PROGRAMS.find((p) => p.id === row._akoya_programid_value.toLowerCase()).key,
        proposalSummary, discussionSummary, discussion: sentiment,
      };
    })));
  }
  const payload = {
    cycleCode: code, cycleLabel: cycleCodeToLabel(code), loadedAt: dependencies.now().toISOString(),
    groups: PROGRAMS.map(({ key, name }) => ({ key, name, proposals: proposals.filter((p) => p.programKey === key) })),
  };
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > 4 * 1024 * 1024) throw fail('This briefing is too large to display. Open proposals individually.', 'briefing_response_too_large', 413);
  return payload;
}
