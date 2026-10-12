import { useEffect, useState } from 'react';
import { Card } from '../Layout';
import ReviewerRepairAlertDetails from './ReviewerRepairAlertDetails';
import { requestEnvelope } from '../../utils/api-request';

// --- Section A3: System Alerts ---
export default function SystemAlertsSection() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionInProgress, setActionInProgress] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  const fetchAlerts = () => {
    requestEnvelope('/api/admin/alerts')
      .then(envelope => envelope.ok ? envelope.data : null)
      .then(data => setAlerts(data?.alerts || []))
      .catch(() => setAlerts([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchAlerts(); }, []);

  const handleAction = async (id, action) => {
    setActionInProgress(id);
    try {
      const envelope = await requestEnvelope('/api/admin/alerts', {
        method: 'PATCH',
        body: { id, action },
      });
      if (envelope.ok) fetchAlerts();
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
    <div id="system-alerts" className="scroll-mt-6">
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
                      <span className="rounded bg-white/50 px-1.5 py-0.5 text-xs text-gray-600">
                        {alert.alert_type.replace(/_/g, ' ')}
                      </span>
                      {alert.status === 'acknowledged' && (
                        <span className="rounded bg-white/50 px-1.5 py-0.5 text-xs text-gray-500">
                          ack&apos;d by {alert.acknowledged_by_name}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-600 mt-0.5">
                      {new Date(alert.created_at).toLocaleString()}
                      {alert.source && ` \u00b7 ${alert.source}`}
                    </div>
                    {expandedId === alert.id && (
                      alert.alert_type === 'reviewer_address_repair_requested' ? (
                        <ReviewerRepairAlertDetails alert={alert} />
                      ) : (
                        <div className="mt-2 text-xs text-gray-700 space-y-1">
                          {alert.message && <p>{alert.message}</p>}
                          {alert.metadata && (
                            <pre className="max-h-40 overflow-x-auto rounded bg-white/50 p-2 text-xs">
                              {JSON.stringify(alert.metadata, null, 2)}
                            </pre>
                          )}
                        </div>
                      )
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
    </div>
  );
}

