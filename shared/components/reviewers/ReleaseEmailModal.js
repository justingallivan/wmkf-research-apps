/**
 * ReleaseEmailModal — choose why pending reviewers are being released, then
 * optionally review the courtesy emails before releasing them. No reason is
 * preselected; previews render only once a choice calls for an email.
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

import { useEffect, useMemo, useRef, useState } from 'react';
import { RELEASE_REASONS } from '../../config/reviewerLifecycle';

const EXCLUDED_REASON = {
  not_found: 'No longer in this request',
  wrong_request: 'Belongs to a different request',
  not_pending: 'Already responded or already closed',
  no_email: 'No email address on the reviewer record',
  no_pd: 'No active Program Director on this request — nothing can be sent',
  defaults_unavailable: 'The withdrawal email template is missing or blank in Admin',
};

const SEND_RESULT_REASON = {
  withdrawn_email_failed: 'The reviewer was released, but the email failed',
  withdrawn_email_skipped: 'The reviewer was released, but the email template was unavailable',
  withdrawn_no_email: 'The reviewer was released, but no email address was available',
  withdrawn_no_email_by_reason: 'The reviewer was released without an email by choice',
  withdrawn_no_pd: 'The reviewer was released, but no active Program Director could send the email',
  invalid_override: 'The reviewed email was incomplete; reopen and review it again',
  recipient_changed: 'The reviewer’s email address changed after preview; reopen and review the updated recipient',
  sender_changed: 'The Program Director sender changed after preview; reopen and review the updated sender',
  not_pending: 'The reviewer already responded or was already closed',
  changed_skipped: 'The reviewer changed status while the release was being sent',
  write_failed: 'The invitation could not be closed',
  not_found: 'The reviewer is no longer available',
  wrong_request: 'The reviewer no longer belongs to this request',
  missing_result: 'The server did not return a result for this reviewer',
};

const REASON_OPTIONS = [
  {
    value: RELEASE_REASONS.no_longer_needed,
    title: 'No longer needed',
    description: 'We have enough reviewers. A courtesy note goes to each released reviewer.',
  },
  {
    value: RELEASE_REASONS.no_response,
    title: 'No response',
    description: 'The reviewer never answered the invitation. This is recorded on their reviewer history.',
  },
];

export default function ReleaseEmailModal({ requestId, suggestionIds, onClose, onReleased }) {
  const [drafts, setDrafts] = useState(null);
  const [edits, setEdits] = useState({}); // suggestionId -> { subject?, bodyText? }
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);
  // No preselected reason (owner, 2026-09-09): the modal used to open on the
  // email editor before staff had said why they were releasing. Nothing loads
  // and nothing can be released until a reason is chosen.
  const [reason, setReason] = useState(null);
  const [sendCourtesyEmail, setSendCourtesyEmail] = useState(false);
  const mountedRef = useRef(true);
  const sendGenerationRef = useRef(0);
  const sendingRef = useRef(false);
  const previewsRequestedRef = useRef(false);

  const showPreviews = reason === RELEASE_REASONS.no_longer_needed
    || (reason === RELEASE_REASONS.no_response && sendCourtesyEmail);
  const releaseWithoutEmail = reason === RELEASE_REASONS.no_response && !sendCourtesyEmail;

  useEffect(() => {
    // Previews render lazily, the first time a choice calls for an email, and
    // exactly once: `requestId`/`suggestionIds` are fixed for the modal's
    // lifetime (the parent stores the selection when opening it), so switching
    // reasons afterwards reuses the drafts already loaded.
    if (!showPreviews || previewsRequestedRef.current) return undefined;
    previewsRequestedRef.current = true;
    let cancelled = false;
    setLoading(true);
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
  }, [showPreviews, requestId, suggestionIds]);

  useEffect(() => () => {
    mountedRef.current = false;
    sendGenerationRef.current += 1;
  }, []);

  const sendable = useMemo(() => (drafts || []).filter((d) => d.status === 'ok'), [drafts]);
  const excluded = useMemo(() => (drafts || []).filter((d) => d.status !== 'ok'), [drafts]);
  const releaseableIds = !reason
    ? []
    : releaseWithoutEmail
      ? suggestionIds
      : sendable.map((d) => d.suggestionId);
  // The count staff see on the button: the selection until a reason narrows it.
  const releaseCount = reason ? releaseableIds.length : suggestionIds.length;

  const valueFor = (draft, field) => edits[draft.suggestionId]?.[field] ?? draft[field] ?? '';

  const setField = (suggestionId, field, value) => {
    setEdits((prev) => ({ ...prev, [suggestionId]: { ...prev[suggestionId], [field]: value } }));
  };

  // An edit that is blank/whitespace would fall back to the template server-side,
  // which is not what someone who just cleared the box expects. Block instead.
  const blankEdit = showPreviews
    && sendable.some((d) => !String(valueFor(d, 'subject')).trim() || !String(valueFor(d, 'bodyText')).trim());

  const requestClose = () => {
    if (sendingRef.current) return;
    onClose();
  };

  const handleSend = async () => {
    if (releaseableIds.length === 0 || sendingRef.current || blankEdit) return;
    const n = releaseableIds.length;
    const ok = window.confirm(
      releaseWithoutEmail
        ? `Release ${n} reviewer${n === 1 ? '' : 's'}? The invitation will be recorded as unanswered and the link will be disabled.`
        : `Release ${n} reviewer${n === 1 ? '' : 's'}? Each receives the email shown and their invitation is closed — they can no longer respond.`,
    );
    if (!ok) return;

    const sendGeneration = sendGenerationRef.current + 1;
    sendGenerationRef.current = sendGeneration;
    sendingRef.current = true;
    setSending(true);
    setSendError(null);
    try {
      // Bind the send to the complete copy and recipient staff reviewed. The
      // server still re-derives recipient and sender and treats these values
      // only as expected-value guards; they can never redirect the email.
      const overrides = {};
      if (showPreviews) {
        for (const draft of sendable) {
          overrides[draft.suggestionId] = {
            subject: valueFor(draft, 'subject'),
            bodyText: valueFor(draft, 'bodyText'),
            to: draft.to,
            from: draft.from,
            senderId: draft.senderId,
          };
        }
      }

      const resp = await fetch('/api/review-manager/withdraw-sufficient', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId,
          suggestionIds: releaseableIds,
          reason,
          ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!mountedRef.current || sendGeneration !== sendGenerationRef.current) return;
      if (!resp.ok) {
        setSendError(data.error || `Release failed (${resp.status})`);
        return;
      }

      // Only an explicitly emailed row is a clean success. Every other status,
      // including all "withdrawn_*" email failures, remains named and visible.
      const resultById = new Map((Array.isArray(data.results) ? data.results : [])
        .map((result) => [String(result.suggestionId).toLowerCase(), result]));
      const outcomes = releaseableIds.map((suggestionId) => ({
        draft: sendable.find((candidate) => candidate.suggestionId === suggestionId) || { suggestionId },
        result: resultById.get(String(suggestionId).toLowerCase())
          || { suggestionId, status: 'missing_result' },
      }));
      const successStatus = releaseWithoutEmail ? 'withdrawn_no_email_by_reason' : 'withdrawn_emailed';
      const failed = outcomes.filter(({ result }) => result.status !== successStatus);
      if (failed.length > 0) {
        setSendError(
          `${releaseWithoutEmail ? `${outcomes.length - failed.length} recorded. ` : `${outcomes.length - failed.length} emailed. `}`
          + `${failed.length} issue${failed.length === 1 ? '' : 's'}: `
          + failed.map(({ draft, result }) => (
            `${draft.name || draft.suggestionId} — ${SEND_RESULT_REASON[result.status] || result.status}`
          )).join('; '),
        );
        if ((data.withdrawn || 0) > 0 && onReleased) onReleased(data.results || []);
        return;
      }
      if (onReleased) onReleased(data.results || []);
      sendingRef.current = false;
      onClose();
    } catch (err) {
      if (mountedRef.current && sendGeneration === sendGenerationRef.current) {
        setSendError(`Network error: ${err.message}`);
      }
    } finally {
      if (mountedRef.current && sendGeneration === sendGenerationRef.current) {
        sendingRef.current = false;
        setSending(false);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50" onClick={requestClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
          <h3 className="font-semibold text-gray-900">Release invitations</h3>
          <button
            type="button"
            onClick={requestClose}
            disabled={sending}
            className="text-gray-400 hover:text-gray-600 disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="p-4 space-y-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-gray-900">Why are these invitations being released?</legend>
            {REASON_OPTIONS.map((option) => {
              const selected = reason === option.value;
              return (
                <label
                  key={option.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border-2 px-3 py-2.5 transition-colors focus-within:ring-2 focus-within:ring-blue-600 focus-within:ring-offset-2 ${selected ? 'border-blue-600 bg-blue-50' : 'border-gray-300 bg-white hover:border-gray-500 hover:bg-gray-50'}`}
                >
                  <input
                    type="radio"
                    name="release-reason"
                    value={option.value}
                    checked={selected}
                    onChange={() => { setReason(option.value); setSendCourtesyEmail(false); }}
                    aria-describedby={`release-reason-${option.value}-description`}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-gray-900">{option.title}</span>
                    <span id={`release-reason-${option.value}-description`} className="mt-0.5 block text-sm text-gray-600">
                      {option.description}
                    </span>
                  </span>
                </label>
              );
            })}
            {reason === RELEASE_REASONS.no_response && (
              <label className="ml-[2.625rem] flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={sendCourtesyEmail}
                  onChange={(e) => setSendCourtesyEmail(e.target.checked)}
                  className="h-4 w-4 accent-blue-600"
                />
                Also send a courtesy note
              </label>
            )}
          </fieldset>

          {showPreviews && loading && <p className="text-sm text-gray-400">Rendering emails…</p>}
          {showPreviews && loadError && <p className="text-sm text-red-600">{loadError}</p>}

          {releaseWithoutEmail && (
            <p className="text-sm text-gray-600">No email will be sent. The link is disabled and the invitation is recorded as unanswered.</p>
          )}

          {showPreviews && excluded.length > 0 && (
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

          {showPreviews && sendable.map((draft) => (
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

          {showPreviews && !loading && !loadError && sendable.length === 0 && (
            <p className="text-sm text-gray-600">There is nothing to send.</p>
          )}

          {blankEdit && (
            <p className="text-sm text-red-600">Subject and message cannot be empty.</p>
          )}
          {sendError && <p className="text-sm text-red-600">{sendError}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={requestClose}
              disabled={sending}
              className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSend}
              disabled={!reason || (showPreviews && (loading || drafts === null)) || sending || releaseableIds.length === 0 || blankEdit}
              className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-md"
            >
              {sending ? 'Releasing…' : `Release (${releaseCount})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
