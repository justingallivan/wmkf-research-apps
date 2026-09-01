import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Card } from '../Layout';
import { adminHref } from './AdminWorkspaceNavigation';

const OVERVIEW_SOURCES = Object.freeze([
  { key: 'health', label: 'service health', url: '/api/health' },
  { key: 'alerts', label: 'system alerts', url: '/api/admin/alerts' },
  { key: 'maintenance', label: 'maintenance jobs', url: '/api/admin/maintenance' },
  { key: 'secrets', label: 'credential expiration', url: '/api/admin/secrets' },
  { key: 'usage', label: 'API usage', url: '/api/admin/stats?period=7d' },
]);

const TONE = {
  critical: 'border-red-200 bg-red-50 text-red-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-950',
  info: 'border-blue-200 bg-blue-50 text-blue-900',
};

const SOURCE_DESTINATIONS = Object.freeze({
  health: ['operations', 'health'],
  alerts: ['operations', 'incidents'],
  maintenance: ['operations', 'jobs'],
  secrets: ['operations', 'credentials'],
  usage: ['ai', 'usage'],
});

async function loadSource(source, signal) {
  const response = await fetch(source.url, { signal });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `${source.label} could not be checked`);
  return data;
}

export function buildAttentionItems(data, errors) {
  const items = [];
  const failingServices = Object.entries(data.health?.services || {})
    .filter(([, service]) => service?.status && !['ok', 'skipped'].includes(service.status));
  if (failingServices.length > 0) {
    items.push({
      key: 'health',
      tone: data.health?.overall === 'error' ? 'critical' : 'warning',
      title: `${failingServices.length} service${failingServices.length === 1 ? '' : 's'} need attention`,
      detail: failingServices.map(([name]) => name).join(', '),
      href: adminHref('operations', 'health'),
      action: 'Open health',
    });
  }

  const alerts = Array.isArray(data.alerts?.alerts) ? data.alerts.alerts : [];
  if (alerts.length > 0) {
    const urgent = alerts.filter((alert) => ['critical', 'error'].includes(alert.severity)).length;
    items.push({
      key: 'alerts',
      tone: urgent > 0 ? 'critical' : 'warning',
      title: `${alerts.length} active system alert${alerts.length === 1 ? '' : 's'}`,
      detail: urgent > 0 ? `${urgent} marked critical or error` : 'Review and resolve the active queue.',
      href: adminHref('operations', 'incidents'),
      action: 'Open incidents',
    });
  }

  const failedJobs = (data.maintenance?.jobs || []).filter((job) => job.lastRun?.status === 'failed');
  if (failedJobs.length > 0) {
    items.push({
      key: 'jobs',
      tone: 'critical',
      title: `${failedJobs.length} maintenance job${failedJobs.length === 1 ? '' : 's'} failed`,
      detail: failedJobs.map((job) => job.jobName).join(', '),
      href: adminHref('operations', 'jobs'),
      action: 'Open jobs',
    });
  }

  const secretStatuses = new Set(['attention', 'warning', 'critical', 'expired']);
  const expiringSecrets = (data.secrets?.secrets || []).filter((secret) => secretStatuses.has(secret.status));
  if (expiringSecrets.length > 0) {
    const expired = expiringSecrets.filter((secret) => ['critical', 'expired'].includes(secret.status)).length;
    items.push({
      key: 'credentials',
      tone: expired > 0 ? 'critical' : 'warning',
      title: `${expiringSecrets.length} credential${expiringSecrets.length === 1 ? '' : 's'} need review`,
      detail: expired > 0 ? `${expired} critical or expired` : 'Rotation or expiration dates are approaching.',
      href: adminHref('operations', 'credentials'),
      action: 'Open credentials',
    });
  }

  const usageErrors = Number(data.usage?.summary?.error_count || 0);
  if (usageErrors > 0) {
    items.push({
      key: 'usage',
      tone: 'warning',
      title: `${usageErrors} API error${usageErrors === 1 ? '' : 's'} in the last 7 days`,
      detail: 'Review usage by application and user.',
      href: adminHref('ai', 'usage'),
      action: 'Open usage',
    });
  }

  for (const source of OVERVIEW_SOURCES) {
    if (!errors[source.key]) continue;
    const [workspace, view] = SOURCE_DESTINATIONS[source.key];
    items.push({
      key: `unavailable-${source.key}`,
      tone: 'warning',
      title: `${source.label} could not be checked`,
      detail: errors[source.key],
      href: adminHref(workspace, view),
      action: 'Open details',
    });
  }

  const priority = { critical: 0, warning: 1, info: 2 };
  return items.sort((left, right) => priority[left.tone] - priority[right.tone]);
}

export default function AdminOverviewSection() {
  const generation = useRef(0);
  const [data, setData] = useState({});
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const currentGeneration = ++generation.current;
    const controller = new AbortController();
    Promise.allSettled(OVERVIEW_SOURCES.map((source) => loadSource(source, controller.signal)))
      .then((results) => {
        if (generation.current !== currentGeneration) return;
        const nextData = {};
        const nextErrors = {};
        results.forEach((result, index) => {
          const source = OVERVIEW_SOURCES[index];
          if (result.status === 'fulfilled') nextData[source.key] = result.value;
          else if (result.reason?.name !== 'AbortError') nextErrors[source.key] = result.reason?.message || 'Check failed.';
        });
        setData(nextData);
        setErrors(nextErrors);
      })
      .finally(() => {
        if (generation.current === currentGeneration) setLoading(false);
      });
    return () => {
      generation.current += 1;
      controller.abort();
    };
  }, [reloadToken]);

  const attentionItems = useMemo(() => buildAttentionItems(data, errors), [data, errors]);

  return (
    <div className="space-y-6">
      <Card hover={false}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-950">Needs attention</h2>
            <p className="mt-1 text-sm text-gray-600">Exceptions from the current operational and account checks.</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              setReloadToken((token) => token + 1);
            }}
            disabled={loading}
            className="min-h-11 self-start rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Checking…' : 'Check again'}
          </button>
        </div>

        {loading ? (
          <p className="mt-5 text-sm text-gray-500" role="status">Checking system and account status…</p>
        ) : attentionItems.length === 0 ? (
          <div className="mt-5 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900" role="status">
            No exceptions were found in the current checks.
          </div>
        ) : (
          <ul className="mt-5 space-y-3">
            {attentionItems.map((item) => (
              <li key={item.key} className={`rounded-lg border px-4 py-3 ${TONE[item.tone]}`}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{item.title}</p>
                    <p className="mt-1 break-words text-sm opacity-80">{item.detail}</p>
                  </div>
                  <Link
                    href={item.href}
                    className="inline-flex min-h-11 shrink-0 items-center self-start rounded-lg border border-current/30 bg-white/70 px-3 py-2 text-sm font-semibold hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-current focus-visible:ring-offset-2"
                  >
                    {item.action}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <section aria-labelledby="common-admin-destinations">
        <h2 id="common-admin-destinations" className="text-lg font-semibold text-gray-950">Common destinations</h2>
        <div className="mt-3 divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 bg-white">
          {[
            ['Configure external review', 'Cycle timing, honorarium, reviewer discovery, and release behavior.', adminHref('workflows', 'external-review')],
            ['Manage Final Writeup audiences', 'Set internal reviewers separately for each Grant Program.', adminHref('workflows', 'final-writeups')],
            ['Update staff access', 'Manage internal roles, applications, and identity linkage.', adminHref('people', 'app-access')],
            ['Review AI configuration', 'Inspect usage, model routing, prompts, and execution budgets.', adminHref('ai', 'models')],
          ].map(([title, description, href]) => (
            <Link
              key={title}
              href={href}
              className="block px-5 py-4 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-500"
            >
              <span className="text-sm font-semibold text-gray-950">{title}</span>
              <span className="mt-1 block text-sm text-gray-600">{description}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
