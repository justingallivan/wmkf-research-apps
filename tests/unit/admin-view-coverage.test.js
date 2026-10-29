/**
 * @jest-environment jsdom
 *
 * Characterization test for docs/plans/ADMIN_PAGE_DECOMPOSITION_PLAN_2026-10-11.md.
 * It exists to pin, for every (workspace, view) in ADMIN_WORKSPACES, the set of
 * fetch URL paths issued on first render and the sorted heading texts, so the
 * Plan C file moves cannot drop or duplicate a request or a section. Updating
 * an expectation below requires a deliberate reason noted in the plan's Stage Log.
 *
 * Every URL resolves 200 with `{}`; full URLs (query strings included) are compared, and
 * duplicates are kept so a doubled request fails.
 * Some views cannot render under a bare `{}` (they dereference arrays), so those
 * URLs return the minimal shape the existing workspace tests use:
 *   /api/admin/maintenance (MaintenanceSection, operations:jobs) -> { jobs: [] }
 *   /api/admin/models (ModelConfigSection, ai:models) -> { apps: [] }
 *   /api/cycle-calendar (CycleCalendarPanel, workflows:cycle-calendar) -> empty calendar
 * Views are rendered one at a time (AdminDashboard is not rendered here).
 */
import AppAccessContext from '../../shared/context/AppAccessContext';
import { act, render, screen } from '@testing-library/react';
import { WorkspaceContent } from '../../pages/admin';
import { ADMIN_WORKSPACES } from '../../shared/components/admin/AdminWorkspaceNavigation';

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const MINIMAL_BODIES = {
  '/api/cycle-calendar': { canEdit: false, savingAvailable: true, defaultCycleCode: null, cycles: [] },
  '/api/admin/maintenance': { jobs: [] },
  '/api/admin/models': { apps: [] },
  '/api/workbench/staffing': { staff: [], roles: { president: {}, cso: {}, grantsManager: {}, programCoordinator: {}, systemsSpecialist: {} } },
};

const EXPECTED_FETCHES = {
  'overview:summary': [
    '/api/admin/alerts',
    '/api/admin/maintenance',
    '/api/admin/secrets',
    '/api/admin/stats?period=7d',
    '/api/health',
  ],
  'operations:health': [
    '/api/admin/health-history?hours=24',
    '/api/health',
  ],
  'operations:incidents': [
    '/api/admin/alerts',
    '/api/admin/operational-events?status=open',
  ],
  'operations:jobs': [
    '/api/admin/maintenance',
  ],
  'operations:credentials': [
    '/api/admin/secrets',
  ],
  'operations:notifications': [
    '/api/admin/alert-recipients',
  ],
  'operations:feedback': [
    '/api/dynamics-explorer/feedback?status=new',
  ],
  'operations:dynamics-safeguards': [
    '/api/dynamics-explorer/restrictions',
  ],
  'workflows:external-review': [
    '/api/admin/honorarium-amount',
    '/api/admin/reviewer-time-budget',
    '/api/review-manager/campaign-timeline-defaults',
    '/api/review-manager/release-settings',
  ],
  'workflows:review-form': [
    '/api/admin/review-questions',
  ],
  'workflows:cycle-calendar': ['/api/cycle-calendar'],
  'workflows:proposal-ranking': [
    '/api/app-access',
  ],
  'workflows:final-writeups': [],
  'people:staffing': ['/api/admin/final-writeup-matrix-audiences', '/api/workbench/staffing'],
  'workflows:site-visits': [
    '/api/admin/meeting-tracker-defaults',
    '/api/admin/site-visit-materials-defaults',
    '/api/admin/site-visit-recipients',
  ],
  'workflows:governance': [
    '/api/admin/email-defaults',
    '/api/admin/policies',
  ],
  'test-requests:preview': [
    '/api/admin/test-requests/email-allowlist',
    '/api/admin/test-requests/runs',
  ],
  'ai:usage': [
    '/api/admin/stats?period=30d',
  ],
  'ai:models': [
    '/api/admin/models',
  ],
  'ai:prompts': [
    '/api/admin/executor-budgets',
    '/api/admin/models',
    '/api/admin/prompts',
  ],
  'people:roles': [
    '/api/dynamics-explorer/roles',
    '/api/user-profiles?all=true',
  ],
  'people:app-access': [
    '/api/app-access?all=true',
  ],
  'people:identity': [
    '/api/user-profiles?all=true',
  ],
};

const EXPECTED_HEADINGS = {
  'overview:summary': [
    'Common destinations',
    'Needs attention',
  ],
  'operations:health': [
    'Health Check History',
    'Service Health',
  ],
  'operations:incidents': [
    'Operational Events',
    'System Alerts',
  ],
  'operations:jobs': [
    'Maintenance Jobs',
  ],
  'operations:credentials': [
    'Credential resources',
    'Secret Expiration Tracking',
  ],
  'operations:notifications': [
    'System alert recipients',
  ],
  'operations:feedback': [
    'Dynamics Explorer Feedback',
  ],
  'operations:dynamics-safeguards': [
    'Dynamics Explorer data safeguards',
  ],
  'workflows:external-review': [
    'Campaign timeline',
    'External review defaults',
    'Reviewer discovery time budget',
    'Reviewer honorarium',
    'Reviewer materials release',
  ],
  'workflows:review-form': [
    'External review form',
  ],
  'workflows:cycle-calendar': [],
  'workflows:proposal-ranking': [
    'Proposal Ranking facilitators',
  ],
  'workflows:final-writeups': ['Final Writeup staffing'],
  'people:staffing': ['Final Writeup staffing', 'Program review audiences', 'Related assignments', 'Shared roles', 'Staff responsibilities'],
  'workflows:site-visits': [
    'Consultants and Board',
    'Materials defaults',
    'Meeting Tracker default attendees',
    'Site Visit recipient directory',
    'Staff',
  ],
  'workflows:governance': [
    'Workflow email defaults',
    'Workflow policies',
  ],
  'test-requests:preview': [
    'Basic Request clone preview',
    'Create a test Request',
    'Test-request email allowlist',
    'Your runs',
  ],
  'ai:usage': [
    'API Usage',
  ],
  'ai:models': [
    'AI resources',
    'Model routing',
  ],
  'ai:prompts': [
    'Prompts and execution budgets',
  ],
  'people:roles': [
    'Users and Dynamics Explorer roles',
  ],
  'people:app-access': [
    'Application access',
  ],
  'people:identity': [
    'Dataverse identity linkage',
  ],
};

const settle = async () => {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  }
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe('admin view coverage', () => {
  for (const ws of ADMIN_WORKSPACES) {
    for (const view of ws.views) {
      const id = `${ws.key}:${view.key}`;
      it(`renders ${id} with its pinned fetch set and headings`, async () => {
        const urls = [];
        global.fetch = jest.fn((url) => {
          urls.push(String(url));
          return Promise.resolve(jsonResponse(200, MINIMAL_BODIES[String(url).split('?')[0]] || {}));
        });
        await act(async () => {
          render(<AppAccessContext.Provider value={{ isSuperuser: true }}><WorkspaceContent workspace={ws.key} view={view.key} /></AppAccessContext.Provider>);
        });
        await settle();
        const fetched = urls.slice().sort(); // full URLs, duplicates kept: a doubled fetch must fail
        const headings = screen.queryAllByRole('heading').map((h) => h.textContent.trim()).sort();
        expect(fetched).toEqual(EXPECTED_FETCHES[id]);
        expect(headings).toEqual(EXPECTED_HEADINGS[id]);
      });
    }
  }
});
