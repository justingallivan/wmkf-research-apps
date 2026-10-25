/** Own-user deadline defaults. Save/Clear never replaces the open one-send draft. */
import { useEffect, useRef, useState } from 'react';
import { requestEnvelope } from '../../utils/api-request';

const PLACEHOLDERS = '{{greeting}}, {{reviewerName}}, {{proposalTitle}}, {{reviewDueDate}}, {{signature}} (all optional)';

function validationMessage(errors = []) {
  if (errors.includes('subject')) return 'Enter a one-line subject of 500 characters or fewer.';
  if (errors.includes('body')) return 'Enter a message of 12,000 characters or fewer.';
  if (errors.includes('link')) return 'Remove web links; the email must not contain them.';
  const unknown = errors.find((e) => e.startsWith('unknown:'));
  if (unknown) {
    const [, field, token] = unknown.split(':');
    return field === 'subject'
      ? `Only {{proposalTitle}} is available in the subject (found {{${token}}}).`
      : `{{${token}}} is not an available placeholder. Use ${PLACEHOLDERS}.`;
  }
  if (errors.some((e) => e.startsWith('malformed:'))) return 'A placeholder is missing a brace. Use the form {{name}}.';
  return 'The wording could not be saved. Check the subject and message.';
}

export default function DeadlineWordingDefault({ disabled = false, onBusyChange }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);

  const [configured, setConfigured] = useState(false);
  const [shared, setShared] = useState(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const generationRef = useRef(0);

  // Read the parent's callbacks at completion time, never the ones captured
  // when Save was clicked (Codex build review, 2026-10-22).

  const onBusyChangeRef = useRef(onBusyChange);
  useEffect(() => {

    onBusyChangeRef.current = onBusyChange;
  });
  useEffect(() => () => {
    generationRef.current += 1;
    // Never leave the parent locked if this section unmounts mid-save.
    onBusyChangeRef.current?.(false);
  }, []);

  const loadOwn = () => {
    if (loaded || loading) return;
    const generation = ++generationRef.current;
    setLoading(true);
    setMessage(null);
    requestEnvelope('/api/review-manager/deadline-email-preferences', { tolerantBody: true })
      .then((envelope) => {
        if (generation !== generationRef.current) return;
        const data = envelope.data || {};
        if (envelope.ok) {

          setConfigured(data.configured === true);
          setShared(data.shared || null);
          setSubject(data.template?.subject || '');
          setBody(data.template?.body || '');
          setLoaded(true);
          if (data.sharedUnavailable) setMessage('Shared wording is unavailable. You can save or clear your default; deadline emails remain blocked until an administrator repairs the shared wording.');
        } else if (data.reason === 'preference_invalid' && data.ownSystemId) {

          setConfigured(true);
          setShared(data.shared);
          setSubject(data.shared?.subject || '');
          setBody(data.shared?.body || '');
          setLoaded(true);
          setMessage(data.sharedUnavailable ? 'Your saved wording needs correction and shared wording is unavailable. You can replace or clear your default here; an administrator must repair shared wording before deadline emails can be sent.' : 'Your saved wording needs correction. Replace it below and save, or clear it.');
        } else {
          setMessage('Your default wording could not be loaded. Close this section and try again.');
        }
      })
      .catch(() => { if (generation === generationRef.current) setMessage('Your default wording could not be loaded. Close this section and try again.'); })
      .finally(() => { if (generation === generationRef.current) setLoading(false); });
  };


  const write = async (method) => {
    if (busy || disabled || !loaded) return;
    const generation = ++generationRef.current;
    setBusy(true);
    onBusyChangeRef.current?.(true);
    setMessage(null);
    try {
      const envelope = await requestEnvelope('/api/review-manager/deadline-email-preferences', {
        method,
        body: method === 'PUT' ? { template: { subject, body } } : {},
        tolerantBody: true,
      });
      if (generation !== generationRef.current) return;
      const data = envelope.data || {};
      if (!envelope.ok) {
        setMessage(data.reason === 'validation' ? validationMessage(data.errors) : 'The change could not be confirmed. Reload before trying again.');
        return;
      }
      if (method === 'PUT') {
        setConfigured(true);
        setMessage('Saved as your default wording.');
      } else {
        setConfigured(false);
        // Show the shared copy the next preview will start from.
        setSubject(shared?.subject || '');
        setBody(shared?.body || '');
        setMessage('Your default wording was cleared; new emails start from the shared Admin wording.');
      }

    } catch {
      if (generation === generationRef.current) setMessage('The change could not be confirmed. Reload before trying again.');
    } finally {
      if (generation === generationRef.current) {
        setBusy(false);
        onBusyChangeRef.current?.(false);
      }
    }
  };

  return (
    <details className="rounded-md border border-gray-200" open={open} onToggle={(event) => {
      const isOpen = event.currentTarget.open;
      setOpen(isOpen);
      if (isOpen) loadOwn();
    }}>
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-gray-800">Your default wording</summary>
      <div className="space-y-2 border-t border-gray-200 p-3">
        {loading && <p className="text-sm text-gray-500">Loading your default wording…</p>}
        {loaded && (
          <>
            <p className="text-xs text-gray-600">
              Used for future deadline emails. The body may be empty. Placeholders: {PLACEHOLDERS}. Edits to the email above are not saved here.
            </p>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Subject</span>
              <input value={subject} onChange={(event) => setSubject(event.target.value)} disabled={busy || disabled} className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm" />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Message</span>
              <textarea rows={8} value={body} onChange={(event) => setBody(event.target.value)} disabled={busy || disabled} className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm" />
            </label>
            <div className="flex justify-end gap-2">
              {configured && (
                <button type="button" onClick={() => write('DELETE')} disabled={busy || disabled} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 disabled:opacity-40">Clear my default</button>
              )}
              <button type="button" onClick={() => write('PUT')} disabled={busy || disabled || !subject.trim()} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-50 disabled:opacity-40">{busy ? 'Saving…' : 'Save as my default'}</button>
            </div>
          </>
        )}
        {message && <p className="text-sm text-gray-700" role="status">{message}</p>}
      </div>
    </details>
  );
}
