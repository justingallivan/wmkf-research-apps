/**
 * J27 later-phase facts: `presentation`, `roster`, `boardDraft` and
 * `transition`, the four stage-model keys that used to arrive only as a
 * request page's tabs loaded, and differently for different viewers.
 *
 * Plan: docs/plans/J27_LATER_PHASE_LISTS_PLAN_2026-11-10.md, step 1 (on main).
 * One rule for every reader. Each function returns a WHOLE key from the rows
 * it is given, so a later read replaces the key instead of merging into it.
 * Nothing here looks at who is asking, and nothing here writes.
 *
 * - `transition` is worked out first; a committed Final row means the draft
 *   exists, because starting group review moves the draft to the Final
 *   lifecycle (transition-claims.js).
 * - `presentation.exists` uses the attendance service's accepted state and
 *   status pairs, so the phase agrees with the attendance panel;
 *   `presentation.ended` uses the group-review start guard's classification
 *   (transition-schedule.js), so a task and the guard cannot disagree.
 * - A read that failed or was capped yields `unavailable`; a schema that is
 *   off on this deployment yields `not-provisioned` (j27-read-model.js).
 */
import { createHash } from 'node:crypto';
import { readScheduledPreparationStateStatusPairs } from '../../../shared/config/siteVisit.js';
import { REQUEST_DOCUMENT_ARTIFACT_TYPE, REQUEST_DOCUMENT_LIFECYCLE_STATE } from '../../../shared/config/requestDocument.js';
import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import * as siteVisitAdapter from '../../dataverse/adapters/site-visit.js';
import { isGuid } from '../../utils/guid.js';
import { isFinalWriteupSchemaReady } from '../../utils/final-writeup-readiness.js';
import { meetingRosterSchemaEnabled } from '../../utils/meeting-roster-readiness.js';
import {
  assertEligibleSource, committedFinal, findCurrentFinal, resolveSource, stageOf,
} from '../final-writeup/transition-model.js';
import { classifyPresentationSchedule } from '../final-writeup/transition-schedule.js';

const sameId = (left, right) => String(left || '').toLowerCase() === String(right || '').toLowerCase();
const UNAVAILABLE = Object.freeze({ status: 'unavailable' });
const NOT_PROVISIONED = Object.freeze({ status: 'not-provisioned' });

/**
 * The request columns the document rules read. Both pointers belong to the
 * pre-site draft schema (wave 19), which every target has and the Staff
 * deliberations list already selects unconditionally; they are not gated on
 * the Final Writeup transition schema (wave 22).
 */
export const J27_LATER_REQUEST_FIELDS = Object.freeze(['_wmkf_currentpresitevisit_value', '_wmkf_currentfinalwriteup_value']);

/** Open, Completed and Scheduled: the exact pairs the attendance service accepts (verified in sandbox metadata). */
export function isAcceptedPresentationRow(row) {
  const state = Number(row?.statecode);
  const status = Number(row?.statuscode);
  return (state === 0 && status === 1) || (state === 1 && status === 2) || (state === 3 && status === 4);
}

/** Ties a confirmed roster to one presentation's identity and schedule. */
export function presentationBinding(visit) {
  return createHash('sha256').update(JSON.stringify([
    visit.activityid, visit.scheduledstart, visit.scheduledend,
  ])).digest('hex');
}

export function storedRosters(value) {
  if (!value) return {};
  const saved = JSON.parse(value);
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw Error('Invalid roster storage.');
  return saved;
}

/**
 * @param {string} requestId
 * @param {Array} visitRows presentation records for this request (others are ignored)
 * @returns {{ presentation: object, visit: object|null }} `visit` is the one accepted record, when there is exactly one
 */
export function presentationFact(requestId, visitRows, { pairs = readScheduledPreparationStateStatusPairs(), nowMs = Date.now() } = {}) {
  const rows = (visitRows || []).filter((row) => sameId(row?._regardingobjectid_value, requestId));
  const accepted = rows.filter(isAcceptedPresentationRow);
  const schedule = classifyPresentationSchedule(rows, pairs, nowMs);
  const ended = schedule.state === 'ended' ? true : schedule.state === 'upcoming' ? false : null;
  const visit = accepted.length === 1 && isGuid(accepted[0].activityid) ? accepted[0] : null;
  return {
    presentation: {
      status: 'present',
      // Either rule seeing a presentation is enough for it to exist; only the guard's rule times it.
      exists: accepted.length > 0 || ended !== null,
      id: visit ? visit.activityid : null,
      ended,
      // D63: no cycle this model covers may start group review without an ended presentation.
      legacyException: false,
    },
    visit,
    acceptedCount: accepted.length,
  };
}

/** Confirmed attendance for the one accepted presentation. */
export function rosterFact(request, { visit, acceptedCount }, { rosterEnabled = meetingRosterSchemaEnabled() } = {}) {
  if (!rosterEnabled) return NOT_PROVISIONED;
  if (acceptedCount === 0) return { status: 'absent' };
  // More than one accepted presentation, or one without a stable identity: the attendance panel refuses these too.
  if (!visit) return UNAVAILABLE;
  try {
    const saved = storedRosters(request?.wmkf_confirmedmeetingroster)[visit.activityid];
    if (!saved) return { status: 'absent' };
    return { status: 'present', stale: saved.binding !== presentationBinding(visit) };
  } catch {
    return { status: 'absent', stale: true };
  }
}

const DRAFT_NEEDED = new Set(['final_writeup_source_missing', 'final_writeup_source_ineligible']);

/**
 * @param {object} request must carry the two current-document pointers
 * @param {Array} documentRows this request's draft and Final rows
 */
export function documentFacts(request, documentRows, { schemaReady = isFinalWriteupSchemaReady() } = {}) {
  const state = {
    request,
    rows: (documentRows || []).filter((row) => sameId(row?._wmkf_request_value, request?.akoya_requestid)),
  };
  // The review stage needs the transition schema (wave 22). The draft does
  // not: a target without it can still hold an eligible Board draft, and
  // hiding that draft would put the request in the wrong phase.
  let transition = NOT_PROVISIONED;
  const failed = { boardDraft: UNAVAILABLE, transition: schemaReady ? UNAVAILABLE : NOT_PROVISIONED };
  if (schemaReady) {
    let current;
    try {
      current = findCurrentFinal(state);
    } catch {
      return failed;
    }
    if (current) {
      const committed = committedFinal(state, current._wmkf_sourcedocument_value, current.wmkf_requestdocumentid);
      if (!committed) return failed;
      return { boardDraft: { status: 'present', exists: true }, transition: { status: 'present', phase: stageOf(committed) } };
    }
    transition = { status: 'present', phase: null };
  } else if (request?._wmkf_currentfinalwriteup_value) {
    // A Final pointer means a draft was handed off; its stage cannot be read here.
    return { boardDraft: { status: 'present', exists: true }, transition };
  }
  try {
    const source = resolveSource(state);
    // A draft already in the Final lifecycle with no Final pointer needs reconciliation.
    if (source.wmkf_lifecyclestate === REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL) return failed;
    assertEligibleSource(source);
    return { boardDraft: { status: 'present', exists: true }, transition };
  } catch (error) {
    if (DRAFT_NEEDED.has(error?.code)) return { boardDraft: { status: 'present', exists: false }, transition };
    // The write fence is the transition's concern, not a reader's.
    if (error?.code === 'final_writeup_etag_missing') return { boardDraft: { status: 'present', exists: true }, transition };
    return failed;
  }
}

const DEFAULT_DEPENDENCIES = Object.freeze({
  findDocuments: requestDocumentAdapter.findByRequests,
  findSiteVisits: siteVisitAdapter.findSummariesByRequests,
  schemaReady: isFinalWriteupSchemaReady,
  rosterEnabled: meetingRosterSchemaEnabled,
  readSchedulePairs: readScheduledPreparationStateStatusPairs,
  now: () => Date.now(),
});

function settled(result, label) {
  if (result.status === 'rejected') {
    console.warn(`[j27-later-facts] ${label} read failed:`, result.reason?.code || '', result.reason?.message || result.reason);
    return null;
  }
  const value = result.value;
  if (!value || value.capped || value.hasMore || !Array.isArray(value.records)) {
    console.warn(`[j27-later-facts] ${label} read was incomplete.`);
    return null;
  }
  return value.records;
}

/**
 * The four keys for a set of request rows: three batched reads, none per row.
 * A failed or incomplete read makes its keys `unavailable` on every row and
 * never throws past the caller.
 *
 * @param {Array} requests rows carrying `akoya_requestid`, the two pointers (when the schema is on) and the roster memo
 * @returns {Promise<Map<string, { presentation, roster, boardDraft, transition }>>} keyed by lower-case request id
 */
export async function loadJ27LaterFacts(requests, dependencies = DEFAULT_DEPENDENCIES) {
  const deps = { ...DEFAULT_DEPENDENCIES, ...dependencies };
  const rows = (requests || []).filter((row) => row?.akoya_requestid);
  const out = new Map();
  if (!rows.length) return out;
  const ids = rows.map((row) => row.akoya_requestid);
  const schemaReady = deps.schemaReady();
  const [draftRead, finalRead, visitRead] = await Promise.allSettled([
    deps.findDocuments(ids, { artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT, listFactsOnly: true }),
    // Final rows are read only where the transition schema exists.
    schemaReady
      ? deps.findDocuments(ids, { artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.FINAL_WRITEUP, listFactsOnly: true })
      : Promise.resolve({ records: [] }),
    deps.findSiteVisits(ids),
  ]);
  const drafts = settled(draftRead, 'draft documents');
  const finals = settled(finalRead, 'Final documents');
  const visits = settled(visitRead, 'presentation records');
  const documentRows = drafts && finals ? [...drafts, ...finals] : null;
  const options = { pairs: deps.readSchedulePairs(), nowMs: deps.now() };
  const rosterEnabled = deps.rosterEnabled();
  for (const request of rows) {
    const id = request.akoya_requestid;
    const seen = visits ? presentationFact(id, visits, options) : null;
    out.set(String(id).toLowerCase(), {
      presentation: seen ? seen.presentation : UNAVAILABLE,
      roster: seen ? rosterFact(request, seen, { rosterEnabled }) : (rosterEnabled ? UNAVAILABLE : NOT_PROVISIONED),
      ...(documentRows
        ? documentFacts(request, documentRows, { schemaReady })
        : { boardDraft: UNAVAILABLE, transition: schemaReady ? UNAVAILABLE : NOT_PROVISIONED }),
    });
  }
  return out;
}
