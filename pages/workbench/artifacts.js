/**
 * Initial Assessment cycle locator — cycle-wide governed artifact visibility.
 *
 * This is the narrow cycle-wide discovery slice; the next-cycle workflow may
 * grow it with staff progress and document context as those contracts settle.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Layout, { Card, PageHeader } from '../../shared/components/Layout';
import RequireAppAccess from '../../shared/components/RequireAppAccess';
import ArtifactFileMetadata from '../../shared/components/workbench/ArtifactFileMetadata';
import WorkbenchViewsNav from '../../shared/components/workbench/WorkbenchViewsNav';

function ArtifactDashboard() {
  const [cycles, setCycles] = useState([]);
  const [cycleCode, setCycleCode] = useState('');
  const [artifacts, setArtifacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const requestSequence = useRef(0);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await fetch('/api/workbench/initial-assessment');
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'Failed to load cycles');
        if (!active) return;
        const availableCycles = body.cycles || [];
        const requestedCycle = new URLSearchParams(window.location.search)
          .get('cycleCode')?.trim().toUpperCase();
        const selectedCycle = availableCycles.some((cycle) => cycle.code === requestedCycle)
          ? requestedCycle
          : body.defaultCycleCode || availableCycles[0]?.code || '';
        setCycles(availableCycles);
        setCycleCode(selectedCycle);
        if (!selectedCycle) setLoading(false);
      } catch (loadError) {
        if (active) {
          setError(loadError.message);
          setLoading(false);
        }
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!cycleCode) return;
    if (cycleCode === 'D26') {
      return;
    }
    const sequence = ++requestSequence.current;
    (async () => {
      try {
        const response = await fetch(
          `/api/workbench/initial-assessment?cycleCode=${encodeURIComponent(cycleCode)}`,
        );
        const body = await response.json().catch(() => ({}));
        if (requestSequence.current !== sequence) return;
        if (!response.ok) throw new Error(body.error || 'Failed to load artifacts');
        setArtifacts(body.artifacts || []);
      } catch (loadError) {
        if (requestSequence.current === sequence) {
          setError(loadError.message);
          setArtifacts([]);
        }
      } finally {
        if (requestSequence.current === sequence) setLoading(false);
      }
    })();
    return () => { requestSequence.current += 1; };
  }, [cycleCode]);

  return (
    <Layout title="Initial assessments">
      <PageHeader
        title="Initial assessments"
        subtitle="Find governed Initial Assessments and open their canonical SharePoint files."
        icon="📝"
      />
      <WorkbenchViewsNav activeKey="initial-assessments" cycleCode={cycleCode} />
      <div className="mb-6">
        <label className="text-sm font-medium text-gray-700">
          Cycle{' '}
          <select
            value={cycleCode}
            onChange={(event) => {
              setLoading(true);
              setError(null);
              setCycleCode(event.target.value);
            }}
            className="ml-2 border border-gray-300 rounded-lg px-3 py-2 bg-white"
          >
            {cycles.map((cycle) => (
              <option key={cycle.code} value={cycle.code}>{cycle.label || cycle.code}</option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <div className="mb-4 p-4 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">
          {error}
        </div>
      )}
      {cycleCode === 'D26' ? (
        <Card hover={false}>
          <p className="font-medium text-gray-900">Initial assessments are not part of the D26 dual-phase workflow.</p>
          <p className="mt-1 text-sm text-gray-500">This workspace becomes available for J27, where every complete single-submission proposal receives an Initial Assessment before advancement.</p>
        </Card>
      ) : loading ? (
        <Card hover={false}><p className="text-gray-500">Loading artifacts…</p></Card>
      ) : artifacts.length === 0 ? (
        <Card hover={false}><p className="text-gray-500">No Initial Assessments for this cycle.</p></Card>
      ) : (
        <div className="space-y-3">
          {artifacts.map((artifact) => (
            <Card key={artifact.artifactId} hover={false}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <Link
                    href={`/workbench/${artifact.requestId}?tab=initial-writeup${artifact.requestNumber ? `&n=${encodeURIComponent(artifact.requestNumber)}` : ''}`}
                    className="font-semibold text-gray-900 hover:underline"
                  >
                    {artifact.requestNumber ? `#${artifact.requestNumber}` : artifact.requestId}
                    {artifact.title ? ` — ${artifact.title}` : ''}
                  </Link>
                  {artifact.institution && <p className="text-sm text-gray-600 mt-1">{artifact.institution}</p>}
                  {artifact.programDirector && <p className="text-xs text-gray-500 mt-1">PD: {artifact.programDirector}</p>}
                </div>
                <div className="text-right text-sm">
                  <div className="font-medium text-gray-900">{artifact.operationLabel}</div>
                  <div className="text-gray-500">{artifact.lifecycleLabel}</div>
                  <ArtifactFileMetadata
                    file={artifact.file}
                    linkLabel="Open document →"
                  />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </Layout>
  );
}

export default function ArtifactDashboardGuard() {
  return (
    <RequireAppAccess appKey="reviewers">
      <ArtifactDashboard />
    </RequireAppAccess>
  );
}
