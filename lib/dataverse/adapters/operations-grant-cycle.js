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
 */

import { DynamicsService } from '../../services/dynamics-service.js';
import { API_TIMEOUT } from '../../services/dynamics/constants.js';
import { fetchWithTimeout } from '../../services/dynamics/http.js';
import { entitySet } from '../core/entity-registry.js';
import * as odata from '../core/odata.js';
import { isGuid } from '../../utils/guid.js';
import { CYCLE_CALENDAR_BOARD_DATE, CYCLE_CALENDAR_DATE_COLUMNS } from '../../../shared/config/cycleCalendar.js';

const ENTITY_SET = entitySet('wmkf_grantcycles');

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
 * One cycle's calendar dates (Board date plus every editable date column), in
 * one bounded request. Throws on a failed read; returns null when no row has
 * that code.
 *
 * @param {string} cycleCode modern code (`^[JD]\d{2}$`)
 * @param {{ timeoutMs?: number }} options
 * @returns {Promise<object|null>}
 */
export async function getCycleDatesByCode(cycleCode, { timeoutMs = API_TIMEOUT } = {}) {
  if (typeof cycleCode !== 'string' || !/^[JD]\d{2}$/.test(cycleCode)) {
    throw new Error('operations-grant-cycle: cycle code must be a modern J/D code');
  }
  const resourceUrl = process.env.DYNAMICS_URL;
  if (!resourceUrl) throw new Error('DYNAMICS_URL not set');
  const params = new URLSearchParams({
    $select: ['wmkf_cyclecode', CYCLE_CALENDAR_BOARD_DATE.column, ...CYCLE_CALENDAR_DATE_COLUMNS.map(({ column }) => column)].join(','),
    $filter: odata.eq('wmkf_cyclecode', cycleCode),
    $top: '2',
  });
  const token = await DynamicsService.getAccessToken();
  const response = await fetchWithTimeout(
    `${resourceUrl}/api/data/v9.2/${ENTITY_SET}?${params.toString()}`,
    { headers: DynamicsService.buildHeaders(token) },
    timeoutMs,
  );
  if (!response.ok) {
    throw Object.assign(new Error(`Grant cycle dates read failed (${response.status}).`), { status: response.status });
  }
  const body = await response.json();
  if (!Array.isArray(body?.value)) throw new Error('Grant cycle dates response has no value array.');
  if (body.value.length > 1) throw new Error(`More than one Grant Cycle row has code ${cycleCode}.`);
  return body.value[0] || null;
}

/**
 * @param {{ timeoutMs?: number }} options
 * @returns {Promise<{ wmkf_cyclecode: string, wmkf_meetingdate: string|null }[]>}
 */
export async function listBoardDates({ timeoutMs = API_TIMEOUT } = {}) {
  const resourceUrl = process.env.DYNAMICS_URL;
  if (!resourceUrl) throw new Error('DYNAMICS_URL not set');
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
