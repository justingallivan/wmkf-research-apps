import { Button } from '../Layout';
import { EndpointWordingDefault } from '../EmailWordingDefault';
import EmailDialog from '../EmailDialog';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { requestEnvelope } from '../../utils/api-request';
import EmailSendFeedback from '../EmailSendFeedback';
import { useProfile } from '../../context/ProfileContext';

const LABELS = { create: 'Invitation', invite: 'Invitation', remind: 'Reminder' };
const UNCERTAIN_COPY = 'The email result could not be confirmed. Check the recipient before trying again.';

export default function MaterialsEmailModal({ requestId, action, onClose, onSent, notice, requestEnvelope: request = requestEnvelope }) {
  const kind = action === 'remind' ? 'reminder' : 'invitation';
  const profile = useProfile();
  const profileId = profile?.currentProfile?.id ?? profile?.profileId ?? profile?.session?.user?.profileId ?? null;
  const contextKey = `${requestId}:${action}:${profileId ?? ''}`;
  const [template, setTemplate] = useState({ subject: '', body: '' });
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [savedMessage, setSavedMessage] = useState(null);
  const [saving, setSaving] = useState(false);
  const [wordingBusy, setWordingBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  const sendingRef = useRef(false);
  const activeSendRef = useRef(null);
  const contextRef = useRef(contextKey);
  useLayoutEffect(() => {
    contextRef.current = contextKey;
  }, [contextKey]);

  const current = useCallback((generation, expectedContext = contextKey) => (
    mountedRef.current && generationRef.current === generation && contextRef.current === expectedContext
  ), [contextKey]);

  useEffect(() => {
    mountedRef.current = true;
    contextRef.current = contextKey;
    const generation = ++generationRef.current;
    setPreview(null);
    setFeedback(null);
    setError(null);
    setSavedMessage(null);
    setBusy(true);
    setSaving(false);
    setSending(false);
    sendingRef.current = false;
    activeSendRef.current = null;
    const controller = new AbortController();
    request(`/api/meeting-tracker/materials-email-preferences?kind=${kind}`, { tolerantBody: true, signal: controller.signal })
      .then((result) => {
        if (!current(generation)) return;
        if (!result.ok) throw new Error(result.data?.error || 'The email default could not be loaded.');
        setTemplate(result.data?.template || result.data?.shared || { subject: '', body: '' });
      })
      .catch((loadError) => {
        if (loadError?.name !== 'AbortError' && current(generation)) setError(loadError.message || 'The email default could not be loaded.');
      })
      .finally(() => { if (current(generation)) setBusy(false); });
    return () => { controller.abort(); };
  }, [contextKey, current, kind, request]);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const update = (field, value) => {
    generationRef.current += 1;
    setTemplate((prev) => ({ ...prev, [field]: value }));
    setPreview(null);
    setFeedback(null);
    setSavedMessage(null);
    setError(null);
    setBusy(false);
    activeSendRef.current = null;
  };

  const renderPreview = async () => {
    if (busy || saving || wordingBusy) return;
    const generation = generationRef.current;
    const expectedContext = contextKey;
    setBusy(true); setError(null); setFeedback(null); setSavedMessage(null);
    try {
      const result = await request(`/api/meeting-tracker/visits/${encodeURIComponent(requestId)}/materials`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: { action: 'preview', sendAction: action, emailTemplate: template }, tolerantBody: true,
      });
      if (!current(generation, expectedContext)) return;
      if (!result.ok) throw new Error(result.data?.error || 'The preview could not be rendered.');
      if (!result.data?.proof || typeof result.data.subject !== 'string' || typeof result.data.bodyText !== 'string'
          || !Array.isArray(result.data.recipients)) throw new Error('The preview response was incomplete. Refresh and try again.');
      setPreview(result.data);
    } catch (renderError) {
      if (current(generation, expectedContext) && renderError?.name !== 'AbortError') setError(renderError.message || 'The preview could not be rendered.');
    } finally {
      if (current(generation, expectedContext)) setBusy(false);
    }
  };

  const send = async () => {
    if (wordingBusy || preview?.canSend !== true || !preview?.proof || sendingRef.current || busy || saving) return;
    sendingRef.current = true;
    setSending(true);
    const generation = generationRef.current;
    const expectedContext = contextKey;
    const sendMarker = { generation, expectedContext };
    activeSendRef.current = sendMarker;
    setBusy(true); setError(null); setFeedback(null); setSavedMessage(null);
    try {
      const result = await request(`/api/meeting-tracker/visits/${encodeURIComponent(requestId)}/materials`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: { action, emailTemplate: template, proof: preview.proof }, tolerantBody: true,
      });
      if (!mountedRef.current || activeSendRef.current !== sendMarker || contextRef.current !== expectedContext) return;
      const data = result.data || result || {};
      if (!result.ok) {
        const status = result.status === 400 || result.status === 403 || result.status === 409 || (result.status === 503 && ['meeting_coordinator_unavailable', 'site_visit_materials_signature_unavailable', 'site_visit_materials_email_defaults_unavailable', 'site_visit_materials_impersonation_required'].includes(data.code)) || data.outcome === 'failed' ? 'failed' : 'uncertain';
        onSent?.({ ...(data && typeof data === 'object' ? data : {}), outcome: status });
        setPreview(null);
        setFeedback({ status, message: data.error || UNCERTAIN_COPY });
        return;
      }
      const validSuccess = action === 'create'
        ? data.success === true && data.invitationSent === true && data.collection
        : data.success === true && data.collection;
      if (!validSuccess || data.outcome === 'uncertain' || data.invitationSent === false) {
        const status = data.invitationOutcome === 'failed' ? 'failed' : 'uncertain';
        onSent?.({ ...(data && typeof data === 'object' ? data : {}), outcome: status });
        setPreview(null);
        setFeedback({ status, message: status === 'failed' ? (data.invitationError || 'The collection was created, but the invitation was not sent. You can refresh and try again.') : UNCERTAIN_COPY });
        return;
      }
      onSent?.({ ...data, outcome: 'sent' });
      setPreview(null);
      setFeedback({ status: 'sent' });
      onClose?.();
    } catch (sendError) {
      if (mountedRef.current && activeSendRef.current === sendMarker) {
        onSent?.({ outcome: 'uncertain' });
        setPreview(null);
        setFeedback({ status: 'uncertain', message: UNCERTAIN_COPY });
      }
    } finally {
      if (activeSendRef.current === sendMarker) {
        sendingRef.current = false;
        if (mountedRef.current) { setBusy(false); setSending(false); }
        activeSendRef.current = null;
      }
    }
  };

  return (
    <EmailDialog label="Materials email" busy={sending || saving || wordingBusy} onClose={onClose}>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4"><div><h2 id="materials-email-title" className="text-lg font-semibold">{LABELS[action]} email</h2><p className="mt-1 text-sm text-gray-600">Edit this send, then refresh the preview before sending.</p></div><Button variant="link" size="sm" type="button" onClick={onClose} disabled={sending || saving || wordingBusy} className="text-sm underline">Close</Button></div>
        {notice && <div role="note" className="mt-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm">{notice}</div>}
        {error && <div role="alert" className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
        {feedback && <EmailSendFeedback className="mt-4" status={feedback.status} message={feedback.message} data-testid="materials-email-feedback" />}
        {savedMessage && <div role="status" className="mt-4 rounded border border-green-200 bg-green-50 p-3 text-sm text-green-800">{savedMessage}</div>}
        <label className="mt-4 block text-sm font-semibold">Subject<input value={template.subject} onChange={(e) => update('subject', e.target.value)} disabled={sending || saving || wordingBusy} className="mt-1 w-full rounded border border-gray-300 p-2 font-normal" /></label>
        <label className="mt-4 block text-sm font-semibold">Message<textarea value={template.body} onChange={(e) => update('body', e.target.value)} disabled={sending || saving || wordingBusy} rows={10} className="mt-1 w-full rounded border border-gray-300 p-2 font-normal" /></label>
        <p className="mt-2 text-xs text-gray-500">Keep the required {kind === 'invitation' ? '{{checklist}}' : '{{missingItems}}'} placeholder. The secure upload link and action button are added by the server.</p>
        <div className="mt-4"><EndpointWordingDefault endpoint="/api/meeting-tracker/materials-email-preferences" kind={kind} scopeKey={contextKey} disabled={busy || saving || sending} onBusyChange={setWordingBusy} hint={`Keep the required ${kind === 'invitation' ? '{{checklist}}' : '{{missingItems}}'} placeholder.`} /></div>
        {preview?.canSend === false && <p role="note" className="mt-4 text-sm text-gray-700">{preview.sendUnavailableReason || 'Only the assigned Program Coordinator can send this email. They must open and review their own preview.'}</p>}
        {preview && <div className="mt-5 rounded-lg border border-gray-200 bg-gray-50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Rendered preview</p><p className="mt-2 text-xs text-gray-600"><strong>From:</strong> {preview.fromEmail}</p><p className="text-xs text-gray-600"><strong>To:</strong> {preview.recipients?.map((person) => person.email).join(', ')}</p>{preview.ccRecipients?.length > 0 && <p className="text-xs text-gray-600"><strong>Cc:</strong> {preview.ccRecipients.map((person) => person.email).join(', ')}</p>}<p className="mt-2 font-semibold">{preview.subject}</p><pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-gray-800">{preview.bodyText}</pre>{preview.secureLinkPlaceholder && <p className="mt-3 text-xs font-medium text-amber-800">The secure link will be generated when you send.</p>}</div>}
        <div className="mt-5 flex flex-wrap justify-end gap-2"><Button variant="outline" size="sm" type="button" disabled={busy || saving || wordingBusy} onClick={renderPreview} className="rounded border border-gray-700 px-3 py-2 text-sm font-semibold">{busy ? 'Working…' : 'Refresh preview'}</Button><Button variant="primary" size="sm" type="button" disabled={busy || saving || wordingBusy || preview?.canSend !== true} onClick={send} className="rounded px-3 py-2 text-sm font-semibold disabled:opacity-50">Send</Button></div>
      </div>
    </div>
    </EmailDialog>
  );
}
