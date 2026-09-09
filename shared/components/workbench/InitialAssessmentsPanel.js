/**
 * Initial assessments panel — cycle-wide governed artifact visibility, mounted
 * inside the Request Workbench shell, which owns the cycle. Lists every
 * Initial Assessment (the pre-site draft writeup) in the cycle with its
 * operation and lifecycle state, linking to the per-request tab.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Card } from '../Layout';
import ArtifactFileMetadata from './ArtifactFileMetadata';

export default function InitialAssessmentsPanel({ cycleCode, loadingCycles }) {
  const [artifacts, setArtifacts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const requestSequence = useRef(0);

  useEffect(() => {
    if (!cycleCode) {
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
      {loadingCycles || loading ? (
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
