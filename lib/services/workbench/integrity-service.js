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

export const WORKBENCH_INTEGRITY_MAX_PEOPLE = 10;
const ROLE_PI = 100000000;
const ROLE_COPI = 100000001;
const FORMATTED_PARENT_CUSTOMER = '_parentcustomerid_value@OData.Community.Display.V1.FormattedValue';

function identityName(row) {
  return String(row?.fullname || [row?.firstname, row?.lastname].filter(Boolean).join(' ') || '').trim();
}

/** Caller must already be inside a trusted withDalContext scope. */
export async function loadRequestIntegrityPeople(requestId, dependencies = {}) {
  const requests = dependencies.grantRequestAdapter || grantRequestAdapter;
  const junction = dependencies.appRequestPersonAdapter || appRequestPersonAdapter;
  const contacts = dependencies.contactAdapter || contactAdapter;
  const request = await requests.getById(requestId, {
    select: 'akoya_requestid,_wmkf_projectleader_value,_akoya_applicantid_value',
  });
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
  return people;
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


export async function getWorkbenchIntegrityContext({ requestId }, dependencies = {}) {
  const people = await loadRequestIntegrityPeople(requestId, dependencies);
  const latestRun = await getLatestRequestIntegrityRun(requestId, dependencies);
  return { requestId, people, latestRun };
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
  for await (const update of engine.screenApplicants(applicants, claudeApiKey, serpApiKey || null, null)) {
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
