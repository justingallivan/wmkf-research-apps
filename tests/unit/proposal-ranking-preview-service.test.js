jest.mock('../../lib/services/dataverse-identity-map.js', () => ({
  resolveSystemUserToProfile: jest.fn(),
}));
jest.mock('../../lib/services/app-access-service.js', () => ({
  listAllGrantsForAdmin: jest.fn(),
}));
jest.mock('../../lib/dataverse/adapters/proposal-ranking-source.js', () => ({
  readProposalRankingSource: jest.fn(),
  readEnabledProposalRankingStaff: jest.fn(),
}));
jest.mock('../../lib/services/proposal-ranking/config.js', () => ({
  readDefaultFacilitators: jest.fn(),
}));

import { resolveSystemUserToProfile } from '../../lib/services/dataverse-identity-map.js';
import { listAllGrantsForAdmin } from '../../lib/services/app-access-service.js';
import {
  readEnabledProposalRankingStaff,
  readProposalRankingSource,
} from '../../lib/dataverse/adapters/proposal-ranking-source.js';
import { readDefaultFacilitators } from '../../lib/services/proposal-ranking/config.js';
import { buildProposalRankingPreview } from '../../lib/services/proposal-ranking/preview-service.js';

const STAFF_ID = '22222222-2222-4222-8222-222222222222';
const SECOND_FACILITATOR_ID = '33333333-3333-4333-8333-333333333333';
const PROFILE_ID = 'profile-1';
const REQUEST_ID = '11111111-1111-4111-8111-111111111111';

function setUpSource(isdisabled, institutionGeography) {
  readProposalRankingSource.mockResolvedValue({
    proposals: [{
      requestId: REQUEST_ID,
      requestNumber: '1001',
      title: 'Proposal',
      organization: 'Institute',
      institutionGeography,
      programKey: 'se',
      leadSystemUserId: STAFF_ID,
      leadSystemUser: { systemuserid: STAFF_ID, fullname: 'PD', isdisabled },
      amount: 12.34,
      currency: { id: '33333333-3333-4333-8333-333333333333', code: 'USD', name: 'US Dollar', precision: 2 },
      reviews: [],
    }],
    unexpectedStatuses: [],
    sourceRequestCount: 1,
  });
  resolveSystemUserToProfile.mockResolvedValue(PROFILE_ID);
  listAllGrantsForAdmin.mockResolvedValue([{ user_profile_id: PROFILE_ID, apps: ['proposal-ranking'] }]);
  readDefaultFacilitators.mockResolvedValue({
    systemUserIds: [STAFF_ID], source: 'legacy-scalar', settingRevision: 'r1', revision: null,
    configured: true, configurationError: false, newSettingPresent: false, newSettingMissing: true,
  });
  readEnabledProposalRankingStaff.mockResolvedValue({ systemUserId: STAFF_ID, name: 'PD', enabled: true });
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('accepts a staff identity from the actual isdisabled-only systemuser projection', async () => {
  setUpSource(false);
  const preview = await buildProposalRankingPreview('J26', {
    PROPOSAL_RANKING_ENABLED: 'on',
    PROPOSAL_RANKING_SCHEMA_READY: 'on',
    TEST_REQUEST_ISOLATION: 'on',
    SYNTHETIC_REVIEWER_ISOLATION: 'on',
  });

  expect(preview.canOpen).toBe(true);
  expect(preview.roster[0]).toMatchObject({ systemUserId: STAFF_ID, active: true, hasAppAccess: true });
});

test('freezes known geography into the preview and fingerprint; unknown values become null', async () => {
  const env = {
    PROPOSAL_RANKING_ENABLED: 'on',
    PROPOSAL_RANKING_SCHEMA_READY: 'on',
    TEST_REQUEST_ISOLATION: 'on',
    SYNTHETIC_REVIEWER_ISOLATION: 'on',
  };
  setUpSource(false, 'East');
  const east = await buildProposalRankingPreview('J26', env);
  expect(east.proposals[0].institutionGeography).toBe('East');
  expect(east.snapshot.proposals[0].institutionGeography).toBe('East');

  setUpSource(false, 'West');
  const west = await buildProposalRankingPreview('J26', env);
  expect(west.proposals[0].institutionGeography).toBe('West');
  expect(west.snapshot.proposals[0].institutionGeography).toBe('West');
  expect(west.previewFingerprint).not.toBe(east.previewFingerprint);

  setUpSource(false, 'North');
  const unknown = await buildProposalRankingPreview('J26', env);
  expect(unknown.proposals[0].institutionGeography).toBeNull();
  expect(unknown.snapshot.proposals[0].institutionGeography).toBeNull();
});

test('fails closed when the systemuser disabled state is missing', async () => {
  setUpSource(null);
  const preview = await buildProposalRankingPreview('J26', {
    PROPOSAL_RANKING_ENABLED: 'on',
    PROPOSAL_RANKING_SCHEMA_READY: 'on',
    TEST_REQUEST_ISOLATION: 'on',
    SYNTHETIC_REVIEWER_ISOLATION: 'on',
  });

  expect(preview.canOpen).toBe(false);
  expect(preview.roster[0].active).toBe(false);
  expect(preview.blockingProblems).toContain('A proposal is assigned to a staff identity that is missing or disabled. Correct the assignment before opening.');
});

test('preview captures both eligible facilitators and fingerprints the actual setting revision', async () => {
  const env = {
    PROPOSAL_RANKING_ENABLED: 'on',
    PROPOSAL_RANKING_SCHEMA_READY: 'on',
    PROPOSAL_RANKING_WORKFLOW_V2: 'on',
    TEST_REQUEST_ISOLATION: 'on',
    SYNTHETIC_REVIEWER_ISOLATION: 'on',
  };
  setUpSource(false);
  readEnabledProposalRankingStaff.mockImplementation(async (systemUserId) => ({
    systemUserId, name: systemUserId === STAFF_ID ? 'First facilitator' : 'Second facilitator', enabled: true,
  }));
  readDefaultFacilitators.mockResolvedValueOnce({
    systemUserIds: [STAFF_ID, SECOND_FACILITATOR_ID], source: 'set', settingRevision: 'set-rev-1', revision: 'set-rev-1',
    configured: true, configurationError: false, newSettingPresent: true, newSettingMissing: false,
  }).mockResolvedValueOnce({
    systemUserIds: [STAFF_ID, SECOND_FACILITATOR_ID], source: 'set', settingRevision: 'set-rev-2', revision: 'set-rev-2',
    configured: true, configurationError: false, newSettingPresent: true, newSettingMissing: false,
  });

  const first = await buildProposalRankingPreview('J26', env);
  const second = await buildProposalRankingPreview('J26', env);
  expect(first.canOpen).toBe(true);
  expect(first.facilitators.map(({ systemUserId }) => systemUserId)).toEqual([STAFF_ID, SECOND_FACILITATOR_ID]);
  expect(first.facilitation).toEqual({
    version: 1, systemUserIds: [STAFF_ID, SECOND_FACILITATOR_ID], source: 'set', settingRevision: 'set-rev-1',
  });
  expect(first.previewFingerprint).not.toBe(second.previewFingerprint);
});
