/**
 * Initial assessments panel — cycle-wide governed artifact visibility, mounted
 * inside the Request Workbench shell, which owns the cycle.
 *
 * Initial Assessments are not part of the D26 dual-phase workflow (owner
 * decision 2026-09-05, reconfirmed 2026-09-09): for D26 the panel renders the
 * explanatory card and calls no API. The views nav hides this view for D26,
 * so this card is what a deep link to it shows. The cycle-wide Pre-Site draft
 * list is the separate Staff deliberations view.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Card } from '../Layout';
import ArtifactFileMetadata from './ArtifactFileMetadata';

export const INITIAL_ASSESSMENTS_EXCLUDED_CYCLE = 'D26';

export default function InitialAssessmentsPanel({ cycleCode, loadingCycles }) {
  const [artifacts, setArtifacts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const requestSequence = useRef(0);

  useEffect(() => {
    if (!cycleCode || cycleCode === INITIAL_ASSESSMENTS_EXCLUDED_CYCLE) {
      requestSequence.current += 1;
      setArtifacts([]);
      setError(null);
      setLoading(false);
      return undefined;
    }
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError(null);
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

  if (!cycleCode && !loadingCycles) return null;

  return (
    <>
      {error && (
        <div className="mb-4 p-4 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm" role="alert">
          {error}
        </div>
      )}
      {cycleCode === INITIAL_ASSESSMENTS_EXCLUDED_CYCLE ? (
        <Card hover={false}>
          <p className="font-medium text-gray-900">Initial assessments are not part of the D26 dual-phase workflow.</p>
          <p className="mt-1 text-sm text-gray-500">This workspace becomes available for J27, where every complete single-submission proposal receives an Initial Assessment before advancement. Pre-site drafts for this cycle are under Staff deliberations.</p>
        </Card>
      ) : loadingCycles || loading ? (
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
    </>
  );
}
