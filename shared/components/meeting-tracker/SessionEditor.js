import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Layout, { Button } from '../Layout';
import { formatZonedLocalInput, resolveZonedDateTime } from '../../../lib/utils/zoned-date-time';
import SessionAgendaPanel from './SessionAgendaPanel';

const EMPTY_FORM = {
  startLocal: '',
  durationMinutes: 60,
  ianaTimeZone: 'America/Los_Angeles',
  location: '',
  meetingLink: '',
  notes: '',
  status: 100000000,
  attendees: [],
};

async function readJson(response) {
  return response.json().catch(() => ({}));
}

async function sendJson(url, method, body, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await readJson(response);
  if (!response.ok) throw new Error(result.error || 'The schedule change could not be saved.');
  return result;
}

export async function reorderSessionSlots({ sessionId, slots, fetchImpl = fetch }) {
  return sendJson('/api/meeting-tracker/slots/reorder', 'PATCH', {
    sessionId,
    slots: slots.map((slot, index) => ({
      slotId: slot.wmkf_deliberationslotid,
      etag: slot._etag,
      order: index + 1,
    })),
  }, fetchImpl);
}

// D11: the slot's link is the request's live briefing page (writeup, reviews,
// proposal, materials). It exists only once the PD has shared the writeup.
export function slotBriefingText(slot) {
  return slot?.briefing?.url ? 'Open briefing' : 'Briefing not yet shared — the lead PD shares the writeup from Staff Deliberations.';
}

// Returns a new array with the item at `from` moved to `to`; returns the same
// array unchanged when the move is a no-op or either index is out of range.
export function moveSlot(slots, from, to) {
  if (from === to || from < 0 || to < 0 || from >= slots.length || to >= slots.length) return slots;
  const next = [...slots];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function sameRef(left, right) {
  return left.kind === right.kind
    && (left.kind === 'staff' ? left.profileId === right.profileId : left.rosterId === right.rosterId);
}

function sessionForm(session) {
  const duration = Math.max(1, Math.round(
    (new Date(session.scheduledEndIso).getTime() - new Date(session.scheduledStartIso).getTime()) / 60000,
  ));
  return {
    startLocal: formatZonedLocalInput(session.scheduledStartIso, session.ianaTimeZone) || '',
    durationMinutes: duration,
    ianaTimeZone: session.ianaTimeZone,
    location: session.location,
    meetingLink: session.meetingLink,
    notes: session.notes,
    status: session.status,
    attendees: session.attendeeRefs || [],
  };
}

function SlotRow({ slot, proposal, leadOptions, sessions, sessionId, busy, onChange, onMove, onRemove, onShift, index, count, isDragging, dropEdge, onDragStart, onDragOver, onDrop, onDragEnd }) {
  const [minutes, setMinutes] = useState(slot.wmkf_minutes || 15);
  const [leadPdId, setLeadPdId] = useState(slot._wmkf_leadpd_value || '');
  const [targetSessionId, setTargetSessionId] = useState('');
  const edgeClass = dropEdge === 'top' ? 'border-t-2 border-t-blue-500' : dropEdge === 'bottom' ? 'border-b-2 border-b-blue-500' : '';
  return (
    <li
      className={`rounded-xl border border-gray-200 bg-white p-4 shadow-sm ${isDragging ? 'opacity-40' : ''} ${edgeClass}`}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex w-12 shrink-0 flex-col items-center gap-1">
          <div
            className="flex flex-col items-center gap-1 cursor-grab"
            draggable={!busy}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3 text-gray-400">
              <circle cx="6" cy="4" r="1.3" /><circle cx="6" cy="10" r="1.3" /><circle cx="6" cy="16" r="1.3" />
              <circle cx="14" cy="4" r="1.3" /><circle cx="14" cy="10" r="1.3" /><circle cx="14" cy="16" r="1.3" />
            </svg>
            <span className="text-sm font-semibold tabular-nums text-gray-900">{index + 1}</span>
          </div>
          <div className="flex gap-1">
            <button type="button" aria-label={`Move ${proposal?.requestNumber || 'proposal'} up`} disabled={busy || index === 0} onClick={() => onShift(index, -1)} className="rounded border border-gray-300 p-1.5 disabled:opacity-30">
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="m5 12.5 5-5 5 5" /></svg>
            </button>
            <button type="button" aria-label={`Move ${proposal?.requestNumber || 'proposal'} down`} disabled={busy || index === count - 1} onClick={() => onShift(index, 1)} className="rounded border border-gray-300 p-1.5 disabled:opacity-30">
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="m5 7.5 5 5 5-5" /></svg>
            </button>
          </div>
        </div>
        <div className="min-w-[13rem] flex-1">
          <p className="font-semibold text-gray-900">#{proposal?.requestNumber || slot.wmkf_Request?.akoya_requestnum || slot._wmkf_request_value}</p>
          <p className="mt-1 text-sm text-gray-700">{proposal?.title || slot.wmkf_Request?.akoya_title || 'Request details are not available.'}</p>
          {slot.briefing?.url ? (
            <a href={slot.briefing.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-xs font-semibold text-blue-800 underline">Open briefing</a>
          ) : (
            <p className="mt-2 text-xs font-medium text-gray-500">{slotBriefingText(slot)}</p>
          )}
        </div>
        <div className="grid min-w-[17rem] flex-1 gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium text-gray-700">
            Minutes
            <input type="number" min="1" max="1440" value={minutes} onChange={(event) => setMinutes(event.target.value)} onBlur={() => Number(minutes) !== Number(slot.wmkf_minutes) && onChange(slot, { minutes: Number(minutes) })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-300" />
          </label>
          <label className="text-sm font-medium text-gray-700">
            Lead Program Director
            <select value={leadPdId} onChange={(event) => { setLeadPdId(event.target.value); onChange(slot, { leadPdId: event.target.value || null }); }} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-300">
              <option value="">Not assigned</option>
              {leadOptions.map((lead) => <option key={lead.id} value={lead.id}>{lead.name}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium text-gray-700 sm:col-span-2">
            Move to another session
            <div className="mt-1 flex gap-2">
              <select value={targetSessionId} onChange={(event) => setTargetSessionId(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-300">
                <option value="">Choose a session</option>
                {sessions.filter((session) => session.sessionId !== sessionId).map((session) => <option key={session.sessionId} value={session.sessionId}>{new Date(session.scheduledStartIso).toLocaleString()}</option>)}
              </select>
              <button type="button" disabled={!targetSessionId || busy} onClick={() => onMove(slot, targetSessionId)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-40">Move</button>
            </div>
          </label>
        </div>
        <button type="button" disabled={busy} onClick={() => onRemove(slot)} className="rounded-lg px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-40">Remove</button>
      </div>
    </li>
  );
}

export function ProposalOrderList({ slots, proposalById, leadOptions, sessions, sessionId, busy, onShift, onChange, onMove, onRemove, onReorder }) {
  const [draggingIndex, setDraggingIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);
  const [overEdge, setOverEdge] = useState(null);

  const resetDrag = () => {
    setDraggingIndex(null);
    setOverIndex(null);
    setOverEdge(null);
  };

  const handleDragStart = (index) => (event) => {
    if (busy) return;
    setDraggingIndex(index);
    try { event.dataTransfer?.setData('text/plain', String(index)); } catch { /* dataTransfer unavailable */ }
    try { if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'; } catch { /* dataTransfer unavailable */ }
  };

  const handleDragOver = (index) => (event) => {
    event.preventDefault();
    if (busy || draggingIndex === null) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const edge = event.clientY - rect.top < rect.height / 2 ? 'top' : 'bottom';
    if (overIndex === index && overEdge === edge) return;
    setOverIndex(index);
    setOverEdge(edge);
  };

  const handleDrop = (index) => (event) => {
    event.preventDefault();
    if (busy || draggingIndex === null) {
      resetDrag();
      return;
    }
    const rawTarget = overEdge === 'bottom' ? index + 1 : index;
    const targetIndex = rawTarget > draggingIndex ? rawTarget - 1 : rawTarget;
    const movedSlot = slots[draggingIndex];
    const next = moveSlot(slots, draggingIndex, targetIndex);
    resetDrag();
    if (next !== slots) onReorder(next, movedSlot, targetIndex);
  };

  return (
    <ol className="mt-4 space-y-3">
      {slots.map((slot, index) => (
        <SlotRow
          key={slot.wmkf_deliberationslotid}
          slot={slot}
          proposal={proposalById.get(String(slot._wmkf_request_value).toLowerCase())}
          leadOptions={leadOptions}
          sessions={sessions}
          sessionId={sessionId}
          busy={busy}
          index={index}
          count={slots.length}
          onShift={onShift}
          onChange={onChange}
          onMove={onMove}
          onRemove={onRemove}
          isDragging={draggingIndex === index}
          dropEdge={overIndex === index && draggingIndex !== index ? overEdge : null}
          onDragStart={handleDragStart(index)}
          onDragOver={handleDragOver(index)}
          onDrop={handleDrop(index)}
          onDragEnd={resetDrag}
        />
      ))}
    </ol>
  );
}

export default function SessionEditor() {
  const router = useRouter();
  const isNew = router.query.id === 'new';
  const sessionId = isNew || Array.isArray(router.query.id) ? null : router.query.id;
  const cycleCode = Array.isArray(router.query.cycleCode) ? '' : router.query.cycleCode || '';
  const programId = Array.isArray(router.query.programId) ? '' : router.query.programId || '';
  const initialRequestId = Array.isArray(router.query.requestId) ? '' : router.query.requestId || '';
  const [form, setForm] = useState(EMPTY_FORM);
  const [session, setSession] = useState(null);
  const [slots, setSlots] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [recipients, setRecipients] = useState({ staff: [], board: [] });
  const [proposals, setProposals] = useState([]);
  const [selectedRequestId, setSelectedRequestId] = useState(initialRequestId);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [warning, setWarning] = useState(null);

  const loadDetail = useCallback(async (id) => {
    const response = await fetch(`/api/meeting-tracker/sessions/${id}`);
    const body = await readJson(response);
    if (!response.ok) throw new Error(body.error || 'The meeting session could not be loaded.');
    setSession(body.session);
    setForm(sessionForm(body.session));
    setSlots(body.slots || []);
  }, []);

  useEffect(() => {
    if (!router.isReady) return undefined;
    let current = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const dashboardQuery = new URLSearchParams({ ...(cycleCode ? { cycleCode } : {}), ...(programId ? { programId } : {}), scope: 'all' });
        const requests = [fetch('/api/meeting-tracker/recipients'), fetch('/api/meeting-tracker/sessions')];
        if (cycleCode) requests.push(fetch(`/api/meeting-tracker/dashboard?${dashboardQuery}`));
        const responses = await Promise.all(requests);
        const bodies = await Promise.all(responses.map(readJson));
        if (!current) return;
        const failedIndex = responses.findIndex((response) => !response.ok);
        if (failedIndex >= 0) throw new Error(bodies[failedIndex].error || 'The session workspace could not be loaded.');
        setRecipients(bodies[0]);
        setSessions(bodies[1].sessions || []);
        setProposals(bodies[2]?.proposals || []);
        if (isNew) {
          setForm((value) => ({ ...value, attendees: bodies[0].defaultAttendeeRefs || [] }));
          setNotice(bodies[0].notice || null);
        } else if (sessionId) {
          await loadDetail(sessionId);
        }
      } catch (loadError) {
        if (current) setError(loadError.message);
      } finally {
        if (current) setLoading(false);
      }
    }, 0);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [router.isReady, sessionId, isNew, cycleCode, programId, loadDetail]);

  const leadOptions = useMemo(() => {
    const unique = new Map();
    proposals.forEach((proposal) => {
      if (proposal.leadPdId && proposal.programDirector) unique.set(proposal.leadPdId, proposal.programDirector);
    });
    slots.forEach((slot) => {
      if (slot.wmkf_LeadPd?.systemuserid && slot.wmkf_LeadPd?.fullname) {
        unique.set(slot.wmkf_LeadPd.systemuserid, slot.wmkf_LeadPd.fullname);
      }
    });
    return [...unique].map(([id, name]) => ({ id, name }));
  }, [proposals, slots]);
  const proposalById = useMemo(() => new Map(proposals.map((proposal) => [String(proposal.requestId).toLowerCase(), proposal])), [proposals]);
  const sessionMinutes = session ? Math.round((new Date(session.scheduledEndIso) - new Date(session.scheduledStartIso)) / 60000) : Number(form.durationMinutes);
  const slotMinutes = slots.reduce((sum, slot) => sum + Number(slot.wmkf_minutes || 0), 0);
  const overFull = slotMinutes > sessionMinutes;

  const updateForm = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const toggleAttendee = (ref) => updateForm('attendees', form.attendees.some((row) => sameRef(row, ref))
    ? form.attendees.filter((row) => !sameRef(row, ref))
    : [...form.attendees, ref]);

  const saveSession = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setWarning(null);
    try {
      const scheduledStartIso = resolveZonedDateTime(form.startLocal, form.ianaTimeZone);
      const duration = Number(form.durationMinutes);
      if (!Number.isSafeInteger(duration) || duration < 1) throw new Error('Duration must be a positive whole number of minutes.');
      const scheduledEndIso = new Date(Date.parse(scheduledStartIso) + duration * 60000).toISOString();
      const payload = {
        scheduledStartIso,
        scheduledEndIso,
        ianaTimeZone: form.ianaTimeZone,
        location: form.location,
        meetingLink: form.meetingLink,
        notes: form.notes,
        status: Number(form.status),
        attendees: form.attendees,
      };
      const body = sessionId
        ? await sendJson(`/api/meeting-tracker/sessions/${sessionId}`, 'PATCH', { etag: session.etag, ...payload })
        : await sendJson('/api/meeting-tracker/sessions', 'POST', payload);
      const savedId = body.session.sessionId;
      if (!sessionId && initialRequestId) {
        const proposal = proposalById.get(String(initialRequestId).toLowerCase());
        const slotResult = await sendJson('/api/meeting-tracker/slots', 'POST', {
          sessionId: savedId,
          requestId: initialRequestId,
          minutes: 15,
          ...(proposal?.leadPdId ? { leadPdId: proposal.leadPdId } : {}),
        });
        setWarning(slotResult.warning || null);
      }
      if (!sessionId) {
        await router.replace({ pathname: `/meeting-tracker/sessions/${savedId}`, query: { ...(cycleCode ? { cycleCode } : {}), ...(programId ? { programId } : {}) } });
      } else {
        setSession(body.session);
        setForm(sessionForm(body.session));
        setNotice('Session saved.');
      }
    } catch (saveError) {
      setError(`${saveError.message} Please try again. If the problem continues, contact an administrator.`);
    } finally {
      setBusy(false);
    }
  };

  const runSlotChange = async (operation) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await operation();
      setWarning(result?.warning || null);
      await loadDetail(sessionId);
    } catch (slotError) {
      setError(`${slotError.message} Please try again. If the problem continues, contact an administrator.`);
    } finally {
      setBusy(false);
    }
  };

  const addSlot = () => {
    const proposal = proposalById.get(String(selectedRequestId).toLowerCase());
    return runSlotChange(() => sendJson('/api/meeting-tracker/slots', 'POST', {
      sessionId,
      requestId: selectedRequestId,
      order: slots.length + 1,
      minutes: 15,
      ...(proposal?.leadPdId ? { leadPdId: proposal.leadPdId } : {}),
    }));
  };

  const shiftSlot = (index, direction) => {
    const next = [...slots];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    return runSlotChange(() => reorderSessionSlots({ sessionId, slots: next }));
  };

  const reorderSlots = (next, movedSlot, targetIndex) => {
    const movedProposal = proposalById.get(String(movedSlot._wmkf_request_value).toLowerCase());
    const requestNumber = movedProposal?.requestNumber || movedSlot.wmkf_Request?.akoya_requestnum || movedSlot._wmkf_request_value;
    return runSlotChange(async () => {
      const result = await reorderSessionSlots({ sessionId, slots: next });
      setNotice(`Moved #${requestNumber} to position ${targetIndex + 1}.`);
      return result;
    });
  };

  if (loading) {
    return <Layout title="Meeting Tracker"><div className="py-24 text-center text-gray-500">Loading the session workspace…</div></Layout>;
  }

  return (
    <Layout title={isNew ? 'Create session' : 'Meeting session'}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link href={{ pathname: '/meeting-tracker', query: { ...(cycleCode ? { cycleCode } : {}), ...(programId ? { programId } : {}) } }} className="text-sm font-semibold text-gray-600 underline decoration-gray-300 underline-offset-4 hover:text-gray-900">Back to the cycle schedule</Link>
          <h1 className="mt-3 text-3xl font-semibold text-gray-900">{isNew ? 'Create a deliberation session' : 'Deliberation session'}</h1>
          <p className="mt-2 text-gray-600">Set the meeting details, attendees, and proposal order.</p>
        </div>
        {!isNew && session?.meetingLink && <a href={session.meetingLink} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-gray-900 px-5 py-3 text-sm font-semibold text-white hover:bg-gray-800">Join meeting</a>}
      </div>

      {error && <div role="alert" className="mb-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
      {notice && <div role="status" className="mb-5 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">{notice}</div>}
      {(warning || overFull) && <div role="status" className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{warning?.message || `Scheduled discussion time is ${slotMinutes - sessionMinutes} minutes longer than this session.`}</div>}

      <form onSubmit={saveSession} className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm font-medium text-gray-700">Date and start time<input required type="datetime-local" value={form.startLocal} onChange={(event) => updateForm('startLocal', event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
          <label className="text-sm font-medium text-gray-700">Duration in minutes<input required type="number" min="1" value={form.durationMinutes} onChange={(event) => updateForm('durationMinutes', event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
          <label className="text-sm font-medium text-gray-700">Time zone<input required value={form.ianaTimeZone} onChange={(event) => updateForm('ianaTimeZone', event.target.value)} placeholder="America/Los_Angeles" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
          <label className="text-sm font-medium text-gray-700">Status<select value={form.status} onChange={(event) => updateForm('status', Number(event.target.value))} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2"><option value="100000000">Planned</option><option value="100000001">Held</option><option value="100000002">Cancelled</option></select></label>
          <label className="text-sm font-medium text-gray-700 md:col-span-2">Location<input value={form.location} onChange={(event) => updateForm('location', event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
          <label className="text-sm font-medium text-gray-700 md:col-span-2">Zoom link<input type="url" value={form.meetingLink} onChange={(event) => updateForm('meetingLink', event.target.value)} placeholder="https://zoom.us/…" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
          <label className="text-sm font-medium text-gray-700 md:col-span-2 lg:col-span-4">Notes<textarea rows="3" value={form.notes} onChange={(event) => updateForm('notes', event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
        </div>

        <fieldset className="mt-6 border-t border-gray-100 pt-5">
          <legend className="text-base font-semibold text-gray-900">Attendees</legend>
          {session?.attendeeIssues?.length > 0 && (
            <ul className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status">
              {session.attendeeIssues.map((issue) => <li key={issue}>{issue} Saving attendees again replaces the saved list.</li>)}
            </ul>
          )}
          <p className="mt-1 text-sm text-gray-600">The fixed staff list is selected for new sessions. Add Board members for this meeting.</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {[['Staff', recipients.staff], ['Board', recipients.board]].map(([label, rows]) => <div key={label}><h2 className="text-sm font-semibold text-gray-700">{label}</h2><div className="mt-2 flex flex-wrap gap-2">{rows.map((person) => { const selected = form.attendees.some((ref) => sameRef(ref, person.ref)); return <button key={`${person.ref.kind}-${person.ref.profileId || person.ref.rosterId}`} type="button" aria-pressed={selected} onClick={() => toggleAttendee(person.ref)} className={`rounded-full border px-3 py-1.5 text-sm font-medium ${selected ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>{person.name}</button>; })}{rows.length === 0 && <p className="text-sm text-gray-500">No eligible people found.</p>}</div></div>)}
          </div>
        </fieldset>

        <div className="mt-6 flex justify-end"><Button type="submit" loading={busy}>{isNew ? 'Create session' : 'Save session'}</Button></div>
      </form>

      {!isNew && (
        <section className="mt-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div><h2 className="text-xl font-semibold text-gray-900">Proposal order</h2><p className="mt-1 text-sm text-gray-600">{slotMinutes} discussion minutes across {slots.length} proposal{slots.length === 1 ? '' : 's'}.</p></div>
            <div className="flex min-w-[18rem] gap-2"><select aria-label="Proposal to add" value={selectedRequestId} onChange={(event) => setSelectedRequestId(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2"><option value="">Choose a proposal</option>{proposals.filter((proposal) => !slots.some((slot) => String(slot._wmkf_request_value).toLowerCase() === String(proposal.requestId).toLowerCase())).map((proposal) => <option key={proposal.requestId} value={proposal.requestId}>#{proposal.requestNumber} · {proposal.title}</option>)}</select><Button type="button" size="sm" disabled={!selectedRequestId || busy} onClick={addSlot}>Add</Button></div>
          </div>
          {slots.length ? (
            <ProposalOrderList
              slots={slots}
              proposalById={proposalById}
              leadOptions={leadOptions}
              sessions={sessions}
              sessionId={sessionId}
              busy={busy}
              onShift={shiftSlot}
              onChange={(row, patch) => runSlotChange(() => sendJson(`/api/meeting-tracker/slots/${row.wmkf_deliberationslotid}`, 'PATCH', { etag: row._etag, ...patch }))}
              onMove={(row, targetSessionId) => runSlotChange(() => sendJson(`/api/meeting-tracker/slots/${row.wmkf_deliberationslotid}`, 'PATCH', { etag: row._etag, targetSessionId }))}
              onRemove={(row) => runSlotChange(() => sendJson(`/api/meeting-tracker/slots/${row.wmkf_deliberationslotid}`, 'DELETE', { etag: row._etag }))}
              onReorder={reorderSlots}
            />
          ) : <div className="mt-4 rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-600">No proposals are in this session yet.</div>}
        </section>
      )}

      {!isNew && session && (
        <SessionAgendaPanel
          sessionId={sessionId}
          session={session}
          slots={slots}
          recipients={recipients}
        />
      )}

      {/* The page is long: the exit and the save confirmation are reachable at
          the bottom as well as in the header (owner, 2026-09-10). */}
      <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-gray-200 pt-6">
        <Link href={{ pathname: '/meeting-tracker', query: { ...(cycleCode ? { cycleCode } : {}), ...(programId ? { programId } : {}) } }} className="text-sm font-semibold text-gray-600 underline decoration-gray-300 underline-offset-4 hover:text-gray-900">Back to the cycle schedule</Link>
        {notice && <p role="status" className="text-sm font-medium text-blue-800">{notice}</p>}
      </div>
    </Layout>
  );
}
