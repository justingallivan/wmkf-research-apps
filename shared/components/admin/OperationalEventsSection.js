/**
 * Admin → Operational Events (durable failures + Vercel Log Drain rows).
 *
 * Extracted from pages/admin.js (S468) so the section can be rendered under
 * test: the first cut of "Resolve all shown" / grouping was anchored into the
 * neighbouring SystemAlertsSection by a text edit and no gate caught the
 * undefined references — a render test now does.
 *
 * Contracts this component relies on:
 * - GET /api/admin/operational-events → { events, summary } (newest first).
 * - PATCH single { id, action, expected* } or batch { action, events: [...] }.
 *   Every row sent for resolution carries expectedStatus,
 *   expectedLastOccurredAt, expectedStatusChangedAt, AND
 *   expectedOccurrenceCount; the server refuses
 *   (single: 409; batch: counted `stale`) a row that changed since render —
 *   including an open→resolved→open reopen (status_changed_at differs).
 * - Grouping is a VIEW aid (shared/utils/operational-event-grouping.js):
 *   signature-equal rows fold as "summary × N"; the group must be expanded
 *   before "Resolve group" is offered, so an operator sees what a coarse
 *   signature has folded before closing it.
 */

import { useState, useEffect, useRef } from 'react';
import { Card } from '../Layout';
import { groupOperationalEvents } from '../../utils/operational-event-grouping';

const freshness = (event) => ({
  id: event.id,
  expectedStatus: event.status,
  expectedLastOccurredAt: event.last_occurred_at,
  expectedStatusChangedAt: event.status_changed_at ?? null,
  expectedOccurrenceCount: event.occurrence_count,
});

export default function OperationalEventsSection() {
  const [events, setEvents] = useState([]);
  const [summary, setSummary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionInProgress, setActionInProgress] = useState(null);
  const [actionResult, setActionResult] = useState(null);
  const [bulkInProgress, setBulkInProgress] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [expandedGroups, setExpandedGroups] = useState(() => new Set());
  const [statusFilter, setStatusFilter] = useState('open');
  const [severityFilter, setSeverityFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [search, setSearch] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  // Async action handlers can outlive the render that launched them. Keep the
  // latest filters in a ref so their completion refetch cannot restore an old
  // filter snapshot and win the generation race against the current request.
  const filtersRef = useRef({ statusFilter, severityFilter, sourceFilter, search });
  // Generation guard: rapid filter changes issue overlapping fetches, and a
  // slow older response must not overwrite a newer filter's results.
  const fetchGenRef = useRef(0);

  const fetchEvents = () => {
    const gen = ++fetchGenRef.current;
    setLoading(true);
    const filters = filtersRef.current;
    const params = new URLSearchParams();
    if (filters.statusFilter) params.set('status', filters.statusFilter);
    if (filters.severityFilter) params.set('severity', filters.severityFilter);
    if (filters.sourceFilter) params.set('source', filters.sourceFilter);
    if (filters.search) params.set('search', filters.search);
    fetch(`/api/admin/operational-events?${params.toString()}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (gen !== fetchGenRef.current) return;
        setEvents(data?.events || []);
        setSummary(data?.summary || []);
      })
      .catch(() => {
        if (gen !== fetchGenRef.current) return;
        setEvents([]); setSummary([]);
      })
      .finally(() => {
        if (gen === fetchGenRef.current) setLoading(false);
      });
  };

  useEffect(() => { fetchEvents(); }, [statusFilter, severityFilter, sourceFilter, search]);

  const handleAction = async (event, action) => {
    setActionInProgress(event.id);
    setActionResult(null);
    setBulkResult(null);
    try {
      const res = await fetch('/api/admin/operational-events', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          // Freshness precondition: the server refuses (409) if the row
          // changed since this list rendered, so a stale view can't close a
          // newly recurrent incident. A 409 just refetches the live state.
          ...freshness(event),
        }),
      });
      if (res.ok || res.status === 409) {
        if (res.status === 409) setActionResult('Event changed since load; refreshed without applying the action.');
        fetchEvents();
      } else {
        setActionResult(`Update failed (${res.status}). Reload the admin page and retry.`);
      }
    } catch {
      setActionResult('Update failed. Check the connection and retry.');
    }
    setActionInProgress(null);
  };

  // Batch resolve: every supplied row carries its own freshness precondition,
  // so a row that changed since the list rendered is skipped and reported,
  // never blind-closed. Used by "Resolve all shown" and per-group "Resolve".
  const resolveBatch = async (rows, confirmText) => {
    if (!rows.length || bulkInProgress) return;
    if (!confirm(confirmText)) return;
    setBulkInProgress(true);
    setBulkResult(null);
    setActionResult(null);
    try {
      const res = await fetch('/api/admin/operational-events', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resolve', events: rows.map(freshness) }),
      });
      const data = res.ok ? await res.json() : null;
      setBulkResult(data
        ? `Resolved ${data.updated} of ${data.requested}${data.stale ? ` · ${data.stale} changed since load (left open)` : ''}${data.notFound ? ` · ${data.notFound} not found` : ''}${data.invalid ? ` · ${data.invalid} invalid` : ''}${data.failed ? ` · ${data.failed} failed (retryable)` : ''}`
        : 'Bulk resolve failed');
    } catch {
      setBulkResult('Bulk resolve failed');
    }
    setBulkInProgress(false);
    fetchEvents();
  };

  const resolvableShown = events.filter(e => e.status === 'open');
  const handleResolveAllShown = () => resolveBatch(
    resolvableShown,
    `Resolve all ${resolvableShown.length} open event(s) currently shown?`,
  );

  // Repeating failures (drain rows are one row per log line by design) are
  // folded in the VIEW by signature so the card reads "message × N" and a
  // three-row real problem is not buried under an 86-row storm.
  const groups = groupOperationalEvents(events);
  const toggleGroup = (key) => setExpandedGroups(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

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

  // Every status renders exactly one badge; unknown values fall through to a
  // visible gray badge rather than disappearing.
  const statusBadges = {
    open: 'bg-red-100 text-red-700',
    recovered: 'bg-green-100 text-green-700',
    resolved: 'bg-gray-200 text-gray-600',
    superseded: 'bg-gray-100 text-gray-500',
    info: 'bg-blue-100 text-blue-600',
  };

  const openCount = summary
    .filter(s => s.status === 'open')
    .reduce((acc, s) => acc + (s.count || 0), 0);

  const selectClass = 'text-xs border border-gray-300 rounded px-1.5 py-1 bg-white text-gray-700';

  const renderEvent = (event) => (
            <div
              key={event.id}
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

  return (
    <div id="operational-events" className="scroll-mt-6">
    <Card>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-lg font-semibold text-gray-900">Operational Events</h2>
        <span className="text-sm text-gray-500">
          {openCount > 0 ? `${openCount} open in the last 7 days` : 'no open events in the last 7 days'}
        </span>
      </div>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <select value={statusFilter} onChange={e => {
          filtersRef.current.statusFilter = e.target.value;
          setStatusFilter(e.target.value);
          setActionResult(null); setBulkResult(null);
        }} className={selectClass} aria-label="Status filter">
          <option value="open">Open</option>
          <option value="recovered">Recovered</option>
          <option value="resolved">Resolved</option>
          <option value="superseded">Superseded</option>
          <option value="info">Info</option>
          <option value="">All statuses</option>
        </select>
        <select value={severityFilter} onChange={e => {
          filtersRef.current.severityFilter = e.target.value;
          setSeverityFilter(e.target.value);
          setActionResult(null); setBulkResult(null);
        }} className={selectClass} aria-label="Severity filter">
          <option value="">All severities</option>
          <option value="critical">Critical</option>
          <option value="error">Error</option>
          <option value="warning">Warning</option>
          <option value="info">Info</option>
        </select>
        <select value={sourceFilter} onChange={e => {
          filtersRef.current.sourceFilter = e.target.value;
          setSourceFilter(e.target.value);
          setActionResult(null); setBulkResult(null);
        }} className={selectClass} aria-label="Source filter">
          <option value="">All sources</option>
          <option value="app">Application</option>
          <option value="vercel-drain">Vercel drain</option>
        </select>
        <form
          onSubmit={e => {
            e.preventDefault();
            const nextSearch = searchDraft.trim();
            filtersRef.current.search = nextSearch;
            setSearch(nextSearch);
            setActionResult(null); setBulkResult(null);
          }}
          className="flex items-center gap-1"
        >
          <input
            type="text"
            value={searchDraft}
            onChange={e => setSearchDraft(e.target.value)}
            placeholder="Request #, entity ID, text…"
            className="text-xs border border-gray-300 rounded px-2 py-1 w-48"
            aria-label="Search operational events"
          />
          <button type="submit" className="px-2 py-1 text-xs bg-white hover:bg-gray-50 rounded border border-gray-300 text-gray-700">
            Search
          </button>
          {search && (
            <button
              type="button"
              onClick={() => {
                filtersRef.current.search = '';
                setSearch('');
                setSearchDraft('');
                setActionResult(null); setBulkResult(null);
              }}
              className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700"
            >
              Clear
            </button>
          )}
        </form>
        {!loading && resolvableShown.length > 0 && (
          <button
            type="button"
            onClick={handleResolveAllShown}
            disabled={bulkInProgress}
            className="ml-auto px-2 py-1 text-xs bg-white hover:bg-gray-50 rounded border border-gray-300 text-gray-700 disabled:opacity-50"
            title="Resolve every open event in the current list (filters and search apply)"
          >
            {bulkInProgress ? 'Resolving…' : `Resolve all ${resolvableShown.length} shown`}
          </button>
        )}
      </div>
      {bulkResult && (
        <p className="text-xs text-gray-600 mb-3" role="status">{bulkResult}</p>
      )}
      {actionResult && (
        <p className="text-xs text-gray-600 mb-3" role="status">{actionResult}</p>
      )}

      {loading ? (
        <div className="text-gray-500 text-sm">Loading events...</div>
      ) : events.length === 0 ? (
        <p className="text-gray-500 text-sm">No matching operational events.</p>
      ) : (
        <div className="space-y-2">
          {groups.map(group => (group.events.length === 1 ? renderEvent(group.events[0]) : (
            <div key={group.key} className={`rounded-lg border ${severityColors[group.newest.severity] || severityColors.info}`}>
              <div className="p-3 flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 flex-1 min-w-0">
                  <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${severityDots[group.newest.severity] || 'bg-gray-400'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium break-all">{group.newest.summary}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/70 text-gray-800 font-semibold" title="Rows sharing this signature (ids and numbers normalized) — expand to review them before resolving the group">
                        ×{group.events.length}
                      </span>
                      {group.openEvents.length > 0 && group.openEvents.length < group.events.length && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700">
                          {group.openEvents.length} open
                        </span>
                      )}
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/50 text-gray-600">
                        {String(group.newest.event_type || '').replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div className="text-xs text-gray-600 mt-0.5">
                      {new Date(group.oldest.first_occurred_at || group.oldest.last_occurred_at).toLocaleString()}
                      {' → '}
                      {new Date(group.newest.last_occurred_at).toLocaleString()}
                      {` · ${group.newest.source}`}
                      {group.newest.subsystem && ` · ${group.newest.subsystem}`}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => toggleGroup(group.key)}
                    className="p-1 text-xs text-gray-500 hover:text-gray-700 rounded"
                    title={expandedGroups.has(group.key) ? 'Collapse group' : `Show ${group.events.length} rows (expand to enable Resolve group)`}
                  >
                    {expandedGroups.has(group.key) ? '▲' : '▼'}
                  </button>
                  {group.openEvents.length > 0 && expandedGroups.has(group.key) && (
                    <button
                      onClick={() => resolveBatch(
                        group.openEvents,
                        `Resolve the ${group.openEvents.length} open event(s) in this group?`,
                      )}
                      disabled={bulkInProgress}
                      className="px-2 py-1 text-xs bg-white/70 hover:bg-white rounded border border-gray-300 text-gray-700 transition-colors disabled:opacity-50"
                    >
                      Resolve group ({group.openEvents.length})
                    </button>
                  )}
                </div>
              </div>
              {expandedGroups.has(group.key) && (
                <div className="px-3 pb-3 space-y-2">
                  {group.events.map(renderEvent)}
                </div>
              )}
            </div>
          )))}
        </div>
      )}
    </Card>
    </div>
  );
}
