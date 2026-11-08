/** @jest-environment node */
import { runJ27IntegrityJob } from '../../lib/services/workbench/j27-integrity-worker';
import { j27IntegrityTarget } from '../../lib/utils/j27-integrity-readiness';
import { runWorkbenchIntegrityScreen } from '../../lib/services/workbench/integrity-service';
import {
  claimJ27IntegrityScreen, confirmJ27IntegrityEligibility, finishJ27IntegrityClaim,
  readJ27IntegrityAttempt, saveJ27IntegrityRun,
} from '../../lib/services/workbench/j27-integrity-jobs';

jest.mock('../../lib/utils/j27-integrity-readiness', () => ({ j27IntegrityTarget: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: (_label, fn) => fn() }));
jest.mock('../../lib/services/model-override-loader', () => ({ loadModelOverrides: jest.fn() }));
jest.mock('../../lib/services/workbench/integrity-service', () => ({ runWorkbenchIntegrityScreen: jest.fn() }));
jest.mock('../../lib/services/workbench/j27-integrity-jobs', () => ({
  claimJ27IntegrityScreen: jest.fn(),
  confirmJ27IntegrityEligibility: jest.fn(),
  finishJ27IntegrityClaim: jest.fn(),
  readJ27IntegrityAttempt: jest.fn(),
  saveJ27IntegrityRun: jest.fn(),
}));

const target = 'orgd9e66399.crm.dynamics.com';
const requestId = '11111111-1111-4111-8111-111111111111';
const version = 'W/"123"';
const job = { target_host: target, request_id: requestId, actor_profile_id: 7 };
const screen = () => runJ27IntegrityJob(target, requestId, version);

beforeEach(() => {
  jest.resetAllMocks();
  j27IntegrityTarget.mockReturnValue(target);
  claimJ27IntegrityScreen.mockResolvedValue(job);
  confirmJ27IntegrityEligibility.mockResolvedValue(true);
});

test('disabled or mismatched deployment never claims work', async () => {
  j27IntegrityTarget.mockReturnValue(null);
  await expect(screen()).resolves.toBe('done');
  expect(claimJ27IntegrityScreen).not.toHaveBeenCalled();
});

test.each([['queued', 'waiting'], ['running', 'recover'], ['completed', 'done']])(
  'unclaimed %s state does not invoke paid providers', async (state, outcome) => {
    claimJ27IntegrityScreen.mockResolvedValue(null);
    readJ27IntegrityAttempt.mockResolvedValue(state);
    await expect(screen()).resolves.toBe(outcome);
    expect(runWorkbenchIntegrityScreen).not.toHaveBeenCalled();
  },
);

test('a later No or ineligible fixture skips the claimed screen', async () => {
  confirmJ27IntegrityEligibility.mockResolvedValue(false);
  await screen();
  expect(finishJ27IntegrityClaim).toHaveBeenCalledWith(job, 'skipped');
  expect(runWorkbenchIntegrityScreen).not.toHaveBeenCalled();
});

test('the worker passes persisted result ownership through the claim', async () => {
  const result = { screenedPeople: [], results: [{ hasConcerns: true }], matchCount: 1 };
  runWorkbenchIntegrityScreen.mockImplementation((input, dependencies) => dependencies.saveRun(result));
  await expect(screen()).resolves.toBe('done');
  expect(runWorkbenchIntegrityScreen).toHaveBeenCalledWith(
    expect.objectContaining({ requestId, actorProfileId: 7 }),
    expect.objectContaining({ saveRun: expect.any(Function) }),
  );
  expect(saveJ27IntegrityRun).toHaveBeenCalledWith(job, result);
});
