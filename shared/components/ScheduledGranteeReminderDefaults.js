import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Button } from './Layout';
import { requestEnvelope } from '../utils/api-request';
import { validateScheduledGranteeReminderTemplate } from '../config/scheduledGranteeReminderEmail';
import useScheduledDefaultsUnsavedChanges from './useScheduledDefaultsUnsavedChanges';

const ENDPOINT = '/api/scheduled-emails/email-preferences';
const EMPTY = { subject: '', body: '' };
const same = (a, b) => a?.subject === b?.subject && a?.body === b?.body;

/** A separate request lane. No callback can change a selected scheduled row. */
export function ScheduledReminderWordingEditor({ owner, active, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [template, setTemplate] = useState(EMPTY);
  const [baseline, setBaseline] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [notice, setNotice] = useState(null);
  const [errors, setErrors] = useState({});
  const seq = useRef(0);
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const current = useRef({ active });
  useLayoutEffect(() => { current.current = { active }; }, [active]);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const dirty = !same(template, baseline);
  useScheduledDefaultsUnsavedChanges(dirty || busy || uncertain, busy || uncertain);
  const validResponse = next => {
    if (next?.ok !== true || typeof next.ownerSystemId !== 'string' || next.ownerSystemId.toLowerCase() !== owner
      || !['configured', 'absent', 'duplicates', 'encrypted', 'invalid', 'identity_unavailable', 'unavailable'].includes(next.ownStatus)
      || typeof next.canSave !== 'boolean' || typeof next.canClear !== 'boolean') return false;
    if (next.ownStatus === 'configured' ? !validateScheduledGranteeReminderTemplate(next.own).valid : next.own != null) return false;
    return next.shared == null || (typeof next.shared.subject === 'string' && typeof next.shared.body === 'string');
  };
  const accept = next => {
    const pair = next.own || next.shared || EMPTY;
    setData(next); setTemplate(pair); setBaseline(pair); setUncertain(previous => next.ownStatus === 'unavailable' ? previous : false); setErrors({});
  };
  const read = async () => {
    if (!current.current.active || inFlight.current || disabled) return;
    if (dirty && !window.confirm('Reload defaults and discard your unsaved default wording?')) return;
    const generation = ++seq.current;
    inFlight.current = true; setBusy(true); setNotice(null);
    try {
      const envelope = await requestEnvelope(ENDPOINT);
      if (!mounted.current || generation !== seq.current || !current.current.active) return;
      if (!envelope.ok || !validResponse(envelope.data)) throw new Error('unavailable');
      accept(envelope.data);
    } catch {
      if (mounted.current && generation === seq.current && current.current.active) setNotice('Your default wording could not be loaded. Reload defaults to retry.');
    } finally {
      if (mounted.current && generation === seq.current) { inFlight.current = false; setBusy(false); }
    }
  };
  useEffect(() => {
    // A same-actor loading pause keeps the editor mounted. Resume a lost initial read.
    if (active && open && !data && !notice && !inFlight.current) read();
  }, [active, open, disabled]); // read is intentionally interaction-local; selection never reloads defaults.
  const write = async clear => {
    if (!current.current.active || disabled || inFlight.current || uncertain || !(clear ? data?.canClear : data?.canSave)) return;
    if (clear && dirty && !window.confirm('Clear your default and discard unsaved default wording? Existing messages are unchanged.')) return;
    const checked = validateScheduledGranteeReminderTemplate(template);
    if (!clear && !checked.valid) { setErrors(checked.errors); return; }
    const submitted = clear ? null : checked.value;
    const generation = ++seq.current;
    inFlight.current = true; setBusy(true); setUncertain(true); setNotice('A change is pending and may already be saved. Reload if its result cannot be confirmed.'); setErrors({});
    try {
      const envelope = await requestEnvelope(ENDPOINT, { method: clear ? 'DELETE' : 'PUT', body: clear ? {} : { template: submitted } });
      if (!mounted.current || generation !== seq.current || !current.current.active) return;
      if (!envelope.ok || envelope.data?.ok !== true) {
        if (envelope.status === 400 || envelope.status === 409) {
          setUncertain(false);
          setErrors(envelope.data?.errors || {});
          setNotice(envelope.status === 409 ? 'Multiple saved defaults were found. Reload, then Clear before saving.' : 'Check the default wording fields.');
          return;
        }
        throw new Error('unconfirmed');
      }
      if (envelope.data.refreshUnavailable) {
        const next = clear ? data?.shared || EMPTY : submitted;
        setTemplate(next); setBaseline(next); setData(null); setUncertain(true);
        setNotice('Your change was confirmed, but refreshed defaults are unavailable. Existing messages are unchanged. Reload before another change.');
        return;
      }
      if (!validResponse(envelope.data)) throw new Error('unconfirmed');
      accept(envelope.data);
      setNotice(clear ? 'Your default was cleared. Existing messages are unchanged.' : 'Saved for future reminders. Existing messages are unchanged.');
    } catch {
      if (mounted.current && generation === seq.current && current.current.active) {
        setUncertain(true); setNotice('The change could not be confirmed and may already be saved. Reload defaults before another change.');
      }
    } finally {
      if (mounted.current && generation === seq.current) { inFlight.current = false; setBusy(false); }
    }
  };
  const blocked = !active || disabled || busy;
  const paused = data && !['configured', 'absent'].includes(data.ownStatus);
  return <details open={open} onToggle={event => setOpen(event.currentTarget.open)} className="mb-6 rounded-lg border border-gray-200 bg-white">
    <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-gray-900">Your default wording — grantee reminders</summary>
    <div className="space-y-3 border-t border-gray-200 p-4">
      <p className="text-sm text-gray-600">Used for newly scheduled reminders and eligible PD-reassignment rebuilds. Existing messages, edits and approvals are unchanged.</p>
      <p className="text-xs text-gray-600">Subject is literal. Message requires {'{{granteeName}}'}, {'{{proposalTitle}}'} and {'{{dueDate}}'}. Your saved signature and secure link are added automatically. Shared wording is a starting point and may need changes before it can be saved as your default.</p>
      {busy && <p role="status">Working…</p>}
      {data && <p className="text-sm text-gray-600">Source: {data.source === 'personal' ? 'your saved default' : data.source === 'shared' ? 'shared wording' : 'unavailable'}.</p>}
      {paused && <p role="alert" className="text-sm text-amber-800">New reminders and reassignment rebuilds for your grants are paused until this default can be read or repaired. {data.ownStatus === 'duplicates' ? 'Clear the duplicate defaults before saving.' : 'Reload, Clear or save corrected wording when available.'} Already-frozen same-owner messages continue. Reassigned messages are held independently; saved old-PD activities need manual resolution.</p>}
      <label className="block text-sm font-medium" htmlFor="scheduled-default-subject">Default subject</label>
      <input id="scheduled-default-subject" value={template.subject} disabled={blocked || !data || uncertain} maxLength={300} onChange={event => setTemplate({ ...template, subject: event.target.value })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
      {errors.subject && <p role="alert" className="text-sm text-red-700">{errors.subject}</p>}
      <label className="block text-sm font-medium" htmlFor="scheduled-default-message">Default message</label>
      <textarea id="scheduled-default-message" value={template.body} disabled={blocked || !data || uncertain} maxLength={20000} rows={6} onChange={event => setTemplate({ ...template, body: event.target.value })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
      {errors.body && <p role="alert" className="text-sm text-red-700">{errors.body}</p>}
      {errors.template && <p role="alert">{errors.template}</p>}
      {notice && <p role="status" className="text-sm text-gray-700">{notice}</p>}
      <div className="flex flex-wrap justify-end gap-3">
        <Button type="button" variant="secondary" size="sm" disabled={blocked || uncertain || !data?.canSave} onClick={() => write(false)}>Save as my default</Button>
        <Button type="button" variant="secondary" size="sm" disabled={blocked || uncertain || !data?.canClear} onClick={() => write(true)}>Clear my default</Button>
        <Button type="button" variant="link" size="sm" disabled={blocked} onClick={read}>Reload defaults</Button>
      </div>
    </div>
  </details>;
}

export default function ScheduledGranteeReminderDefaults({ profileId, profileStatus, disabled }) {
  const { data: session, status } = useSession();
  const actor = session?.user?.dynamicsSystemuserId;
  const identity = status === 'authenticated' && actor && session.user?.profileId
    ? `${session.user.profileId}:${actor.toLowerCase()}` : null;
  const [scope, setScope] = useState(null);
  useEffect(() => {
    if (identity) setScope(identity);
    else if (status === 'unauthenticated') setScope(null);
  }, [identity, status]);
  const active = Boolean(scope && scope === identity && profileStatus === 'ready' && String(profileId) === String(session?.user?.profileId));
  if (!scope) return null;
  return <ScheduledReminderWordingEditor key={scope} owner={scope.slice(scope.indexOf(':') + 1)} active={active} disabled={disabled} />;
}
