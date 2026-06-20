/**
 * Workbench Awardees list — research awardees for a board cycle, each linking to
 * its Awardee tab to run the grantee deliverables workflow. Fills the gap where
 * the reviewer-finding dashboard doesn't surface awardees (it filters
 * Phase-II-Pending/Advancing; awardees are status=Active research grants).
 */

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Layout, { Card } from '../../shared/components/Layout';
import RequireAppAccess from '../../shared/components/RequireAppAccess';

// Board meets June (J) and December (D); default to the most recent meeting.
function currentCycleCode() {
  const d = new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const m = d.getMonth(); // 0 = Jan
  if (m >= 5 && m < 11) return `J${yy}`;                       // Jun–Nov → June cycle
  if (m >= 11) return `D${yy}`;                                 // Dec → Dec cycle
  return `D${String(d.getFullYear() - 1).slice(-2)}`;          // Jan–May → prior Dec cycle
}

function AwardeesList() {
  const router = useRouter();
  const [cycleCode, setCycleCode] = useState(currentCycleCode());
  const [input, setInput] = useState(currentCycleCode());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Honor a ?cycleCode= deep link (e.g. the workbench "View awardees" link) once
  // the router is ready; falls back to the current-cycle default otherwise.
  useEffect(() => {
    if (!router.isReady) return;
    const q = typeof router.query.cycleCode === 'string' ? router.query.cycleCode.trim().toUpperCase() : '';
    if (q && /^[JD]\d{2}$/.test(q)) { setCycleCode(q); setInput(q); }
  }, [router.isReady, router.query.cycleCode]);

  const load = useCallback(async (code) => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/workbench/grantee-deliverables/awardees?cycleCode=${encodeURIComponent(code)}`);
      const d = await res.json();
      if (!res.ok) { setError(d.error || 'Failed to load awardees.'); setData(null); }
      else setData(d);
    } catch { setError('Failed to load awardees.'); setData(null); }
    setLoading(false);
  }, []);

  useEffect(() => { load(cycleCode); }, [cycleCode, load]);

  return (
    <Layout>
      <Card hover={false}>
        <div className="flex items-center gap-2 mb-4">
          <h1 className="text-lg font-semibold text-gray-900">Grant deliverables — awardees</h1>
        </div>
        <form
          className="flex items-center gap-2 mb-4"
          onSubmit={(e) => { e.preventDefault(); setCycleCode(input.trim().toUpperCase()); }}
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
          {data?.cycleLabel && <span className="text-sm text-gray-500">{data.cycleLabel} · {data.count} awardee(s)</span>}
        </form>

        {loading && <p className="text-sm text-gray-500">Loading…</p>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

        {data && !loading && data.awardees.length === 0 && (
          <p className="text-sm text-gray-500">No research awardees found for {data.cycleLabel || cycleCode}.</p>
        )}

        {data && data.awardees.length > 0 && (
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
              {data.awardees.map((a) => (
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
