import { useEffect, useRef, useState } from 'react';
import { Button } from '../Layout';
import { requestJson } from '../../utils/api-request';

const endpoint = '/api/workbench/initial-assessment-rationale';
const read = requestId => requestJson(endpoint + '?requestId=' + encodeURIComponent(requestId));

// The Workbench keys this editor by request ID.
export default function InitialAssessmentRationale({ requestId }) {
  const [record, setRecord] = useState(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const generation = useRef(0);

  async function load() {
    const current = ++generation.current;
    setBusy(true);
    setError('');
    try {
      const result = await read(requestId);
      if (generation.current !== current) return;
      if (!record) setDraft(result.rationale);
      else setConflict(previous => previous || (result.rationale !== record.rationale && result.rationale !== draft.trim()));
      setRecord(result);
    } catch (failure) {
      if (generation.current === current) setError(failure.message);
    } finally {
      if (generation.current === current) setBusy(false);
    }
  }

  useEffect(() => {
    load();
    return () => { generation.current += 1; };
    // Mount once for the keyed request. Retry reads through load() below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(event) {
    event.preventDefault();
    if (busy || conflict || !record?.version || draft.trim() === record.rationale) return;
    const current = generation.current;
    const rationale = draft.trim();
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      await requestJson(endpoint, {
        method: 'POST',
        body: { requestId, rationale, version: record.version },
      });
      if (generation.current !== current) return;
      setSaved(true);
      setRecord({ rationale, version: null });
      setDraft(rationale);
      const updated = await read(requestId);
      if (generation.current !== current) return;
      setRecord(updated);
      if (updated.rationale !== rationale) {
        setSaved(false);
        setConflict(true);
      }
    } catch (failure) {
      if (generation.current !== current) return;
      setError(failure.message);
      if (failure.status === 409) setRecord({ ...record, version: null });
    } finally {
      if (generation.current === current) setBusy(false);
    }
  }

  return (
    <section className="mb-4 rounded-xl border bg-white p-5" aria-labelledby="initial-rationale-heading">
      <h2 id="initial-rationale-heading" className="text-lg font-semibold">Staff rationale</h2>
      <p id="initial-rationale-guidance" className="mt-1 text-sm text-gray-600">
        Explain why you recommend triaging or advancing this proposal. For proposals you would advance,
        describe the strengths and any questions staff should carry forward.
      </p>
      {record && (
        <form className="mt-3 space-y-3" onSubmit={save}>
          <label className="sr-only" htmlFor="initial-rationale">Staff rationale</label>
          <textarea id="initial-rationale" aria-describedby="initial-rationale-guidance"
            className="w-full rounded-lg border p-3" rows={6} maxLength={10000}
            value={draft} disabled={busy} onChange={event => { setDraft(event.target.value); setSaved(false); }} />
          {conflict && (
            <div className="space-y-2 text-sm">
              <p className="font-medium">Current saved rationale</p>
              <p className="whitespace-pre-wrap">{record.rationale || 'The saved rationale was cleared.'}</p>
              <Button size="sm" type="button" onClick={() => setConflict(false)}>Keep my draft</Button>
              {' '}
              <Button size="sm" type="button" onClick={() => {
                setDraft(record.rationale);
                setConflict(false);
              }}>Use saved rationale</Button>
            </div>
          )}
          <Button size="sm" type="submit" loading={busy}
            disabled={!record.version || conflict || draft.trim() === record.rationale}>
            Save rationale
          </Button>
        </form>
      )}
      {saved && <p className="mt-2 text-sm" role="status">Rationale saved.</p>}
      {error && <p className="mt-2 text-sm text-red-700" role="alert">{error}</p>}
      {!record && busy && <p className="mt-2 text-sm" role="status">Loading rationale…</p>}
      {!busy && (!record || !record.version) && (
        <Button size="sm" type="button" onClick={load}>Reload saved rationale</Button>
      )}
    </section>
  );
}
