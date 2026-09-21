import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { requestEnvelope } from '../../utils/api-request';
import EmailSendFeedback from '../EmailSendFeedback';
import { useProfile } from '../../context/ProfileContext';

const LABELS = { create: 'Invitation', invite: 'Invitation', remind: 'Reminder' };
const UNCERTAIN_COPY = 'The email result could not be confirmed. Check the recipient before trying again.';

export default function MaterialsEmailModal({ requestId, action, onClose, onSent }) {
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
    requestEnvelope(`/api/meeting-tracker/materials-email-preferences?kind=${kind}`, { tolerantBody: true, signal: controller.signal })
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
  }, [contextKey, current, kind]);

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
    if (busy || saving) return;
    const generation = generationRef.current;
    const expectedContext = contextKey;
    setBusy(true); setError(null); setFeedback(null); setSavedMessage(null);
    try {
      const result = await requestEnvelope(`/api/meeting-tracker/visits/${encodeURIComponent(requestId)}/materials`, {
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

  const saveDefault = async () => {
    if (busy || saving) return;
    const generation = generationRef.current;
    const expectedContext = contextKey;
    setSaving(true); setError(null); setSavedMessage(null);
    try {
      const result = await requestEnvelope('/api/meeting-tracker/materials-email-preferences', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: { kind, template }, tolerantBody: true,
      });
      if (!current(generation, expectedContext)) return;
      if (!result.ok || result.data?.ok !== true) throw new Error(result.data?.error || 'The default could not be saved.');
      setSavedMessage('Saved as your default.');
    } catch (saveError) {
      if (current(generation, expectedContext)) setError(saveError.message || 'The default could not be saved.');
    } finally {
      if (current(generation, expectedContext)) setSaving(false);
    }
  };

  const resetDefault = async () => {
    if (busy || saving) return;
    const generation = generationRef.current;
    const expectedContext = contextKey;
    setSaving(true); setError(null); setSavedMessage(null);
    try {
      const result = await requestEnvelope('/api/meeting-tracker/materials-email-preferences', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: { kind }, tolerantBody: true,
      });
      if (!current(generation, expectedContext)) return;
      if (!result.ok || result.data?.ok !== true) throw new Error(result.data?.error || 'The shared default could not be restored.');
      const refreshed = await requestEnvelope(`/api/meeting-tracker/materials-email-preferences?kind=${kind}`, { tolerantBody: true });
      if (!current(generation, expectedContext)) return;
      if (!refreshed.ok) throw new Error(refreshed.data?.error || 'The shared default could not be loaded.');
      setTemplate(refreshed.data?.shared || refreshed.data?.template || { subject: '', body: '' });
      setPreview(null); setFeedback(null); setSavedMessage('Using the shared default.');
    } catch (resetError) {
      if (current(generation, expectedContext)) setError(resetError.message || 'The shared default could not be restored.');
    } finally {
      if (current(generation, expectedContext)) setSaving(false);
    }
  };

  const send = async () => {
    if (!preview?.proof || sendingRef.current || busy || saving) return;
    sendingRef.current = true;
    setSending(true);
    const generation = generationRef.current;
    const expectedContext = contextKey;
    const sendMarker = { generation, expectedContext };
    activeSendRef.current = sendMarker;
    setBusy(true); setError(null); setFeedback(null); setSavedMessage(null);
    try {
      const result = await requestEnvelope(`/api/meeting-tracker/visits/${encodeURIComponent(requestId)}/materials`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: { action, emailTemplate: template, proof: preview.proof }, tolerantBody: true,
      });
      if (!mountedRef.current || activeSendRef.current !== sendMarker || contextRef.current !== expectedContext) return;
      const data = result.data || result || {};
      if (!result.ok) {
        const status = result.status === 400 || result.status === 409 || data.outcome === 'failed' ? 'failed' : 'uncertain';
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
        setFeedback({ status, message: status === 'failed' ? 'The collection was created, but the invitation was not sent. You can refresh and try again.' : UNCERTAIN_COPY });
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
    <div role="dialog" aria-modal="true" aria-labelledby="materials-email-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4"><div><h2 id="materials-email-title" className="text-lg font-semibold">{LABELS[action]} email</h2><p className="mt-1 text-sm text-gray-600">Edit this send, then refresh the preview before sending.</p></div><button type="button" onClick={onClose} disabled={sending || saving} className="text-sm underline">Close</button></div>
        {error && <div role="alert" className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
        {feedback && <EmailSendFeedback className="mt-4" status={feedback.status} message={feedback.message} data-testid="materials-email-feedback" />}
        {savedMessage && <div role="status" className="mt-4 rounded border border-green-200 bg-green-50 p-3 text-sm text-green-800">{savedMessage}</div>}
        <label className="mt-4 block text-sm font-semibold">Subject<input value={template.subject} onChange={(e) => update('subject', e.target.value)} disabled={sending || saving} className="mt-1 w-full rounded border border-gray-300 p-2 font-normal" /></label>
        <label className="mt-4 block text-sm font-semibold">Message<textarea value={template.body} onChange={(e) => update('body', e.target.value)} disabled={sending || saving} rows={10} className="mt-1 w-full rounded border border-gray-300 p-2 font-normal" /></label>
        <p className="mt-2 text-xs text-gray-500">Keep the required {kind === 'invitation' ? '{{checklist}}' : '{{missingItems}}'} placeholder. The secure upload link and action button are added by the server.</p>
        {preview && <div className="mt-5 rounded-lg border border-gray-200 bg-gray-50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Rendered preview</p><p className="mt-2 text-xs text-gray-600"><strong>From:</strong> {preview.fromEmail} · <strong>To:</strong> {preview.recipients?.map((person) => person.email).join(', ')}</p><p className="mt-2 font-semibold">{preview.subject}</p><pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-gray-800">{preview.bodyText}</pre>{preview.secureLinkPlaceholder && <p className="mt-3 text-xs font-medium text-amber-800">The secure link will be generated when you send.</p>}</div>}
        <div className="mt-5 flex flex-wrap justify-end gap-2"><button type="button" disabled={saving || busy} onClick={saveDefault} className="rounded border border-gray-300 px-3 py-2 text-sm font-semibold">{saving ? 'Saving…' : 'Save as my default'}</button><button type="button" disabled={saving || busy} onClick={resetDefault} className="rounded border border-gray-300 px-3 py-2 text-sm font-semibold">Use shared default</button><button type="button" disabled={busy || saving} onClick={renderPreview} className="rounded border border-gray-700 px-3 py-2 text-sm font-semibold">{busy ? 'Working…' : 'Refresh preview'}</button><button type="button" disabled={busy || saving || !preview} onClick={send} className="rounded bg-gray-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Send</button></div>
      </div>
    </div>
  );
}
