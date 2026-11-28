/**
 * Primary discipline (akoya_request.wmkf_programareaserved) on the phase-layout
 * Overview: the discipline in effect, Claude's intake pick when it differs, and
 * an editor any staff member can use (primary-discipline-service.js). Choosing
 * another discipline moves the proposal to that section of the proposal lists.
 */
import { useEffect, useRef, useState } from 'react';
import { Button } from '../Layout';
import { requestJson } from '../../utils/api-request';

const endpoint = '/api/workbench/primary-discipline';

export default function PrimaryDiscipline({ requestId, claudePrimary = null, claudeRunnerUp = null }) {
  return requestId
    ? <Editor key={requestId} requestId={requestId} claudePrimary={claudePrimary} claudeRunnerUp={claudeRunnerUp} />
    : null;
}

function Editor({ requestId, claudePrimary, claudeRunnerUp }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const generation = useRef(0);

  async function load() {
    const token = ++generation.current;
    setBusy(true);
    try {
      const data = await requestJson(`${endpoint}?requestId=${encodeURIComponent(requestId)}`);
      if (token !== generation.current) return;
      setState(data); setError('');
    } catch (failure) {
      if (token === generation.current) setError(failure.message);
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    load();
    return () => { generation.current += 1; };
    // Keyed by request; loads once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(event) {
    event.preventDefault();
    if (busy || !state?.version || !choice || choice === state.current?.id) return;
    const token = ++generation.current;
    setBusy(true); setError(''); setNotice('');
    try {
      await requestJson(endpoint, { method: 'PATCH', body: { requestId, version: state.version, disciplineId: choice } });
      if (token !== generation.current) return;
      setEditing(false); setNotice('Saved.');
      const data = await requestJson(`${endpoint}?requestId=${encodeURIComponent(requestId)}`);
      if (token !== generation.current) return;
      setState(data);
    } catch (failure) {
      if (token === generation.current) setError(failure.message);
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }

  const options = Array.isArray(state?.options) ? state.options : [];
  const current = state?.current || null;
  const byName = (name) => options.find((option) => option.name.toLowerCase() === String(name || '').toLowerCase());
  const suggested = [byName(claudePrimary), byName(claudeRunnerUp)]
    .filter((option, index, list) => option && option.id !== current?.id && list.findIndex((o) => o?.id === option.id) === index);
  const groups = options.reduce((map, option) => map.set(option.group, [...(map.get(option.group) || []), option]), new Map());
  const differs = claudePrimary && current?.name && current.name.toLowerCase() !== claudePrimary.toLowerCase();

  return (
    <div>
      <h3 className="text-xs uppercase tracking-wide text-gray-400 mb-1">Primary discipline</h3>
      {!state && !error && <p role="status" className="text-sm text-gray-500">Loading the primary discipline…</p>}
      {state && !editing && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm font-medium text-gray-900">{current?.name || 'Not set'}</p>
          {state.canEdit && <Button type="button" variant="secondary" size="sm" aria-label="Change primary discipline"
            onClick={() => { setChoice(current?.id || ''); setNotice(''); setEditing(true); }}>Change</Button>}
        </div>
      )}
      {state && !editing && differs && <p className="mt-1 text-xs text-gray-500">Claude suggested: {claudePrimary}</p>}
      {state && editing && (
        <form onSubmit={save} className="space-y-2">
          <label className="block text-sm font-medium text-gray-900" htmlFor={`primary-discipline-${requestId}`}>Primary discipline</label>
          <select id={`primary-discipline-${requestId}`} className="w-full max-w-md rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            value={choice} disabled={busy} onChange={(event) => setChoice(event.target.value)}>
            {!current && <option value="">Choose a discipline</option>}
            {suggested.length > 0 && (
              <optgroup label="Suggested by Claude">
                {suggested.map((option) => <option key={`s:${option.id}`} value={option.id}>{option.name}</option>)}
              </optgroup>
            )}
            {[...groups.entries()].map(([group, list]) => (
              <optgroup key={group} label={group}>
                {list.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
              </optgroup>
            ))}
          </select>
          <p className="text-xs text-gray-600">Saving moves this proposal to that discipline’s section of the proposal lists.</p>
          <div className="flex gap-2">
            <Button type="submit" size="sm" loading={busy} disabled={busy || !choice || choice === current?.id}>Save discipline</Button>
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => { setEditing(false); setError(''); }}>Cancel</Button>
          </div>
        </form>
      )}
      {notice && <p role="status" className="mt-1 text-sm text-gray-700">{notice}</p>}
      {error && (
        <div className="mt-1">
          <p role="alert" className="text-sm text-red-700">{error}</p>
          <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => { setEditing(false); load(); }}>Reload</Button>
        </div>
      )}
    </div>
  );
}
