/**
 * CampaignConfigModal — edit a request's reviewer-engagement campaign config
 * (Phase 1). The config is persisted on the akoya_request as discrete columns on
 * the first invite-batch send; this modal is the "editable later from the Reviewers
 * tab" surface (spec §3.E).
 *
 * Phase 1 exposes the two fields that exist today end-to-end: "days to respond"
 * (the per-reviewer respond-by offset) and the fixed review-due date. The reminder
 * toggles/leads and desiredCount are persisted on the same record but get their UI
 * controls in the phases that consume them (3 and 4), so we don't surface a control
 * that does nothing yet.
 *
 * Props:
 *   - requestId : the akoya_request GUID
 *   - onClose   : () => void
 *   - onSaved   : optional () => void, fired after a successful save
 */

import { useState, useEffect, useRef } from 'react';

export default function CampaignConfigModal({ requestId, onClose, onSaved }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [respondOffsetDays, setRespondOffsetDays] = useState('');
  const [reviewDueDate, setReviewDueDate] = useState('');

  // Guards post-await setState on the save path if the modal unmounts mid-request.
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/review-manager/campaign-config?requestId=${encodeURIComponent(requestId)}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Failed to load (${res.status})`);
        if (cancelled) return;
        const c = data.config || {};
        setRespondOffsetDays(c.respondOffsetDays == null ? '' : c.respondOffsetDays);
        setReviewDueDate(c.reviewDueDate || '');
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [requestId]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    // Send only fields the user set. Empty string = "leave/clear": offset clears to
    // null (cron treats null as unset); due date clears to null. The server validates.
    const config = {
      respondOffsetDays: respondOffsetDays === '' ? null : Math.max(0, Math.floor(Number(respondOffsetDays))),
      reviewDueDate: reviewDueDate === '' ? null : reviewDueDate,
    };
    try {
      const res = await fetch('/api/review-manager/campaign-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, config }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Failed to save (${res.status})`);
      if (onSaved) onSaved();
      onClose();
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e.message);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <p className="font-medium text-gray-900">Campaign settings</p>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {error && <div className="p-3 bg-amber-50 text-amber-700 rounded-lg text-sm">{error}</div>}
          {loading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : (
            <>
              <label className="block text-xs text-gray-600">
                Days to respond
                <input
                  type="number" min="0" step="1" value={respondOffsetDays}
                  onChange={(e) => setRespondOffsetDays(e.target.value === '' ? '' : Math.max(0, Math.floor(Number(e.target.value))))}
                  className="mt-1 w-full text-sm border border-gray-300 rounded px-2 py-1"
                />
                <span className="block text-[11px] text-gray-400 mt-1">
                  Each reviewer’s respond-by date = when their invitation was sent + this many days.
                </span>
              </label>
              <label className="block text-xs text-gray-600">
                Review due date
                <input
                  type="date" value={reviewDueDate}
                  onChange={(e) => setReviewDueDate(e.target.value)}
                  className="mt-1 w-full text-sm border border-gray-300 rounded px-2 py-1"
                />
                <span className="block text-[11px] text-gray-400 mt-1">
                  Fixed deadline for completed reviews. Edits apply going forward.
                </span>
              </label>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-gray-200">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
          <button
            type="button"
            onClick={handleSave}
            disabled={loading || saving}
            className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
