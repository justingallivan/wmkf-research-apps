/**
 * @jest-environment node
 */

jest.mock('@vercel/postgres', () => ({ sql: jest.fn(async () => ({ rows: [] })) }));
jest.mock('../../lib/utils/cron-auth', () => ({ verifyCronSecret: jest.fn(() => true) }));
jest.mock('../../lib/services/notification-service', () => ({
  __esModule: true,
  default: { notify: jest.fn(async () => ({ id: 1 })) },
}));
jest.mock('../../lib/services/alert-service', () => ({
  __esModule: true,
  default: { autoResolve: jest.fn(async () => ({ resolved: true })) },
}));
jest.mock('../../lib/services/maintenance-service', () => ({
  __esModule: true,
  default: {
    startRun: jest.fn(async () => 77),
    completeRun: jest.fn(async () => {}),
  },
}));

import handler, {
  classifyRegistryCoverage,
  findUnreviewedLiveClaudeModels,
} from '../../pages/api/cron/pricing-canary';
import NotificationService from '../../lib/services/notification-service';
import AlertService from '../../lib/services/alert-service';
import MaintenanceService from '../../lib/services/maintenance-service';

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

const originalFetch = global.fetch;
const originalClaudeKey = process.env.CLAUDE_API_KEY;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-06-26T00:00:00Z'));
  process.env.CLAUDE_API_KEY = 'sk-ant-test';
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: [] }),
  }));
});

afterEach(() => {
  Date.now.mockRestore();
  global.fetch = originalFetch;
  if (originalClaudeKey === undefined) {
    delete process.env.CLAUDE_API_KEY;
  } else {
    process.env.CLAUDE_API_KEY = originalClaudeKey;
  }
});

describe('pricing-canary model registry discovery', () => {
  it('treats dated ids for reviewed prefixes as covered', () => {
    expect(classifyRegistryCoverage('claude-sonnet-4-6-20260701', {
      'claude-sonnet-4-6': {},
      'claude-sonnet-4': {},
    })).toEqual({ status: 'reviewed_dated', matchedKey: 'claude-sonnet-4-6' });
  });

  it('flags newer same-family ids that only match an ancestor prefix', () => {
    const unreviewed = findUnreviewedLiveClaudeModels([
      { id: 'claude-sonnet-4-6-20260701', display_name: 'Sonnet 4.6', created_at: '2026-07-01T00:00:00Z' },
      { id: 'claude-sonnet-4-7-20260701', display_name: 'Sonnet 4.7', created_at: '2026-07-01T00:00:00Z' },
      { id: 'claude-legacy-2', display_name: 'Legacy', created_at: '2025-01-01T00:00:00Z' },
    ], { reviewedAt: '2026-06-25' });

    expect(unreviewed).toHaveLength(1);
    expect(unreviewed[0]).toMatchObject({
      id: 'claude-sonnet-4-7-20260701',
      family: 'sonnet',
      capabilityCoverage: { status: 'ancestor_match', matchedKey: 'claude-sonnet-4' },
      pricingCoverage: { status: 'ancestor_match', matchedKey: 'claude-sonnet-4' },
    });
  });

  it('alerts ops when Anthropic lists a newer unreviewed model', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { id: 'claude-sonnet-4-7-20260701', display_name: 'Sonnet 4.7', created_at: '2026-07-01T00:00:00Z' },
        ],
      }),
    });

    const res = mockRes();
    await handler({ method: 'POST', headers: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.modelDiscovery).toMatchObject({
      status: 'alerting',
      unreviewedCount: 1,
    });
    expect(NotificationService.notify).toHaveBeenCalledWith(expect.objectContaining({
      type: 'model_registry_unreviewed_live_models',
      severity: 'warning',
      source: 'cron/pricing-canary',
      category: 'ops',
    }));
    expect(MaintenanceService.completeRun).toHaveBeenCalledWith(
      77,
      expect.objectContaining({
        status: 'completed',
        details: expect.objectContaining({
          anyAlerting: true,
          modelDiscovery: expect.objectContaining({ status: 'alerting' }),
        }),
      }),
    );
  });

  it('auto-resolves the model discovery alert when the live list is covered', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { id: 'claude-sonnet-4-6-20260701', display_name: 'Sonnet 4.6', created_at: '2026-07-01T00:00:00Z' },
        ],
      }),
    });

    const res = mockRes();
    await handler({ method: 'POST', headers: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.modelDiscovery).toMatchObject({
      status: 'ok',
      unreviewedCount: 0,
    });
    expect(AlertService.autoResolve).toHaveBeenCalledWith('model-registry:live-unreviewed-models');
    expect(NotificationService.notify).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'model_registry_unreviewed_live_models',
    }));
  });

  it('skips live model discovery without failing the cron when CLAUDE_API_KEY is unset', async () => {
    delete process.env.CLAUDE_API_KEY;
    const res = mockRes();
    await handler({ method: 'POST', headers: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.modelDiscovery).toEqual({
      status: 'skipped',
      reason: 'CLAUDE_API_KEY not set',
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
