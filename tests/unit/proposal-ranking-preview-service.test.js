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
  readDefaultFacilitator: jest.fn(),
}));

import { resolveSystemUserToProfile } from '../../lib/services/dataverse-identity-map.js';
import { listAllGrantsForAdmin } from '../../lib/services/app-access-service.js';
import {
  readEnabledProposalRankingStaff,
  readProposalRankingSource,
} from '../../lib/dataverse/adapters/proposal-ranking-source.js';
import { readDefaultFacilitator } from '../../lib/services/proposal-ranking/config.js';
import { buildProposalRankingPreview } from '../../lib/services/proposal-ranking/preview-service.js';

const STAFF_ID = '22222222-2222-4222-8222-222222222222';
const PROFILE_ID = 'profile-1';
const REQUEST_ID = '11111111-1111-4111-8111-111111111111';

function setUpSource(isdisabled) {
  readProposalRankingSource.mockResolvedValue({
    proposals: [{
      requestId: REQUEST_ID,
      requestNumber: '1001',
      title: 'Proposal',
      organization: 'Institute',
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
  readDefaultFacilitator.mockResolvedValue({ systemUserId: STAFF_ID, revision: 'r1', configured: true });
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
