/**
 * ReleaseEmailModal — review and edit the "no longer needed" courtesy emails
 * before releasing pending reviewers.
 *
 * Staff asked for a tune-up step: the release previously sent a fixed
 * server-rendered template straight from a confirm dialog, unlike the invitation
 * flow, which has always been editable per recipient (InviteEmailModal).
 *
 * Flow, mirroring render-emails → send-emails:
 *   1. POST /api/review-manager/render-withdraw-emails  → per-reviewer drafts
 *   2. staff edits subject/body per reviewer
 *   3. POST /api/review-manager/withdraw-sufficient with `overrides`
 *
 * The withdrawal and the email are one server-side operation, so this modal
 * cannot "draft without releasing" — sending IS the release. The button says so.
 *
 * Rows the server will not email (already responded, no address, no PD) come
 * back with a status instead of a draft and are listed as excluded rather than
 * hidden, so the count staff confirm matches what actually goes out.
 *
 * Props:
 *   - requestId    : GUID
 *   - suggestionIds: GUID[] — the pending rows staff selected
 *   - onClose()
 *   - onReleased() — called after a successful release so the parent can refresh
 */

import { useEffect, useMemo, useState } from 'react';

const EXCLUDED_REASON = {
  not_found: 'No longer in this request',
  wrong_request: 'Belongs to a different request',
  not_pending: 'Already responded or already closed',
  no_email: 'No email address on the reviewer record',
  no_pd: 'No active Program Director on this request — nothing can be sent',
  defaults_unavailable: 'The withdrawal email template is missing or blank in Admin',
};

export default function ReleaseEmailModal({ requestId, suggestionIds, onClose, onReleased }) {
  const [drafts, setDrafts] = useState(null);
  const [edits, setEdits] = useState({}); // suggestionId -> { subject?, bodyText? }
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);

  useEffect(() => {
    // No setLoading(true)/setLoadError(null) here: initial state already is
    // loading + no-error, and `requestId`/`suggestionIds` are fixed for the
    // modal's lifetime (the parent stores the selection when opening it), so
    // this effect runs exactly once.
    let cancelled = false;
    fetch('/api/review-manager/render-withdraw-emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, suggestionIds }),
    })
      .then(async (resp) => {
        const data = await resp.json().catch(() => ({}));
        if (cancelled) return;
        if (!resp.ok) setLoadError(data.error || `Could not render the emails (${resp.status})`);
        else setDrafts(data.drafts || []);
      })
      .catch((err) => { if (!cancelled) setLoadError(`Network error: ${err.message}`); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [requestId, suggestionIds]);

  const sendable = useMemo(() => (drafts || []).filter((d) => d.status === 'ok'), [drafts]);
  const excluded = useMemo(() => (drafts || []).filter((d) => d.status !== 'ok'), [drafts]);

  const valueFor = (draft, field) => edits[draft.suggestionId]?.[field] ?? draft[field] ?? '';

  const setField = (suggestionId, field, value) => {
    setEdits((prev) => ({ ...prev, [suggestionId]: { ...prev[suggestionId], [field]: value } }));
  };

  // An edit that is blank/whitespace would fall back to the template server-side,
  // which is not what someone who just cleared the box expects. Block instead.
  const blankEdit = sendable.some((d) => !String(valueFor(d, 'subject')).trim() || !String(valueFor(d, 'bodyText')).trim());

  const handleSend = async () => {
    if (sendable.length === 0 || sending || blankEdit) return;
    const n = sendable.length;
    const ok = window.confirm(
      `Send and release ${n} reviewer${n === 1 ? '' : 's'}? `
      + 'Each receives the email shown and their invitation is closed — they can no longer respond.',
    );
    if (!ok) return;

    setSending(true);
    setSendError(null);
    try {
      // Send only edits for rows still being released, and only fields that
      // actually differ from what the server rendered.
      const overrides = {};
      for (const draft of sendable) {
        const entry = {};
        const subject = valueFor(draft, 'subject');
        const bodyText = valueFor(draft, 'bodyText');
        if (subject !== draft.subject) entry.subject = subject;
        if (bodyText !== draft.bodyText) entry.bodyText = bodyText;
        if (Object.keys(entry).length > 0) overrides[draft.suggestionId] = entry;
      }

      const resp = await fetch('/api/review-manager/withdraw-sufficient', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId,
          suggestionIds: sendable.map((d) => d.suggestionId),
          ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setSendError(data.error || `Release failed (${resp.status})`);
        return;
      }
      // Partial success is normal here (a reviewer can accept mid-flight), so
      // surface per-row failures instead of reporting a clean success.
      const failed = (data.results || []).filter((r) => !String(r.status).startsWith('withdrawn'));
      if (failed.length > 0) {
        setSendError(
          `${data.withdrawn || 0} released. ${failed.length} skipped: `
          + failed.map((r) => r.status).join(', '),
        );
        if (onReleased) onReleased();
        return;
      }
      if (onReleased) onReleased();
      onClose();
    } catch (err) {
      setSendError(`Network error: ${err.message}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
          <h3 className="font-semibold text-gray-900">Review release emails</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">✕</button>
        </div>

        <div className="p-4 space-y-4">
          <p className="text-sm text-gray-700">
            Edit any message before it goes out. Sending also closes each invitation —
            these reviewers will no longer be able to respond.
          </p>

          {loading && <p className="text-sm text-gray-400">Rendering emails…</p>}
          {loadError && <p className="text-sm text-red-600">{loadError}</p>}

          {excluded.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-medium">
                {excluded.length} selected reviewer{excluded.length === 1 ? '' : 's'} will not be emailed:
              </p>
              <ul className="list-disc list-inside space-y-0.5 mt-1">
                {excluded.map((d) => (
                  <li key={d.suggestionId}>
                    {d.name || d.suggestionId} — {EXCLUDED_REASON[d.status] || d.status}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {sendable.map((draft) => (
            <div key={draft.suggestionId} className="rounded-md border border-gray-200 p-3 space-y-2">
              <div className="text-sm">
                <span className="font-medium text-gray-900">{draft.name || 'Reviewer'}</span>{' '}
                <span className="text-gray-500">&lt;{draft.to}&gt;</span>
              </div>
              <label className="block">
                <span className="text-xs font-medium text-gray-600">Subject</span>
                <input
                  type="text"
                  value={valueFor(draft, 'subject')}
                  onChange={(e) => setField(draft.suggestionId, 'subject', e.target.value)}
                  className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-gray-600">Message</span>
                <textarea
                  rows={12}
                  value={valueFor(draft, 'bodyText')}
                  onChange={(e) => setField(draft.suggestionId, 'bodyText', e.target.value)}
                  className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm font-mono"
                />
              </label>
            </div>
          ))}

          {!loading && !loadError && sendable.length === 0 && (
            <p className="text-sm text-gray-600">There is nothing to send.</p>
          )}

          {blankEdit && (
            <p className="text-sm text-red-600">Subject and message cannot be empty.</p>
          )}
          {sendError && <p className="text-sm text-red-600">{sendError}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSend}
              disabled={loading || sending || sendable.length === 0 || blankEdit}
              className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-md"
            >
              {sending ? 'Sending…' : `Send and release ${sendable.length || ''}`.trim()}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
