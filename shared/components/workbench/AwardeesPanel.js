/**
 * Awardees panel — research awardees for the shell's cycle, each linking to
 * its Awardee tab to run the grantee deliverables workflow. Mounted inside the
 * Request Workbench shell, which owns the cycle and the my/all scope.
 *
 * Cycle rule (owner decision 2026-09-08): the panel shows the shell's cycle,
 * the working one. Awardees are decided at the meeting, so the working cycle
 * usually has none yet; in that case one line names the cycle and links the
 * last DECIDED cycle, read from the awardees endpoint's cycle-list mode
 * (`lastDecidedCycleCode`, computed over the exact population the row query
 * uses). Clicking it changes the shell's cycle.
 *
 * Data: /api/workbench/grantee-deliverables/awardees?cycleCode=…[&scope=all];
 *       the same URL without cycleCode for the cycle list.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Card } from '../Layout';

const contextKey = (code, all) => `${code}:${all ? 'all' : 'mine'}`;

/**
 * @param {object} props
 * @param {string|null} props.cycleCode   null while the shell resolves it
 * @param {boolean} props.loadingCycles
 * @param {'my'|'all'} props.scope
 * @param {Function} props.onScopeChange
 * @param {Function} props.onCycleChange  (code) — the last-decided-cycle link
 */
export default function AwardeesPanel({ cycleCode, loadingCycles, scope, onScopeChange, onCycleChange }) {
  const showAll = scope === 'all';
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const activeRequestRef = useRef(null);
  const [dataContextKey, setDataContextKey] = useState(null);
  const [dataContextVersion, setDataContextVersion] = useState(null);
  const [errorContextKey, setErrorContextKey] = useState(null);
  const [errorContextVersion, setErrorContextVersion] = useState(null);
  // Bumped on every context change so a response from an earlier visit to the
  // same cycle+scope can never revive after a newer request started.
  const versionRef = useRef(0);
  const [currentVersion, setCurrentVersion] = useState(0);

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
    if (!cycleCode) return undefined;
    const controller = new AbortController();
    const request = { controller, version: ++versionRef.current };
    activeRequestRef.current = request;
    setCurrentVersion(request.version);
    const timer = window.setTimeout(() => { void load(cycleCode, showAll, request); }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      if (activeRequestRef.current === request) activeRequestRef.current = null;
    };
  }, [cycleCode, showAll, load]);

  const currentContextKey = contextKey(cycleCode, showAll);
  const visibleData = dataContextKey === currentContextKey && dataContextVersion === currentVersion ? data : null;
  const visibleError = errorContextKey === currentContextKey && errorContextVersion === currentVersion ? error : null;

  // The cycle list is read once, only when a cycle turns out empty, to name the
  // last decided cycle (and how many awardees it holds).
  const [cycleList, setCycleList] = useState(null); // { cycles, lastDecidedCycleCode } | 'error'
  const cycleEmpty = visibleData && !loading && visibleData.awardees.length === 0;
  // An unresolved PD gets only the "could not match" guidance: the cycle may
  // well have awardees, so the last-decided link would contradict it.
  const pdUnresolved = cycleEmpty && visibleData.pdResolved === false;
  const cycleHasNoAwardees = cycleEmpty && !pdUnresolved && (showAll
    ? true
    : cycleList && cycleList !== 'error' && !cycleList.cycles.some((c) => c.code === cycleCode && (c.count ?? 1) > 0));
  useEffect(() => {
    if (!cycleEmpty || pdUnresolved || cycleList) return undefined;
    let current = true;
    (async () => {
      try {
        const res = await fetch('/api/workbench/grantee-deliverables/awardees');
        const body = await res.json().catch(() => ({}));
        if (!current) return;
        if (!res.ok) throw new Error(body?.error || 'cycle list failed');
        setCycleList({ cycles: Array.isArray(body.cycles) ? body.cycles : [], lastDecidedCycleCode: body.lastDecidedCycleCode || null });
      } catch {
        if (current) setCycleList('error');
      }
    })();
    return () => { current = false; };
  }, [cycleEmpty, cycleList]);

  const lastDecided = cycleList && cycleList !== 'error' && cycleList.lastDecidedCycleCode
    && cycleList.lastDecidedCycleCode !== cycleCode
    ? cycleList.cycles.find((c) => c.code === cycleList.lastDecidedCycleCode)
      || { code: cycleList.lastDecidedCycleCode, label: cycleList.lastDecidedCycleCode }
    : null;
  const cycleLabel = visibleData?.cycleLabel || cycleCode;

  return (
    <Card hover={false}>
      <div className="flex flex-wrap items-center gap-4 mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Grant deliverables — awardees</h2>
        <label className="flex items-center gap-1 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={showAll}
            onChange={(e) => onScopeChange(e.target.checked ? 'all' : 'my')}
          />
          Show all programs
        </label>
        {visibleData?.cycleLabel && (
          <span className="text-sm text-gray-500">
            {visibleData.cycleLabel} · {visibleData.count} awardee(s){showAll ? ' (all PDs)' : ' (yours)'}
          </span>
        )}
      </div>

      {(loadingCycles || loading) && <p className="text-sm text-gray-500">Loading…</p>}
      {visibleError && <p role="alert" className="text-sm text-red-700">{visibleError}</p>}

      {cycleEmpty && (
        <div className="text-sm text-gray-500" role="status">
          {pdUnresolved ? (
            <p>Could not match your account to a Program Director — tick “Show all programs” to see the full list.</p>
          ) : cycleHasNoAwardees ? (
            <p>{`No awardees for ${cycleLabel} yet.`}</p>
          ) : cycleHasNoAwardees === false ? (
            <p>{`No awardees assigned to you for ${cycleLabel}. Tick “Show all programs” to see everyone’s.`}</p>
          ) : (
            <p>{`No awardees assigned to you for ${cycleLabel}.`}</p>
          )}
          {cycleHasNoAwardees && lastDecided && (
            <p className="mt-1">
              <button
                type="button"
                className="font-semibold text-gray-900 underline underline-offset-4 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500"
                onClick={() => onCycleChange(lastDecided.code)}
              >
                {Number.isFinite(lastDecided.count) ? `${lastDecided.count} awardee${lastDecided.count === 1 ? '' : 's'} in ${lastDecided.label}` : `Awardees in ${lastDecided.label}`}
              </button>
            </p>
          )}
        </div>
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
  );
}
