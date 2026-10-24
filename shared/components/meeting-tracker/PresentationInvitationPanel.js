import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../Layout';
import { useProfile } from '../../context/ProfileContext';
import { requestJson } from '../../utils/api-request';
const DEFAULT_MESSAGE = 'Please join us for the research presentation at the time and location below.';
const UNRESOLVED = new Set(['creating', 'activity_created', 'send_requested', 'unknown']);

/** Frozen email preview and receipts; only an explicit Send invokes transport. */
export default function PresentationInvitationPanel({ requestId, requestNumber }) {
  const profile = useProfile();
  const profileId = profile?.currentProfile?.id ?? profile?.profileId ?? null;
  const endpoint = `/api/meeting-tracker/visits/${encodeURIComponent(requestId)}/invitation`;
  const contextKey = `${requestId}:${profileId ?? ''}`;
  const [invitation, setInvitation] = useState(null);
  const [canSend, setCanSend] = useState(false);
  const [canReconcile, setCanReconcile] = useState(false);
  const [subject, setSubject] = useState(`Research presentation${requestNumber ? ` · #${requestNumber}` : ''}`);
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [available, setAvailable] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [previewStale, setPreviewStale] = useState(false);
  const invalidPreview = useRef(null);
  const mounted = useRef(false), generation = useRef(0), readSequence = useRef(0), pending = useRef(false), controllers = useRef(new Set());
  const load = useCallback(async ({ preserveError = false } = {}) => {
    if (pending.current) return;
    const seq = generation.current, read = ++readSequence.current, controller = new AbortController();
    controllers.current.add(controller);
    try {
      const result = await requestJson(endpoint, { signal: controller.signal, fallbackMessage: 'Invitation status could not be checked.' });
      if (!mounted.current || seq !== generation.current || read !== readSequence.current) return;
      setAvailable(true); setInvitation(result.invitation); setCanSend(result.canSend === true); setCanReconcile(result.canReconcile === true);
      setPreviewStale(Boolean(result.invitation?.id && result.invitation.id === invalidPreview.current));
      if (!preserveError) setError(null);
    } catch (failure) {
      if (!mounted.current || seq !== generation.current || read !== readSequence.current || controller.signal.aborted) return;
      if ((failure.payload?.code || failure.code) === 'presentation_invitation_unavailable') setAvailable(false);
      else { setAvailable(true); setError(failure.message); }
    } finally { controllers.current.delete(controller); }
  }, [endpoint, contextKey]);
  useEffect(() => {
    mounted.current = true; const seq = ++generation.current;
    void Promise.resolve().then(() => {
      if (!mounted.current || seq !== generation.current) return;
      pending.current = false; invalidPreview.current = null; setBusy(false); setInvitation(null); setAvailable(null); setCanSend(false); setCanReconcile(false); setError(null); setPreviewStale(false);
      setSubject(`Research presentation${requestNumber ? ` · #${requestNumber}` : ''}`); setMessage(DEFAULT_MESSAGE); void load();
    });
    const active = controllers.current;
    return () => { mounted.current = false; generation.current += 1; readSequence.current += 1; for (const controller of active) controller.abort(); };
  }, [load, requestNumber]);
  const command = async (body) => {
    if (pending.current) return;
    const seq = generation.current, controller = new AbortController();
    pending.current = true; readSequence.current += 1; controllers.current.add(controller); setBusy(true); setError(null);
    let reload = false;
    try {
      const result = await requestJson(endpoint, { method: 'POST', body, signal: controller.signal, fallbackMessage: 'The email result could not be confirmed. Check its status before trying again.' });
      if (!mounted.current || seq !== generation.current) return;
      if (!result.invitation?.id) throw new Error('The invitation result was incomplete. Refresh its status before continuing.');
      setInvitation(result.invitation); invalidPreview.current = null; setPreviewStale(false); if (typeof result.canSend === 'boolean') setCanSend(result.canSend); if (typeof result.canReconcile === 'boolean') setCanReconcile(result.canReconcile);
    } catch (failure) {
      if (mounted.current && seq === generation.current && !controller.signal.aborted) { reload = true; setError(failure.message); if (failure.payload?.invitation?.id) { setInvitation(failure.payload.invitation); setCanSend(failure.payload.canSend === true); setCanReconcile(failure.payload.canReconcile === true); } const code = failure.payload?.code || failure.code; if (['presentation_invitation_preview_stale', 'presentation_invitation_preview_expired'].includes(code)) { invalidPreview.current = body.invitationId; setPreviewStale(true); } if (code === 'presentation_invitation_actor') setCanSend(false); }
    } finally {
      controllers.current.delete(controller);
      if (mounted.current && seq === generation.current) { pending.current = false; setBusy(false); if (reload) void load({ preserveError: true }); }
    }
  };
  const unresolved = UNRESOLVED.has(invitation?.state);
  return <section aria-labelledby="presentation-invitation-title" className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
    <h2 id="presentation-invitation-title" className="text-lg font-semibold text-gray-950">Presentation invitation</h2>
    <p className="mt-2 text-sm leading-6 text-gray-600">Review an email using the saved meeting details and selected attendees. This sends meeting information; it does not create or update calendar invitations.</p>
    {available === null && <p role="status" className="mt-3 text-sm text-gray-600">Checking invitation status…</p>}
    {available === false && <p className="mt-3 text-sm text-gray-600">Invitation emails are not enabled for this environment.</p>}
    {available === true && <>
      {!invitation && <div className="mt-4 space-y-4">
        <label className="block text-sm font-medium">Subject<input value={subject} maxLength={320} disabled={busy} onChange={event => setSubject(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 p-2" /></label>
        <label className="block text-sm font-medium">Message<textarea rows={4} maxLength={8000} value={message} disabled={busy} onChange={event => setMessage(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 p-2" /></label>
        <Button type="button" size="sm" disabled={busy || !subject.trim()} onClick={() => void command({ action: 'prepare', subject, message })}>{busy ? 'Preparing…' : 'Review recipients and message'}</Button>
      </div>}
      {invitation && <div className="mt-4 space-y-3">
        {invitation.state === 'sent' && <p role="status" className="font-medium text-green-800">Sent for delivery.</p>}
        {invitation.state === 'failed' && <p role="status" className="text-gray-700">Not sent. Prepare and review a fresh invitation before trying again.</p>}
        {unresolved && <p role="status" className="text-amber-900">The send result needs checking. Check the saved email status; do not send another copy while it is uncertain.</p>}
        {unresolved && invitation.emailId && <p className="text-sm leading-6 text-gray-600">If the saved email remains an unsent draft, ask the sender or an administrator to inspect and cancel that exact email in Dynamics, then check its status here. Email activity: <span className="break-all font-mono text-xs">{invitation.emailId}</span>.</p>}
        {!invitation.redacted && <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm">
          <p><strong>From:</strong> {invitation.fromEmail}</p>
          <p className="mt-1 break-words"><strong>To:</strong> {invitation.to?.length ? invitation.to.join(', ') : 'None selected'}</p>
          <p className="mt-1 break-words"><strong>Cc:</strong> {invitation.cc?.length ? invitation.cc.join(', ') : 'None selected'}</p>
          <p className="mt-3 font-semibold">{invitation.subject}</p><p className="mt-2 whitespace-pre-wrap break-words leading-6">{invitation.bodyText}</p>
        </div>}
        {invitation.redacted && <p className="text-sm text-gray-600">The thirty-day message retention period ended. Its transport receipt is retained for reconciliation.</p>}
        <div className="flex flex-wrap gap-2">
          {invitation.state === 'prepared' && <Button type="button" size="sm" disabled={busy || !canSend || previewStale || invitation.redacted} onClick={() => void command({ action: 'send', invitationId: invitation.id, expectedVersion: invitation.version })}>{busy ? 'Sending…' : 'Send reviewed invitation'}</Button>}
          {unresolved && <Button type="button" size="sm" disabled={busy || !canReconcile} onClick={() => void command({ action: 'reconcile', invitationId: invitation.id, expectedVersion: invitation.version })}>{busy ? 'Checking…' : 'Check email status'}</Button>}
          {!unresolved && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { setSubject(invitation.subject || subject); setMessage(invitation.message || message); setInvitation(null); setError(null); setPreviewStale(false); }}>Edit and prepare a fresh preview</Button>}
        </div>
        {previewStale && <p className="text-sm text-gray-600">This preview is no longer current. Edit and prepare a fresh preview before sending.</p>}
        {!canSend && <p className="text-sm text-gray-600">Only the original staff sender can send this preview. Authorized staff can check its saved transport status.</p>}
      </div>}
      <Button type="button" size="sm" variant="link" className="mt-3" disabled={busy} onClick={() => void load()}>Refresh invitation status</Button>
    </>}
    {error && <p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}
  </section>;
}
