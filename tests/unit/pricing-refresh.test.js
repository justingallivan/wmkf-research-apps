/** @jest-environment node */
jest.mock('@vercel/postgres', () => ({ sql: jest.fn(async () => ({ rows: [] })) }));
jest.mock('../../lib/utils/cron-auth', () => ({ verifyCronSecret: jest.fn(() => true) }));
jest.mock('../../lib/services/notification-service', () => ({ __esModule: true, default: { notify: jest.fn() } }));
jest.mock('../../lib/services/alert-service', () => ({ __esModule: true, default: { autoResolve: jest.fn() } }));
jest.mock('../../lib/services/maintenance-service', () => ({ __esModule: true, default: { startRun: jest.fn(() => 1), completeRun: jest.fn() } }));
jest.mock('../../lib/services/anthropic-admin', () => ({ getCostReport: jest.fn(), getMessagesUsageReport: jest.fn(), isAdminKeyConfigured: jest.fn(() => true) }));
import handler, { buildPricingAuditRows } from '../../pages/api/cron/pricing-refresh';
import { getCostReport, getMessagesUsageReport } from '../../lib/services/anthropic-admin';
import AlertService from '../../lib/services/alert-service';
import NotificationService from '../../lib/services/notification-service';
const cohort = { model: 'claude-sonnet-5', service_tier: 'standard', context_window: '0-200k', inference_geo: 'global', workspace_id: null };
const bucket = results => [{ starting_at: '2026-09-01T00:00:00Z', ending_at: '2026-09-02T00:00:00Z', results }];
const usage = overrides => ({ ...cohort, uncached_input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_input_tokens: 1_000_000, cache_creation: { ephemeral_5m_input_tokens: 1_000_000, ephemeral_1h_input_tokens: 1_000_000 }, ...overrides });
const cost = (token_type, amount, overrides) => ({ ...cohort, token_type, amount, currency: 'USD', cost_type: 'tokens', ...overrides });
const res = () => ({ statusCode: 200, status(c) { this.statusCode = c; return this; }, json: jest.fn() });
beforeEach(() => jest.clearAllMocks());
it('uses matching provider tokens for all five token dimensions, independent of app logging', () => {
  const { auditRows, skippedCount } = buildPricingAuditRows(bucket([
    cost('uncached_input_tokens', '200'), cost('output_tokens', '1000'), cost('cache_read_input_tokens', '20'),
    cost('cache_creation.ephemeral_5m_input_tokens', '250'), cost('cache_creation.ephemeral_1h_input_tokens', '400'),
  ]), bucket([usage()]));
  expect(auditRows.map(r => r.derivedCentsPerMtok)).toEqual([200, 1000, 20, 250, 400]);
  expect(auditRows.every(r => !r.flagged)).toBe(true);
  expect(skippedCount).toBe(0);
});
it.each(['workspace_id', 'service_tier', 'context_window', 'inference_geo'])('cannot use a different %s as a denominator', dimension => {
  const report = buildPricingAuditRows(bucket([cost('output_tokens', '1000')]), bucket([usage({ [dimension]: 'different' })]));
  expect(report).toEqual({ auditRows: [], skippedCount: 1 });
});
it('cannot use tokens from a different day', () => {
  const u = bucket([usage()]); u[0].starting_at = '2026-09-02T00:00:00Z';
  expect(buildPricingAuditRows(bucket([cost('output_tokens', '1000')]), u).skippedCount).toBe(1);
});
it('does not count one usage cohort twice for repeated cost rows', () => {
  const report = buildPricingAuditRows(bucket([cost('output_tokens', '400'), cost('output_tokens', '600')]), bucket([usage()]));
  expect(report.auditRows[0]).toMatchObject({ tokenCount: 1_000_000, derivedCentsPerMtok: 1000, flagged: false });
});
it('uses Opus 5.5 model-specific cache-read pricing', () => {
  const model = 'claude-opus-5-5';
  expect(buildPricingAuditRows(bucket([cost('cache_read_input_tokens', '20', { model })]), bucket([usage({ model })])).auditRows[0])
    .toMatchObject({ localCentsPerMtok: 20, deltaPct: 0, flagged: false });
});
it.each([{ service_tier: 'batch' }, { inference_geo: 'us' }, { context_window: '200k-1M' }, { currency: 'EUR' }, { amount: 'NaN' }, { description: 'Fast Mode Usage' }])('preserves unsupported billing rows as incomplete', overrides => {
  expect(buildPricingAuditRows(bucket([cost('output_tokens', '1000', overrides)]), bucket([usage(overrides)])).skippedCount).toBe(1);
});
it('does not clear an existing alert for an empty or unmatched report', async () => {
  getCostReport.mockResolvedValue(bucket([cost('output_tokens', '1000')]));
  getMessagesUsageReport.mockResolvedValue([]);
  const response = res(); await handler({ method: 'POST' }, response);
  expect(AlertService.autoResolve).not.toHaveBeenCalled();
  expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'incomplete', skippedCount: 1 }));
});
it('clears drift only after a complete matched healthy comparison', async () => {
  getCostReport.mockResolvedValue(bucket([cost('output_tokens', '1000')])); getMessagesUsageReport.mockResolvedValue(bucket([usage()]));
  await handler({ method: 'POST' }, res());
  expect(AlertService.autoResolve).toHaveBeenCalledWith('pricing:drift');
  expect(NotificationService.notify).not.toHaveBeenCalled();
  expect(getCostReport).toHaveBeenCalledWith(expect.objectContaining({ groupBy: ['description', 'workspace_id'] }));
});
it('still warns on genuine matching price drift and uses dollar labels', async () => {
  getCostReport.mockResolvedValue(bucket([cost('output_tokens', '1200')])); getMessagesUsageReport.mockResolvedValue(bucket([usage()]));
  await handler({ method: 'POST' }, res());
  expect(AlertService.autoResolve).not.toHaveBeenCalled();
  expect(NotificationService.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'pricing_drift', message: expect.stringContaining('12.0000 $/MTok') }));
});
