import { useEffect, useRef, useState } from 'react';

// The statuses this component knows how to render. Kept as an allowlist so an
// unrecognized value falls into the visible gap branch, not into silence.
const KNOWN_STATUSES = ['current', 'missing', 'unavailable'];

function formatTimestamp(value) {
  if (!value) return null;
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) return null;
  return timestamp.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Native SharePoint version history for one request's canonical artifact.
 *
 * Fetched ONLY when staff open the disclosure — never on page load. Each open
 * starts a bounded Graph metadata + paginated-history read sequence, and the tab
 * renders for every request whether or not anyone wants the history.
 *
 * Attribution is the point of this surface, not decoration: pilot owner-decision
 * 6 settled that SharePoint native version history is the human-edit audit
 * record, so the editor's name is shown at the same weight as the version.
 *
 * History is read-only for ordinary staff. Superusers may promote a historical
 * version to a new current version through the guarded server restore route.
 */
export default function ArtifactVersionHistory({
  requestId,
  expectedArtifactId,
  isSuperuser = false,
  onRestored = null,
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [restoringVersion, setRestoringVersion] = useState(null);
  const loadSequence = useRef(0);

  // The parent currently remounts this component per request
  // (`key={requestId}` at pages/workbench/[requestId].js:166), which alone would
  // reset the state below. This guard does not rely on that: it lives in another
  // file, and if the key were ever dropped, an in-flight response would paint one
  // request's editor names under a different request. On an attribution surface
  // that is a misleading audit trail, not a cosmetic glitch — so the staleness is
  // checked here too, mirroring the parent tab's own loadSequence pattern.
  useEffect(() => {
    loadSequence.current += 1;
    setOpen(false);
    setState(null);
    setError(null);
    setLoading(false);
    setRestoringVersion(null);
  }, [expectedArtifactId, requestId]);

  const loadHistory = async (sequence) => {
    const response = await fetch(
      `/api/workbench/initial-assessment/versions?requestId=${encodeURIComponent(requestId)}`
        + `&expectedArtifactId=${encodeURIComponent(expectedArtifactId)}`,
    );
    const body = await response.json().catch(() => ({}));
    if (loadSequence.current !== sequence) return null;
    if (!response.ok) {
      if (response.status === 409) {
        throw new Error('This document was replaced. Refresh the page before viewing version history.');
      }
      throw new Error(body.error || `Failed to load version history (${response.status})`);
    }
    setState(body);
    return body;
  };

  const toggle = async () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (state || loading) return;
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError(null);
    try {
      await loadHistory(sequence);
    } catch (loadError) {
      if (loadSequence.current === sequence) setError(loadError.message);
    } finally {
      if (loadSequence.current === sequence) setLoading(false);
    }
  };

  const restore = async (targetVersionId) => {
    if (!isSuperuser || restoringVersion) return;
    const current = state?.versions?.find((version) => version.isCurrent);
    if (!current?.versionId) {
      setError('SharePoint did not identify the current version. Refresh before restoring.');
      return;
    }
    if (!window.confirm(
      `Restore version ${targetVersionId} as a new current version? Existing versions will be preserved.`,
    )) return;
    const sequence = ++loadSequence.current;
    setRestoringVersion(targetVersionId);
    setError(null);
    try {
      const response = await fetch('/api/workbench/initial-assessment/restore-version', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId,
          expectedArtifactId,
          targetVersionId,
          expectedCurrentVersionId: current.versionId,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (loadSequence.current !== sequence) return;
      if (!response.ok) throw new Error(body.error || `Version restore failed (${response.status})`);
      if (body.artifact && typeof onRestored === 'function') onRestored(body.artifact);
      await loadHistory(sequence);
    } catch (restoreError) {
      if (loadSequence.current === sequence) setError(restoreError.message);
    } finally {
      if (loadSequence.current === sequence) setRestoringVersion(null);
    }
  };

  if (!requestId) return null;

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={toggle}
        className="text-xs text-blue-700 hover:underline"
        aria-expanded={open}
      >
        {open ? 'Hide version history' : 'View version history'}
      </button>

      {open && (
        <div className="mt-2">
          {loading && <p className="text-xs text-gray-500">Loading version history…</p>}
          {error && <p className="text-xs text-red-700">{error}</p>}

          {!loading && !error && state?.status === 'current' && (
            state.versions.length === 0 ? (
              <p className="text-xs text-gray-500">SharePoint reported no versions for this file.</p>
            ) : (
              <>
                <ul className="space-y-1">
                  {state.versions.map((version) => (
                    <li key={version.versionId} className="flex flex-wrap items-center gap-x-2 text-xs text-gray-700">
                      <span className="font-medium text-gray-900">
                        Version {version.versionId}
                      </span>
                      {version.isCurrent && (
                        <span className="ml-2 text-emerald-700">current</span>
                      )}
                      {version.lastModifiedBy && (
                        <span className="ml-2 text-gray-900">{version.lastModifiedBy}</span>
                      )}
                      {formatTimestamp(version.lastModified) && (
                        <span className="text-gray-500">
                          {formatTimestamp(version.lastModified)}
                        </span>
                      )}
                      {isSuperuser && !version.isCurrent && (
                        <button
                          type="button"
                          onClick={() => restore(version.versionId)}
                          disabled={Boolean(restoringVersion)}
                          className="text-blue-700 hover:underline disabled:text-gray-400"
                        >
                          {restoringVersion === version.versionId ? 'Restoring…' : 'Restore'}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                {state.hasMore && (
                  // Count the rows actually rendered, and claim nothing about
                  // recency. `limit` is the cap, not the number returned — a
                  // bounded scan can return 3 rows with limit 20 — and because
                  // unseen pages are explicitly not assumed to be ordered, the
                  // rows shown are not provably "the most recent". Overstating
                  // either would misdescribe an audit record.
                  <p className="mt-2 text-xs text-gray-500">
                    Showing {state.versions.length}{' '}
                    version{state.versions.length === 1 ? '' : 's'}. Additional versions may
                    exist in SharePoint.
                  </p>
                )}
              </>
            )
          )}

          {!loading && !error && state?.status === 'missing' && (
            <p className="text-xs text-amber-800">
              The registered SharePoint file could not be found, so it has no readable history.
            </p>
          )}

          {!loading && !error && state?.status === 'unavailable' && (
            <p className="text-xs text-amber-800">
              SharePoint version history is unavailable right now. The document itself is
              unaffected.
            </p>
          )}

          {/*
            Allowlist, not a denylist: a status this UI does not recognize must say
            something rather than render an empty open panel. Without this branch a
            future status value would look like "no history" — silence that reads as
            a fact about the document instead of a gap in this component.
          */}
          {!loading && !error && state && !KNOWN_STATUSES.includes(state.status) && (
            <p className="text-xs text-amber-800">
              Version history could not be displayed. This is a display gap, not a
              statement about the document.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
