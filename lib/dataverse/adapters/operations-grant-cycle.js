/**
 * Adapter: wmkf_grantcycles, the operations Grant Cycle table (one row per
 * Board cycle; rows are created by Connor's process when the GOApply portal
 * opens). Distinct from `grant-cycle.js`, which wraps the apps table
 * `wmkf_appgrantcycles`.
 *
 * Owner decision D43 (2026-10-28): this table is the authoritative home for
 * the cycle milestone dates it carries, edited from the apps' cycle calendar
 * (docs/plans/CYCLE_CALENDAR_DATAVERSE_PLAN_2026-10-28.md).
 *
 * Named operations:
 *  - `listModernCycles` — rows whose code starts with J or D, with the
 *    calendar date columns and the row ETag; callers keep only `^[JD]\d{2}$`.
 *  - `findCycleByCode` — one exact-code row (id and code only) with a caller
 *    deadline; the landing-cycle reader uses it to confirm a code still exists
 *    without paging the whole calendar.
 *  - `getCycleDatesById` — the date columns of the one row a request's Grant
 *    Cycle link points to, with a caller deadline; reviewer invitations read
 *    the Reviews Due Date from it (D48).
 *  - `listBoardDates` — every J/D row's code and Board date only, one bounded
 *    request with a caller deadline; the automatic landing cycle reads it.
 *  - `updateCycleDates` — PATCH date columns of one row with `If-Match`,
 *    impersonating the acting staff member with no service-principal
 *    fallback, so audit history names the person.
 *  - `getChangeHistory` — per-row `RetrieveRecordChangeHistory`, the only
 *    audit route open to this app: `/audits` filtered to one object is 403
 *    (scripts/probe-audit-history-shape.cjs, 2026-10-28). Returns the details
 *    and the collection's `MoreRecords` flag; callers treat a paged result as
 *    incomplete rather than guess the order.
 *
 * A request's cycle is the row its Grant Cycle link points to
 * (`akoya_request.wmkf_grantcycle`), never its meeting date
 * (docs/plans/MEETING_DATE_RETIREMENT_PLAN_2026-10-29.md). Link helpers for
 * request reads:
 *  - `linkedCycleFilter` — `$filter` fragment for requests linked to one cycle.
 *  - `linkedCycleExpand` — `$expand` value carrying the linked row's code.
 *  - `linkedCycleCode` — the modern code read from an expanded request row.
 *
 * Restriction checks: a request query's own check sees a table-level block on
 * this table through the expand name, but not a field-level block on
 * `wmkf_cyclecode` and not a navigation filter at all
 * (`lib/services/dynamics/restrictions.js`). Every read here, and each link
 * helper before it returns a filter or expand, checks this table explicitly.
 */

import { DynamicsService } from '../../services/dynamics-service.js';
import { API_TIMEOUT } from '../../services/dynamics/constants.js';
import { fetchWithTimeout } from '../../services/dynamics/http.js';
import { entitySet } from '../core/entity-registry.js';
import * as odata from '../core/odata.js';
import { isGuid } from '../../utils/guid.js';
import { CYCLE_CALENDAR_BOARD_DATE, CYCLE_CALENDAR_DATE_COLUMNS, CYCLE_CODE_PATTERN } from '../../../shared/config/cycleCalendar.js';

const ENTITY_SET = entitySet('wmkf_grantcycles');
// Logical name for restriction checks; the entity set is not in the transport's
// known-set map, so `resolveLogicalName` would return the plural.
const LOGICAL_NAME = 'wmkf_grantcycle';
const LINK_NAVIGATION = 'wmkf_GrantCycle';

/** The request's Grant Cycle lookup value column (row id of the linked cycle). */
export const LINKED_CYCLE_ID_FIELD = '_wmkf_grantcycle_value';

function checkCycleRestriction(select) {
  DynamicsService.checkRestriction(LOGICAL_NAME, select);
}

function modernCode(cycleCode) {
  if (typeof cycleCode !== 'string' || !CYCLE_CODE_PATTERN.test(cycleCode)) {
    throw new Error('operations-grant-cycle: cycle code must be a modern J/D code');
  }
  return cycleCode;
}

/** Throws when the caller's restrictions block reading a linked cycle's code. */
export function assertLinkedCycleReadable() {
  checkCycleRestriction('wmkf_grantcycleid,wmkf_cyclecode');
}

/**
 * `$filter` fragment selecting requests linked to one cycle. Checks the
 * restriction on this table first.
 * @param {string} cycleCode modern code (`^[JD]\d{2}$`)
 */
export function linkedCycleFilter(cycleCode) {
  const code = modernCode(cycleCode);
  assertLinkedCycleReadable();
  return odata.eq(`${LINK_NAVIGATION}/wmkf_cyclecode`, code);
}

/**
 * `$filter` fragment for requests with no cycle: no link, or a link to a
 * historical (non-J/D) row — the same requests `linkedCycleCode` returns null
 * for. Checks the restriction on this table first.
 */
export function noLinkedCycleFilter() {
  assertLinkedCycleReadable();
  const code = `${LINK_NAVIGATION}/wmkf_cyclecode`;
  return `(${LINKED_CYCLE_ID_FIELD} eq null or not (${odata.startsWith(code, 'J')} or ${odata.startsWith(code, 'D')}))`;
}

/** `$expand` value that returns the linked row's code. Checks the restriction on this table first. */
export function linkedCycleExpand() {
  assertLinkedCycleReadable();
  return `${LINK_NAVIGATION}($select=wmkf_cyclecode)`;
}

/**
 * The modern cycle code of the row a request links to, from a request read
 * with `linkedCycleExpand()`. No link, or a historical (non-J/D) code, is null:
 * the request has no cycle.
 * @param {object|null|undefined} request
 * @returns {string|null}
 */
export function linkedCycleCode(request) {
  const code = request?.[LINK_NAVIGATION]?.wmkf_cyclecode;
  return typeof code === 'string' && CYCLE_CODE_PATTERN.test(code) ? code : null;
}

/**
 * `linkedCycleExpand()` plus the linked row's calendar Board date. Checks the
 * restriction on this table, Board date included, first.
 */
export function linkedCycleBoardDateExpand() {
  checkCycleRestriction(`wmkf_grantcycleid,wmkf_cyclecode,${CYCLE_CALENDAR_BOARD_DATE.column}`);
  return `${LINK_NAVIGATION}($select=wmkf_cyclecode,${CYCLE_CALENDAR_BOARD_DATE.column})`;
}

/**
 * The calendar Board date of the cycle a request links to, from a request read
 * with `linkedCycleBoardDateExpand()`. Null when the request has no cycle (see
 * `linkedCycleCode`) or the row has no Board date.
 * @param {object|null|undefined} request
 * @returns {string|null}
 */
export function linkedCycleBoardDate(request) {
  if (!linkedCycleCode(request)) return null;
  const date = request[LINK_NAVIGATION][CYCLE_CALENDAR_BOARD_DATE.column];
  return typeof date === 'string' && date.trim() !== '' ? date : null;
}

export const OPERATIONS_GRANT_CYCLE_SELECT = [
  'wmkf_grantcycleid',
  'wmkf_cyclecode',
  'wmkf_name',
  CYCLE_CALENDAR_BOARD_DATE.column,
  ...CYCLE_CALENDAR_DATE_COLUMNS.map(({ column }) => column),
  'modifiedon',
  '_modifiedby_value',
].join(',');

/** @returns {Promise<object[]>} processed rows (with `_etag` and `_formatted` fields). */
export async function listModernCycles() {
  checkCycleRestriction(OPERATIONS_GRANT_CYCLE_SELECT);
  const result = await DynamicsService.queryAllRecords(ENTITY_SET, {
    select: OPERATIONS_GRANT_CYCLE_SELECT,
    filter: odata.or([odata.startsWith('wmkf_cyclecode', 'J'), odata.startsWith('wmkf_cyclecode', 'D')]),
  });
  return result.records || [];
}

/**
 * @param {string} cycleCode modern code (`^[JD]\d{2}$`)
 * @param {{ timeoutMs?: number }} options
 * @returns {Promise<{ wmkf_grantcycleid: string, wmkf_cyclecode: string } | null>}
 */
export async function findCycleByCode(cycleCode, { timeoutMs = API_TIMEOUT } = {}) {
  if (typeof cycleCode !== 'string' || !/^[JD]\d{2}$/.test(cycleCode)) {
    throw new Error('operations-grant-cycle: cycle code must be a modern J/D code');
  }
  const resourceUrl = process.env.DYNAMICS_URL;
  if (!resourceUrl) throw new Error('DYNAMICS_URL not set');
  checkCycleRestriction('wmkf_grantcycleid,wmkf_cyclecode');
  const params = new URLSearchParams({
    $select: 'wmkf_grantcycleid,wmkf_cyclecode',
    $filter: odata.eq('wmkf_cyclecode', cycleCode),
    $top: '1',
  });
  const token = await DynamicsService.getAccessToken();
  const response = await fetchWithTimeout(
    `${resourceUrl}/api/data/v9.2/${ENTITY_SET}?${params.toString()}`,
    { headers: DynamicsService.buildHeaders(token) },
    timeoutMs,
  );
  if (!response.ok) {
    throw Object.assign(new Error(`Grant cycle lookup failed (${response.status}).`), { status: response.status });
  }
  const body = await response.json();
  return body?.value?.[0] || null;
}

/**
 * The calendar dates (code, Board date and every editable date column) of the
 * Grant Cycle row a request links to (`akoya_request._wmkf_grantcycle_value`),
 * in one bounded request. Throws on a failed read; returns null when no row has
 * that id.
 *
 * @param {string} grantCycleId `wmkf_grantcycleid` GUID
 * @param {{ timeoutMs?: number }} options
 * @returns {Promise<object|null>}
 */
export async function getCycleDatesById(grantCycleId, { timeoutMs = API_TIMEOUT } = {}) {
  if (!isGuid(grantCycleId)) {
    throw new Error('operations-grant-cycle: grant cycle id must be a GUID');
  }
  const resourceUrl = process.env.DYNAMICS_URL;
  if (!resourceUrl) throw new Error('DYNAMICS_URL not set');
  const select = ['wmkf_grantcycleid', 'wmkf_cyclecode', CYCLE_CALENDAR_BOARD_DATE.column, ...CYCLE_CALENDAR_DATE_COLUMNS.map(({ column }) => column)].join(',');
  checkCycleRestriction(select);
  const params = new URLSearchParams({ $select: select });
  const token = await DynamicsService.getAccessToken();
  const response = await fetchWithTimeout(
    `${resourceUrl}/api/data/v9.2/${ENTITY_SET}(${grantCycleId})?${params.toString()}`,
    { headers: DynamicsService.buildHeaders(token) },
    timeoutMs,
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw Object.assign(new Error(`Grant cycle dates read failed (${response.status}).`), { status: response.status });
  }
  const body = await response.json();
  if (!body || typeof body !== 'object') throw new Error('Grant cycle dates response has no row.');
  return body;
}

/**
 * @param {{ timeoutMs?: number }} options
 * @returns {Promise<{ wmkf_cyclecode: string, wmkf_meetingdate: string|null }[]>}
 */
export async function listBoardDates({ timeoutMs = API_TIMEOUT } = {}) {
  const resourceUrl = process.env.DYNAMICS_URL;
  if (!resourceUrl) throw new Error('DYNAMICS_URL not set');
  checkCycleRestriction(`wmkf_cyclecode,${CYCLE_CALENDAR_BOARD_DATE.column}`);
  const params = new URLSearchParams({
    $select: `wmkf_cyclecode,${CYCLE_CALENDAR_BOARD_DATE.column}`,
    $filter: odata.or([odata.startsWith('wmkf_cyclecode', 'J'), odata.startsWith('wmkf_cyclecode', 'D')]),
    $top: '500',
  });
  const token = await DynamicsService.getAccessToken();
  const response = await fetchWithTimeout(
    `${resourceUrl}/api/data/v9.2/${ENTITY_SET}?${params.toString()}`,
    { headers: DynamicsService.buildHeaders(token) },
    timeoutMs,
  );
  if (!response.ok) {
    throw Object.assign(new Error(`Grant cycle Board dates read failed (${response.status}).`), { status: response.status });
  }
  const body = await response.json();
  if (!Array.isArray(body?.value)) throw new Error('Grant cycle Board dates response has no value array.');
  if (body['@odata.nextLink']) throw new Error('Grant cycle Board dates response was paged.');
  return body.value;
}

/**
 * `listBoardDates` for cycle lists: when the calendar read fails, no dates, so
 * the list still loads and its default cycle resolves by month instead of the
 * exact Board day. A restriction refusal still throws.
 * @returns {Promise<{ wmkf_cyclecode: string, wmkf_meetingdate: string|null }[]>}
 */
export async function listBoardDatesOrNone() {
  checkCycleRestriction(`wmkf_cyclecode,${CYCLE_CALENDAR_BOARD_DATE.column}`);
  try {
    return await listBoardDates();
  } catch (error) {
    console.warn('[operations-grant-cycle] Board dates unavailable; cycle default falls back to month:', error?.message || error);
    return [];
  }
}

/**
 * @param {string} cycleId  GUID of the row
 * @param {string} etag     `_etag` from the read the editor saw
 * @param {object} patch    date columns only (the service enforces the allowlist)
 * @param {{ actingUserSystemId: string }} options
 */
export function updateCycleDates(cycleId, etag, patch, { actingUserSystemId }) {
  if (!isGuid(cycleId)) throw new Error('operations-grant-cycle: cycle id must be a GUID');
  if (!etag) throw new Error('operations-grant-cycle: an ETag is required');
  if (!actingUserSystemId) throw new Error('operations-grant-cycle: an acting staff member is required');
  return DynamicsService.updateRecord(ENTITY_SET, cycleId, patch, {
    ifMatch: etag,
    actingUserSystemId,
    noFallback: true,
  });
}

/**
 * @param {string} cycleId GUID of the row
 * @returns {Promise<{ details: object[], moreRecords: boolean }>}
 */
export async function getChangeHistory(cycleId) {
  if (!isGuid(cycleId)) throw new Error('operations-grant-cycle: cycle id must be a GUID');
  const resourceUrl = process.env.DYNAMICS_URL;
  if (!resourceUrl) throw new Error('DYNAMICS_URL not set');
  const target = encodeURIComponent(JSON.stringify({ '@odata.id': `${ENTITY_SET}(${cycleId})` }));
  const token = await DynamicsService.getAccessToken();
  const response = await fetchWithTimeout(
    `${resourceUrl}/api/data/v9.2/RetrieveRecordChangeHistory(Target=@t)?@t=${target}`,
    { headers: { ...DynamicsService.buildHeaders(token), Prefer: 'odata.include-annotations="OData.Community.Display.V1.FormattedValue"' } },
    API_TIMEOUT,
  );
  if (!response.ok) {
    throw Object.assign(new Error(`Grant cycle change history read failed (${response.status}).`), { status: response.status });
  }
  const body = await response.json();
  const collection = body?.AuditDetailCollection;
  if (!collection || !Array.isArray(collection.AuditDetails)) {
    throw new Error('Grant cycle change history response has no AuditDetails collection.');
  }
  return { details: collection.AuditDetails, moreRecords: collection.MoreRecords === true };
}

export const ENTITY_SET_NAME = ENTITY_SET;
