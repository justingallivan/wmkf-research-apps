/**
 * Cycle calendar (D43): pick a cycle, see its milestone dates and who last
 * changed each one; editors change one date at a time with the browser's date
 * picker. Shown on /cycle-calendar for staff and in Admin → Workflows for
 * superusers; both call /api/cycle-calendar, which decides who may edit.
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { Button } from '../Layout';
import { requestEnvelope } from '../../utils/api-request';

/** Re-checks after a save, until Dataverse makes the new audit entry readable. */
const ATTRIBUTION_RECHECK_MS = [2000, 4000, 8000];

function attributed(data, code, column, value) {
  const entry = data?.cycles?.find(c => c.code === code)?.dates?.find(d => d.column === column);
  return Boolean(entry && entry.changedBy && entry.value === value);
}

const inputClass = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-gray-50';

function formatDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return 'Not set';
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
    .format(new Date(`${value}T00:00:00Z`));
}

function formatWhen(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', year: 'numeric' }).format(parsed);
}

async function request(body, signal) {
  const result = await requestEnvelope('/api/cycle-calendar', { signal, ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  if (!result.ok) {
    const error = new Error(result.data?.error || 'The cycle calendar is unavailable. Try reloading.');
    error.code = result.data?.code;
    throw error;
  }
  return result.data;
}

function DateRow({ entry, cycle, canEdit, savingAvailable, busy, recording, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.value || '');
  const [message, setMessage] = useState(null);
  const saving = busy === entry.column;

  async function save(value) {
    setMessage(null);
    const outcome = await onSave(entry.column, value);
    if (outcome.ok) { setEditing(false); setMessage({ text: value ? 'Date saved.' : 'Date cleared.', success: true }); }
    else setMessage({ text: outcome.error, success: false });
  }

  const attribution = entry.changedBy
    ? `Changed by ${entry.changedBy}${entry.changedAt ? `, ${formatWhen(entry.changedAt)}` : ''}`
    : null;
  const labelId = `cycle-date-${cycle.code}-${entry.column}`;
  return <li className="py-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p id={labelId} className="font-medium text-gray-900">{entry.label}</p>
        <p className={entry.value ? 'text-gray-800' : 'text-gray-500'}>{formatDate(entry.value)}</p>
        {attribution && !recording && <p className="text-sm text-gray-600">{attribution}</p>}
        {recording && <p role="status" className="text-sm text-gray-500">Recording who made this change…</p>}
      </div>
      {canEdit && !editing && <Button variant="outline" disabled={Boolean(busy) || !savingAvailable} onClick={() => { setMessage(null); setDraft(entry.value || ''); setEditing(true); }}>Edit<span className="sr-only"> {entry.label}</span></Button>}
    </div>
    {editing && <div className="mt-3 max-w-sm rounded-lg border border-gray-200 bg-gray-50 p-3">
      <label className="block text-sm font-medium text-gray-700">{entry.label}
        <input type="date" className={inputClass} value={draft} disabled={saving} onChange={event => setDraft(event.target.value)} />
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button disabled={saving || !draft || draft === entry.value} onClick={() => save(draft)}>Save</Button>
        <Button variant="outline" disabled={saving} onClick={() => { setEditing(false); setMessage(null); }}>Cancel</Button>
        {entry.value && <Button variant="link" disabled={saving} onClick={() => save(null)}>Clear date</Button>}
      </div>
      {saving && <p role="status" className="mt-2 text-sm">Saving…</p>}
    </div>}
    {message && <p role={message.success ? 'status' : 'alert'} className={`mt-2 text-sm ${message.success ? 'text-green-800' : 'text-red-800'}`}>{message.text}</p>}
  </li>;
}

export default function CycleCalendarPanel() {
  const [data, setData] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(''), [reload, setReload] = useState(0), [busy, setBusy] = useState(null);
  const [pending, setPending] = useState(null);
  const generation = useRef(0);
  // Bumped on every data replacement so a slow re-check cannot overwrite newer data.
  const dataStamp = useRef(0);
  const router = useRouter();
  const urlCycle = typeof router?.query?.cycle === 'string' && /^[JD]\d{2}$/.test(router.query.cycle) ? router.query.cycle : '';

  useEffect(() => {
    const controller = new AbortController(), current = ++generation.current;
    request(null, controller.signal)
      .then(value => {
        if (generation.current !== current) return;
        if (!Array.isArray(value?.cycles)) throw new Error('The cycle calendar is unavailable. Try reloading.');
        dataStamp.current += 1;
        setData(value);
      })
      .catch(e => { if (!controller.signal.aborted && generation.current === current) setError(e.message); })
      .finally(() => { if (generation.current === current) setLoading(false); });
    return () => { controller.abort(); generation.current += 1; };
  }, [reload]);

  // After a save, re-read until the saved date carries its "changed by" (audit entries
  // become readable a few seconds after the write). Gives up quietly after the last try.
  useEffect(() => {
    if (!pending) return undefined;
    const delay = ATTRIBUTION_RECHECK_MS[pending.attempt];
    if (delay === undefined) return undefined;
    const controller = new AbortController(), current = generation.current;
    const timer = setTimeout(() => {
      const stamp = dataStamp.current;
      request(null, controller.signal).then(value => {
        if (generation.current !== current || dataStamp.current !== stamp || !Array.isArray(value?.cycles)) return;
        dataStamp.current += 1;
        setData(value);
        setPending(old => (old !== pending ? old
          : attributed(value, pending.code, pending.column, pending.value) || pending.attempt + 1 >= ATTRIBUTION_RECHECK_MS.length ? null
            : { ...pending, attempt: pending.attempt + 1 }));
      }).catch(() => { if (!controller.signal.aborted) setPending(old => (old === pending ? null : old)); });
    }, delay);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [pending]);

  function reloadCalendar() { setLoading(true); setError(''); setPending(null); setReload(value => value + 1); }

  function chooseCycle(code) {
    setSelected(code);
    if (router?.replace) {
      router.replace({ pathname: router.pathname, query: { ...(router.query || {}), cycle: code } }, undefined, { shallow: true, scroll: false });
    }
  }

  async function saveDate(cycle, column, value) {
    if (busy) return { ok: false, error: 'Another date is saving.' };
    const current = generation.current;
    setBusy(column);
    try {
      const fresh = await request({ cycleCode: cycle.code, column, value, etag: cycle.etag });
      if (current === generation.current) {
        dataStamp.current += 1;
        setData(fresh);
        setPending(attributed(fresh, cycle.code, column, value) ? null : { code: cycle.code, column, value, attempt: 0 });
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    } finally {
      if (current === generation.current) setBusy(null);
    }
  }

  if (loading && !data) return <p role="status" className="rounded-lg bg-gray-100 p-6">Loading the cycle calendar…</p>;
  if (error) return <div role="alert" className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-4 text-red-900"><p>{error}</p><Button variant="outline" onClick={reloadCalendar}>Reload calendar</Button></div>;
  if (!data) return null;
  if (!data.cycles.length) return <p className="rounded-lg bg-gray-100 p-6">No upcoming grant cycles were found. Cycles appear here once operations creates them.</p>;

  // An explicit choice wins, then the URL (?cycle=, kept across reloads), then the server default.
  const cycle = [selected, urlCycle, data.defaultCycleCode].map(code => data.cycles.find(candidate => candidate.code === code)).find(Boolean) || data.cycles[0];
  return <section aria-labelledby="cycle-calendar-heading" className="rounded-xl border border-gray-200 bg-white p-6">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h2 id="cycle-calendar-heading" className="text-lg font-semibold">Milestone dates</h2>
        <p className="mt-1 max-w-2xl text-gray-600">{data.canEdit ? 'Each change saves to Dynamics immediately. The Grants Manager, the Program Coordinator and system administrators can edit dates.' : 'Dates are maintained by the Grants Manager and the Program Coordinator.'}</p>
      </div>
      <label className="block text-sm font-medium text-gray-700">Grant cycle
        <select className="mt-1 block min-h-11 rounded-lg border border-gray-300 bg-white px-3 py-2" value={cycle.code} disabled={Boolean(busy)} onChange={event => chooseCycle(event.target.value)}>
          {data.cycles.map(option => <option key={option.code} value={option.code}>{option.name} ({option.code})</option>)}
        </select>
      </label>
    </div>
    {data.canEdit && !data.savingAvailable && <p role="alert" className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Saving is unavailable because changes could not be attributed to you. Ask an administrator to check the Dynamics identity settings.</p>}
    {!cycle.historyAvailable && <p className="mt-4 text-sm text-gray-600">Who changed each date is not available right now.{cycle.rowModifiedAt ? ` Last change to this cycle (any date): ${formatWhen(cycle.rowModifiedAt)}${cycle.rowModifiedBy ? ` by ${cycle.rowModifiedBy}` : ''}.` : ''}</p>}
    <div className="mt-4 rounded-lg bg-gray-50 p-3 text-sm text-gray-700"><span className="font-medium">{cycle.board.label}:</span> {formatDate(cycle.board.value)} <span className="text-gray-500">(set by operations)</span></div>
    <ul className="mt-2 divide-y divide-gray-100">
      {cycle.dates.map(entry => <DateRow key={`${cycle.code}-${entry.column}`} entry={entry} cycle={cycle} canEdit={data.canEdit} savingAvailable={data.savingAvailable} busy={busy} recording={pending?.code === cycle.code && pending?.column === entry.column} onSave={(column, value) => saveDate(cycle, column, value)} />)}
    </ul>
    <div className="mt-4"><Button variant="link" disabled={Boolean(busy)} onClick={reloadCalendar}>Reload calendar</Button></div>
  </section>;
}
