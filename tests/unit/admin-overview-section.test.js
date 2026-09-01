import { buildAttentionItems } from '../../shared/components/admin/AdminOverviewSection';

test('healthy source data produces no exceptions', () => {
  const items = buildAttentionItems({
    health: { overall: 'ok', services: { dataverse: { status: 'ok' } } },
    alerts: { alerts: [] },
    maintenance: { jobs: [] },
    secrets: { secrets: [] },
    usage: { summary: { error_count: 0 } },
  }, {});

  expect(items).toEqual([]);
});

test('exceptions link to the workspace that owns the corrective action', () => {
  const items = buildAttentionItems({
    health: { overall: 'error', services: { dataverse: { status: 'error' } } },
    alerts: { alerts: [{ severity: 'critical' }] },
    maintenance: { jobs: [{ jobName: 'daily-maintenance', lastRun: { status: 'failed' } }] },
    secrets: { secrets: [{ status: 'expired' }] },
    usage: { summary: { error_count: 2 } },
  }, {});

  expect(items.map((item) => item.href)).toEqual(expect.arrayContaining([
    '/admin?workspace=operations&view=health',
    '/admin?workspace=operations&view=incidents',
    '/admin?workspace=operations&view=jobs',
    '/admin?workspace=operations&view=credentials',
    '/admin?workspace=ai&view=usage',
  ]));
  expect(items[0].tone).toBe('critical');
});

test('an unavailable source is visible rather than creating a false all-clear', () => {
  const items = buildAttentionItems({}, { usage: 'Request failed' });

  expect(items).toEqual([
    expect.objectContaining({
      key: 'unavailable-usage',
      title: 'API usage could not be checked',
      detail: 'Request failed',
      href: '/admin?workspace=ai&view=usage',
    }),
  ]);
});
