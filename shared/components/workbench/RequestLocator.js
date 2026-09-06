import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Card } from '../Layout';

const STORAGE_KEY = 'wmkf-workbench-request-locator-v1';
const MAX_QUERY_LENGTH = 100;
const MAX_FILTER_LENGTH = 100;
const MAX_SAVED_RESULTS = 100;

function readSavedSearch() {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved || !Array.isArray(saved.results) || typeof saved.criteria !== 'object') return null;
    return {
      ...saved,
      criteria: {
        query: String(saved.criteria.query || '').slice(0, MAX_QUERY_LENGTH),
        cycle: String(saved.criteria.cycle || '').slice(0, MAX_FILTER_LENGTH),
        status: String(saved.criteria.status || '').slice(0, MAX_FILTER_LENGTH),
      },
      results: saved.results
        .filter((result) => result && typeof result.requestId === 'string')
        .slice(0, MAX_SAVED_RESULTS),
      nextOffset: [25, 50, 75].includes(Number(saved.nextOffset))
        ? Number(saved.nextOffset)
        : null,
    };
  } catch {
    return null;
  }
}

function saveSearch(state) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Browser storage is a convenience only; search remains fully functional.
  }
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-5 w-5">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m21 21-4.35-4.35m2.1-5.4a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z" />
    </svg>
  );
}

export default function RequestLocator() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [cycle, setCycle] = useState('');
  const [status, setStatus] = useState('');
  const [cycles, setCycles] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [optionsBusy, setOptionsBusy] = useState(true);
  const [optionsError, setOptionsError] = useState(null);
  const [results, setResults] = useState(null);
  const [submittedCriteria, setSubmittedCriteria] = useState(null);
  const [totalCount, setTotalCount] = useState(0);
  const [capped, setCapped] = useState(false);
  const [unavailableCount, setUnavailableCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = readSavedSearch();
      if (!saved) return;
      const criteria = saved.criteria;
      setQuery(criteria.query);
      setCycle(criteria.cycle);
      setStatus(criteria.status);
      setSubmittedCriteria(criteria);
      setResults(saved.results);
      setTotalCount(Number(saved.totalCount) || 0);
      setCapped(saved.capped === true);
      setUnavailableCount(Number(saved.unavailableCount) || 0);
      setHasMore(saved.hasMore === true);
      setNextOffset(saved.nextOffset);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/workbench/search-requests?mode=options');
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || `Failed to load filters (${response.status})`);
        if (cancelled) return;
        setCycles(Array.isArray(body.cycles) ? body.cycles : []);
        setStatuses(Array.isArray(body.statuses) ? body.statuses : []);
      } catch (loadError) {
        if (!cancelled) setOptionsError(loadError.message);
      } finally {
        if (!cancelled) setOptionsBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => () => {
    requestIdRef.current += 1;
  }, []);

  const invalidatePending = useCallback(() => {
    requestIdRef.current += 1;
    setBusy(false);
    setError(null);
  }, []);

  const runSearch = useCallback(async (criteria, offset = 0, append = false) => {
    const normalized = {
      query: criteria.query.trim(),
      cycle: criteria.cycle.trim(),
      status: criteria.status.trim(),
    };
    if (!normalized.query && !normalized.cycle && !normalized.status) {
      setError('Enter a request number, institution, PI, or title—or select a cycle or status.');
      return;
    }

    const operationId = ++requestIdRef.current;
    setBusy(true);
    setError(null);

    try {
      if (/^\d+$/.test(normalized.query) && !normalized.cycle && !normalized.status) {
        const response = await fetch(
          `/api/workbench/resolve-request?requestNumber=${encodeURIComponent(normalized.query)}`,
        );
        const body = await response.json().catch(() => ({}));
        if (requestIdRef.current !== operationId) return;
        if (!response.ok) throw new Error(body.error || `Failed to find request (${response.status})`);
        if (!body.requestId) throw new Error('The request lookup returned no request identity.');
        await router.push(
          `/workbench/${encodeURIComponent(body.requestId)}?n=${encodeURIComponent(
            body.requestNumber || normalized.query,
          )}`,
        );
        return;
      }

      const params = new URLSearchParams();
      if (normalized.query) params.set('q', normalized.query);
      if (normalized.cycle) params.set('cycle', normalized.cycle);
      if (normalized.status) params.set('status', normalized.status);
      if (offset) params.set('offset', String(offset));
      const response = await fetch(`/api/workbench/search-requests?${params}`);
      const body = await response.json().catch(() => ({}));
      if (requestIdRef.current !== operationId) return;
      if (!response.ok) throw new Error(body.error || `Failed to search requests (${response.status})`);

      const returnedResults = Array.isArray(body.results) ? body.results : [];
      const nextResults = append
        ? [...new Map(
          [...(results || []), ...returnedResults].map((result) => [result.requestId, result]),
        ).values()].slice(0, MAX_SAVED_RESULTS)
        : returnedResults.slice(0, MAX_SAVED_RESULTS);
      const nextUnavailableCount = append
        ? unavailableCount + (Number(body.unavailableCount) || 0)
        : (Number(body.unavailableCount) || 0);
      const saved = {
        criteria: normalized,
        results: nextResults,
        totalCount: Number(body.totalCount) || 0,
        capped: body.capped === true,
        unavailableCount: nextUnavailableCount,
        hasMore: body.hasMore === true,
        nextOffset: [25, 50, 75].includes(Number(body.nextOffset))
          ? Number(body.nextOffset)
          : null,
      };
      setSubmittedCriteria(normalized);
      setResults(nextResults);
      setTotalCount(saved.totalCount);
      setCapped(saved.capped);
      setUnavailableCount(saved.unavailableCount);
      setHasMore(saved.hasMore);
      setNextOffset(saved.nextOffset);
      saveSearch(saved);
    } catch (searchError) {
      if (requestIdRef.current === operationId) setError(searchError.message);
    } finally {
      if (requestIdRef.current === operationId) setBusy(false);
    }
  }, [results, router, unavailableCount]);

  const submitSearch = useCallback((event) => {
    event.preventDefault();
    void runSearch({ query, cycle, status });
  }, [cycle, query, runSearch, status]);

  const clearSearch = useCallback(() => {
    invalidatePending();
    setQuery('');
    setCycle('');
    setStatus('');
    setResults(null);
    setSubmittedCriteria(null);
    setTotalCount(0);
    setCapped(false);
    setUnavailableCount(0);
    setHasMore(false);
    setNextOffset(null);
    try { window.sessionStorage.removeItem(STORAGE_KEY); } catch { /* convenience only */ }
  }, [invalidatePending]);

  const showingCount = results?.length || 0;
  const searchAnnouncement = busy
    ? 'Searching requests.'
    : results
      ? `Search complete. ${totalCount.toLocaleString()} result${totalCount === 1 ? '' : 's'}; ${showingCount} shown.`
      : '';

  return (
    <section aria-labelledby="request-locator-heading" className="mb-6">
      <Card hover={false}>
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-gray-500"><SearchIcon /></span>
          <div>
            <h2 id="request-locator-heading" className="text-lg font-semibold text-gray-900">
              Find any request
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              Search active or historical requests without changing their status or the active-cycle list.
            </p>
          </div>
        </div>

        <form onSubmit={submitSearch} className="mt-5 space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="min-w-0 flex-1 text-sm font-medium text-gray-700">
              Request number, institution, PI, or proposal title
              <input
                type="search"
                autoComplete="off"
                maxLength={MAX_QUERY_LENGTH}
                value={query}
                onChange={(event) => { invalidatePending(); setQuery(event.target.value); }}
                placeholder="For example, 1002959 or University of Washington"
                className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="inline-flex min-h-10 items-center justify-center rounded-lg bg-gray-900 px-5 py-2 text-sm font-semibold text-white hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-50"
            >
              {busy ? 'Searching…' : 'Search'}
            </button>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="text-sm font-medium text-gray-700 sm:min-w-56">
              Cycle
              <select
                value={cycle}
                onChange={(event) => { invalidatePending(); setCycle(event.target.value); }}
                disabled={optionsBusy}
                className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-400"
              >
                <option value="">All cycles</option>
                {cycle && !cycles.some((option) => option.value === cycle) && (
                  <option value={cycle}>{cycle} (saved)</option>
                )}
                {cycles.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium text-gray-700 sm:min-w-64">
              Request status
              <select
                value={status}
                onChange={(event) => { invalidatePending(); setStatus(event.target.value); }}
                disabled={optionsBusy}
                className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-400"
              >
                <option value="">All statuses</option>
                {status && !statuses.includes(status) && (
                  <option value={status}>{status} (saved)</option>
                )}
                {statuses.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            {(query || cycle || status || results) && (
              <button
                type="button"
                onClick={clearSearch}
                className="min-h-10 px-2 text-sm font-medium text-gray-600 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
              >
                Clear
              </button>
            )}
          </div>
        </form>

        {optionsError && (
          <p className="mt-3 text-xs text-amber-700">
            Cycle and status filters are temporarily unavailable. Text search still works.
          </p>
        )}
        {error && <p className="mt-3 text-sm text-red-700" role="alert">{error}</p>}
        <p
          className="sr-only"
          role="status"
          aria-label="Request search status"
          aria-live="polite"
          aria-atomic="true"
        >
          {searchAnnouncement}
        </p>
      </Card>

      {results && (
        <Card hover={false} className="mt-3" padding="p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-5 py-3">
            <p className="text-sm text-gray-600">
              <span className="font-semibold text-gray-900">{totalCount.toLocaleString()}</span>{' '}
              result{totalCount === 1 ? '' : 's'}
              {showingCount > 0 ? ` · showing ${showingCount}` : ''}
            </p>
            {capped && (
              <span className="text-xs font-medium text-amber-700">
                Results are limited; narrow the search to see more precise matches
              </span>
            )}
            {unavailableCount > 0 && (
              <span className="text-xs font-medium text-amber-700">
                {unavailableCount} indexed {unavailableCount === 1 ? 'match is' : 'matches are'} no longer available
              </span>
            )}
          </div>

          {results.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <p className="text-sm font-medium text-gray-800">No requests matched.</p>
              <p className="mt-1 text-sm text-gray-500">Check the spelling or remove one of the filters.</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {results.map((result) => {
                const href = `/workbench/${encodeURIComponent(result.requestId)}?n=${encodeURIComponent(result.requestNumber || '')}`;
                return (
                  <li key={result.requestId} className="px-5 py-4 hover:bg-gray-50">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
                          <span className="font-semibold text-gray-900">#{result.requestNumber || 'Unknown'}</span>
                          {result.cycleLabel && <span>{result.cycleLabel}</span>}
                          {result.program && <span>· {result.program}</span>}
                        </div>
                        <p className="mt-1 font-medium text-gray-900">{result.title}</p>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-gray-600">
                          {result.institution && <span>{result.institution}</span>}
                          {result.projectLeader && <span>PI: {result.projectLeader}</span>}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-3 sm:justify-end">
                        {result.requestStatus && (
                          <span className="inline-flex min-h-7 items-center rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
                            {result.requestStatus}
                          </span>
                        )}
                        <Link
                          href={href}
                          className="whitespace-nowrap text-sm font-semibold text-blue-700 hover:text-blue-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                        >
                          Open request <span aria-hidden="true">→</span>
                        </Link>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {hasMore && nextOffset !== null && submittedCriteria && (
            <div className="border-t border-gray-200 px-5 py-3 text-center">
              <button
                type="button"
                disabled={busy}
                onClick={() => void runSearch(submittedCriteria, nextOffset, true)}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 disabled:opacity-50"
              >
                {busy ? 'Loading…' : 'Load 25 more'}
              </button>
            </div>
          )}
        </Card>
      )}
    </section>
  );
}
