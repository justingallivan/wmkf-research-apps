/**
 * Request Workbench — tier-2 cycle dashboard (Phase 1).
 *
 * Lists the requests a PD needs to find reviewers for, in a chosen cycle, with
 * a per-request reviewer work-remaining cue. Rows deep-link to the per-request
 * Workbench (/workbench/<requestId>?tab=reviewers — built in Phase 2).
 *
 * Data: /api/workbench/dashboard (no cycleCode = cycle list; ?cycleCode = rows).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import Layout, { PageHeader, Card } from '../shared/components/Layout';
import RequireAppAccess from '../shared/components/RequireAppAccess';
import ReviewerStatusIndicator from '../shared/components/workbench/ReviewerStatusIndicator';
import WorkbenchViewsNav from '../shared/components/workbench/WorkbenchViewsNav';
import RequestLocator from '../shared/components/workbench/RequestLocator';
import { TRIAGE_STATUS } from '../shared/config/triageStatus';

const STAGE_META = {
  find: { label: 'Find reviewers', cls: 'bg-rose-100 text-rose-800' },
  invite: { label: 'Invite', cls: 'bg-amber-100 text-amber-800' },
  awaiting: { label: 'Awaiting replies', cls: 'bg-blue-100 text-blue-800' },
  review: { label: 'In review', cls: 'bg-indigo-100 text-indigo-800' },
  done: { label: 'Complete', cls: 'bg-green-100 text-green-800' },
};

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

export function WorkbenchDashboard() {
  const router = useRouter();
  const [cycles, setCycles] = useState([]);
  const [cycleCode, setCycleCode] = useState(null);
  const [scope, setScope] = useState('my');
  const [includeSetAside, setIncludeSetAside] = useState(false);

  const [proposals, setProposals] = useState([]);
  const [rollup, setRollup] = useState(null);

  const [loadingCycles, setLoadingCycles] = useState(true);
  const [loadingProposals, setLoadingProposals] = useState(false);
  const [error, setError] = useState(null);
  // Per-row triage flip: ids currently being saved disable only those controls.
  const [savingIds, setSavingIds] = useState(() => new Set());
  const filtersRef = useRef({ cycleCode: null, scope: 'my', includeSetAside: false });

  // Load the cycle picker once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/workbench/dashboard');
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `Failed to load cycles (${res.status})`);
        if (cancelled) return;
        const availableCycles = body.cycles || [];
        const requestedCycle = new URLSearchParams(window.location.search)
          .get('cycleCode')?.trim().toUpperCase();
        setCycles(availableCycles);
        setCycleCode(
          availableCycles.some((cycle) => cycle.code === requestedCycle)
            ? requestedCycle
            : body.defaultCycleCode || availableCycles[0]?.code || null,
        );
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoadingCycles(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Load proposals whenever the selected cycle/scope/toggle changes. A monotonic
  // request id guards against a slower earlier fetch (e.g. a fast toggle) landing
  // after — and overwriting — the latest one.
  const reqIdRef = useRef(0);
  const loadProposals = useCallback(async (code, sc, incl) => {
    if (!code) return;
    const myReq = ++reqIdRef.current;
    setLoadingProposals(true);
    setError(null);
    try {
      const res = await fetch(`/api/workbench/dashboard?cycleCode=${encodeURIComponent(code)}&scope=${sc}${incl ? '&includeSetAside=1' : ''}`);
      const body = await res.json().catch(() => ({}));
      if (reqIdRef.current !== myReq) return; // a newer request superseded this one
      if (!res.ok) throw new Error(body.error || `Failed to load requests (${res.status})`);
      setProposals(body.proposals || []);
      setRollup(body.rollup || null);
    } catch (e) {
      if (reqIdRef.current !== myReq) return;
      setError(e.message);
      setProposals([]);
      setRollup(null);
    } finally {
      if (reqIdRef.current === myReq) setLoadingProposals(false);
    }
  }, []);

  useEffect(() => {
    filtersRef.current = { cycleCode, scope, includeSetAside };
  }, [cycleCode, scope, includeSetAside]);

  useEffect(() => {
    if (!cycleCode) return undefined;
    const timer = window.setTimeout(() => {
      void loadProposals(cycleCode, scope, includeSetAside);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [cycleCode, scope, includeSetAside, loadProposals]);

  // Flip a request's triage status, then refetch (a row may drop out of the
  // default view once Set aside). The server enforces the hard manage gate.
  const setTriage = useCallback(async (requestId, key) => {
    const triageStatus = key === 'advancing' ? TRIAGE_STATUS.ADVANCING : TRIAGE_STATUS.SET_ASIDE;
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
      const { cycleCode: currentCycleCode, scope: currentScope, includeSetAside: currentIncludeSetAside } = filtersRef.current;
      await loadProposals(currentCycleCode, currentScope, currentIncludeSetAside);
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(requestId);
        return next;
      });
    }
  }, [loadProposals]);

  return (
    <Layout title="Request Workbench">
      <PageHeader
        title="Request Workbench"
        subtitle="Find and manage peer reviewers for your grant requests, one cycle at a time."
        icon="🗂️"
      />
      <WorkbenchViewsNav activeKey="requests" cycleCode={cycleCode} />

      <RequestLocator />

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-4 mb-6">
        <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
          Cycle
          <select
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
            value={cycleCode || ''}
            onChange={(e) => setCycleCode(e.target.value || null)}
            disabled={loadingCycles || cycles.length === 0}
          >
            {cycles.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label || c.code}{c.count ? ` (${c.count})` : ''}
              </option>
            ))}
          </select>
        </label>

        <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden">
          {['my', 'all'].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setScope(s)}
              className={`px-4 py-2 text-sm font-medium ${
                scope === s ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              {s === 'my' ? 'My requests' : 'All'}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
          <input
            type="checkbox"
            className="rounded border-gray-300"
            checked={includeSetAside}
            onChange={(e) => setIncludeSetAside(e.target.checked)}
          />
          Show set aside
        </label>

        {rollup && (
          <div className="ml-auto text-sm text-gray-600">
            <span className="font-semibold text-gray-900">{rollup.total}</span> request{rollup.total === 1 ? '' : 's'}
            {rollup.stages?.find ? <span className="ml-3">· {rollup.stages.find} need reviewers</span> : null}
            {rollup.stages?.done ? <span className="ml-3">· {rollup.stages.done} complete</span> : null}
          </div>
        )}
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">{error}</div>
      )}

      {loadingCycles || loadingProposals ? (
        <Card hover={false}><p className="text-gray-500">Loading…</p></Card>
      ) : proposals.length === 0 ? (
        <Card hover={false}>
          <p className="text-gray-500">No requests to show for this cycle and scope.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {proposals.map((p) => {
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
                      {p.canManage && (
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
    </Layout>
  );
}

export default function WorkbenchGuard() {
  return (
    <RequireAppAccess appKey="reviewers">
      <WorkbenchDashboard />
    </RequireAppAccess>
  );
}
