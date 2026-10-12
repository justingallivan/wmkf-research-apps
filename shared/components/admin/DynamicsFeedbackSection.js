import { useEffect, useState } from 'react';
import { Card } from '../Layout';
import { requestEnvelope } from '../../utils/api-request';

// --- Section D2: Dynamics Explorer Feedback ---
export default function DynamicsFeedbackSection() {
  const [feedback, setFeedback] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  // Default to unreviewed feedback — that's the queue an admin opens this
  // section to work through. "All statuses" buried new items under resolved ones.
  const [filter, setFilter] = useState({ status: 'new', type: '' });
  const [expandedId, setExpandedId] = useState(null);
  const [actionInProgress, setActionInProgress] = useState(null);
  const [error, setError] = useState(null);

  const fetchFeedback = (params = {}) => {
    const qs = new URLSearchParams();
    const status = Object.prototype.hasOwnProperty.call(params, 'status')
      ? params.status
      : filter.status;
    const type = Object.prototype.hasOwnProperty.call(params, 'type')
      ? params.type
      : filter.type;
    if (status) qs.set('status', status);
    if (type) qs.set('type', type);
    const query = qs.toString();
    setError(null);
    requestEnvelope(`/api/dynamics-explorer/feedback${query ? `?${query}` : ''}`)
      .then(envelope => {
        if (!envelope.ok) throw new Error('Feedback could not be loaded.');
        return envelope.data;
      })
      .then(data => {
        setFeedback(data?.feedback || []);
        setSummary(data?.summary || null);
      })
      .catch((loadError) => {
        setFeedback([]);
        setError(loadError.message);
      })
      .finally(() => setLoading(false));
  };

  // Mount-only initial load; later filter changes call fetchFeedback explicitly.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchFeedback(); }, []);

  const handleAction = async (id, status) => {
    setActionInProgress(id);
    try {
      const envelope = await requestEnvelope('/api/dynamics-explorer/feedback', {
        method: 'PATCH',
        body: { id, status },
        tolerantBody: true,
      });
      if (!envelope.ok) throw new Error('The feedback status could not be updated.');
      fetchFeedback();
    } catch (actionError) {
      setError(actionError.message);
    }
    setActionInProgress(null);
  };

  const applyFilter = (key, value) => {
    const newFilter = { ...filter, [key]: value };
    setFilter(newFilter);
    setLoading(true);
    fetchFeedback(newFilter);
  };

  const typeLabel = (type) => type === 'positive' ? 'Positive' : 'Negative';
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
          aria-label="Feedback status"
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
          aria-label="Feedback type"
          value={filter.type}
          onChange={e => applyFilter('type', e.target.value)}
          className="text-xs border border-gray-300 rounded px-2 py-1"
        >
          <option value="">All types</option>
          <option value="negative">Negative</option>
          <option value="positive">Positive</option>
        </select>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {error}
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              fetchFeedback();
            }}
            className="ml-3 font-semibold underline"
          >
            Try again
          </button>
        </div>
      )}

      {feedback.length === 0 ? (
        <p className="text-gray-500 text-sm">No feedback records found.</p>
      ) : (
        <div className="space-y-2">
          {feedback.map(fb => (
            <div key={fb.id} className="p-3 rounded-lg border border-gray-200 bg-gray-50">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 flex-1 min-w-0">
                  <span className={`flex-shrink-0 text-xs font-semibold ${typeColor(fb.feedback_type)}`}>
                    {typeLabel(fb.feedback_type)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-gray-900 truncate max-w-xs" title={fb.query_text}>
                        {fb.query_text ? `"${fb.query_text.slice(0, 80)}${fb.query_text.length > 80 ? '...' : ''}"` : '(no query)'}
                      </span>
                      {fb.category && (
                        <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">
                          {categoryLabels[fb.category] || fb.category}
                        </span>
                      )}
                      {fb.auto_detected && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">
                          auto-detected
                        </span>
                      )}
                      <span className="rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-600">
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
                    type="button"
                    onClick={() => setExpandedId(expandedId === fb.id ? null : fb.id)}
                    aria-expanded={expandedId === fb.id}
                    className="min-h-9 rounded px-2 py-1 text-xs font-semibold text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
                  >
                    {expandedId === fb.id ? 'Hide conversation' : 'Show conversation'}
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
