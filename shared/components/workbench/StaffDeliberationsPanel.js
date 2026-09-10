/**
 * Staff deliberations panel — cycle-wide list of Pre-Site Visit drafts,
 * mounted inside the Request Workbench shell, which owns the cycle. One card
 * per request with a draft, grouped by stage (draft/shared/visit/final; PC
 * Meeting Tracker slice 3, docs/PC_MEETING_TRACKER_PLAN.md §5.4), each with
 * its own four-stop rail, visit line, and next-action link. Rows deep-link to
 * the per-request Staff Deliberations tab, which owns every write.
 *
 * Data: GET /api/workbench/staff-deliberations?cycleCode=…&scope=my|all
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Card } from '../Layout';
import ArtifactFileMetadata from './ArtifactFileMetadata';
import DeliberationStageRail from './DeliberationStageRail';
import ScopeSegment from './ScopeSegment';
import {
  DELIBERATION_STAGE_KEYS,
  DELIBERATION_STAGE_DEFAULT_LABELS,
} from '../../utils/deliberation-stage';

const EMPTY_COUNTS = Object.fromEntries(DELIBERATION_STAGE_KEYS.map((key) => [key, 0]));

// draft/shared land back on the writeup tab; visit/final send staff on to the
// Final Writeup tab, which owns the write for both of those next actions.
const NEXT_ACTION_TAB = {
  draft: 'staff-deliberations',
  shared: 'staff-deliberations',
  visit: 'final-writeup',
  final: 'final-writeup',
};

function requestHref(artifact) {
  const params = new URLSearchParams({ tab: NEXT_ACTION_TAB[artifact.stage] || 'staff-deliberations' });
  if (artifact.requestNumber) params.set('n', artifact.requestNumber);
  return `/workbench/${artifact.requestId}?${params.toString()}`;
}

function visitLineText(artifact) {
  const { visit, stage } = artifact;
  if (visit.status === 'not-scheduled') return 'Visit not scheduled.';
  const date = new Date(visit.startIso).toLocaleDateString();
  const base = visit.status === 'visited' ? `Visited ${date}.` : `Visit ${date}.`;
  return stage === 'shared' && artifact.substate === 'not-sent' ? `${base} Not yet sent.` : base;
}

export default function StaffDeliberationsPanel({
  cycleCode,
  loadingCycles,
  scope = 'my',
  onScopeChange = () => {},
}) {
  const [artifacts, setArtifacts] = useState([]);
  const [counts, setCounts] = useState(EMPTY_COUNTS);
  const [stageLabels, setStageLabels] = useState(DELIBERATION_STAGE_DEFAULT_LABELS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const requestSequence = useRef(0);

  useEffect(() => {
    if (!cycleCode) {
      requestSequence.current += 1;
      setArtifacts([]);
      setCounts(EMPTY_COUNTS);
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
          `/api/workbench/staff-deliberations?cycleCode=${encodeURIComponent(cycleCode)}&scope=${encodeURIComponent(scope)}`,
        );
        const body = await response.json().catch(() => ({}));
        if (requestSequence.current !== sequence) return;
        if (!response.ok) throw new Error(body.error || 'Failed to load pre-site drafts');
        setArtifacts(Array.isArray(body.artifacts) ? body.artifacts : []);
        setCounts(body.counts || EMPTY_COUNTS);
        if (body.stageLabels) setStageLabels(body.stageLabels);
      } catch (loadError) {
        if (requestSequence.current === sequence) {
          setError(loadError.message);
          setArtifacts([]);
          setCounts(EMPTY_COUNTS);
        }
      } finally {
        if (requestSequence.current === sequence) setLoading(false);
      }
    })();
    return () => { requestSequence.current += 1; };
  }, [cycleCode, scope]);

  if (!cycleCode && !loadingCycles) return null;

  const leadLine = DELIBERATION_STAGE_KEYS
    .map((key) => `${counts[key] ?? 0} ${(stageLabels[key] || DELIBERATION_STAGE_DEFAULT_LABELS[key]).toLowerCase()}`)
    .join(' · ');

  const byStage = Object.fromEntries(DELIBERATION_STAGE_KEYS.map((key) => [
    key,
    artifacts.filter((artifact) => artifact.stage === key),
  ]));

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <ScopeSegment scope={scope} onChange={onScopeChange} allLabel="All program directors" />
        {!loadingCycles && !loading && <p className="text-sm text-gray-600">{leadLine}</p>}
      </div>
      {error && (
        <div className="mb-4 p-4 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm" role="alert">
          {error}
        </div>
      )}
      {loadingCycles || loading ? (
        <Card hover={false}><p className="text-gray-500">Loading pre-site drafts…</p></Card>
      ) : artifacts.length === 0 ? (
        <Card hover={false}><p className="text-gray-500">No pre-site drafts for this cycle.</p></Card>
      ) : (
        <div className="space-y-6">
          {DELIBERATION_STAGE_KEYS.filter((key) => byStage[key].length > 0).map((key) => (
            <div key={key}>
              <h3 className="mb-2 text-sm font-semibold text-gray-700">
                {stageLabels[key] || DELIBERATION_STAGE_DEFAULT_LABELS[key]}
              </h3>
              <div className="space-y-3">
                {byStage[key].map((artifact) => (
                  <Card key={artifact.artifactId} hover={false}>
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <Link
                          href={requestHref(artifact)}
                          className="font-semibold text-gray-900 hover:underline"
                        >
                          {artifact.requestNumber ? `#${artifact.requestNumber}` : artifact.requestId}
                          {artifact.title ? ` — ${artifact.title}` : ''}
                        </Link>
                        {artifact.institution && <p className="text-sm text-gray-600 mt-1">{artifact.institution}</p>}
                        {artifact.programDirector && <p className="text-xs text-gray-500 mt-1">PD: {artifact.programDirector}</p>}
                        <DeliberationStageRail stage={artifact.stage} labels={stageLabels} />
                        <p className="mt-1 text-xs text-gray-500">{visitLineText(artifact)}</p>
                      </div>
                      <div className="text-right text-sm">
                        <div className="font-medium text-gray-900">{artifact.lifecycleLabel}</div>
                        <div className="text-gray-500">
                          {artifact.operationLabel}
                          {artifact.isCurrent ? '' : ' · not the current draft'}
                        </div>
                        {artifact.file?.metadataStatus === 'current' ? (
                          <ArtifactFileMetadata file={artifact.file} linkLabel="Open document →" />
                        ) : artifact.file?.webUrl ? (
                          <a
                            href={artifact.file.webUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-block mt-3 text-blue-700 hover:underline"
                          >
                            Open document →
                          </a>
                        ) : null}
                        <Link href={requestHref(artifact)} className="mt-2 block text-xs font-medium text-indigo-600 hover:underline">
                          {NEXT_ACTION_TAB[artifact.stage] === 'final-writeup' ? 'Open Final Writeup →' : 'Open Staff Deliberations →'}
                        </Link>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
