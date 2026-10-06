/**
 * Request list panel — the Request Workbench's reviewer-finding view, mounted
 * inside the shell. Lists the requests a PD needs to find reviewers for in the
 * shell's program and cycle, with a per-request reviewer work-remaining cue.
 * Rows deep-link to the per-request Workbench (/workbench/<requestId>?tab=reviewers).
 *
 * The shell owns program, cycle, scope, and the Set Aside toggle (all in the
 * URL); this panel owns row loading and the per-row triage flip.
 *
 * Data: /api/workbench/dashboard?cycleCode=… (rows); POST /api/workbench/triage.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { requestJson, requestEnvelope } from '../../utils/api-request';
import { Card } from '../Layout';
import ReviewerStatusIndicator from './ReviewerStatusIndicator';
import { TOOLBAR_CONTROL_HEIGHT_CLASS } from '../ToolbarSelect';
import ScopeSegment from './ScopeSegment';
import { TRIAGE_STATUS } from '../../config/triageStatus';
import TestRequestBadge from '../TestRequestBadge';

// `done` means the request has enough completed reviews (REVIEWERS_NEEDED in
// lib/services/reviewer-rollup.js), not that every accepted reviewer has
// returned one — a fourth reviewer can still be open and flagged on the
// Reviewer follow-up view. The label says "coverage", never "complete".
const STAGE_META = {
  find: { label: 'Find reviewers', cls: 'bg-rose-100 text-rose-800' },
  invite: { label: 'Invite', cls: 'bg-amber-100 text-amber-800' },
  awaiting: { label: 'Awaiting replies', cls: 'bg-blue-100 text-blue-800' },
  review: { label: 'In review', cls: 'bg-indigo-100 text-indigo-800' },
  done: { label: 'Sufficient coverage', cls: 'bg-green-100 text-green-800' },
};

function requestDataKey(programId, cycleCode, scope, includeSetAside) {
  return JSON.stringify([programId || '', cycleCode || '', scope || '', includeSetAside === true]);
}

/**
 * Secondary metrics line under the request count: requests still at Find and
 * requests with sufficient review coverage. Returns null when neither applies
 * so the line is omitted rather than rendered empty.
 */
export function describeStageCounts(stages) {
  const find = stages?.find || 0;
  const done = stages?.done || 0;
  const parts = [];
  if (find) parts.push(`${find} need reviewers`);
  if (done) parts.push(`${done} ${done === 1 ? 'has' : 'have'} sufficient review coverage`);
  return parts.length ? parts.join(' · ') : null;
}

function StageChip({ stage }) {
  const m = STAGE_META[stage] || { label: stage, cls: 'bg-gray-100 text-gray-700' };
  return <span className={`inline-flex items-center whitespace-nowrap px-2.5 py-1 rounded-full text-xs font-semibold ${m.cls}`}>{m.label}</span>;
}

// Per-row triage flip (S261). The row's request link is stretched over the
// whole row, so the select sits above it (relative z-10) and stops events
// before they can reach the link. The server computes the visible canManage gate, and POST /api/workbench/triage
// remains the authoritative lead-PD/superuser gate.
function TriageControl({ proposal, busy, onSet }) {
  const value = proposal.advancing ? 'advancing' : proposal.setAside ? 'setAside' : 'untriaged';
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  return (
    <select
      value={value}
      disabled={busy}
      onClick={stop}
      onChange={(e) => { stop(e); onSet(proposal.requestId, e.target.value); }}
      className="relative z-10 h-9 w-full rounded-lg border border-gray-300 bg-white px-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-1 disabled:opacity-50"
      title="Set triage status"
      aria-label={`Triage status for request ${proposal.requestNumber}`}
    >
      {value === 'untriaged' && <option value="untriaged" disabled>Set triage…</option>}
      <option value="advancing">Advancing</option>
      <option value="setAside">Set aside</option>
    </select>
  );
}

/**
 * @param {object} props
 * @param {string} props.programId            resolved Grant Program id
 * @param {string|null} props.cycleCode       resolved cycle, or null while the shell is resolving it
 * @param {Array} props.cycles                the shell's cycle list (for the personal count)
 * @param {number} props.cyclesGeneration     bumps whenever the shell replaces the cycle list
 * @param {Function} props.patchCycleCounts   (code, {myDelta, mySetAsideDelta}, generation) → void
 * @param {boolean} props.loadingCycles
 * @param {'my'|'all'} props.scope
 * @param {boolean} props.includeSetAside
 * @param {Function} props.onScopeChange
 * @param {Function} props.onIncludeSetAsideChange
 * @param {boolean} props.cycleMetadataReady  cycle metadata is for this program
 * @param {boolean} props.allowRowsWhileCyclesLoading explicit URL row arm
 */
export default function RequestListPanel({
  programId,
  cycleCode,
  cycles,
  cyclesGeneration,
  patchCycleCounts,
  loadingCycles,
  scope,
  includeSetAside,
  onScopeChange,
  onIncludeSetAsideChange,
  cycleMetadataReady = true,
  allowRowsWhileCyclesLoading = false,
}) {
  const [proposals, setProposals] = useState([]);
  const [rollup, setRollup] = useState(null);
  const [loadingProposals, setLoadingProposals] = useState(false);
  const [error, setError] = useState(null);
  const [errorKey, setErrorKey] = useState(null);
  const [loadedKey, setLoadedKey] = useState(null);
  // Per-row triage flip: ids currently being saved disable only those controls.
  const [savingIds, setSavingIds] = useState(() => new Set());
  const filtersRef = useRef({ cycleCode, scope, includeSetAside, programId, cyclesGeneration });
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Load proposals whenever the selected cycle/scope/toggle changes. A monotonic
  // request id guards against a slower earlier fetch (e.g. a fast toggle) landing
  // after — and overwriting — the latest one.
  const reqIdRef = useRef(0);
  const loadProposals = useCallback(async (code, sc, incl, selectedProgramId) => {
    if (!code) return;
    const myReq = ++reqIdRef.current;
    const loadKey = requestDataKey(selectedProgramId, code, sc, incl);
    setLoadingProposals(true);
    setError(null);
    setErrorKey(null);
    try {
      const { ok: resOk, status: resStatus, data: body } = await requestEnvelope(`/api/workbench/dashboard?cycleCode=${encodeURIComponent(code)}&scope=${sc}&programId=${encodeURIComponent(selectedProgramId)}${incl ? '&includeSetAside=1' : ''}`, {
        tolerantBody: true,
      });
      if (reqIdRef.current !== myReq) return; // a newer request superseded this one
      if (!resOk) {
        const responseError = body && typeof body === 'object' ? body.error : null;
        const requestError = new Error(responseError || `Failed to load requests (${resStatus})`);
        requestError.status = resStatus;
        throw requestError;
      }
      if (!body || typeof body !== 'object' || !Array.isArray(body.proposals) || !body.rollup || typeof body.rollup !== 'object') {
        const requestError = new Error('The request list response was malformed.');
        requestError.clearSnapshot = true;
        throw requestError;
      }
      const responseContext = [
        ['programId', selectedProgramId],
        ['cycleCode', code],
        ['scope', sc],
        ['includeSetAside', incl === true],
      ];
      const mismatched = responseContext.some(([key, expected]) => (
        !Object.prototype.hasOwnProperty.call(body, key)
        || (key === 'programId'
          ? String(body[key]).toLowerCase() !== String(expected).toLowerCase()
          : String(body[key]) !== String(expected))
      ));
      if (mismatched) {
        const requestError = new Error('The request list response did not match the selected context.');
        requestError.clearSnapshot = true;
        throw requestError;
      }
      setProposals(body.proposals || []);
      setRollup(body.rollup || null);
      setLoadedKey(loadKey);
    } catch (e) {
      if (reqIdRef.current !== myReq) return;
      setError(e.message);
      setErrorKey(loadKey);
      if (e.status === 401 || e.status === 403 || e.clearSnapshot) {
        setProposals([]);
        setRollup(null);
        setLoadedKey(loadKey);
      }
    } finally {
      if (reqIdRef.current === myReq) setLoadingProposals(false);
    }
  }, []);

  useEffect(() => {
    filtersRef.current = { cycleCode, scope, includeSetAside, programId, cyclesGeneration };
  }, [cycleCode, scope, includeSetAside, programId, cyclesGeneration]);

  useEffect(() => {
    if (!cycleCode) {
      // The shell is resolving a cycle (e.g. after a program change): drop the
      // previous dataset and ignore any fetch still in flight for it.
      reqIdRef.current += 1;
      setProposals([]);
      setRollup(null);
      setLoadingProposals(false);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      void loadProposals(cycleCode, scope, includeSetAside, programId);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      reqIdRef.current += 1;
    };
  }, [cycleCode, scope, includeSetAside, loadProposals, programId]);

  const selectedCycle = cycles.find((cycle) => cycle.code === cycleCode);
  const myRequestCount = cycleMetadataReady
    ? (selectedCycle?.myCount || 0) + (includeSetAside ? selectedCycle?.mySetAsideCount || 0 : 0)
    : undefined;
  const currentKey = requestDataKey(programId, cycleCode, scope, includeSetAside);
  const currentKeyRef = useRef(currentKey);
  // Context transitions invalidate command errors; same-context GETs do not.
  const contextEpochRef = useRef(0);
  if (currentKeyRef.current !== currentKey) contextEpochRef.current += 1;
  currentKeyRef.current = currentKey;
  const hasCurrentSnapshot = loadedKey === currentKey;
  const visibleProposals = hasCurrentSnapshot ? proposals : [];
  const visibleRollup = hasCurrentSnapshot ? rollup : null;
  const visibleError = errorKey === currentKey ? error : null;

  // Flip a request's triage status, then refetch (a row may drop out of the
  // default view once Set aside). The server enforces the hard manage gate.
  // The personal cycle count is patched only when the shell still shows the
  // cycle list the flip started under (a program change replaces that list).
  const setTriage = useCallback(async (requestId, key) => {
    const triageStatus = key === 'advancing' ? TRIAGE_STATUS.ADVANCING : TRIAGE_STATUS.SET_ASIDE;
    const triageFilters = filtersRef.current;
    const triageKey = currentKey;
    const triageContextEpoch = contextEpochRef.current;
    const proposal = visibleProposals.find((item) => item.requestId === requestId);
    const wasSetAside = proposal?.setAside === true;
    const isSetAside = triageStatus === TRIAGE_STATUS.SET_ASIDE;
    setSavingIds((prev) => {
      const next = new Set(prev);
      next.add(requestId);
      return next;
    });
    setError(null);
    try {
      await requestJson('/api/workbench/triage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { requestId, triageStatus },
        fallbackMessage: 'Failed to set triage status',
        tolerantBody: true,
      });
      const current = filtersRef.current;
      if (proposal?.isMine === true && wasSetAside !== isSetAside && triageFilters.cycleCode) {
        patchCycleCounts(
          triageFilters.cycleCode,
          { myDelta: isSetAside ? -1 : 1, mySetAsideDelta: isSetAside ? 1 : -1 },
          triageFilters.cyclesGeneration,
        );
      }
      if (mountedRef.current) {
        await loadProposals(current.cycleCode, current.scope, current.includeSetAside, current.programId);
      }
    } catch (e) {
      if (!mountedRef.current || currentKeyRef.current !== triageKey || contextEpochRef.current !== triageContextEpoch) return;
      setError(e.message);
      setErrorKey(currentKey);
    } finally {
      if (mountedRef.current) setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(requestId);
        return next;
      });
    }
  }, [currentKey, loadProposals, patchCycleCounts, visibleProposals]);

  return (
    <>
      <div className="flex flex-wrap items-end gap-4 mb-2">
        <ScopeSegment scope={scope} onChange={onScopeChange} myCount={myRequestCount} />

        <label className={`flex ${TOOLBAR_CONTROL_HEIGHT_CLASS} items-center gap-2 text-sm font-medium text-gray-700`}>
          <input
            type="checkbox"
            className="rounded border-gray-300"
            checked={includeSetAside}
            onChange={(e) => onIncludeSetAsideChange(e.target.checked)}
          />
          Include set-aside requests
        </label>
      </div>

      {visibleRollup && (
        <div className="mb-6 text-sm">
          <p className="text-gray-900">
            <span className="font-semibold">{visibleRollup.total}</span> request{visibleRollup.total === 1 ? '' : 's'}
          </p>
          {describeStageCounts(visibleRollup.stages) && (
            <p className="mt-0.5 text-gray-500">{describeStageCounts(visibleRollup.stages)}</p>
          )}
        </div>
      )}

      {visibleError && (
        <div className="mb-6 p-4 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">
          <span>{visibleError}</span>{' '}
          <button type="button" className="underline font-medium" onClick={() => loadProposals(cycleCode, scope, includeSetAside, programId)}>
            Retry
          </button>
        </div>
      )}

      {loadingProposals && hasCurrentSnapshot && (
        <p className="mb-3 text-xs text-gray-500" role="status">Updating…</p>
      )}

      {visibleError && !hasCurrentSnapshot ? null : ((loadingCycles && !allowRowsWhileCyclesLoading) || (cycleCode && !hasCurrentSnapshot)) ? (
        <Card hover={false}><p className="text-gray-500">Loading…</p></Card>
      ) : visibleProposals.length === 0 ? (
        <Card hover={false}>
          <p className="text-gray-500">No requests to show for this cycle and scope.</p>
        </Card>
      ) : (
        <ul className="divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          {visibleProposals.map((p) => {
            const href = `/workbench/${p.requestId}?tab=reviewers&n=${encodeURIComponent(p.requestNumber)}`;
            const people = [
              p.projectLeader && `PI ${p.projectLeader}`,
              p.programDirector && `PD ${p.programDirector}`,
            ].filter(Boolean).join(' · ');
            return (
              <li
                key={p.requestId}
                className="relative grid grid-cols-1 gap-x-6 gap-y-2 px-4 py-3 transition-colors hover:bg-gray-50 focus-within:bg-gray-50 lg:grid-cols-[minmax(14rem,1fr)_10rem_16rem_9rem] lg:items-center"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Stretched link: the whole row opens the request, and it
                        is a real link (new tab, copy address). */}
                    <Link
                      href={href}
                      className="font-semibold text-gray-900 after:absolute after:inset-0 after:content-[''] focus:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-gray-500"
                    >
                      #{p.requestNumber}
                    </Link>
                    <TestRequestBadge isTestRequest={p.isTestRequest} />
                    {p.institution && <span className="min-w-0 truncate text-sm text-gray-900">{p.institution}</span>}
                    {p.advancing && (
                      <span className="inline-flex items-center rounded-full bg-purple-50 px-2 py-0.5 text-xs font-semibold text-purple-800">
                        Advancing
                      </span>
                    )}
                    {p.setAside && (
                      <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700">
                        Set aside
                      </span>
                    )}
                  </div>
                  {people && <div className="mt-0.5 truncate text-xs text-gray-500">{people}</div>}
                </div>
                <div className="lg:text-right">
                  <StageChip stage={p.workRemaining} />
                </div>
                <div className="lg:[&>div]:items-end">
                  <ReviewerStatusIndicator reviewers={p.reviewers} />
                </div>
                <div>
                  {cycleMetadataReady && p.canManage && (
                    <TriageControl proposal={p} busy={savingIds.has(p.requestId)} onSet={setTriage} />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
