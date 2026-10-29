/**
 * Landing cycle: the cycle every app opens on, set by the Grants Manager in the
 * cycle calendar (alignment log D29; docs/plans/LANDING_CYCLE_PLAN_2026-10-29.md).
 *
 * Stored as the app setting `cycle.landing_cycle` (a modern code, or empty for
 * "not set"). Written by the app's service principal like every other app
 * setting, with the editor recorded in `wmkf_UpdatedBy`; editors are the
 * calendar's editors (`canEditCalendar`). Unset means every app keeps its own
 * date rule.
 *
 * `getLandingCycle` is the only reader app defaults use. It re-validates the
 * stored value on every call (pattern, then an exact-code Grant Cycle lookup)
 * under one short total deadline, and returns `{ code: null, reason }` on any
 * timeout, error or invalid value, so a settings problem never blocks a page.
 */

import * as cycles from '../dataverse/adapters/operations-grant-cycle.js';
import { getSettingStrict, listSettingsWithMetaStrict, setSettingIfUnchanged } from './settings-service.js';
import { canEditCalendar } from './cycle-calendar-service.js';
import { ServiceHttpError } from './service-http-error.js';
import { CYCLE_PREFIX as BOARD_CYCLE_PREFIX } from './board-writeups/model.js';
import { conventionalCycles, resolveWorkingCycle } from '../utils/cycle-code.js';
import { CYCLE_CALENDAR_BOARD_DATE, CYCLE_CODE_PATTERN, dateOnly } from '../../shared/config/cycleCalendar.js';

export const LANDING_CYCLE_KEY = 'cycle.landing_cycle';
export const LANDING_READ_DEADLINE_MS = 1500;

const DEFAULTS = {
  getSettingStrict,
  listSettingsWithMetaStrict,
  setSettingIfUnchanged,
  findCycleByCode: cycles.findCycleByCode,
  listModernCycles: cycles.listModernCycles,
  canEditCalendar,
  now: () => new Date(),
  log: (reason, detail) => console.warn(`[landing-cycle] ${reason}${detail ? `: ${detail}` : ''}`),
};

function fail(code, message, status) {
  throw new ServiceHttpError(message, { code, httpStatus: status, body: { error: message, code } });
}

function normalizeCode(value) {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return CYCLE_CODE_PATTERN.test(code) ? code : null;
}

function isBlank(value) {
  return value === null || value === undefined || (typeof value === 'string' && !value.trim());
}

function pacificToday(now) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Resolves with `fallback` after `ms`; the timer never keeps the process alive. */
function deadline(ms, fallback) {
  let timer;
  const promise = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
    timer.unref?.();
  });
  return { promise, cancel: () => clearTimeout(timer) };
}

/**
 * @returns {Promise<{ code: string|null, reason: string|null }>} `reason` is null
 *   when the setting is simply unset or valid.
 */
export async function getLandingCycle({ deadlineMs = LANDING_READ_DEADLINE_MS } = {}, overrides = {}) {
  const d = { ...DEFAULTS, ...overrides };
  const startedAt = Date.now();
  const remaining = () => Math.max(1, deadlineMs - (Date.now() - startedAt));
  const work = (async () => {
    let row;
    try {
      row = await d.getSettingStrict(LANDING_CYCLE_KEY, { timeoutMs: remaining() });
    } catch (error) {
      return { code: null, reason: 'landing_setting_error', detail: error?.message };
    }
    if (!row?.found || isBlank(row.value)) return { code: null, reason: null };
    const code = normalizeCode(row.value);
    if (!code) return { code: null, reason: 'landing_setting_invalid' };
    try {
      if (!(await d.findCycleByCode(code, { timeoutMs: remaining() }))) {
        return { code: null, reason: 'landing_cycle_missing', detail: code };
      }
    } catch (error) {
      return { code: null, reason: 'landing_validation_error', detail: error?.message };
    }
    return { code, reason: null };
  })();
  const timeout = deadline(deadlineMs, { code: null, reason: 'landing_setting_timeout' });
  try {
    const result = await Promise.race([work, timeout.promise]);
    if (result.reason) d.log(result.reason, result.detail);
    return { code: result.code, reason: result.reason };
  } finally {
    timeout.cancel();
  }
}

/** The editor's view: stored value, its status, who set it, and the cycles to choose from. */
export async function loadLandingCycleEditor(actor, overrides = {}) {
  const d = { ...DEFAULTS, ...overrides };
  let meta, stored, rows;
  const canEdit = await d.canEditCalendar(actor);
  try {
    [meta, stored, rows] = await Promise.all([
      d.listSettingsWithMetaStrict(LANDING_CYCLE_KEY),
      d.getSettingStrict(LANDING_CYCLE_KEY),
      d.listModernCycles(),
    ]);
  } catch {
    fail('landing_unavailable', 'The landing cycle is unavailable. Reload and try again.', 503);
  }
  const options = rows
    .filter((row) => CYCLE_CODE_PATTERN.test(row.wmkf_cyclecode || ''))
    .map((row) => ({
      code: row.wmkf_cyclecode,
      name: row.wmkf_name || row.wmkf_cyclecode,
      boardDate: dateOnly(row[CYCLE_CALENDAR_BOARD_DATE.column]),
    }))
    .sort((a, b) => String(a.boardDate || '9999').localeCompare(String(b.boardDate || '9999')));
  const raw = stored?.found ? stored.value : null;
  const code = normalizeCode(raw);
  let status = 'active';
  if (isBlank(raw)) status = 'unset';
  else if (!code) status = 'invalid';
  else if (!options.some((option) => option.code === code)) status = 'missing';
  const row = meta?.[LANDING_CYCLE_KEY] || null;
  return {
    landingCycleCode: status === 'active' ? code : null,
    storedValue: isBlank(raw) ? null : String(raw).trim(),
    status,
    setBy: row?.updatedByName || null,
    setAt: row?.updatedAt || null,
    revision: stored?.revision || null,
    canEdit,
    cycles: options,
  };
}

/** Save `{ cycleCode, revision }`; `cycleCode: null` clears the setting. */
export async function saveLandingCycle(actor, body, overrides = {}) {
  const d = { ...DEFAULTS, ...overrides };
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('landing_body_invalid', 'Unsupported landing cycle request.', 400);
  const keys = Object.keys(body);
  if (keys.some((key) => !['cycleCode', 'revision'].includes(key))) fail('landing_body_invalid', 'Unsupported landing cycle request.', 400);
  const { cycleCode = null, revision = null } = body;
  if (cycleCode !== null && (typeof cycleCode !== 'string' || !CYCLE_CODE_PATTERN.test(cycleCode))) {
    fail('landing_cycle_invalid', 'Choose a cycle from the list.', 400);
  }
  if (revision !== null && (typeof revision !== 'string' || !/^W\/"\d{1,20}"$/.test(revision))) {
    fail('landing_revision_invalid', 'Reload the calendar before saving.', 400);
  }
  if (!(await d.canEditCalendar(actor))) {
    fail('landing_edit_denied', 'Only the Grants Manager, the Program Coordinator or an administrator can change the landing cycle.', 403);
  }
  if (cycleCode && !(await d.findCycleByCode(cycleCode))) {
    fail('landing_cycle_missing', 'That cycle is not in the Grant Cycle table. Reload the calendar.', 404);
  }
  try {
    await d.setSettingIfUnchanged(LANDING_CYCLE_KEY, cycleCode || '', revision, actor.profileId);
  } catch (error) {
    if (error?.code === 'setting_conflict') {
      fail('landing_conflict', 'Someone else changed the landing cycle. The latest value is shown; choose again if needed.', 409);
    }
    throw error;
  }
  return loadLandingCycleEditor(actor, overrides);
}

/**
 * Default cycle for the Board pages: the landing cycle when it has a Board setup
 * with an end date; otherwise the earliest such setup whose end date is today or
 * later by the Pacific calendar day; otherwise the latest one; with none, the
 * conventional date rule. Never throws: any read problem falls back to the rule.
 */
export async function resolveBoardDefaultCycle(overrides = {}) {
  const d = { ...DEFAULTS, ...overrides };
  const now = d.now();
  const conventional = () => resolveWorkingCycle(conventionalCycles(now), now);
  let landing, rows;
  try {
    const timeout = deadline(LANDING_READ_DEADLINE_MS, null);
    [landing, rows] = await Promise.all([
      getLandingCycle({}, overrides),
      Promise.race([d.listSettingsWithMetaStrict(BOARD_CYCLE_PREFIX), timeout.promise]).finally(timeout.cancel),
    ]);
  } catch (error) {
    d.log('board_default_error', error?.message);
    return conventional();
  }
  if (!rows) {
    d.log('board_default_timeout');
    return conventional();
  }
  const candidates = [];
  for (const [key, row] of Object.entries(rows)) {
    const code = normalizeCode(key.slice(BOARD_CYCLE_PREFIX.length));
    let boardEnds = null;
    try { boardEnds = JSON.parse(row.value)?.boardEnds; } catch { /* unreadable setup is not a candidate */ }
    if (code && typeof boardEnds === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(boardEnds)) candidates.push({ code, boardEnds });
  }
  if (!candidates.length) return conventional();
  if (landing.code && candidates.some((candidate) => candidate.code === landing.code)) return landing.code;
  candidates.sort((a, b) => a.boardEnds.localeCompare(b.boardEnds));
  const today = pacificToday(now);
  return (candidates.find((candidate) => candidate.boardEnds >= today) || candidates[candidates.length - 1]).code;
}
