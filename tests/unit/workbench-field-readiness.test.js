/** @jest-environment node */
import {
  productionWorkbenchFieldsReady, rationaleFieldReady, rosterFieldReady, reviewSummaryFieldsReady,
  staffReviewSummaryEnabled, zoomAttendanceSuggestionsEnabled,
} from '../../lib/utils/workbench-field-readiness';
import { initialAssessmentRationaleEnabled } from '../../lib/utils/initial-assessment-rationale-readiness';
import { j27ChairsRecommendationEnabled } from '../../lib/utils/j27-integrity-readiness';
import { staffReviewSummaryEnabled as reExported } from '../../lib/services/workbench/staff-review-summary-service';

const PROD = 'https://wmkf.crm.dynamics.com';
const SANDBOX = 'https://orgd9e66399.crm.dynamics.com';
const originalEnv = process.env;

function env(values) {
  process.env = { ...originalEnv, VERCEL_ENV: undefined, NODE_ENV: 'test', ...values };
  for (const key of ['WORKBENCH_PRODUCTION_SCHEMA_READY', 'INITIAL_RATIONALE_SCHEMA_READY', 'MEETING_ROSTER_SCHEMA_READY', 'CHAIRS_RECOMMENDATION_ENABLED', 'TEST_REQUEST_ISOLATION']) {
    if (!(key in values)) delete process.env[key];
  }
  if (values.VERCEL_ENV === undefined) delete process.env.VERCEL_ENV;
}

afterEach(() => { process.env = originalEnv; });

const all = () => [rationaleFieldReady(), rosterFieldReady(), reviewSummaryFieldsReady()];

describe('the Production switch', () => {
  test('a Production deployment on the Production target with the switch on has all five fields', () => {
    env({ VERCEL_ENV: 'production', DYNAMICS_URL: PROD, WORKBENCH_PRODUCTION_SCHEMA_READY: 'on' });
    expect(productionWorkbenchFieldsReady()).toBe(true);
    expect(all()).toEqual([true, true, true]);
  });

  test.each([
    ['switch unset', { VERCEL_ENV: 'production', DYNAMICS_URL: PROD }],
    ['switch not the literal on', { VERCEL_ENV: 'production', DYNAMICS_URL: PROD, WORKBENCH_PRODUCTION_SCHEMA_READY: 'true' }],
    ['Production deployment on the sandbox target', { VERCEL_ENV: 'production', DYNAMICS_URL: SANDBOX, WORKBENCH_PRODUCTION_SCHEMA_READY: 'on' }],
    ['Production deployment on an unknown target', { VERCEL_ENV: 'production', DYNAMICS_URL: 'https://other.crm.dynamics.com', WORKBENCH_PRODUCTION_SCHEMA_READY: 'on' }],
    ['Preview on the Production target', { VERCEL_ENV: 'preview', DYNAMICS_URL: PROD, WORKBENCH_PRODUCTION_SCHEMA_READY: 'on' }],
    ['local on the Production target', { DYNAMICS_URL: PROD, WORKBENCH_PRODUCTION_SCHEMA_READY: 'on' }],
  ])('%s has none of the fields', (_label, values) => {
    env(values);
    expect(productionWorkbenchFieldsReady()).toBe(false);
    expect(all()).toEqual([false, false, false]);
  });

  test('Production field readiness does not open the Chairs step or the rationale helper it builds on', () => {
    env({ VERCEL_ENV: 'production', DYNAMICS_URL: PROD, WORKBENCH_PRODUCTION_SCHEMA_READY: 'on', INITIAL_RATIONALE_SCHEMA_READY: 'on', CHAIRS_RECOMMENDATION_ENABLED: 'on', TEST_REQUEST_ISOLATION: 'on' });
    expect(rationaleFieldReady()).toBe(true);
    expect(initialAssessmentRationaleEnabled()).toBe(false);
    expect(j27ChairsRecommendationEnabled()).toBe(false);
  });
});

describe('the isolated sandbox rule is unchanged', () => {
  test('sandbox Preview: summary always, rationale and roster with their own settings', () => {
    env({ VERCEL_ENV: 'preview', DYNAMICS_URL: SANDBOX });
    expect(all()).toEqual([false, false, true]);
    env({ VERCEL_ENV: 'preview', DYNAMICS_URL: SANDBOX, INITIAL_RATIONALE_SCHEMA_READY: 'on', MEETING_ROSTER_SCHEMA_READY: 'on' });
    expect(all()).toEqual([true, true, true]);
  });

  test('the summary rule is re-exported unchanged by the summary service', () => {
    env({ VERCEL_ENV: 'preview', DYNAMICS_URL: SANDBOX });
    expect(reExported).toBe(staffReviewSummaryEnabled);
    expect(reExported()).toBe(true);
    env({ VERCEL_ENV: 'production', DYNAMICS_URL: SANDBOX });
    expect(reExported()).toBe(false);
  });
});

test('Zoom attendance suggestions are off in a Production deployment only', () => {
  env({ VERCEL_ENV: 'production', DYNAMICS_URL: PROD, WORKBENCH_PRODUCTION_SCHEMA_READY: 'on' });
  expect(zoomAttendanceSuggestionsEnabled()).toBe(false);
  env({ VERCEL_ENV: 'preview', DYNAMICS_URL: SANDBOX });
  expect(zoomAttendanceSuggestionsEnabled()).toBe(true);
});
