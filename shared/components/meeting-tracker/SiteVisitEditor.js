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
import Layout, { Button } from '../Layout';
import { SITE_VISIT_FORMAT, SITE_VISIT_FORMAT_LABEL } from '../../config/siteVisit';

const DEFAULT_TIME_ZONE = 'America/Los_Angeles';

function emptyForm(requestNumber) {
  return {
    subject: requestNumber ? `Site Visit — #${requestNumber}` : 'Site Visit',
    description: '',
    startLocal: '',
    endLocal: '',
    timeZone: DEFAULT_TIME_ZONE,
    format: SITE_VISIT_FORMAT.IN_PERSON,
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
    format: visit.format ?? SITE_VISIT_FORMAT.IN_PERSON,
    locationOrLink: visit.locationOrLink || '',
    organizer: visit.organizer || null,
    requiredAttendees: visit.requiredAttendees || [],
    optionalAttendees: visit.optionalAttendees || [],
  };
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

async function readJson(response, fallback) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || fallback);
    error.code = body.code;
    error.status = response.status;
    throw error;
  }
  return body;
}

function Chip({ selected, onClick, children, disabled }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${selected ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}
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

  const load = useCallback(async () => {
    if (!requestId) return;
    setLoading(true);
    setError(null);
    try {
      const [visitResponse, recipientsResponse] = await Promise.all([
        fetch(`/api/meeting-tracker/visits/${encodeURIComponent(requestId)}`),
        fetch('/api/meeting-tracker/recipients'),
      ]);
      const visitBody = await readJson(visitResponse, 'The site visit could not be loaded.');
      const recipientBody = await readJson(recipientsResponse, 'The attendee directory could not be loaded.');
      setVisit(visitBody.siteVisit || null);
      setForm(formFromVisit(visitBody.siteVisit, requestNumber));
      setRecipients({ staff: recipientBody.staff || [], board: recipientBody.board || [] });
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
      const response = await fetch(`/api/meeting-tracker/visits/${encodeURIComponent(requestId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await readJson(response, 'The site visit could not be saved.');
      setVisit(body.siteVisit);
      setForm(formFromVisit(body.siteVisit, requestNumber));
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

  const backHref = { pathname: '/meeting-tracker', query: { ...(cycleCode ? { cycleCode } : {}), ...(programId ? { programId } : {}) } };
  const backLink = <Link href={backHref} className="text-sm font-semibold text-gray-600 underline decoration-gray-300 underline-offset-4 hover:text-gray-900">Back to the cycle schedule</Link>;
  const manualRows = [...form.requiredAttendees, ...form.optionalAttendees].filter((ref) => ref.kind === 'manual');
  const canSave = Boolean(form.organizer && form.startLocal && form.endLocal && form.timeZone.trim() && form.locationOrLink.trim() && form.subject.trim()) && !busy;

  return (
    <Layout title={visit ? 'Site visit' : 'Schedule site visit'}>
      <div className="mb-6">
        {backLink}
        <h1 className="mt-3 text-3xl font-semibold text-gray-900">{visit ? 'Site visit' : 'Schedule the site visit'}{requestNumber ? ` · #${requestNumber}` : ''}</h1>
        <p className="mt-2 text-gray-600">The date here feeds the Staff Deliberations rail, the cycle view, the briefing page, and the Share email's calendar entry.</p>
      </div>

      {error && <div role="alert" className="mb-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
      {notice && <div role="status" className="mb-5 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">{notice}</div>}

      {loading ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500">Loading the site visit…</div>
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
                      {rows.map((person) => (
                        <Chip key={refKey(person.ref)} selected={form[role].some((ref) => sameRef(ref, person.ref))} disabled={busy} onClick={() => toggleIn(role, person.ref)}>{person.name}</Chip>
                      ))}
                      {rows.length === 0 && <p className="text-sm text-gray-500">No eligible people found.</p>}
                    </div>
                  </div>
                ))}
              </div>
            </fieldset>
          ))}

          <fieldset className="mt-6 border-t border-gray-100 pt-5">
            <legend className="text-base font-semibold text-gray-900">Applicant-side attendees</legend>
            <p className="mt-1 text-sm text-gray-600">People outside the foundation, such as the project leader. They receive the calendar entry.</p>
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

          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-gray-200 pt-5">
            {backLink}
            <div className="flex items-center gap-4">
              {notice && <p role="status" className="text-sm font-medium text-blue-800">{notice}</p>}
              <Button type="submit" loading={busy} disabled={!canSave}>{visit ? 'Save site visit' : 'Schedule site visit'}</Button>
            </div>
          </div>
        </form>
      )}
    </Layout>
  );
}
