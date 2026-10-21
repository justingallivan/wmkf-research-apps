/** Controlled display and actions for an individual operational event. */
export const severityColors = {
  critical: 'bg-red-100 text-red-800 border-red-200',
  error: 'bg-red-50 text-red-700 border-red-200',
  warning: 'bg-yellow-50 text-yellow-800 border-yellow-200',
  info: 'bg-blue-50 text-blue-700 border-blue-200',
};

export const severityDots = {
  critical: 'bg-red-500',
  error: 'bg-red-400',
  warning: 'bg-yellow-400',
  info: 'bg-blue-400',
};

// Every status renders exactly one badge; unknown values fall through to a
// visible gray badge rather than disappearing.
const statusBadges = {
  open: 'bg-red-100 text-red-700',
  recovered: 'bg-green-100 text-green-700',
  resolved: 'bg-gray-200 text-gray-600',
  superseded: 'bg-gray-100 text-gray-500',
  info: 'bg-blue-100 text-blue-600',
};

export default function OperationalEventCard({ event, expandedId, setExpandedId, actionInProgress, handleAction }) {
  return (
    <div
      className={`p-3 rounded-lg border ${severityColors[event.severity] || severityColors.info}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${severityDots[event.severity] || 'bg-gray-400'}`} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium break-all">{event.summary}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusBadges[event.status] || 'bg-gray-100 text-gray-500'}`}>
                {event.status}
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/50 text-gray-600">
                {String(event.event_type || '').replace(/_/g, ' ')}
              </span>
              {event.occurrence_count > 1 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/50 text-gray-600">
                  ×{event.occurrence_count}
                </span>
              )}
              {event.transient === true && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/50 text-gray-500">
                  transient
                </span>
              )}
            </div>
            <div className="text-xs text-gray-600 mt-0.5">
              {new Date(event.last_occurred_at).toLocaleString()}
              {` · ${event.source}`}
              {event.subsystem && ` · ${event.subsystem}`}
              {event.stage && ` · ${event.stage}`}
              {event.request_number && ` · request ${event.request_number}`}
            </div>
            {expandedId === event.id && (
              <div className="mt-2 text-xs text-gray-700 space-y-1">
                {event.correlation_id && <p>Correlation: {event.correlation_id}</p>}
                {event.resolution_note && <p>Note: {event.resolution_note}</p>}
                {event.entity_refs && (
                  <pre className="bg-white/50 p-2 rounded text-[11px] overflow-x-auto max-h-32">
                    {JSON.stringify(event.entity_refs, null, 2)}
                  </pre>
                )}
                {event.metadata && (
                  <pre className="bg-white/50 p-2 rounded text-[11px] overflow-x-auto max-h-40">
                    {JSON.stringify(event.metadata, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => setExpandedId(expandedId === event.id ? null : event.id)}
            className="p-1 text-xs text-gray-500 hover:text-gray-700 rounded"
            title={expandedId === event.id ? 'Collapse' : 'Expand'}
          >
            {expandedId === event.id ? '▲' : '▼'}
          </button>
          {event.status === 'open' && (
            <button
              onClick={() => handleAction(event, 'resolve')}
              disabled={actionInProgress === event.id}
              className="px-2 py-1 text-xs bg-white/70 hover:bg-white rounded border border-gray-300 text-gray-700 transition-colors disabled:opacity-50"
            >
              Resolve
            </button>
          )}
          {(event.status === 'resolved' || event.status === 'recovered' || event.status === 'superseded') && (
            <button
              onClick={() => handleAction(event, 'reopen')}
              disabled={actionInProgress === event.id}
              className="px-2 py-1 text-xs bg-white/70 hover:bg-white rounded border border-gray-300 text-gray-700 transition-colors disabled:opacity-50"
            >
              Reopen
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
