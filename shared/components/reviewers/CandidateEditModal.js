/**
 * CandidateEditModal — edit a saved candidate's person/researcher details.
 *
 * Click a candidate's name on the Candidates tab to open this; corrects the
 * name, affiliation, email, website, and h-index. The common case is fixing an
 * email that resolved to an assistant/department address rather than the
 * reviewer themselves (so the invitation reaches the right inbox).
 *
 * PATCHes /api/reviewer-finder/my-candidates with { suggestionId, ...changed }.
 * Only changed fields are sent. These edits hit the shared person record
 * (wmkf_potentialreviewer — which since the S213 collapse carries the
 * bibliometric fields directly; the wmkf_appresearcher sidecar was dropped),
 * so they apply to EVERY proposal that references this researcher — not just
 * this request. The footer says so. Ported from the standalone Reviewer Finder.
 *
 * Props:
 *   - candidate : { suggestionId, name, affiliation, email, website, hIndex }
 *   - onClose()
 *   - onSaved()  — called after a successful PATCH so the parent can refresh
 *   - onApply(updates)  — LOCAL mode (the Find/Workbench card, which isn't saved
 *       yet): when provided, Save hands the changed fields to the parent to apply
 *       to client state instead of PATCHing my-candidates. The parent stamps
 *       manual provenance (email/website → emailSource/websiteSource 'manual',
 *       which the invite gate reads as low-confidence). No suggestionId needed.
 *   - nameEditable (default true) — set false in local mode: the Find card keys
 *       candidates by normalized name, so renaming there would desync selection/
 *       dedup. Name is shown read-only and never included in the emitted updates.
 */

import { useState, useEffect } from 'react';

export default function CandidateEditModal({ candidate, onClose, onSaved, onApply, nameEditable = true }) {
  const [formData, setFormData] = useState({ name: '', affiliation: '', email: '', website: '', hIndex: '' });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (candidate) {
      setFormData({
        name: candidate.name || '',
        affiliation: candidate.affiliation || '',
        email: candidate.email || '',
        website: candidate.website || '',
        hIndex: candidate.hIndex ?? '',
      });
      setError(null);
    }
  }, [candidate]);

  if (!candidate) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    setError(null);

    try {
      // Send only changed fields. Name is omitted entirely when not editable
      // (local mode): the Find card is keyed by normalized name, so a rename
      // there would desync selection/dedup.
      const updates = {};
      if (nameEditable && formData.name !== (candidate.name || '')) updates.name = formData.name;
      if (formData.affiliation !== (candidate.affiliation || '')) updates.affiliation = formData.affiliation;
      if (formData.email !== (candidate.email || '')) updates.email = formData.email;
      if (formData.website !== (candidate.website || '')) updates.website = formData.website;
      if (String(formData.hIndex) !== String(candidate.hIndex ?? '')) {
        updates.hIndex = formData.hIndex === '' ? null : parseInt(formData.hIndex, 10);
      }

      if (Object.keys(updates).length === 0) {
        onClose();
        return;
      }

      // LOCAL mode: apply to client state via the parent (no PATCH — the Find-card
      // candidate isn't a saved row yet). The parent stamps manual provenance.
      if (onApply) {
        onApply(updates);
        onClose();
        return;
      }

      const response = await fetch('/api/reviewer-finder/my-candidates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestionId: candidate.suggestionId, ...updates }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        // Prefer the human-readable `message` (set for translated errors like
        // duplicate-key 409s); fall back to the machine code or a generic line.
        throw new Error(data.message || data.error || 'Failed to update candidate');
      }

      if (onSaved) await onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="font-semibold text-gray-900">Edit candidate</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className={`w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 ${nameEditable ? '' : 'bg-gray-100 text-gray-500 cursor-not-allowed'}`}
              required
              readOnly={!nameEditable}
              title={nameEditable ? undefined : 'Name is locked here — rename from the saved Candidates tab if needed'}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Affiliation</label>
            <input
              type="text"
              value={formData.affiliation}
              onChange={(e) => setFormData({ ...formData, affiliation: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              placeholder="researcher@university.edu"
            />
            <p className="text-xs text-gray-400 mt-1">Correct this if the listed address belongs to an assistant or department.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Website</label>
            <input
              type="url"
              value={formData.website}
              onChange={(e) => setFormData({ ...formData, website: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              placeholder="https://..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">h-index</label>
            <input
              type="number"
              value={formData.hIndex}
              onChange={(e) => setFormData({ ...formData, hIndex: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              min="0"
              placeholder="e.g., 25"
            />
          </div>

          <p className="text-xs text-gray-500">
            {onApply
              ? 'A manually entered email/website is marked unverified — you’ll confirm before any invitation is sent. Saved with this request when you save the candidate.'
              : 'Changes apply to this researcher across all proposals that reference them.'}
          </p>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200">
              Cancel
            </button>
            <button type="submit" disabled={isSaving} className="px-4 py-2 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50">
              {isSaving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
