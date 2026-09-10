import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const DEFAULT_MESSAGE = "Here is the agenda for our deliberation session. Each proposal's briefing page opens without a login.";

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

function defaultSubject(session) {
  const start = new Date(session?.scheduledStartIso || '');
  if (!Number.isFinite(start.getTime())) return 'Deliberation session agenda';
  try {
    const date = new Intl.DateTimeFormat('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', timeZone: session.ianaTimeZone,
    }).format(start);
    return `Deliberation session agenda — ${date}`;
  } catch {
    return 'Deliberation session agenda';
  }
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
  return JSON.stringify({
    start: session?.scheduledStartIso || '',
    slots: [...(slots || [])]
      .sort((left, right) => Number(left.wmkf_order || 0) - Number(right.wmkf_order || 0))
      .map((slot) => [slot._wmkf_request_value, slot.wmkf_minutes]),
  });
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
          <button type="button" onClick={onClose} className="text-sm text-gray-500 hover:text-gray-800">Close</button>
        </div>
        <div className="max-h-[55vh] space-y-2 overflow-y-auto p-4">
          {rows.map((person) => {
            const email = String(person.email || '').toLowerCase();
            const added = present.has(email);
            return (
              <button
                key={`${person.category}-${person.ref?.profileId || person.ref?.rosterId || email}`}
                type="button"
                disabled={added || !email}
                onClick={() => onAdd(target, email)}
                className="flex w-full items-start justify-between gap-3 rounded-lg border border-gray-200 p-3 text-left disabled:bg-gray-50 disabled:text-gray-400"
              >
                <span><span className="block font-medium">{person.name}</span><span className="block text-xs">{email}</span></span>
                <span className="text-xs font-medium">{added ? 'Already added' : person.category}</span>
              </button>
            );
          })}
          {rows.length === 0 && <p className="py-6 text-center text-sm text-gray-500">No eligible people found.</p>}
        </div>
        <div className="flex justify-end border-t border-gray-200 p-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium">Close</button>
        </div>
      </section>
    </div>
  );
}

function ComposerDialog({ children, busy, directoryOpen, onClose }) {
  const closeRef = useRef(null);
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    closeRef.current?.focus();
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
          <button ref={closeRef} type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium disabled:opacity-50">Close</button>
        </div>
        {children}
        <div className="mt-6 flex justify-end border-t border-gray-200 pt-4">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium disabled:opacity-50">Close</button>
        </div>
      </section>
    </div>
  );
}

export default function SessionAgendaPanel({ sessionId, session, slots, recipients }) {
  const [lastAgenda, setLastAgenda] = useState(null);
  const [pendingSend, setPendingSend] = useState(null);
  const [changed, setChanged] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [directoryTarget, setDirectoryTarget] = useState(null);
  const [form, setForm] = useState({ to: '', cc: '', subject: '', bodyText: DEFAULT_MESSAGE });
  const [preview, setPreview] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const sequence = useRef(0);
  const controllerRef = useRef(null);
  const currentScheduleKey = scheduleKey(session, slots);

  const loadStatus = useCallback(async (signal, expectedSequence) => {
    const response = await fetch(`/api/meeting-tracker/sessions/${sessionId}/agenda`, { signal });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'The last agenda could not be loaded.');
    if (sequence.current !== expectedSequence) return;
    setLastAgenda(body.lastAgenda || null);
    setPendingSend(body.pendingSend || null);
    setChanged(body.scheduleChanged === true);
    setLoadError(null);
  }, [sessionId]);

  useEffect(() => {
    const currentSequence = ++sequence.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    loadStatus(controller.signal, currentSequence).catch((loadFailure) => {
      if (loadFailure?.name !== 'AbortError' && sequence.current === currentSequence) {
        setLoadError(loadFailure.message);
      }
    });
    return () => {
      sequence.current += 1;
      controller.abort();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [currentScheduleKey, loadStatus]);

  const openComposer = () => {
    if (pendingSend?.operationId) {
      setForm({ to: '', cc: '', subject: '', bodyText: '' });
      setPreview(pendingSend);
      setConfirmed(false);
      setError(null);
      setNotice('Dynamics has not confirmed this send. Review and retry the same agenda before creating another one.');
      setDirectoryTarget(null);
      setComposerOpen(true);
      return;
    }
    setForm({
      to: attendeeEmails(session),
      cc: '',
      subject: defaultSubject(session),
      bodyText: DEFAULT_MESSAGE,
    });
    setPreview(null);
    setConfirmed(false);
    setError(null);
    setNotice(null);
    setDirectoryTarget(null);
    setComposerOpen(true);
  };

  const closeComposer = useCallback(() => {
    if (busy) return;
    setDirectoryTarget(null);
    setComposerOpen(false);
  }, [busy]);

  const edit = (patch) => {
    setForm((current) => ({ ...current, ...patch }));
    setPreview(null);
    setConfirmed(false);
    setError(null);
    setNotice(null);
  };

  const addDirectoryRecipient = (target, email) => {
    setForm((current) => appendEmail(current, target, email));
    setPreview(null);
    setConfirmed(false);
    setNotice(null);
  };

  const prepare = async () => {
    if (busy || !form.to.trim() || !form.subject.trim() || !form.bodyText.trim()) return;
    const currentSequence = ++sequence.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy('prepare');
    setError(null);
    setNotice(null);
    setConfirmed(false);
    try {
      const response = await fetch(`/api/meeting-tracker/sessions/${sessionId}/agenda`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operationId: newOperationId(), ...form }),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok && body.code === 'agenda_send_unresolved' && body.pendingSend) {
        if (sequence.current === currentSequence) {
          setPendingSend(body.pendingSend);
          setPreview(body.pendingSend);
          setConfirmed(false);
          setNotice('Another session agenda send is unresolved. Review and retry that same agenda before creating another one.');
        }
        return;
      }
      if (!response.ok) throw new Error(body.error || 'The agenda preview could not be created.');
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

  const send = async () => {
    if (!confirmed || !preview?.operationId || busy) return;
    const currentSequence = ++sequence.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy('send');
    setError(null);
    try {
      const response = await fetch(`/api/meeting-tracker/sessions/${sessionId}/agenda`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operationId: preview.operationId }),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok && body.code === 'agenda_send_unresolved' && body.pendingSend) {
        if (sequence.current === currentSequence) {
          setPendingSend(body.pendingSend);
          setPreview(body.pendingSend);
          setConfirmed(false);
          setNotice('Another session agenda send is unresolved. Review and retry that same agenda before creating or sending another one.');
        }
        throw new Error(body.error);
      }
      if (!response.ok && body.code === 'agenda_operation_stale') {
        if (sequence.current === currentSequence) {
          setPendingSend(null);
          setForm({
            to: attendeeEmails(session),
            cc: '',
            subject: defaultSubject(session),
            bodyText: DEFAULT_MESSAGE,
          });
          setPreview(null);
          setConfirmed(false);
          setNotice('The session schedule changed after this preview. Create a new preview, review it, and then send.');
        }
        return;
      }
      if (!response.ok && body.code === 'agenda_send_terminal') {
        if (sequence.current === currentSequence) {
          setPendingSend(null);
          setForm({
            to: attendeeEmails(session),
            cc: '',
            subject: defaultSubject(session),
            bodyText: DEFAULT_MESSAGE,
          });
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
        }
      }
      if (!response.ok || body.error) throw new Error(body.error || 'The agenda could not be sent.');
      if (sequence.current !== currentSequence) return;
      setPreview(body.agenda || preview);
      setLastAgenda(body.agenda || null);
      setPendingSend(null);
      setChanged(false);
      setConfirmed(false);
      setNotice(null);
    } catch (sendFailure) {
      if (sendFailure?.name !== 'AbortError' && sequence.current === currentSequence) {
        setError(`${sendFailure.message} Please try again. If the problem continues, contact an administrator.`);
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
        {loadError && <p role="alert" className="mt-2 text-sm text-red-700">{loadError} Please try again. If the problem continues, contact an administrator.</p>}
        <button
          type="button"
          onClick={openComposer}
          className={`mt-4 rounded-lg px-4 py-2 text-sm font-semibold ${lastAgenda?.sentAt ? 'border border-gray-300 bg-white text-gray-900' : 'bg-gray-900 text-white'}`}
        >
          {pendingSend?.operationId ? 'Review unresolved send…' : lastAgenda?.sentAt ? 'Send agenda again…' : 'Send agenda…'}
        </button>
      </section>

      {composerOpen && (
        <ComposerDialog busy={Boolean(busy)} directoryOpen={directoryTarget !== null} onClose={closeComposer}>
          {error && <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
          {!recoveringPending && <div className="mt-5 grid gap-4 md:grid-cols-2">
            {[['to', 'To'], ['cc', 'Cc']].map(([field, label]) => (
              <div key={field}>
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor={`agenda-${field}`} className="text-sm font-medium text-gray-800">{label}</label>
                  <button type="button" onClick={() => setDirectoryTarget(field)} disabled={Boolean(busy)} className="text-xs font-medium text-blue-700 disabled:opacity-50">Add from directory</button>
                </div>
                <textarea id={`agenda-${field}`} rows={2} value={form[field]} onChange={(event) => edit({ [field]: event.target.value })} disabled={Boolean(busy)} placeholder={field === 'cc' ? 'Optional' : 'One or more addresses'} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              </div>
            ))}
          </div>}
          {!recoveringPending && (
            <>
              <label htmlFor="agenda-subject" className="mt-4 block text-sm font-medium text-gray-800">Subject</label>
              <input id="agenda-subject" value={form.subject} onChange={(event) => edit({ subject: event.target.value })} disabled={Boolean(busy)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <label htmlFor="agenda-message" className="mt-4 block text-sm font-medium text-gray-800">Message</label>
              <textarea id="agenda-message" rows={4} value={form.bodyText} onChange={(event) => edit({ bodyText: event.target.value })} disabled={Boolean(busy)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </>
          )}

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
                  <p className="mt-4 text-sm font-medium text-green-800">Sent — Dynamics accepted this exact email for transport. This receipt does not assert inbox delivery.</p>
                ) : (
                  <>
                    <label className="mt-4 flex items-start gap-2 text-sm text-gray-800">
                      <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={Boolean(busy)} className="mt-0.5" />
                      I reviewed the recipients, message, and agenda shown above.
                    </label>
                    <button type="button" onClick={send} disabled={!confirmed || Boolean(busy)} className="mt-3 rounded-lg bg-blue-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy === 'send' ? 'Sending…' : 'Send agenda'}</button>
                  </>
                )}
              </>
            ) : (
              <p className="mt-2 text-sm text-gray-600">Create a fixed preview to review the exact recipients, message, and proposal times.</p>
            )}
          </div>
          {notice && <div role="status" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{notice}</div>}
          {!preview && <button type="button" onClick={prepare} disabled={Boolean(busy) || !form.to.trim() || !form.subject.trim() || !form.bodyText.trim()} className="mt-4 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy === 'prepare' ? 'Creating preview…' : 'Create preview'}</button>}
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

export const _internal = { appendEmail, attendeeEmails, defaultSubject, scheduleKey };
