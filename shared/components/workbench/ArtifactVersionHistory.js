import { useState } from 'react';

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
 * costs a Graph round-trip, and the tab renders for every request whether or not
 * anyone wants the history.
 *
 * Attribution is the point of this surface, not decoration: pilot owner-decision
 * 6 settled that SharePoint native version history is the human-edit audit
 * record, so the editor's name is shown at the same weight as the version.
 *
 * Read-only by design. There is no restore control here — that is the
 * administrator half, blocked on outstanding SharePoint permission evidence.
 */
export default function ArtifactVersionHistory({ requestId }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const toggle = async () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (state || loading) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/workbench/initial-assessment/versions?requestId=${encodeURIComponent(requestId)}`,
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || `Failed to load version history (${response.status})`);
      }
      setState(body);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
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
                    <li key={version.versionId} className="text-xs text-gray-700">
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
                        <span className="ml-2 text-gray-500">
                          {formatTimestamp(version.lastModified)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                {state.hasMore && (
                  <p className="mt-2 text-xs text-gray-500">
                    Showing the {state.limit} most recent versions. Older versions exist in
                    SharePoint.
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
        </div>
      )}
    </div>
  );
}
