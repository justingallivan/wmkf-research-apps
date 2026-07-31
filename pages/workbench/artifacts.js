/**
 * Initial Assessment pilot locator — cycle-wide governed artifact visibility.
 *
 * This is the approved draft-functional discovery slice, not the complete
 * Editor Dashboard contract (filters, preview, versions, Reviewed progress).
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Layout, { Card, PageHeader } from '../../shared/components/Layout';
import RequireAppAccess from '../../shared/components/RequireAppAccess';
import ArtifactFileMetadata from '../../shared/components/workbench/ArtifactFileMetadata';

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
        setCycles(body.cycles || []);
        setCycleCode(body.defaultCycleCode || body.cycles?.[0]?.code || '');
        if (!body.defaultCycleCode && !body.cycles?.[0]?.code) setLoading(false);
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
    <Layout title="Initial Assessment Pilot Locator">
      <div className="mb-4">
        <Link href="/workbench" className="text-sm text-gray-500 hover:text-gray-700">
          ← Back to Request Workbench
        </Link>
      </div>
      <PageHeader
        title="Initial Assessment Pilot Locator"
        subtitle="Pilot cycle list for finding governed drafts and opening their canonical SharePoint files."
        icon="📝"
      />
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
      {loading ? (
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
