import { useEffect, useRef, useState } from 'react';
import { requestEnvelope } from '../../utils/api-request';

const SETTINGS_API = '/api/admin/proposal-ranking-facilitator';

function settingsError(data, status) {
  const error = new Error(data?.error?.message || data?.error || data?.message || `Could not load the default facilitator (${status}).`);
  error.status = status;
  return error;
}

export default function DefaultFacilitatorSettings({ isSuperuser }) {
  const [settings, setSettings] = useState(null);
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const generationRef = useRef(0);

  useEffect(() => {
    if (!isSuperuser) return undefined;
    const generation = ++generationRef.current;
    let active = true;
    (async () => {
      try {
        const { ok, status, data } = await requestEnvelope(SETTINGS_API);
        if (!active || generation !== generationRef.current) return;
        if (!ok) throw settingsError(data, status);
        setSettings(data);
        setSelectedId(data.systemUserId || '');
        setError(null);
      } catch (err) {
        if (active && generation === generationRef.current) setError(err.message);
      }
    })();
    return () => { active = false; generationRef.current += 1; };
  }, [isSuperuser]);

  if (!isSuperuser) return null;

  const save = async (event) => {
    event.preventDefault();
    if (!settings || !selectedId || busy) return;
    const generation = generationRef.current;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { ok, status, data } = await requestEnvelope(SETTINGS_API, {
        method: 'PUT',
        body: { systemUserId: selectedId, revision: settings.revision },
      });
      if (!ok) throw settingsError(data, status);
      if (generation !== generationRef.current) return;
      setSettings(data);
      setSelectedId(data.systemUserId || '');
      setNotice('Default facilitator saved.');
    } catch (err) {
      if (generation === generationRef.current && err.status === 409) {
        try {
          const refreshed = await requestEnvelope(SETTINGS_API);
          if (generation !== generationRef.current) return;
          if (refreshed.ok) setSettings(refreshed.data);
          setError('The facilitator setting changed elsewhere. The current staff list is refreshed; review your selection and save again.');
        } catch {
          if (generation === generationRef.current) setError('The facilitator setting changed elsewhere, but the current value could not be refreshed. Reload this section before saving again.');
        }
      } else if (generation === generationRef.current) {
        setError(err.message);
      }
    } finally {
      if (generation === generationRef.current) setBusy(false);
    }
  };

  return <section aria-labelledby="proposal-ranking-default-facilitator" className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
    <h2 id="proposal-ranking-default-facilitator" className="text-base font-semibold text-gray-900">Proposal Ranking default facilitator</h2>
    <p className="mt-1 text-sm text-gray-600">Choose an active staff member. The selected person can preview and open a ranking round for a funding cycle.</p>
    {error && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">{error}</p>}
    {notice && <p role="status" className="mt-3 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-900">{notice}</p>}
    {!settings && !error && <p role="status" className="mt-3 text-sm text-gray-600">Loading active staff…</p>}
    {settings && <form onSubmit={save} className="mt-4 flex flex-wrap items-end gap-3">
      <label htmlFor="proposal-ranking-default-facilitator-select" className="min-w-64 flex-1 text-sm font-medium text-gray-700">
        Active staff member
        <select id="proposal-ranking-default-facilitator-select" value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setNotice(null); }} required disabled={busy} className="mt-1 h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-300 disabled:opacity-50">
          <option value="" disabled>Select a staff member</option>
          {settings.eligibleStaff.map((person) => <option key={person.systemUserId} value={person.systemUserId}>{person.name}</option>)}
        </select>
      </label>
      <button type="submit" disabled={busy || !selectedId || selectedId === settings.systemUserId} className="inline-flex h-10 items-center rounded-lg bg-gray-900 px-4 text-sm font-semibold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50">{busy ? 'Saving…' : 'Save facilitator'}</button>
      {!settings.configured && <p className="basis-full text-sm text-amber-800">No default facilitator is configured. Preview and opening are blocked until one is selected.</p>}
      {settings.name && settings.systemUserId && <p className="basis-full text-xs text-gray-500">Current facilitator: {settings.name}</p>}
    </form>}
  </section>;
}
