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
import { useRouter } from 'next/router';
import { Card } from '../Layout';
import ReviewerStatusIndicator from './ReviewerStatusIndicator';
import { TOOLBAR_CONTROL_HEIGHT_CLASS } from '../ToolbarSelect';
import ScopeSegment from './ScopeSegment';
import { TRIAGE_STATUS } from '../../config/triageStatus';

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
  return <span className={`inline-flex min-h-7 items-center px-2.5 py-1 rounded-full text-xs font-semibold ${m.cls}`}>{m.label}</span>;
}

// Per-row triage flip (S261). The surrounding row navigates on click/keyboard,
// so select interactions stop/prevent events before they can trigger navigation.
// The server computes the visible canManage gate, and POST /api/workbench/triage
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
      className="mt-1.5 text-xs border border-gray-300 rounded px-1.5 py-1 bg-white disabled:opacity-50"
      title="Set triage status"
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
  const router = useRouter();
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
      const res = await fetch(`/api/workbench/dashboard?cycleCode=${encodeURIComponent(code)}&scope=${sc}&programId=${encodeURIComponent(selectedProgramId)}${incl ? '&includeSetAside=1' : ''}`);
      const body = await res.json().catch(() => ({}));
      if (reqIdRef.current !== myReq) return; // a newer request superseded this one
      if (!res.ok) {
        const responseError = body && typeof body === 'object' ? body.error : null;
        const requestError = new Error(responseError || `Failed to load requests (${res.status})`);
        requestError.status = res.status;
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
    const triageGeneration = reqIdRef.current;
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
      const res = await fetch('/api/workbench/triage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, triageStatus }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to set triage status (${res.status})`);
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
      if (!mountedRef.current || currentKeyRef.current !== triageKey || reqIdRef.current !== triageGeneration) return;
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
        <div className="space-y-3">
          {visibleProposals.map((p) => {
            const href = `/workbench/${p.requestId}?tab=reviewers&n=${encodeURIComponent(p.requestNumber)}`;
            return (
              <div
                key={p.requestId}
                role="button"
                tabIndex={0}
                className="block"
                onClick={() => router.push(href)}
                onKeyDown={(e) => {
                  if (e.target?.closest?.('select,button,a,input,textarea')) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    router.push(href);
                  }
                }}
              >
                <Card className="cursor-pointer">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-900">#{p.requestNumber}</span>
                        {p.cycleLabel && <span className="text-xs text-gray-500">{p.cycleLabel}</span>}
                        {p.grantProgram && <span className="text-xs text-gray-500">· {p.grantProgram}</span>}
                        {p.advancing && (
                          <span className="inline-flex min-h-7 items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-100 text-purple-800">
                            going-forward
                          </span>
                        )}
                        {p.setAside && (
                          <span className="inline-flex min-h-7 items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-200 text-gray-600">
                            set aside
                          </span>
                        )}
                      </div>
                      {p.institution && <div className="text-sm text-gray-700 mt-1 truncate">{p.institution}</div>}
                      {p.projectLeader && <div className="text-xs text-gray-500 mt-0.5">PI: {p.projectLeader}</div>}
                      {p.programDirector && <div className="text-xs text-gray-500 mt-0.5">PD: {p.programDirector}</div>}
                    </div>
                    <div className="text-right shrink-0">
                      <StageChip stage={p.workRemaining} />
                      <ReviewerStatusIndicator reviewers={p.reviewers} />
                      {cycleMetadataReady && p.canManage && (
                        <TriageControl proposal={p} busy={savingIds.has(p.requestId)} onSet={setTriage} />
                      )}
                    </div>
                  </div>
                </Card>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
