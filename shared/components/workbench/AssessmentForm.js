import { useEffect, useRef, useState } from 'react';
import { Button } from '../Layout';
import { requestJson } from '../../utils/api-request';
import { OTHER_TRIAGE_REASON } from '../../config/triageReasons';
import NotScoredReasonFields from './NotScoredReasonFields';
import AdvisorPicks from './AdvisorPicks';

const endpoint = '/api/workbench/initial-assessment-rationale';
const read = requestId => requestJson(`${endpoint}?mode=assessment&requestId=${encodeURIComponent(requestId)}`);

// Keyed by request and kept mounted across tabs. Choices only change local drafts.
export default function AssessmentForm({ requestId, canManage, onSaved }) {
  const [record, setRecord] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const generation = useRef(0);
  const inFlight = useRef(false);
  async function load() {
    const current = ++generation.current;
    setBusy(true); setError(''); setSaved(false);
    try {
      const result = await read(requestId);
      if (current !== generation.current) return;
      setRecord(result); setDraft(result);
    } catch (failure) {
      if (current === generation.current) setError(failure.message);
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    load();
    return () => { generation.current += 1; };
    // The parent keys this component by request ID.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function change(key, value) {
    setDraft(previous => ({ ...previous, [key]: value })); setSaved(false);
  }
  const dirty = record && draft && (draft.decision !== record.decision || (draft.decision === 'yes'
    ? draft.rationale.trim() !== record.rationale
    : draft.reason !== record.reason || (draft.reason === OTHER_TRIAGE_REASON && draft.notes !== record.notes)));
  const valid = draft?.decision === 'yes' ? draft.rationale.length <= 10000 : draft?.decision === 'no'
    && record.options.some(option => option.value === draft.reason && option.available)
    && (draft.reason !== OTHER_TRIAGE_REASON || (draft.notes.trim() && draft.notes.length <= record.maxLength));
  async function save(event) {
    event.preventDefault();
    if (inFlight.current || busy || !record?.version || !dirty || !valid) return;
    inFlight.current = true;
    const current = generation.current;
    setBusy(true); setError(''); setSaved(false);
    try {
      await requestJson(endpoint, { method: 'POST', body: {
        requestId, mode: 'assessment', version: record.version, decision: draft.decision,
        ...(draft.decision === 'yes' ? { rationale: draft.rationale } : {
          reason: draft.reason, ...(draft.reason === OTHER_TRIAGE_REASON && { notes: draft.notes }),
        }),
      } });
      if (current !== generation.current) return;
      setRecord(previous => ({ ...previous, version: null }));
      const updated = await read(requestId);
      if (current !== generation.current) return;
      // Retain hidden drafts, but never pair them silently with a newer conflicting ETag.
      const keys = ['rationale', 'reason', 'notes'];
      const submitted = draft.decision === 'yes' ? ['rationale'] : draft.reason === OTHER_TRIAGE_REASON ? ['reason', 'notes'] : ['reason'];
      const conflict = updated.decision !== draft.decision || keys.some(key => {
        const expected = key === 'rationale' ? draft.rationale.trim() : draft[key];
        return submitted.includes(key) ? updated[key] !== expected : draft[key] !== record[key] && updated[key] !== record[key];
      });
      setRecord({ ...updated, version: conflict ? null : updated.version });
      if (!conflict) setDraft(previous => ({ ...previous, ...Object.fromEntries(keys.filter(key => submitted.includes(key) || draft[key] === record[key]).map(key => [key, updated[key]])) }));
      setSaved(!conflict);
      if (conflict) setError('The saved assessment changed. Your unsaved drafts remain here; reload the saved assessment before saving again.');
      await onSaved();
    } catch (failure) {
      if (current !== generation.current) return;
      setError(failure.message);
      setRecord(previous => previous ? { ...previous, version: null } : previous);
    } finally {
      if (current === generation.current) { setBusy(false); inFlight.current = false; }
    }
  }
  return <section className="mb-4 rounded-xl border bg-white p-5" aria-label="Initial assessment">
    <h2 className="text-base font-semibold">Scoring</h2>
    {record && draft && <form className="mt-3 space-y-4" onSubmit={save}>
      <label className="flex w-fit flex-col gap-1 text-sm font-medium">Scoring decision
        <select className="min-h-10 rounded-lg border border-gray-300 bg-white px-3" value={draft.decision}
          disabled={busy || !canManage || !record.decisionEditable} onChange={event => change('decision', event.target.value)}>
          <option value="" disabled>Select a decision</option><option value="yes">Scored</option><option value="no">Not Scored</option>
        </select>
      </label>
      {!record.decisionEditable && <p className="text-sm text-gray-600">Scoring is closed.</p>}
      {record.decisionEditable && !canManage && <p className="text-sm text-gray-600">Only the lead Program Director or a superuser can change the scoring decision.</p>}
      {draft.decision === 'yes' && <section aria-label="Staff rationale" className="space-y-3">
        <h3 className="text-lg font-semibold">Staff rationale</h3>
        <p id="assessment-guidance" className="text-sm text-gray-600">Describe the strengths of this proposal and any questions staff should carry forward.</p>
        <label className="sr-only" htmlFor="assessment-rationale">Staff rationale</label>
        <textarea id="assessment-rationale" aria-describedby="assessment-guidance" className="w-full rounded-lg border p-3"
          rows={6} maxLength={10000} disabled={busy} value={draft.rationale} onChange={event => change('rationale', event.target.value)} />
      </section>}
      {draft.decision === 'no' && <>
        <NotScoredReasonFields reason={draft.reason} otherRationale={draft.notes} options={record.options} maxLength={record.maxLength}
          disabled={busy} onReasonChange={value => change('reason', value)} onOtherRationaleChange={value => change('notes', value)} />
        {draft.reason !== OTHER_TRIAGE_REASON && record.notes && <div className="text-sm"><h3 className="font-medium">Existing Invite/Decline Notes</h3><p className="whitespace-pre-wrap text-gray-700">{record.notes}</p></div>}
      </>}
      <Button type="submit" size="sm" loading={busy} disabled={!record.version || !dirty || !valid}>Save assessment</Button>
    </form>}
    {record?.decision === 'yes' && <AdvisorPicks key={requestId} requestId={requestId} />}
    {!record && busy && <p role="status">Loading assessment…</p>}
    {saved && <p role="status" className="mt-2 text-sm">Assessment saved.</p>}
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    {!busy && (!record || !record.version) && <div className="mt-2 space-y-2">
      {draft && <p className="text-sm">Reloading replaces your drafts with the saved assessment.</p>}
      <Button type="button" size="sm" onClick={load}>Reload saved assessment</Button>
    </div>}
  </section>;
}
