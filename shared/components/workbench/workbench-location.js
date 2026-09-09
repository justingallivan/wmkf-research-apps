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
 *   scope     my (default) | all           — Request list rows
 *   setAside  1                            — Request list shows Set Aside rows
 *
 * Views that are not yet mounted as shell panels keep their own pages; the
 * views nav links out to them until each one moves inside the shell.
 */

export const WORKBENCH_VIEW_KEYS = ['requests', 'initial-assessments', 'reviewer-follow-up', 'final-writeups', 'awardees'];
export const DEFAULT_WORKBENCH_VIEW = 'requests';

/** Views rendered inside the shell page; the rest still link to their own pages. */
export const SHELL_PANEL_VIEWS = new Set(['requests']);

export const WORKBENCH_PATH = '/workbench';

const CYCLE_RE = /^[JD]\d{2}$/;

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
  return {
    view: WORKBENCH_VIEW_KEYS.includes(view) ? view : DEFAULT_WORKBENCH_VIEW,
    programId: cleanString(get('programId')),
    cycleCode: normalizeCycleCode(get('cycleCode')),
    scope: cleanString(get('scope')) === 'all' ? 'all' : 'my',
    includeSetAside: cleanString(get('setAside')) === '1',
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
  const search = params.toString();
  return search ? `${WORKBENCH_PATH}?${search}` : WORKBENCH_PATH;
}
