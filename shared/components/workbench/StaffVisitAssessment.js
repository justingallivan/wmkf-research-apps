import { useEffect, useRef, useState } from 'react';
import { Button } from '../Layout';
import { requestJson } from '../../utils/api-request';

const endpoint = '/api/workbench/staff-visit-assessment';
const read = requestId => requestJson(endpoint + '?requestId=' + encodeURIComponent(requestId));

export default function StaffVisitAssessment({ requestId, readOnly = false }) {
  const [record, setRecord] = useState(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const generation = useRef(0);

  useEffect(() => {
    const current = ++generation.current;
    read(requestId).then(result => {
      if (generation.current !== current) return;
      setRecord(result);
      setDraft(result.assessment);
    }).catch(failure => {
      if (generation.current === current) setError(failure.message);
    });
    return () => { generation.current += 1; };
  }, [requestId]);

  async function save(event) {
    event.preventDefault();
    if (readOnly || busy || conflict || !record?.version) return;
    const current = generation.current;
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      await requestJson(endpoint, {
        method: 'POST',
        body: { requestId, assessment: draft, version: record.version },
      });
      if (generation.current !== current) return;
      setSaved(true);
      setRecord({ ...record, version: null });
      const updated = await read(requestId);
      if (generation.current !== current) return;
      setRecord(updated);
      setDraft(updated.assessment);
    } catch (failure) {
      if (generation.current !== current) return;
      setError(failure.message);
      if (failure.status === 409) {
        setRecord({ ...record, version: null });
        try {
          const updated = await read(requestId);
          if (generation.current !== current) return;
          setRecord(updated);
          setConflict(updated.assessment !== record.assessment);
        } catch (refreshFailure) {
          if (generation.current === current) setError(refreshFailure.message);
        }
      }
    } finally {
      if (generation.current === current) setBusy(false);
    }
  }

  const content = error || record?.assessment || (record ? 'No presentation assessment saved.' : 'Loading…');
  if (readOnly) {
    return (
      <section className="py-3">
        <h3 className="text-sm font-semibold text-gray-900">Staff assessment of the presentation</h3>
        <p className="mt-2 whitespace-pre-wrap text-sm">{content}</p>
      </section>
    );
  }

  return (
    <section className="mb-4 rounded-lg border bg-white p-4" aria-labelledby="staff-visit-heading">
      <h2 id="staff-visit-heading" className="text-base font-semibold">Staff assessment of the presentation</h2>
      <p id="staff-visit-guidance" className="mt-1 text-sm text-gray-600">
        Record the tone of the presentation, what it clarified, and any concerns that remained.
      </p>
      {record && (
        <form className="mt-3 space-y-2" onSubmit={save}>
          <label className="sr-only" htmlFor="staff-visit-assessment">Staff assessment of the presentation</label>
          <textarea id="staff-visit-assessment" aria-describedby="staff-visit-guidance"
            className="w-full rounded-lg border p-2" rows={4} maxLength={10000}
            value={draft} disabled={busy} onChange={event => { setDraft(event.target.value); setSaved(false); }} />
          {conflict && (
            <div className="space-y-2 text-sm">
              <p className="font-medium">Current saved assessment</p>
              <p className="whitespace-pre-wrap">{record.assessment || 'The saved assessment was cleared.'}</p>
              <Button size="sm" type="button" onClick={() => setConflict(false)}>Keep my draft</Button>
            </div>
          )}
          <Button size="sm" type="submit" loading={busy} disabled={!record.version || conflict || draft.trim() === record.assessment}>
            Save assessment
          </Button>
        </form>
      )}
      {saved && <p className="mt-2 text-sm" role="status">Assessment saved.</p>}
      {error && <p className="mt-2 text-sm text-red-700" role="alert">{error}</p>}
      {!record && !error && <p className="mt-2 text-sm">Loading assessment…</p>}
    </section>
  );
}
