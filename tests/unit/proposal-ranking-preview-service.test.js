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


test('history is frozen and fingerprinted without changing scores, seed order or requested amounts', async () => {
  const env = { PROPOSAL_RANKING_ENABLED: 'on', PROPOSAL_RANKING_SCHEMA_READY: 'on', TEST_REQUEST_ISOLATION: 'on', SYNTHETIC_REVIEWER_ISOLATION: 'on' };
  setUpSource(false, 'West');
  const source = await readProposalRankingSource();
  source.proposals[0].reviews = [{ received: true, synthetic: false, answer: { answerValue: 5, answerText: 'Excellent' } }];
  source.proposals.push({ ...source.proposals[0], requestId: 'another-request', requestNumber: '1002', reviews: [{ received: true, synthetic: false, answer: { answerValue: 3, answerText: 'Good' } }] });
  const base = await buildProposalRankingPreview('D26', env);
  const history = { status: 'available', totalUsd: 10500000, lastAwardCycle: '2014-12', qualifyingGrantCount: 3 };
  source.proposals[0].researchFunding = history;
  const enriched = await buildProposalRankingPreview('D26', env);
  expect(enriched.snapshot.proposals[0].researchFunding).toEqual(history);
  expect(enriched.previewFingerprint).not.toBe(base.previewFingerprint);
  expect(enriched.snapshot.seedOrders).toEqual(base.snapshot.seedOrders);
  expect(enriched.proposals.map((p) => p.score)).toEqual(base.proposals.map((p) => p.score));
  expect(enriched.proposals[0].score.mean).toBe(5);
  expect(enriched.proposals[0].amountMinorUnits).toBe(base.proposals[0].amountMinorUnits);
  source.proposals[0].amount = null;
  const noAsk = await buildProposalRankingPreview('D26', env);
  expect(noAsk.snapshot.proposals[0].researchFunding).toEqual(history);
});
