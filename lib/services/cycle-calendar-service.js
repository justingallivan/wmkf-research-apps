/**
 * Cycle calendar service (alignment log D43;
 * docs/plans/CYCLE_CALENDAR_DATAVERSE_PLAN_2026-10-28.md).
 *
 * Reads the recent operations Grant Cycle rows and their per-date change
 * history, and saves one date column at a time. Any signed-in staff member may
 * view; a superuser or the staff member assigned to the Grants Manager or
 * Program Coordinator role may edit (D7, D8). Role eligibility does not
 * require Reviewer app access (the Program Coordinator may lack it).
 *
 * Saves impersonate the editor with no service-principal fallback and refuse
 * outright when impersonation is not configured, so Dataverse audit history
 * names the person who changed the date.
 */

import * as cycles from '../dataverse/adapters/operations-grant-cycle.js';
import { eligibleStaff, getRole } from './board-writeups/config.js';
import { ServiceHttpError } from './service-http-error.js';
import {
  CYCLE_CALENDAR_BOARD_DATE,
  CYCLE_CALENDAR_DATE_COLUMNS,
  CYCLE_CALENDAR_EDITABLE,
  CYCLE_CODE_PATTERN,
  dateOnly,
} from '../../shared/config/cycleCalendar.js';

const DEFAULTS = {
  listModernCycles: cycles.listModernCycles,
  updateCycleDates: cycles.updateCycleDates,
  getChangeHistory: cycles.getChangeHistory,
  eligibleStaff,
  getRole,
  impersonationEnabled: () => process.env.DYNAMICS_IMPERSONATION_ENABLED === 'true',
  now: () => new Date(),
};

/** Cycles whose Board date is within this many days in the past stay listed. */
const RECENT_PAST_DAYS = 365;
const TRACKED = new Set([CYCLE_CALENDAR_BOARD_DATE.column, ...CYCLE_CALENDAR_EDITABLE]);

function fail(code, message, status) {
  throw new ServiceHttpError(message, { code, httpStatus: status, body: { error: message, code } });
}

function pacificToday(now) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function shiftDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Superuser or assigned Grants Manager / Program Coordinator; false on any doubt. */
export async function canEditCalendar(actor, overrides = {}) {
  const d = { ...DEFAULTS, ...overrides };
  if (!actor?.systemUserId || !actor?.profileId) return false;
  try {
    const staff = await d.eligibleStaff(actor.systemUserId, { app: false });
    if (staff.profileId !== actor.profileId) return false;
    if (staff.isSuperuser) return true;
    const [manager, coordinator] = await Promise.all([d.getRole('grantsManager'), d.getRole('programCoordinator')]);
    return [manager, coordinator].some(role => role.value?.systemUserId && role.value.systemUserId === staff.systemUserId);
  } catch {
    return false;
  }
}

/**
 * Latest change per tracked column from RetrieveRecordChangeHistory details.
 * Shape verified against production (scripts/probe-audit-history-shape.cjs,
 * 2026-10-28): AttributeAuditDetail entries carry AuditRecord.createdon and
 * the formatted _userid_value. A cleared date appears only in OldValue, so
 * both sides are inspected. Entries that change no tracked column (e.g. the
 * entry recorded when auditing was enabled) are ignored. History is reported
 * incomplete — never silently blank — when a tracked change lacks who/when or
 * the collection is paged.
 */
export function latestChanges(details, { moreRecords = false } = {}) {
  const latest = new Map();
  let complete = !moreRecords;
  for (const detail of details || []) {
    const record = detail?.AuditRecord;
    const columns = new Set([...Object.keys(detail?.NewValue || {}), ...Object.keys(detail?.OldValue || {})]
      .filter(key => !key.includes('@') && TRACKED.has(key)));
    if (!columns.size) continue;
    const changedBy = record?.['_userid_value@OData.Community.Display.V1.FormattedValue'] || null;
    if (!record?.createdon || !changedBy) { complete = false; continue; }
    for (const column of columns) {
      const seen = latest.get(column);
      if (seen && seen.changedAt >= record.createdon) continue;
      latest.set(column, { changedAt: record.createdon, changedBy });
    }
  }
  return { changes: latest, complete };
}

export async function loadCalendar(actor, overrides = {}) {
  const d = { ...DEFAULTS, ...overrides };
  const today = pacificToday(d.now());
  const cutoff = shiftDays(today, -RECENT_PAST_DAYS);
  const rows = (await d.listModernCycles())
    .filter(row => CYCLE_CODE_PATTERN.test(row.wmkf_cyclecode || ''))
    .map(row => ({ row, boardDate: dateOnly(row[CYCLE_CALENDAR_BOARD_DATE.column]) }))
    .filter(({ boardDate }) => !boardDate || boardDate >= cutoff)
    .sort((a, b) => String(a.boardDate || '9999').localeCompare(String(b.boardDate || '9999')));

  const [canEdit, histories] = await Promise.all([
    canEditCalendar(actor, d),
    Promise.all(rows.map(({ row }) => d.getChangeHistory(row.wmkf_grantcycleid).then(
      ({ details, moreRecords }) => {
        const { changes, complete } = latestChanges(details, { moreRecords });
        // Incomplete history shows no per-date claims; the row-level change stands in.
        return complete ? { ok: true, changes } : { ok: false, changes: new Map() };
      },
      () => ({ ok: false, changes: new Map() }),
    ))),
  ]);

  const list = rows.map(({ row, boardDate }, index) => {
    const { ok, changes } = histories[index];
    const entry = ({ column, label }) => ({
      column,
      label,
      value: dateOnly(row[column]),
      changedAt: changes.get(column)?.changedAt || null,
      changedBy: changes.get(column)?.changedBy || null,
    });
    return {
      id: row.wmkf_grantcycleid,
      code: row.wmkf_cyclecode,
      name: row.wmkf_name || row.wmkf_cyclecode,
      etag: row._etag || null,
      boardDate,
      historyAvailable: ok,
      rowModifiedAt: row.modifiedon || null,
      rowModifiedBy: row._modifiedby_value_formatted || null,
      board: entry(CYCLE_CALENDAR_BOARD_DATE),
      dates: CYCLE_CALENDAR_DATE_COLUMNS.map(entry),
    };
  });
  const upcoming = list.find(cycle => cycle.boardDate && cycle.boardDate >= today);
  return {
    canEdit,
    savingAvailable: d.impersonationEnabled(),
    defaultCycleCode: (upcoming || list[list.length - 1])?.code || null,
    cycles: list,
  };
}

function validDate(value) {
  if (value === null) return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export async function saveDate(actor, input, overrides = {}) {
  const d = { ...DEFAULTS, ...overrides };
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !['cycleCode', 'column', 'value', 'etag'].includes(key))) {
    fail('calendar_fields_invalid', 'The request contains unsupported fields.', 400);
  }
  const { cycleCode, column, value, etag } = input;
  if (typeof cycleCode !== 'string' || !CYCLE_CODE_PATTERN.test(cycleCode)) fail('calendar_cycle_invalid', 'Choose a valid cycle.', 400);
  if (typeof column !== 'string' || !CYCLE_CALENDAR_EDITABLE.has(column)) fail('calendar_column_invalid', 'That date cannot be edited here.', 400);
  if (!validDate(value)) fail('calendar_date_invalid', 'Enter a valid date.', 400);
  if (typeof etag !== 'string' || !/^W\/"\d{1,20}"$/.test(etag)) fail('calendar_etag_invalid', 'Reload the calendar before saving.', 400);
  if (!d.impersonationEnabled()) {
    fail('calendar_saving_unavailable', 'Saving is unavailable because changes could not be attributed to you. Ask an administrator to check the Dynamics identity settings.', 503);
  }
  if (!(await canEditCalendar(actor, d))) fail('calendar_edit_denied', 'Only the Grants Manager, the Program Coordinator or an administrator can change cycle dates.', 403);

  const row = (await d.listModernCycles()).find(candidate => candidate.wmkf_cyclecode === cycleCode);
  if (!row) fail('calendar_cycle_missing', 'That cycle no longer exists. Reload the calendar.', 404);
  try {
    await d.updateCycleDates(row.wmkf_grantcycleid, etag, { [column]: value }, { actingUserSystemId: actor.systemUserId });
  } catch (error) {
    if (error?.status === 412) fail('calendar_conflict', 'This cycle changed since you opened it. Reload to see the latest dates.', 409);
    if (error?.status === 403) fail('calendar_dataverse_denied', 'You do not have permission to change this date in Dataverse.', 403);
    throw error;
  }
  return loadCalendar(actor, d);
}
