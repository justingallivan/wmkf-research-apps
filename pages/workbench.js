/**
 * Request Workbench — tier-2 cycle dashboard (Phase 1).
 *
 * Lists the requests a PD needs to find reviewers for, in a chosen cycle, with
 * a per-request reviewer work-remaining cue. Rows deep-link to the per-request
 * Workbench (/workbench/<requestId>?tab=reviewers — built in Phase 2).
 *
 * Data: /api/workbench/dashboard (no cycleCode = cycle list; ?cycleCode = rows).
 */

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Layout, { PageHeader, Card } from '../shared/components/Layout';
import RequireAppAccess from '../shared/components/RequireAppAccess';

const STAGE_META = {
  find: { label: 'Find reviewers', cls: 'bg-rose-100 text-rose-800' },
  invite: { label: 'Invite', cls: 'bg-amber-100 text-amber-800' },
  awaiting: { label: 'Awaiting replies', cls: 'bg-blue-100 text-blue-800' },
  held: { label: 'Slate held', cls: 'bg-violet-100 text-violet-800' },
  review: { label: 'In review', cls: 'bg-indigo-100 text-indigo-800' },
  done: { label: 'Complete', cls: 'bg-green-100 text-green-800' },
};

function StageChip({ stage }) {
  const m = STAGE_META[stage] || { label: stage, cls: 'bg-gray-100 text-gray-700' };
  return <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold ${m.cls}`}>{m.label}</span>;
}

function WorkbenchDashboard() {
  const [cycles, setCycles] = useState([]);
  const [cycleCode, setCycleCode] = useState(null);
  const [scope, setScope] = useState('my');

  const [proposals, setProposals] = useState([]);
  const [rollup, setRollup] = useState(null);

  const [loadingCycles, setLoadingCycles] = useState(true);
  const [loadingProposals, setLoadingProposals] = useState(false);
  const [error, setError] = useState(null);

  // Load the cycle picker once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/workbench/dashboard');
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `Failed to load cycles (${res.status})`);
        if (cancelled) return;
        setCycles(body.cycles || []);
        setCycleCode(body.defaultCycleCode || body.cycles?.[0]?.code || null);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoadingCycles(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Load proposals whenever the selected cycle or scope changes.
  const loadProposals = useCallback(async (code, sc) => {
    if (!code) return;
    setLoadingProposals(true);
    setError(null);
    try {
      const res = await fetch(`/api/workbench/dashboard?cycleCode=${encodeURIComponent(code)}&scope=${sc}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to load requests (${res.status})`);
      setProposals(body.proposals || []);
      setRollup(body.rollup || null);
    } catch (e) {
      setError(e.message);
      setProposals([]);
      setRollup(null);
    } finally {
      setLoadingProposals(false);
    }
  }, []);

  useEffect(() => {
    if (cycleCode) loadProposals(cycleCode, scope);
  }, [cycleCode, scope, loadProposals]);

  return (
    <Layout title="Request Workbench">
      <PageHeader
        title="Request Workbench"
        subtitle="Find and manage peer reviewers for your grant requests, one cycle at a time."
        icon="🗂️"
      />

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
          {proposals.map((p) => (
            <Link key={p.requestId} href={`/workbench/${p.requestId}?tab=reviewers&n=${encodeURIComponent(p.requestNumber)}`} className="block">
              <Card className="cursor-pointer">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900">#{p.requestNumber}</span>
                      {p.cycleLabel && <span className="text-xs text-gray-500">{p.cycleLabel}</span>}
                      {p.grantProgram && <span className="text-xs text-gray-500">· {p.grantProgram}</span>}
                      {p.allowlisted && (
                        <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-100 text-purple-800">
                          going-forward
                        </span>
                      )}
                    </div>
                    {p.institution && <div className="text-sm text-gray-700 mt-1 truncate">{p.institution}</div>}
                    {p.projectLeader && <div className="text-xs text-gray-500 mt-0.5">PI: {p.projectLeader}</div>}
                  </div>
                  <div className="text-right shrink-0">
                    <StageChip stage={p.workRemaining} />
                    <div className="text-xs text-gray-500 mt-1.5">
                      {p.reviewers.accepted}/{p.reviewers.needed} accepted
                      {p.reviewers.candidates ? ` · ${p.reviewers.candidates} found` : ''}
                    </div>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
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
