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
 *  - `updateCycleDates` — PATCH date columns of one row with `If-Match`,
 *    impersonating the acting staff member with no service-principal
 *    fallback, so audit history names the person.
 *  - `getChangeHistory` — per-row `RetrieveRecordChangeHistory` (the bulk
 *    `/audits` query is 403 for this app; per-record reads are 200 elsewhere,
 *    docs/DATAVERSE_POWER_TOOLS_DESIGN.md).
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
 * @returns {Promise<object[]>} raw AuditDetails entries (newest first as returned)
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
  return body?.AuditDetailCollection?.AuditDetails || [];
}

export const ENTITY_SET_NAME = ENTITY_SET;
