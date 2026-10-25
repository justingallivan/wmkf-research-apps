import ProfileContext from '../context/ProfileContext';
/** Independent future-default editor. No callback may rebase the open email. */
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Button } from './Layout';
import { requestEnvelope } from '../utils/api-request';

function WordingEditor({ load, write, scopeKey, disabled = false, hint, onBusyChange, initialOpen = false }) {
  const [open, setOpen] = useState(initialOpen);
  const [state, setState] = useState(null);
  const [template, setTemplate] = useState({ subject: '', body: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const generation = useRef(0);
  const callbacks = useRef({ load, write, onBusyChange });
  useEffect(() => { callbacks.current = { load, write, onBusyChange }; });
  useEffect(() => () => { generation.current++; callbacks.current.onBusyChange?.(false); }, [scopeKey]);
  const read = async () => {
    const seq = ++generation.current;
    setBusy(true); setMessage(null);
    try {
      const next = await callbacks.current.load();
      if (seq !== generation.current) return;
      if (state && JSON.stringify(template) !== JSON.stringify(state.template) && !window.confirm('Replace your unsaved default wording with the reloaded wording?')) return;
      setState(next); setTemplate(next.template || { subject: '', body: '' });
      setMessage(next.notice || null);
    } catch { if (seq === generation.current) setMessage('Your default wording could not be loaded. Retry to try again.'); }
    finally { if (seq === generation.current) setBusy(false); }
  };
  useEffect(() => { if (initialOpen) read(); }, []); // Initial mount only; scope/actor changes remount the editor.
  const save = async (clear) => {
    if (busy || disabled || !state?.canWrite) return;
    const seq = ++generation.current;
    setBusy(true); callbacks.current.onBusyChange?.(true); setMessage(null);
    try {
      const changedFields = ['subject', 'body'].filter((field) => template[field] !== state.template?.[field]);
      const result = await callbacks.current.write({ template, changedFields, clear });
      if (seq !== generation.current) return;
      if (!result.ok) { setMessage(result.message || 'The change could not be confirmed. Retry to reload before trying again.'); return; }
      setState((prev) => ({ ...prev, configured: !clear, template: clear ? prev.shared : template }));
      if (clear) setTemplate(state.shared || { subject: '', body: '' });
      setMessage(clear ? 'Your default was cleared. The current email is unchanged.' : 'Saved for future emails. The current email is unchanged.');
    } catch { if (seq === generation.current) setMessage('The change could not be confirmed. Retry to reload before trying again.'); }
    finally { if (seq === generation.current) { setBusy(false); callbacks.current.onBusyChange?.(false); } }
  };
  return <details className="rounded-md border border-gray-200" open={open} onToggle={(event) => {
    setOpen(event.currentTarget.open); if (event.currentTarget.open && !state && !busy) read();
  }}>
    <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-gray-800">Your default wording</summary>
    <div className="space-y-3 border-t border-gray-200 p-3">
      <p className="text-xs text-gray-600">Used for future emails. Edits to the email above are not saved here. {hint}</p>
      {busy && <p role="status" className="text-sm text-gray-600">Working…</p>}
      {state && <>
        <label className="block text-sm">Default subject<input className="mt-1 w-full rounded border border-gray-300 p-2" value={template.subject} disabled={disabled || busy} onChange={(e) => setTemplate({ ...template, subject: e.target.value })} /></label>
        <label className="block text-sm">Default message<textarea className="mt-1 w-full rounded border border-gray-300 p-2" rows={7} value={template.body} disabled={disabled || busy} onChange={(e) => setTemplate({ ...template, body: e.target.value })} /></label>
        <div className="flex flex-wrap justify-end gap-2">
          {state.configured && <Button type="button" variant="link" size="sm" onClick={() => save(true)} disabled={disabled || busy || !state.canWrite}>Clear my default</Button>}
          <Button type="button" variant="outline" size="sm" onClick={() => save(false)} disabled={disabled || busy || !state.canWrite || !template.subject.trim()}>Save as my default</Button>
        </div>
      </>}
      {message && <p role="status" className="text-sm text-gray-700">{message}</p>}
      {(!state || !state.canWrite || message) && <Button type="button" variant="link" size="sm" disabled={disabled || busy} onClick={read}>Retry loading default wording</Button>}
    </div>
  </details>;
}

const EmptyProfileContext = createContext(null);
export default function EmailWordingDefault(props) {
  const profile = useContext(ProfileContext || EmptyProfileContext);
  return <WordingEditor key={`${props.scopeKey || ''}:${profile?.currentProfile?.id || ''}`} {...props} />;
}

export function EndpointWordingDefault({ endpoint, kind, formatError, ...props }) {
  const params = kind ? { kind } : {};
  return <EmailWordingDefault {...props} scopeKey={props.scopeKey || `${endpoint}:${kind || ''}`}
    load={async () => {
      const result = await requestEnvelope(endpoint + (kind ? `?kind=${encodeURIComponent(kind)}` : ''), { tolerantBody: true });
      const data = result.data || {};
      const repairable = data.reason === 'preference_invalid' && data.ownSystemId;
      return { template: data.template || data.shared, shared: data.shared, configured: data.configured || repairable,
        canWrite: result.ok || Boolean(repairable), notice: result.ok ? null : repairable ? 'Your saved wording needs correction. Replace or clear your default.' : 'Your default wording could not be loaded. Retry before changing it.' };
    }} write={async ({ template, clear }) => {
      const result = await requestEnvelope(endpoint, { method: clear ? 'DELETE' : 'PUT', body: clear ? params : { ...params, template }, tolerantBody: true });
      return { ok: result.ok && result.data?.ok === true, message: formatError?.(result.data) || result.data?.error };
    }} />;
}
