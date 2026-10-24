import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { requestEnvelope } from '../../utils/api-request';
import { DELIBERATION_SESSION_STATUS as STATUS, DELIBERATION_SESSION_STATUS_LABEL as STATUS_LABEL } from '../../config/meetingTracker';

function dateFormatter(session, options) {
  try { return new Intl.DateTimeFormat('en-US', { ...options, timeZone: session.ianaTimeZone || 'America/Los_Angeles' }); }
  catch { return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'America/Los_Angeles' }); }
}
export function sessionDate(session) {
  const date = new Date(session.scheduledStartIso || '');
  return Number.isFinite(date.getTime()) ? dateFormatter(session, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(date) : 'Date not set';
}
function endTime(session) {
  const end = new Date(session.scheduledEndIso || '');
  return Number.isFinite(end.getTime()) ? dateFormatter(session, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(end) : 'End time not set';
}
function agendaTime(session, slots, index) {
  const start = Date.parse(session.scheduledStartIso);
  if (!Number.isFinite(start)) return 'Time not set';
  const offset = slots.slice(0, index).reduce((sum, slot) => sum + (Number(slot.wmkf_minutes) || 0), 0);
  return dateFormatter(session, { hour: 'numeric', minute: '2-digit' }).format(new Date(start + offset * 60000));
}

/** Global sessions remain independent of cycle filters. Authorized detail is read lazily. */
export default function MeetingSessionsView({ sessions, loading, error, onRetry, cycleCode, programId }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [dateRange, setDateRange] = useState('all');
  const [now, setNow] = useState(() => Date.now());
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState(false);
  const [retry, setRetry] = useState(0);
  const token = useRef(0);
  const upcoming = (session) => session.status === STATUS.PLANNED && Date.parse(session.scheduledEndIso || session.scheduledStartIso) >= now;
  const visible = sessions.filter((session) => (dateRange === 'all' || (dateRange === 'upcoming' ? upcoming(session) : Date.parse(session.scheduledEndIso || session.scheduledStartIso) < now))
    && (status === 'all' || String(session.status) === status)
    && (!search.trim() || [sessionDate(session), session.location, STATUS_LABEL[session.status]].some((value) => String(value || '').toLowerCase().includes(search.trim().toLowerCase()))))
    .sort((a, b) => Number(upcoming(b)) - Number(upcoming(a)) || (upcoming(a) ? 1 : -1) * ((Date.parse(a.scheduledStartIso) || 0) - (Date.parse(b.scheduledStartIso) || 0)));
  const selected = visible.find((session) => session.sessionId === selectedId) || visible[0];
  const id = selected?.sessionId;
  useEffect(() => {
    const current = ++token.current;
    if (!id) return undefined;
    requestEnvelope(`/api/meeting-tracker/sessions/${id}`, { tolerantBody: true }).then(({ ok, data }) => {
      if (current !== token.current) return;
      if (!ok || data.session?.sessionId !== id || !Array.isArray(data.slots)) { setDetailError(id); return; }
      setDetail({ ...data, forId: id }); setDetailError(false);
    }).catch(() => { if (current === token.current) setDetailError(id); });
    return () => { token.current += 1; };
  }, [id, retry]);
  const href = (sessionId) => {
    const query = new URLSearchParams();
    if (cycleCode) query.set('cycleCode', cycleCode);
    if (programId) query.set('programId', programId);
    return `/meeting-tracker/sessions/${sessionId}${query.size ? `?${query}` : ''}`;
  };
  const ready = detail?.forId === id;
  const slots = ready ? detail.slots : [];
  const previewSession = ready ? detail.session : selected;
  const preview = (sessionId) => {
    setSelectedId(sessionId);
    const region = document.getElementById('meeting-session-preview');
    if (window.matchMedia?.('(max-width: 1023px)').matches) region?.scrollIntoView({ block: 'start' });
    region?.focus({ preventScroll: true });
  };
  const control = 'h-11 min-w-0 rounded-lg border border-gray-300 bg-white px-3 font-normal focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600';
  return <section aria-label="Proposal discussion sessions">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
      <p className="text-sm text-gray-600">All listed sessions, across programs and cycles. Cancelled sessions are excluded.</p>
      <Link href={href('new')} className="rounded-lg bg-gray-900 px-4 py-3 text-sm font-semibold text-white hover:bg-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">Create session</Link>
    </div>
    <div className="mb-5 grid grid-cols-2 items-end gap-3 lg:flex">
      <label className="flex min-w-0 flex-col gap-1 text-sm font-medium text-gray-700">Date range<select value={dateRange} onChange={(event) => { setNow(Date.now()); setDateRange(event.target.value); }} className={control}><option value="all">All dates</option><option value="upcoming">Upcoming</option><option value="past">Past</option></select></label>
      <label className="flex min-w-0 flex-col gap-1 text-sm font-medium text-gray-700">Status<select value={status} onChange={(event) => setStatus(event.target.value)} className={control}><option value="all">All statuses</option><option value={STATUS.PLANNED}>Planned</option><option value={STATUS.HELD}>Held</option></select></label>
      <label className="col-span-2 flex min-w-0 flex-1 flex-col gap-1 text-sm font-medium text-gray-700 lg:ml-auto lg:max-w-xs">Find a session<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Date, time, location, or status" className={control} /></label>
    </div>
    {error ? <p role="alert" className="text-sm text-red-800">Sessions could not be loaded. <button type="button" className="underline" onClick={onRetry}>Try again</button></p>
      : loading ? <p role="status" className="p-6 text-sm text-gray-600">Loading sessions…</p>
        : <>
          <p role="status" className="mb-3 text-sm text-gray-600"><strong className="font-semibold text-gray-900">{visible.length} session{visible.length === 1 ? '' : 's'}</strong> · Upcoming first</p>
          {!visible.length ? <p className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-600">{sessions.length ? 'No sessions match these filters. Undated sessions appear under All dates.' : 'No sessions have been scheduled. Create a session to begin.'}</p>
            : <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <div aria-label="Sessions" className="overflow-hidden rounded-lg border border-gray-200 bg-white">
                {visible.map((session) => <div key={session.sessionId} className={`grid gap-3 border-b border-gray-200 p-4 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_8.5rem] ${id === session.sessionId ? 'bg-blue-50' : ''}`}>
                  <div className="min-w-0"><p className="text-sm font-semibold text-gray-900">{sessionDate(session)}</p><p className="mt-1 text-xs text-gray-600">Ends {endTime(session)}</p><p className="mt-1 text-sm text-gray-600">{session.location || 'Location not set'}</p></div>
                  <div className="flex flex-wrap items-start gap-x-4 gap-y-2 sm:flex-col">
                    <span className={`rounded px-2 py-1 text-xs font-semibold ${session.status === STATUS.PLANNED ? 'bg-blue-50 text-blue-800' : 'bg-gray-100 text-gray-700'}`}>{STATUS_LABEL[session.status] || 'Status unavailable'}</span>
                    <Link href={href(session.sessionId)} className="text-sm font-semibold text-blue-700 hover:underline">Open session →</Link>
                    <button type="button" aria-pressed={id === session.sessionId} onClick={() => preview(session.sessionId)} className="text-sm font-semibold text-blue-700 underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">{id === session.sessionId ? 'Preview shown' : 'Preview agenda'}<span className="sr-only"> · {sessionDate(session)} · {session.location || 'Location not set'}</span></button>
                  </div>
                </div>)}
              </div>
              <section id="meeting-session-preview" aria-label="Selected session preview" tabIndex={-1} aria-busy={!ready && detailError !== id} className="min-w-0 scroll-mt-5 rounded-lg border border-gray-200 bg-white p-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">
                <h2 className="text-lg font-semibold text-gray-900">Agenda preview</h2>
                <p className="mt-2 text-sm font-medium text-gray-900">{sessionDate(previewSession)} — {endTime(previewSession)}</p>
                <p className="mt-1 text-sm text-gray-600">{previewSession.location || 'Location not set'}</p>
                {detailError === id ? <p role="alert" className="mt-4 text-sm text-red-800">The agenda could not be loaded. <button type="button" onClick={() => setRetry((value) => value + 1)} className="underline">Try again</button></p>
                  : !ready ? <p role="status" className="mt-4 text-sm text-gray-600">Loading agenda…</p>
                    : <>
                      <p className="mt-4 border-t border-gray-200 pt-4 text-sm font-semibold text-gray-600">{slots.length} request{slots.length === 1 ? '' : 's'} · {slots.reduce((sum, slot) => sum + (Number(slot.wmkf_minutes) || 0), 0)} minutes</p>
                      {slots.length ? <ol className="mt-2 divide-y divide-gray-200">{slots.map((slot, index) => <li key={slot.wmkf_deliberationslotid} className="py-3 text-sm"><p className="mb-1 text-xs text-gray-600">{agendaTime(detail.session, slots, index)} · {Number(slot.wmkf_minutes) || 0} minutes</p><p className="font-semibold text-gray-900">{slot.wmkf_Request?.akoya_requestnum ? `#${slot.wmkf_Request.akoya_requestnum}` : 'Request'}{slot.institution ? ` · ${slot.institution}` : ''}</p><p className="mt-1 text-gray-600">{slot.wmkf_Request?.akoya_title || 'Title unavailable'}</p></li>)}</ol>
                        : <p className="mt-3 text-sm text-gray-600">No proposals are in this session yet. Open the session to add proposals.</p>}
                    </>}
                <Link href={href(id)} className="mt-5 inline-block text-sm font-semibold text-blue-700 hover:underline">Open selected session →</Link>
              </section>
            </div>}
        </>}
  </section>;
}
