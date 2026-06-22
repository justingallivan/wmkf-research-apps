/**
 * InviteEmailModal — a lean preview→send modal for INVITING saved candidates to
 * review (Workbench Candidates tab). Deliberately NOT the Review Manager
 * EmailModal (which is coupled to localStorage templates and materials
 * attachments). This one is invitation-only:
 *   render-emails (templateType:'invitation', mints the accept/decline magic
 *   link via {{externalLink}}) → editable preview → send-emails
 *   (templateType:'invitation' → sets invited+emailSentAt, no status bump;
 *   skips already-invited unless allowResend).
 *
 * Review-process timeline (this last two-phase cycle): the PD enters three dates
 * — respond-by, proposal-delivery, review-due — that appear in the invitation
 * body. They are interpolated CLIENT-SIDE here (not via render-emails) so a blank
 * date drops its line instead of leaking a literal {{token}} into a real email,
 * and so editing a draft doesn't require re-fetching the preview. The dates are
 * persisted as sticky per-user defaults (PREFERENCE_KEYS.INVITE_TIMING) and
 * pre-fill next time.
 *
 * Props:
 *   - requestId   : current akoya_request GUID; used to load request campaign settings
 *   - candidates : [{ suggestionId, name, email }] to invite (already filtered)
 *   - settings   : { signature }
 *   - allowResend: when true, the server re-sends to already-invited candidates
 *   - onClose, onSent
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { readSseStream } from './sse';
import { PREFERENCE_KEYS } from '../../config/reviewerFinderPreferences';
import { loadEmailTemplates, DEFAULT_TEMPLATES } from './email-template-store';

// Parse a YYYY-MM-DD as LOCAL time (not UTC) and format as "January 15, 2026".
function formatDate(ymd) {
  if (!ymd) return '';
  const [y, m, d] = String(ymd).split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// Reviewer-engagement Phase 1: respond-by is now a "days to respond" OFFSET, not a
// fixed date (a fixed day-0 date shortchanges later invite waves). The email still
// shows a concrete respond-by DATE — computed here as today + offset, which closely
// tracks the per-reviewer deadline the Phase-3 cron derives server-side from each
// suggestion's real emailSentAt + respondOffsetDays. Returns YYYY-MM-DD (local).
function addDaysToTodayYmd(days) {
  const n = Number(days);
  if (days === '' || days == null || !Number.isFinite(n) || n < 0) return '';
  const dt = new Date();
  dt.setDate(dt.getDate() + Math.round(n));
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Resolve each client-side timing token to its display string. respond-by comes
// from the offset (today + N days); the other two are fixed dates. These are NOT
// server placeholders — render-emails leaves them literal and we substitute here.
function timingTokenValues(timing) {
  return {
    '{{respondBy}}': formatDate(addDaysToTodayYmd(timing.respondOffsetDays)),
    '{{proposalDelivery}}': formatDate(timing.proposalSendDate),
    '{{reviewDue}}': formatDate(timing.reviewDueDate),
  };
}

// Substitute the timing tokens with formatted dates. A line whose token has no
// value is dropped entirely (so the bullet doesn't appear with a blank/leftover
// token). The "Review timeline:" header is dropped when nothing is set at all.
function applyTiming(body, timing) {
  const values = timingTokenValues(timing);
  const anySet = Object.values(values).some(Boolean);
  const lines = body.split('\n');
  const out = [];
  for (const line of lines) {
    if (!anySet && /^\s*Review timeline:\s*$/.test(line)) continue;
    let drop = false;
    let next = line;
    for (const [token, value] of Object.entries(values)) {
      if (line.includes(token)) {
        if (!value) { drop = true; break; }
        next = next.split(token).join(value);
      }
    }
    if (!drop) out.push(next);
  }
  return out.join('\n');
}

export default function InviteEmailModal({ requestId = null, candidates = [], settings = {}, allowResend = false, onClose, onSent }) {
  const [step, setStep] = useState('preview'); // preview | sending | sent | error
  const [rawDrafts, setRawDrafts] = useState([]); // from render-emails, timing tokens still literal
  const [edits, setEdits] = useState({}); // suggestionId -> { subject?, body? } user overrides
  const [timing, setTiming] = useState({ respondOffsetDays: 7, proposalSendDate: '', reviewDueDate: '' });
  const [template, setTemplate] = useState(DEFAULT_TEMPLATES.invitation); // user's invitation template
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState({ current: 0, total: 0, message: 'Rendering previews…' });
  const [results, setResults] = useState({ sent: [], failed: [], skipped: [] });

  // Stable across renders (candidates is a fresh array each parent render, so a
  // raw .map() would give renderPreviews a new identity every render and the
  // render-previews effect below would re-fetch in a loop). Key on the id list.
  const idsKey = candidates.map((c) => c.suggestionId).filter(Boolean).join(',');
  const suggestionIds = useMemo(() => (idsKey ? idsKey.split(',') : []), [idsKey]);

  // On open: load the user's invitation template + sticky timing defaults, then
  // overlay request-level campaign config for the fields that are shared with
  // Campaign settings. This keeps stale per-user defaults from showing a
  // different review due date than the request's campaign config.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const nextTiming = {};
      try {
        const res = await fetch(`/api/user-preferences?key=${encodeURIComponent(PREFERENCE_KEYS.INVITE_TIMING)}`);
        const data = await res.json().catch(() => ({}));
        if (data?.value) {
          const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
          // Pick only the known keys (a pre-Phase-1 sticky value carries the retired
          // `respondByDate` date — ignore it; respondOffsetDays falls back to default 7).
          if (parsed.respondOffsetDays != null && parsed.respondOffsetDays !== '') nextTiming.respondOffsetDays = parsed.respondOffsetDays;
          if (typeof parsed.proposalSendDate === 'string') nextTiming.proposalSendDate = parsed.proposalSendDate;
          if (typeof parsed.reviewDueDate === 'string') nextTiming.reviewDueDate = parsed.reviewDueDate;
        }
      } catch { /* sticky defaults are best-effort */ }
      if (requestId) {
        try {
          const res = await fetch(`/api/review-manager/campaign-config?requestId=${encodeURIComponent(requestId)}`);
          const data = await res.json().catch(() => ({}));
          if (res.ok && data?.config) {
            const c = data.config;
            if (c.respondOffsetDays != null) nextTiming.respondOffsetDays = c.respondOffsetDays;
            if (c.reviewDueDate) nextTiming.reviewDueDate = c.reviewDueDate;
          }
        } catch { /* request campaign config is best-effort for preview hydration */ }
      }
      if (!cancelled && Object.keys(nextTiming).length > 0) {
        setTiming((t) => ({ ...t, ...nextTiming }));
      }
      try {
        const tpl = await loadEmailTemplates();
        if (!cancelled && tpl?.invitation) setTemplate(tpl.invitation);
      } catch { /* falls back to the default invitation template */ }
    })();
    return () => { cancelled = true; };
  }, [requestId]);

  // Generation guard: the effect below re-runs renderPreviews when `template`
  // lands from loadEmailTemplates, so two fetches can be in flight at once. Only
  // the latest invocation may apply its result — a slower older response must not
  // overwrite a newer one's drafts.
  const renderGenRef = useRef(0);
  const renderPreviews = useCallback(async () => {
    const gen = ++renderGenRef.current;
    setError(null); setRawDrafts([]);
    setProgress({ current: 0, total: suggestionIds.length, message: 'Rendering previews…' });
    try {
      const res = await fetch('/api/review-manager/render-emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          suggestionIds,
          templateType: 'invitation',
          template,
          settings: { signature: settings.signature || '' },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (gen !== renderGenRef.current) return; // superseded by a newer render
      if (!res.ok) throw new Error(data.error || 'Failed to render previews');
      setRawDrafts(data.drafts || []);
    } catch (e) {
      if (gen !== renderGenRef.current) return;
      setError(e.message);
    }
  }, [suggestionIds, settings.signature, template]);

  // Render previews on open and again if the loaded template differs from the
  // default (renderPreviews identity changes when `template` updates).
  useEffect(() => {
    renderPreviews();
    // On unmount (or before a re-render) invalidate any in-flight render so its
    // post-await setRawDrafts/setError can't fire on an unmounted component — reuses
    // the existing generation guard (a bumped ref makes `gen !== current` true).
    return () => { renderGenRef.current++; };
  }, [renderPreviews]);

  // Displayed draft = server-rendered draft with timing applied, unless the user
  // has manually edited that field (edits win; changing dates won't clobber them).
  const draftView = (d) => ({
    ...d,
    subject: edits[d.suggestionId]?.subject ?? d.subject,
    body: edits[d.suggestionId]?.body ?? (d.skipped ? d.body : applyTiming(d.body, timing)),
  });
  const drafts = rawDrafts.map(draftView);

  const updateEdit = (suggestionId, field, value) =>
    setEdits((prev) => ({ ...prev, [suggestionId]: { ...prev[suggestionId], [field]: value } }));

  const sendable = drafts.filter((d) => !d.skipped && d.candidateEmail);
  const capturedSent = results.sent.filter((r) => r.capturedEmail);
  // Slice G — recipients whose email isn't anchored to the resolved identity (manual entry,
  // affiliation-derived, unknown source, or a search email on an unconfirmed identity). They
  // are still sendable, but staff must consciously confirm before inviting (guards the S234
  // wrong-address mistake). The server (send-emails) independently re-derives + enforces this.
  const lowConfidenceSendable = sendable.filter((d) => d.emailConfidence?.level === 'low');

  const persistTiming = useCallback(async () => {
    try {
      await fetch('/api/user-preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: PREFERENCE_KEYS.INVITE_TIMING, value: JSON.stringify(timing) }),
      });
    } catch { /* sticky save is best-effort */ }
  }, [timing]);

  const handleSend = async () => {
    if (sendable.length === 0) { setError('No recipients with an email to send to.'); return; }
    // Slice G — when any recipient is LOW-confidence, the confirm dialog names them so the
    // staff acknowledgement is conscious (the one-click "confirm & send"). Proceeding sets
    // confirmedLowConfidence, which the server requires before it will send to a LOW address.
    const baseMsg = `Send ${sendable.length} invitation${sendable.length === 1 ? '' : 's'} now via Dynamics? `
      + 'This sends a real email with an accept/decline link and cannot be undone.';
    const lowMsg = lowConfidenceSendable.length > 0
      ? `\n\n⚠ ${lowConfidenceSendable.length} address${lowConfidenceSendable.length === 1 ? '' : 'es'} could NOT be verified against the reviewer’s identity:\n`
        + lowConfidenceSendable.map((d) => `  • ${d.candidateName || '(unnamed)'} <${d.candidateEmail}>`).join('\n')
        + '\n\nConfirm you’ve checked these addresses before inviting.'
      : '';
    const ok = window.confirm(baseMsg + lowMsg);
    if (!ok) return;
    setStep('sending');
    setProgress({ current: 0, total: sendable.length, message: 'Sending…' });
    setError(null);
    setResults({ sent: [], failed: [], skipped: [] });
    persistTiming(); // remember the dates for next time (best-effort, non-blocking)
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
          // Reviewer-engagement Phase 1: persist the per-request campaign config on the
          // FIRST invite-batch send. Discrete values the Phase-3 cron / Phase-4 sweep
          // need; the server writes them to the request only if it has none yet (never
          // clobbers a later edit). reviewDueDate is YYYY-MM-DD or null.
          campaignConfig: {
            respondOffsetDays: timing.respondOffsetDays === '' ? null : Number(timing.respondOffsetDays),
            reviewDueDate: timing.reviewDueDate || null,
          },
          // Staff acknowledged THESE specific low-confidence addresses via the confirm dialog
          // above (which named them). Recipient-specific, not a batch boolean: the server only
          // honors the override for these exact suggestionIds, so a row that became LOW after
          // preview (and was never shown/confirmed) is still refused (`email_unconfirmed`).
          confirmedLowConfidenceIds: lowConfidenceSendable.map((d) => d.suggestionId),
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
            <>
              <div className="mb-4 border border-gray-200 rounded-lg p-3 bg-gray-50">
                <p className="text-xs font-medium text-gray-700 mb-2">Reviewer campaign timeline</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <label className="text-xs text-gray-600">
                    Days to respond
                    <input type="number" min="0" step="1" value={timing.respondOffsetDays}
                      onChange={(e) => setTiming((t) => ({ ...t, respondOffsetDays: e.target.value === '' ? '' : Math.max(0, Math.floor(Number(e.target.value))) }))}
                      className="mt-1 w-full text-sm border border-gray-300 rounded px-2 py-1" />
                  </label>
                  <label className="text-xs text-gray-600">
                    Proposal delivered on (email only)
                    <input type="date" value={timing.proposalSendDate}
                      onChange={(e) => setTiming((t) => ({ ...t, proposalSendDate: e.target.value }))}
                      className="mt-1 w-full text-sm border border-gray-300 rounded px-2 py-1" />
                  </label>
                  <label className="text-xs text-gray-600">
                    Review due date
                    <input type="date" value={timing.reviewDueDate}
                      onChange={(e) => setTiming((t) => ({ ...t, reviewDueDate: e.target.value }))}
                      className="mt-1 w-full text-sm border border-gray-300 rounded px-2 py-1" />
                  </label>
                </div>
                <p className="text-[11px] text-gray-400 mt-2">
                  Days to respond and review due date are the same request-level campaign settings shown in Campaign settings. Proposal delivered on is email-only copy for this invitation. A blank field omits its line.
                </p>
              </div>

              {rawDrafts.length === 0 && !error ? (
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
                      {!d.skipped && d.emailConfidence?.level === 'low' && (
                        <p className="text-xs text-amber-700 mt-1 flex items-start gap-1">
                          <span aria-hidden="true">⚠</span>
                          <span>
                            This address wasn’t verified against the reviewer’s identity
                            {d.emailConfidence?.reason ? ` (${d.emailConfidence.reason})` : ''}. Double-check it before sending.
                          </span>
                        </p>
                      )}
                      {d.skipped ? (
                        <p className="text-xs text-amber-700 mt-1">Skipped ({d.skipped === 'no_email' ? 'no email address' : d.skipped}).</p>
                      ) : (
                        <div className="mt-2 space-y-2">
                          <input
                            className="w-full text-sm border border-gray-300 rounded px-2 py-1"
                            value={d.subject}
                            onChange={(e) => updateEdit(d.suggestionId, 'subject', e.target.value)}
                          />
                          <textarea
                            className="w-full text-xs border border-gray-300 rounded px-2 py-1 font-mono"
                            rows={9}
                            value={d.body}
                            onChange={(e) => updateEdit(d.suggestionId, 'body', e.target.value)}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {step === 'sending' && (
            <div className="space-y-2">
              <p className="text-sm text-gray-600">Sending {progress.current || 0}/{progress.total || sendable.length}… {progress.message}</p>
            </div>
          )}

          {(step === 'sent' || step === 'error') && (
            <div className="space-y-2 text-sm">
              {capturedSent.length > 0 ? (
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-blue-900">
                  <p className="font-medium">Captured {capturedSent.length} invitation email{capturedSent.length === 1 ? '' : 's'} for rehearsal.</p>
                  <p className="mt-1 text-xs text-blue-800">
                    No Dynamics email was sent. Review the generated artifact below, then use its Start Review link for the reviewer-side test.
                  </p>
                </div>
              ) : (
                <p className="text-green-700">Sent {results.sent.length} invitation(s).</p>
              )}
              {capturedSent.length > 0 && (
                <div className="space-y-2">
                  {capturedSent.map((r) => (
                    <details key={r.suggestionId || r.emailId} className="rounded-lg border border-gray-200 bg-white p-3">
                      <summary className="cursor-pointer text-sm font-medium text-gray-900">
                        {r.candidateName || r.capturedEmail.candidateName || 'Captured invitation'} &lt;{r.capturedEmail.to || 'unknown recipient'}&gt;
                      </summary>
                      <div className="mt-2 space-y-2">
                        <p className="text-xs text-gray-600">
                          <span className="font-medium">Subject:</span> {r.capturedEmail.subject || r.subject || '(no subject)'}
                        </p>
                        <textarea
                          readOnly
                          rows={8}
                          className="w-full rounded border border-gray-300 bg-gray-50 px-2 py-1 font-mono text-xs text-gray-700"
                          value={r.capturedEmail.htmlBody || ''}
                        />
                      </div>
                    </details>
                  ))}
                </div>
              )}
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
                className={`px-4 py-2 text-white text-sm font-medium rounded-lg disabled:opacity-40 disabled:cursor-not-allowed ${
                  lowConfidenceSendable.length > 0 ? 'bg-amber-600 hover:bg-amber-700' : 'bg-gray-900 hover:bg-gray-800'
                }`}
                title={lowConfidenceSendable.length > 0
                  ? `${lowConfidenceSendable.length} address(es) couldn’t be verified — you’ll confirm before sending`
                  : undefined}
              >
                {lowConfidenceSendable.length > 0
                  ? `Confirm & send ${sendable.length} invitation${sendable.length === 1 ? '' : 's'}`
                  : `Send ${sendable.length > 0 ? sendable.length : ''} invitation${sendable.length === 1 ? '' : 's'}`}
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
