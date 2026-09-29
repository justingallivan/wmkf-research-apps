/**
 * Run-scoped write fence for a production Test Request Factory run
 * (docs/plans/TEST_REQUEST_FACTORY_PRODUCTION_PLAN_2026-09-27.md, MVP build
 * list item 2, the simplified P2).
 *
 * In production the source and the destination are the same org, so the
 * Factory's own writes are held to exactly what the basic recipe creates:
 *   - Dataverse: one POST of the destination Request (its preallocated GUID)
 *     and one POST of its preallocated SharePoint location bound to it;
 *     every PATCH, DELETE and raw call is refused (a production basic run
 *     makes no update: correct_meeting_date never writes and the GoVerify
 *     bypass is refused);
 *   - Graph: folder and upload writes only in the request library under the
 *     destination's own folder; deletes are refused.
 * Any write whose path or body names the source Request is refused outright.
 * Reads pass through unchanged. Unknown methods are refused (deny by
 * default), so a new write method cannot bypass the fence by being new.
 *
 * Server-side automation a create triggers is outside this fence (plan
 * hazard 1); the P5 observation covers it.
 */

import { APPLICANT_DISPOSITION_MAP } from '../../../shared/config/reviewerLifecycle.js';
import { expectedRequestFolder } from './sandbox-clone.js';

const REQUEST_LIBRARY = 'akoya_request';
const CLIENT_READS = new Set(['get', 'getWithOptions']);
const CLIENT_POSTS = new Set(['post', 'postWithOptions']);
const GRAPH_READS = new Set([
  'getSiteId', 'getDriveId', 'listFiles', 'getFileMetadataById', 'downloadFile', 'getFileMetadataByPath',
  'getFileVersionMetadata', 'downloadFileVersion', 'clearGraphCaches', 'configuredSharePointTarget',
]);
const GRAPH_FOLDER_WRITES = new Set(['ensureFolderPath', 'uploadFile']);

function refuse(message) {
  return Object.assign(new Error(`Production write fence: ${message}`), { code: 'create_rejected' });
}

function lower(value) {
  return String(value ?? '').toLowerCase();
}

function namesSource(text, sourceRequestId) {
  return Boolean(sourceRequestId) && lower(text).includes(lower(sourceRequestId));
}

// Closed body shapes (Codex, MVP slice 2): a Dataverse POST can deep-insert
// related records through nested objects or navigation properties, so each
// admitted POST names exactly its own columns, every value is a primitive,
// and a bind must point at an approved entity set by GUID.
const REQUEST_COLUMNS = new Set([
  'akoya_requestid', 'akoya_title', 'akoya_purpose', 'akoya_request', 'akoya_fiscalyear', 'akoya_requesttype',
  'wmkf_meetingdate', 'wmkf_istestrequest', 'wmkf_testcreationrunid', 'wmkf_respondreminderenabled',
  'wmkf_reviewduereminderenabled', 'akoya_requeststatus',
]);
const REQUEST_BIND_SETS = new Set(['accounts', 'systemusers', 'wmkf_grantprograms']);
const LOCATION_COLUMNS = new Set(['sharepointdocumentlocationid', 'name', 'relativeurl', 'servicetype', 'locationtype']);
const BIND_VALUE = /^\/([a-z_]+)\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)$/i;

function isPrimitive(value) {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function assertClosedBody(body, columns, bindAllowed, label) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw refuse(`${label} body is not an object.`);
  for (const [key, value] of Object.entries(body)) {
    if (!isPrimitive(value)) throw refuse(`${label} field ${key} is not a primitive value.`);
    if (key.endsWith('@odata.bind')) {
      const match = BIND_VALUE.exec(String(value));
      if (!match || !bindAllowed(key, match[1].toLowerCase(), match[2])) throw refuse(`${label} bind ${key} is not approved.`);
    } else if (!columns.has(key)) {
      throw refuse(`${label} field ${key} is not an approved column.`);
    }
  }
}

function assertAllowedPost(path, body, fence) {
  const serialized = JSON.stringify(body ?? null);
  if (namesSource(path, fence.sourceRequestId) || namesSource(serialized, fence.sourceRequestId)) {
    throw refuse('a write names the source Request.');
  }
  if (path === '/akoya_requests' && lower(body?.akoya_requestid) === lower(fence.destinationRequestId)) {
    // The cast PI and Liaison (slice B) are the only contacts a Request create
    // may bind: each through its own lookup (the navigation property is the
    // lookup's schema name, so it lowercases to the logical name) to its own
    // journaled GUID, never swapped, and both are required when the fence
    // names them.
    const castBinds = fence.castBinds || {};
    assertClosedBody(body, REQUEST_COLUMNS, (key, set, id) => {
      if (set !== 'contacts') return REQUEST_BIND_SETS.has(set);
      const lookup = lower(key.slice(0, -'@odata.bind'.length));
      return Object.hasOwn(castBinds, lookup) && lower(castBinds[lookup]) === lower(id);
    }, 'Request');
    for (const lookup of Object.keys(castBinds)) {
      const bound = Object.keys(body).filter((key) => key.endsWith('@odata.bind') && lower(key.slice(0, -'@odata.bind'.length)) === lookup);
      if (bound.length !== 1) throw refuse(`the Request create must bind ${lookup} to the cast contact exactly once.`);
    }
    return;
  }
  const requestBind = 'regardingobjectid_akoya_request@odata.bind';
  const parentBind = 'parentsiteorlocation_sharepointdocumentlocation@odata.bind';
  if (path === '/sharepointdocumentlocations'
      && lower(body?.sharepointdocumentlocationid) === lower(fence.destinationLocationId)
      && lower(body?.[requestBind]) === lower(`/akoya_requests(${fence.destinationRequestId})`)) {
    assertClosedBody(body, LOCATION_COLUMNS, (key, set, id) => (
      (key === requestBind && set === 'akoya_requests' && lower(id) === lower(fence.destinationRequestId))
      || (key === parentBind && set === 'sharepointdocumentlocations')
    ), 'Location');
    return;
  }
  throw refuse(`POST ${path} is not the destination Request or its preallocated location.`);
}

/**
 * @param {object} client lib/dataverse/client.js instance
 * @param {{ destinationRequestId: string, destinationLocationId: string, sourceRequestId: string }} fence
 */
export function fenceProductionClient(client, fence) {
  const fenced = { baseUrl: client.baseUrl };
  for (const [name, value] of Object.entries(client)) {
    if (typeof value !== 'function') continue;
    if (CLIENT_READS.has(name)) fenced[name] = value;
    else if (CLIENT_POSTS.has(name)) {
      fenced[name] = (path, body, ...rest) => {
        assertAllowedPost(path, body, fence);
        return value(path, body, ...rest);
      };
    } else {
      fenced[name] = () => { throw refuse(`${name} is not allowed in a production run.`); };
    }
  }
  return fenced;
}

/**
 * @param {object} graph GraphService-shaped object
 * @param {{ destinationRequestId: string, destinationRequestNumber: string|null, sourceRequestId: string }} fence
 */
export function fenceProductionGraph(graph, fence) {
  const folder = fence.destinationRequestNumber
    ? expectedRequestFolder(fence.destinationRequestNumber, fence.destinationRequestId)
    : null;
  const fenced = {};
  for (const [name, value] of Object.entries(graph)) {
    if (typeof value !== 'function') continue;
    if (GRAPH_READS.has(name)) fenced[name] = value;
    else if (GRAPH_FOLDER_WRITES.has(name)) {
      fenced[name] = (library, targetFolder, ...rest) => {
        if (!folder) throw refuse('no destination folder exists before the Request has its number.');
        if (library !== REQUEST_LIBRARY) throw refuse(`${name} targets library ${library}.`);
        const target = String(targetFolder ?? '');
        if (target !== folder && !target.startsWith(`${folder}/`)) throw refuse(`${name} targets a folder outside the destination.`);
        if (namesSource(target, fence.sourceRequestId)) throw refuse('a write names the source Request.');
        return value(library, targetFolder, ...rest);
      };
    } else {
      fenced[name] = () => { throw refuse(`${name} is not allowed in a production run.`); };
    }
  }
  return fenced;
}

/**
 * Status setter fence (cast-and-status plan, slice C): a second, narrower
 * fence for one status change on a ready production test Request. It admits
 * exactly one write shape, a PATCH of the destination Request whose body is
 * the one status field set to the resolved option, carrying a concrete
 * `If-Match` row version. The If-Match is load-bearing: without it a
 * Dataverse PATCH is an upsert, and a 412 is the concurrent-change signal.
 * Every other write, and any write naming the source Request, is refused.
 * The basic-run fence above is unchanged and still refuses every PATCH.
 *
 * @param {object} client lib/dataverse/client.js instance
 * @param {{ destinationRequestId: string, sourceRequestId: string, field: string, optionValue: number }} fence
 */
export function fenceStatusChangeClient(client, fence) {
  const target = `/akoya_requests(${lower(fence.destinationRequestId)})`;
  const fenced = { baseUrl: client.baseUrl };
  for (const [name, value] of Object.entries(client)) {
    if (typeof value !== 'function') continue;
    if (CLIENT_READS.has(name)) fenced[name] = value;
    else if (name === 'patchWithOptions') {
      fenced[name] = (path, body, headers = {}, ...rest) => {
        if (namesSource(path, fence.sourceRequestId) || namesSource(JSON.stringify(body ?? null), fence.sourceRequestId)) {
          throw refuse('a write names the source Request.');
        }
        if (lower(path) !== target) throw refuse(`PATCH ${path} is not the destination Request.`);
        const keys = body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body) : [];
        if (keys.length !== 1 || keys[0] !== fence.field || !Number.isInteger(body[fence.field]) || body[fence.field] !== fence.optionValue) {
          throw refuse(`the status change body must set exactly ${fence.field} to option ${fence.optionValue}.`);
        }
        const ifMatch = Object.entries(headers || {}).find(([key]) => key.toLowerCase() === 'if-match')?.[1];
        if (!/^W\/"\d{1,20}"$/.test(String(ifMatch ?? ''))) throw refuse('the status change PATCH needs a concrete If-Match row version.');
        return value(path, body, headers, ...rest);
      };
    } else {
      fenced[name] = () => { throw refuse(`${name} is not allowed in a status change.`); };
    }
  }
  return fenced;
}

function fenceClient(client, allowPost, label) {
  const fenced = { baseUrl: client.baseUrl };
  for (const [name, value] of Object.entries(client)) {
    if (typeof value !== 'function') continue;
    if (CLIENT_READS.has(name)) fenced[name] = value;
    else if (CLIENT_POSTS.has(name)) {
      fenced[name] = (path, body, ...rest) => {
        allowPost(path, body);
        return value(path, body, ...rest);
      };
    } else {
      fenced[name] = () => { throw refuse(`${name} is not allowed in ${label}.`); };
    }
  }
  return fenced;
}

// Synthetic cast creates (cast-and-status plan, slice A). A contact is created
// with no parent account, so neither body admits a bind.
export const CAST_CONTACT_COLUMNS = Object.freeze(['contactid', 'firstname', 'lastname', 'emailaddress1']);
export const CAST_PERSON_COLUMNS = Object.freeze([
  'wmkf_potentialreviewersid', 'wmkf_firstname', 'wmkf_lastname', 'wmkf_emailaddress', 'wmkf_issyntheticreviewer',
]);
const CAST_TARGETS = Object.freeze({
  contact: {
    path: '/contacts', idField: 'contactid', columns: new Set(CAST_CONTACT_COLUMNS),
    expected: (m) => ({ firstname: m.firstName, lastname: m.lastName, emailaddress1: lower(m.address) }),
  },
  wmkf_potentialreviewers: {
    path: '/wmkf_potentialreviewerses', idField: 'wmkf_potentialreviewersid', columns: new Set(CAST_PERSON_COLUMNS),
    expected: (m) => ({ wmkf_firstname: m.firstName, wmkf_lastname: m.lastName, wmkf_emailaddress: lower(m.address), wmkf_issyntheticreviewer: true }),
  },
});

/**
 * Admits exactly one POST per journaled cast member: its entity set, its
 * preallocated GUID, every column of its closed set with exactly the
 * journaled names and address (a person also the synthetic marker), no
 * binds. Reads pass; every other write is refused.
 *
 * @param {object} client lib/dataverse/client.js instance
 * @param {{ members: Array<{ memberId: string, entity: 'contact'|'wmkf_potentialreviewers', firstName: string, lastName: string, address: string }> }} fence
 */
export function fenceCastCreateClient(client, fence) {
  const members = (fence.members || []).map((m) => ({ id: lower(m.memberId), target: CAST_TARGETS[m.entity], member: m }));
  if (!members.length || members.some((m) => !m.target || !/^[0-9a-f-]{36}$/.test(m.id)
      || ![m.member.firstName, m.member.lastName, m.member.address].every((v) => typeof v === 'string' && v.length > 0))) {
    throw refuse('the cast fence needs journaled members with their names and address.');
  }
  return fenceClient(client, (path, body) => {
    const match = members.find((m) => path === m.target.path && lower(body?.[m.target.idField]) === m.id);
    if (!match) throw refuse(`POST ${path} is not a journaled cast member.`);
    assertClosedBody(body, match.target.columns, () => false, 'Cast member');
    const expected = match.target.expected(match.member);
    for (const [column, value] of Object.entries(expected)) {
      const actual = typeof value === 'string' && column.includes('email') ? lower(body[column]) : body[column];
      if (actual !== value) throw refuse(`cast member ${column} is not the journaled value.`);
    }
  }, 'a cast create');
}

// The suggested-reviewer binding (slice B), in the shape the applicant intake
// path creates (reviewer-suggestion.js ensureApplicantRecommended).
export const CAST_SUGGESTION_COLUMNS = Object.freeze([
  'wmkf_appreviewersuggestionid', 'wmkf_suggestionlabel', 'wmkf_grantcyclecode',
  'wmkf_sources', 'wmkf_selected', 'wmkf_applicantdisposition',
]);

/**
 * Admits one POST: the preallocated suggestion with the fence's label,
 * `sources` 'applicant', unselected, applicant-recommended, an optional cycle
 * code, bound to the journaled cast person and this run's destination
 * Request only.
 *
 * @param {object} client lib/dataverse/client.js instance
 * @param {{ bindingId: string, personId: string, destinationRequestId: string, label: string, sourceRequestId?: string }} fence
 */
export function fenceCastBindingClient(client, fence) {
  const columns = new Set(CAST_SUGGESTION_COLUMNS);
  return fenceClient(client, (path, body) => {
    if (namesSource(path, fence.sourceRequestId) || namesSource(JSON.stringify(body ?? null), fence.sourceRequestId)) {
      throw refuse('a write names the source Request.');
    }
    if (path !== '/wmkf_appreviewersuggestions' || lower(body?.wmkf_appreviewersuggestionid) !== lower(fence.bindingId)) {
      throw refuse(`POST ${path} is not the preallocated suggestion.`);
    }
    assertClosedBody(body, columns, (key, set, id) => (
      (key === 'wmkf_PotentialReviewer@odata.bind' && set === 'wmkf_potentialreviewerses' && lower(id) === lower(fence.personId))
      || (key === 'wmkf_Request@odata.bind' && set === 'akoya_requests' && lower(id) === lower(fence.destinationRequestId))
    ), 'Suggestion');
    if (body.wmkf_applicantdisposition !== APPLICANT_DISPOSITION_MAP.recommended) throw refuse('the suggestion must be applicant-recommended.');
    if (typeof fence.label !== 'string' || !fence.label || body.wmkf_suggestionlabel !== fence.label) throw refuse('the suggestion label is not the cast label.');
    if (body.wmkf_sources !== 'applicant') throw refuse('the suggestion sources must be exactly applicant.');
    if (body.wmkf_selected !== false) throw refuse('the suggestion must be unselected.');
    if (body.wmkf_grantcyclecode !== undefined && !/^[JD][0-9]{2}$/.test(String(body.wmkf_grantcyclecode))) throw refuse('the suggestion cycle code is not a cycle code.');
    if (!body['wmkf_PotentialReviewer@odata.bind'] || !body['wmkf_Request@odata.bind']) throw refuse('the suggestion must bind the cast person and the destination Request.');
  }, 'a cast binding');
}
