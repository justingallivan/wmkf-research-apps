import { useEffect, useRef, useState } from 'react';
import { Button } from '../Layout';
import { requestJson } from '../../utils/api-request';
import { OTHER_TRIAGE_REASON } from '../../config/triageReasons';
import NotScoredReasonFields from './NotScoredReasonFields';

const endpoint = '/api/workbench/initial-assessment-rationale';
// Keyed by request; mounted while hidden to retain draft notes across decisions/tabs.
export default function NotScoredReason({ requestId, active, onSaved }) {
  const [record, setRecord] = useState(null);
  const [reason, setReason] = useState(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [conflict, setConflict] = useState(false);
  const generation = useRef(0);
  const state = useRef({});
  state.current = { record, reason, notes };
  async function load() {
    const current = ++generation.current;
    setBusy(true);
    setError('');
    try {
      const result = await requestJson(`${endpoint}?mode=not-scored&requestId=${encodeURIComponent(requestId)}`);
      if (current !== generation.current) return;
      const previous = state.current;
      const dirty = previous.record && (previous.reason !== previous.record.reason || previous.notes !== previous.record.notes);
      if (!dirty) { setReason(result.reason); setNotes(result.notes); }
      else if (result.reason !== previous.record.reason || result.notes !== previous.record.notes) setConflict(true);
      setRecord(result);
    } catch (failure) {
      if (current === generation.current) setError(failure.message);
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (active) load();
    return () => { generation.current += 1; };
    // The keyed request owns the editor; activation refreshes its ETag after a scoring change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  async function save(event) {
    event.preventDefault();
    if (busy || conflict || !record?.version || !record.editable) return;
    const current = generation.current;
    setBusy(true); setError(''); setSaved(false);
    try {
      await requestJson(endpoint, { method: 'POST', body: {
        requestId, mode: 'not-scored', reason, version: record.version,
        ...(reason === OTHER_TRIAGE_REASON && { notes }),
      } });
      if (current !== generation.current) return;
      setRecord(previous => ({ ...previous, version: null }));
      const updated = await requestJson(`${endpoint}?mode=not-scored&requestId=${encodeURIComponent(requestId)}`);
      if (current !== generation.current) return;
      setRecord(updated);
      const notesDraft = notes !== record.notes;
      const changed = updated.reason !== reason || (reason === OTHER_TRIAGE_REASON
        ? updated.notes !== notes
        : notesDraft && updated.notes !== record.notes);
      if (reason !== OTHER_TRIAGE_REASON && !notesDraft) setNotes(updated.notes);
      setConflict(changed); setSaved(!changed);
      // Refresh scoring's request ETag too; saving a reason changes the same row.
      await onSaved();
    } catch (failure) {
      if (current !== generation.current) return;
      setError(failure.message);
      setRecord(previous => previous ? { ...previous, version: null } : previous);
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  return (
    <section hidden={!active} className="mb-4 rounded-xl border bg-white p-5" aria-label="Not Scored reason">
      <form onSubmit={save} className="space-y-3">
        {record && <>
          <NotScoredReasonFields reason={reason} otherRationale={notes} options={record.options} maxLength={record.maxLength}
            disabled={busy || !record.editable}
            onReasonChange={value => { setReason(value); setSaved(false); }}
            onOtherRationaleChange={value => { setNotes(value); setSaved(false); }} />
          {reason !== OTHER_TRIAGE_REASON && record.notes && <div className="text-sm">
            <h3 className="font-medium">Existing Invite/Decline Notes</h3>
            <p className="mt-1 whitespace-pre-wrap text-gray-700">{record.notes}</p>
          </div>}
          {conflict && <div className="text-sm" role="alert">
            <p>The saved reason or notes changed. Reload the saved version to review it before saving.</p>
            <p className="mt-1 whitespace-pre-wrap">{record.notes}</p>
            <Button type="button" size="sm" onClick={() => { setReason(record.reason); setNotes(record.notes); setConflict(false); }}>Use saved version</Button>
          </div>}
          {!record.editable && <p className="text-sm">Reasons can only be edited for Not Scored proposals.</p>}
          <Button type="submit" size="sm" loading={busy} disabled={!record.version || !record.editable || conflict
            || !record.options.some(option => option.value === reason && option.available)
            || (reason === OTHER_TRIAGE_REASON && (!notes.trim() || notes.length > record.maxLength))
            || (reason === record.reason && (reason !== OTHER_TRIAGE_REASON || notes === record.notes))}>Save reason</Button>
        </>}
      </form>
      {saved && <p role="status" className="mt-2 text-sm">Reason saved.</p>}
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      {!record && busy && <p role="status" className="text-sm">Loading reason…</p>}
      {!busy && (!record || !record.version || error) && <Button type="button" size="sm" onClick={load}>Reload saved reason</Button>}
    </section>
  );
}
