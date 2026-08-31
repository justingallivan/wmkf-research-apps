/** @jest-environment node */

import { resolveFinalWriteupPersonas } from '../../lib/services/final-writeup/persona-service.js';

const USER_ID = '10000000-0000-4000-8000-000000000001';
const PD_TEAM_ID = '20000000-0000-4000-8000-000000000001';
const LEADERSHIP_TEAM_ID = '20000000-0000-4000-8000-000000000002';

test('disabled persona rollout performs no Dataverse read', async () => {
  const getUserWithTeams = jest.fn();
  await expect(resolveFinalWriteupPersonas(USER_ID, {
    enabled: false,
    teamSpecs: [],
    getUserWithTeams,
  })).resolves.toEqual({ enabled: false, personas: [] });
  expect(getUserWithTeams).not.toHaveBeenCalled();
});

test('resolves overlapping personas only from pinned team GUID membership', async () => {
  const getUserWithTeams = jest.fn(async () => ({
    systemuserid: USER_ID,
    isdisabled: false,
    teammembership_association: [
      { teamid: PD_TEAM_ID, name: 'Renamed diagnostic label' },
      { teamid: LEADERSHIP_TEAM_ID, name: 'Another diagnostic label' },
    ],
  }));
  await expect(resolveFinalWriteupPersonas(USER_ID, {
    enabled: true,
    teamSpecs: [
      { persona: 'program-director', teamId: PD_TEAM_ID },
      { persona: 'leadership', teamId: LEADERSHIP_TEAM_ID },
      { persona: 'program-coordinator', teamId: '20000000-0000-4000-8000-000000000003' },
    ],
    getUserWithTeams,
  })).resolves.toEqual({
    enabled: true,
    personas: ['program-director', 'leadership'],
  });
});

test('enabled rollout fails closed until every exact team GUID is pinned', async () => {
  const getUserWithTeams = jest.fn();
  await expect(resolveFinalWriteupPersonas(USER_ID, {
    enabled: true,
    teamSpecs: [{ persona: 'leadership', teamId: null }],
    getUserWithTeams,
  })).rejects.toThrow('requires the exact persona team set');
  expect(getUserWithTeams).not.toHaveBeenCalled();
});

test.each([
  {
    label: 'a missing required persona',
    teamSpecs: [
      { persona: 'program-director', teamId: PD_TEAM_ID },
      { persona: 'leadership', teamId: LEADERSHIP_TEAM_ID },
    ],
  },
  {
    label: 'a duplicate persona',
    teamSpecs: [
      { persona: 'program-director', teamId: PD_TEAM_ID },
      { persona: 'program-director', teamId: LEADERSHIP_TEAM_ID },
      { persona: 'program-coordinator', teamId: '20000000-0000-4000-8000-000000000003' },
    ],
  },
  {
    label: 'an unknown persona',
    teamSpecs: [
      { persona: 'program-director', teamId: PD_TEAM_ID },
      { persona: 'program-coordinator', teamId: '20000000-0000-4000-8000-000000000003' },
      { persona: 'executive', teamId: LEADERSHIP_TEAM_ID },
    ],
  },
])('enabled rollout fails closed with $label', async ({ teamSpecs }) => {
  const getUserWithTeams = jest.fn();
  await expect(resolveFinalWriteupPersonas(USER_ID, {
    enabled: true,
    teamSpecs,
    getUserWithTeams,
  })).rejects.toThrow('requires the exact persona team set');
  expect(getUserWithTeams).not.toHaveBeenCalled();
});
