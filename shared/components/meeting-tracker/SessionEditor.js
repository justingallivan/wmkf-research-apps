import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Layout, { Button } from '../Layout';
import { formatZonedLocalInput, resolveZonedDateTime } from '../../../lib/utils/zoned-date-time';
import SessionAgendaPanel from './SessionAgendaPanel';
import OverflowMenu from '../workbench/OverflowMenu';
import { requestEnvelope } from '../../utils/api-request';
import TestRequestBadge from '../TestRequestBadge';

const FIELD_CLASS = 'mt-1 rounded-lg border border-gray-300 bg-white px-3 py-2 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-300';

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

export async function readJson(url, options) {
  return requestEnvelope(url, { ...options, tolerantBody: true });
}

export async function sendJson(url, method, body, fetchImpl = fetch) {
  const { ok, data: result } = await requestEnvelope(url, { method, body, fetchImpl, tolerantBody: true });
  if (!ok) throw new Error(result.error || 'The schedule change could not be saved.');
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

// D11: the slot's available link is the request's live briefing page
// (writeup, reviews, proposal, materials); URL absence does not describe send history.
export function slotBriefingText(slot) {
  return slot?.briefing?.url ? 'Open briefing' : 'Briefing link unavailable';
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

const NO_EMAIL_SECTION_HINT = 'Greyed names have no email on file; hover a name for the reason.';
export const noEmailHint = (person) => person?.linked
  ? 'No email on file. The linked Dataverse contact is inactive, missing, or has no primary email; fix or relink the contact, or unlink the roster row.'
  : 'No email on file. Add a preferred email on the Expertise Finder roster before this person can be added.';

function sameRef(left, right) {
  return left.kind === right.kind
    && (left.kind === 'staff' ? left.profileId === right.profileId : left.rosterId === right.rosterId);
}

const SESSION_STATUS_LABEL = { 100000000: 'Planned', 100000001: 'Held', 100000002: 'Cancelled' };
const SESSION_STATUS_CLASS = { 100000000: 'bg-blue-50 text-blue-800', 100000001: 'bg-green-50 text-green-800', 100000002: 'bg-gray-100 text-gray-700' };

export function sessionWhen(session) {
  const start = Date.parse(session?.scheduledStartIso || '');
  const end = Date.parse(session?.scheduledEndIso || '');
  if (!Number.isFinite(start)) return 'Not scheduled';
  const zone = session.ianaTimeZone || undefined;
  let label;
  try {
    label = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: zone, timeZoneName: 'short' }).format(new Date(start));
  } catch {
    label = new Date(start).toLocaleString();
  }
  const minutes = Number.isFinite(end) ? Math.round((end - start) / 60000) : null;
  return minutes ? `${label} · ${minutes} minutes` : label;
}

function SessionSummary({ session, recipients, onEdit }) {
  const people = [...(recipients.staff || []), ...(recipients.board || [])];
  const names = (session.attendeeRefs || []).map((ref) => people.find((person) => sameRef(person.ref, ref))?.name || 'Person no longer in the directory');
  let linkHost = null;
  try { linkHost = session.meetingLink ? new URL(session.meetingLink).hostname : null; } catch { linkHost = null; }
  const row = (label, value) => (
    <div>
      <dt className="text-sm font-medium text-gray-500">{label}</dt>
      <dd className="mt-1 text-sm text-gray-900">{value}</dd>
    </div>
  );
  return (
    <section aria-labelledby="session-details-heading" className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="session-details-heading" className="text-base font-semibold text-gray-900">Session details</h2>
        <Button type="button" variant="outline" size="sm" onClick={onEdit}>Edit session details</Button>
      </div>
      {session.attendeeIssues?.length > 0 && (
        <ul className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status">
          {session.attendeeIssues.map((issue) => <li key={issue}>{issue} Saving attendees again replaces the saved list.</li>)}
        </ul>
      )}
      <dl className="mt-4 grid gap-x-8 gap-y-4 md:grid-cols-2">
        {row('When', sessionWhen(session))}
        {row('Location', session.location || 'Not set')}
        {row('Meeting link', session.meetingLink
          ? <a href={session.meetingLink} target="_blank" rel="noopener noreferrer" className="font-medium text-gray-900 underline underline-offset-4 hover:text-gray-700">Open meeting link{linkHost ? ` (${linkHost})` : ''}</a>
          : 'Not set')}
        {row(`Attendees (${names.length})`, names.length ? names.join(', ') : 'None')}
        {session.notes && <div className="md:col-span-2">{row('Notes', <span className="whitespace-pre-line">{session.notes}</span>)}</div>}
      </dl>
    </section>
  );
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

function SlotRow({ slot, proposal, sessions, sessionId, cycleCode, programId, busy, savingSlotId, onChange, onMove, onRemove, onPositionChange, index, count, isDragging, dropEdge, onDragStart, onDragOver, onDrop, onDragEnd, readOnly = false }) {
  const [minutes, setMinutes] = useState(slot.wmkf_minutes || 15);
  const [targetSessionId, setTargetSessionId] = useState('');
  const [panel, setPanel] = useState(null); // 'move' | 'remove' | null
  const requestNumber = proposal?.requestNumber || slot.wmkf_Request?.akoya_requestnum || slot._wmkf_request_value;
  const requestId = proposal?.requestId || slot._wmkf_request_value;
  const isSaving = savingSlotId === slot.wmkf_deliberationslotid;

  return (
    <li
      className={`relative flex overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-transform duration-150 ${isDragging ? 'opacity-40' : ''} ${isSaving ? 'opacity-70' : ''} ${dropEdge ? 'ring-2 ring-inset ring-blue-600' : ''}`}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {dropEdge && (
        <span aria-hidden="true" className={`pointer-events-none absolute inset-x-0 z-10 h-1 bg-blue-600 ${dropEdge === 'top' ? 'top-0' : 'bottom-0'}`} />
      )}
      {!readOnly && <div
        aria-hidden="true"
        title="Drag to reorder"
        draggable={!busy}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        className={`flex w-7 shrink-0 self-stretch items-center justify-center border-r border-gray-200 bg-gray-50 text-gray-500 transition-colors ${!busy ? 'cursor-grab hover:bg-gray-100 hover:text-gray-700 active:cursor-grabbing' : ''}`}
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
          <circle cx="6" cy="4" r="1.3" /><circle cx="6" cy="10" r="1.3" /><circle cx="6" cy="16" r="1.3" />
          <circle cx="14" cy="4" r="1.3" /><circle cx="14" cy="10" r="1.3" /><circle cx="14" cy="16" r="1.3" />
        </svg>
      </div>}
      <div className="min-w-0 flex-1 p-4">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="flex min-w-0 items-center gap-2 font-semibold leading-9 text-gray-900"><span className="sr-only">Position </span><span className="tabular-nums text-gray-500">{index + 1}</span><span aria-hidden="true" className="text-gray-400"> · </span>#{requestNumber}<TestRequestBadge isTestRequest={proposal?.isTestRequest} /></p>
          {readOnly ? (
            <p className="text-sm tabular-nums text-gray-700">{slot.wmkf_minutes || 15} minutes</p>
          ) : <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
              Minutes
              <input type="number" min="1" max="1440" disabled={busy} value={minutes} onChange={(event) => setMinutes(event.target.value)} onBlur={() => Number(minutes) !== Number(slot.wmkf_minutes) && onChange(slot, { minutes: Number(minutes) })} className="h-9 w-20 rounded-lg border border-gray-300 bg-white px-2 text-sm tabular-nums text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-300 disabled:opacity-50" />
            </label>
            <OverflowMenu
              label={`More actions for #${requestNumber}`}
              disabled={busy}
              items={[
                { key: 'position', label: 'Change position…', onSelect: () => setPanel('position') },
                { key: 'move', label: 'Move to another session…', onSelect: () => setPanel('move') },
                { key: 'remove', label: 'Remove…', onSelect: () => setPanel('remove') },
              ]}
            />
          </div>}
        </div>
        <p className="mt-1 text-sm text-gray-700">{proposal?.title || slot.wmkf_Request?.akoya_title || 'Request details are not available.'}</p>
        {(slot.institution || proposal?.institution) && <p className="mt-0.5 text-sm text-gray-600">{slot.institution || proposal.institution}</p>}
        <p className="mt-1 text-xs text-gray-500">Lead PD: {slot.wmkf_LeadPd?.fullname || 'Not assigned'}</p>
        {slot.briefing?.url ? (
          <a href={slot.briefing.url} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-blue-800 underline">Open briefing</a>
        ) : (
          <p className="text-xs font-medium text-gray-500">{slotBriefingText(slot)}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          {!slot.briefing?.url && requestId && <a href={`/workbench/${encodeURIComponent(requestId)}?tab=staff-deliberations${requestNumber ? `&n=${encodeURIComponent(requestNumber)}` : ''}`} className="text-xs font-semibold text-blue-800 underline">Check Staff Deliberations</a>}
          {proposal?.siteVisit?.activityId && proposal?.requestId && (
            <a href={`/meeting-tracker/visits/${encodeURIComponent(proposal.requestId)}?${new URLSearchParams({ ...(cycleCode ? { cycleCode } : {}), ...(programId ? { programId } : {}), ...(proposal.requestNumber ? { n: proposal.requestNumber } : {}) })}#recording-and-transcript-card`} data-full-page-navigation="true" className="text-xs font-semibold text-blue-800 underline">Open visit · recording and transcript</a>
          )}
        </div>
      {!readOnly && panel === 'position' && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <label className="text-sm font-medium text-gray-700">
            Position in this session
            <select
              aria-label={`Position of #${requestNumber}`}
              value={index + 1}
              disabled={busy}
              autoFocus
              onChange={(event) => { onPositionChange(index, Number(event.target.value)); setPanel(null); }}
              className={`${FIELD_CLASS} w-24`}
            >
              {Array.from({ length: count }, (_, position) => position + 1).map((position) => (
                <option key={position} value={position}>{position}</option>
              ))}
            </select>
          </label>
          <p className="mt-1 text-xs text-gray-500">Choosing a position saves the new order immediately.</p>
          <div className="mt-3 flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setPanel(null)}>Cancel</Button>
          </div>
        </div>
      )}
      {!readOnly && panel === 'move' && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <label className="text-sm font-medium text-gray-700">
            Move to another session
            <select value={targetSessionId} onChange={(event) => setTargetSessionId(event.target.value)} className={`${FIELD_CLASS} w-full`}>
              <option value="">Choose a session</option>
              {sessions.filter((session) => session.sessionId !== sessionId).map((session) => <option key={session.sessionId} value={session.sessionId}>{new Date(session.scheduledStartIso).toLocaleString()}</option>)}
            </select>
          </label>
          <div className="mt-3 flex gap-2">
            <Button type="button" size="sm" disabled={!targetSessionId || busy} onClick={() => { onMove(slot, targetSessionId); setPanel(null); }}>Move</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setPanel(null)}>Cancel</Button>
          </div>
        </div>
      )}
      {!readOnly && panel === 'remove' && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <p className="text-sm text-gray-800">{`Remove #${requestNumber} from this session? Its minutes and lead assignment will be lost.`}</p>
          <div className="mt-3 flex gap-2">
            <Button type="button" variant="danger" size="sm" disabled={busy} onClick={() => { onRemove(slot); setPanel(null); }}>Remove</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setPanel(null)}>Cancel</Button>
          </div>
        </div>
      )}
      </div>
    </li>
  );
}

export function ProposalOrderList({ slots, proposalById, sessions, sessionId, cycleCode, programId, busy, savingSlotId, onChange, onMove, onRemove, onReorder, readOnly = false }) {
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

  const handlePositionChange = (index, position) => {
    const targetIndex = position - 1;
    const movedSlot = slots[index];
    const next = moveSlot(slots, index, targetIndex);
    if (next !== slots) onReorder(next, movedSlot, targetIndex);
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Escape' && draggingIndex !== null) resetDrag();
  };

  return (
    <>
      {!readOnly && <p className="sr-only">Drag a proposal by the handle on its left edge, or open its More actions menu and choose Change position, to reorder. Choosing a position saves immediately.</p>}
      <ol aria-label="Proposal order" className="mt-4 space-y-3" onKeyDown={handleKeyDown}>
        {slots.map((slot, index) => (
          <SlotRow
            key={slot.wmkf_deliberationslotid}
            slot={slot}
            proposal={proposalById.get(String(slot._wmkf_request_value).toLowerCase())}
            sessions={sessions}
            sessionId={sessionId}
            cycleCode={cycleCode}
            programId={programId}
            busy={busy}
            savingSlotId={savingSlotId}
            index={index}
            count={slots.length}
            onChange={onChange}
            onMove={onMove}
            onRemove={onRemove}
            onPositionChange={handlePositionChange}
            isDragging={draggingIndex === index}
            dropEdge={overIndex === index && draggingIndex !== index ? overEdge : null}
            onDragStart={handleDragStart(index)}
            onDragOver={handleDragOver(index)}
            onDrop={handleDrop(index)}
            onDragEnd={resetDrag}
            readOnly={readOnly}
          />
        ))}
      </ol>
    </>
  );
}

export default function SessionEditor() {
  const router = useRouter();
  const isNew = router.query.id === 'new';
  const sessionId = isNew || Array.isArray(router.query.id) ? null : router.query.id;
  const cycleCode = Array.isArray(router.query.cycleCode) ? '' : router.query.cycleCode || '';
  const programId = Array.isArray(router.query.programId) ? '' : router.query.programId || '';
  const initialRequestId = Array.isArray(router.query.requestId) ? '' : router.query.requestId || '';
  const routeKey = JSON.stringify([router.isReady, sessionId, isNew, cycleCode, programId, initialRequestId]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [session, setSession] = useState(null);
  const [createdSessionId, setCreatedSessionId] = useState(null);
  const [initialSlotCreated, setInitialSlotCreated] = useState(false);
  const creationRecoveryRouteRef = useRef(routeKey);
  const [slots, setSlots] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [recipients, setRecipients] = useState({ staff: [], board: [] });
  const [proposals, setProposals] = useState([]);
  const [selectedRequestId, setSelectedRequestId] = useState(initialRequestId);
  const [loading, setLoading] = useState(true);
  const [loadedRouteKey, setLoadedRouteKey] = useState(null);
  const [reloadCount, setReloadCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [savingSlotId, setSavingSlotId] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [warning, setWarning] = useState(null);
  // A saved session opens read-only (DESIGN.md Read-First Rule); keyed to the
  // session id so moving to another session starts read-only again.
  const [editingFor, setEditingFor] = useState(null);
  const editing = Boolean(sessionId) && editingFor === sessionId;
  // Proposal order opens read-only too (Read-First rule); each change in edit
  // mode still saves immediately, so Done only leaves edit mode.
  const [orderEditingFor, setOrderEditingFor] = useState(null);
  const orderEditing = Boolean(sessionId) && orderEditingFor === sessionId;
  const loadGenerationRef = useRef(0);
  const currentLoadRef = useRef({ routeKey: null, generation: 0, ready: false });
  const contextReady = loadedRouteKey === routeKey && currentLoadRef.current.routeKey === routeKey && currentLoadRef.current.ready;

  useEffect(() => {
    if (creationRecoveryRouteRef.current === routeKey) return;
    creationRecoveryRouteRef.current = routeKey;
    setCreatedSessionId(null);
    setInitialSlotCreated(false);
  }, [routeKey]);

  const loadDetail = useCallback(async (id, isCurrent) => {
    const { ok, data: body } = await readJson(`/api/meeting-tracker/sessions/${id}`);
    if (!ok) throw new Error(body.error || 'The meeting session could not be loaded.');
    if (!isCurrent()) return false;
    setSession(body.session);
    setForm(sessionForm(body.session));
    setSlots(body.slots || []);
    return true;
  }, []);

  useEffect(() => {
    if (!router.isReady) return undefined;
    let current = true;
    const generation = ++loadGenerationRef.current;
    const isCurrent = () => current && loadGenerationRef.current === generation && currentLoadRef.current.routeKey === routeKey;
    currentLoadRef.current = { routeKey, generation, ready: false };
    setLoadedRouteKey(null);
    setSession(null);
    setSlots([]);
    setForm(EMPTY_FORM);
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      setBusy(false);
      setSavingSlotId(null);
      setEditingFor(null);
      setOrderEditingFor(null);
      setNotice(null);
      setWarning(null);
      try {
        const dashboardQuery = new URLSearchParams({ projection: 'schedule', ...(cycleCode ? { cycleCode } : {}), ...(programId ? { programId } : {}), scope: 'all' });
        const requests = [readJson('/api/meeting-tracker/recipients'), readJson('/api/meeting-tracker/sessions')];
        if (cycleCode) requests.push(readJson(`/api/meeting-tracker/dashboard?${dashboardQuery}`));
        const envelopes = await Promise.all(requests);
        const bodies = envelopes.map((envelope) => envelope.data);
        if (!isCurrent()) return;
        const failedIndex = envelopes.findIndex((envelope) => !envelope.ok);
        if (failedIndex >= 0) throw new Error(bodies[failedIndex].error || 'The session workspace could not be loaded.');
        setRecipients(bodies[0]);
        setSessions(bodies[1].sessions || []);
        setProposals(bodies[2]?.proposals || []);
        setSelectedRequestId(initialRequestId);
        if (isNew) {
          setForm((value) => ({ ...value, attendees: bodies[0].defaultAttendeeRefs || [] }));
          setNotice(bodies[0].notice || null);
        } else if (sessionId) {
          const detailLoaded = await loadDetail(sessionId, isCurrent);
          if (!detailLoaded || !isCurrent()) return;
        }
        if (!isCurrent()) return;
        currentLoadRef.current = { routeKey, generation, ready: true };
        setLoadedRouteKey(routeKey);
      } catch (loadError) {
        if (isCurrent()) setError(loadError.message);
      } finally {
        if (isCurrent()) setLoading(false);
      }
    }, 0);
    return () => {
      current = false;
      if (currentLoadRef.current.generation === generation) currentLoadRef.current = { routeKey, generation, ready: false };
      window.clearTimeout(timer);
    };
  }, [router.isReady, sessionId, isNew, cycleCode, programId, initialRequestId, routeKey, reloadCount, loadDetail]);

  const proposalById = useMemo(() => new Map(proposals.map((proposal) => [String(proposal.requestId).toLowerCase(), proposal])), [proposals]);
  const sessionMinutes = session ? Math.round((new Date(session.scheduledEndIso) - new Date(session.scheduledStartIso)) / 60000) : Number(form.durationMinutes);
  const slotMinutes = slots.reduce((sum, slot) => sum + Number(slot.wmkf_minutes || 0), 0);
  const overFull = slotMinutes > sessionMinutes;

  const updateForm = (field, value) => { if (contextReady) setForm((current) => ({ ...current, [field]: value })); };
  const toggleAttendee = (ref) => updateForm('attendees', form.attendees.some((row) => sameRef(row, ref))
    ? form.attendees.filter((row) => !sameRef(row, ref))
    : [...form.attendees, ref]);

  const saveSession = async (event) => {
    event.preventDefault();
    if (!contextReady || (!isNew && (!session || session.sessionId !== sessionId))) return;
    const generation = currentLoadRef.current.generation;
    const isCurrent = () => currentLoadRef.current.routeKey === routeKey && currentLoadRef.current.generation === generation && currentLoadRef.current.ready;
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
        : createdSessionId
          ? { session: { sessionId: createdSessionId } }
          : await sendJson('/api/meeting-tracker/sessions', 'POST', payload);
      if (!isCurrent()) return;
      const savedId = body.session.sessionId;
      if (!sessionId && !createdSessionId) setCreatedSessionId(savedId);
      if (!sessionId && initialRequestId && !initialSlotCreated) {
        const proposal = proposalById.get(String(initialRequestId).toLowerCase());
        let slotExists = false;
        if (createdSessionId) {
          const detail = await readJson(`/api/meeting-tracker/sessions/${savedId}`);
          if (!isCurrent()) return;
          if (!detail.ok) throw new Error(detail.data.error || 'The created session could not be checked.');
          slotExists = (detail.data.slots || []).some((slot) => String(slot._wmkf_request_value || '').toLowerCase() === String(initialRequestId).toLowerCase());
        }
        if (slotExists) {
          setInitialSlotCreated(true);
        } else {
          const slotResult = await sendJson('/api/meeting-tracker/slots', 'POST', {
            sessionId: savedId,
            requestId: initialRequestId,
            minutes: 15,
            ...(proposal?.leadPdId ? { leadPdId: proposal.leadPdId } : {}),
          });
          if (!isCurrent()) return;
          setInitialSlotCreated(true);
          setWarning(slotResult.warning || null);
        }
      }
      if (!sessionId) {
        const navigated = await router.replace({ pathname: `/meeting-tracker/sessions/${savedId}`, query: { ...(cycleCode ? { cycleCode } : {}), ...(programId ? { programId } : {}) } });
        if (!isCurrent()) return;
        if (navigated === false) throw new Error('The created session could not be opened. Please try again.');
      } else {
        if (!isCurrent()) return;
        setSession(body.session);
        setForm(sessionForm(body.session));
        setEditingFor(null);
        setNotice('Session saved.');
      }
    } catch (saveError) {
      if (isCurrent()) setError(`${saveError.message} Please try again. If the problem continues, contact an administrator.`);
    } finally {
      if (isCurrent()) setBusy(false);
    }
  };

  const runSlotChange = async (operation, slotId = null) => {
    if (!contextReady || !session || session.sessionId !== sessionId) return;
    const generation = currentLoadRef.current.generation;
    const isCurrent = () => currentLoadRef.current.routeKey === routeKey && currentLoadRef.current.generation === generation && currentLoadRef.current.ready;
    setSavingSlotId(slotId);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await operation();
      if (!isCurrent()) return;
      setWarning(result?.warning || null);
      await loadDetail(sessionId, isCurrent);
    } catch (slotError) {
      if (isCurrent()) setError(`${slotError.message} Please try again. If the problem continues, contact an administrator.`);
    } finally {
      if (isCurrent()) {
        setBusy(false);
        setSavingSlotId(null);
      }
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

  const reorderSlots = (next, movedSlot, targetIndex) => {
    if (!contextReady) return;
    const generation = currentLoadRef.current.generation;
    const isCurrent = () => currentLoadRef.current.routeKey === routeKey && currentLoadRef.current.generation === generation && currentLoadRef.current.ready;
    const movedProposal = proposalById.get(String(movedSlot._wmkf_request_value).toLowerCase());
    const requestNumber = movedProposal?.requestNumber || movedSlot.wmkf_Request?.akoya_requestnum || movedSlot._wmkf_request_value;
    // Optimistic: the row moves now; the save and the ETag-refreshing reload
    // run behind the busy guard. A failed save restores the previous order.
    const previous = slots;
    setSlots(next);
    return runSlotChange(async () => {
      try {
        const result = await reorderSessionSlots({ sessionId, slots: next });
        if (!isCurrent()) return result;
        setNotice(`Moved #${requestNumber} to position ${targetIndex + 1}.`);
        return result;
      } catch (error) {
        if (isCurrent()) setSlots(previous);
        throw error;
      }
    }, movedSlot.wmkf_deliberationslotid);
  };

  const cancelEdit = () => {
    if (session) setForm(sessionForm(session));
    setError(null);
    setEditingFor(null);
  };

  if (loading || (!contextReady && !error)) {
    return <Layout title="Meeting Tracker"><div className="py-24 text-center text-gray-500">Loading the session workspace…</div></Layout>;
  }

  if (!contextReady) {
    return <Layout title="Meeting Tracker"><div className="mx-auto max-w-2xl py-16">
      <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error || 'The session details are not available yet.'}</div>
      <div className="mt-4 flex gap-3"><Button type="button" onClick={() => setReloadCount((count) => count + 1)}>Try again</Button>
        <Link href={{ pathname: '/meeting-tracker', query: { ...(cycleCode ? { cycleCode } : {}), ...(programId ? { programId } : {}) } }} className="text-sm font-semibold text-gray-700 underline">Back to the cycle schedule</Link></div>
    </div></Layout>;
  }

  return (
    <Layout title={isNew ? 'Create session' : 'Meeting session'}>
      <div className="pt-6 mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href={{ pathname: '/meeting-tracker', query: { ...(cycleCode ? { cycleCode } : {}), ...(programId ? { programId } : {}) } }} className="text-sm font-semibold text-gray-600 underline decoration-gray-300 underline-offset-4 hover:text-gray-900">Back to the cycle schedule</Link>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-gray-900">{isNew ? 'Create a deliberation session' : 'Deliberation session'}</h1>
            {!isNew && session && SESSION_STATUS_LABEL[session.status] && (
              <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${SESSION_STATUS_CLASS[session.status]}`}>{SESSION_STATUS_LABEL[session.status]}</span>
            )}
          </div>
          {(isNew || editing) && <p className="mt-2 text-sm text-gray-600">Set the meeting details, attendees, and proposal order.</p>}
        </div>
        {!isNew && session?.meetingLink && <a href={session.meetingLink} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-gray-900 px-5 py-3 text-sm font-semibold text-white hover:bg-gray-800">Join meeting</a>}
      </div>

      {error && <div role="alert" className="mb-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
      {notice && <div role="status" className="mb-5 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">{notice}</div>}
      {(warning || overFull) && <div role="status" className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{warning?.message || `Scheduled discussion time is ${slotMinutes - sessionMinutes} minutes longer than this session.`}</div>}

      {!isNew && session && !editing ? (
        <SessionSummary session={session} recipients={recipients} onEdit={() => { setNotice(null); setEditingFor(sessionId); }} />
      ) : (
      <form onSubmit={saveSession} className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        {createdSessionId && <p role="status" className="mb-5 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">The session has been created. Its details are locked while you continue to the saved session.</p>}
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm font-medium text-gray-700">Date and start time<input required type="datetime-local" disabled={Boolean(createdSessionId)} value={form.startLocal} onChange={(event) => updateForm('startLocal', event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
          <label className="text-sm font-medium text-gray-700">Duration in minutes<input required type="number" min="1" disabled={Boolean(createdSessionId)} value={form.durationMinutes} onChange={(event) => updateForm('durationMinutes', event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
          <label className="text-sm font-medium text-gray-700">Time zone<input required disabled={Boolean(createdSessionId)} value={form.ianaTimeZone} onChange={(event) => updateForm('ianaTimeZone', event.target.value)} placeholder="America/Los_Angeles" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
          <label className="text-sm font-medium text-gray-700">Status<select disabled={Boolean(createdSessionId)} value={form.status} onChange={(event) => updateForm('status', Number(event.target.value))} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2"><option value="100000000">Planned</option><option value="100000001">Held</option><option value="100000002">Cancelled</option></select></label>
          <label className="text-sm font-medium text-gray-700 md:col-span-2">Location<input disabled={Boolean(createdSessionId)} value={form.location} onChange={(event) => updateForm('location', event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
          <label className="text-sm font-medium text-gray-700 md:col-span-2">Zoom link<input type="url" disabled={Boolean(createdSessionId)} value={form.meetingLink} onChange={(event) => updateForm('meetingLink', event.target.value)} placeholder="https://zoom.us/…" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
          <label className="text-sm font-medium text-gray-700 md:col-span-2 lg:col-span-4">Notes<textarea rows="3" disabled={Boolean(createdSessionId)} value={form.notes} onChange={(event) => updateForm('notes', event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
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
            {[['Staff', recipients.staff], ['Board', recipients.board]].map(([label, rows]) => <div key={label}><h2 className="text-sm font-semibold text-gray-700">{label}</h2><div className="mt-2 flex flex-wrap gap-2">{rows.map((person) => { const selected = form.attendees.some((ref) => sameRef(ref, person.ref)); const noEmail = !person.email; return <button key={`${person.ref.kind}-${person.ref.profileId || person.ref.rosterId}`} type="button" aria-pressed={selected} disabled={Boolean(createdSessionId) || (noEmail && !selected)} title={noEmail ? noEmailHint(person) : undefined} onClick={() => toggleAttendee(person.ref)} className={`rounded-full border px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${selected ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>{person.name}{noEmail ? ' · no email' : ''}</button>; })}{rows.length === 0 && <p className="text-sm text-gray-500">No eligible people found.</p>}{rows.some((person) => !person.email) && <p className="w-full text-xs text-gray-500">{NO_EMAIL_SECTION_HINT}</p>}</div></div>)}
          </div>
        </fieldset>

        <div className="mt-6 flex justify-end gap-3">
          {!isNew && session && <Button type="button" variant="outline" disabled={busy} onClick={cancelEdit}>Cancel</Button>}
          <Button type="submit" loading={busy}>{createdSessionId ? 'Continue to created session' : isNew ? 'Create session' : 'Save session'}</Button>
        </div>
      </form>
      )}

      {!isNew && (
        <section className="mt-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div><h2 className="text-xl font-semibold text-gray-900">Proposal order</h2><p className="mt-1 text-sm text-gray-600">{slotMinutes} discussion minutes across {slots.length} proposal{slots.length === 1 ? '' : 's'}.</p></div>
            {!orderEditing ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setOrderEditingFor(sessionId)}>Edit proposal order</Button>
            ) : <div className="flex min-w-[18rem] gap-2"><select aria-label="Proposal to add" value={selectedRequestId} onChange={(event) => setSelectedRequestId(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2"><option value="">Choose a proposal</option>{proposals.filter((proposal) => !slots.some((slot) => String(slot._wmkf_request_value).toLowerCase() === String(proposal.requestId).toLowerCase())).map((proposal) => <option key={proposal.requestId} value={proposal.requestId}>{proposal.isTestRequest ? 'TEST · ' : ''}#{proposal.requestNumber} · {proposal.title}</option>)}</select><Button type="button" size="sm" disabled={!selectedRequestId || busy} onClick={addSlot}>Add</Button><Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setOrderEditingFor(null)}>Done</Button></div>}
          </div>
          {orderEditing && <p className="mt-2 text-xs text-gray-500">Changes to the order, minutes, and proposals save as you make them.</p>}
          {slots.length ? (
            <ProposalOrderList
              slots={slots}
              proposalById={proposalById}
              sessions={sessions}
              sessionId={sessionId}
              cycleCode={cycleCode}
              programId={programId}
              busy={busy}
              savingSlotId={savingSlotId}
              onChange={(row, patch) => runSlotChange(() => sendJson(`/api/meeting-tracker/slots/${row.wmkf_deliberationslotid}`, 'PATCH', { etag: row._etag, ...patch }), row.wmkf_deliberationslotid)}
              onMove={(row, targetSessionId) => runSlotChange(() => sendJson(`/api/meeting-tracker/slots/${row.wmkf_deliberationslotid}`, 'PATCH', { etag: row._etag, targetSessionId }), row.wmkf_deliberationslotid)}
              onRemove={(row) => runSlotChange(() => sendJson(`/api/meeting-tracker/slots/${row.wmkf_deliberationslotid}`, 'DELETE', { etag: row._etag }), row.wmkf_deliberationslotid)}
              onReorder={reorderSlots}
              readOnly={!orderEditing}
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
