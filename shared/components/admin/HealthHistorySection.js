import { Fragment, useEffect, useState } from 'react';
import { Card } from '../Layout';
import { requestEnvelope } from '../../utils/api-request';
import { StatusBadge, SERVICE_LABELS, getFailingServices } from './health-status';

// --- Section A2: Health Check History ---
export default function HealthHistorySection() {
  const [history, setHistory] = useState(null);
  const [hours, setHours] = useState(24);
  const [loading, setLoading] = useState(true);
  const [expandedCheckId, setExpandedCheckId] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    requestEnvelope(`/api/admin/health-history?hours=${hours}`)
      .then(envelope => envelope.ok ? envelope.data : null)
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
              type="button"
              key={h}
              onClick={() => {
                setLoading(true);
                setHours(h);
              }}
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
          type="button"
          onClick={() => setDetailsOpen(o => !o)}
          aria-expanded={detailsOpen}
          aria-controls="health-history-details"
          className="min-h-11 rounded-lg px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
        >
          {detailsOpen ? 'Hide recent checks' : 'Show recent checks'}
        </button>
      </div>
      {detailsOpen && (
      <div id="health-history-details" className="overflow-x-auto max-h-96 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 px-2 font-medium text-gray-600">Time</th>
              <th className="text-left py-2 px-2 font-medium text-gray-600">Status</th>
              <th className="text-right py-2 px-2 font-medium text-gray-600">Response</th>
              <th className="text-left py-2 px-2 font-medium text-gray-600">Source</th>
              <th className="text-right py-2 px-2 font-medium text-gray-600">Details</th>
            </tr>
          </thead>
          <tbody>
            {checks.slice(0, 50).map(check => {
              const failing = getFailingServices(check.services);
              const isExpanded = expandedCheckId === check.id;
              return (
                <Fragment key={check.id}>
                  <tr className="border-b border-gray-100">
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
                    <td className="py-1.5 px-2 text-right">
                      <button
                        type="button"
                        onClick={() => setExpandedCheckId(isExpanded ? null : check.id)}
                        aria-expanded={isExpanded}
                        className="min-h-9 rounded-md px-2 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
                      >
                        {isExpanded ? 'Hide' : 'Show'}
                      </button>
                    </td>
                  </tr>
                  {isExpanded && check.services && (
                    <tr className="border-b border-gray-100">
                      <td colSpan={5} className="p-3 bg-gray-50">
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

