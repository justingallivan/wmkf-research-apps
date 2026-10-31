/** Pure, bounded contracts for Research Board release and archival. */
import { isGuid } from '../../utils/guid.js';
import { ServiceHttpError } from '../service-http-error.js';
export const PROGRAM_ID = 'c247b11a-a7cb-ee11-9078-000d3a341e8f';
export const MAX_REQUESTS = 100;
export const MAX_BYTES = 10 * 1024 * 1024;
export const ROLE_KEYS = Object.freeze({ president: 'board_writeups.president', cso: 'board_writeups.cso', grantsManager: 'board_writeups.grants_manager', programCoordinator: 'board_writeups.program_coordinator', systemsSpecialist: 'board_writeups.systems_specialist' });
/** Roles a Board cycle needs before activation; the others are central assignments only. */
export const BOARD_ACTIVATION_ROLES = Object.freeze(['president', 'cso', 'grantsManager']);
/** Roles any active staff member may hold without Reviewer app access. */
export const ANY_STAFF_ROLES = Object.freeze(['president', 'programCoordinator', 'systemsSpecialist']);
export const CYCLE_PREFIX = 'board_writeups.cycle.';
export function fail(code, message = code, status = 409) {
  throw new ServiceHttpError(message, { code, httpStatus: status, body: { error: message, code } });
}
export function cycleCode(value) {
  if (typeof value !== 'string' || !/^[JD]\d{2}$/.test(value)) fail('board_cycle_invalid', 'Choose a valid Board cycle.', 400);
  return value;
}
export function guid(value) {
  if (!isGuid(value)) fail('board_identity_invalid', 'An identity is invalid.', 400);
  return value.toLowerCase();
}
export function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) {
    fail('board_fields_invalid', 'The request contains unsupported fields.', 400);
  }
}
/** Setups saved before D47 carry typed dates; the calendar replaced them, so reads drop them. */
export const LEGACY_DATE_KEYS = Object.freeze(['materialsDue', 'boardEnds']);
export function withoutLegacyDates(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const rest = { ...value };
  for (const key of LEGACY_DATE_KEYS) delete rest[key];
  return rest;
}
export function validateCycle(value) {
  exact(value, ['version', 'cycle', 'programId', 'active', 'rosterConfirmed', 'requestIds', 'adminId']);
  if (value.version !== 1 || value.programId !== PROGRAM_ID || typeof value.active !== 'boolean'
    || typeof value.rosterConfirmed !== 'boolean') fail('board_configuration_invalid', 'Board setup is invalid.', 400);
  cycleCode(value.cycle);
  if (!Array.isArray(value.requestIds) || value.requestIds.length > MAX_REQUESTS) fail('board_roster_invalid', 'Choose at most 100 requests.', 400);
  const requestIds = value.requestIds.map(guid);
  if (new Set(requestIds).size !== requestIds.length || (value.rosterConfirmed && !requestIds.length)) fail('board_roster_invalid', 'The confirmed list must contain distinct requests.', 400);
  if (value.active && (!value.rosterConfirmed || !value.adminId)) fail('board_setup_incomplete', 'Confirm the request list and the admin recipient before activation.', 400);
  return { ...value, requestIds, adminId: value.adminId === null ? null : guid(value.adminId) };
}
export function validateRole(value) {
  exact(value, ['version', 'systemUserId']);
  if (value.version !== 1) fail('board_role_invalid', 'Unsupported role configuration.', 400);
  return { version: 1, systemUserId: value.systemUserId === null ? null : guid(value.systemUserId) };
}
export function filename(number, institution) {
  if (!/^\d{1,20}$/.test(String(number || '')) || !String(institution || '').trim()) fail('board_filename_missing');
  const name = String(institution).normalize('NFC').replace(/["*:<>?\/\\|\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '').slice(0, 150);
  if (!name) fail('board_filename_missing');
  return `${number} - ${name} - Writeup.docx`;
}
export function pacificTime(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now)).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}
/** Calendar days, not elapsed hours: the reminder stays at 9 a.m. across DST.
 * `dates` are the calendar dates (`cycleDates`); a null Board date is never due. */
export function cleanupStatus(dates, state, now = Date.now()) {
  const end = dates?.boardEnds || null;
  const dueDate = end ? new Date(Date.parse(end) + 7 * 86400000).toISOString().slice(0, 10) : null;
  const completedAt = state.cleanupCompletedAt || null;
  return { dueDate, completedAt, completedBy: state.cleanupCompletedBy?.name || null,
    due: Boolean(dueDate && pacificTime(now).date >= dueDate && !completedAt) };
}
export function progress(config, state) {
  const released = config.requestIds.filter(id => state.releases[id]?.releasedAt);
  return { expected: config.requestIds.length, released: released.length, outstanding: config.requestIds.filter(id => !released.includes(id)), complete: config.rosterConfirmed && config.requestIds.length > 0 && released.length === config.requestIds.length };
}

/** Only an actual response to the single PUT can establish a definite refusal.
 * 404/410, timeouts, 5xx and missing responses remain unknown, never replayable.
 */
export function uploadRefusal(error, at) {
  const status = Number(error?.status);
  return [400, 401, 403, 409, 412, 413, 415, 422].includes(status)
    ? { status, code: error.code || 'graph_upload_refused', at } : null;
}
