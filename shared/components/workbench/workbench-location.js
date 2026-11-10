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
 * J27 Research layout (2027-or-later cycle of a stage program; see
 * `isStageLayout`) adds the phase views initial-assessment | peer-review |
 * deliberations | final-assessment and these keys:
 *   scope     my                           — written only when chosen, so "no choice" can default by assignment
 *   section   reviewers                    — Peer Review: the Reviewers section
 *   showing   everything | <ending>        — All requests menu (default: open requests)
 *   standing  not-yet-scored | scored | recommended — Initial Assessment filter
 *   closed    1                            — phase tabs list closed requests too
 * An old view key opened in the new layout, or a new one opened in today's
 * layout, is mapped at render time by `resolveWorkbenchView`; the address is
 * left as the visitor wrote it.
 *
 * Every view is a shell panel; the old per-view pages redirect here.
 */

import { isJ27ScopeCycle } from '../../../lib/services/workbench/j27-read-model';

export const WORKBENCH_VIEW_KEYS = [
  'requests', 'reviewer-follow-up', 'staff-deliberations', 'initial-assessments', 'final-writeups', 'awardees',
  'initial-assessment', 'peer-review', 'deliberations', 'final-assessment',
];
export const DEFAULT_WORKBENCH_VIEW = 'requests';

/** Views rendered inside the shell page (all of them since step 4). */
export const SHELL_PANEL_VIEWS = new Set(WORKBENCH_VIEW_KEYS);

/** Every key of the shell state, for equality checks. */
export const WORKBENCH_LOCATION_KEYS = [
  'view', 'programId', 'cycleCode', 'scope', 'scopeSet', 'includeSetAside', 'reviewersView', 'search', 'writeupsView', 'pd', 'uncycled',
  'section', 'showing', 'standing', 'showClosed',
];

export const J27_SHOWING_VALUES = ['everything', 'not-scored', 'not-recommended', 'not-invited', 'offramped', 'decided-no-award', 'withdrawn', 'decided-award'];
export const J27_STANDING_VALUES = ['not-yet-scored', 'scored', 'recommended'];

/** Old view key → the new layout's tab (and section). */
const TO_STAGE_VIEW = {
  requests: { view: 'requests' },
  'reviewer-follow-up': { view: 'peer-review', section: 'reviewers' },
  'staff-deliberations': { view: 'deliberations' },
  'initial-assessments': { view: 'initial-assessment' },
  'final-writeups': { view: 'final-assessment' },
};
/** New tab key → the nearest of today's views, for an earlier cycle or another program. */
const FROM_STAGE_VIEW = {
  'initial-assessment': 'requests',
  'peer-review': 'requests',
  deliberations: 'staff-deliberations',
  'final-assessment': 'final-writeups',
};

/**
 * True when the cycle page uses the J27 phase layout: a 2027-or-later cycle
 * (the stage model's own test) of a program the server names in
 * `stageProgramIds`. No cycle literal: any later cycle qualifies.
 */
export function isStageLayoutCycle(cycleCode) {
  return isJ27ScopeCycle(cycleCode);
}
export function isStageLayout({ cycleCode, programId, stageProgramIds } = {}) {
  const id = String(programId || '').toLowerCase();
  return isStageLayoutCycle(cycleCode) && Boolean(id)
    && (stageProgramIds || []).some((candidate) => String(candidate).toLowerCase() === id);
}

/**
 * The view (and Peer Review section) to render for a location in a layout.
 * Pure and total: every known key maps to a view the layout can render.
 */
export function resolveWorkbenchView(location = {}, stageLayout = false) {
  const view = WORKBENCH_VIEW_KEYS.includes(location.view) ? location.view : DEFAULT_WORKBENCH_VIEW;
  if (stageLayout) {
    const mapped = TO_STAGE_VIEW[view];
    if (mapped) return { view: mapped.view, section: mapped.section || '' };
    return { view, section: view === 'peer-review' && location.section === 'reviewers' ? 'reviewers' : '' };
  }
  if (view === 'peer-review' && location.section === 'reviewers') return { view: 'reviewer-follow-up', section: '' };
  return { view: FROM_STAGE_VIEW[view] || view, section: '' };
}

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
  const scope = cleanString(get('scope'));
  const showing = cleanString(get('showing'));
  const standing = cleanString(get('standing'));
  return {
    view: WORKBENCH_VIEW_KEYS.includes(view) ? view : DEFAULT_WORKBENCH_VIEW,
    programId: cleanString(get('programId')),
    cycleCode: normalizeCycleCode(get('cycleCode')),
    scope: scope === 'all' ? 'all' : 'my',
    // An explicit choice, as against the default: the J27 layout opens someone
    // who leads no requests on "All in program" unless they chose otherwise.
    scopeSet: scope === 'all' || scope === 'my',
    includeSetAside: cleanString(get('setAside')) === '1',
    reviewersView: cleanString(get('reviewers')) === 'all' ? 'all' : 'attention',
    search: cleanString(get('q'), 200),
    writeupsView: WRITEUPS_VIEW_KEYS.includes(writeups) ? writeups : 'needs-review',
    // Canonical form is the lowercased GUID; anything else is dropped so the
    // stored value always equals what rows are compared against.
    pd: GUID_RE.test(pd) ? pd : '',
    uncycled: cleanString(get('uncycled')) === '1',
    section: cleanString(get('section')) === 'reviewers' ? 'reviewers' : '',
    showing: J27_SHOWING_VALUES.includes(showing) ? showing : 'open',
    standing: J27_STANDING_VALUES.includes(standing) ? standing : '',
    showClosed: cleanString(get('closed')) === '1',
  };
}

/** Build the shell href for a state; defaults are omitted so canonical links stay short. */
export function buildWorkbenchHref(state = {}) {
  const params = new URLSearchParams();
  if (state.view && state.view !== DEFAULT_WORKBENCH_VIEW) params.set('view', state.view);
  if (state.programId) params.set('programId', state.programId);
  if (state.cycleCode) params.set('cycleCode', state.cycleCode);
  if (state.scope === 'all') params.set('scope', 'all');
  else if (state.scopeSet) params.set('scope', 'my');
  if (state.includeSetAside) params.set('setAside', '1');
  if (state.reviewersView === 'all') params.set('reviewers', 'all');
  if (state.search) params.set('q', state.search);
  if (state.writeupsView && state.writeupsView !== 'needs-review') params.set('writeups', state.writeupsView);
  if (state.pd) params.set('pd', state.pd);
  if (state.uncycled) params.set('uncycled', '1');
  if (state.section === 'reviewers') params.set('section', 'reviewers');
  if (state.showing && state.showing !== 'open') params.set('showing', state.showing);
  if (state.standing) params.set('standing', state.standing);
  if (state.showClosed) params.set('closed', '1');
  const search = params.toString();
  return search ? `${WORKBENCH_PATH}?${search}` : WORKBENCH_PATH;
}
