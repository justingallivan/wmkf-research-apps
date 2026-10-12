import { useEffect, useState } from 'react';
import { Card } from '../Layout';
import { requestEnvelope } from '../../utils/api-request';
import { StatusBadge, SERVICE_LABELS } from './health-status';

// --- Section A: Service Health ---
export default function HealthSection() {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedService, setExpandedService] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    // D1 fix: a non-2xx response now routes through the same error path a
    // network failure already used, instead of being read as if it were
    // success (docs/plans/CLIENT_REQUEST_LAYER_D1_UNGUARDED_RESPONSES_2026-09-20.md).
    requestEnvelope('/api/health')
      .then((envelope) => {
        if (!envelope.ok) throw envelope.error;
        return envelope.data;
      })
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
          type="button"
          onClick={() => setDetailsOpen(o => !o)}
          aria-expanded={detailsOpen}
          aria-controls="service-health-details"
          className="min-h-11 rounded-lg px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
        >
          {detailsOpen ? 'Hide details' : 'Show details'}
        </button>
      </div>
      {detailsOpen && (
      <div id="service-health-details" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {services.map(([key, svc]) => {
          const isExpanded = expandedService === key;
          const hasOverflow = svc.message || svc.detail;
          return (
            <div
              key={key}
              className={`rounded-lg border ${
                svc.status === 'ok' ? 'border-green-200 bg-green-50' :
                svc.status === 'error' ? 'border-red-200 bg-red-50' :
                svc.status === 'warning' ? 'border-yellow-200 bg-yellow-50' :
                'border-gray-200 bg-gray-50'
              }`}
            >
              {hasOverflow ? (
                <button
                  type="button"
                  onClick={() => setExpandedService(isExpanded ? null : key)}
                  aria-expanded={isExpanded}
                  className="block w-full rounded-lg p-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-500"
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-900">{SERVICE_LABELS[key] || key}</span>
                    <StatusBadge status={svc.status} />
                  </div>
                  {svc.message && (
                    <p className={`text-xs text-gray-600 ${isExpanded ? 'break-words' : 'truncate'}`} title={svc.message}>{svc.message}</p>
                  )}
                  {svc.detail && (
                    <p className={`text-xs text-gray-500 ${isExpanded ? 'break-words' : 'truncate'}`} title={svc.detail}>{svc.detail}</p>
                  )}
                </button>
              ) : (
                <div className="p-3">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-900">{SERVICE_LABELS[key] || key}</span>
                    <StatusBadge status={svc.status} />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      )}
      {health.error && (
        <p className="text-sm text-red-700 mt-3">{health.error}</p>
      )}
      {health.timestamp && (
        <p className="text-xs text-gray-400 mt-3">Checked at {new Date(health.timestamp).toLocaleString()}</p>
      )}
    </Card>
  );
}

