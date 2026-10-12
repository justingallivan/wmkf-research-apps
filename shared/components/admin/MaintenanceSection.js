import { useEffect, useState } from 'react';
import { Card } from '../Layout';
import { requestEnvelope } from '../../utils/api-request';

// --- Section A4: Maintenance Status ---
export default function MaintenanceSection() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    requestEnvelope('/api/admin/maintenance', { signal: controller.signal })
      .then(envelope => {
        if (!envelope.ok) throw new Error('Maintenance status could not be loaded.');
        return envelope.data;
      })
      .then(setData)
      .catch((loadError) => {
        if (loadError.name !== 'AbortError') setError(loadError.message);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [reloadToken]);

  if (loading) {
    return (
      <Card>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Maintenance Jobs</h2>
        <div className="text-gray-500 text-sm">Loading...</div>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <h2 className="mb-2 text-lg font-semibold text-gray-900">Maintenance Jobs</h2>
        <p className="text-sm text-red-700" role="alert">{error || 'Maintenance status is unavailable.'}</p>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setLoading(true);
            setReloadToken((token) => token + 1);
          }}
          className="mt-3 min-h-11 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
        >
          Try again
        </button>
      </Card>
    );
  }

  const statusColors = {
    completed: 'text-green-700 bg-green-100',
    running: 'text-blue-700 bg-blue-100',
    failed: 'text-red-700 bg-red-100',
  };

  const jobLabels = {
    'daily-maintenance': { name: 'Daily Maintenance', icon: '\uD83E\uDDF9' },
    'health-check': { name: 'Health Monitor', icon: '\uD83D\uDC93' },
    'secret-check': { name: 'Secret Expiration', icon: '\uD83D\uDD10' },
    'log-analysis': { name: 'Log Analysis', icon: '\uD83D\uDCCA' },
  };

  return (
    <Card>
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Maintenance Jobs</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {data.jobs.map(job => {
          const label = jobLabels[job.jobName] || { name: job.jobName, icon: '\u2699\uFE0F' };
          return (
            <div key={job.jobName} className="p-4 rounded-lg border border-gray-200 bg-gray-50">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-sm text-gray-900">
                  {label.icon} {label.name}
                </span>
                {job.lastRun && (
                  <span className={`inline-flex min-h-6 items-center text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[job.lastRun.status] || 'text-gray-600 bg-gray-100'}`}>
                    {job.lastRun.status}
                  </span>
                )}
              </div>
              <div className="text-xs text-gray-500 space-y-0.5">
                <div>Schedule: {job.schedule}</div>
                {job.lastRun ? (
                  <>
                    <div>Last run: {new Date(job.lastRun.startedAt).toLocaleString()}</div>
                    {job.lastRun.recordsDeleted > 0 && (
                      <div>Cleaned: {job.lastRun.recordsDeleted} records</div>
                    )}
                    {job.lastRun.durationMs && (
                      <div>Duration: {(job.lastRun.durationMs / 1000).toFixed(1)}s</div>
                    )}
                    {job.lastRun.errorMessage && (
                      <div className="text-red-600 mt-1">{job.lastRun.errorMessage}</div>
                    )}
                  </>
                ) : (
                  <div className="text-gray-400 italic">No runs recorded yet</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {data.retentionConfig && (
        <div className="mt-4 pt-3 border-t border-gray-200">
          <div className="text-xs text-gray-500">
            <span className="font-medium">Retention:</span>{' '}
            Usage log {data.retentionConfig.usage_log_days}d,{' '}
            Query log {data.retentionConfig.query_log_days}d,{' '}
            Blobs {data.retentionConfig.blob_days}d,{' '}
            Health {data.retentionConfig.health_history_days}d,{' '}
            Alerts {data.retentionConfig.alert_days}d
          </div>
        </div>
      )}
    </Card>
  );
}

