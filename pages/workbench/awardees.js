/**
 * Workbench Awardees list — research awardees for a board cycle, each linking to
 * its Awardee tab to run the grantee deliverables workflow. Fills the gap where
 * the reviewer-finding dashboard doesn't surface awardees (it filters
 * Phase-II-Pending/Advancing; awardees are status=Active research grants).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Layout, { Card, PageHeader } from '../../shared/components/Layout';
import RequireAppAccess from '../../shared/components/RequireAppAccess';
import WorkbenchViewsNav from '../../shared/components/workbench/WorkbenchViewsNav';

// Board meets June (J) and December (D); default to the most recent meeting.
function currentCycleCode() {
  const d = new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const m = d.getMonth(); // 0 = Jan
  if (m >= 5 && m < 11) return `J${yy}`;                       // Jun–Nov → June cycle
  if (m >= 11) return `D${yy}`;                                 // Dec → Dec cycle
  return `D${String(d.getFullYear() - 1).slice(-2)}`;          // Jan–May → prior Dec cycle
}

const contextKey = (code, all) => `${code}:${all ? 'all' : 'mine'}`;

function AwardeesList() {
  const router = useRouter();
  const [cycleCode, setCycleCode] = useState(currentCycleCode());
  const [input, setInput] = useState(currentCycleCode());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const activeRequestRef = useRef(null);
  const [dataContextKey, setDataContextKey] = useState(null);
  const [dataContextVersion, setDataContextVersion] = useState(null);
  const [errorContextKey, setErrorContextKey] = useState(null);
  const [errorContextVersion, setErrorContextVersion] = useState(null);
  const [selectionVersion, setSelectionVersion] = useState(0);

  // Honor a ?cycleCode= deep link (e.g. the workbench "View awardees" link) once
  // the router is ready; falls back to the current-cycle default otherwise.
  useEffect(() => {
    if (!router.isReady) return;
    const q = typeof router.query.cycleCode === 'string' ? router.query.cycleCode.trim().toUpperCase() : '';
    if (!q || !/^[JD]\d{2}$/.test(q)) return;
    const timer = window.setTimeout(() => {
      setSelectionVersion((version) => version + 1);
      setCycleCode(q);
      setInput(q);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [router.isReady, router.query.cycleCode]);

  const load = useCallback(async (code, all, request) => {
    const ownsRequest = () => activeRequestRef.current === request;
    if (!ownsRequest()) return;
    setLoading(true);
    setError(null);
    setErrorContextKey(null);
    setErrorContextVersion(null);
    try {
      const scopeParam = all ? '&scope=all' : '';
      const res = await fetch(
        `/api/workbench/grantee-deliverables/awardees?cycleCode=${encodeURIComponent(code)}${scopeParam}`,
        { signal: request.controller.signal },
      );
      const d = await res.json();
      if (!ownsRequest()) return;
      if (!res.ok) {
        setError(d?.error || 'Failed to load awardees.');
        setErrorContextKey(contextKey(code, all));
        setErrorContextVersion(request.version);
        setData(null);
        setDataContextKey(null);
        setDataContextVersion(null);
      } else {
        setErrorContextKey(null);
        setErrorContextVersion(null);
        setData(d);
        setDataContextKey(contextKey(code, all));
        setDataContextVersion(request.version);
      }
    } catch {
      if (!ownsRequest()) return;
      setError('Failed to load awardees.');
      setErrorContextKey(contextKey(code, all));
      setErrorContextVersion(request.version);
      setData(null);
      setDataContextKey(null);
      setDataContextVersion(null);
    } finally {
      if (ownsRequest()) {
        setLoading(false);
        activeRequestRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const request = { controller, version: selectionVersion };
    activeRequestRef.current = request;
    const timer = window.setTimeout(() => { void load(cycleCode, showAll, request); }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      if (activeRequestRef.current === request) activeRequestRef.current = null;
    };
  }, [cycleCode, showAll, load, selectionVersion]);

  const currentContextKey = contextKey(cycleCode, showAll);
  const visibleData = dataContextKey === currentContextKey && dataContextVersion === selectionVersion
    ? data
    : null;
  const visibleError = errorContextKey === currentContextKey && errorContextVersion === selectionVersion
    ? error
    : null;

  return (
    <Layout title="Awardees">
      <PageHeader
        title="Awardees"
        subtitle="Open awarded grants and manage their grantee deliverables by cycle."
      />
      <WorkbenchViewsNav activeKey="awardees" cycleCode={cycleCode} />
      <Card hover={false}>
        <div className="flex items-center gap-2 mb-4">
          <h1 className="text-lg font-semibold text-gray-900">Grant deliverables — awardees</h1>
        </div>
        <form
          className="flex items-center gap-2 mb-4"
          onSubmit={(e) => {
            e.preventDefault();
            setSelectionVersion((version) => version + 1);
            setCycleCode(input.trim().toUpperCase());
          }}
        >
          <label className="text-sm">Cycle
            <input
              aria-label="Cycle code"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="ml-2 border rounded px-2 py-1 text-sm w-24"
            />
          </label>
          <button type="submit" className="px-3 py-1 text-sm rounded bg-blue-700 text-white">Load</button>
          <label className="flex items-center gap-1 text-sm text-gray-700 ml-2">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => {
                setSelectionVersion((version) => version + 1);
                setShowAll(e.target.checked);
              }}
            />
            Show all programs
          </label>
          {visibleData?.cycleLabel && (
            <span className="text-sm text-gray-500">
              {visibleData.cycleLabel} · {visibleData.count} awardee(s){showAll ? ' (all PDs)' : ' (yours)'}
            </span>
          )}
        </form>

        {loading && <p className="text-sm text-gray-500">Loading…</p>}
        {visibleError && <p role="alert" className="text-sm text-red-700">{visibleError}</p>}

        {visibleData && !loading && visibleData.awardees.length === 0 && (
          <p className="text-sm text-gray-500">
            {visibleData.pdResolved === false
              ? 'Could not match your account to a Program Director — tick “Show all programs” to see the full list.'
              : showAll
                ? `No research awardees found for ${visibleData.cycleLabel || cycleCode}.`
                : `No awardees assigned to you for ${visibleData.cycleLabel || cycleCode}. Tick “Show all programs” to see everyone’s.`}
          </p>
        )}

        {visibleData && visibleData.awardees.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="py-1 pr-2">#</th>
                <th className="py-1 pr-2">Project</th>
                <th className="py-1 pr-2">PI</th>
                <th className="py-1 pr-2">Liaison</th>
                <th className="py-1 pr-2">Deliverables</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {visibleData.awardees.map((a) => (
                <tr key={a.requestId} className="border-b align-top">
                  <td className="py-1 pr-2 whitespace-nowrap">{a.requestNumber}</td>
                  <td className="py-1 pr-2">{a.title}</td>
                  <td className="py-1 pr-2 whitespace-nowrap">{a.pi?.name || '—'}</td>
                  <td className="py-1 pr-2 whitespace-nowrap">{a.liaison?.name || '—'}</td>
                  <td className="py-1 pr-2 whitespace-nowrap">{a.statusLabel || 'Not started'}</td>
                  <td className="py-1">
                    <Link href={`/workbench/${a.requestId}?tab=awardee`} className="text-blue-700 hover:underline">
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Layout>
  );
}

export default function WorkbenchAwardeesGuard() {
  return (
    <RequireAppAccess appKey="reviewers">
      <AwardeesList />
    </RequireAppAccess>
  );
}
