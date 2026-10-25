import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { requestJson, requestEnvelope } from '../../utils/api-request';
import { useSession } from 'next-auth/react';
import AgendaWordingDefault from './AgendaWordingDefault';
import { Button } from '../Layout';
import EmailSendFeedback from '../EmailSendFeedback';

const EMPTY_DEFAULTS = { subject: '', message: '', source: 'empty', personalStatus: 'unavailable', sharedStatus: 'unavailable' };

function newOperationId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}`
    + `-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function attendeeEmails(session) {
  return [...new Set((session?.attendees || [])
    .map((person) => String(person?.email || '').trim().toLowerCase())
    .filter(Boolean))].join(', ');
}

function splitEmails(value) {
  return String(value || '').split(/[;,\n]/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function appendEmail(form, target, email) {
  const normalized = String(email || '').trim().toLowerCase();
  const otherTarget = target === 'to' ? 'cc' : 'to';
  const existing = new Set(splitEmails(form[target]));
  const other = new Set(splitEmails(form[otherTarget]));
  if (!normalized || existing.has(normalized) || other.has(normalized)) return form;
  return {
    ...form,
    [target]: form[target].trim() ? `${form[target]}, ${normalized}` : normalized,
  };
}

function formatReceipt(iso, timeZone) {
  const date = new Date(iso || '');
  if (!Number.isFinite(date.getTime())) return 'recently';
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
      ...(timeZone ? { timeZone } : {}),
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

function scheduleKey(session, slots) {
  return JSON.stringify({ session, slots });
}

function DirectoryDialog({ target, recipients, form, onAdd, onClose }) {
  const rows = useMemo(() => [
    ...(recipients?.staff || []).map((person) => ({ ...person, category: 'Staff' })),
    ...(recipients?.board || []).map((person) => ({ ...person, category: 'Board' })),
  ], [recipients]);
  const present = new Set([...splitEmails(form.to), ...splitEmails(form.cc)]);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" role="presentation">
      <section role="dialog" aria-modal="true" aria-labelledby="agenda-directory-title" className="w-full max-w-lg rounded-xl bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 p-4">
          <div>
            <h3 id="agenda-directory-title" className="font-semibold text-gray-900">Add recipients to {target === 'cc' ? 'Cc' : 'To'}</h3>
            <p className="mt-1 text-xs text-gray-500">Staff and Board members from the Meeting Tracker directory.</p>
          </div>
          <Button variant="outline" size="sm" type="button" onClick={onClose} className="text-sm text-gray-500 hover:text-gray-800">Close</Button>
        </div>
        <div className="max-h-[55vh] space-y-2 overflow-y-auto p-4">
          {rows.map((person) => {
            const email = String(person.email || '').toLowerCase();
            const added = present.has(email);
            return (
              <Button variant="outline" size="sm"
                key={`${person.category}-${person.ref?.profileId || person.ref?.rosterId || email}`}
                type="button"
                disabled={added || !email}
                onClick={() => onAdd(target, email)}
                className="flex w-full items-start justify-between gap-3 rounded-lg border border-gray-200 p-3 text-left disabled:bg-gray-50 disabled:text-gray-400"
              >
                <span><span className="block font-medium">{person.name}</span><span className="block text-xs">{email}</span></span>
                <span className="text-xs font-medium">{added ? 'Already added' : person.category}</span>
              </Button>
            );
          })}
          {rows.length === 0 && <p className="py-6 text-center text-sm text-gray-500">No eligible people found.</p>}
        </div>
        <div className="flex justify-end border-t border-gray-200 p-4">
          <Button variant="outline" size="sm" type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium">Close</Button>
        </div>
      </section>
    </div>
  );
}

function ComposerDialog({ children, busy, directoryOpen, onClose }) {
  const closeRef = useRef(null);
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    closeRef.current?.querySelector('button')?.focus();
    return () => previouslyFocused?.focus?.();
  }, []);
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape' && !busy && !directoryOpen) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, directoryOpen, onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" role="presentation">
      <section role="dialog" aria-modal="true" aria-labelledby="agenda-composer-title" className="my-6 w-full max-w-3xl rounded-xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 id="agenda-composer-title" className="text-lg font-semibold text-gray-900">Send session agenda</h3>
            <p className="mt-1 text-sm text-gray-600">You are sending one agenda from your Dynamics mailbox to the session attendees.</p>
          </div>
          <span ref={closeRef}><Button variant="outline" size="sm" type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium disabled:opacity-50">Close</Button></span>
        </div>
        {children}
        <div className="mt-6 flex justify-end border-t border-gray-200 pt-4">
          <Button variant="outline" size="sm" type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium disabled:opacity-50">Close</Button>
        </div>
      </section>
    </div>
  );
}

export default function SessionAgendaPanel(props) {
  const { data: auth, status } = useSession();
  const actor = `${status}:${auth?.user?.dynamicsSystemuserId || ''}:${auth?.user?.azureEmail || auth?.user?.email || ''}`;
  return <AgendaPanel key={`${props.sessionId}:${actor}`} {...props} />;
}

function AgendaPanel({ sessionId, session, slots, recipients }) {
  const [lastAgenda, setLastAgenda] = useState(null);
  const [pendingSend, setPendingSend] = useState(null);
  const [changed, setChanged] = useState(false);
  const [linksUnavailable, setLinksUnavailable] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [defaults, setDefaults] = useState(EMPTY_DEFAULTS);
  const [draftDefaults, setDraftDefaults] = useState(EMPTY_DEFAULTS);
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [directoryTarget, setDirectoryTarget] = useState(null);
  const [form, setForm] = useState({ to: '', cc: '', subject: '', bodyText: '' });
  const [previewState, setPreviewState] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(null);
  const [defaultsBusy, setDefaultsBusy] = useState(false);
  const locked = Boolean(busy) || defaultsBusy;
  const [error, setError] = useState(null);
  const [sendFeedback, setSendFeedback] = useState(null);
  const [notice, setNotice] = useState(null);
  const sequence = useRef(0);
  const controllerRef = useRef(null);
  const statusSequence = useRef(0);
  const defaultsGeneration = useRef(0);
  const openSequence = useRef(0);
  const initController = useRef(null);
  const currentScheduleKey = scheduleKey(session, slots);
  const preview = previewState && (previewState.snapshot.transportAccepted
    || (pendingSend?.operationId && previewState.snapshot.operationId === pendingSend.operationId)
    || previewState.key === currentScheduleKey) ? previewState.snapshot : null;
  const setPreview = useCallback((snapshot) => setPreviewState(snapshot ? { snapshot, key: currentScheduleKey } : null), [currentScheduleKey]);


  const loadStatus = useCallback(async (signal, expectedSequence, expectedDefaults) => {
    const body = await requestJson(`/api/meeting-tracker/sessions/${sessionId}/agenda`, {
      signal,
      fallbackMessage: 'The last agenda could not be loaded.',
      tolerantBody: true,
    });
    if (statusSequence.current !== expectedSequence) return;
    setLastAgenda(body.lastAgenda || null);
    setPendingSend(body.pendingSend || null);
    setChanged(body.scheduleChanged === true);
    setLinksUnavailable(body.linksUnavailable === true);
    if (defaultsGeneration.current === expectedDefaults) setDefaults(body.defaults || EMPTY_DEFAULTS);
    setStatusLoaded(true);
    setLoadError(null);
  }, [sessionId]);

  useEffect(() => {
    const currentSequence = ++statusSequence.current;
    const controller = new AbortController();
    loadStatus(controller.signal, currentSequence, defaultsGeneration.current).catch((loadFailure) => {
      if (loadFailure?.name !== 'AbortError' && statusSequence.current === currentSequence) {
        setLoadError(loadFailure.message);
      }
    });
    return () => {
      statusSequence.current += 1;
      controller.abort();
    };
  }, [currentScheduleKey, loadStatus]);

  useEffect(() => () => { sequence.current += 1; openSequence.current += 1; controllerRef.current?.abort(); initController.current?.abort(); }, []);

  useEffect(() => {
    // A changed-then-restored schedule still requires a new human review.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- invalidate a reviewed snapshot when its external schedule changes
    setConfirmed(false);
    setPreviewState((current) => current && (current.snapshot.transportAccepted || current.snapshot.operationId === pendingSend?.operationId) ? current : null);
  }, [currentScheduleKey, pendingSend?.operationId]);

  const openComposer = async () => {
    if (pendingSend?.operationId) {
      setForm({ to: '', cc: '', subject: '', bodyText: '' });
      setPreview(pendingSend);
      setConfirmed(false);
      setError(null);
      setSendFeedback({
        status: 'uncertain',
        message: 'Review and reconcile this exact agenda before trying again.',
      });
      setNotice(null);
      setDirectoryTarget(null);
      setComposerOpen(true);
      return;
    }
    // Cached defaults are only a disabled loading placeholder; every opening
    // still gets a fresh server read before the fields become editable.
    setForm({ to: attendeeEmails(session), cc: '', subject: defaults.subject, bodyText: defaults.message });
    setDraftDefaults(defaults);
    const opening = ++openSequence.current;
    const generation = ++defaultsGeneration.current;
    initController.current?.abort(); const abort = new AbortController(); initController.current = abort;
    setComposerOpen(true); setBusy('initialize'); setError(null);
    let starting = EMPTY_DEFAULTS;
    try {
      const status = await requestJson(`/api/meeting-tracker/sessions/${sessionId}/agenda`, { signal: abort.signal, tolerantBody: true });
      if (opening !== openSequence.current || generation !== defaultsGeneration.current) return;
      if (status.pendingSend?.operationId) {
        setPendingSend(status.pendingSend); setPreview(status.pendingSend); setConfirmed(false); setBusy(null); return;
      }
      starting = status.defaults || EMPTY_DEFAULTS; setDefaults(starting);
    } catch {
      if (opening !== openSequence.current) return;
      setDefaults(EMPTY_DEFAULTS);
    }
    if (opening !== openSequence.current) return;
    setBusy(null);
    setDraftDefaults(starting);
    setForm({
      to: attendeeEmails(session),
      cc: '',
      subject: starting.subject,
      bodyText: starting.message,
    });
    setPreview(null);
    setConfirmed(false);
    setError(null);
    setSendFeedback(null);
    setNotice(null);
    setDirectoryTarget(null);
    setComposerOpen(true);
  };

  const closeComposer = useCallback(() => {
    if (defaultsBusy || (busy && busy !== 'initialize')) return;
    setBusy(null);
    openSequence.current += 1; initController.current?.abort();
    setDirectoryTarget(null); setComposerOpen(false); setPreview(null); setConfirmed(false);
    setForm({ to: '', cc: '', subject: '', bodyText: '' });
  }, [busy, defaultsBusy, setPreview]);

  const edit = (patch) => {
    setForm((current) => ({ ...current, ...patch }));
    setPreview(null);
    setConfirmed(false);
    setError(null);
    setSendFeedback(null);
    setNotice(null);
  };

  const addDirectoryRecipient = (target, email) => {
    setForm((current) => appendEmail(current, target, email));
    setPreview(null);
    setConfirmed(false);
    setError(null);
    setSendFeedback(null);
    setNotice(null);
  };

  const prepare = async () => {
    if (locked || !form.to.trim() || !form.subject.trim()) return;
    const currentSequence = ++sequence.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy('prepare');
    setError(null);
    setSendFeedback(null);
    setNotice(null);
    setConfirmed(false);
    try {
      const { ok: resOk, data: body } = await requestEnvelope(`/api/meeting-tracker/sessions/${sessionId}/agenda`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { operationId: newOperationId(), ...form },
        signal: controller.signal,
        tolerantBody: true,
      });
      if (!resOk && body.code === 'agenda_send_unresolved' && body.pendingSend) {
        if (sequence.current === currentSequence) {
          setPendingSend(body.pendingSend);
          setPreview(body.pendingSend);
          setConfirmed(false);
          setNotice('Another session agenda send is unresolved. Review and retry that same agenda before creating another one.');
        }
        return;
      }
      if (!resOk) throw new Error(body.error || 'The agenda preview could not be created.');
      if (sequence.current !== currentSequence) return;
      setPreview(body.agenda || null);
    } catch (prepareFailure) {
      if (prepareFailure?.name !== 'AbortError' && sequence.current === currentSequence) {
        setError(`${prepareFailure.message} Please try again. If the problem continues, contact an administrator.`);
      }
    } finally {
      if (sequence.current === currentSequence) {
        setBusy(null);
        if (controllerRef.current === controller) controllerRef.current = null;
      }
    }
  };

  const resetRecoveredDraft = async (currentSequence, signal) => {
    const generation = ++defaultsGeneration.current;
    let starting = EMPTY_DEFAULTS;
    try {
      const status = await requestJson(`/api/meeting-tracker/sessions/${sessionId}/agenda`, { signal, tolerantBody: true });
      starting = status.defaults || EMPTY_DEFAULTS;
    } catch { /* Manual entry remains available when wording cannot load. */ }
    if (sequence.current !== currentSequence || defaultsGeneration.current !== generation) return;
    setDefaults(starting);
    setDraftDefaults(starting);
    setForm({ to: attendeeEmails(session), cc: '', subject: starting.subject, bodyText: starting.message });
  };

  const send = async () => {
    if (!confirmed || !preview?.operationId || locked) return;
    const currentSequence = ++sequence.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy('send');
    setError(null);
    setSendFeedback(null);
    try {
      const { ok: resOk, data: body } = await requestEnvelope(`/api/meeting-tracker/sessions/${sessionId}/agenda`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: { operationId: preview.operationId },
        signal: controller.signal,
        tolerantBody: true,
      });
      if (!resOk && body.code === 'agenda_send_unresolved' && body.pendingSend) {
        if (sequence.current === currentSequence) {
          setPendingSend(body.pendingSend);
          setPreview(body.pendingSend);
          setConfirmed(false);
          setNotice('Another session agenda send is unresolved. Review and retry that same agenda before creating or sending another one.');
          setSendFeedback({
            status: 'failed',
            message: 'This agenda was not sent. Review the earlier unresolved send before sending another agenda.',
          });
        }
        return;
      }
      if (!resOk && body.code === 'agenda_operation_stale') {
        if (sequence.current === currentSequence) {
          setPendingSend(null);
          if (recoveringPending) {
            await resetRecoveredDraft(currentSequence, controller.signal);
            if (sequence.current !== currentSequence) return;
          }
          setPreview(null);
          setConfirmed(false);
          setNotice('The session schedule changed after this preview. Create a new preview, review it, and then send.');
        }
        return;
      }
      if (!resOk && body.code === 'agenda_send_terminal') {
        if (sequence.current === currentSequence) {
          setPendingSend(null);
          if (recoveringPending) {
            await resetRecoveredDraft(currentSequence, controller.signal);
            if (sequence.current !== currentSequence) return;
          }
          setPreview(null);
          setConfirmed(false);
          setNotice(body.error || 'Dynamics closed the prior email. Create a new preview before sending again.');
        }
        return;
      }
      if (body.code === 'agenda_send_unconfirmed' && body.pendingSend) {
        if (sequence.current === currentSequence) {
          setPendingSend(body.pendingSend);
          setPreview(body.pendingSend);
          setConfirmed(false);
          setSendFeedback({ status: 'uncertain', message: body.error });
        }
        return;
      }
      if (!resOk || body.error) {
        const agendaFailure = new Error(body.error || 'The agenda could not be sent.');
        agendaFailure.outcome = body.outcome || 'failed';
        throw agendaFailure;
      }
      if (sequence.current !== currentSequence) return;
      setPreview(body.agenda || preview);
      setLastAgenda(body.agenda || null);
      setPendingSend(null);
      setChanged(false);
      setConfirmed(false);
      setNotice(null);
    } catch (sendFailure) {
      if (sendFailure?.name !== 'AbortError' && sequence.current === currentSequence) {
        setSendFeedback({
          status: sendFailure.outcome || 'uncertain',
          message: sendFailure.outcome === 'failed'
            ? `${sendFailure.message} Please try again. If the problem continues, contact an administrator.`
            : 'The app could not confirm the result. Check the agenda history before trying again.',
        });
      }
    } finally {
      if (sequence.current === currentSequence) {
        setBusy(null);
        if (controllerRef.current === controller) controllerRef.current = null;
      }
    }
  };

  const recoveringPending = Boolean(
    pendingSend?.operationId && preview?.operationId === pendingSend.operationId,
  );
  const showEditableFields = !recoveringPending && !preview?.transportAccepted;

  return (
    <>
      <section className="mt-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm" aria-labelledby="agenda-email-title">
        <h2 id="agenda-email-title" className="text-lg font-semibold text-gray-900">Agenda email</h2>
        {lastAgenda?.sentAt ? (
          <>
            <p className="mt-1 text-sm text-gray-700">Agenda sent {formatReceipt(lastAgenda.sentAt, session?.ianaTimeZone)} to {lastAgenda.recipientCount} recipient{lastAgenda.recipientCount === 1 ? '' : 's'}.</p>
            {changed && <p className="mt-2 text-sm font-medium text-amber-800">Schedule changed since the last agenda.</p>}
          </>
        ) : (
          <p className="mt-1 text-sm text-gray-600">Send the agenda to the session&apos;s attendees so Board members know when their proposals come up.</p>
        )}
        {pendingSend?.operationId && (
          <p role="status" className="mt-2 text-sm font-medium text-amber-800">
            A send from {formatReceipt(pendingSend.sendRequestedAt, session?.ianaTimeZone)} is unresolved. Review and retry this same send before creating another agenda.
          </p>
        )}
        {linksUnavailable && <p role="status" className="mt-2 text-sm text-amber-800">Briefing links could not be confirmed. Previous sends remain available; try again before creating a new preview.</p>}
        {loadError && <p role="alert" className="mt-2 text-sm text-red-700">{loadError} Please try again. If the problem continues, contact an administrator.</p>}
        <Button
          variant={lastAgenda?.sentAt ? 'outline' : 'primary'}
          type="button"
          onClick={openComposer}
          disabled={!statusLoaded && !loadError}
          className="mt-4"
        >
          {pendingSend?.operationId ? 'Review unresolved send…' : lastAgenda?.sentAt ? 'Send agenda again…' : 'Send agenda…'}
        </Button>
      </section>

      {composerOpen && (
        <ComposerDialog busy={defaultsBusy || (Boolean(busy) && busy !== 'initialize')} directoryOpen={directoryTarget !== null} onClose={closeComposer}>
          {busy === 'initialize' && <p role="status" className="mt-3 text-sm text-gray-600">Loading current wording…</p>}
          {error && <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
          {showEditableFields && (['unavailable', 'invalid', 'identity_unavailable'].includes(draftDefaults.personalStatus) || draftDefaults.source === 'empty') && (
            <p role="status" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              Your saved wording or shared wording could not be loaded. You can enter a subject and optional opening below. Your saved settings are unchanged.
            </p>
          )}
          {showEditableFields && <div className="mt-5 grid gap-4 md:grid-cols-2">
            {[['to', 'To'], ['cc', 'Cc']].map(([field, label]) => (
              <div key={field}>
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor={`agenda-${field}`} className="text-sm font-medium text-gray-800">{label}</label>
                  <Button variant="outline" size="sm" type="button" onClick={() => setDirectoryTarget(field)} disabled={locked} className="text-xs font-medium text-blue-700 disabled:opacity-50">Add from directory</Button>
                </div>
                <textarea id={`agenda-${field}`} rows={2} value={form[field]} onChange={(event) => edit({ [field]: event.target.value })} disabled={locked} placeholder={field === 'cc' ? 'Optional' : 'One or more addresses'} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              </div>
            ))}
          </div>}
          {showEditableFields && (
            <>
              <label htmlFor="agenda-subject" className="mt-4 block text-sm font-medium text-gray-800">Subject</label>
              <input id="agenda-subject" value={form.subject} onChange={(event) => edit({ subject: event.target.value })} disabled={locked} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <label htmlFor="agenda-message" className="mt-4 block text-sm font-medium text-gray-800">Opening message (optional)</label>
              <textarea id="agenda-message" rows={4} value={form.bodyText} onChange={(event) => edit({ bodyText: event.target.value })} disabled={locked} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </>
          )}

          {showEditableFields && <>
            <p className="mt-2 text-sm text-gray-600">{draftDefaults.source === 'personal' ? 'Started from your saved wording.' : draftDefaults.source === 'empty' ? 'Enter wording for this email.' : 'Started from shared wording.'} Optional {'{{sessionDate}}'} is filled into the preview.</p>
            <AgendaWordingDefault disabled={Boolean(busy)} onBusyChange={setDefaultsBusy} onChanged={(next) => { defaultsGeneration.current += 1; if (next) setDefaults(next); }} />
          </>}
          <div className="mt-5 rounded-lg border border-gray-200 bg-gray-50 p-4">
            <h4 className="font-semibold text-gray-900">Agenda preview</h4>
            {preview ? (
              <>
                <dl className="mt-3 space-y-1 text-sm text-gray-700">
                  <div><dt className="inline font-medium">To:</dt> <dd className="inline">{preview.to.join(', ')}</dd></div>
                  {preview.cc.length > 0 && <div><dt className="inline font-medium">Cc:</dt> <dd className="inline">{preview.cc.join(', ')}</dd></div>}
                  <div><dt className="inline font-medium">Subject:</dt> <dd className="inline">{preview.subject}</dd></div>
                  <div><dt className="font-medium">Exact email:</dt><dd className="mt-1 whitespace-pre-wrap rounded border border-gray-200 bg-white p-3">{preview.bodyText}</dd></div>
                </dl>
                {preview.transportAccepted ? (
                  <EmailSendFeedback
                    className="mt-4"
                    status="sent"
                  />
                ) : (
                  <>
                    <label className="mt-4 flex items-start gap-2 text-sm text-gray-800">
                      <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={locked} className="mt-0.5" />
                      I reviewed the recipients, message, and agenda shown above.
                    </label>
                    <Button size="sm" type="button" onClick={send} variant="primary" disabled={!confirmed || locked} className="mt-3 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">{busy === 'send' ? 'Sending…' : 'Send agenda'}</Button>
                  </>
                )}
              </>
            ) : (
              <p className="mt-2 text-sm text-gray-600">Create a fixed preview to review the exact recipients, message, and proposal times.</p>
            )}
          </div>
          {sendFeedback && (
            <EmailSendFeedback
              className="mt-3"
              status={sendFeedback.status}
              message={sendFeedback.message}
              data-testid="agenda-send-feedback"
            />
          )}
          {notice && <div role="status" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{notice}</div>}
          {!preview && <Button size="sm" type="button" onClick={prepare} variant="primary" disabled={locked || !form.to.trim() || !form.subject.trim()} className="mt-4 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">{busy === 'prepare' ? 'Creating preview…' : 'Create preview'}</Button>}
        </ComposerDialog>
      )}

      {directoryTarget && (
        <DirectoryDialog
          target={directoryTarget}
          recipients={recipients}
          form={form}
          onAdd={addDirectoryRecipient}
          onClose={() => setDirectoryTarget(null)}
        />
      )}
    </>
  );
}

export const _internal = { appendEmail, attendeeEmails, scheduleKey };
