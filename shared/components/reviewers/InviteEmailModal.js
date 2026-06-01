/**
 * InviteEmailModal — a lean preview→send modal for INVITING saved candidates to
 * review (Workbench Candidates tab). Deliberately NOT the Review Manager
 * EmailModal (which is coupled to localStorage templates, review-due-date, and
 * materials attachments). This one is invitation-only:
 *   render-emails (templateType:'invitation', mints the accept/decline magic
 *   link via {{externalLink}}) → editable preview → send-emails
 *   (templateType:'invitation' → sets invited+emailSentAt, no status bump;
 *   skips already-invited unless allowResend).
 *
 * Props:
 *   - candidates : [{ suggestionId, name, email }] to invite (already filtered)
 *   - settings   : { signature }
 *   - allowResend: when true, the server re-sends to already-invited candidates
 *   - onClose, onSent
 */

import { useState, useEffect, useCallback } from 'react';
import { readSseStream } from './sse';

const INVITATION_TEMPLATE = {
  subject: 'Invitation to review a grant proposal: {{proposalTitle}}',
  body: `{{greeting}},

The W. M. Keck Foundation invites you to serve as a peer reviewer for the proposal "{{proposalTitle}}" from {{piInstitution}}.

Please use your secure personal link to accept or decline this invitation:
{{externalLink}}

If you accept, the same link gives you access to the proposal materials and the review form. We would be grateful for your expertise.

{{signature}}`,
};

export default function InviteEmailModal({ candidates = [], settings = {}, allowResend = false, onClose, onSent }) {
  const [step, setStep] = useState('preview'); // preview | sending | sent | error (preview shows drafts)
  const [drafts, setDrafts] = useState([]);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState({ current: 0, total: 0, message: 'Rendering previews…' });
  const [results, setResults] = useState({ sent: [], failed: [], skipped: [] });

  const suggestionIds = candidates.map((c) => c.suggestionId).filter(Boolean);

  const renderPreviews = useCallback(async () => {
    setError(null); setDrafts([]);
    setProgress({ current: 0, total: suggestionIds.length, message: 'Rendering previews…' });
    try {
      const res = await fetch('/api/review-manager/render-emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          suggestionIds,
          templateType: 'invitation',
          template: INVITATION_TEMPLATE,
          settings: { signature: settings.signature || '' },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to render previews');
      setDrafts(data.drafts || []);
    } catch (e) {
      setError(e.message);
    }
  }, [suggestionIds, settings.signature]);

  useEffect(() => {
    renderPreviews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateDraft = (suggestionId, field, value) =>
    setDrafts((prev) => prev.map((d) => (d.suggestionId === suggestionId ? { ...d, [field]: value } : d)));

  const sendable = drafts.filter((d) => !d.skipped && d.candidateEmail);

  const handleSend = async () => {
    if (sendable.length === 0) { setError('No recipients with an email to send to.'); return; }
    const ok = window.confirm(
      `Send ${sendable.length} invitation${sendable.length === 1 ? '' : 's'} now via Dynamics? `
      + 'This sends a real email with an accept/decline link and cannot be undone.'
    );
    if (!ok) return;
    setStep('sending');
    setProgress({ current: 0, total: sendable.length, message: 'Sending…' });
    setError(null);
    setResults({ sent: [], failed: [], skipped: [] });
    try {
      const res = await fetch('/api/review-manager/send-emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          drafts: sendable.map((d) => ({ suggestionId: d.suggestionId, subject: d.subject, body: d.body })),
          templateType: 'invitation',
          attachmentUrls: [],
          markAsSent: true,
          allowResend,
        }),
      });
      let final = null;
      await readSseStream(res, ({ event, data }) => {
        if (event === 'error') { setError(data?.message || 'Send failed'); return; }
        if (event === 'progress') setProgress((p) => ({ ...p, ...data }));
        else if (event === 'email_sent') setResults((r) => ({ ...r, sent: [...r.sent, data] }));
        else if (event === 'email_failed') setResults((r) => ({ ...r, failed: [...r.failed, data] }));
        else if (event === 'result') final = data;
      });
      if (final) setResults({ sent: final.sent || [], failed: final.failed || [], skipped: final.skipped || [] });
      setStep('sent');
      if (onSent) onSent();
    } catch (e) {
      setError(e.message);
      setStep('error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <p className="font-medium text-gray-900">
            {allowResend ? 'Re-invite reviewers' : 'Invite reviewers'} ({candidates.length})
          </p>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && <div className="p-3 bg-amber-50 text-amber-700 rounded-lg text-sm mb-3">{error}</div>}

          {step === 'preview' && (
            drafts.length === 0 && !error ? (
              <p className="text-sm text-gray-500">{progress.message}</p>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-gray-500">
                  Review each invitation below; the secure accept/decline link is embedded. Edit if needed, then send.
                </p>
                {drafts.map((d) => (
                  <div key={d.suggestionId} className={`border rounded-lg p-3 ${d.skipped ? 'border-amber-200 bg-amber-50' : 'border-gray-200'}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-900">{d.candidateName || '(unnamed)'}</span>
                      <span className="text-xs text-gray-500">{d.candidateEmail || 'no email'}</span>
                    </div>
                    {d.skipped ? (
                      <p className="text-xs text-amber-700 mt-1">Skipped ({d.skipped === 'no_email' ? 'no email address' : d.skipped}).</p>
                    ) : (
                      <div className="mt-2 space-y-2">
                        <input
                          className="w-full text-sm border border-gray-300 rounded px-2 py-1"
                          value={d.subject}
                          onChange={(e) => updateDraft(d.suggestionId, 'subject', e.target.value)}
                        />
                        <textarea
                          className="w-full text-xs border border-gray-300 rounded px-2 py-1 font-mono"
                          rows={7}
                          value={d.body}
                          onChange={(e) => updateDraft(d.suggestionId, 'body', e.target.value)}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )
          )}

          {step === 'sending' && (
            <div className="space-y-2">
              <p className="text-sm text-gray-600">Sending {progress.current || 0}/{progress.total || sendable.length}… {progress.message}</p>
            </div>
          )}

          {(step === 'sent' || step === 'error') && (
            <div className="space-y-2 text-sm">
              <p className="text-green-700">Sent {results.sent.length} invitation(s).</p>
              {results.skipped.length > 0 && (
                <p className="text-amber-700">
                  Skipped {results.skipped.length}: {results.skipped.map((s) => `${s.candidateName || '?'} (${s.reason})`).join(', ')}
                </p>
              )}
              {results.failed.length > 0 && (
                <p className="text-red-700">Failed {results.failed.length}: {results.failed.map((f) => `${f.candidateName || '?'} (${f.error})`).join(', ')}</p>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-gray-200">
          {step === 'preview' && (
            <>
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
              <button
                type="button"
                onClick={handleSend}
                disabled={sendable.length === 0}
                className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Send {sendable.length > 0 ? sendable.length : ''} invitation{sendable.length === 1 ? '' : 's'}
              </button>
            </>
          )}
          {(step === 'sent' || step === 'error') && (
            <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800">Done</button>
          )}
        </div>
      </div>
    </div>
  );
}
