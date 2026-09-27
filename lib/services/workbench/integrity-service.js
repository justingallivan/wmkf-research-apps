/**
 * Workbench request integrity screening.
 *
 * Reads PI/Co-PI identities from Dataverse and persists one linked history row
 * per completed screen. The 10-person ceiling is a defensive spend bound, not
 * a business rule; it prevents a malformed junction from triggering unbounded
 * paid searches and summaries.
 */
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request';
import * as appRequestPersonAdapter from '../../dataverse/adapters/app-request-person';
import * as contactAdapter from '../../dataverse/adapters/contact';
import * as odata from '../../dataverse/core/odata';
import { sql } from '@vercel/postgres';
import { requestInstitution } from '../../../shared/utils/institution';
import { ServiceHttpError } from '../service-http-error';
import { getUserRole } from '../../utils/auth';
import { isGuid } from '../../utils/guid';

export const WORKBENCH_INTEGRITY_MAX_PEOPLE = 10;
const ROLE_PI = 100000000;
const ROLE_COPI = 100000001;
const FORMATTED_PARENT_CUSTOMER = '_parentcustomerid_value@OData.Community.Display.V1.FormattedValue';

function identityName(row) {
  return String(row?.fullname || [row?.firstname, row?.lastname].filter(Boolean).join(' ') || '').trim();
}

/** Caller must already be inside a trusted withDalContext scope. */
async function loadRequestIntegrityData(requestId, dependencies = {}) {
  const requests = dependencies.grantRequestAdapter || grantRequestAdapter;
  const junction = dependencies.appRequestPersonAdapter || appRequestPersonAdapter;
  const contacts = dependencies.contactAdapter || contactAdapter;
  let request;
  try {
    request = await requests.getById(requestId, {
      select: 'akoya_requestid,_wmkf_projectleader_value,_akoya_applicantid_value,_wmkf_programdirector_value',
    });
  } catch (error) {
    if (error?.serviceName === 'dataverse' && error.status === 404) {
      throw new ServiceHttpError('Request not found', { httpStatus: 404 });
    }
    throw error;
  }
  if (!request) throw new ServiceHttpError('Request not found', { httpStatus: 404 });

  const junctionResult = await junction.queryAllPersons({
    select: '_wmkf_contact_value,wmkf_role,wmkf_authorposition',
    expand: 'wmkf_Contact($select=fullname,firstname,lastname,adx_organizationname,_parentcustomerid_value)',
    filter: `${odata.eqGuid('_wmkf_request_value', requestId)} and (wmkf_role eq ${ROLE_PI} or wmkf_role eq ${ROLE_COPI})`,
    orderby: 'wmkf_authorposition asc,createdon asc',
  });
  if (junctionResult?.capped) throw new Error('PI/Co-PI junction results were capped; refusing an incomplete screen');
  const junctionRows = junctionResult?.records || [];
  const peopleById = new Map();

  const add = (contactId, role, personRow = null) => {
    if (!contactId) return;
    const key = String(contactId).toLowerCase();
    const current = peopleById.get(key);
    const normalizedRole = role === 'PI' ? 'PI' : 'Co-PI';
    const expanded = personRow?.wmkf_Contact || personRow || {};
    if (current) {
      if (normalizedRole === 'PI') {
        current.role = 'PI';
        current.name = identityName(expanded) || current.name;
        current.institution = String(expanded.adx_organizationname || expanded._parentcustomerid_value_formatted || expanded[FORMATTED_PARENT_CUSTOMER] || '').trim() || current.institution;
      }
      return;
    }
    peopleById.set(key, {
      contactId: key,
      name: identityName(expanded),
      institution: String(expanded.adx_organizationname || expanded._parentcustomerid_value_formatted || expanded[FORMATTED_PARENT_CUSTOMER] || '').trim(),
      role: normalizedRole,
    });
  };

  // UNION the request's current Project Leader with PI/Co-PI junction rows.
  // PI role wins if an identity appears in both sources or both roles.
  add(request._wmkf_projectleader_value, 'PI');
  for (const row of junctionRows) {
    if (![ROLE_PI, ROLE_COPI].includes(Number(row.wmkf_role))) continue;
    add(row._wmkf_contact_value, Number(row.wmkf_role) === ROLE_PI ? 'PI' : 'Co-PI', row);
  }

  if (peopleById.size > WORKBENCH_INTEGRITY_MAX_PEOPLE) {
    throw new ServiceHttpError(`This request has more than ${WORKBENCH_INTEGRITY_MAX_PEOPLE} screenable people`, {
      httpStatus: 409,
      body: { error: `This request has more than ${WORKBENCH_INTEGRITY_MAX_PEOPLE} screenable people; contact support to review the Dataverse roster`, code: 'person_limit_exceeded' },
    });
  }

  // Hydrate names and affiliations for identities missing from the junction's
  // expansion (including a Project Leader that has no PI junction row).
  const needsHydration = [...peopleById.values()].filter((person) => !person.name || !person.institution);
  await Promise.all(needsHydration.map(async (person) => {
    const detail = await contacts.getByIdWithSelect(person.contactId, [
      'contactid', 'fullname', 'firstname', 'lastname', 'adx_organizationname', '_parentcustomerid_value',
    ]);
    if (!detail) return;
    person.name = person.name || identityName(detail);
    person.institution = person.institution || String(detail.adx_organizationname || detail._parentcustomerid_value_formatted || detail[FORMATTED_PARENT_CUSTOMER] || '').trim();
  }));

  const fallbackInstitution = requestInstitution(request);
  const projectLeaderId = String(request._wmkf_projectleader_value || '').toLowerCase();
  const people = [...peopleById.values()]
    .map((person) => ({
      ...person,
      // The request applicant organization is a grounded fallback for its PI.
      // Co-PI affiliation remains blank when Dataverse has no contact-level value.
      institution: person.institution || (person.role === 'PI' && person.contactId === projectLeaderId ? fallbackInstitution : null) || '',
    }))
    .sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : (a.role === 'PI' ? -1 : 1)));
  return { request, people };
}

export async function loadRequestIntegrityPeople(requestId, dependencies = {}) {
  return (await loadRequestIntegrityData(requestId, dependencies)).people;
}

function savedRunDto(row) {
  if (!row) return null;
  return {
    id: row.id,
    createdAt: row.created_at,
    screenedNames: row.screened_names,
    results: row.results,
    matchCount: row.match_count,
    status: row.status,
  };
}

export async function getLatestRequestIntegrityRun(requestId, dependencies = {}) {
  const db = dependencies.sql || sql;
  const result = await db`
    SELECT id, created_at, screened_names, results, match_count, status
    FROM integrity_screenings
    WHERE request_id = ${requestId}
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `;
  return savedRunDto(result.rows[0] || null);
}

const HISTORY_PAGE_SIZE = 20;
const SCREENING_SOURCES = ['retraction_watch', 'pubpeer', 'news'];
const DECISIONS = new Set(['approved', 'hold']);

function reviewError(message, code, httpStatus = 400) {
  return new ServiceHttpError(message, {
    httpStatus,
    code,
    body: { error: message, code },
  });
}

function validProfileId(profileId) {
  return Number.isSafeInteger(profileId) && profileId > 0;
}

function sameId(left, right) {
  return String(left || '').toLowerCase() === String(right || '').toLowerCase();
}

async function reviewerAuthority({ request, profileId, actingUserSystemId }, dependencies = {}) {
  if (!validProfileId(profileId) || !isGuid(actingUserSystemId)) {
    return { allowed: false, profileId: null, actingUserSystemId: null, isSuperuser: false };
  }
  const getRole = dependencies.getUserRole || getUserRole;
  const role = await getRole(profileId);
  const isSuperuser = role === 'superuser';
  const isLeadPd = sameId(request?._wmkf_programdirector_value, actingUserSystemId);
  return { allowed: isSuperuser || isLeadPd, profileId, actingUserSystemId, isSuperuser };
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : null;
    } catch { return null; }
  }
  return null;
}

function normalizedRoster(people) {
  if (!Array.isArray(people)) return null;
  const normalized = [];
  for (const person of people) {
    if (!person || !isGuid(person.contactId)
      || typeof person.name !== 'string' || !person.name.trim()
      || typeof person.institution !== 'string'
      || !['PI', 'Co-PI'].includes(person.role)) return null;
    normalized.push([
      String(person.contactId).toLowerCase(),
      person.name,
      person.institution,
      person.role,
    ]);
  }
  return normalized.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

export function integrityRosterMatches(left, right) {
  const a = normalizedRoster(left);
  const b = normalizedRoster(right);
  return Boolean(a && b && JSON.stringify(a) === JSON.stringify(b));
}

function hasCompleteSourceCoverage(screening) {
  const roster = parseJsonArray(screening?.screened_names);
  const results = parseJsonArray(screening?.results);
  if (!roster || !results || roster.length === 0 || results.length !== roster.length) return false;
  for (let i = 0; i < roster.length; i += 1) {
    const person = roster[i];
    const result = results[i];
    if (!person || typeof person.name !== 'string'
      || !result || result.name !== person.name
      || result.institution !== person.institution
      || result.sourceCoverageVersion !== 1) return false;
    const sources = result.sources;
    if (!sources || SCREENING_SOURCES.some((sourceName) => (
      !sources[sourceName] || sources[sourceName].searched !== true || sources[sourceName].error
    ))) return false;
  }
  return true;
}

function reviewDto(row) {
  if (!row) return null;
  return {
    id: row.id,
    screeningId: row.screening_id,
    decision: row.decision,
    notes: row.notes || '',
    createdAt: row.created_at,
    reviewerProfileId: row.reviewer_profile_id,
    reviewerName: row.reviewer_name || null,
    reviewerSystemId: row.reviewer_systemuser_id,
  };
}

async function readIntegrityHistory(requestId, beforeRunId, dependencies = {}) {
  const db = dependencies.sql || sql;
  let cursor = null;
  if (beforeRunId !== undefined && beforeRunId !== null) {
    if (!Number.isSafeInteger(beforeRunId) || beforeRunId < 1) {
      throw reviewError('beforeRunId must be a positive screening id', 'invalid_history_cursor');
    }
    const cursorResult = await db`
      SELECT id, created_at
      FROM integrity_screenings
      WHERE request_id = ${requestId} AND id = ${beforeRunId}
      LIMIT 1
    `;
    cursor = cursorResult.rows[0] || null;
    if (!cursor) throw reviewError('History cursor was not found for this request', 'invalid_history_cursor');
  }

  const page = cursor
    ? await db`
        SELECT id, created_at, screened_names, results, match_count, status
        FROM integrity_screenings
        WHERE request_id = ${requestId}
          AND (created_at, id) < (${cursor.created_at}, ${cursor.id})
        ORDER BY created_at DESC, id DESC
        LIMIT ${HISTORY_PAGE_SIZE + 1}
      `
    : await db`
        SELECT id, created_at, screened_names, results, match_count, status
        FROM integrity_screenings
        WHERE request_id = ${requestId}
        ORDER BY created_at DESC, id DESC
        LIMIT ${HISTORY_PAGE_SIZE + 1}
      `;
  const hasMore = page.rows.length > HISTORY_PAGE_SIZE;
  const rows = page.rows.slice(0, HISTORY_PAGE_SIZE);
  const screeningIds = [...new Set(rows.map((row) => row.id))];
  const reviewsByScreening = new Map(screeningIds.map((id) => [String(id), []]));
  if (screeningIds.length) {
    const reviews = await db`
      SELECT r.id, r.screening_id, r.decision, r.notes, r.created_at,
             r.reviewer_profile_id, p.display_name, p.name AS profile_name,
             r.reviewer_systemuser_id
      FROM integrity_screening_reviews r
      LEFT JOIN user_profiles p ON p.id = r.reviewer_profile_id
      WHERE r.screening_id = ANY(${screeningIds}::int[])
      ORDER BY r.created_at DESC, r.id DESC
    `;
    for (const row of reviews.rows) {
      const list = reviewsByScreening.get(String(row.screening_id));
      if (list) list.push(reviewDto({ ...row, reviewer_name: row.display_name || row.profile_name }));
    }
  }
  const history = rows.map((row) => ({
    ...savedRunDto(row),
    reviews: reviewsByScreening.get(String(row.id)) || [],
  }));
  return {
    history,
    historyHasMore: hasMore,
    historyNextBeforeId: hasMore ? rows[rows.length - 1]?.id ?? null : null,
  };
}

async function readReviewsForScreening(screeningId, dependencies = {}) {
  const db = dependencies.sql || sql;
  const result = await db`
    SELECT r.id, r.screening_id, r.decision, r.notes, r.created_at,
           r.reviewer_profile_id, p.display_name, p.name AS profile_name,
           r.reviewer_systemuser_id
    FROM integrity_screening_reviews r
    LEFT JOIN user_profiles p ON p.id = r.reviewer_profile_id
    WHERE r.screening_id = ${screeningId}
    ORDER BY r.created_at DESC, r.id DESC
  `;
  return result.rows.map((row) => reviewDto({ ...row, reviewer_name: row.display_name || row.profile_name }));
}

function deriveReviewState({ latestRun, reviews, people, authorized }) {
  const latestDecision = reviews[0] || null;
  const runPeople = parseJsonArray(latestRun?.screenedNames);
  const rosterChanged = Boolean(latestRun && !integrityRosterMatches(runPeople, people));
  const sourceComplete = latestRun ? hasCompleteSourceCoverage({
    screened_names: latestRun.screenedNames,
    results: latestRun.results,
  }) : false;
  let status = 'not_screened';
  let reason = null;
  if (latestRun && rosterChanged) {
    status = 'roster_changed';
    reason = 'The PI/Co-PI roster changed after this run. Screen the current roster before approval.';
  } else if (latestDecision?.decision === 'hold') {
    status = 'hold';
    reason = 'The latest screening is on hold.';
  } else if (latestRun && !sourceComplete) {
    status = 'incomplete';
    reason = 'This run does not contain verified results from all required sources.';
  } else if (latestDecision?.decision === 'approved') {
    status = 'approved';
    reason = null;
  } else if (latestRun) {
    status = 'needs_review';
    reason = 'The latest screening is ready for Program Director review.';
  } else {
    reason = 'Run an integrity screen before recording a disposition.';
  }
  const canReview = Boolean(authorized && latestRun);
  const canApprove = Boolean(canReview && latestRun && !rosterChanged && sourceComplete
    && latestDecision?.decision !== 'approved');
  return { status, canReview, canApprove, reason, latestDecision };
}

export async function getWorkbenchIntegrityContext({
  requestId, profileId = null, actingUserSystemId = null, beforeRunId = null,
}, dependencies = {}) {
  const { request, people } = await loadRequestIntegrityData(requestId, dependencies);
  const authority = await reviewerAuthority({ request, profileId, actingUserSystemId }, dependencies);
  const latestRun = await getLatestRequestIntegrityRun(requestId, dependencies);
  const page = await readIntegrityHistory(requestId, beforeRunId, dependencies);
  let latestReviews = [];
  if (latestRun) latestReviews = await readReviewsForScreening(latestRun.id, dependencies);
  const review = deriveReviewState({
    latestRun,
    reviews: latestReviews,
    people,
    authorized: authority.allowed,
  });
  return { requestId, people, latestRun, ...page, review };
}

/**
 * Screen Dataverse-sourced PI/Co-PI people and require durable request linkage.
 * Caller must establish withDalContext before invoking this function.
 */
export async function runWorkbenchIntegrityScreen({ requestId, actorProfileId, claudeApiKey, serpApiKey }, dependencies = {}) {
  const people = await loadRequestIntegrityPeople(requestId, dependencies);
  if (people.length === 0) {
    throw new ServiceHttpError('No PI or Co-PI people are available to screen', {
      httpStatus: 409,
      body: { error: 'No PI or Co-PI people are available to screen', code: 'no_people' },
    });
  }
  if (people.some((person) => !person.name)) {
    throw new ServiceHttpError('A PI or Co-PI contact is missing a usable name', {
      httpStatus: 409,
      body: { error: 'A PI or Co-PI contact is missing a usable name', code: 'person_identity_unavailable' },
    });
  }
  if (people.length > WORKBENCH_INTEGRITY_MAX_PEOPLE) {
    throw new ServiceHttpError(`This request has more than ${WORKBENCH_INTEGRITY_MAX_PEOPLE} screenable people`, {
      httpStatus: 409,
      body: { error: `This request has more than ${WORKBENCH_INTEGRITY_MAX_PEOPLE} screenable people`, code: 'person_limit_exceeded' },
    });
  }
  if (!actorProfileId) throw new Error('Authenticated profile id is required to save a workbench screen');
  // Preflight the new column before any paid provider call. If migration 056
  // has not been applied yet, fail before screening starts.
  await getLatestRequestIntegrityRun(requestId, dependencies);
  if (!claudeApiKey) {
    throw new ServiceHttpError('Claude API key not configured on server', {
      httpStatus: 503,
      body: { error: 'Claude API key not configured on server', code: 'screening_unavailable' },
    });
  }

  const engine = dependencies.IntegrityService || (await import('../integrity-service')).IntegrityService;
  const applicants = people.map(({ name, role, institution }) => ({ name, role, institution }));
  let completed = null;
  for await (const update of engine.screenApplicants(
    applicants, claudeApiKey, serpApiKey || null, null, { strictSourceErrors: true },
  )) {
    if (update.type === 'complete') completed = update;
  }
  if (!completed) throw new Error('Integrity screening did not produce a completed result');

  // Explicitly awaited and fail-closed: the engine's standalone mode keeps its
  // historical fail-soft auto-save, while this request-scoped mode must not
  // return success unless its request-linked row is durable.
  const matchCount = completed.results.reduce((sum, result) => sum + (Number(result.matchCount) || 0), 0);
  const db = dependencies.sql || sql;
  const saved = await db`
    INSERT INTO integrity_screenings (
      user_profile_id, screening_type, screened_names, results, match_count, status, request_id
    ) VALUES (
      ${actorProfileId}, 'workbench', ${JSON.stringify(people)}, ${JSON.stringify(completed.results)},
      ${matchCount}, 'pending', ${requestId}
    )
    RETURNING id, created_at, screened_names, results, match_count, status
  `;
  const persisted = savedRunDto(saved.rows[0] || null);
  if (!persisted) throw new Error('Request screening insert returned no persisted row');
  return { requestId, people, run: persisted };
}

async function getRequestScreeningRow(requestId, screeningId, dependencies = {}) {
  const db = dependencies.sql || sql;
  const result = await db`
    SELECT id, request_id, created_at, screened_names, results, match_count, status
    FROM integrity_screenings
    WHERE request_id = ${requestId} AND id = ${screeningId}
    LIMIT 1
  `;
  return result.rows[0] || null;
}

async function getCurrentRequestScreeningRow(requestId, dependencies = {}) {
  const db = dependencies.sql || sql;
  const result = await db`
    SELECT id, request_id, created_at, screened_names, results, match_count, status
    FROM integrity_screenings
    WHERE request_id = ${requestId}
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `;
  return result.rows[0] || null;
}

/** Append a lead-PD/superuser disposition for the exact current request run. */
export async function recordWorkbenchIntegrityReview({
  requestId, screeningId, decision, notes = '', profileId, actingUserSystemId,
}, dependencies = {}) {
  if (!Number.isSafeInteger(screeningId) || screeningId < 1) {
    throw reviewError('screeningId must be a positive safe integer', 'invalid_screening_id');
  }
  if (!DECISIONS.has(decision)) {
    throw reviewError('decision must be approved or hold', 'invalid_decision');
  }
  if (typeof notes !== 'string' || [...notes].length > 2000) {
    throw reviewError('notes must be a string of at most 2000 characters', 'invalid_notes');
  }
  const cleanNotes = notes.trim();
  if (decision === 'hold' && !cleanNotes) {
    throw reviewError('Notes are required when placing a screening on hold', 'hold_notes_required');
  }

  const { request, people } = await loadRequestIntegrityData(requestId, dependencies);
  const authority = await reviewerAuthority({ request, profileId, actingUserSystemId }, dependencies);
  if (!authority.allowed) {
    throw reviewError('Only this request’s lead Program Director or a superuser can record a disposition', 'integrity_review_forbidden', 403);
  }

  const target = await getRequestScreeningRow(requestId, screeningId, dependencies);
  if (!target) throw reviewError('Screening was not found for this request', 'screening_not_found', 404);
  const current = await getCurrentRequestScreeningRow(requestId, dependencies);
  if (!current || String(current.id) !== String(target.id)) {
    throw reviewError('Only the latest screening for this request can receive a disposition', 'screening_not_latest', 409);
  }

  if (decision === 'approved') {
    if (!integrityRosterMatches(target.screened_names, people)) {
      throw reviewError('The current PI/Co-PI roster differs from the screened roster; run a new screen before approval', 'integrity_roster_changed', 409);
    }
    if (!hasCompleteSourceCoverage(target)) {
      throw reviewError('Approval requires versioned results from all three sources for every person', 'integrity_screen_incomplete', 409);
    }
  }

  const db = dependencies.sql || sql;
  const inserted = await db`
    INSERT INTO integrity_screening_reviews (
      screening_id, request_id, reviewer_profile_id, reviewer_systemuser_id, decision, notes
    )
    SELECT ${screeningId}, ${requestId}, ${authority.profileId}, ${authority.actingUserSystemId}, ${decision}, ${cleanNotes}
    WHERE ${screeningId} = (
      SELECT id
      FROM integrity_screenings
      WHERE request_id = ${requestId}
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    )
    RETURNING id
  `;
  if (!inserted?.rows?.length) {
    throw reviewError('A newer screening started before this disposition was recorded', 'screening_not_latest', 409);
  }

  // Re-read current state after the append. A newer run committed concurrently
  // must become the effective latest status in the response.
  return getWorkbenchIntegrityContext({
    requestId,
    profileId: authority.profileId,
    actingUserSystemId: authority.actingUserSystemId,
  }, dependencies);
}
