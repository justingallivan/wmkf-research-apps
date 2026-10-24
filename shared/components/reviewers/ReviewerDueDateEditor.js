import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { currentYmdInTimeZone, isYmd } from '../../../lib/utils/date-ymd';
import DeadlineWordingDefault from './DeadlineWordingDefault';
import EmailSendFeedback from '../EmailSendFeedback';
import { requestEnvelope } from '../../utils/api-request';

function formatDate(value) {
  if (!isYmd(value)) return 'Not set';
  const parsed = new Date(`${value}T00:00:00Z`);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(parsed);
}

function nextYmd(value) {
  if (!isYmd(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function minimumExtensionDate(originalDate, today = currentYmdInTimeZone()) {
  const dayAfterOriginal = nextYmd(originalDate);
  if (!dayAfterOriginal) return today;
  return dayAfterOriginal > today ? dayAfterOriginal : today;
}

// Sentinel for submit's POST: distinguishes "2xx body failed to parse" (the
// extension was most likely saved — the app just couldn't confirm it) from a
// legitimately empty/null 2xx body, without losing envelope.ok/status the way
// a thrown parse error under strict tolerantBody would. See submit below.
const MALFORMED_BODY = Symbol('malformed-body');

function messageForReason(reason, fallback) {
  const messages = {
    assigned_pd_required: 'Only the assigned Program Director can change this deadline or send its notification.',
    sender_changed: 'The assigned Program Director or mailbox changed. Reload before continuing.',
    preview_stale: 'The deadline or email details changed. Review a fresh preview before continuing.',
    invalid_preview: 'Check the subject and placeholders, then preview again. The message may be empty.',
    invalid_cc: 'Enter valid Cc email addresses, separated by commas. Do not repeat From or To; at most 20 addresses are allowed.',
    cc_not_allowed_for_test_request: 'Cc is not available for synthetic test requests. Remove Cc and preview again.',
    recipient_policy_refused: 'The recipients could not be approved. Check the addresses and preview again.',
    preference_invalid: 'Your saved wording could not be loaded. Shared wording is shown below.',
    preference_unavailable: 'Your saved wording could not be loaded. Shared wording is shown below.',
    ineligible: 'This reviewer is no longer eligible for a deadline change. Reload the reviewer list.',
    not_found: 'This reviewer is no longer available. Reload the reviewer list.',
    original_due_date_missing: 'I could not find the original review deadline. Reload the reviewer list, and contact an administrator if the problem continues.',
    invalid_extension_date: 'Choose a date after the original deadline.',
    no_extension_to_restore: 'There is no extension to restore. Reload the reviewer list.',
    no_change: 'Choose a different deadline, or use Resend deadline email.',
    conflict: 'The reviewer changed while this dialog was open. Reload and try again.',
    misconfigured: 'I could not prepare the deadline email. No deadline was changed. Try again, and contact an administrator if the problem continues.',
    notification_unavailable: 'I am missing the reviewer or Program Director information needed for this email. No deadline was changed. Contact an administrator.',
    token_recovery_required: 'That deadline extends beyond the reviewer’s current secure link. No deadline was changed. Issue a replacement link through the explicit recovery action first.',
    read_failed: 'I could not load the reviewer data. No deadline was changed. Try again, and contact an administrator if the problem continues.',
    save_failed: 'I could not save the extension. Reload the reviewer list and try again.',
    send_failed: 'I could not send the deadline email. Try the email again, and contact an administrator if the problem continues.',
    send_unconfirmed: 'Dynamics did not confirm the deadline email. Check reviewer activity before trying again.',
    server_error: 'I could not complete the deadline update. Try again, and contact an administrator if the problem continues.',
  };
  return messages[reason] || fallback;
}

/** Assigned-PD deadline composer. Every operation needs exact fresh review. */
export default function ReviewerDueDateEditor({ suggestionId, reviewerName, overrideDate = null,
  effectiveDate = null, defaultDate = null, canManage = false, assignedPdContext = null,
  requestContextId = null, onSaved }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [operation, setOperation] = useState('save');
  const [template, setTemplate] = useState(null);
  const [cc, setCc] = useState('');
  const [addressing, setAddressing] = useState(null);
  const [preview, setPreview] = useState(null);
  const [working, setWorking] = useState(false);
  const [preferenceBusy, setPreferenceBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  const [uncertain, setUncertain] = useState(false);
  const [saved, setSaved] = useState(false);
  const [sent, setSent] = useState(false);
  const [retryProof, setRetryProof] = useState(null);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  const onSavedRef = useRef(onSaved);
  const context = JSON.stringify([suggestionId, requestContextId, canManage, assignedPdContext, defaultDate, overrideDate, effectiveDate]);
  const contextRef = useRef(context);
  const minimumDate = minimumExtensionDate(defaultDate);
  const busy = working || preferenceBusy;

  const reset = () => {
    setOpen(false); setDraft(''); setTemplate(null); setCc(''); setAddressing(null);
    setPreview(null); setWorking(false); setPreferenceBusy(false); setNotice(null);
    setError(null); setUncertain(false); setSaved(false); setSent(false); setRetryProof(null);
  };
  useLayoutEffect(() => { onSavedRef.current = onSaved; }, [onSaved]);
  useLayoutEffect(() => {
    if (contextRef.current !== context) { generationRef.current += 1; contextRef.current = context; reset(); }
  }, [context]);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; generationRef.current += 1; }; }, []);
  const fresh = (generation) => mountedRef.current && generation === generationRef.current && contextRef.current === context;
  const invalidate = () => { generationRef.current += 1; setPreview(null); setRetryProof(null); setError(null); };
  const bodyFor = (action, target = operation, initial = false) => ({
    action, suggestionId, ...(action === 'preview' ? { operation: target } : {}),
    ...(target === 'save' ? { reviewDueDateOverride: draft } : {}),
    ...(!initial ? { template, cc: cc.split(/[;,]/).map((v) => v.trim()).filter(Boolean) } : { cc: [] }),
  });
  const showPreview = async (initial = false) => {
    if (!canManage || busy) return;
    const generation = ++generationRef.current;
    setWorking(true); setError(null); setPreview(null); setRetryProof(null);
    try {
      const envelope = await requestEnvelope('/api/review-manager/review-due-extension', {
        method: 'POST', body: bodyFor('preview', initial ? 'resend' : operation, initial), tolerantBody: true,
      });
      if (!fresh(generation)) return;
      const data = envelope.data || {};
      if (!envelope.ok || !data.ok || !data.preview) throw new Error(messageForReason(data.reason, 'The email preview could not be loaded. Try again.'));
      const result = data.preview;
      setAddressing({ from: result.from, to: result.to });
      if (initial) { setTemplate(result.template); setNotice(result.templateNotice ? 'Your saved wording couldn’t be loaded. Shared wording is shown below.' : null); }
      else { setPreview(result); setCc(result.cc.join(', ')); }
    } catch (e) { if (fresh(generation)) setError(e.message || 'The preview could not be loaded.'); }
    finally { if (fresh(generation)) setWorking(false); }
  };
  const openModal = () => {
    if (!canManage || !suggestionId || !isYmd(defaultDate)) return;
    setOpen(true); setDraft(overrideDate || minimumDate); setOperation('save');
    showPreview(true);
  };
  const close = () => {
    if (busy) return;
    generationRef.current += 1; reset();
    if (saved || sent) onSavedRef.current?.();
  };
  const send = async (retry = false) => {
    const proof = retry ? retryProof : preview?.proof;
    if (!canManage || busy || !proof || uncertain || sent) return;
    const generation = ++generationRef.current;
    setWorking(true); setError(null);
    try {
      const action = retry ? 'retry' : operation;
      const envelope = await requestEnvelope('/api/review-manager/review-due-extension', {
        method: 'POST', body: { ...bodyFor(action, action), proof }, tolerantBody: () => MALFORMED_BODY,
      });
      if (!fresh(generation)) return;
      const data = envelope.data;
      setPreview(null); setRetryProof(null);
      if (!data || data === MALFORMED_BODY || typeof data.ok !== 'boolean' || data.reason === 'server_error') { setUncertain(true); setError('The result could not be confirmed. Check reviewer activity before trying again.'); return; }
      if (data.saved === true) setSaved(true);
      if (data.ok && data.notified) { setSent(true); onSavedRef.current?.(); return; }
      const unknown = data.reason === 'send_unconfirmed';
      setUncertain(unknown);
      const hasSaved = saved || data.saved === true;
      setError((hasSaved ? 'The deadline is saved. ' : '') + messageForReason(data.reason, 'The email was not sent. Preview again before continuing.'));
      if (hasSaved && !unknown) setOperation('retry');
      if (data.retryable && data.retryProof && !unknown) setRetryProof(data.retryProof);
    } catch {
      if (fresh(generation)) { setUncertain(true); setPreview(null); setRetryProof(null); setError('The result could not be confirmed. Check reviewer activity before trying again.'); }
    } finally { if (fresh(generation)) setWorking(false); }
  };
  const validDraft = operation !== 'save' || (isYmd(draft) && draft >= minimumDate && draft > defaultDate && draft !== overrideDate);
  const inputClass = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-gray-50';
  const locked = busy || uncertain || sent;
  return (
    <div className="text-xs">
      <p className="text-gray-700">{overrideDate ? 'Extended' : 'Due'}: {formatDate(effectiveDate || defaultDate)}</p>
      {overrideDate && <p className="text-gray-500">Original: {formatDate(defaultDate)}</p>}
      {canManage && isYmd(defaultDate) && <button type="button" onClick={openModal} className="mt-1 text-blue-700 hover:underline">{overrideDate ? 'Change extension' : 'Grant extension'}</button>}
      {open && canManage && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div role="dialog" aria-modal="true" aria-labelledby={`deadline-title-${suggestionId}`} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-5 text-left shadow-xl">
          <h2 id={`deadline-title-${suggestionId}`} className="text-lg font-semibold text-gray-900">Reviewer deadline</h2>
          <p className="mt-1 text-sm text-gray-600">{reviewerName} · Original deadline: {formatDate(defaultDate)}</p>
          {saved && <p role="status" className="mt-3 text-sm text-gray-800">The deadline is saved. Email actions below do not change it.</p>}
          {!saved && <label className="mt-4 block text-sm font-medium text-gray-700">Action
            <select className={inputClass} disabled={locked} value={operation} onChange={(e) => { invalidate(); setOperation(e.target.value); }}>
              <option value="save">{overrideDate ? 'Change extension' : 'Grant extension'}</option>
              {overrideDate && <option value="restore">Restore original deadline</option>}
              <option value="resend">Resend deadline email</option>
            </select>
          </label>}
          {operation === 'save' && <label className="mt-3 block text-sm font-medium text-gray-700">New deadline
            <input type="date" className={inputClass} min={minimumDate} value={draft} disabled={locked} onChange={(e) => { invalidate(); setDraft(e.target.value); }} />
          </label>}
          {addressing && <dl className="mt-4 space-y-1 break-words text-sm text-gray-700"><div><dt className="inline font-medium">From: </dt><dd className="inline">{addressing.from}</dd></div><div><dt className="inline font-medium">To: </dt><dd className="inline">{addressing.to}</dd></div></dl>}
          {notice && <p role="status" className="mt-3 text-sm text-amber-800">{notice}</p>}
          {template && <div className="mt-3 space-y-3">
            <label className="block text-sm font-medium text-gray-700">Cc (this send only)
              <input className={inputClass} value={cc} disabled={locked} onChange={(e) => { invalidate(); setCc(e.target.value); }} placeholder="Separate email addresses with commas" />
            </label>
            <label className="block text-sm font-medium text-gray-700">Subject
              <input className={inputClass} maxLength={500} value={template.subject} disabled={locked} onChange={(e) => { invalidate(); setTemplate({ ...template, subject: e.target.value }); }} />
            </label>
            <label className="block text-sm font-medium text-gray-700">Message (optional)
              <textarea className={inputClass} rows={7} maxLength={12000} value={template.body} disabled={locked} onChange={(e) => { invalidate(); setTemplate({ ...template, body: e.target.value }); }} />
            </label>
            <p className="text-xs text-gray-500">Optional placeholders: {'{{greeting}}, {{reviewerName}}, {{proposalTitle}}, {{reviewDueDate}}, {{signature}}'}. The calendar attachment always uses the saved deadline.</p>
            <DeadlineWordingDefault disabled={working || uncertain || sent} onBusyChange={setPreferenceBusy} />
          </div>}
          {working && <p role="status" className="mt-3 text-sm text-gray-600">Preparing the deadline email…</p>}
          {preview && <section className="mt-4 border-t border-gray-200 pt-4" aria-label="Email preview">
            <p className="text-sm font-medium text-gray-900">{preview.subject}</p>
            <p className="mt-1 text-xs text-gray-600">Deadline: {formatDate(preview.effectiveReviewDeadline)} · Calendar update attached</p>
            {preview.cc.length > 0 && <p className="mt-1 break-words text-xs text-gray-600">Cc: {preview.cc.join(', ')}</p>}
            <div className="mt-3 whitespace-pre-wrap break-words text-sm text-gray-800">{preview.bodyText || 'No message body.'}</div>
          </section>}
          {error && <EmailSendFeedback className="mt-4" status={uncertain ? 'uncertain' : 'failed'} message={error} />}
          {sent && <EmailSendFeedback className="mt-4" status="sent" />}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button type="button" onClick={close} disabled={busy} className="rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50">Close</button>
            {!template && !locked && <button type="button" onClick={() => showPreview(true)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">Load email wording</button>}
            {template && !uncertain && !sent && <>
              <button type="button" disabled={busy || !validDraft} onClick={() => showPreview()} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 hover:bg-gray-50 disabled:opacity-50">Preview email</button>
              {retryProof && <button type="button" disabled={busy} onClick={() => send(true)} className="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50">Retry email</button>}
              {preview && <button type="button" disabled={busy} onClick={() => send()} className="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50">{operation === 'save' ? 'Save deadline and send' : operation === 'restore' ? 'Restore deadline and send' : 'Send deadline email'}</button>}
            </>}
          </div>
        </div>
      </div>}
    </div>
  );
}
