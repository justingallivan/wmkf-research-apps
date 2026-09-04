/** @jest-environment node */

import { resolveFinalWriteupPersonas } from '../../lib/services/final-writeup/persona-service.js';
import { FINAL_WRITEUP_PERSONA_LENSES_ENABLED } from '../../shared/config/finalWriteupPersonas.js';

const USER_ID = '10000000-0000-4000-8000-000000000001';
const OTHER_ID = '10000000-0000-4000-8000-000000000002';

test('persona lenses are enabled in the tracked rollout configuration', () => {
  expect(FINAL_WRITEUP_PERSONA_LENSES_ENABLED).toBe(true);
});

test('disabled persona rollout performs no setting or roster read', async () => {
  const getRuntimeState = jest.fn();
  await expect(resolveFinalWriteupPersonas(USER_ID, {
    enabled: false,
    getRuntimeState,
  })).resolves.toEqual({ enabled: false, personas: [] });
  expect(getRuntimeState).not.toHaveBeenCalled();
});

test('flag-on with a stored v1 configuration grants no persona and warns without throwing', async () => {
  await expect(resolveFinalWriteupPersonas(USER_ID, {
    enabled: true,
    getRuntimeState: jest.fn(async () => ({
      version: 1,
      assignments: [],
      reviewerIds: [USER_ID],
      warnings: ['final_writeup_persona_configuration_not_v2'],
    })),
  })).resolves.toEqual({
    enabled: true,
    personas: [],
    warnings: ['final_writeup_persona_configuration_not_v2'],
  });
});

test('resolves overlapping roles only for a current reviewer-role member', async () => {
  await expect(resolveFinalWriteupPersonas(USER_ID, {
    enabled: true,
    getRuntimeState: jest.fn(async () => ({
      version: 2,
      assignments: [
        { reviewerId: USER_ID, roles: ['program-director', 'leadership'] },
        { reviewerId: OTHER_ID, roles: ['program-coordinator'] },
      ],
      reviewerIds: [USER_ID, OTHER_ID],
      warnings: [],
    })),
  })).resolves.toEqual({
    enabled: true,
    personas: ['program-director', 'leadership'],
    warnings: [],
  });
});

test('explicit no-lens and missing assignment both narrow to no personas but remain distinguishable', async () => {
  const explicit = await resolveFinalWriteupPersonas(USER_ID, {
    enabled: true,
    getRuntimeState: jest.fn(async () => ({
      version: 2,
      assignments: [{ reviewerId: USER_ID, roles: [] }],
      reviewerIds: [USER_ID],
      warnings: [],
    })),
  });
  expect(explicit).toEqual({ enabled: true, personas: [], warnings: [] });

  const missing = await resolveFinalWriteupPersonas(USER_ID, {
    enabled: true,
    getRuntimeState: jest.fn(async () => ({
      version: 2,
      assignments: [],
      reviewerIds: [USER_ID],
      warnings: [],
    })),
  });
  expect(missing).toEqual({
    enabled: true,
    personas: [],
    warnings: ['final_writeup_persona_viewer_unassigned'],
  });
});

test('a removed or disabled reviewer cannot retain a stored persona', async () => {
  await expect(resolveFinalWriteupPersonas(USER_ID, {
    enabled: true,
    getRuntimeState: jest.fn(async () => ({
      version: 2,
      assignments: [{ reviewerId: USER_ID, roles: ['leadership'] }],
      reviewerIds: [OTHER_ID],
      warnings: ['final_writeup_persona_stale_assignments_pruned'],
    })),
  })).resolves.toEqual({
    enabled: true,
    personas: [],
    warnings: [
      'final_writeup_persona_stale_assignments_pruned',
      'final_writeup_persona_viewer_ineligible',
    ],
  });
});

test('invalid server-derived viewer identity fails before any read', async () => {
  const getRuntimeState = jest.fn();
  await expect(resolveFinalWriteupPersonas('not-a-guid', {
    enabled: true,
    getRuntimeState,
  })).rejects.toThrow(/requires a staff system-user GUID/);
  expect(getRuntimeState).not.toHaveBeenCalled();
});
