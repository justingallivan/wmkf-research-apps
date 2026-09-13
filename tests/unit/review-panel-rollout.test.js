/** @jest-environment node */
jest.mock('@vercel/postgres', () => ({ db: { connect: jest.fn() }, sql: { query: jest.fn() } }));

import {
  parseReviewPanelRequestAllowlist, reviewPanelRolloutConfig, assertReviewPanelModeValid,
  assertReviewPanelPilotEnabled, assertReviewPanelCohortConfigured, assertReviewPanelRequestAllowed,
  assertReviewPanelWorkerOpen,
} from '../../lib/services/review-panel-rollout';

describe('mode validation fails closed', () => {
  test('an unrecognised mode throws 503, not a silent fallback', () => {
    expect(() => assertReviewPanelModeValid({ REVIEW_PANEL_ROLLOUT_MODE: 'yolo' })).toThrow(/invalid/);
  });
  test('pilot and smoke are the only accepted modes', () => {
    expect(assertReviewPanelModeValid({ REVIEW_PANEL_ROLLOUT_MODE: 'pilot' })).toBe('pilot');
    expect(assertReviewPanelModeValid({ REVIEW_PANEL_ROLLOUT_MODE: 'smoke' })).toBe('smoke');
  });
  test('an unset mode defaults to pilot, not an unvalidated passthrough', () => {
    expect(assertReviewPanelModeValid({})).toBe('pilot');
  });
});

test('assertReviewPanelPilotEnabled fails closed unless the flag is the literal string "true"', () => {
  expect(() => assertReviewPanelPilotEnabled({ REVIEW_PANEL_ENABLED: 'false' })).toThrow();
  expect(() => assertReviewPanelPilotEnabled({})).toThrow();
  expect(() => assertReviewPanelPilotEnabled({ REVIEW_PANEL_ENABLED: 'true' })).not.toThrow();
});

test('parseReviewPanelRequestAllowlist rejects an oversized or malformed list rather than partially accepting it', () => {
  expect(parseReviewPanelRequestAllowlist('req-1, req-2 ,REQ-3')).toEqual(['req-1', 'req-2', 'req-3']);
  expect(parseReviewPanelRequestAllowlist('bad value!')).toEqual([]);
  expect(parseReviewPanelRequestAllowlist(Array.from({ length: 51 }, (_, i) => `req-${i}`).join(','))).toEqual([]);
});

test('assertReviewPanelCohortConfigured requires a non-empty allowlist and caps smoke mode at four requests', () => {
  expect(() => assertReviewPanelCohortConfigured({ REVIEW_PANEL_ROLLOUT_MODE: 'pilot', REVIEW_PANEL_REQUEST_ALLOWLIST: '' })).toThrow();
  expect(() => assertReviewPanelCohortConfigured({ REVIEW_PANEL_ROLLOUT_MODE: 'smoke', REVIEW_PANEL_REQUEST_ALLOWLIST: 'a,b,c,d,e' })).toThrow();
  expect(assertReviewPanelCohortConfigured({ REVIEW_PANEL_ROLLOUT_MODE: 'smoke', REVIEW_PANEL_REQUEST_ALLOWLIST: 'a,b' })).toEqual(['a', 'b']);
});

test('assertReviewPanelRequestAllowed rejects a request outside the allowlist (the affiliation-style "wrong path" case)', () => {
  const env = { REVIEW_PANEL_ROLLOUT_MODE: 'pilot', REVIEW_PANEL_REQUEST_ALLOWLIST: 'req-1' };
  expect(() => assertReviewPanelRequestAllowed({ requestId: 'req-2' }, env)).toThrow(/outside/);
  expect(() => assertReviewPanelRequestAllowed({ requestId: 'req-1' }, env)).not.toThrow();
  expect(() => assertReviewPanelRequestAllowed({ requestNumber: 'REQ-1' }, env)).not.toThrow();
});

describe('assertReviewPanelWorkerOpen', () => {
  test('honours the durable operator stop even when the env flag says enabled', async () => {
    const readControl = jest.fn().mockResolvedValue({ stop_requested: true });
    await expect(assertReviewPanelWorkerOpen({ REVIEW_PANEL_ENABLED: 'true' }, readControl))
      .rejects.toMatchObject({ interrupted: true });
  });
  test('a missing control row fails closed, not open', async () => {
    const readControl = jest.fn().mockResolvedValue(null);
    await expect(assertReviewPanelWorkerOpen({ REVIEW_PANEL_ENABLED: 'true' }, readControl)).rejects.toThrow();
  });
  test('passes when enabled and not stopped', async () => {
    const readControl = jest.fn().mockResolvedValue({ stop_requested: false });
    await expect(assertReviewPanelWorkerOpen({ REVIEW_PANEL_ENABLED: 'true' }, readControl)).resolves.toBeUndefined();
  });
  test('the pilot-enabled gate runs before the control read (no DB round trip while disabled)', async () => {
    const readControl = jest.fn();
    await expect(assertReviewPanelWorkerOpen({ REVIEW_PANEL_ENABLED: 'false' }, readControl)).rejects.toThrow();
    expect(readControl).not.toHaveBeenCalled();
  });
});

test('reviewPanelRolloutConfig reads the three readable rollout vars verbatim', () => {
  const config = reviewPanelRolloutConfig({ REVIEW_PANEL_ENABLED: 'true', REVIEW_PANEL_ROLLOUT_MODE: 'smoke', REVIEW_PANEL_REQUEST_ALLOWLIST: 'a,b' });
  expect(config).toEqual({ enabled: true, mode: 'smoke', requestAllowlist: ['a', 'b'] });
});

test('reviewPanelRolloutConfig fails closed on an unrecognised mode instead of returning it verbatim', () => {
  expect(() => reviewPanelRolloutConfig({ REVIEW_PANEL_ENABLED: 'true', REVIEW_PANEL_ROLLOUT_MODE: 'yolo' })).toThrow(/invalid/);
});
