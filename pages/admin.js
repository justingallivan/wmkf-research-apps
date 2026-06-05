import { useState, useEffect, Fragment } from 'react';
import Layout, { PageHeader, Card } from '../shared/components/Layout';
import PoliciesSection from '../shared/components/admin/PoliciesSection';
import PromptTemplatesSection from '../shared/components/admin/PromptTemplatesSection';
import { APP_REGISTRY } from '../shared/config/appRegistry';

const PERIOD_OPTIONS = [
  { value: '1d', label: '1 day' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
];

function formatCost(cents) {
  if (cents == null) return '$0.00';
  return '$' + (Number(cents) / 100).toFixed(2);
}

function formatTokens(n) {
  if (!n) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function StatusBadge({ status }) {
  const colors = {
    ok: 'bg-green-100 text-green-800',
    healthy: 'bg-green-100 text-green-800',
    error: 'bg-red-100 text-red-800',
    unhealthy: 'bg-red-100 text-red-800',
    warning: 'bg-yellow-100 text-yellow-800',
    degraded: 'bg-yellow-100 text-yellow-800',
    skipped: 'bg-gray-100 text-gray-600',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || colors.skipped}`}>
      {status}
    </span>
  );
}

const SERVICE_LABELS = {
  database: 'Database',
  claude: 'Claude API',
  azureAd: 'Azure AD (SSO)',
  dynamicsCrm: 'Dynamics CRM',
  encryption: 'Encryption Key',
  nextAuthUrl: 'NEXTAUTH_URL',
};

// --- Section A: Service Health ---
function HealthSection() {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedService, setExpandedService] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    fetch('/api/health')
      .then(r => r.json())
      .then(setHealth)
      .catch(err => setHealth({ overall: 'error', services: {}, error: err.message }))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <Card>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Service Health</h2>
        <div className="text-gray-500 text-sm">Loading health status...</div>
      </Card>
    );
  }

  if (!health) return null;

  const services = Object.entries(health.services || {});
  const failingCount = services.filter(([, svc]) => svc.status && svc.status !== 'ok' && svc.status !== 'skipped').length;

  return (
    <Card>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold text-gray-900">Service Health</h2>
        <StatusBadge status={health.overall} />
      </div>
      <div className="flex items-center justify-between mb-3 text-sm text-gray-600">
        <span>
          {services.length} service{services.length === 1 ? '' : 's'} checked
          {failingCount > 0 && <span className="ml-2 text-red-600">• {failingCount} not OK</span>}
        </span>
        <button
          onClick={() => setDetailsOpen(o => !o)}
          className="text-xs text-gray-600 hover:text-gray-900"
        >
          {detailsOpen ? '▼ Hide details' : '▶ Show details'}
        </button>
      </div>
      {detailsOpen && (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {services.map(([key, svc]) => {
          const isExpanded = expandedService === key;
          const hasOverflow = svc.message || svc.detail;
          return (
            <div
              key={key}
              onClick={() => hasOverflow && setExpandedService(isExpanded ? null : key)}
              className={`p-3 rounded-lg border ${hasOverflow ? 'cursor-pointer' : ''} ${
                svc.status === 'ok' ? 'border-green-200 bg-green-50' :
                svc.status === 'error' ? 'border-red-200 bg-red-50' :
                svc.status === 'warning' ? 'border-yellow-200 bg-yellow-50' :
                'border-gray-200 bg-gray-50'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-gray-900">{SERVICE_LABELS[key] || key}</span>
                <StatusBadge status={svc.status} />
              </div>
              {svc.message && (
                <p className={`text-xs text-gray-600 ${isExpanded ? 'break-words' : 'truncate'}`} title={svc.message}>{svc.message}</p>
              )}
              {svc.detail && (
                <p className={`text-xs text-gray-500 ${isExpanded ? 'break-words' : 'truncate'}`} title={svc.detail}>{svc.detail}</p>
              )}
            </div>
          );
        })}
      </div>
      )}
      {health.timestamp && (
        <p className="text-xs text-gray-400 mt-3">Checked at {new Date(health.timestamp).toLocaleString()}</p>
      )}
    </Card>
  );
}

// --- Section A2: Health Check History ---
function getFailingServices(services) {
  if (!services || typeof services !== 'object') return [];
  return Object.entries(services)
    .filter(([, svc]) => svc.status && svc.status !== 'ok' && svc.status !== 'skipped')
    .map(([key, svc]) => ({ key, label: SERVICE_LABELS[key] || key, ...svc }));
}

function HealthHistorySection() {
  const [history, setHistory] = useState(null);
  const [hours, setHours] = useState(24);
  const [loading, setLoading] = useState(true);
  const [expandedCheckId, setExpandedCheckId] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/health-history?hours=${hours}`)
      .then(r => r.ok ? r.json() : null)
      .then(setHistory)
      .catch(() => setHistory(null))
      .finally(() => setLoading(false));
  }, [hours]);

  if (loading && !history) {
    return (
      <Card>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Health Check History</h2>
        <div className="text-gray-500 text-sm">Loading history...</div>
      </Card>
    );
  }

  if (!history || !history.checks?.length) {
    return (
      <Card>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Health Check History</h2>
        <p className="text-gray-500 text-sm">No health checks recorded yet. The cron job runs every 15 minutes.</p>
      </Card>
    );
  }

  const { summary, checks } = history;

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Health Check History</h2>
        <div className="flex gap-1">
          {[24, 72, 168].map(h => (
            <button
              key={h}
              onClick={() => setHours(h)}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${
                hours === h ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {h <= 24 ? '24h' : h <= 72 ? '3d' : '7d'}
            </button>
          ))}
        </div>
      </div>

      {/* Uptime summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="p-3 rounded-lg border border-gray-200 bg-gray-50">
          <div className="text-xs font-medium text-gray-500 uppercase">Uptime</div>
          <div className="text-xl font-bold text-gray-900">{summary.uptimePercent}%</div>
        </div>
        <div className="p-3 rounded-lg border border-green-200 bg-green-50">
          <div className="text-xs font-medium text-gray-500 uppercase">Healthy</div>
          <div className="text-xl font-bold text-green-700">{summary.healthy}</div>
        </div>
        <div className="p-3 rounded-lg border border-yellow-200 bg-yellow-50">
          <div className="text-xs font-medium text-gray-500 uppercase">Degraded</div>
          <div className="text-xl font-bold text-yellow-700">{summary.degraded}</div>
        </div>
        <div className="p-3 rounded-lg border border-red-200 bg-red-50">
          <div className="text-xs font-medium text-gray-500 uppercase">Unhealthy</div>
          <div className="text-xl font-bold text-red-700">{summary.unhealthy}</div>
        </div>
      </div>

      {/* Recent checks table */}
      <div className="flex justify-end mb-2">
        <button
          onClick={() => setDetailsOpen(o => !o)}
          className="text-xs text-gray-600 hover:text-gray-900"
        >
          {detailsOpen ? '▼ Hide recent checks' : '▶ Show recent checks'}
        </button>
      </div>
      {detailsOpen && (
      <div className="overflow-x-auto max-h-96 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 px-2 font-medium text-gray-600">Time</th>
              <th className="text-left py-2 px-2 font-medium text-gray-600">Status</th>
              <th className="text-right py-2 px-2 font-medium text-gray-600">Response</th>
              <th className="text-left py-2 px-2 font-medium text-gray-600">Source</th>
            </tr>
          </thead>
          <tbody>
            {checks.slice(0, 50).map(check => {
              const failing = getFailingServices(check.services);
              const isExpanded = expandedCheckId === check.id;
              return (
                <Fragment key={check.id}>
                  <tr
                    className="border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors"
                    onClick={() => setExpandedCheckId(isExpanded ? null : check.id)}
                  >
                    <td className="py-1.5 px-2 text-gray-700 text-xs">{new Date(check.created_at).toLocaleString()}</td>
                    <td className="py-1.5 px-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <StatusBadge status={check.overall_status} />
                        {failing.length > 0 && (
                          <span className={`text-xs ${check.overall_status === 'unhealthy' ? 'text-red-600' : 'text-yellow-600'}`}>
                            {failing.map(f => f.label).join(', ')}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-1.5 px-2 text-right text-gray-600 text-xs">{check.response_time_ms}ms</td>
                    <td className="py-1.5 px-2 text-gray-500 text-xs">{check.triggered_by}</td>
                  </tr>
                  {isExpanded && check.services && (
                    <tr className="border-b border-gray-100">
                      <td colSpan={4} className="p-3 bg-gray-50">
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                          {Object.entries(check.services).map(([key, svc]) => (
                            <div
                              key={key}
                              className={`p-2 rounded-lg border ${
                                svc.status === 'ok' ? 'border-green-200 bg-green-50' :
                                svc.status === 'error' ? 'border-red-200 bg-red-50' :
                                svc.status === 'warning' ? 'border-yellow-200 bg-yellow-50' :
                                'border-gray-200 bg-white'
                              }`}
                            >
                              <div className="flex items-center justify-between mb-0.5">
                                <span className="text-xs font-medium text-gray-900">{SERVICE_LABELS[key] || key}</span>
                                <StatusBadge status={svc.status} />
                              </div>
                              {svc.message && (
                                <p className="text-xs text-gray-600 truncate" title={svc.message}>{svc.message}</p>
                              )}
                              {svc.detail && (
                                <p className="text-xs text-gray-500 truncate" title={svc.detail}>{svc.detail}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
    </Card>
  );
}

// --- Section A3: System Alerts ---
function SystemAlertsSection() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionInProgress, setActionInProgress] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  const fetchAlerts = () => {
    fetch('/api/admin/alerts')
      .then(r => r.ok ? r.json() : null)
      .then(data => setAlerts(data?.alerts || []))
      .catch(() => setAlerts([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchAlerts(); }, []);

  const handleAction = async (id, action) => {
    setActionInProgress(id);
    try {
      const res = await fetch('/api/admin/alerts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      });
      if (res.ok) fetchAlerts();
    } catch {}
    setActionInProgress(null);
  };

  const severityColors = {
    critical: 'bg-red-100 text-red-800 border-red-200',
    error: 'bg-red-50 text-red-700 border-red-200',
    warning: 'bg-yellow-50 text-yellow-800 border-yellow-200',
    info: 'bg-blue-50 text-blue-700 border-blue-200',
  };

  const severityDots = {
    critical: 'bg-red-500',
    error: 'bg-red-400',
    warning: 'bg-yellow-400',
    info: 'bg-blue-400',
  };

  if (loading) {
    return (
      <Card>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">System Alerts</h2>
        <div className="text-gray-500 text-sm">Loading alerts...</div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">System Alerts</h2>
        {alerts.length > 0 && (
          <span className="text-sm text-gray-500">{alerts.length} active</span>
        )}
      </div>

      {alerts.length === 0 ? (
        <p className="text-gray-500 text-sm">No active alerts. All systems normal.</p>
      ) : (
        <div className="space-y-2">
          {alerts.map(alert => (
            <div
              key={alert.id}
              className={`p-3 rounded-lg border ${severityColors[alert.severity] || severityColors.info}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 flex-1 min-w-0">
                  <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${severityDots[alert.severity]}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{alert.title}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/50 text-gray-600">
                        {alert.alert_type.replace(/_/g, ' ')}
                      </span>
                      {alert.status === 'acknowledged' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/50 text-gray-500">
                          ack&apos;d by {alert.acknowledged_by_name}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-600 mt-0.5">
                      {new Date(alert.created_at).toLocaleString()}
                      {alert.source && ` \u00b7 ${alert.source}`}
                    </div>
                    {expandedId === alert.id && (
                      <div className="mt-2 text-xs text-gray-700 space-y-1">
                        {alert.message && <p>{alert.message}</p>}
                        {alert.metadata && (
                          <pre className="bg-white/50 p-2 rounded text-[11px] overflow-x-auto max-h-40">
                            {JSON.stringify(alert.metadata, null, 2)}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => setExpandedId(expandedId === alert.id ? null : alert.id)}
                    className="p-1 text-xs text-gray-500 hover:text-gray-700 rounded"
                    title={expandedId === alert.id ? 'Collapse' : 'Expand'}
                  >
                    {expandedId === alert.id ? '\u25B2' : '\u25BC'}
                  </button>
                  {alert.status === 'active' && (
                    <button
                      onClick={() => handleAction(alert.id, 'acknowledge')}
                      disabled={actionInProgress === alert.id}
                      className="px-2 py-1 text-xs bg-white/70 hover:bg-white rounded border border-gray-300 text-gray-700 transition-colors disabled:opacity-50"
                    >
                      Ack
                    </button>
                  )}
                  <button
                    onClick={() => handleAction(alert.id, 'resolve')}
                    disabled={actionInProgress === alert.id}
                    className="px-2 py-1 text-xs bg-white/70 hover:bg-white rounded border border-gray-300 text-gray-700 transition-colors disabled:opacity-50"
                  >
                    Resolve
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// --- Section A4: Maintenance Status ---
function MaintenanceSection() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/maintenance')
      .then(r => r.ok ? r.json() : null)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <Card>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Maintenance Jobs</h2>
        <div className="text-gray-500 text-sm">Loading...</div>
      </Card>
    );
  }

  if (!data) return null;

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
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[job.lastRun.status] || 'text-gray-600 bg-gray-100'}`}>
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

// --- Section A5: Secret Expiration ---
function SecretExpirationSection() {
  const [secrets, setSecrets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingKey, setEditingKey] = useState(null);
  const [editValues, setEditValues] = useState({ rotationDate: '', expirationDate: '' });
  const [saving, setSaving] = useState(false);

  const fetchSecrets = () => {
    fetch('/api/admin/secrets')
      .then(r => r.ok ? r.json() : null)
      .then(data => setSecrets(data?.secrets || []))
      .catch(() => setSecrets([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchSecrets(); }, []);

  const startEdit = (secret) => {
    setEditingKey(secret.key);
    setEditValues({
      rotationDate: secret.lastRotated || '',
      expirationDate: secret.expirationDate || '',
    });
  };

  const saveEdit = async () => {
    if (!editValues.rotationDate && !editValues.expirationDate) return;
    setSaving(true);
    try {
      const res = await fetch('/api/admin/secrets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: editingKey, ...editValues }),
      });
      if (res.ok) {
        setEditingKey(null);
        fetchSecrets();
      } else {
        const err = await res.json().catch(() => ({}));
        console.error('Secret save failed:', res.status, err);
      }
    } catch (err) {
      console.error('Secret save error:', err);
    }
    setSaving(false);
  };

  const statusBadge = (status) => {
    const colors = {
      ok: 'bg-green-100 text-green-800',
      attention: 'bg-yellow-100 text-yellow-700',
      warning: 'bg-orange-100 text-orange-800',
      critical: 'bg-red-100 text-red-800',
      expired: 'bg-red-200 text-red-900',
      not_tracked: 'bg-gray-100 text-gray-500',
    };
    return (
      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || colors.not_tracked}`}>
        {status === 'not_tracked' ? 'not set' : status}
      </span>
    );
  };

  if (loading) {
    return (
      <Card>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Secret Expiration Tracking</h2>
        <div className="text-gray-500 text-sm">Loading...</div>
      </Card>
    );
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Secret Expiration Tracking</h2>
      <p className="text-xs text-gray-500 mb-3">
        Set expiration dates to receive automated alerts as secrets approach expiry. Dates are checked daily at 8:00 AM UTC.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 px-2 font-medium text-gray-600">Secret</th>
              <th className="text-left py-2 px-2 font-medium text-gray-600">Status</th>
              <th className="text-left py-2 px-2 font-medium text-gray-600">Expires</th>
              <th className="text-left py-2 px-2 font-medium text-gray-600">Last Rotated</th>
              <th className="text-right py-2 px-2 font-medium text-gray-600">Days Left</th>
              <th className="text-right py-2 px-2 font-medium text-gray-600"></th>
            </tr>
          </thead>
          <tbody>
            {secrets.map(secret => (
              <tr key={secret.key} className="border-b border-gray-100">
                <td className="py-2 px-2 text-gray-900 font-medium text-xs">{secret.name}</td>
                <td className="py-2 px-2">{statusBadge(secret.status)}</td>
                {editingKey === secret.key ? (
                  <>
                    <td className="py-2 px-2">
                      <input
                        type="date"
                        value={editValues.expirationDate}
                        onChange={e => setEditValues(v => ({ ...v, expirationDate: e.target.value }))}
                        className="px-2 py-1 border border-gray-300 rounded text-xs w-32"
                      />
                    </td>
                    <td className="py-2 px-2">
                      <input
                        type="date"
                        value={editValues.rotationDate}
                        onChange={e => setEditValues(v => ({ ...v, rotationDate: e.target.value }))}
                        className="px-2 py-1 border border-gray-300 rounded text-xs w-32"
                      />
                    </td>
                    <td className="py-2 px-2 text-right">
                      <button onClick={saveEdit} disabled={saving} className="text-xs text-green-700 hover:text-green-900 mr-2">
                        {saving ? '...' : 'Save'}
                      </button>
                      <button onClick={() => setEditingKey(null)} className="text-xs text-gray-500 hover:text-gray-700">
                        Cancel
                      </button>
                    </td>
                    <td />
                  </>
                ) : (
                  <>
                    <td className="py-2 px-2 text-gray-600 text-xs">{secret.expirationDate || '-'}</td>
                    <td className="py-2 px-2 text-gray-600 text-xs">{secret.lastRotated || '-'}</td>
                    <td className="py-2 px-2 text-right text-gray-700 text-xs">
                      {secret.daysUntilExpiry !== null ? secret.daysUntilExpiry : '-'}
                    </td>
                    <td className="py-2 px-2 text-right">
                      <button onClick={() => startEdit(secret)} className="text-xs text-blue-600 hover:text-blue-800">
                        Edit
                      </button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// --- Section B: Usage Overview ---
function UsageSection() {
  const [period, setPeriod] = useState('30d');
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/admin/stats?period=${period}`)
      .then(r => {
        if (r.status === 403) throw new Error('Admin access required');
        if (!r.ok) throw new Error('Failed to fetch stats');
        return r.json();
      })
      .then(setStats)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [period]);

  if (error) {
    return (
      <Card>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">API Usage</h2>
        <div className="text-red-600 text-sm">{error}</div>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {/* Summary Cards */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">API Usage</h2>
          <div className="flex gap-1">
            {PERIOD_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setPeriod(opt.value)}
                className={`px-3 py-1 text-sm rounded-md transition-colors ${
                  period === opt.value
                    ? 'bg-gray-900 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="text-gray-500 text-sm">Loading usage data...</div>
        ) : stats?.summary ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <SummaryCard label="Total Requests" value={stats.summary.total_requests} />
            <SummaryCard label="Estimated Cost" value={formatCost(stats.summary.total_cost_cents)} />
            <SummaryCard label="Active Users" value={stats.summary.unique_users} />
            <SummaryCard label="Errors" value={stats.summary.error_count} alert={stats.summary.error_count > 0} />
          </div>
        ) : (
          <div className="text-gray-500 text-sm">No usage data yet.</div>
        )}

        <div className="mt-3 flex justify-end">
          <button
            onClick={() => setDetailsOpen(o => !o)}
            className="text-xs text-gray-600 hover:text-gray-900"
          >
            {detailsOpen ? '▼ Hide breakdowns' : '▶ Show breakdowns (by user / by app / daily trend)'}
          </button>
        </div>
      </Card>

      {/* Usage by User */}
      {detailsOpen && stats?.byUser?.length > 0 && (
        <Card>
          <h3 className="text-md font-semibold text-gray-900 mb-3">Usage by User</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-2 font-medium text-gray-600">User</th>
                  <th className="text-right py-2 px-2 font-medium text-gray-600">Requests</th>
                  <th className="text-right py-2 px-2 font-medium text-gray-600">Tokens</th>
                  <th className="text-right py-2 px-2 font-medium text-gray-600">Est. Cost</th>
                  <th className="text-right py-2 px-2 font-medium text-gray-600">Errors</th>
                </tr>
              </thead>
              <tbody>
                {stats.byUser.map((row, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="py-2 px-2 text-gray-900">{row.user_name}</td>
                    <td className="py-2 px-2 text-right text-gray-700">{row.request_count}</td>
                    <td className="py-2 px-2 text-right text-gray-700">
                      {formatTokens(Number(row.total_input_tokens) + Number(row.total_output_tokens))}
                    </td>
                    <td className="py-2 px-2 text-right text-gray-700">{formatCost(row.total_cost_cents)}</td>
                    <td className={`py-2 px-2 text-right ${row.error_count > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                      {row.error_count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Usage by App */}
      {detailsOpen && stats?.byApp?.length > 0 && (
        <Card>
          <h3 className="text-md font-semibold text-gray-900 mb-3">Usage by App</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-2 font-medium text-gray-600">App</th>
                  <th className="text-right py-2 px-2 font-medium text-gray-600">Requests</th>
                  <th className="text-right py-2 px-2 font-medium text-gray-600">Tokens</th>
                  <th className="text-right py-2 px-2 font-medium text-gray-600">Est. Cost</th>
                  <th className="text-right py-2 px-2 font-medium text-gray-600">Avg Latency</th>
                </tr>
              </thead>
              <tbody>
                {stats.byApp.map((row, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="py-2 px-2 text-gray-900">{row.app_name}</td>
                    <td className="py-2 px-2 text-right text-gray-700">{row.request_count}</td>
                    <td className="py-2 px-2 text-right text-gray-700">
                      {formatTokens(Number(row.total_input_tokens) + Number(row.total_output_tokens))}
                    </td>
                    <td className="py-2 px-2 text-right text-gray-700">{formatCost(row.total_cost_cents)}</td>
                    <td className="py-2 px-2 text-right text-gray-700">
                      {row.avg_latency_ms ? `${(row.avg_latency_ms / 1000).toFixed(1)}s` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Daily Trend */}
      {detailsOpen && stats?.byDay?.length > 0 && (
        <Card>
          <h3 className="text-md font-semibold text-gray-900 mb-3">Daily Trend</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-2 font-medium text-gray-600">Date</th>
                  <th className="text-right py-2 px-2 font-medium text-gray-600">Requests</th>
                  <th className="text-right py-2 px-2 font-medium text-gray-600">Est. Cost</th>
                  <th className="text-right py-2 px-2 font-medium text-gray-600">Users</th>
                </tr>
              </thead>
              <tbody>
                {stats.byDay.map((row, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="py-2 px-2 text-gray-900">{new Date(row.day).toLocaleDateString()}</td>
                    <td className="py-2 px-2 text-right text-gray-700">{row.request_count}</td>
                    <td className="py-2 px-2 text-right text-gray-700">{formatCost(row.total_cost_cents)}</td>
                    <td className="py-2 px-2 text-right text-gray-700">{row.unique_users}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function SummaryCard({ label, value, alert = false }) {
  return (
    <div className={`p-4 rounded-lg border ${alert ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-gray-50'}`}>
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${alert ? 'text-red-700' : 'text-gray-900'}`}>{value}</div>
    </div>
  );
}

// --- Section B2: Model Configuration ---
const MODEL_TYPE_LABELS = {
  model: 'Primary',
  visionModel: 'Vision',
  fallback: 'Fallback',
};

// Friendly names for APP_MODELS keys. App-registry keys don't always match
// APP_MODELS keys (e.g. APP_MODELS uses 'batch-phase-i' while the registry
// uses 'batch-phase-i-summaries'), so this is maintained inline.
const APP_MODEL_NAMES = {
  'multi-perspective-evaluator': 'Multi-Perspective Evaluator',
  'literature-analyzer': 'Literature Analyzer',
  'batch-phase-i': 'Batch Phase I',
  'batch-phase-ii': 'Batch Phase II',
  'phase-i-writeup': 'Phase I Writeup',
  'phase-ii-writeup': 'Phase II Writeup',
  'reviewer-finder': 'Reviewer Finder',
  'review-manager': 'Review Manager',
  'reviewers': 'Reviewers',
  'peer-review-summarizer': 'Peer Review Summarizer',
  'funding-analysis': 'Funding Analysis',
  'qa': 'Q&A',
  'refine': 'Refinement',
  'expense-reporter': 'Expense Reporter',
  'contact-enrichment': 'Contact Enrichment',
  'email-personalization': 'Email Personalization',
  'dynamics-explorer': 'Dynamics Explorer',
  'expertise-finder': 'Expertise Finder',
  'virtual-review-panel': 'Virtual Review Panel',
  'grant-reporting': 'Grant Reporting',
};

// Strip the 'claude-' prefix and a trailing YYYYMMDD date stamp so dropdown
// labels stay readable. 'claude-sonnet-4-20250514' → 'sonnet-4'.
function shortModelLabel(id) {
  if (!id) return '—';
  return String(id).replace(/^claude-/, '').replace(/-\d{8}$/, '');
}

function ModelConfigSection() {
  const [serverState, setServerState] = useState(null); // { apps, availableModels, tiers, defaultModel }
  const [localOverrides, setLocalOverrides] = useState({}); // { "appKey:modelType": tier|modelId|null }
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  const fetchConfig = (opts = {}) => {
    const { refresh = false } = opts;
    if (refresh) setRefreshing(true); else setLoading(true);
    setError(null);
    const url = refresh ? '/api/admin/models?refresh=1' : '/api/admin/models';
    fetch(url)
      .then(r => {
        if (r.status === 403) throw new Error('Admin access required');
        if (!r.ok) throw new Error('Failed to fetch model config');
        return r.json();
      })
      .then(data => {
        setServerState(data);
        // Initialize local overrides from server DB overrides
        const overrides = {};
        (data.apps || []).forEach(app => {
          Object.entries(app.models).forEach(([type, info]) => {
            if (info.dbOverride) {
              overrides[`${app.appKey}:${type}`] = info.dbOverride;
            }
          });
        });
        setLocalOverrides(overrides);
      })
      .catch(err => setError(err.message))
      .finally(() => { setLoading(false); setRefreshing(false); });
  };

  useEffect(() => { fetchConfig(); }, []);

  if (loading) {
    return <div className="text-gray-500 text-sm">Loading model configuration...</div>;
  }

  if (error) {
    return <div className="text-red-600 text-sm">{error}</div>;
  }

  if (!serverState) return null;

  const { apps, availableModels, tiers = [], defaultModel } = serverState;

  // Build server-side DB override map for diff calculation
  const serverDbOverrides = {};
  apps.forEach(app => {
    Object.entries(app.models).forEach(([type, info]) => {
      if (info.dbOverride) {
        serverDbOverrides[`${app.appKey}:${type}`] = info.dbOverride;
      }
    });
  });

  // Handle dropdown change
  const handleChange = (appKey, modelType, value) => {
    setLocalOverrides(prev => {
      const next = { ...prev };
      const key = `${appKey}:${modelType}`;
      if (value === '') {
        // "Default" selected — clear the override
        delete next[key];
      } else {
        next[key] = value;
      }
      return next;
    });
  };

  // Compute diff between server DB overrides and local state
  const computeDiff = () => {
    const changes = [];
    const allKeys = new Set([...Object.keys(serverDbOverrides), ...Object.keys(localOverrides)]);
    for (const key of allKeys) {
      const serverVal = serverDbOverrides[key] || null;
      const localVal = localOverrides[key] || null;
      if (serverVal !== localVal) {
        const [appKey, modelType] = [key.substring(0, key.lastIndexOf(':')), key.substring(key.lastIndexOf(':') + 1)];
        changes.push({ appKey, modelType, modelId: localVal });
      }
    }
    return changes;
  };

  const diff = computeDiff();
  const hasChanges = diff.length > 0;

  const saveAll = async () => {
    setSaving(true);
    setMessage(null);
    try {
      for (const change of diff) {
        const resp = await fetch('/api/admin/models', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(change),
        });
        if (!resp.ok) {
          const err = await resp.json();
          throw new Error(err.error || 'Failed to save');
        }
      }
      setMessage({ type: 'success', text: `Saved ${diff.length} model override(s)` });
      fetchConfig();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const discardChanges = () => {
    const overrides = {};
    apps.forEach(app => {
      Object.entries(app.models).forEach(([type, info]) => {
        if (info.dbOverride) {
          overrides[`${app.appKey}:${type}`] = info.dbOverride;
        }
      });
    });
    setLocalOverrides(overrides);
    setMessage(null);
  };

  const shortModelName = shortModelLabel;

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-gray-500">
          Tier picks (Opus / Sonnet / Haiku) auto-track the latest model in that family. Pin a specific version only if you need to reproduce historical behavior. Changes take effect within 5 minutes.
        </p>
        <div className="flex items-center gap-2 ml-3 shrink-0">
          <button
            onClick={() => fetchConfig({ refresh: true })}
            disabled={refreshing || saving}
            title="Re-fetch the Anthropic model list (bypasses the 24h cache)"
            className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {refreshing ? 'Refreshing…' : 'Refresh model list'}
          </button>
          {hasChanges && (
            <button
              onClick={discardChanges}
              className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Discard
            </button>
          )}
          <button
            onClick={saveAll}
            disabled={!hasChanges || saving}
            className="px-4 py-1.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? 'Saving...' : hasChanges ? 'Save Changes' : 'No Changes'}
          </button>
        </div>
      </div>

      {message && (
        <div className={`mb-4 px-3 py-2 rounded-lg text-sm ${
          message.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'
        }`}>
          {message.text}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 px-2 font-medium text-gray-600 min-w-[160px]">App</th>
              {Object.entries(MODEL_TYPE_LABELS).map(([type, label]) => (
                <th key={type} className="text-left py-2 px-2 font-medium text-gray-600 min-w-[220px]">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {apps.map(app => (
              <tr key={app.appKey} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-2 px-2 text-gray-900 font-medium whitespace-nowrap">
                  {APP_MODEL_NAMES[app.appKey] || app.appKey}
                </td>
                {Object.keys(MODEL_TYPE_LABELS).map(modelType => {
                  const info = app.models[modelType];
                  const key = `${app.appKey}:${modelType}`;
                  const localVal = localOverrides[key] || '';
                  const serverVal = serverDbOverrides[key] || '';
                  const changed = localVal !== serverVal;
                  const hasHardcoded = !!info.hardcoded;
                  // Resolve what would actually be sent to Anthropic given
                  // the current selection (tier → concrete via the tiers
                  // catalog from the server).
                  const tierMap = Object.fromEntries(tiers.map(t => [t.key, t.resolvedId]));
                  const effectiveStored = localVal || info.hardcoded || '';
                  const effectiveResolved = tierMap[effectiveStored] || effectiveStored;

                  return (
                    <td key={modelType} className="py-2 px-2">
                      {hasHardcoded ? (
                        <div>
                          <select
                            value={localVal}
                            onChange={e => handleChange(app.appKey, modelType, e.target.value)}
                            className={`w-full px-2 py-1.5 border rounded-lg text-xs focus:ring-2 focus:ring-gray-400 focus:border-gray-400 ${
                              changed ? 'border-amber-400 ring-2 ring-amber-200' : 'border-gray-300'
                            }`}
                          >
                            <option value="">
                              Default ({info.hardcoded})
                            </option>
                            {tiers.length > 0 && (
                              <optgroup label="Tiers (auto-track latest)">
                                {tiers.map(t => (
                                  <option key={t.key} value={t.key}>
                                    {t.anthropic} ({t.tier})
                                  </option>
                                ))}
                              </optgroup>
                            )}
                            {availableModels.length > 0 && (
                              <optgroup label="Pin specific version">
                                {availableModels.map(m => (
                                  <option key={m.id} value={m.id}>{m.display_name}</option>
                                ))}
                              </optgroup>
                            )}
                          </select>
                          <div className="mt-1 flex items-center gap-2 text-[10px] text-gray-500">
                            <span title="Concrete model id that will be sent to Anthropic">
                              → {shortModelName(effectiveResolved)}
                            </span>
                            {info.envOverride && (
                              <span className="text-gray-400" title={`Environment variable override: ${info.envOverride}`}>
                                env: {shortModelName(info.envOverride)}
                              </span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <span className="text-gray-400 text-xs">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hasChanges && (
        <p className="text-xs text-amber-600 mt-3">
          {diff.length} unsaved change(s). Changed dropdowns are highlighted.
        </p>
      )}
    </>
  );
}

// --- Section C: Role Management ---
const ROLE_OPTIONS = [
  { value: 'superuser', label: 'Superuser' },
  { value: 'read_write', label: 'Read/Write' },
  { value: 'read_only', label: 'Read Only' },
];

function RoleManagementSection() {
  const [roles, setRoles] = useState(null);
  const [users, setUsers] = useState([]);
  const [callerRole, setCallerRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedUser, setSelectedUser] = useState('');
  const [selectedRole, setSelectedRole] = useState('read_only');
  const [message, setMessage] = useState(null);

  const fetchRoles = () => {
    fetch('/api/dynamics-explorer/roles')
      .then(r => {
        if (r.status === 403 || r.status === 401) {
          setCallerRole('denied');
          return null;
        }
        return r.json();
      })
      .then(data => {
        if (!data) return;
        setCallerRole(data.callerRole);
        setRoles(data.roles || []);
      })
      .catch(() => setCallerRole('denied'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchRoles();
    fetch('/api/user-profiles?all=true')
      .then(r => r.json())
      .then(data => setUsers(data.profiles || []))
      .catch(() => {});
  }, []);

  if (loading) {
    return <div className="text-gray-500 text-sm">Loading...</div>;
  }

  if (callerRole !== 'superuser') return null;

  const assignRole = async () => {
    if (!selectedUser) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/dynamics-explorer/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userProfileId: parseInt(selectedUser), role: selectedRole }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to assign role');
      }
      setMessage({ type: 'success', text: 'Role assigned' });
      setSelectedUser('');
      fetchRoles();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const removeRole = async (userProfileId, userName) => {
    if (!confirm(`Remove role from ${userName}? They will revert to read-only.`)) return;
    setMessage(null);
    try {
      const res = await fetch('/api/dynamics-explorer/roles', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userProfileId }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to remove role');
      }
      setMessage({ type: 'success', text: `Role removed from ${userName}` });
      fetchRoles();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    }
  };

  // Users not yet in the roles table
  const assignedIds = new Set((roles || []).map(r => r.user_profile_id));
  const availableUsers = users.filter(u => !assignedIds.has(u.id) && u.isActive);

  return (
    <>
      {message && (
        <div className={`mb-4 px-3 py-2 rounded-lg text-sm ${
          message.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'
        }`}>
          {message.text}
        </div>
      )}

      {/* Current roles */}
      {roles && roles.length > 0 ? (
        <div className="overflow-x-auto mb-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 px-2 font-medium text-gray-600">User</th>
                <th className="text-left py-2 px-2 font-medium text-gray-600">Role</th>
                <th className="text-left py-2 px-2 font-medium text-gray-600">Granted By</th>
                <th className="text-right py-2 px-2 font-medium text-gray-600"></th>
              </tr>
            </thead>
            <tbody>
              {roles.map(role => (
                <tr key={role.id} className="border-b border-gray-100">
                  <td className="py-2 px-2 text-gray-900">{role.user_name}</td>
                  <td className="py-2 px-2">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                      role.role === 'superuser' ? 'bg-purple-100 text-purple-800' :
                      role.role === 'read_write' ? 'bg-blue-100 text-blue-800' :
                      'bg-gray-100 text-gray-600'
                    }`}>
                      {role.role}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-gray-500">{role.granted_by_name || '-'}</td>
                  <td className="py-2 px-2 text-right">
                    <button
                      onClick={() => removeRole(role.user_profile_id, role.user_name)}
                      className="text-xs text-red-600 hover:text-red-800 transition-colors"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-gray-500 text-sm mb-6">No roles assigned yet.</p>
      )}

      {/* Assign role form */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs font-medium text-gray-600 mb-1">User</label>
          <select
            value={selectedUser}
            onChange={e => setSelectedUser(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-400 focus:border-gray-400"
          >
            <option value="">Select user...</option>
            {availableUsers.map(u => (
              <option key={u.id} value={u.id}>{u.name}{u.azureEmail ? ` (${u.azureEmail})` : ''}</option>
            ))}
            {/* Also allow re-assigning existing users to change their role */}
            {roles && roles.length > 0 && (
              <optgroup label="Change existing role">
                {roles.map(r => (
                  <option key={`existing-${r.user_profile_id}`} value={r.user_profile_id}>
                    {r.user_name} (currently {r.role})
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
        <div className="min-w-[140px]">
          <label className="block text-xs font-medium text-gray-600 mb-1">Role</label>
          <select
            value={selectedRole}
            onChange={e => setSelectedRole(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-400 focus:border-gray-400"
          >
            {ROLE_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <button
          onClick={assignRole}
          disabled={!selectedUser || saving}
          className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? 'Assigning...' : 'Assign'}
        </button>
      </div>
    </>
  );
}

// --- Section D: App Access Management ---
function AppAccessSection() {
  const [serverGrants, setServerGrants] = useState(null); // truth from API
  const [localGrants, setLocalGrants] = useState({});      // editable working copy: { userId: Set(appKeys) }
  const [allApps, setAllApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isSuperuser, setIsSuperuser] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  // Build the server-state map and local working copy
  const applyServerData = (data) => {
    setServerGrants(data.grants || []);
    setAllApps(data.allApps || []);
    const local = {};
    (data.grants || []).forEach(g => {
      local[g.user_profile_id] = new Set(g.apps || []);
    });
    setLocalGrants(local);
  };

  const fetchGrants = () => {
    fetch('/api/app-access?all=true')
      .then(r => {
        if (r.status === 403 || r.status === 401) {
          setIsSuperuser(false);
          return null;
        }
        return r.json();
      })
      .then(data => {
        if (!data) return;
        setIsSuperuser(true);
        applyServerData(data);
      })
      .catch(() => setIsSuperuser(false))
      .finally(() => setLoading(false));
  };

  // Mount-only initial load; fetchGrants reads no reactive state (setters only).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchGrants(); }, []);

  if (loading) {
    return <div className="text-gray-500 text-sm">Loading...</div>;
  }

  if (!isSuperuser) return null;

  // Toggle a single checkbox in local state
  const toggle = (userId, appKey) => {
    setLocalGrants(prev => {
      const next = { ...prev };
      const set = new Set(next[userId] || []);
      if (set.has(appKey)) set.delete(appKey); else set.add(appKey);
      next[userId] = set;
      return next;
    });
  };

  // Select / deselect all apps for a user
  const toggleAll = (userId) => {
    setLocalGrants(prev => {
      const next = { ...prev };
      const current = next[userId] || new Set();
      next[userId] = current.size === allApps.length ? new Set() : new Set(allApps);
      return next;
    });
  };

  // Compute diff between server state and local edits
  const computeDiff = () => {
    const changes = []; // { userId, toGrant: [], toRevoke: [] }
    if (!serverGrants) return changes;
    for (const grant of serverGrants) {
      const uid = grant.user_profile_id;
      const serverSet = new Set(grant.apps || []);
      const localSet = localGrants[uid] || new Set();
      const toGrant = [...localSet].filter(k => !serverSet.has(k));
      const toRevoke = [...serverSet].filter(k => !localSet.has(k));
      if (toGrant.length > 0 || toRevoke.length > 0) {
        changes.push({ userId: uid, toGrant, toRevoke });
      }
    }
    return changes;
  };

  const diff = computeDiff();
  const hasChanges = diff.length > 0;

  // Save all pending changes
  const saveAll = async () => {
    setSaving(true);
    setMessage(null);
    try {
      for (const { userId, toGrant, toRevoke } of diff) {
        if (toGrant.length > 0) {
          const res = await fetch('/api/app-access', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userProfileId: userId, apps: toGrant }),
          });
          if (!res.ok) throw new Error((await res.json()).error || 'Grant failed');
        }
        if (toRevoke.length > 0) {
          const res = await fetch('/api/app-access', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userProfileId: userId, apps: toRevoke }),
          });
          if (!res.ok) throw new Error((await res.json()).error || 'Revoke failed');
        }
      }
      const totalGrants = diff.reduce((n, d) => n + d.toGrant.length, 0);
      const totalRevokes = diff.reduce((n, d) => n + d.toRevoke.length, 0);
      const parts = [];
      if (totalGrants) parts.push(`${totalGrants} granted`);
      if (totalRevokes) parts.push(`${totalRevokes} revoked`);
      setMessage({ type: 'success', text: `Saved: ${parts.join(', ')}` });
      fetchGrants(); // refresh from server
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  };

  // Discard local edits
  const discardChanges = () => {
    const local = {};
    (serverGrants || []).forEach(g => {
      local[g.user_profile_id] = new Set(g.apps || []);
    });
    setLocalGrants(local);
    setMessage(null);
  };

  // Soft-archive a user (sets is_active=false). The row stays for audit
  // integrity but auth/app-access lookups exclude inactive profiles.
  const removeUser = async (userId, userName) => {
    if (!confirm(`Remove ${userName || `user ${userId}`}? They will lose login and app access. The profile row is preserved for audit history.`)) return;
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/users?id=${userId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Remove failed');
      setMessage({ type: 'success', text: `Removed ${data.name || userName || userId}` });
      fetchGrants();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    }
  };

  // Short labels for column headers
  const appShortNames = {};
  APP_REGISTRY.forEach(app => {
    // Use first word or abbreviation to keep columns narrow
    appShortNames[app.key] = app.name;
  });

  return (
    <>
      <div className="flex items-center justify-end mb-4">
        <div className="flex items-center gap-2">
          {hasChanges && (
            <button
              onClick={discardChanges}
              className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Discard
            </button>
          )}
          <button
            onClick={saveAll}
            disabled={!hasChanges || saving}
            className="px-4 py-1.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? 'Saving...' : hasChanges ? `Save Changes` : 'No Changes'}
          </button>
        </div>
      </div>

      {message && (
        <div className={`mb-4 px-3 py-2 rounded-lg text-sm ${
          message.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'
        }`}>
          {message.text}
        </div>
      )}

      {serverGrants && serverGrants.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 px-2 font-medium text-gray-600 sticky left-0 bg-white z-10 min-w-[140px]">User</th>
                {allApps.map(appKey => (
                  <th key={appKey} className="py-2 px-1 font-medium text-gray-500 text-center min-w-[40px]" title={appShortNames[appKey]}>
                    <div className="writing-mode-vertical text-xs leading-tight" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', whiteSpace: 'nowrap', maxHeight: '120px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {appShortNames[appKey]}
                    </div>
                  </th>
                ))}
                <th className="py-2 px-2 text-center font-medium text-gray-500 text-xs min-w-[50px]">All</th>
                <th className="py-2 px-2 text-center font-medium text-gray-500 text-xs min-w-[60px]"></th>
              </tr>
            </thead>
            <tbody>
              {serverGrants.map(grant => {
                const uid = grant.user_profile_id;
                const localSet = localGrants[uid] || new Set();
                const serverSet = new Set(grant.apps || []);
                const allChecked = localSet.size === allApps.length;
                return (
                  <tr key={uid} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2 px-2 text-gray-900 whitespace-nowrap sticky left-0 bg-white z-10">
                      <div className="text-sm font-medium">{grant.user_name}</div>
                      {grant.azure_email && (
                        <div className="text-xs text-gray-400">{grant.azure_email}</div>
                      )}
                    </td>
                    {allApps.map(appKey => {
                      const checked = localSet.has(appKey);
                      const changed = checked !== serverSet.has(appKey);
                      return (
                        <td key={appKey} className="py-2 px-1 text-center">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggle(uid, appKey)}
                            className={`rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer ${changed ? 'ring-2 ring-amber-400' : ''}`}
                          />
                        </td>
                      );
                    })}
                    <td className="py-2 px-2 text-center">
                      <input
                        type="checkbox"
                        checked={allChecked}
                        onChange={() => toggleAll(uid)}
                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        title={allChecked ? 'Deselect all' : 'Select all'}
                      />
                    </td>
                    <td className="py-2 px-2 text-center">
                      <button
                        onClick={() => removeUser(uid, grant.user_name)}
                        title="Soft-archive this user (sets is_active=false). The row is preserved for audit history."
                        className="text-xs text-red-600 hover:text-red-800"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-gray-500 text-sm">No users found.</p>
      )}

      {hasChanges && (
        <p className="text-xs text-amber-600 mt-3">
          Unsaved changes for {diff.length} user(s). Changed checkboxes are highlighted.
        </p>
      )}
    </>
  );
}

// --- Section D2: Dynamics Explorer Feedback ---
function DynamicsFeedbackSection() {
  const [feedback, setFeedback] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ status: '', type: '' });
  const [expandedId, setExpandedId] = useState(null);
  const [actionInProgress, setActionInProgress] = useState(null);

  const fetchFeedback = (params = {}) => {
    const qs = new URLSearchParams();
    if (params.status || filter.status) qs.set('status', params.status || filter.status);
    if (params.type || filter.type) qs.set('type', params.type || filter.type);
    fetch(`/api/dynamics-explorer/feedback?${qs}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        setFeedback(data?.feedback || []);
        setSummary(data?.summary || null);
      })
      .catch(() => setFeedback([]))
      .finally(() => setLoading(false));
  };

  // Mount-only initial load; later filter changes call fetchFeedback explicitly.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchFeedback(); }, []);

  const handleAction = async (id, status) => {
    setActionInProgress(id);
    try {
      const res = await fetch('/api/dynamics-explorer/feedback', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      if (res.ok) fetchFeedback();
    } catch {}
    setActionInProgress(null);
  };

  const applyFilter = (key, value) => {
    const newFilter = { ...filter, [key]: value };
    setFilter(newFilter);
    setLoading(true);
    fetchFeedback(newFilter);
  };

  const typeIcon = (type) => type === 'positive' ? '\u25B2' : '\u25BC';
  const typeColor = (type) => type === 'positive' ? 'text-green-600' : 'text-red-600';

  const categoryLabels = {
    wrong_answer: 'Wrong answer',
    no_results: 'No results',
    incomplete: 'Incomplete',
    other: 'Other',
  };

  if (loading) {
    return (
      <Card>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Dynamics Explorer Feedback</h2>
        <div className="text-gray-500 text-sm">Loading feedback...</div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Dynamics Explorer Feedback</h2>
        {summary && (
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span>{summary.new || 0} new</span>
            <span className="text-green-600">{summary.positive || 0} positive</span>
            <span className="text-red-600">{summary.negative || 0} negative</span>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-3">
        <select
          value={filter.status}
          onChange={e => applyFilter('status', e.target.value)}
          className="text-xs border border-gray-300 rounded px-2 py-1"
        >
          <option value="">All statuses</option>
          <option value="new">New</option>
          <option value="reviewed">Reviewed</option>
          <option value="resolved">Resolved</option>
        </select>
        <select
          value={filter.type}
          onChange={e => applyFilter('type', e.target.value)}
          className="text-xs border border-gray-300 rounded px-2 py-1"
        >
          <option value="">All types</option>
          <option value="negative">Negative</option>
          <option value="positive">Positive</option>
        </select>
      </div>

      {feedback.length === 0 ? (
        <p className="text-gray-500 text-sm">No feedback records found.</p>
      ) : (
        <div className="space-y-2">
          {feedback.map(fb => (
            <div key={fb.id} className="p-3 rounded-lg border border-gray-200 bg-gray-50">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 flex-1 min-w-0">
                  <span className={`text-lg flex-shrink-0 ${typeColor(fb.feedback_type)}`}>
                    {typeIcon(fb.feedback_type)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-gray-900 truncate max-w-xs" title={fb.query_text}>
                        {fb.query_text ? `"${fb.query_text.slice(0, 80)}${fb.query_text.length > 80 ? '...' : ''}"` : '(no query)'}
                      </span>
                      {fb.category && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700">
                          {categoryLabels[fb.category] || fb.category}
                        </span>
                      )}
                      {fb.auto_detected && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                          auto-detected
                        </span>
                      )}
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-600">
                        {fb.status}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {fb.user_name || 'Unknown'} &middot; {new Date(fb.created_at).toLocaleString()}
                    </div>
                    {fb.user_note && (
                      <div className="text-xs text-gray-700 mt-1 italic">
                        &ldquo;{fb.user_note}&rdquo;
                      </div>
                    )}
                    {expandedId === fb.id && fb.conversation_context && (
                      <div className="mt-2 text-xs space-y-1">
                        {fb.conversation_context.map((turn, i) => (
                          <div key={i} className={`p-2 rounded ${turn.role === 'user' ? 'bg-blue-50' : 'bg-white'}`}>
                            <span className="font-semibold text-gray-600">{turn.role === 'user' ? 'User' : 'Assistant'}:</span>
                            <span className="ml-1 text-gray-700">{(turn.content || '').slice(0, 500)}{(turn.content || '').length > 500 ? '...' : ''}</span>
                            {turn.rounds && <span className="text-gray-400 ml-1">({turn.rounds} rounds)</span>}
                          </div>
                        ))}
                      </div>
                    )}
                    {fb.admin_note && (
                      <div className="text-xs text-blue-700 mt-1">
                        Admin: {fb.admin_note}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => setExpandedId(expandedId === fb.id ? null : fb.id)}
                    className="p-1 text-xs text-gray-500 hover:text-gray-700 rounded"
                    title={expandedId === fb.id ? 'Collapse' : 'Show conversation'}
                  >
                    {expandedId === fb.id ? '\u25B2' : '\u25BC'}
                  </button>
                  {fb.status === 'new' && (
                    <button
                      onClick={() => handleAction(fb.id, 'reviewed')}
                      disabled={actionInProgress === fb.id}
                      className="px-2 py-1 text-xs bg-white hover:bg-gray-100 rounded border border-gray-300 text-gray-700 transition-colors disabled:opacity-50"
                    >
                      Review
                    </button>
                  )}
                  {fb.status !== 'resolved' && (
                    <button
                      onClick={() => handleAction(fb.id, 'resolved')}
                      disabled={actionInProgress === fb.id}
                      className="px-2 py-1 text-xs bg-white hover:bg-gray-100 rounded border border-gray-300 text-gray-700 transition-colors disabled:opacity-50"
                    >
                      Resolve
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// --- Dynamics Identity Reconciliation ---
function DynamicsIdentitySection() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reconciling, setReconciling] = useState(false);
  const [message, setMessage] = useState(null);

  const fetchUsers = () => {
    setLoading(true);
    fetch('/api/user-profiles?all=true')
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (!data) return;
        setUsers((data.profiles || []).filter(u => u.isActive));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchUsers(); }, []);

  const reconcile = async (all = false) => {
    setReconciling(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/reconcile-identities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || 'Reconcile failed');
      const s = data.summary || {};
      const parts = [];
      if (s.linked) parts.push(`${s.linked} linked`);
      if (s.unchanged) parts.push(`${s.unchanged} unchanged`);
      if (s.no_match) parts.push(`${s.no_match} no match`);
      if (s.disabled) parts.push(`${s.disabled} disabled`);
      if (s.error) parts.push(`${s.error} errors`);
      setMessage({ type: 'success', text: `Scanned ${data.totalScanned}: ${parts.join(', ') || 'no changes'}` });
      fetchUsers();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setReconciling(false);
    }
  };

  if (loading) {
    return <div className="text-gray-500 text-sm">Loading...</div>;
  }

  if (users.length === 0) return null; // not superuser (filtered list returned empty)

  const linked = users.filter(u => u.dynamicsSystemuserId).length;
  const formatDate = (d) => d ? new Date(d).toLocaleDateString() : 'never';

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-gray-500">{linked} of {users.length} active users linked to a Dynamics systemuser.</p>
        <div className="flex gap-2">
          <button
            onClick={() => reconcile(false)}
            disabled={reconciling}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40"
          >
            {reconciling ? 'Reconciling...' : 'Reconcile stale'}
          </button>
          <button
            onClick={() => reconcile(true)}
            disabled={reconciling}
            className="px-3 py-1.5 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-40"
          >
            Reconcile all
          </button>
        </div>
      </div>

      {message && (
        <div className={`mb-3 px-3 py-2 rounded-lg text-sm ${
          message.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'
        }`}>
          {message.text}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 px-2 font-medium text-gray-600">User</th>
              <th className="text-left py-2 px-2 font-medium text-gray-600">Status</th>
              <th className="text-left py-2 px-2 font-medium text-gray-600">Systemuser ID</th>
              <th className="text-left py-2 px-2 font-medium text-gray-600">Last checked</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} className="border-b border-gray-100">
                <td className="py-2 px-2 text-gray-900">{u.displayName || u.name}</td>
                <td className="py-2 px-2">
                  {u.dynamicsSystemuserId ? (
                    <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">✓ linked</span>
                  ) : (
                    <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">not linked</span>
                  )}
                </td>
                <td className="py-2 px-2 text-gray-500 font-mono text-xs">{u.dynamicsSystemuserId || '-'}</td>
                <td className="py-2 px-2 text-gray-500 text-xs">{formatDate(u.dynamicsReconciledAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// --- Section E: Quick Links ---
function QuickLinksSection() {
  const links = [
    { name: 'Vercel Dashboard', url: 'https://vercel.com/dashboard', description: 'Deployments, logs, environment' },
    { name: 'Anthropic Console', url: 'https://console.anthropic.com', description: 'API billing and usage' },
    { name: 'Credentials Runbook', url: '/docs/CREDENTIALS_RUNBOOK.md', description: 'Secret rotation, diagnostics', internal: true },
  ];

  return (
    <Card>
      <h2 className="text-lg font-semibold text-gray-900 mb-3">Quick Links</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {links.map(link => (
          <a
            key={link.name}
            href={link.url}
            target={link.internal ? undefined : '_blank'}
            rel={link.internal ? undefined : 'noopener noreferrer'}
            className="block p-3 rounded-lg border border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-colors"
          >
            <div className="text-sm font-medium text-gray-900">{link.name}</div>
            <div className="text-xs text-gray-500 mt-1">{link.description}</div>
          </a>
        ))}
      </div>
    </Card>
  );
}

// --- Alert Recipients ---
//
// UI for the per-category alert routing config persisted as
// `alertRecipientsByCategory` in wmkf_appsystemsettings. Free-form category
// names allowed; SEED_CATEGORIES from the server provides discoverability
// scaffolding only.
function AlertRecipientsSection() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [seed, setSeed] = useState([]);
  const [fallback, setFallback] = useState([]);
  const [rows, setRows] = useState([]); // [{ category, description, emails: string[], newEmail: '' }]
  const [newCategory, setNewCategory] = useState('');
  const [error, setError] = useState(null);
  const [savedAt, setSavedAt] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/alert-recipients');
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to load');
      const seedCats = data.seedCategories || [];
      const config = data.config || {};
      setSeed(seedCats);
      setFallback(data.fallbackRoster || []);

      // Merge: every seed category appears (even if empty), plus any custom
      // categories that exist in the saved config.
      const merged = [];
      const seenKeys = new Set();
      for (const s of seedCats) {
        merged.push({
          category: s.key,
          description: s.description,
          emails: config[s.key] || [],
          newEmail: '',
        });
        seenKeys.add(s.key);
      }
      for (const [cat, emails] of Object.entries(config)) {
        if (seenKeys.has(cat)) continue;
        merged.push({ category: cat, description: '', emails, newEmail: '' });
      }
      setRows(merged);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const addEmail = (idx) => {
    setRows((prev) => {
      const copy = [...prev];
      const target = { ...copy[idx] };
      const e = (target.newEmail || '').trim().toLowerCase();
      if (!e) return prev;
      if (target.emails.includes(e)) {
        target.newEmail = '';
        copy[idx] = target;
        return copy;
      }
      target.emails = [...target.emails, e];
      target.newEmail = '';
      copy[idx] = target;
      return copy;
    });
  };

  const removeEmail = (idx, email) => {
    setRows((prev) => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], emails: copy[idx].emails.filter((e) => e !== email) };
      return copy;
    });
  };

  const updateNew = (idx, val) => {
    setRows((prev) => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], newEmail: val };
      return copy;
    });
  };

  const addCategory = () => {
    const key = newCategory.trim().toLowerCase();
    if (!key) return;
    if (rows.some((r) => r.category === key)) {
      setNewCategory('');
      return;
    }
    setRows((prev) => [...prev, { category: key, description: '', emails: [], newEmail: '' }]);
    setNewCategory('');
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      // Build config: drop categories with no emails (server normalizes too,
      // but doing it here keeps the request shape tidy).
      const config = {};
      for (const r of rows) {
        if (r.emails.length) config[r.category] = r.emails;
      }
      const res = await fetch('/api/admin/alert-recipients', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
      });
      const data = await res.json();
      if (!res.ok) {
        const detail = Array.isArray(data?.details) ? `: ${data.details.join('; ')}` : '';
        throw new Error((data?.error || 'Save failed') + detail);
      }
      setSavedAt(new Date());
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        Each alert is tagged with a category. Categories with no addresses listed fall
        back to <code className="text-xs">default</code>, then to the active superuser
        roster (currently:{' '}
        {fallback.length ? <strong>{fallback.join(', ')}</strong> : <em>none</em>}).
      </p>

      <div className="space-y-3">
        {rows.map((row, idx) => (
          <div key={row.category} className="border rounded-md p-3 bg-gray-50">
            <div className="flex items-baseline justify-between mb-1">
              <div>
                <code className="text-sm font-semibold text-gray-900">{row.category}</code>
                {row.description && (
                  <span className="ml-2 text-xs text-gray-500">— {row.description}</span>
                )}
              </div>
              {row.emails.length === 0 && (
                <span className="text-xs text-gray-400 italic">
                  uses {row.category === 'default' ? 'superuser roster' : 'default'}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2 mb-2">
              {row.emails.map((e) => (
                <span
                  key={e}
                  className="inline-flex items-center gap-1 px-2 py-1 bg-white border rounded text-xs"
                >
                  {e}
                  <button
                    type="button"
                    onClick={() => removeEmail(idx, e)}
                    className="text-gray-400 hover:text-red-600"
                    title={`Remove ${e}`}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="email"
                placeholder="add address…"
                value={row.newEmail}
                onChange={(e) => updateNew(idx, e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addEmail(idx); } }}
                className="flex-1 px-2 py-1 border rounded text-xs"
              />
              <button
                type="button"
                onClick={() => addEmail(idx)}
                className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs"
              >
                Add
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-2 items-center pt-2 border-t">
        <input
          type="text"
          placeholder="new category name (lowercase, no spaces)"
          value={newCategory}
          onChange={(e) => setNewCategory(e.target.value.replace(/[^a-z0-9_-]/gi, ''))}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCategory(); } }}
          className="flex-1 px-2 py-1 border rounded text-sm"
        />
        <button
          type="button"
          onClick={addCategory}
          className="px-3 py-1 border border-gray-300 hover:bg-gray-100 rounded text-sm"
        >
          + Add category
        </button>
      </div>

      <div className="flex items-center justify-between pt-2">
        <div className="text-xs text-gray-500">
          {error && <span className="text-red-600">{error}</span>}
          {!error && savedAt && <span className="text-green-700">Saved {savedAt.toLocaleTimeString()}.</span>}
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded text-sm font-medium"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}

// Collapsible Card wrapper. Renders a Card with an always-visible header
// + chevron toggle; children lazy-mount on first open and stay mounted
// after. Used for heavyweight admin sections whose data fetches are
// expensive or rarely consulted. Pass `bare`-styled children (i.e.
// children that DON'T render their own outer Card).
function CollapsibleCard({ title, subtitle, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  const [everOpened, setEverOpened] = useState(defaultOpen);
  const toggle = () => {
    setOpen(o => {
      const next = !o;
      if (next) setEverOpened(true);
      return next;
    });
  };
  return (
    <Card>
      <button
        onClick={toggle}
        className="w-full flex items-center justify-between text-left"
      >
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
        </div>
        <span className="text-xs text-gray-500 ml-3">{open ? '▼' : '▶'}</span>
      </button>
      {everOpened && <div className={`mt-4 ${open ? '' : 'hidden'}`}>{children}</div>}
    </Card>
  );
}

function HonorariumAmountSection() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [amount, setAmount] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [malformed, setMalformed] = useState(false);
  const [error, setError] = useState(null);
  const [savedAt, setSavedAt] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/honorarium-amount');
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to load');
      setAmount(String(data.amount ?? ''));
      setIsDefault(!!data.isDefault);
      setMalformed(!!data.malformed);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const n = Number(String(amount).trim());
      if (!Number.isFinite(n) || n <= 0) throw new Error('Enter a positive number');
      const res = await fetch('/api/admin/honorarium-amount', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: n }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Save failed');
      setSavedAt(new Date());
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>;

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">
        The single reviewer-honorarium amount (USD). Read live when a reviewer accepts
        (the honorarium record + BILL onboarding) and when Review Manager renders invitation
        emails. Changing it affects future honoraria only; existing records keep the amount
        stamped at creation.
      </p>
      {isDefault && (
        <p className="text-xs text-amber-700">
          No value is set — the documented default of $250 is in effect until you save one.
        </p>
      )}
      {malformed && (
        <p className="text-xs text-red-700">
          The stored value is not a valid positive number; save a correct value.
        </p>
      )}
      <div className="flex items-center gap-2">
        <span className="text-gray-500">$</span>
        <input
          type="number"
          min="1"
          step="1"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-32 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {savedAt && <span className="text-xs text-green-700">Saved</span>}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

// --- Main Page ---
export default function AdminDashboard() {
  return (
    <Layout title="Admin Dashboard" description="System administration and usage analytics">
      <PageHeader
        title="Admin Dashboard"
        subtitle="Service health, API usage analytics, and system administration"
      />

      <div className="py-8 space-y-6">
        <HealthSection />
        <HealthHistorySection />
        <SystemAlertsSection />
        <MaintenanceSection />
        <SecretExpirationSection />
        <CollapsibleCard title="Alert Recipients" subtitle="Route system alerts to per-category email addresses">
          <AlertRecipientsSection />
        </CollapsibleCard>
        <UsageSection />
        <CollapsibleCard title="Model Configuration">
          <ModelConfigSection />
        </CollapsibleCard>
        <CollapsibleCard title="Reviewer Honorarium Amount" subtitle="Single ground-truth amount for reviewer honoraria">
          <HonorariumAmountSection />
        </CollapsibleCard>
        <CollapsibleCard title="Policies">
          <PoliciesSection />
        </CollapsibleCard>
        <CollapsibleCard title="Prompt Templates" subtitle="Edit + publish versioned AI prompt bodies (Dataverse wmkf_ai_prompt)">
          <PromptTemplatesSection />
        </CollapsibleCard>
        <CollapsibleCard title="Role Management">
          <RoleManagementSection />
        </CollapsibleCard>
        <CollapsibleCard title="App Access Management">
          <AppAccessSection />
        </CollapsibleCard>
        <CollapsibleCard title="Dynamics Identity Linkage">
          <DynamicsIdentitySection />
        </CollapsibleCard>
        <DynamicsFeedbackSection />
        <QuickLinksSection />
      </div>
    </Layout>
  );
}
