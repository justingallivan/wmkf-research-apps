/**
 * RemoveEntirelyModal — permanent reviewer removal confirm dialog.
 *
 * See docs/REVIEWER_REMOVE_ENTIRELY_BUILD_PLAN.md. Distinct from the
 * recoverable "X" (soft-delete) — this PERMANENTLY deletes, in one atomic
 * Dataverse changeset, the honorarium akoya_request (if linked), any
 * review-answer snapshot rows, and the suggestion row itself. It then runs
 * isolated best-effort cleanups for SharePoint review files and the Postgres
 * review draft. Optionally (opt-in, default OFF) it also attempts to delete
 * the global contact in a separate changeset.
 *
 * Fetches the preflight disclosure (GET .../my-candidates?mode=removal-
 * preflight&suggestionId=...) on open so the confirm is driven by accurate,
 * server-computed facts (honorarium $, submitted-review presence, and — only
 * if the PD opts into deleting the contact — the contact's other
 * associations), not client-cached candidate fields.
 *
 * Props:
 *   - candidate : { suggestionId, name }
 *   - onClose()
 *   - onRemoved() — called after a successful DELETE so the parent can refresh
 */

import { useEffect, useState } from 'react';

function formatAmount(amount) {
  if (amount === null || amount === undefined) return null;
  const n = Number(amount);
  if (Number.isNaN(n)) return String(amount);
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export default function RemoveEntirelyModal({ candidate, onClose, onRemoved }) {
  const [disclosure, setDisclosure] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deleteContact, setDeleteContact] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    fetch(`/api/reviewer-finder/my-candidates?mode=removal-preflight&suggestionId=${encodeURIComponent(candidate.suggestionId)}`)
      .then(async (resp) => {
        const data = await resp.json().catch(() => ({}));
        if (cancelled) return;
        if (!resp.ok) {
          setLoadError(data.error || data.message || `Could not load removal preview (${resp.status})`);
        } else {
          setDisclosure(data);
        }
      })
      .catch((err) => { if (!cancelled) setLoadError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [candidate.suggestionId]);

  const handleRemove = async () => {
    const name = candidate.name || 'this candidate';
    const parts = [`Permanently remove ${name}? This CANNOT be undone.`];
    if (disclosure?.honorarium) {
      parts.push(`This deletes their honorarium request (${formatAmount(disclosure.honorarium.amount) || 'amount unknown'}).`);
    }
    if (disclosure?.hasSubmittedReview) {
      parts.push(
        disclosure?.reviewSharePointFolder
          ? 'This removes submitted-review Dataverse rows and attempts best-effort cleanup of uploaded SharePoint review file(s).'
          : 'This removes submitted-review Dataverse rows. No SharePoint file pointer is present on the row.',
      );
    }
    if (deleteContact) {
      parts.push('This ALSO attempts to permanently delete their contact record.');
    }
    if (!confirm(parts.join('\n\n'))) return;

    setRemoving(true);
    setRemoveError(null);
    try {
      const resp = await fetch('/api/reviewer-finder/my-candidates', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestionId: candidate.suggestionId, mode: 'hard', deleteContact }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        setRemoveError(data.error || data.message || data.details || `Removal failed (${resp.status})`);
        return;
      }
      if (onRemoved) onRemoved();
      onClose();
    } catch (err) {
      setRemoveError(`Network error: ${err.message}`);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-red-100 bg-red-50">
          <h3 className="font-semibold text-red-900">Remove entirely (permanent)</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">✕</button>
        </div>

        <div className="p-4 space-y-4">
          <p className="text-sm text-gray-700">
            Permanently delete <span className="font-medium">{candidate.name || 'this candidate'}</span>’s engagement
            for this request. Unlike the recoverable “X”, this cannot be restored.
          </p>

          {loading && <p className="text-sm text-gray-400">Loading removal preview…</p>}
          {loadError && <p className="text-sm text-red-600">{loadError}</p>}

          {disclosure && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 space-y-1">
              <p className="font-medium">This will delete:</p>
              <ul className="list-disc list-inside space-y-0.5">
                <li>The candidate engagement for this request</li>
                {disclosure.answerRowCount > 0 && (
                  <li>{disclosure.answerRowCount} submitted-review answer row{disclosure.answerRowCount === 1 ? '' : 's'}</li>
                )}
                {disclosure.honorarium && (
                  <li>
                    Their honorarium request
                    {formatAmount(disclosure.honorarium.amount) ? ` (${formatAmount(disclosure.honorarium.amount)})` : ''}
                    {' — '}<span className="font-medium">we will never pay this person for this engagement</span>
                  </li>
                )}
                {disclosure.hasSubmittedReview && (
                  <li>
                    Submitted-review Dataverse rows
                    {disclosure.reviewSharePointFolder
                      ? ' and best-effort cleanup of uploaded SharePoint file(s)'
                      : ' (no SharePoint file pointer on the row)'}
                  </li>
                )}
                {disclosure.reviewSharePointFolder && (
                  <li className="break-all">
                    SharePoint review pointer recorded for audit: {disclosure.reviewSharePointFolder}
                    {disclosure.reviewFilename ? ` / ${disclosure.reviewFilename}` : ''}
                  </li>
                )}
                {disclosure.reviewFileCleanupPreview && (
                  <li>
                    {disclosure.reviewFileCleanupPreview.error
                      ? 'SharePoint cleanup preview unavailable; the engagement can still be removed, but file cleanup will be skipped and audited.'
                      : (
                        <>
                          SharePoint cleanup preview: delete{' '}
                          {disclosure.reviewFileCleanupPreview.deleteFiles.length > 0
                            ? disclosure.reviewFileCleanupPreview.deleteFiles
                              .map((file) => file.name || file.id)
                              .join(', ')
                            : 'no files'}
                          {disclosure.reviewFileCleanupPreview.preserveFiles.length > 0
                            ? `; preserve ${disclosure.reviewFileCleanupPreview.preserveFiles
                              .map((file) => file.name || file.id)
                              .join(', ')}`
                            : ''}
                        </>
                      )}
                  </li>
                )}
              </ul>
            </div>
          )}

          {disclosure?.contactId && (
            <div className="rounded-md border border-gray-200 p-3 space-y-2">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={deleteContact}
                  onChange={(e) => setDeleteContact(e.target.checked)}
                />
                <span>
                  Also attempt to delete this contact <span className="text-gray-500">(default off — leaves the reviewer's global CRM record intact)</span>
                </span>
              </label>
              {deleteContact && disclosure.contactAssociations && (
                <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2 space-y-1">
                  <p className="font-medium">Blast radius — this contact also has:</p>
                  <ul className="list-disc list-inside">
                    {disclosure.contactAssociations.otherEngagementCount > 0 && (
                      <li>{disclosure.contactAssociations.otherEngagementCount} other reviewer engagement(s) across other requests</li>
                    )}
                    {disclosure.contactAssociations.otherGrantOrHonorariumRequestCount > 0 && (
                      <li>{disclosure.contactAssociations.otherGrantOrHonorariumRequestCount} other grant/honorarium request(s) as primary contact</li>
                    )}
                    {disclosure.contactAssociations.portalIdentityLinked && <li>A linked applicant-portal identity</li>}
                    {disclosure.contactAssociations.billVendorLinked && <li>A linked BILL vendor record</li>}
                  </ul>
                  <p className="text-red-500">{disclosure.contactAssociations.note}</p>
                </div>
              )}
            </div>
          )}

          {removeError && <p className="text-sm text-red-600">{removeError}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">
              Cancel
            </button>
            <button
              type="button"
              onClick={handleRemove}
              disabled={loading || removing || Boolean(loadError)}
              className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-md"
            >
              {removing ? 'Removing…' : 'Remove entirely'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
