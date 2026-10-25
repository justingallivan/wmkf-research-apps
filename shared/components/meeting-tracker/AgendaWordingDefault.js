/** Independent raw default editor. Writes never replace the one-send form. */
import { useEffect, useRef, useState } from 'react';
import { requestEnvelope } from '../../utils/api-request';
import { Button } from '../Layout';
import { validateAgendaTemplate } from '../../config/agendaEmail';
export default function AgendaWordingDefault({ disabled, onBusyChange, onChanged }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [template, setTemplate] = useState({ subject: '', body: '' });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const generation = useRef(0);
  const controller = useRef(null);
  const callbacks = useRef({ onBusyChange, onChanged });
  useEffect(() => { callbacks.current = { onBusyChange, onChanged }; });
  useEffect(() => () => { generation.current += 1; controller.current?.abort(); callbacks.current.onBusyChange?.(false); }, []);
  const load = async () => {
    if (data || loading) return;
    const current = ++generation.current;
    const abort = new AbortController(); controller.current = abort; setLoading(true);
    try {
      const result = await requestEnvelope('/api/meeting-tracker/agenda-email-preferences', { signal: abort.signal, tolerantBody: true });
      if (generation.current !== current) return;
      if (!result.data?.defaults) { setMessage('Your default wording could not be loaded. Close and reopen this section to try again.'); return; }
      setData(result.data); setTemplate(result.data.template || { subject: '', body: '' });
      if (!result.ok) setMessage('Your saved wording could not be loaded. You can replace or clear it here.');
    } catch { if (generation.current === current) setMessage('Your default wording could not be loaded. Try again.'); }
    finally { if (generation.current === current) setLoading(false); }
  };
  const write = async (method) => {
    if (busy || disabled || !data) return;
    const current = ++generation.current;
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    setBusy(true); callbacks.current.onBusyChange?.(true); setMessage('');
    try {
      const result = await requestEnvelope('/api/meeting-tracker/agenda-email-preferences', { method, body: method === 'PUT' ? { template } : {}, signal: abort.signal, tolerantBody: true });
      if (generation.current !== current) return;
      if (!result.ok) { setMessage(result.data?.reason === 'validation' ? 'Check the subject, opening length and optional {{sessionDate}} placeholders.' : 'The change could not be confirmed. Reload before trying again.'); return; }
      setData(result.data); setTemplate(result.data.template || { subject: '', body: '' });
      callbacks.current.onChanged?.(result.data.defaults);
      setMessage(method === 'PUT' ? 'Saved as your default wording. The current email is unchanged.' : 'Your default was cleared. Future emails use shared wording; the current email is unchanged.');
    } catch { if (generation.current === current) setMessage('The change could not be confirmed. Reload before trying again.'); }
    finally { if (generation.current === current) { setBusy(false); callbacks.current.onBusyChange?.(false); } }
  };
  return <details className="mt-4 rounded-lg border border-gray-200" open={open} onToggle={(event) => { setOpen(event.currentTarget.open); if (event.currentTarget.open) void load(); }}>
    <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-gray-800">Your default wording</summary>
    <div className="space-y-3 border-t border-gray-200 p-3">
      <p className="text-sm text-gray-600">Used for future agenda emails. Edits to the email above are not saved here. Optional placeholder: {'{{sessionDate}}'}.</p>
      {loading && <p role="status">Loading your default wording…</p>}
      {data && <>
        <label className="block text-sm">Default subject<input className="mt-1 w-full rounded-lg border border-gray-300 p-2" value={template.subject} onChange={(e) => setTemplate({ ...template, subject: e.target.value })} disabled={busy || disabled} /></label>
        <label className="block text-sm">Default opening message (optional)<textarea rows={4} className="mt-1 w-full rounded-lg border border-gray-300 p-2" value={template.body} onChange={(e) => setTemplate({ ...template, body: e.target.value })} disabled={busy || disabled} /></label>
        <div className="flex flex-wrap justify-end gap-3">
          {data.configured && <Button type="button" size="sm" variant="link" onClick={() => void write('DELETE')} disabled={busy || disabled}>Clear my default</Button>}
          <Button type="button" size="sm" variant="outline" onClick={() => void write('PUT')} disabled={busy || disabled || !validateAgendaTemplate(template).valid}>{busy ? 'Saving…' : 'Save as my default'}</Button>
        </div>
      </>}
      {message && <p role="status" className="text-sm text-gray-700">{message}</p>}
    </div>
  </details>;
}
