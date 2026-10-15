import { useEffect, useRef, useState } from 'react';
import { requestEnvelope } from '../../utils/api-request';

const SETTINGS_API = '/api/admin/proposal-ranking-facilitator';

function settingsError(data, status) {
  const error = new Error(data?.error?.message || data?.error || data?.message || `Could not load the default facilitator (${status}).`);
  error.status = status;
  return error;
}

export default function DefaultFacilitatorSettings() {
  const [isSuperuser, setIsSuperuser] = useState(false);
  const [authorizationChecked, setAuthorizationChecked] = useState(false);
  const [settings, setSettings] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const generationRef = useRef(0);

  useEffect(() => {
    let active = true;
    requestEnvelope('/api/app-access?all=true')
      .then(({ ok, data }) => {
        if (!active) return;
        setIsSuperuser(ok && data?.isSuperuser === true);
        setAuthorizationChecked(true);
      })
      .catch(() => {
        if (active) {
          setError('Could not verify administrator access. Reload this section to try again.');
          setAuthorizationChecked(true);
        }
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!authorizationChecked || !isSuperuser) return undefined;
    const generation = ++generationRef.current;
    let active = true;
    (async () => {
      try {
        const { ok, status, data } = await requestEnvelope(SETTINGS_API);
        if (!active || generation !== generationRef.current) return;
        if (!ok) throw settingsError(data, status);
        setSettings(data);
        setSelectedIds(data.facilitatorSystemUserIds || []);
        setError(null);
      } catch (err) {
        if (active && generation === generationRef.current) setError(err.message);
      }
    })();
    return () => { active = false; generationRef.current += 1; };
  }, [authorizationChecked, isSuperuser]);

  if (!isSuperuser) return null;

  const save = async (event) => {
    event.preventDefault();
    if (!settings || selectedIds.length < 1 || selectedIds.length > 2 || busy) return;
    const generation = generationRef.current;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { ok, status, data } = await requestEnvelope(SETTINGS_API, {
        method: 'PUT',
        body: { facilitatorSystemUserIds: selectedIds, revision: settings.revision },
      });
      if (!ok) throw settingsError(data, status);
      if (generation !== generationRef.current) return;
      setSettings(data);
      setSelectedIds(data.facilitatorSystemUserIds || []);
      setNotice('Default facilitators saved.');
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
    <h2 id="proposal-ranking-default-facilitator" className="text-base font-semibold text-gray-900">Proposal Ranking facilitators</h2>
    <p className="mt-1 text-sm text-gray-600">Choose one or two active staff members. Either selected person can preview and open future ranking rounds.</p>
    {error && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">{error}</p>}
    {notice && <p role="status" className="mt-3 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-900">{notice}</p>}
    {!settings && !error && <p role="status" className="mt-3 text-sm text-gray-600">Loading active staff…</p>}
    {settings && <form onSubmit={save} className="mt-4 flex flex-wrap items-end gap-3">
      <label htmlFor="proposal-ranking-default-facilitator-select" className="min-w-64 flex-1 text-sm font-medium text-gray-700">
        Active staff members (select up to two)
        <select id="proposal-ranking-default-facilitator-select" multiple size={Math.min(6, Math.max(3, settings.eligibleStaff.length))} value={selectedIds} onChange={(event) => { setSelectedIds(Array.from(event.target.selectedOptions, (option) => option.value)); setNotice(null); }} disabled={busy} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-300 disabled:opacity-50">
          {settings.eligibleStaff.map((person) => <option key={person.systemUserId} value={person.systemUserId}>{person.name}</option>)}
        </select>
      </label>
      <button type="submit" disabled={busy || selectedIds.length < 1 || selectedIds.length > 2 || (settings.configured && JSON.stringify([...selectedIds].sort()) === JSON.stringify([...settings.facilitatorSystemUserIds].sort()))} className="inline-flex h-10 items-center rounded-lg bg-gray-900 px-4 text-sm font-semibold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50">{busy ? 'Saving…' : 'Save facilitators'}</button>
      {selectedIds.length > 2 && <p className="basis-full text-sm text-amber-800">Select no more than two staff members.</p>}
      {!settings.configured && <p className="basis-full text-sm text-amber-800">No default facilitator is configured. Preview and opening are blocked until one is selected.</p>}
      {settings.configurationError && <p role="status" className="basis-full text-sm text-amber-800">The saved facilitator configuration needs repair. Choose one or two active staff members and save.</p>}
      {settings.facilitatorNames?.length > 0 && <p className="basis-full text-xs text-gray-500">Current facilitators: {settings.facilitatorNames.join(', ')}</p>}
    </form>}
  </section>;
}
