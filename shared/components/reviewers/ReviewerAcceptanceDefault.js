/** Future acceptance confirmation wording only. Controller lives above the page's loading return. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Button } from '../Layout';
import { requestEnvelope } from '../../utils/api-request';
import { validateReviewerAcceptanceTemplate } from '../../config/reviewerAcceptanceEmail';
import { isGuid } from '../../../lib/utils/guid';

const ENDPOINT = '/api/reviewer-acceptance-email-preferences';
const EMPTY = { subject: '', body: '' };
const same = (a, b) => a?.subject === b?.subject && a?.body === b?.body;
const PROFILE = value => { const id = ['number', 'string'].includes(typeof value) ? Number(value) : NaN; return Number.isInteger(id) && id > 0 ? id : null; };

export function useReviewerAcceptanceDefaults({ profileId, profileStatus, loading = false }) {
  const { data: session, status } = useSession();
  const actor = session?.user?.dynamicsSystemuserId;
  const authenticatedProfileId = PROFILE(session?.user?.profileId);
  const identity = status === 'authenticated' && isGuid(actor) && authenticatedProfileId
    ? `${authenticatedProfileId}:${actor.toLowerCase()}` : null;
  const [scope, setScope] = useState(identity);
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [template, setTemplate] = useState(EMPTY);
  const [baseline, setBaseline] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [confirmedReload, setConfirmedReload] = useState(false);
  const [notice, setNotice] = useState(null);
  const [errors, setErrors] = useState({});
  const seq = useRef(0), epoch = useRef(0), inFlight = useRef(null), mounted = useRef(false);
  const active = Boolean(identity && scope === identity && PROFILE(profileId) === authenticatedProfileId && profileStatus === 'ready' && !loading);
  const current = useRef({ identity, active });
  useLayoutEffect(() => {
    if (current.current.identity !== identity || current.current.active !== active) epoch.current++;
    current.current = { identity, active };
  }, [identity, active]);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; }; }, []);
  useLayoutEffect(() => {
    if ((identity && identity !== scope) || status === 'unauthenticated') {
      epoch.current++; seq.current++; inFlight.current = null;
      setScope(identity); setData(null); setTemplate(EMPTY); setBaseline(EMPTY);
      setOpen(false); setBusy(false); setUncertain(false); setConfirmedReload(false); setNotice(null); setErrors({});
    }
  }, [identity, scope, status]);
  const dirty = !same(template, baseline);
  const guarding = Boolean(scope && (scope === identity || status === 'loading') && (dirty || uncertain));
  const matchesIdentity = next => next?.ok === true && typeof next.ownerSystemId === 'string'
    && next.ownerSystemId.toLowerCase() === actor?.toLowerCase() && next.authenticatedProfileId === authenticatedProfileId;
  const validResponse = next => {
    if (!matchesIdentity(next) || !['configured', 'absent', 'duplicates', 'encrypted', 'invalid', 'unavailable', 'identity_unavailable'].includes(next.ownStatus)) return false;
    const readable = !['unavailable', 'identity_unavailable'].includes(next.ownStatus);
    if (next.canSave !== (readable && next.ownStatus !== 'duplicates') || next.canClear !== (readable && next.ownStatus !== 'absent')) return false;
    if (next.configured !== (next.ownStatus === 'configured')) return false;
    if (next.ownStatus === 'configured' ? !validateReviewerAcceptanceTemplate(next.own).valid : next.own != null) return false;
    if (!['available', 'missing', 'unavailable'].includes(next.sharedStatus)) return false;
    if (next.sharedStatus === 'available' ? !next.shared || typeof next.shared.subject !== 'string' || !next.shared.subject.trim() || typeof next.shared.body !== 'string' || !next.shared.body.trim() : next.shared != null) return false;
    return next.source === (next.own ? 'personal' : next.shared ? 'shared' : 'unavailable');
  };
  const accept = next => {
    const pair = next.own || next.shared || EMPTY;
    setData(next); setTemplate(pair); setBaseline(pair); setErrors({});
    if (!['unavailable', 'identity_unavailable'].includes(next.ownStatus)) { setUncertain(false); setConfirmedReload(false); }
  };
  const begin = () => {
    const op = { id: ++seq.current, epoch: epoch.current, identity };
    inFlight.current = op; setBusy(true); return op;
  };
  const fresh = op => mounted.current && inFlight.current === op && op.epoch === epoch.current && current.current.active && op.identity === current.current.identity;
  const finish = op => {
    if (inFlight.current !== op) return;
    inFlight.current = null;
    if (mounted.current && op.identity === current.current.identity) setBusy(false);
  };
  const read = async () => {
    if (!current.current.active || inFlight.current) return;
    if (dirty && !window.confirm('Reload defaults and discard your unsaved default wording?')) return;
    const op = begin(); setNotice(null);
    try {
      const result = await requestEnvelope(ENDPOINT);
      if (!fresh(op)) return;
      if (!result.ok || !validResponse(result.data)) throw new Error('unavailable');
      accept(result.data);
    } catch {
      if (fresh(op)) {
        setData(previous => previous ? { ...previous, canSave: false, canClear: false } : null);
        setNotice('Your default wording could not be loaded. Reload defaults to retry.');
      }
    } finally { finish(op); }
  };
  useEffect(() => {
    if (active && open && !data && !notice && !inFlight.current) read();
  }, [active, open, busy]); // Interaction-local reads; no rebase from sibling Profile Settings edits.
  const write = async clear => {
    if (!current.current.active || inFlight.current || uncertain || !(clear ? data?.canClear : data?.canSave)) return;
    if (clear && !window.confirm(dirty ? 'Clear your acceptance confirmation default and discard unsaved wording? Future emails will use shared wording.' : 'Clear your acceptance confirmation default? Future emails will use shared wording.')) return;
    const checked = validateReviewerAcceptanceTemplate(template);
    if (!clear && !checked.valid) { setErrors(checked.errors); return; }
    const submitted = clear ? null : checked.value;
    const op = begin(); setUncertain(true); setConfirmedReload(false); setErrors({});
    setNotice('A change is pending and may already be saved. Reload if its result cannot be confirmed.');
    try {
      const result = await requestEnvelope(ENDPOINT, { method: clear ? 'DELETE' : 'PUT', body: clear ? {} : { template: submitted } });
      if (!fresh(op)) return;
      if (!result.ok || result.data?.ok !== true) {
        const reason = result.data?.reason;
        const preWriteRefusal = result.data?.ok === false
          && ((result.status === 503 && ['preference_unavailable', 'identity_unavailable'].includes(reason))
            || (result.status === 403 && reason === 'identity_mismatch'));
        if (preWriteRefusal) {
          setUncertain(false); setData(previous => ({ ...previous, canSave: false, canClear: false }));
          setNotice(reason === 'preference_unavailable'
            ? 'Your saved defaults could not be read. Nothing was changed. Reload defaults before another change.'
            : 'Your default wording was not changed. Your profile identity could not be verified. Reload defaults before another change.'); return;
        }
        if ([400, 409].includes(result.status)) {
          setUncertain(false); setErrors(result.data?.errors || {});
          if (result.status === 409) setData(previous => ({ ...previous, canSave: false, canClear: false }));
          setNotice(result.status === 409 ? 'Multiple saved defaults were found. Reload, then Clear before saving.' : 'Check the default wording fields.'); return;
        }
        throw new Error('unconfirmed');
      }
      if (!matchesIdentity(result.data)) throw new Error('unconfirmed');
      if (result.data.refreshUnavailable) {
        const next = clear ? data?.shared || EMPTY : submitted;
        setTemplate(next); setBaseline(next); setData(null); setConfirmedReload(true);
        setNotice('Your change was confirmed, but refreshed defaults are unavailable. Reload before another change.'); return;
      }
      if (!validResponse(result.data)) throw new Error('unconfirmed');
      accept(result.data);
      setNotice(clear ? 'Your default was cleared. Future acceptance confirmations inherit shared wording.'
        : same(result.data.own, submitted) ? 'Saved for future acceptance confirmations.' : 'Your change was confirmed. The current defaults changed again; review the refreshed wording.');
    } catch {
      if (fresh(op)) { setUncertain(true); setNotice('The change could not be confirmed and may already be saved. Reload defaults before another change.'); }
    } finally { finish(op); }
  };
  const resetWithoutPrompt = () => {
    epoch.current++; setOpen(false); setData(null); setTemplate(EMPTY); setBaseline(EMPTY); setErrors({});
    if (!busy && !uncertain) setNotice(null);
  };
  return { active, open, setOpen, data, template, setTemplate, busy, uncertain, notice, errors, read, write, resetWithoutPrompt, guardState: { guarding, pending: uncertain, confirmedReload } };
}

export default function ReviewerAcceptanceDefault({ controller: c }) {
  if (!c.active) return <p className="text-sm text-gray-600">Acceptance confirmation defaults are available only for your authenticated profile. Loading or another selected profile pauses this editor.</p>;
  const blocked = c.busy || c.uncertain || !c.data;
  const paused = c.data && !['configured', 'absent'].includes(c.data.ownStatus);
  return <details open={c.open} onToggle={event => c.setOpen(event.currentTarget.open)} className="mt-4 rounded-lg border border-gray-200">
    <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Your default wording — acceptance confirmation</summary>
    {c.open && <div className="space-y-3 border-t border-gray-200 p-4">
      <p className="text-sm text-gray-600">Used for future reviewer acceptance confirmations sent from your mailbox. The server supplies the recipient, withdrawal link, calendar attachment and signature. The generic-mailbox fallback uses shared wording.</p>
      <p className="text-xs text-gray-600">Subject supports {'{{reviewerName}}'} and {'{{proposalTitle}}'}. Message supports {'{{greeting}}'}, {'{{reviewerName}}'}, {'{{proposalTitle}}'}, {'{{reviewDueDate}}'}, {'{{signature}}'}, {'{{programDirectorName}}'}, {'{{programDirectorEmail}}'} and {'{{withdrawUrl}}'}. All are optional. Due date expands to a whole sentence. The withdrawal paragraph is appended if its token is omitted; without a server token, its value is empty. Line breaks in subject values become spaces; message text stays unchanged. Shared wording may need token corrections before saving as your default.</p>
      {c.busy && <p role="status">Working…</p>}
      {c.data && <p className="text-sm text-gray-600">Source: {c.data.source === 'personal' ? 'your saved default' : c.data.source === 'shared' ? 'shared wording' : 'unavailable'}.</p>}
      {c.data?.sharedStatus && c.data.sharedStatus !== 'available' && <p role="alert">Shared acceptance wording is unavailable. Automatic sends still require shared configuration; contact an administrator.</p>}
      {paused && <p role="alert">Acceptance confirmations from your mailbox are paused until this default can be read or repaired. {c.data.ownStatus === 'duplicates' ? 'Clear duplicate defaults before saving.' : 'Reload, Clear or save corrected wording when available.'}</p>}
      <label className="block text-sm font-medium" htmlFor="automatic-acceptance-subject">Default acceptance subject</label>
      <input id="automatic-acceptance-subject" value={c.template.subject} disabled={blocked} maxLength={300} onChange={event => c.setTemplate({ ...c.template, subject: event.target.value })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
      {c.errors.subject && <p role="alert">{c.errors.subject}</p>}
      <label className="block text-sm font-medium" htmlFor="automatic-acceptance-message">Default acceptance message</label>
      <textarea id="automatic-acceptance-message" value={c.template.body} disabled={blocked} maxLength={20000} rows={6} onChange={event => c.setTemplate({ ...c.template, body: event.target.value })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
      {c.errors.body && <p role="alert">{c.errors.body}</p>}
      {c.errors.template && <p role="alert">{c.errors.template}</p>}
      {c.notice && <p role="status">{c.notice}</p>}
      <div className="flex flex-wrap justify-end gap-3">
        <Button type="button" variant="secondary" size="sm" disabled={blocked || !c.data?.canSave} onClick={() => c.write(false)}>Save as my default</Button>
        <Button type="button" variant="secondary" size="sm" disabled={blocked || !c.data?.canClear} onClick={() => c.write(true)}>Clear my default</Button>
        <Button type="button" variant="link" size="sm" disabled={c.busy} onClick={c.read}>Reload defaults</Button>
      </div>
    </div>}
  </details>;
}
