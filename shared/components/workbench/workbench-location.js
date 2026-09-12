/**
 * Request Workbench shell location — the URL is the single source of truth
 * for which view is open and which program/cycle/filters it shows, so the
 * browser's back button and shared links land on exactly what the PD saw.
 *
 * Query keys (all optional; absent = default):
 *   view      requests (default) | initial-assessments | reviewer-follow-up | final-writeups | awardees
 *   programId Grant Program GUID; absent = the server's default program
 *   cycleCode Jyy/Dyy; absent = the working cycle for the program (resolved
 *             by the dashboard cycle list, then written back with replace)
 *   scope     my (default) | all           — request scope (Request list, Reviewer follow-up, Awardees)
 *   setAside  1                            — Request list shows Set Aside rows
 *   reviewers attention (default) | all    — Reviewer follow-up reviewer-state view
 *   q         free text                    — search box of the open view (follow-up, Final writeups)
 *   writeups  needs-review (default) | reviewed | all — Final writeups view
 *   pd        Program Director GUID        — Final writeups filter (canonical lowercase)
 *   uncycled  1                            — Final writeups: rows with no meeting date
 *
 * Every view is a shell panel; the old per-view pages redirect here.
 */

export const WORKBENCH_VIEW_KEYS = ['requests', 'reviewer-follow-up', 'staff-deliberations', 'initial-assessments', 'final-writeups', 'awardees'];
export const DEFAULT_WORKBENCH_VIEW = 'requests';

/** Views rendered inside the shell page (all of them since step 4). */
export const SHELL_PANEL_VIEWS = new Set(WORKBENCH_VIEW_KEYS);

/** Every key of the shell state, for equality checks. */
export const WORKBENCH_LOCATION_KEYS = ['view', 'programId', 'cycleCode', 'scope', 'includeSetAside', 'reviewersView', 'search', 'writeupsView', 'pd', 'uncycled'];

export const WRITEUPS_VIEW_KEYS = ['needs-review', 'reviewed', 'all'];

export const WORKBENCH_PATH = '/workbench';

const CYCLE_RE = /^[JD]\d{2}$/;
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

function cleanString(value, max = 64) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > max ? '' : text;
}

export function normalizeCycleCode(value) {
  const code = cleanString(first(value), 8).toUpperCase();
  return CYCLE_RE.test(code) ? code : '';
}

/** Parse a Next.js router query (or URLSearchParams-like object) into shell state. */
export function readWorkbenchQuery(query = {}) {
  const get = (key) => (typeof query.get === 'function' ? query.get(key) : first(query[key]));
  const view = cleanString(get('view'));
  const writeups = cleanString(get('writeups'));
  const pd = cleanString(get('pd')).toLowerCase();
  return {
    view: WORKBENCH_VIEW_KEYS.includes(view) ? view : DEFAULT_WORKBENCH_VIEW,
    programId: cleanString(get('programId')),
    cycleCode: normalizeCycleCode(get('cycleCode')),
    scope: cleanString(get('scope')) === 'all' ? 'all' : 'my',
    includeSetAside: cleanString(get('setAside')) === '1',
    reviewersView: cleanString(get('reviewers')) === 'all' ? 'all' : 'attention',
    search: cleanString(get('q'), 200),
    writeupsView: WRITEUPS_VIEW_KEYS.includes(writeups) ? writeups : 'needs-review',
    // Canonical form is the lowercased GUID; anything else is dropped so the
    // stored value always equals what rows are compared against.
    pd: GUID_RE.test(pd) ? pd : '',
    uncycled: cleanString(get('uncycled')) === '1',
  };
}

/** Build the shell href for a state; defaults are omitted so canonical links stay short. */
export function buildWorkbenchHref(state = {}) {
  const params = new URLSearchParams();
  if (state.view && state.view !== DEFAULT_WORKBENCH_VIEW) params.set('view', state.view);
  if (state.programId) params.set('programId', state.programId);
  if (state.cycleCode) params.set('cycleCode', state.cycleCode);
  if (state.scope === 'all') params.set('scope', 'all');
  if (state.includeSetAside) params.set('setAside', '1');
  if (state.reviewersView === 'all') params.set('reviewers', 'all');
  if (state.search) params.set('q', state.search);
  if (state.writeupsView && state.writeupsView !== 'needs-review') params.set('writeups', state.writeupsView);
  if (state.pd) params.set('pd', state.pd);
  if (state.uncycled) params.set('uncycled', '1');
  const search = params.toString();
  return search ? `${WORKBENCH_PATH}?${search}` : WORKBENCH_PATH;
}
