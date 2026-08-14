/**
 * Editable preview for one invited reviewer's respond-by nudge.
 *
 * Preview is read-only server work: no token, reminder marker, or email is
 * created until the explicit Send action. Recipient and sender are displayed
 * but not editable; the send request echoes them only as freshness guards.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const ERROR_MESSAGE = {
  removed: 'This reviewer was removed from the proposal — restore them first.',
  revoked: "This reviewer's access was withdrawn — reissue their link before nudging.",
  ineligible: 'This reviewer has already responded or is no longer eligible for a reminder.',
  conflict: 'This reminder was already claimed by another send — refresh to see the latest status.',
  not_found: 'This reviewer is no longer available — refresh to update the list.',
  read_failed: "I couldn't verify this reviewer's latest status. No reminder was sent; try again.",
  prepare_failed: 'I could not prepare the reminder. No reminder was sent; try again.',
  send_failed: 'The reminder was prepared, but the email could not be sent.',
  invalid_preview: 'The reviewed email is incomplete; reload the preview and try again.',
  recipient_changed: 'The reviewer’s email address changed after preview; reload and review the updated recipient.',
  sender_changed: 'The Program Director sender changed after preview; reload and review the updated sender.',
  misconfigured: 'The respond-reminder email template is missing or blank in Admin.',
};

function responseError(data, fallback) {
  return ERROR_MESSAGE[data?.reason] || data?.errors?.[0] || fallback;
}

export default function RespondReminderModal({ requestId, candidate, onClose, onSent, onStale }) {
  const [draft, setDraft] = useState(null);
  const [subject, setSubject] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);
  const mountedRef = useRef(true);
  const loadGenerationRef = useRef(0);
  const sendGenerationRef = useRef(0);
  const sendingRef = useRef(false);

  const loadPreview = useCallback(async () => {
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    setLoading(true);
    setLoadError(null);
    setSendError(null);
    try {
      const resp = await fetch('/api/review-manager/send-review-reminder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId,
          suggestionId: candidate.suggestionId,
          kind: 'respond',
          action: 'preview',
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!mountedRef.current || generation !== loadGenerationRef.current) return;
      if (!resp.ok || !data.ok || !data.draft) {
        setLoadError(responseError(data, 'Could not load the reminder preview.'));
        if (onStale && ['removed', 'revoked', 'not_found'].includes(data.reason)) onStale();
        return;
      }
      setDraft(data.draft);
      setSubject(data.draft.subject || '');
      setBodyText(data.draft.bodyText || '');
    } catch (error) {
      if (mountedRef.current && generation === loadGenerationRef.current) {
        setLoadError(`Network error loading preview: ${error.message}`);
      }
    } finally {
      if (mountedRef.current && generation === loadGenerationRef.current) setLoading(false);
    }
  }, [candidate.suggestionId, onStale, requestId]);

  useEffect(() => {
    mountedRef.current = true;
    loadPreview();
    return () => {
      mountedRef.current = false;
      loadGenerationRef.current += 1;
      sendGenerationRef.current += 1;
    };
  }, [loadPreview]);

  const blankEdit = !subject.trim() || !bodyText.trim();

  const requestClose = () => {
    if (!sendingRef.current) onClose();
  };

  const handleSend = async () => {
    if (!draft || blankEdit || sendingRef.current) return;
    const generation = sendGenerationRef.current + 1;
    sendGenerationRef.current = generation;
    sendingRef.current = true;
    setSending(true);
    setSendError(null);
    try {
      const resp = await fetch('/api/review-manager/send-review-reminder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId,
          suggestionId: candidate.suggestionId,
          kind: 'respond',
          action: 'send',
          reviewed: {
            subject,
            bodyText,
            to: draft.to,
            from: draft.from,
            senderId: draft.senderId,
          },
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!mountedRef.current || generation !== sendGenerationRef.current) return;
      if (!resp.ok || !data.ok) {
        setSendError(responseError(data, 'Could not send the reminder. Refresh and try again.'));
        if (onStale && ['removed', 'revoked', 'not_found'].includes(data.reason)) onStale();
        return;
      }
      sendingRef.current = false;
      if (onSent) onSent();
      onClose();
    } catch (error) {
      if (mountedRef.current && generation === sendGenerationRef.current) {
        setSendError(`Network error sending reminder: ${error.message}`);
      }
    } finally {
      if (mountedRef.current && generation === sendGenerationRef.current) {
        sendingRef.current = false;
        setSending(false);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50" onClick={requestClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
          <h3 className="font-semibold text-gray-900">Review reminder email</h3>
          <button type="button" onClick={requestClose} disabled={sending} className="text-gray-400 hover:text-gray-600 disabled:opacity-40" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="p-4 space-y-4">
          <p className="text-sm text-gray-700">
            Review and edit the email before sending it to {candidate.name || 'this reviewer'}.
          </p>

          {loading && <p className="text-sm text-gray-500">Rendering reminder…</p>}
          {loadError && (
            <div className="space-y-2">
              <p className="text-sm text-red-600">{loadError}</p>
              <button type="button" onClick={loadPreview} className="text-sm text-blue-700 hover:text-blue-900 underline">Retry preview</button>
            </div>
          )}

          {draft && !loading && (
            <>
              <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm space-y-1">
                <p><span className="font-medium text-gray-700">From:</span> {draft.from}</p>
                <p><span className="font-medium text-gray-700">To:</span> {draft.name || candidate.name || 'Reviewer'} &lt;{draft.to}&gt;</p>
              </div>
              <label className="block">
                <span className="text-xs font-medium text-gray-600">Subject</span>
                <input type="text" value={subject} onChange={(event) => setSubject(event.target.value)} disabled={sending} className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm disabled:bg-gray-100" />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-gray-600">Message</span>
                <textarea rows={12} value={bodyText} onChange={(event) => setBodyText(event.target.value)} disabled={sending} className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm font-mono disabled:bg-gray-100" />
              </label>
              <p className="text-xs text-gray-500">
                A fresh, secure “Accept or decline” button and fallback link are added by the server when you send.
              </p>
            </>
          )}

          {blankEdit && draft && <p className="text-sm text-red-600">Subject and message cannot be empty.</p>}
          {sendError && <p className="text-sm text-red-600">{sendError}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={requestClose} disabled={sending} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 disabled:opacity-40">Cancel</button>
            <button type="button" onClick={handleSend} disabled={loading || sending || !draft || blankEdit} className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-md">
              {sending ? 'Sending…' : 'Send reminder'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
