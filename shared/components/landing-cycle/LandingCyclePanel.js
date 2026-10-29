/**
 * Landing cycle control (D29, D45; docs/plans/LANDING_CYCLE_PLAN_2026-10-29.md):
 * shows the cycle every app opens on — automatic (the cycle with the next Board
 * meeting) unless overridden — and who last changed it; calendar editors choose
 * a cycle or "Automatic". Shown above the cycle calendar on
 * /cycle-calendar and in Admin → Workflows; /api/landing-cycle decides who may edit.
 */
import { useEffect, useRef, useState } from 'react';
import { Button } from '../Layout';
import { requestEnvelope } from '../../utils/api-request';

const selectClass = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-gray-50';

function formatWhen(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', year: 'numeric' }).format(parsed);
}

function formatDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
    .format(new Date(`${value}T00:00:00Z`));
}

async function request(body, signal) {
  const result = await requestEnvelope(body ? '/api/landing-cycle' : '/api/landing-cycle?view=editor', {
    signal,
    ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  if (!result.ok) {
    const error = new Error(result.data?.error || 'The landing cycle is unavailable. Try reloading.');
    error.code = result.data?.code;
    throw error;
  }
  return result.data;
}

function cycleLabel(data, code) {
  const cycle = data.cycles.find(candidate => candidate.code === code);
  return cycle && cycle.name !== code ? `${code} · ${cycle.name}` : code;
}

export default function LandingCyclePanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [editRevision, setEditRevision] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [reload, setReload] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    request(null, controller.signal).then(
      next => { setData(next); setError(''); },
      loadError => { if (!controller.signal.aborted) setError(loadError.message); },
    );
    return () => controller.abort();
  }, [reload]);

  async function save(cycleCode) {
    setSaving(true);
    setMessage(null);
    try {
      const next = await request({ cycleCode, revision: editRevision });
      if (!mounted.current) return;
      setData(next);
      setEditing(false);
      setMessage({ text: cycleCode ? `Apps now open on ${cycleCode} where they can.` : 'Back to automatic: apps open on the cycle with the next Board meeting.', success: true });
    } catch (saveError) {
      if (!mounted.current) return;
      if (saveError.code === 'landing_conflict') {
        setEditing(false);
        setReload(value => value + 1);
      }
      setMessage({ text: saveError.message, success: false });
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  if (error && !data) return <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-800">{error}</p>;
  if (!data) return <p role="status" className="rounded-lg bg-gray-100 p-4">Loading the landing cycle…</p>;

  const setLine = data.setBy ? `Set by ${data.setBy}${data.setAt ? `, ${formatWhen(data.setAt)}` : ''}` : null;
  return <section aria-labelledby="landing-cycle-heading" className="rounded-xl border border-gray-200 bg-white p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 id="landing-cycle-heading" className="text-lg font-semibold text-gray-900">Landing cycle</h2>
        <p className="mt-1 text-sm text-gray-600">The cycle apps open on. Automatic picks the cycle with the next Board meeting and switches the day after that meeting. Apps with no proposals in that cycle yet stay where they are, and a cycle chosen in a link still wins.</p>
        <p className={`mt-3 ${data.landingCycleCode ? 'font-medium text-gray-900' : 'text-gray-500'}`}>
          {data.status === 'active'
            ? `${cycleLabel(data, data.landingCycleCode)} (chosen)`
            : data.landingCycleCode ? `Automatic: ${cycleLabel(data, data.landingCycleCode)}` : 'Automatic: no cycle has a Board date yet'}
        </p>
        {data.status !== 'active' && data.automatic?.switchesOn && <p className="text-sm text-gray-600">Switches to the next cycle on {formatDay(data.automatic.switchesOn)}.</p>}
        {data.status === 'active' && <p className="text-sm text-amber-800">Apps stay on {data.landingCycleCode} until you switch back to Automatic; they do not switch on their own.</p>}
        {data.status === 'active' && data.automatic?.code && <p className="text-sm text-gray-600">Automatic would be {cycleLabel(data, data.automatic.code)}{data.automatic.switchesOn ? `, switching to the next cycle on ${formatDay(data.automatic.switchesOn)}` : ''}.</p>}
        {setLine && <p className="text-sm text-gray-600">{setLine}</p>}
        {(data.status === 'missing' || data.status === 'invalid') && <p role="alert" className="mt-2 text-sm text-amber-800">
          The saved landing cycle {data.storedValue} is not in the Grant Cycle table, so apps are using the automatic cycle. Choose a cycle or switch back to Automatic.
        </p>}
      </div>
      {data.canEdit && !editing && <Button variant="outline" disabled={saving} onClick={() => { setMessage(null); setDraft(data.status === 'active' ? data.landingCycleCode : ''); setEditRevision(data.revision); setEditing(true); }}>Edit<span className="sr-only"> landing cycle</span></Button>}
    </div>
    {editing && <div className="mt-3 max-w-sm rounded-lg border border-gray-200 bg-gray-50 p-3">
      <label className="block text-sm font-medium text-gray-700">Landing cycle
        <select className={selectClass} value={draft} disabled={saving} onChange={event => setDraft(event.target.value)}>
          <option value="">Automatic — the cycle with the next Board meeting</option>
          {data.cycles.map(cycle => <option key={cycle.code} value={cycle.code}>{cycleLabel(data, cycle.code)}</option>)}
        </select>
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button disabled={saving || (draft === (data.status === 'active' ? data.landingCycleCode : '') && ['active', 'automatic'].includes(data.status))} onClick={() => save(draft || null)}>Save</Button>
        <Button variant="outline" disabled={saving} onClick={() => { setEditing(false); setMessage(null); }}>Cancel</Button>
      </div>
      {saving && <p role="status" className="mt-2 text-sm">Saving…</p>}
    </div>}
    {message && <p role={message.success ? 'status' : 'alert'} className={`mt-2 text-sm ${message.success ? 'text-green-800' : 'text-red-800'}`}>{message.text}</p>}
  </section>;
}
