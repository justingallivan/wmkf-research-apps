jest.mock('../../lib/services/settings-service.js', () => ({
  getSettingStrict: jest.fn(),
  setSettingIfUnchanged: jest.fn(),
}));
jest.mock('../../lib/services/proposal-ranking/test-policy.js', () => ({
  getRankingTestPolicy: jest.fn(() => ({ requested: false, enabled: false })),
  RANKING_TEST_FACILITATOR_NAMES: ['Beth Pruitt', 'Justin Gallivan'],
}));
jest.mock('../../lib/dataverse/adapters/proposal-ranking-source.js', () => ({
  listEnabledProposalRankingStaff: jest.fn(),
}));

import { getSettingStrict, setSettingIfUnchanged } from '../../lib/services/settings-service.js';
import { getRankingTestPolicy } from '../../lib/services/proposal-ranking/test-policy.js';
import { listEnabledProposalRankingStaff } from '../../lib/dataverse/adapters/proposal-ranking-source.js';
import {
  DEFAULT_FACILITATOR_SETTING_KEY,
  DEFAULT_FACILITATORS_SETTING_KEY,
  readDefaultFacilitators,
  saveDefaultFacilitators,
} from '../../lib/services/proposal-ranking/config.js';
import {
  normalizeFacilitatorIds,
  parseFacilitationSettingValue,
  resolveRoundFacilitation,
} from '../../lib/services/proposal-ranking/facilitation.js';

const BETH = 'a1111111-1111-4111-8111-111111111111';
const JUSTIN = 'b2222222-2222-4222-8222-222222222222';

beforeEach(() => jest.clearAllMocks());

test('facilitator setting accepts one or two canonical unique GUIDs and rejects malformed complements', () => {
  expect(normalizeFacilitatorIds([JUSTIN, BETH])).toEqual([BETH, JUSTIN]);
  expect(parseFacilitationSettingValue({ version: 1, systemUserIds: [BETH] })).toEqual({ version: 1, systemUserIds: [BETH] });
  for (const value of [[], [BETH, BETH], [BETH.toUpperCase()], ['not-a-guid'], [BETH, JUSTIN, BETH], [null]]) {
    expect(normalizeFacilitatorIds(value)).toBeNull();
  }
  expect(parseFacilitationSettingValue({ version: 2, systemUserIds: [BETH] })).toBeNull();
  expect(parseFacilitationSettingValue({ version: 1, systemUserIds: [BETH], extra: true })).toBeNull();
});

test('new setting takes precedence and malformed-present never falls back to legacy', async () => {
  getSettingStrict.mockImplementation(async (key) => key === DEFAULT_FACILITATORS_SETTING_KEY
    ? { found: true, value: '{bad json', revision: 'new-rev' }
    : { found: true, value: BETH, revision: 'legacy-rev' });

  await expect(readDefaultFacilitators()).rejects.toMatchObject({ status: 503 });
  expect(getSettingStrict).toHaveBeenCalledTimes(1);
  await expect(readDefaultFacilitators({ allowInvalid: true })).resolves.toMatchObject({
    configurationError: true, newSettingPresent: true, revision: 'new-rev', systemUserIds: [],
  });
});

test('legacy fallback preserves its source revision while reporting the missing new-key revision', async () => {
  getSettingStrict.mockImplementation(async (key) => key === DEFAULT_FACILITATORS_SETTING_KEY
    ? { found: false }
    : { found: true, value: BETH, revision: 'legacy-rev' });

  await expect(readDefaultFacilitators()).resolves.toMatchObject({
    configured: true, source: 'legacy-scalar', systemUserIds: [BETH],
    settingRevision: 'legacy-rev', revision: null, newSettingMissing: true,
  });
  expect(getSettingStrict).toHaveBeenCalledWith(DEFAULT_FACILITATOR_SETTING_KEY);
});

test('missing round facilitation falls back only to that round scalar; present malformed never falls back', () => {
  expect(resolveRoundFacilitation({}, JUSTIN)).toEqual({
    version: 1, systemUserIds: [JUSTIN], source: 'legacy-round', settingRevision: null,
  });
  expect(() => resolveRoundFacilitation({ facilitation: null }, JUSTIN)).toThrow('The round facilitator configuration is invalid.');
  expect(() => resolveRoundFacilitation({ facilitation: { version: 1, systemUserIds: [JUSTIN], source: 'set', settingRevision: 'r1', extra: true } }, JUSTIN))
    .toThrow('The round facilitator configuration is invalid.');
  expect(() => resolveRoundFacilitation({ facilitation: { version: 1, systemUserIds: [BETH, JUSTIN], source: 'legacy-round', settingRevision: null } }, JUSTIN))
    .toThrow('The round facilitator configuration is invalid.');
});

test('Admin save writes only the versioned set to the new key', async () => {
  setSettingIfUnchanged.mockResolvedValue({});
  await saveDefaultFacilitators([JUSTIN, BETH], 'etag', 'profile');
  expect(setSettingIfUnchanged).toHaveBeenCalledWith(
    DEFAULT_FACILITATORS_SETTING_KEY,
    JSON.stringify({ version: 1, systemUserIds: [BETH, JUSTIN] }),
    'etag',
    'profile',
  );
});

test('isolated test policy resolves both approved facilitator names from enabled staff records', async () => {
  getRankingTestPolicy.mockReturnValue({ requested: true, enabled: true });
  listEnabledProposalRankingStaff.mockResolvedValue([
    { systemUserId: BETH, name: 'Beth Pruitt' },
    { systemUserId: JUSTIN, name: 'Justin Gallivan' },
  ]);
  await expect(readDefaultFacilitators()).resolves.toMatchObject({
    systemUserIds: [BETH, JUSTIN], source: 'set', settingRevision: 'ranking-test-v1',
  });
  expect(getSettingStrict).not.toHaveBeenCalled();
});
