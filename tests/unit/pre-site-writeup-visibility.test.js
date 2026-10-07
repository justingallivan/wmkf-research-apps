/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';
import {
  canChangeDraftWriteup, canSeeDraftWriteup, isDraftWriteupLifecycle, redactDraftWriteup, resolveWriteupViewer,
} from '../../lib/services/pre-site-visit/writeup-visibility';
import { REQUEST_DOCUMENT_LIFECYCLE_STATE } from '../../shared/config/requestDocument';

const LEAD = 'AAAAAAAA-0000-4000-8000-000000000001';
const OTHER = 'bbbbbbbb-0000-4000-8000-000000000002';
const { DRAFT, REVIEW, FINAL } = REQUEST_DOCUMENT_LIFECYCLE_STATE;
const personas = (list) => ({ resolvePersonas: jest.fn(async () => ({ enabled: true, personas: list })) });

describe('resolveWriteupViewer', () => {
  test('a Program Coordinator persona makes the viewer a coordinator', async () => {
    const viewer = await resolveWriteupViewer({ actingUserSystemId: OTHER }, personas(['program-coordinator']));
    expect(viewer).toEqual({ isSuperuser: false, actingUserSystemId: OTHER, isCoordinator: true });
  });

  test.each([
    ['a PD-only persona', personas(['program-director'])],
    ['disabled lenses', { resolvePersonas: jest.fn(async () => ({ enabled: false, personas: ['program-coordinator'] })) }],
    ['an unreadable staffing setting', { resolvePersonas: jest.fn(async () => { throw new Error('setting unavailable'); }) }],
  ])('fails closed to not-a-coordinator for %s', async (_label, dependencies) => {
    const viewer = await resolveWriteupViewer({ actingUserSystemId: OTHER }, dependencies);
    expect(viewer.isCoordinator).toBe(false);
  });

  test('an unlinked account never resolves personas and cannot match a lead', async () => {
    const dependencies = personas(['program-coordinator']);
    const viewer = await resolveWriteupViewer({ actingUserSystemId: null }, dependencies);
    expect(dependencies.resolvePersonas).not.toHaveBeenCalled();
    expect(viewer).toEqual({ isSuperuser: false, actingUserSystemId: null, isCoordinator: false });
    expect(canSeeDraftWriteup(viewer, LEAD)).toBe(false);
  });

  test('a superuser skips persona resolution', async () => {
    const dependencies = personas([]);
    const viewer = await resolveWriteupViewer({ isSuperuser: true, actingUserSystemId: OTHER }, dependencies);
    expect(viewer.isSuperuser).toBe(true);
    expect(dependencies.resolvePersonas).not.toHaveBeenCalled();
  });
});

describe('draft visibility and change rights', () => {
  const lead = { isSuperuser: false, actingUserSystemId: LEAD.toLowerCase(), isCoordinator: false };
  const other = { isSuperuser: false, actingUserSystemId: OTHER, isCoordinator: false };
  const coordinator = { ...other, isCoordinator: true };
  const superuser = { isSuperuser: true, actingUserSystemId: null, isCoordinator: false };

  test.each([
    ['lead PD (case-insensitive)', lead, true, true],
    ['other staff', other, false, false],
    ['Program Coordinator', coordinator, true, false],
    ['superuser', superuser, true, true],
    ['no viewer', null, false, false],
  ])('%s: sees %s, changes %s', (_label, viewer, sees, changes) => {
    expect(canSeeDraftWriteup(viewer, LEAD)).toBe(sees);
    expect(canChangeDraftWriteup(viewer, LEAD)).toBe(changes);
  });

  test('a request with no lead PD is visible only to coordinators and superusers', () => {
    expect(canSeeDraftWriteup({ ...other, actingUserSystemId: null }, null)).toBe(false);
    expect(canSeeDraftWriteup(coordinator, null)).toBe(true);
    expect(canChangeDraftWriteup(superuser, null)).toBe(true);
  });

  test('redaction removes the file only for draft lifecycles the viewer cannot see', () => {
    const artifact = (lifecycleState) => ({ artifactId: 'x', lifecycleState, file: { webUrl: 'https://sp.test/w.docx' } });
    expect(redactDraftWriteup(artifact(DRAFT), other, LEAD)).toEqual({ ...artifact(DRAFT), file: null, fileHidden: true });
    expect(redactDraftWriteup(artifact(REVIEW), other, LEAD)).toEqual({ ...artifact(REVIEW), file: null, fileHidden: true });
    expect(redactDraftWriteup(artifact(FINAL), other, LEAD)).toEqual(artifact(FINAL));
    expect(redactDraftWriteup(artifact(REVIEW), lead, LEAD)).toEqual(artifact(REVIEW));
    expect(redactDraftWriteup(artifact(REVIEW), coordinator, LEAD)).toEqual(artifact(REVIEW));
    expect(redactDraftWriteup(null, other, LEAD)).toBeNull();
    expect(isDraftWriteupLifecycle(FINAL)).toBe(false);
  });
});

// The denominator: every server surface that can return the Pre-Site file
// (2026-10-06 exposure survey). A new surface must be added here deliberately.
test.each([
  ['pages/api/workbench/pre-site-visit.js', ['redactDraftWriteup', 'canChangeDraftWriteup', 'resolveWriteupViewer']],
  ['pages/api/workbench/pre-site-visit/start-site-visit.js', ['canChangeDraftWriteup', 'resolveWriteupViewer']],
  ['pages/api/workbench/final-writeup.js', ['resolveWriteupViewer']],
  ['lib/services/final-writeup/transition-service.js', ['canSeeDraftWriteup']],
  ['pages/api/workbench/staff-deliberations.js', ['resolveWriteupViewer']],
  ['lib/services/pre-site-visit/cycle-list-service.js', ['canSeeDraftWriteup']],
  ['pages/api/workbench/site-visit/logistics.js', ['resolveWriteupViewer']],
  ['lib/services/site-visit/logistics-service.js', ['canSeeDraftWriteup']],
])('%s routes through writeup visibility', (file, symbols) => {
  const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
  for (const symbol of symbols) expect(source).toContain(symbol);
});
