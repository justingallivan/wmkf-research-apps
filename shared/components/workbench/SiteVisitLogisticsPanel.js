import { useEffect, useMemo, useRef, useState } from 'react';
import { Card } from '../Layout';
import {
  normalizeSiteVisitEmail,
  SITE_VISIT_FORMAT,
  SITE_VISIT_FORMAT_LABEL,
} from '../../config/siteVisit';

function refKey(ref) {
  if (ref?.kind === 'staff') return `staff:${ref.profileId}`;
  if (ref?.kind === 'roster') return `roster:${ref.rosterId}`;
  if (ref?.kind === 'manual') return `manual:${ref.email}`;
  return '';
}

function defaultForm(requestNumber) {
  return {
    activityId: null,
    etag: null,
    subject: `Site Visit${requestNumber ? ` — ${requestNumber}` : ''}`,
    description: '',
    startDate: '',
    startTime: '',
    endDate: '',
    endTime: '',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago',
    disambiguation: 'earlier',
    format: SITE_VISIT_FORMAT.IN_PERSON,
    locationOrLink: '',
    organizer: '',
    requiredAttendees: [],
    optionalAttendees: [],
  };
}

function formFromVisit(visit, requestNumber) {
  if (!visit) return defaultForm(requestNumber);
  const start = splitLocal(visit.startLocal);
  const end = splitLocal(visit.endLocal);
  return {
    activityId: visit.activityId,
    etag: visit.etag,
    subject: visit.subject || '',
    description: visit.description || '',
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
    timeZone: visit.timeZone || 'America/Chicago',
    disambiguation: 'earlier',
    format: visit.format,
    locationOrLink: visit.locationOrLink || '',
    organizer: refKey(visit.organizer),
    requiredAttendees: (visit.requiredAttendees || []).map(refKey),
    optionalAttendees: (visit.optionalAttendees || []).map(refKey),
  };
}

function splitLocal(localDateTime) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(localDateTime || '');
  return match ? { date: match[1], time: match[2] } : { date: '', time: '' };
}

function joinLocal(date, time) {
  return date && time ? `${date}T${time}` : '';
}

function defaultEndLocal(startLocal) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(startLocal);
  if (!match) return startLocal;
  const [, year, month, day, hour, minute] = match;
  const value = new Date(Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute) + 60,
  ));
  return value.toISOString().slice(0, 16);
}

export default function SiteVisitLogisticsPanel({ requestId, requestNumber, onContext }) {
  const [form, setForm] = useState(() => defaultForm(requestNumber));
  const [directory, setDirectory] = useState({ staff: [], external: [] });
  const [manualRecipients, setManualRecipients] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const sequence = useRef(0);
  const endTouched = useRef({ date: false, time: false });

  const entries = useMemo(() => {
    const rows = [
      ...directory.staff.map((row) => ({ ...row, key: refKey(row), group: 'WMKF staff' })),
      ...directory.external.map((row) => ({ ...row, key: refKey(row), group: row.roleType })),
      ...manualRecipients.map((row) => ({ ...row, key: refKey(row), group: 'Manual' })),
    ];
    return rows;
  }, [directory, manualRecipients]);
  const byKey = useMemo(() => new Map(entries.map((row) => [row.key, row])), [entries]);
  const emailForKey = (key) => normalizeSiteVisitEmail(byKey.get(key)?.email);
  const organizerEmail = emailForKey(form.organizer);
  const attendeeEntries = organizerEmail
    ? entries.filter((row) => (
      normalizeSiteVisitEmail(row.email) !== organizerEmail || row.key === form.organizer
    ))
    : entries;

  const emitContext = (visit, nextMaterials = materials, nextDirectory = directory) => {
    const lookup = new Map([
      ...nextDirectory.staff.map((row) => [refKey(row), row]),
      ...nextDirectory.external.map((row) => [refKey(row), row]),
    ]);
    const emails = (refs) => (refs || []).filter(Boolean).map((ref) => (
      ref.kind === 'manual' ? ref : lookup.get(refKey(ref))
    )).filter((row) => row?.email).map((row) => row.email);
    onContext?.({
      siteVisit: visit,
      materials: nextMaterials,
      suggestedTo: visit ? emails([visit.organizer, ...visit.requiredAttendees]) : [],
      suggestedCc: visit ? emails(visit.optionalAttendees) : [],
    });
  };

  useEffect(() => {
    const current = ++sequence.current;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    Promise.all([
      fetch(`/api/workbench/site-visit/logistics?requestId=${encodeURIComponent(requestId)}`, {
        signal: controller.signal,
      }),
      fetch('/api/workbench/site-visit/recipients', { signal: controller.signal }),
    ]).then(async ([logisticsResponse, directoryResponse]) => {
      const logisticsBody = await logisticsResponse.json().catch(() => ({}));
      const directoryBody = await directoryResponse.json().catch(() => ({}));
      if (!logisticsResponse.ok) throw new Error(logisticsBody.error || 'Site Visit logistics could not be loaded.');
      if (!directoryResponse.ok) throw new Error(directoryBody.error || 'Recipient directory could not be loaded.');
      if (sequence.current !== current) return;
      const nextDirectory = {
        staff: directoryBody.staff || [],
        external: directoryBody.external || [],
      };
      const nextMaterials = logisticsBody.materials || [];
      const nextManual = [
        ...(logisticsBody.siteVisit?.requiredAttendees || []),
        ...(logisticsBody.siteVisit?.optionalAttendees || []),
      ].filter((ref) => ref.kind === 'manual');
      setDirectory(nextDirectory);
      setManualRecipients(nextManual);
      setMaterials(nextMaterials);
      endTouched.current = {
        date: Boolean(logisticsBody.siteVisit?.endLocal),
        time: Boolean(logisticsBody.siteVisit?.endLocal),
      };
      setForm(formFromVisit(logisticsBody.siteVisit, requestNumber));
      emitContext(logisticsBody.siteVisit || null, nextMaterials, nextDirectory);
    }).catch((loadError) => {
      if (loadError?.name !== 'AbortError' && sequence.current === current) setError(loadError.message);
    }).finally(() => {
      if (sequence.current === current) setLoading(false);
    });
    return () => {
      sequence.current += 1;
      controller.abort();
    };
    // requestId owns this component's lifecycle; parent keys it by request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId]);

  const edit = (patch) => {
    setForm((current) => ({
      ...current,
      ...(typeof patch === 'function' ? patch(current) : patch),
    }));
    setSaved(false);
    setError(null);
  };

  const withoutEmail = (keys, email) => {
    if (!email) return keys;
    return keys.filter((key) => emailForKey(key) !== email);
  };

  const editOrganizer = (organizer) => {
    const email = emailForKey(organizer);
    edit((current) => ({
      organizer,
      requiredAttendees: withoutEmail(current.requiredAttendees, email),
      optionalAttendees: withoutEmail(current.optionalAttendees, email),
    }));
  };

  const editAttendeeRole = (key, role) => {
    if (!['', 'required', 'optional'].includes(role)) return;
    const email = emailForKey(key);
    if (!email) {
      if (role !== '') return;
      edit((current) => ({
        requiredAttendees: current.requiredAttendees.filter((candidate) => candidate !== key),
        optionalAttendees: current.optionalAttendees.filter((candidate) => candidate !== key),
      }));
      return;
    }
    edit((current) => {
      const requiredAttendees = withoutEmail(current.requiredAttendees, email);
      const optionalAttendees = withoutEmail(current.optionalAttendees, email);
      return {
        requiredAttendees: role === 'required'
          ? [...requiredAttendees, key]
          : requiredAttendees,
        optionalAttendees: role === 'optional'
          ? [...optionalAttendees, key]
          : optionalAttendees,
      };
    });
  };

  const editStartPart = (part, value) => {
    setForm((current) => {
      const next = { ...current, [part]: value };
      const startLocal = joinLocal(next.startDate, next.startTime);
      if (startLocal) {
        const defaultEnd = splitLocal(defaultEndLocal(startLocal));
        if (!endTouched.current.date) next.endDate = defaultEnd.date;
        if (!endTouched.current.time) next.endTime = defaultEnd.time;
      } else if (part === 'startDate' && !endTouched.current.date) {
        next.endDate = value;
      }
      return next;
    });
    setSaved(false);
    setError(null);
  };

  const editEndPart = (part, value) => {
    const touchKey = part === 'endDate' ? 'date' : 'time';
    endTouched.current = { ...endTouched.current, [touchKey]: true };
    edit({ [part]: value });
  };

  const save = async (event) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    const toRef = (key) => {
      const row = byKey.get(key);
      if (!row) return null;
      if (row.kind === 'staff') return { kind: 'staff', profileId: row.profileId };
      if (row.kind === 'roster') return { kind: 'roster', rosterId: row.rosterId };
      return { kind: 'manual', name: row.name, email: row.email };
    };
    try {
      const response = await fetch('/api/workbench/site-visit/logistics', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId,
          activityId: form.activityId,
          etag: form.etag,
          subject: form.subject,
          description: form.description,
          startLocal: joinLocal(form.startDate, form.startTime),
          endLocal: joinLocal(form.endDate, form.endTime),
          timeZone: form.timeZone,
          disambiguation: form.disambiguation,
          format: Number(form.format),
          locationOrLink: form.locationOrLink,
          organizer: toRef(form.organizer),
          requiredAttendees: form.requiredAttendees.map(toRef).filter(Boolean),
          optionalAttendees: form.optionalAttendees.map(toRef).filter(Boolean),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Site Visit save failed (${response.status})`);
      setForm(formFromVisit(body.siteVisit, requestNumber));
      setManualRecipients([
        ...(body.siteVisit?.requiredAttendees || []),
        ...(body.siteVisit?.optionalAttendees || []),
      ].filter((ref) => ref.kind === 'manual'));
      setSaved(true);
      emitContext(body.siteVisit);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card hover={false}>
      <h3 className="text-base font-semibold text-gray-900">Visit logistics</h3>
      <p className="mt-1 text-sm text-gray-600">
        Set the visit details and choose who should attend.
      </p>
      {loading && <p className="mt-4 text-sm text-gray-600">Loading logistics and recipients…</p>}
      {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</div>}
      {!loading && (
        <form className="mt-4 space-y-4" onSubmit={save}>
          <div>
            <label htmlFor="site-visit-subject" className="block text-sm font-medium text-gray-800">Subject</label>
            <input id="site-visit-subject" value={form.subject} maxLength={400} required onChange={(event) => edit({ subject: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <div className="grid gap-4 md:grid-cols-4">
            <div>
              <label htmlFor="site-visit-start-date" className="block text-sm font-medium text-gray-800">Start date</label>
              <input id="site-visit-start-date" type="date" value={form.startDate} required onChange={(event) => editStartPart('startDate', event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="site-visit-start-time" className="block text-sm font-medium text-gray-800">Start time</label>
              <input id="site-visit-start-time" type="time" step={900} value={form.startTime} required onChange={(event) => editStartPart('startTime', event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="site-visit-end-date" className="block text-sm font-medium text-gray-800">End date</label>
              <input id="site-visit-end-date" type="date" value={form.endDate} required onChange={(event) => editEndPart('endDate', event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="site-visit-end-time" className="block text-sm font-medium text-gray-800">End time</label>
              <input id="site-visit-end-time" type="time" step={900} value={form.endTime} required onChange={(event) => editEndPart('endTime', event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="site-visit-zone" className="block text-sm font-medium text-gray-800">Time zone</label>
              <input id="site-visit-zone" value={form.timeZone} maxLength={100} required onChange={(event) => edit({ timeZone: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="site-visit-format" className="block text-sm font-medium text-gray-800">Format</label>
              <select id="site-visit-format" value={form.format} onChange={(event) => edit({ format: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                {Object.entries(SITE_VISIT_FORMAT_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="site-visit-location" className="block text-sm font-medium text-gray-800">Location or meeting link</label>
            <input id="site-visit-location" value={form.locationOrLink} maxLength={2000} required onChange={(event) => edit({ locationOrLink: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label htmlFor="site-visit-organizer" className="block text-sm font-medium text-gray-800">Organizer</label>
            <select id="site-visit-organizer" value={form.organizer} required onChange={(event) => editOrganizer(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
              <option value="">Select WMKF staff</option>
              {directory.staff.map((row) => <option key={refKey(row)} value={refKey(row)}>{row.name} ({row.email})</option>)}
            </select>
          </div>
          <fieldset>
            <legend className="text-sm font-medium text-gray-800">Attendees</legend>
            <div className="mt-1 max-h-72 divide-y divide-gray-200 overflow-y-auto rounded-lg border border-gray-300">
              {attendeeEntries.map((row) => {
                const email = normalizeSiteVisitEmail(row.email);
                const isOrganizer = Boolean(email && organizerEmail && email === organizerEmail);
                const role = form.requiredAttendees.includes(row.key)
                  ? 'required'
                  : form.optionalAttendees.includes(row.key) ? 'optional' : '';
                const inputId = `site-visit-attendee-role-${row.key}`;
                return (
                  <div key={row.key} className="flex items-center justify-between gap-4 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <label htmlFor={isOrganizer ? undefined : inputId} className="block truncate font-medium text-gray-800">{row.name}</label>
                      <p className="truncate text-xs text-gray-500">{row.group}{email ? ` — ${email}` : ' — email needed'}</p>
                    </div>
                    {isOrganizer ? (
                      <span className="shrink-0 rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-800">Organizer</span>
                    ) : (
                      <select
                        id={inputId}
                        aria-label={`Attendee role for ${row.name}${email ? ` (${email})` : ' (email needed)'}`}
                        value={role}
                        disabled={!email && !role}
                        onChange={(event) => editAttendeeRole(row.key, event.target.value)}
                        className="shrink-0 rounded-lg border border-gray-300 px-2 py-1 text-sm disabled:bg-gray-100 disabled:text-gray-500"
                      >
                        <option value="">Not attending</option>
                        <option value="required" disabled={!email}>Required</option>
                        <option value="optional" disabled={!email}>Optional</option>
                      </select>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="mt-1 text-xs text-gray-500">Choose one role for each attendee. Board/Consultant entries without an email can be completed in Expertise Finder.</p>
          </fieldset>
          <div>
            <label htmlFor="site-visit-description" className="block text-sm font-medium text-gray-800">Notes for the calendar event</label>
            <textarea id="site-visit-description" rows={4} value={form.description} maxLength={2000} onChange={(event) => edit({ description: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <div className="flex items-center gap-3">
            <button type="submit" disabled={saving} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{saving ? 'Saving…' : form.activityId ? 'Update logistics' : 'Save logistics'}</button>
            {saved && <span className="text-sm font-medium text-green-700" role="status">Saved</span>}
          </div>
        </form>
      )}
    </Card>
  );
}
