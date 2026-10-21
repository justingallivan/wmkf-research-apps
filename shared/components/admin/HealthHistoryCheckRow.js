/** A health history check and its optional service details; expansion is parent-owned. */
import { Fragment } from 'react';
import { StatusBadge, SERVICE_LABELS, getFailingServices } from './health-status';

export default function HealthHistoryCheckRow({ check, expandedCheckId, setExpandedCheckId }) {
  const failing = getFailingServices(check.services);
  const isExpanded = expandedCheckId === check.id;
  return (
    <Fragment>
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
}
