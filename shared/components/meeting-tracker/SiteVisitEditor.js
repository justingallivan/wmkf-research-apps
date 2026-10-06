/**
 * Site visit editor inside the Meeting Tracker (PC Meeting Tracker plan §5.1,
 * slice 2b). One visit per request, written through the existing Site Visit
 * logistics service via /api/meeting-tracker/visits/[requestId]; the Activity
 * stays the record the Staff Deliberations rail, the cycle view, the briefing
 * page, and the Share email already read. Attendees are staff/Board references
 * from the tracker's recipient directory plus manual applicant-side entries.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { requestEnvelope } from '../../utils/api-request';
import Layout, { Button } from '../Layout';
import { SITE_VISIT_FORMAT, SITE_VISIT_FORMAT_LABEL, SITE_VISIT_LIMITS } from '../../config/siteVisit';
import SiteVisitMaterialsCard from './SiteVisitMaterialsCard';
import RecordingAndTranscriptCard from './RecordingAndTranscriptCard';

const DEFAULT_TIME_ZONE = 'America/Los_Angeles';

function emptyForm(requestNumber) {
  return {
    subject: requestNumber ? `Site Visit — #${requestNumber}` : 'Site Visit',
    description: '',
    startLocal: '',
    endLocal: '',
    timeZone: DEFAULT_TIME_ZONE,
    // Virtual by default (owner 2026-09-10): most visits are Zoom, and a
    // pasted link with "In person" left in place was the first thing seen.
    format: SITE_VISIT_FORMAT.VIRTUAL,
    locationOrLink: '',
    organizer: null,
    requiredAttendees: [],
    optionalAttendees: [],
  };
}

function formFromVisit(visit, requestNumber) {
  if (!visit) return emptyForm(requestNumber);
  return {
    subject: visit.subject || `Site Visit — #${requestNumber}`,
    description: visit.description || '',
    startLocal: visit.startLocal || '',
    endLocal: visit.endLocal || '',
    timeZone: visit.timeZone || DEFAULT_TIME_ZONE,
    format: visit.format ?? SITE_VISIT_FORMAT.VIRTUAL,
    locationOrLink: visit.locationOrLink || '',
    organizer: visit.organizer || null,
    requiredAttendees: visit.requiredAttendees || [],
    optionalAttendees: visit.optionalAttendees || [],
  };
}

function emailForRef(ref, directory) {
  if (ref?.kind === 'manual') return String(ref.email || '').trim().toLowerCase();
  const people = ref?.kind === 'staff' ? directory?.staff || [] : ref?.kind === 'roster' ? directory?.board || [] : [];
  return String(people.find((person) => sameRef(person.ref, ref))?.email || '').trim().toLowerCase();
}

export function withApplicantAttendees(form, suggestions, directory) {
  const seen = new Set([form.organizer, ...form.requiredAttendees, ...form.optionalAttendees]
    .map((ref) => emailForRef(ref, directory)).filter(Boolean));
  const added = [];
  for (const suggestion of suggestions || []) {
    if (form.requiredAttendees.length + added.length >= SITE_VISIT_LIMITS.attendeesPerRole) break;
    const email = String(suggestion?.email || '').trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    added.push({ kind: 'manual', name: suggestion.name || email, email });
  }
  return added.length ? { ...form, requiredAttendees: [...form.requiredAttendees, ...added] } : form;
}

export function sameRef(left, right) {
  if (!left || !right || left.kind !== right.kind) return false;
  if (left.kind === 'staff') return left.profileId === right.profileId;
  if (left.kind === 'roster') return left.rosterId === right.rosterId;
  return String(left.email || '').toLowerCase() === String(right.email || '').toLowerCase();
}

function refKey(ref) {
  return `${ref.kind}-${ref.profileId ?? ref.rosterId ?? ref.email}`;
}

async function readJson(url, options, fallback) {
  const { ok: resOk, status: resStatus, data: body } = await requestEnvelope(url, { ...options, tolerantBody: true });
  if (!resOk) {
    const error = new Error(body.error || fallback);
    error.code = body.code;
    error.status = resStatus;
    throw error;
  }
  return body;
}

const NO_EMAIL_SECTION_HINT = 'Greyed names have no email on file; hover a name for the reason.';
export const noEmailHint = (person) => person?.linked
  ? 'No email on file. The linked Dataverse contact is inactive, missing, or has no primary email; fix or relink the contact, or unlink the roster row.'
  : 'No email on file. Add a preferred email on the Expertise Finder roster before this person can be added.';

// 'YYYY-MM-DDTHH:mm' wall-clock strings in the visit's own time zone; format
// them as written (UTC on both sides) so the viewer's zone never shifts them.
function wallClock(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value || '');
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, mi));
}

export function visitWhen(visit) {
  const start = wallClock(visit?.startLocal);
  const end = wallClock(visit?.endLocal);
  if (!start) return 'Not scheduled';
  const day = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(start);
  const time = (date) => new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(date);
  const sameDay = end && end.toISOString().slice(0, 10) === start.toISOString().slice(0, 10);
  const range = end ? (sameDay ? `${time(start)} – ${time(end)}` : `${time(start)} – ${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(end)}, ${time(end)}`) : time(start);
  return `${day} · ${range}${visit.timeZone ? ` (${visit.timeZone})` : ''}`;
}

function personName(ref, directory) {
  if (!ref) return null;
  if (ref.kind === 'manual') return ref.name || ref.email;
  const people = ref.kind === 'staff' ? directory.staff : ref.kind === 'roster' ? directory.board : [];
  return people.find((person) => sameRef(person.ref, ref))?.name || 'Person no longer in the directory';
}

function VisitSummary({ visit, directory, onEdit }) {
  const link = /^https?:\/\//i.test(visit.locationOrLink || '') ? visit.locationOrLink : null;
  let linkHost = null;
  try { linkHost = link ? new URL(link).hostname : null; } catch { linkHost = null; }
  const names = (refs) => (refs || []).map((ref) => personName(ref, directory)).filter(Boolean);
  const required = names(visit.requiredAttendees);
  const optional = names(visit.optionalAttendees);
  const row = (label, value) => (
    <div>
      <dt className="text-sm font-medium text-gray-500">{label}</dt>
      <dd className="mt-1 text-sm text-gray-900">{value}</dd>
    </div>
  );
  return (
    <section aria-labelledby="visit-details-heading" className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="visit-details-heading" className="text-base font-semibold text-gray-900">Visit details</h2>
        <Button type="button" variant="outline" size="sm" onClick={onEdit}>Edit visit details</Button>
      </div>
      <dl className="mt-4 grid gap-x-8 gap-y-4 md:grid-cols-2">
        {row('When', visitWhen(visit))}
        {row('Format', SITE_VISIT_FORMAT_LABEL[visit.format] || 'Not set')}
        {row(link ? 'Meeting link' : 'Location', link
          ? <a href={link} target="_blank" rel="noopener noreferrer" className="font-medium text-gray-900 underline underline-offset-4 hover:text-gray-700">Open meeting link{linkHost ? ` (${linkHost})` : ''}</a>
          : (visit.locationOrLink || 'Not set'))}
        {row('Organizer', personName(visit.organizer, directory) || 'Not set')}
        {row(`Required attendees (${required.length})`, required.length ? required.join(', ') : 'None')}
        {row(`Optional attendees (${optional.length})`, optional.length ? optional.join(', ') : 'None')}
        {visit.description && <div className="md:col-span-2">{row('Notes', <span className="whitespace-pre-line">{visit.description}</span>)}</div>}
      </dl>
    </section>
  );
}

function Chip({ selected, onClick, children, disabled, title }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${selected ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}
    >
      {children}
    </button>
  );
}

export default function SiteVisitEditor() {
  const router = useRouter();
  const requestId = Array.isArray(router.query.requestId) ? '' : router.query.requestId || '';
  const requestNumber = Array.isArray(router.query.n) ? '' : router.query.n || '';
  const cycleCode = Array.isArray(router.query.cycleCode) ? '' : router.query.cycleCode || '';
  const programId = Array.isArray(router.query.programId) ? '' : router.query.programId || '';
  const [visit, setVisit] = useState(null);
  const [form, setForm] = useState(() => emptyForm(requestNumber));
  const [recipients, setRecipients] = useState({ staff: [], board: [] });
  const [manual, setManual] = useState({ name: '', email: '', role: 'required' });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [applicantAttendees, setApplicantAttendees] = useState([]);
  const [applicantAttendeesUnavailable, setApplicantAttendeesUnavailable] = useState(false);
  // A saved visit opens read-only (DESIGN.md Read-First Rule). Keyed to the
  // request so a client-side move to another visit starts read-only again.
  const [editingFor, setEditingFor] = useState(null);
  const editing = Boolean(requestId) && editingFor === requestId;

  const load = useCallback(async () => {
    if (!requestId) return;
    setLoading(true);
    setError(null);
    try {
      // Both GETs in flight together (as before the migration); the visit
      // result is settled first so its failure always wins the banner.
      const [visitSettled, recipientSettled] = await Promise.allSettled([
        readJson(`/api/meeting-tracker/visits/${encodeURIComponent(requestId)}`, undefined, 'The site visit could not be loaded.'),
        readJson('/api/meeting-tracker/recipients', undefined, 'The attendee directory could not be loaded.'),
      ]);
      if (visitSettled.status === 'rejected') throw visitSettled.reason;
      if (recipientSettled.status === 'rejected') throw recipientSettled.reason;
      const visitBody = visitSettled.value;
      const recipientBody = recipientSettled.value;
      const directory = { staff: recipientBody.staff || [], board: recipientBody.board || [] };
      setVisit(visitBody.siteVisit || null);
      const savedForm = formFromVisit(visitBody.siteVisit, requestNumber);
      setForm(visitBody.siteVisit ? savedForm : withApplicantAttendees(savedForm, visitBody.applicantAttendees, directory));
      setRecipients(directory);
      setApplicantAttendees(visitBody.applicantAttendees || []);
      setApplicantAttendeesUnavailable(visitBody.applicantAttendeesUnavailable === true);
    } catch (loadError) {
      setError(`${loadError.message} Please try again. If the problem continues, contact an administrator.`);
    } finally {
      setLoading(false);
    }
  }, [requestId, requestNumber]);

  useEffect(() => {
    if (!router.isReady) return;
    void load();
  }, [router.isReady, load]);

  const updateForm = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const toggleIn = (role, ref) => setForm((current) => {
    const list = current[role];
    const other = role === 'requiredAttendees' ? 'optionalAttendees' : 'requiredAttendees';
    const present = list.some((row) => sameRef(row, ref));
    return {
      ...current,
      [role]: present ? list.filter((row) => !sameRef(row, ref)) : [...list, ref],
      // One role per person: adding to one list removes from the other.
      [other]: current[other].filter((row) => !sameRef(row, ref)),
    };
  });
  const addManual = () => {
    const email = manual.email.trim().toLowerCase();
    if (!email) return;
    toggleIn(manual.role === 'optional' ? 'optionalAttendees' : 'requiredAttendees', { kind: 'manual', name: manual.name.trim() || email, email });
    setManual({ name: '', email: '', role: manual.role });
  };

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const payload = {
        ...(visit ? { activityId: visit.activityId, etag: visit.etag } : {}),
        subject: form.subject,
        description: form.description,
        startLocal: form.startLocal,
        endLocal: form.endLocal,
        timeZone: form.timeZone,
        format: Number(form.format),
        locationOrLink: form.locationOrLink,
        organizer: form.organizer,
        requiredAttendees: form.requiredAttendees,
        optionalAttendees: form.optionalAttendees,
      };
      const body = await readJson(`/api/meeting-tracker/visits/${encodeURIComponent(requestId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      }, 'The site visit could not be saved.');
      setVisit(body.siteVisit);
      setForm(formFromVisit(body.siteVisit, requestNumber));
      setEditingFor(null);
      setNotice('Site visit saved.');
    } catch (saveError) {
      if (saveError.code === 'site_visit_write_conflict') {
        // Reload first (it clears the banner), then explain on top of fresh data.
        await load();
        setError('The site visit changed since this page loaded. It has been reloaded; review and save again.');
      } else {
        setError(`${saveError.message} Please try again. If the problem continues, contact an administrator.`);
      }
    } finally {
      setBusy(false);
    }
  };

  const cancelEdit = () => {
    setForm(formFromVisit(visit, requestNumber));
    setManual({ name: '', email: '', role: 'required' });
    setError(null);
    setEditingFor(null);
  };

  const backHref = { pathname: '/meeting-tracker', query: { ...(cycleCode ? { cycleCode } : {}), ...(programId ? { programId } : {}) } };
  const backLink = <Link href={backHref} className="text-sm font-semibold text-gray-600 underline decoration-gray-300 underline-offset-4 hover:text-gray-900">Back to the cycle schedule</Link>;
  const manualRows = [...form.requiredAttendees, ...form.optionalAttendees].filter((ref) => ref.kind === 'manual');
  const missingApplicantAttendees = visit ? applicantAttendees.filter((person) => withApplicantAttendees(form, [person], recipients) !== form) : [];
  const canSave = Boolean(form.organizer && form.startLocal && form.endLocal && form.timeZone.trim() && form.locationOrLink.trim() && form.subject.trim()) && !busy;

  return (
    <Layout title={visit ? 'Site visit' : 'Schedule site visit'}>
      <div className="pt-6 mb-6">
        {backLink}
        <h1 className="mt-3 text-2xl font-semibold text-gray-900">{visit ? 'Site visit' : 'Schedule the site visit'}{requestNumber ? ` · #${requestNumber}` : ''}</h1>
        {(!visit || editing) && <p className="mt-2 text-sm text-gray-600">The date here feeds the Staff Deliberations rail, the cycle view, the briefing page, and the Share email's calendar entry.</p>}
      </div>

      {error && <div role="alert" className="mb-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
      {notice && <div role="status" className="mb-5 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">{notice}</div>}

      {loading ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500">Loading the site visit…</div>
      ) : visit && !editing ? (
        <VisitSummary visit={visit} directory={recipients} onEdit={() => { setNotice(null); setEditingFor(requestId); }} />
      ) : (
        <form onSubmit={save} className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm font-medium text-gray-700 md:col-span-2">Subject<input required value={form.subject} onChange={(event) => updateForm('subject', event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
            <label className="text-sm font-medium text-gray-700">Format<select value={form.format} onChange={(event) => updateForm('format', Number(event.target.value))} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2">{Object.values(SITE_VISIT_FORMAT).map((value) => <option key={value} value={value}>{SITE_VISIT_FORMAT_LABEL[value]}</option>)}</select></label>
            <label className="text-sm font-medium text-gray-700">Time zone<input required value={form.timeZone} onChange={(event) => updateForm('timeZone', event.target.value)} placeholder={DEFAULT_TIME_ZONE} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
            <label className="text-sm font-medium text-gray-700 md:col-span-2">Starts<input required type="datetime-local" value={form.startLocal} onChange={(event) => updateForm('startLocal', event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
            <label className="text-sm font-medium text-gray-700 md:col-span-2">Ends<input required type="datetime-local" value={form.endLocal} onChange={(event) => updateForm('endLocal', event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
            <label className="text-sm font-medium text-gray-700 md:col-span-2 lg:col-span-4">Location or meeting link<input required value={form.locationOrLink} onChange={(event) => updateForm('locationOrLink', event.target.value)} placeholder="Campus address, or an https:// meeting link for a virtual visit" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
            <label className="text-sm font-medium text-gray-700 md:col-span-2 lg:col-span-4">Notes<textarea rows="3" value={form.description} onChange={(event) => updateForm('description', event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
          </div>

          <fieldset className="mt-6 border-t border-gray-100 pt-5">
            <legend className="text-base font-semibold text-gray-900">Organizer</legend>
            <p className="mt-1 text-sm text-gray-600">The staff member who owns the visit and the calendar entry.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {recipients.staff.map((person) => (
                <Chip key={refKey(person.ref)} selected={sameRef(form.organizer, person.ref)} disabled={busy} onClick={() => updateForm('organizer', sameRef(form.organizer, person.ref) ? null : person.ref)}>{person.name}</Chip>
              ))}
              {recipients.staff.length === 0 && <p className="text-sm text-gray-500">No staff found in the directory.</p>}
            </div>
          </fieldset>

          {[['requiredAttendees', 'Required attendees'], ['optionalAttendees', 'Optional attendees']].map(([role, label]) => (
            <fieldset key={role} className="mt-6 border-t border-gray-100 pt-5">
              <legend className="text-base font-semibold text-gray-900">{label}</legend>
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                {[['Staff', recipients.staff], ['Board', recipients.board]].map(([group, rows]) => (
                  <div key={group}>
                    <h2 className="text-sm font-semibold text-gray-700">{group}</h2>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {rows.map((person) => {
                        const selected = form[role].some((ref) => sameRef(ref, person.ref));
                        const noEmail = !person.email;
                        return (
                          <Chip key={refKey(person.ref)} selected={selected} disabled={busy || (noEmail && !selected)} title={noEmail ? noEmailHint(person) : undefined} onClick={() => toggleIn(role, person.ref)}>{person.name}{noEmail ? ' · no email' : ''}</Chip>
                        );
                      })}
                      {rows.length === 0 && <p className="text-sm text-gray-500">No eligible people found.</p>}
                      {rows.some((person) => !person.email) && <p className="w-full text-xs text-gray-500">{NO_EMAIL_SECTION_HINT}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </fieldset>
          ))}

          <fieldset className="mt-6 border-t border-gray-100 pt-5">
            <legend className="text-base font-semibold text-gray-900">Applicant-side attendees</legend>
            <p className="mt-1 text-sm text-gray-600">People outside the foundation, such as the project leader. They receive the calendar entry.</p>
            <p className="mt-1 text-xs text-gray-500">New visits prefill the Project Leader and primary contact from AkoyaGo when they have email addresses. For a saved visit, add any missing contacts below, then save to include them in the calendar entry.</p>
            {applicantAttendeesUnavailable && <p role="status" className="mt-1 text-xs text-amber-800">Applicant contacts could not be loaded. Add attendees manually or reload the page.</p>}
            {missingApplicantAttendees.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <p className="w-full text-xs font-medium text-gray-600">Suggested from AkoyaGo</p>
                {missingApplicantAttendees.map((person) => (
                  <Button key={person.email.toLowerCase()} type="button" size="sm" disabled={busy} onClick={() => setForm((current) => withApplicantAttendees(current, [person], recipients))}>
                    Add {person.name || person.email} ({person.email})
                  </Button>
                ))}
              </div>
            )}
            {manualRows.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-2">
                {manualRows.map((ref) => (
                  <li key={refKey(ref)}>
                    <Chip selected disabled={busy} onClick={() => toggleIn(form.requiredAttendees.some((row) => sameRef(row, ref)) ? 'requiredAttendees' : 'optionalAttendees', ref)}>
                      {ref.name} · {ref.email}{form.optionalAttendees.some((row) => sameRef(row, ref)) ? ' (optional)' : ''} ×
                    </Chip>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 grid gap-3 md:grid-cols-4">
              <label className="text-sm font-medium text-gray-700">Name<input value={manual.name} onChange={(event) => setManual({ ...manual, name: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
              <label className="text-sm font-medium text-gray-700 md:col-span-2">Email<input type="email" value={manual.email} onChange={(event) => setManual({ ...manual, email: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
              <div className="flex items-end gap-2">
                <label className="flex-1 text-sm font-medium text-gray-700">Role<select value={manual.role} onChange={(event) => setManual({ ...manual, role: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2"><option value="required">Required</option><option value="optional">Optional</option></select></label>
                <Button type="button" size="sm" disabled={!manual.email.trim() || busy} onClick={addManual}>Add</Button>
              </div>
            </div>
          </fieldset>

          <div className="mt-6 flex flex-wrap items-center justify-end gap-4 border-t border-gray-200 pt-5">
            {notice && <p role="status" className="text-sm font-medium text-blue-800">{notice}</p>}
            {visit && <Button type="button" variant="outline" disabled={busy} onClick={cancelEdit}>Cancel</Button>}
            <Button type="submit" loading={busy} disabled={!canSave}>{visit ? 'Save site visit' : 'Schedule site visit'}</Button>
          </div>
        </form>
      )}

      {!loading && visit && <SiteVisitMaterialsCard requestId={requestId} requestNumber={requestNumber} />}
      {!loading && visit && <RecordingAndTranscriptCard requestId={requestId} />}
    </Layout>
  );
}
