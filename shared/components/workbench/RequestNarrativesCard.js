import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { requestJson } from '../../utils/api-request';
import { REQUEST_NARRATIVE_FIELDS, REQUEST_NARRATIVE_MAX_LENGTH } from '../../config/requestNarratives';
import { Button, Card } from '../Layout';

const textValues = data => Object.fromEntries(Object.keys(REQUEST_NARRATIVE_FIELDS).map(key => [key, data[key] ?? '']));

// The keyed editor also fences state before effects run on request navigation.
export default function RequestNarrativesCard({ requestId }) {
  return requestId ? <NarrativeEditor key={requestId} requestId={requestId} /> : null;
}

function NarrativeEditor({ requestId }) {
  const router = useRouter();
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [needsReload, setNeedsReload] = useState(false);
  const generation = useRef(0);
  const pending = useRef(false);
  const url = `/api/workbench/request-narratives?requestId=${encodeURIComponent(requestId)}`;

  useEffect(() => {
    const token = ++generation.current;
    requestJson(url).then(data => {
      if (token !== generation.current) return;
      setSaved(data); setDraft(textValues(data));
    }).catch(failure => {
      if (token === generation.current) setError(failure.message);
    });
    return () => { generation.current += 1; };
  }, [url]);

  const dirty = saved && draft && Object.keys(REQUEST_NARRATIVE_FIELDS).some(key => draft[key] !== (saved[key] ?? ''));
  useEffect(() => {
    if (!dirty) return undefined;
    let approvedDestination = null;
    const clearApproval = () => { approvedDestination = null; };
    const allow = url => {
      const destination = new URL(url, window.location.href).href;
      if (approvedDestination === destination) return true;
      if (!window.confirm('Discard your unsaved request text?')) return false;
      approvedDestination = destination;
      return true;
    };
    const warn = event => { event.preventDefault(); event.returnValue = ''; };
    const beforeRoute = (url, options) => {
      if (allow(url)) return;
      const failure = Object.assign(new Error('Unsaved request text'), { cancelled: true });
      router.events.emit('routeChangeError', failure, url, options);
      throw failure;
    };
    const previousState = window.history.state;
    const previousUrl = window.location.href;
    router.beforePopState(({ as }) => {
      clearApproval();
      if (allow(as)) return true;
      window.history.pushState(previousState, '', previousUrl);
      return false;
    });
    window.addEventListener('beforeunload', warn);
    router.events.on('routeChangeStart', beforeRoute);
    router.events.on('routeChangeComplete', clearApproval);
    router.events.on('routeChangeError', clearApproval);
    return () => {
      window.removeEventListener('beforeunload', warn);
      router.events.off('routeChangeStart', beforeRoute);
      router.events.off('routeChangeComplete', clearApproval);
      router.events.off('routeChangeError', clearApproval);
      router.beforePopState(() => true);
    };
  }, [dirty, router]);

  async function reload() {
    if (pending.current) return;
    if (dirty && !window.confirm('Discard your unsaved draft and reload the saved text?')) return;
    pending.current = true; setBusy(true);
    const token = ++generation.current;
    try {
      const data = await requestJson(url);
      if (token !== generation.current) return;
      setSaved(data); setDraft(textValues(data)); setError(''); setNotice(''); setNeedsReload(false);
    } catch (failure) {
      if (token === generation.current) setError(failure.message);
    } finally {
      if (token === generation.current) { pending.current = false; setBusy(false); }
    }
  }

  async function save(event) {
    event.preventDefault();
    if (pending.current || !dirty || !saved?.canEdit || !saved.version || needsReload) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    const token = ++generation.current;
    const changes = Object.fromEntries(Object.keys(REQUEST_NARRATIVE_FIELDS)
      .filter(key => draft[key] !== (saved[key] ?? '')).map(key => [key, draft[key]]));
    try {
      await requestJson('/api/workbench/request-narratives', {
        method: 'PATCH', body: { requestId, version: saved.version, changes },
      });
      if (token !== generation.current) return;
      setNotice('Saved.'); setNeedsReload(true);
      // Explicit reload after successful save, never polling over an active draft.
      try {
        const data = await requestJson(url);
        if (token !== generation.current) return;
        setSaved(data); setDraft(textValues(data)); setNeedsReload(false);
      } catch {
        if (token === generation.current) setError('Saved, but the latest text could not be reloaded. Reload before editing again.');
      }
    } catch (failure) {
      if (token !== generation.current) return;
      setError(failure.message); setNeedsReload(true);
    } finally {
      if (token === generation.current) { pending.current = false; setBusy(false); }
    }
  }

  return (
    <Card hover={false}>
      <h2 className="text-base font-semibold text-gray-900">Executive Summary</h2>
      <p className="mt-1 text-sm text-gray-600">Staff changes are saved only when you choose Save.</p>
      {!draft && !error && <p role="status">Loading request text…</p>}
      {draft && <form onSubmit={save} className="mt-4 space-y-4">
        {Object.entries(REQUEST_NARRATIVE_FIELDS).map(([key, field]) => <div key={key}>
          <label htmlFor={`request-${key}`} className="block text-sm font-medium text-gray-900">{field.label}</label>
          {saved.canEdit ? <textarea
            id={`request-${key}`} rows={8} maxLength={REQUEST_NARRATIVE_MAX_LENGTH}
            value={draft[key]} disabled={busy} readOnly={needsReload}
            onChange={event => { setDraft(current => ({ ...current, [key]: event.target.value })); setNotice(''); }}
            className="mt-1 w-full rounded-lg border border-gray-300 p-3 text-sm"
          /> : <p id={`request-${key}`} className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{draft[key] || 'Not yet provided.'}</p>}
        </div>)}
        {saved.canEdit && <Button type="submit" loading={busy} disabled={!dirty || !saved.version || needsReload || busy}>Save request text</Button>}
        {dirty && <p className="text-sm text-gray-600">Unsaved changes</p>}
      </form>}
      <div className="mt-3"><Button type="button" variant="secondary" disabled={busy} onClick={reload}>Reload saved text</Button></div>
      {notice && <p role="status" className="mt-2 text-sm text-gray-700">{notice}</p>}
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    </Card>
  );
}
