/** Editable, proof-bound composer for respond-by and review-due reminders. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import EmailSendFeedback from '../EmailSendFeedback';
import { requestEnvelope } from '../../utils/api-request';

const ERROR_MESSAGE = {
  removed: 'This reviewer was removed from the proposal — restore them first.',
  revoked: 'This reviewer’s access was withdrawn — reissue their link before nudging.',
  ineligible: 'This reviewer is no longer eligible for a reminder.',
  conflict: 'Another send changed this reminder. Refresh before trying again.',
  not_found: 'This reviewer is no longer available — refresh the list.',
  read_failed: 'The latest reviewer status could not be verified. No reminder was sent.',
  prepare_failed: 'The reminder could not be prepared. No reminder was sent.',
  send_failed: 'The reminder was prepared, but the email could not be sent.',
  send_unconfirmed: 'Dynamics did not confirm the send. Check reviewer activity before trying again.',
  invalid_preview: 'The template is incomplete or contains unsupported wording.',
  preview_stale: 'The reviewed email or reviewer details changed. Refresh the preview before sending.',
  preference_unavailable: 'The sender’s saved default could not be read. Edit the shared Admin copy and refresh the preview to send this reminder.',
  preference_invalid: 'The sender’s saved default needs correction. Edit the shared Admin copy and refresh the preview to send this reminder.',
  identity_unavailable: 'Your account identity could not be verified. Try again later.',
  misconfigured: 'The reminder email template is missing or invalid in Admin.',
  token_revoked: 'This reviewer’s access was withdrawn.',
  token_not_minted: 'No review link is recorded. Check Materials history first.',
  token_invalid_data: 'The review-link metadata needs technical review.',
  token_expired: 'The review link expired. Send an explicit replacement link first.',
  token_insufficient_window: 'The review link does not cover the deadline.',
  due_date_missing: 'Set a review due date before sending a reminder.',
};
const MALFORMED_BODY = Symbol('malformed-body');
function templateErrorDetail(code) {
  if (typeof code !== 'string') return null;
  if (code === 'subject') return 'Enter a subject of at most 500 characters on one line.';
  if (code === 'body') return 'Enter a message of at most 12,000 characters.';
  if (code === 'template') return 'Enter both a subject and a message.';
  if (code === 'malformed:subject' || code === 'malformed:body') return 'Check the placeholder braces in the template.';
  if (code?.startsWith('unknown:subject:')) return 'Placeholders are allowed in the message only.';
  if (code?.startsWith('unknown:body:')) return `The placeholder {{${code.slice('unknown:body:'.length)}}} is not supported.`;
  if (code === 'required:reviewDueDate') return 'Include {{reviewDueDate}} in the review due message.';
  if (code === 'reviewer_link') return 'The review link is managed by the server; remove it from the template.';
  if (code === 'link') return 'Remove web addresses from the template.';
  return null;
}
const errorMessage = (data, fallback) => {
  const general = ERROR_MESSAGE[data?.reason] || fallback;
  if (data?.reason === 'invalid_preview' || data?.reason === 'validation') {
    const detail = (Array.isArray(data?.errors) ? data.errors : []).map(templateErrorDetail).find(Boolean);
    return detail ? `${general} ${detail}` : general;
  }
  return ERROR_MESSAGE[data?.reason] || data?.errors?.[0] || fallback;
};

export default function RespondReminderModal({ requestId, candidate, kind = 'respond', onClose, onSent, onStale }) {
  const [draft, setDraft] = useState(null);
  const [template, setTemplate] = useState({ subject: '', body: '' });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState(null);
  const [sendFeedback, setSendFeedback] = useState(null);
  const [ownSystemId, setOwnSystemId] = useState(null);
  const [configured, setConfigured] = useState(false);
  const [repairableOwnDefault, setRepairableOwnDefault] = useState(false);
  const mountedRef = useRef(true);
  const draftRef = useRef(null);
  const loadGenerationRef = useRef(0);
  const preferenceGenerationRef = useRef(0);
  const templateEditGenerationRef = useRef(0);
  const sendGenerationRef = useRef(0);
  const sendingRef = useRef(false);
  const onSentRef = useRef(onSent);
  const onStaleRef = useRef(onStale);
  useLayoutEffect(() => {
    onSentRef.current = onSent;
    onStaleRef.current = onStale;
  });

  const loadPreview = useCallback(async (editedTemplate) => {
    const generation = ++loadGenerationRef.current;
    setLoading(true);
    setDraft(null);
    draftRef.current = null;
    setLoadError(null);
    try {
      const envelope = await requestEnvelope('/api/review-manager/send-review-reminder', {
        method: 'POST',
        body: { requestId, suggestionId: candidate.suggestionId, kind, action: 'preview', ...(editedTemplate ? { template: editedTemplate } : {}) },
        tolerantBody: true,
      });
      const data = envelope.data;
      if (!mountedRef.current || generation !== loadGenerationRef.current) return;
      if (!envelope.ok || !data?.ok || !data.draft) {
        setLoadError(errorMessage(data, 'Could not load the reminder preview.'));
        if (editedTemplate === undefined && data?.shared) setTemplate(data.shared);
        if (['removed', 'revoked', 'not_found'].includes(data?.reason)) onStaleRef.current?.();
        return;
      }
      draftRef.current = data.draft;
      setDraft(data.draft);
      setTemplate(data.draft.template);
    } catch (error) {
      if (mountedRef.current && generation === loadGenerationRef.current) setLoadError(`Network error loading preview: ${error.message}`);
    } finally {
      if (mountedRef.current && generation === loadGenerationRef.current) setLoading(false);
    }
  }, [candidate.suggestionId, kind, requestId]);

  useEffect(() => {
    mountedRef.current = true;
    // Reset owner controls before a changed request/reviewer context can render them.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOwnSystemId(null);
    setConfigured(false);
    setRepairableOwnDefault(false);
    setSendFeedback(null);
    loadPreview();
    const generation = ++preferenceGenerationRef.current;
    const editGeneration = templateEditGenerationRef.current;
    requestEnvelope(`/api/review-manager/reminder-email-preferences?kind=${kind}`, { tolerantBody: true })
      .then((envelope) => {
        if (!mountedRef.current || generation !== preferenceGenerationRef.current) return;
        if (envelope.ok && envelope.data?.ok) {
          setOwnSystemId(envelope.data.ownSystemId);
          setConfigured(envelope.data.configured === true);
        } else if (envelope.data?.reason === 'preference_invalid' && envelope.data?.ownSystemId && envelope.data?.shared) {
          setOwnSystemId(envelope.data.ownSystemId);
          setConfigured(true);
          setRepairableOwnDefault(true);
          if (!draftRef.current && templateEditGenerationRef.current === editGeneration) setTemplate(envelope.data.shared);
          setSaveMessage('Your saved default needs correction. Clear it or replace it below, then refresh the preview.');
        }
      })
      .catch(() => {});
    return () => {
      mountedRef.current = false;
      loadGenerationRef.current += 1;
      preferenceGenerationRef.current += 1;
      sendGenerationRef.current += 1;
      sendingRef.current = false;
    };
  }, [kind, loadPreview]);

  const blankEdit = !template.subject.trim() || !template.body.trim();
  const previewCurrent = Boolean(draft && draft.template.subject === template.subject && draft.template.body === template.body);
  const canSaveOwn = Boolean(ownSystemId && (draft || repairableOwnDefault));
  const sendingForAnotherUser = Boolean(draft && canSaveOwn && ownSystemId.toLowerCase() !== draft.senderId?.toLowerCase());
  const editField = (field, value) => {
    templateEditGenerationRef.current += 1;
    setTemplate((current) => ({ ...current, [field]: value }));
    setSaveMessage(null);
  };
  const requestClose = () => { if (!sendingRef.current) onClose(); };

  const saveDefault = async () => {
    if (!canSaveOwn || blankEdit || saving || sendingRef.current) return;
    const generation = preferenceGenerationRef.current;
    setSaving(true);
    setSaveMessage(null);
    try {
      const envelope = await requestEnvelope('/api/review-manager/reminder-email-preferences', {
        method: 'PUT', body: { kind, template }, tolerantBody: true,
      });
      if (mountedRef.current && generation === preferenceGenerationRef.current) {
        setSaveMessage(envelope.ok && envelope.data?.ok ? 'Saved for future reminders from your mailbox.' : errorMessage(envelope.data, 'Could not save your default.'));
        if (envelope.ok && envelope.data?.ok) {
          setConfigured(true);
          setRepairableOwnDefault(false);
          if (!draft) loadPreview();
        }
      }
    } catch {
      if (mountedRef.current && generation === preferenceGenerationRef.current) setSaveMessage('Could not confirm the save. Reload your default before trying again.');
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  };

  const resetDefault = async () => {
    if (!canSaveOwn || !configured || saving || sendingRef.current) return;
    const generation = preferenceGenerationRef.current;
    setSaving(true);
    setSaveMessage(null);
    try {
      const envelope = await requestEnvelope('/api/review-manager/reminder-email-preferences', {
        method: 'DELETE', body: { kind }, tolerantBody: true,
      });
      if (mountedRef.current && generation === preferenceGenerationRef.current) {
        if (envelope.ok && envelope.data?.ok) {
          setConfigured(false);
          setRepairableOwnDefault(false);
          setSaveMessage(draft ? 'Your saved default was cleared. This one-send draft is unchanged.' : 'Your saved default was cleared. Loading the shared Admin copy.');
          if (!draft) loadPreview();
        } else {
          setSaveMessage(errorMessage(envelope.data, 'Could not clear your default.'));
        }
      }
    } catch {
      if (mountedRef.current && generation === preferenceGenerationRef.current) setSaveMessage('Could not confirm the reset. Reload your default before trying again.');
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  };

  const handleSend = async () => {
    if (!draft || !previewCurrent || sendingRef.current || sendFeedback?.status === 'uncertain') return;
    const generation = ++sendGenerationRef.current;
    sendingRef.current = true;
    setSending(true);
    setSendFeedback(null);
    try {
      const envelope = await requestEnvelope('/api/review-manager/send-review-reminder', {
        method: 'POST',
        body: { requestId, suggestionId: candidate.suggestionId, kind, action: 'send', template, proof: draft.proof },
        tolerantBody: () => MALFORMED_BODY,
      });
      const data = envelope.data;
      if (!mountedRef.current || generation !== sendGenerationRef.current) return;
      if (envelope.ok && data === MALFORMED_BODY) {
        setSendFeedback({ status: 'uncertain', message: 'The app could not confirm the result. Check reviewer activity before trying again.' });
      } else if (!envelope.ok || !data?.ok) {
        setSendFeedback({ status: data?.reason === 'send_unconfirmed' ? 'uncertain' : 'failed', message: errorMessage(data, 'Could not send the reminder.') });
        if (['removed', 'revoked', 'not_found', 'preview_stale'].includes(data?.reason)) onStaleRef.current?.();
      } else {
        setSendFeedback({ status: 'sent' });
        if (onSentRef.current) {
          try {
            const result = onSentRef.current();
            if (result && typeof result.then === 'function') result.catch(() => {});
          } catch { /* Confirmed send; parent refresh failed. */ }
        }
      }
    } catch {
      if (mountedRef.current && generation === sendGenerationRef.current) {
        setSendFeedback({ status: 'uncertain', message: 'The app could not confirm the result. Check reviewer activity before trying again.' });
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
          <button type="button" onClick={requestClose} disabled={sending} className="text-gray-400 hover:text-gray-600 disabled:opacity-40" aria-label="Close">✕</button>
        </div>
        <div className="p-4 space-y-4">
          <p className="text-sm text-gray-700">Edit the wording for {candidate.name || 'this reviewer'}, then refresh the preview before sending. Saving your default is a separate action.</p>
          {sendingForAnotherUser && <p className="text-xs text-amber-800">This email is from another Program Director’s mailbox. Saving a default changes only your own settings and will not change that Program Director’s default.</p>}
          {loading && <p className="text-sm text-gray-500">Rendering reminder…</p>}
          {loadError && <p className="text-sm text-red-600">{loadError}</p>}
          {draft && <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm space-y-1">
            <p><span className="font-medium text-gray-700">From:</span> {draft.from}</p>
            <p><span className="font-medium text-gray-700">To:</span> {draft.name || candidate.name || 'Reviewer'} &lt;{draft.to}&gt;</p>
          </div>}
          <label className="block"><span className="text-xs font-medium text-gray-600">Subject template</span>
            <input type="text" value={template.subject} onChange={(event) => editField('subject', event.target.value)} disabled={loading || sending || sendFeedback?.status === 'sent'} className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm disabled:bg-gray-100" />
          </label>
          <label className="block"><span className="text-xs font-medium text-gray-600">Message template</span>
            <textarea rows={10} value={template.body} onChange={(event) => editField('body', event.target.value)} disabled={loading || sending || sendFeedback?.status === 'sent'} className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm font-mono disabled:bg-gray-100" />
          </label>
          <p className="text-xs text-gray-500">Available: {'{{greeting}}'}, {'{{reviewerName}}'}, {'{{proposalClause}}'}, {'{{signature}}'}{kind === 'reviewdue' ? <>, {'{{reviewDueDate}}'} (required)</> : null}.</p>
          {draft && previewCurrent && <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm">
            <p className="font-semibold">Email preview</p>
            <p className="mt-2"><strong>Subject:</strong> {draft.subject}</p>
            {draft.previewHtml
              ? <div className="mt-2" dangerouslySetInnerHTML={{ __html: draft.previewHtml }} />
              : <p className="mt-2 whitespace-pre-wrap">{draft.bodyText}</p>}
            <p className="mt-2 text-xs text-gray-600">{kind === 'respond' ? 'A fresh secure Accept or decline button and link are added by the server.' : 'No new review link is included.'}</p>
          </div>}
          {!previewCurrent && !loading && <p className="text-sm text-amber-700">Refresh the preview to review these edits.</p>}
          {saveMessage && <p className="text-sm text-gray-700">{saveMessage}</p>}
          {sendFeedback && <EmailSendFeedback status={sendFeedback.status} message={sendFeedback.message} />}
          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <button type="button" onClick={requestClose} disabled={sending} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 disabled:opacity-40">{sendFeedback?.status === 'sent' ? 'Done' : 'Cancel'}</button>
            {canSaveOwn && sendFeedback?.status !== 'sent' && <button type="button" onClick={saveDefault} disabled={loading || saving || sending || blankEdit} className="px-3 py-1.5 text-sm border rounded-md disabled:opacity-50">{saving ? 'Saving…' : 'Save as my default'}</button>}
            {canSaveOwn && configured && sendFeedback?.status !== 'sent' && <button type="button" onClick={resetDefault} disabled={loading || saving || sending} className="px-3 py-1.5 text-sm border rounded-md disabled:opacity-50">Clear my saved default</button>}
            {sendFeedback?.status !== 'sent' && <button type="button" onClick={() => loadPreview(blankEdit && loadError ? undefined : template)} disabled={loading || sending || (blankEdit && !loadError)} className="px-3 py-1.5 text-sm border rounded-md disabled:opacity-50">{blankEdit && loadError ? 'Retry preview' : 'Refresh preview'}</button>}
            {sendFeedback?.status !== 'sent' && <button type="button" onClick={handleSend} disabled={loading || sending || !previewCurrent || blankEdit || sendFeedback?.status === 'uncertain'} className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-md">{sending ? 'Sending…' : 'Send reminder'}</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
