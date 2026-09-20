import { useEffect, useRef, useState } from 'react';
import EmailSendFeedback from '../EmailSendFeedback';
import { requestEnvelope } from '../../utils/api-request';

const REASON = 'sufficient_reviews_received';

const FAILURE_LABELS = {
  not_found: 'The reviewer engagement no longer exists. Reload and try again.',
  wrong_request: 'The reviewer is no longer attached to this request. Reload and try again.',
  already_declined: 'The reviewer has already declined this assignment.',
  not_accepted: 'The reviewer has not accepted this assignment.',
  review_received: 'A review has already been received, so this reviewer cannot be released as Review not received.',
  completed: 'This reviewer has already been marked complete.',
  already_terminal: 'This engagement has already ended.',
  invalid_source: 'The reviewer is no longer in a releasable status. Reload and try again.',
  missing_etag: 'The reviewer record has no concurrency version. Reload and try again.',
  read_failed: 'The reviewer record could not be verified. Reload and try again.',
  invalid_override: 'The reviewed release details are incomplete. Reopen the dialog and try again.',
  notes_changed: 'The internal notes changed after this dialog opened. Reopen it to review the current notes.',
  invalid_note: 'The internal note is invalid or too long.',
  recipient_changed: 'The reviewer email changed after preview. Reopen the dialog to review the current recipient.',
  sender_changed: 'The Program Director sender changed after preview. Reopen the dialog to review the current sender.',
  honorarium_authorized: 'The honorarium is already authorized for payment and cannot be cancelled here.',
  honorarium_paid: 'The honorarium has a paid amount and cannot be cancelled here.',
  honorarium_not_open: 'The linked honorarium is not in an open Pending state.',
  honorarium_missing_etag: 'The linked honorarium has no concurrency version. Reload and try again.',
  honorarium_read_failed: 'The linked honorarium could not be verified.',
  changed_skipped: 'The reviewer record changed while the release was being saved.',
};

// write_failed carries a `failure` code the server derives from the
// discarded write error (never the raw upstream message — see
// lib/services/reviewer-engagement/terminal-transition.js
// classifyWriteFailure). Each sentence names the cause in plain language and
// ends with an action ladder (retry, then contact an administrator), per
// .claude-memory/feedback-user-facing-error-copy-voice.md.
const WRITE_FAILED_MESSAGE = {
  write_interlocked: (name) => `${name} is still invited. The system blocked the release in this environment (Dataverse write interlock). Retry from the production site, or contact an administrator.`,
  dataverse_forbidden: (name) => `${name} is still invited. Dataverse refused to save the release for this account. Retry, and if it fails again contact an administrator.`,
  not_found: (name) => `${name} is still invited. The reviewer record could not be found when saving. Reload and retry.`,
  dataverse_unavailable: (name) => `${name} is still invited. The database did not respond when saving the release. This is usually a temporary blip. Retry, and if it keeps failing contact an administrator.`,
  unknown: (name) => `${name} is still invited. The release could not be saved. Retry, and if it keeps failing contact an administrator.`,
};

function writeFailedMessage(name, failure) {
  const build = WRITE_FAILED_MESSAGE[failure] || WRITE_FAILED_MESSAGE.unknown;
  return build(name);
}

function failureMessage(status, fallback = 'The reviewer could not be released.') {
  return FAILURE_LABELS[status] || fallback;
}

export default function AcceptedReviewerReleaseModal({ reviewer, requestId, onClose, onRelease }) {
  const [draft, setDraft] = useState(null);
  const [subject, setSubject] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [internalNote, setInternalNote] = useState('');
  const [sendEmail, setSendEmail] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    let cancelled = false;
    requestEnvelope('/api/review-manager/terminal-transition', {
      method: 'POST',
      body: {
        requestId,
        suggestionIds: [reviewer.suggestionId],
        terminalStatus: 'released',
        preview: true,
      },
      tolerantBody: true,
    }).then((envelope) => {
      if (cancelled) return;
      if (!envelope.ok) throw new Error(envelope.data.error || `Could not prepare the release (${envelope.status})`);
      const data = envelope.data;
      const next = data.drafts?.[0];
      if (!next || !['ok', 'no_email', 'no_pd', 'defaults_unavailable'].includes(next.status)) {
        throw new Error(failureMessage(
          next?.status,
          `This reviewer cannot be released: ${next?.status || 'no preview returned'}`,
        ));
      }
      setDraft(next);
      setSubject(next.subject || '');
      setBodyText(next.bodyText || '');
      setInternalNote(next.existingNotes || '');
      if (next.status !== 'ok') setSendEmail(false);
    }).catch((loadError) => {
      if (!cancelled) setError(loadError.message);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [requestId, reviewer.suggestionId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const requestClose = () => {
    if (!saving) onClose();
  };

  const submit = async () => {
    if (!draft || saving) return;
    if (sendEmail && (!subject.trim() || !bodyText.trim())) {
      setError('Subject and message cannot be empty.');
      return;
    }
    if (internalNote.trim().length > 2000) {
      setError('Internal note must be 2,000 characters or fewer.');
      return;
    }
    const honorariumText = reviewer.honorariumRequestId
      ? ' The open honorarium request will be retained and marked Withdrawn.'
      : '';
    if (!window.confirm(
      `Release ${reviewer.name || 'this reviewer'} from the assignment? Their review link will be disabled and the outcome will be recorded as Review not received.${honorariumText}`,
    )) return;

    setSaving(true);
    setError(null);
    setFeedback(null);
    const override = {
      expectedNotes: draft.expectedNotes || '',
      ...(sendEmail ? {
        subject,
        bodyText,
        to: draft.to,
        from: draft.from,
        senderId: draft.senderId,
      } : {}),
    };
    try {
      const outcome = await onRelease({
        releaseReason: REASON,
        internalNotes: { [reviewer.suggestionId]: internalNote },
        sendEmail,
        overrides: { [reviewer.suggestionId]: override },
      });
      if (!mountedRef.current) return;
      const name = reviewer.name || 'This reviewer';
      if (!outcome?.ok) {
        if (outcome?.error === 'write_failed') {
          setError(writeFailedMessage(name, outcome?.data?.results?.[0]?.failure));
        } else {
          setError(failureMessage(outcome?.error, outcome?.error || 'The reviewer could not be released.'));
        }
        return;
      }
      const result = outcome.data?.results?.[0] || {};
      if (result.status === 'released_emailed') {
        setFeedback({ outcome: 'sent', detail: 'The reviewer was released, the honorarium was closed if open, and the thank-you email was sent.' });
      } else if (result.status === 'released_no_email_by_choice') {
        setFeedback({ outcome: 'info', title: 'Reviewer released', detail: 'The reviewer was released and no email was sent.' });
      } else if (result.status === 'released_email_unconfirmed') {
        setFeedback({ outcome: 'uncertain', detail: 'The reviewer was released, but the email result could not be confirmed. Check before sending anything manually.' });
      } else if (result.status === 'released_email_failed') {
        setFeedback({ outcome: 'partial', detail: 'The reviewer was released and the honorarium was closed if open, but the thank-you email failed.' });
      } else if (result.status === 'write_failed') {
        setError(writeFailedMessage(name, result.failure));
      } else {
        setError(FAILURE_LABELS[result.status] || `The release did not complete: ${result.status || 'unknown result'}`);
      }
    } catch (saveError) {
      if (mountedRef.current) setError(`The connection ended before the result could be confirmed. Reload the reviewer list before trying again. (${saveError.message})`);
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  };

  const completed = Boolean(feedback);
  const emailUnavailable = draft && draft.status !== 'ok';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50" onClick={requestClose}>
      <div className="mx-4 max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-3">
          <h3 className="font-semibold text-gray-900">Release from assignment</h3>
          <button type="button" onClick={requestClose} disabled={saving} aria-label="Close" className="text-gray-400 hover:text-gray-600 disabled:opacity-40">✕</button>
        </div>
        <div className="space-y-4 p-4">
          <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950">
            <p className="font-medium">Reason: Sufficient reviews received</p>
            <p className="mt-1">Outcome: Review not received. The reviewer’s secure link will be revoked.</p>
            {reviewer.honorariumRequestId && <p className="mt-1">The linked honorarium request will be retained and marked Withdrawn.</p>}
          </div>

          {loading && <p className="text-sm text-gray-500">Preparing release details…</p>}

          {draft && !completed && (
            <>
              <label className="block">
                <span className="text-sm font-medium text-gray-800">Internal note <span className="font-normal text-gray-500">(optional)</span></span>
                <textarea
                  rows={3}
                  maxLength={2000}
                  value={internalNote}
                  onChange={(event) => setInternalNote(event.target.value)}
                  placeholder="For example: Reviewer remained overdue after several reminders."
                  className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
                <span className="mt-1 block text-xs text-gray-500">Saved to the reviewer engagement record; not included in the email.</span>
              </label>

              <label className="flex items-center gap-2 text-sm text-gray-800">
                <input
                  type="checkbox"
                  checked={sendEmail}
                  disabled={emailUnavailable}
                  onChange={(event) => setSendEmail(event.target.checked)}
                  className="h-4 w-4 accent-blue-600"
                />
                Send a thank-you email
              </label>
              {emailUnavailable && <p className="text-sm text-amber-700">Email is unavailable for this release ({draft.status.replaceAll('_', ' ')}). The reviewer can still be released.</p>}

              {sendEmail && (
                <div className="space-y-2 rounded-md border border-gray-200 p-3">
                  <p className="text-sm"><span className="font-medium">To:</span> {draft.name || reviewer.name} &lt;{draft.to}&gt;</p>
                  <label className="block">
                    <span className="text-xs font-medium text-gray-600">Subject</span>
                    <input value={subject} onChange={(event) => setSubject(event.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm" />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-gray-600">Message</span>
                    <textarea rows={10} value={bodyText} onChange={(event) => setBodyText(event.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm font-mono" />
                  </label>
                </div>
              )}
            </>
          )}

          {error && <p className="text-sm text-red-700">{error}</p>}
          {feedback && <EmailSendFeedback status={feedback.outcome} title={feedback.title} message={feedback.detail} />}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={requestClose} disabled={saving} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 disabled:opacity-40">{completed ? 'Done' : 'Cancel'}</button>
            {!completed && <button type="button" onClick={submit} disabled={loading || !draft || saving} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{saving ? 'Releasing…' : 'Release reviewer'}</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
