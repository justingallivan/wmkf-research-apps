/**
 * Request-page phase admission: one server policy for the request context and
 * the four new field routes (rollout plan "Admission to implement"; owner
 * decisions 2026-11-13: a Dataverse setting changed by an owner-run script,
 * pilot mode kept, separate from the cycle page's `WORKBENCH_PHASE_RELEASE`).
 *
 * The cohort lives in the app setting `workbench.phase_rollout`, a JSON object
 * of exactly one of these forms:
 *   {"mode":"off"}
 *   {"mode":"pilot","requestIds":["<request GUID>", ...]}   (1 to 200 GUIDs)
 *   {"mode":"on"}
 * Written only by `scripts/set-workbench-phase-rollout.cjs` (revision-checked,
 * records the editor in `wmkf_UpdatedBy`).
 *
 * Reading it:
 * - Every call reads the setting again; nothing is cached across requests.
 * - The read has a short deadline. A failed, timed-out, invalid or
 *   unrecognised value resolves to off.
 * - An absent setting is off in a Production deployment. Elsewhere it is on,
 *   which keeps the sandbox Preview and local behaviour as before; an
 *   explicit value is honoured everywhere, so off and pilot can be rehearsed.
 *
 * A request is admitted when all of these hold:
 *   the cycle page release gate (`workbenchPhaseReleaseAdmitted`),
 *   the deployment has the fields (`reviewSummaryFieldsReady`, plus the
 *     route's own field for a route),
 *   its linked Grant Cycle is 2027 or later, from a fresh server read,
 *   and the setting admits it.
 * The request context checks the cycle from its own read
 * (`resolve-request-service.js`). The routes check everything else before the
 * field service runs; each field service then reads the request fresh and
 * refuses one whose linked cycle is before 2027 (404), and calls the route's
 * `beforeWrite` re-check just before its conditional write.
 */
import { getSettingStrict } from '../settings-service.js';
import { classifyDeployment } from '../../dataverse/core/interlock.js';
import { isGuid } from '../../utils/guid.js';
import { workbenchPhaseReleaseAdmitted } from '../../utils/workbench-phase-release.js';
import { reviewSummaryFieldsReady } from '../../utils/workbench-field-readiness.js';
import { isJ27ScopeCycle } from './j27-read-model.js';

export const PHASE_ROLLOUT_KEY = 'workbench.phase_rollout';
export const PHASE_ROLLOUT_READ_DEADLINE_MS = 1500;
export const PHASE_ROLLOUT_MAX_PILOT_REQUESTS = 200;

const OFF = Object.freeze({ mode: 'off', requestIds: Object.freeze([]) });
const ON = Object.freeze({ mode: 'on', requestIds: Object.freeze([]) });

const DEFAULTS = {
  getSettingStrict,
  classifyDeployment,
  workbenchPhaseReleaseAdmitted,
  reviewSummaryFieldsReady,
  log: (reason) => console.warn(`[phase-admission] ${reason}`),
};

/**
 * Parse a stored setting value. Returns the rollout, or null for anything
 * that is not exactly one of the three forms.
 * @param {unknown} value
 */
export function parsePhaseRollout(value) {
  if (typeof value !== 'string') return null;
  let parsed;
  try { parsed = JSON.parse(value); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const keys = Object.keys(parsed).sort().join(',');
  if (keys === 'mode' && parsed.mode === 'off') return OFF;
  if (keys === 'mode' && parsed.mode === 'on') return ON;
  if (keys === 'mode,requestIds' && parsed.mode === 'pilot') {
    const ids = parsed.requestIds;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > PHASE_ROLLOUT_MAX_PILOT_REQUESTS) return null;
    if (!ids.every(isGuid)) return null;
    return Object.freeze({ mode: 'pilot', requestIds: Object.freeze([...new Set(ids.map((id) => id.trim().toLowerCase()))]) });
  }
  return null;
}

/** Read the rollout setting once, under a short deadline. Never throws. */
export async function readPhaseRollout(deps = DEFAULTS) {
  let timer;
  try {
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('setting read timed out')), PHASE_ROLLOUT_READ_DEADLINE_MS + 250);
      timer.unref?.();
    });
    const result = await Promise.race([
      deps.getSettingStrict(PHASE_ROLLOUT_KEY, { timeoutMs: PHASE_ROLLOUT_READ_DEADLINE_MS }),
      deadline,
    ]);
    if (!result?.found) return deps.classifyDeployment() === 'production' ? OFF : ON;
    const rollout = parsePhaseRollout(result.value);
    if (!rollout) deps.log('setting value is not a recognised form; treating as off');
    return rollout || OFF;
  } catch (error) {
    deps.log(`setting read failed (${error?.message || 'unknown'}); treating as off`);
    return OFF;
  } finally {
    clearTimeout(timer);
  }
}

/** Whether a rollout admits this request id (cycle not considered). */
export function rolloutAdmitsRequest(rollout, requestId) {
  if (rollout?.mode === 'on') return true;
  if (rollout?.mode === 'pilot') {
    return Array.isArray(rollout.requestIds) && isGuid(requestId) && rollout.requestIds.includes(requestId.trim().toLowerCase());
  }
  return false;
}

const NONE = () => false;

/**
 * One rollout read for one server read (a request context or a cycle list),
 * returning `(requestId, cycleCode) => boolean`. `cycleCode` must come from
 * the caller's fresh server read of the request's linked cycle. Without the
 * release gate or the fields, every request is refused and nothing is read.
 * The same predicate decides the request page's phase layout and whether a
 * row's stage may use the new fields (`deriveJ27ForRow`), so the two cannot
 * disagree within one response.
 */
export async function loadPhaseAdmission(deps = DEFAULTS) {
  if (!deps.workbenchPhaseReleaseAdmitted() || !deps.reviewSummaryFieldsReady()) return NONE;
  const rollout = await readPhaseRollout(deps);
  return (requestId, cycleCode) => isJ27ScopeCycle(cycleCode) && rolloutAdmitsRequest(rollout, requestId);
}

/** One request: is the phase layout on? Reads the setting only for a 2027-or-later cycle. */
export async function resolvePhaseAdmission({ requestId, cycleCode }, deps = DEFAULTS) {
  if (!isJ27ScopeCycle(cycleCode)) return false;
  return (await loadPhaseAdmission(deps))(requestId, cycleCode);
}

/**
 * Field routes, on every GET and POST and again before a save: the release
 * gate, the route's own field, and the setting. The cycle half is the field
 * service's own fresh read (see the module header).
 * @param {string} requestId
 * @param {() => boolean} fieldReady
 */
export async function phaseRouteAdmitted(requestId, fieldReady, deps = DEFAULTS) {
  if (!deps.workbenchPhaseReleaseAdmitted() || !fieldReady()) return false;
  return rolloutAdmitsRequest(await readPhaseRollout(deps), requestId);
}
