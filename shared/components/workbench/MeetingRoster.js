import { useEffect, useRef, useState } from 'react';
import { Button } from '../Layout';
import { requestJson } from '../../utils/api-request';

const endpoint = '/api/workbench/meeting-roster';
const read = (requestId, suggest = false) => requestJson(
  `${endpoint}?requestId=${encodeURIComponent(requestId)}${suggest ? '&suggest=yes' : ''}`,
);
const lines = text => text.split(/\r?\n/).map(name => name.trim()).filter(Boolean);
const empty = { wmkf: '', consultants: '' };

export default function MeetingRoster({ requestId, readOnly = false }) {
  const [record, setRecord] = useState(null);
  const [draft, setDraft] = useState(empty);
  const [suggestions, setSuggestions] = useState(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reviewingSaved, setReviewingSaved] = useState(false);
  const generation = useRef(0);

  function show(result) {
    setRecord(result);
    setDraft({
      wmkf: result.roster?.wmkf.join('\n') || '',
      consultants: result.roster?.consultants.join('\n') || '',
    });
  }

  useEffect(() => {
    const current = ++generation.current;
    read(requestId).then(result => {
      if (generation.current === current) show(result);
    }).catch(failure => {
      if (generation.current === current) setError(failure.message);
    });
    return () => { generation.current += 1; };
  }, [requestId]);

  async function fetchSuggestions() {
    const current = generation.current;
    setBusy(true);
    setError('');
    setNotice('');
    setSuggestions(null);
    try {
      const result = await read(requestId, true);
      if (generation.current !== current) return;
      if (result.presentation?.binding !== record.presentation?.binding
          || result.presentation?.version !== record.presentation?.version) {
        setRecord({ ...record, presentation: { ...record.presentation, version: null }, sentence: '' });
        setError('The presentation or roster changed. Reload before continuing.');
        return;
      }
      setSuggestions(result.suggestions);
      if (!result.suggestions?.length) setNotice('No verified Zoom suggestions. Enter names manually.');
    } catch (failure) {
      if (generation.current === current) setError(failure.message);
    } finally {
      if (generation.current === current) setBusy(false);
    }
  }

  async function save(event) {
    event.preventDefault();
    if (readOnly || busy || !record?.presentation?.version) return;
    const current = generation.current;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { id: visitId, version, binding } = record.presentation;
      await requestJson(endpoint, {
        method: 'POST',
        body: { requestId, visitId, version, binding, wmkf: lines(draft.wmkf), consultants: lines(draft.consultants) },
      });
      if (generation.current !== current) return;
      setRecord({ ...record, presentation: { ...record.presentation, version: null }, sentence: '' });
      setNotice('Roster confirmed.');
      const updated = await read(requestId);
      if (generation.current !== current) return;
      show(updated);
      setReviewingSaved(false);
      setSuggestions(null);
    } catch (failure) {
      if (generation.current !== current) return;
      if (failure.status === 409) setRecord({ ...record, presentation: { ...record.presentation, version: null }, sentence: '' });
      setError(failure.message);
    } finally {
      if (generation.current === current) setBusy(false);
    }
  }

  async function reloadForReview() {
    const current = generation.current;
    setBusy(true);
    setError('');
    try {
      const latest = await read(requestId);
      if (generation.current !== current) return;
      setRecord(latest);
      setReviewingSaved(true);
      setSuggestions(null);
      setNotice('Roster refreshed. Review your names before confirming again.');
    } catch (failure) {
      if (generation.current === current) setError(failure.message);
    } finally {
      if (generation.current === current) setBusy(false);
    }
  }

  async function copy() {
    const current = generation.current;
    try {
      await navigator.clipboard.writeText(record.sentence);
      if (generation.current === current) setNotice('Attendance copied.');
    } catch {
      if (generation.current === current) setError('Could not copy. Select the sentence and copy it manually.');
    }
  }

  function addName(category, name) {
    setDraft(previous => {
      const existing = lines(previous[category]);
      if (existing.some(value => value.toLowerCase() === name.toLowerCase())) return previous;
      return { ...previous, [category]: [...existing, name].join('\n') };
    });
  }

  return (
    <details className="mb-4 rounded-lg border bg-white p-4">
      <summary className="font-semibold">Meeting roster</summary>
      {!record && !error && <p className="mt-2 text-sm">Loading roster…</p>}
      {record && !record.presentation && !error && !notice && <p className="mt-2 text-sm">No presentation is available for this roster.</p>}
      {record?.stale && <p className="mt-2 text-sm text-amber-800">Presentation details changed. Attendance needs reconfirmation.</p>}
      {!readOnly && record?.presentation && (
        <form className="mt-3 space-y-3" onSubmit={save}>
          <p className="text-sm text-gray-600">Enter one name per line. Include WMKF attendees and consultants who were present for the applicant presentation.</p>
          {record.canSuggest && (
            <Button size="sm" type="button" disabled={busy} onClick={fetchSuggestions}>Find names in Zoom attendance</Button>
          )}
          {suggestions?.length > 0 && (
            <ul className="space-y-1 text-sm" aria-label="Zoom attendance suggestions">
              {suggestions.map(name => (
                <li key={name} className="flex flex-wrap items-center gap-2">
                  <span>{name}</span>
                  <Button size="sm" type="button" disabled={busy} onClick={() => addName('wmkf', name)}>Add to WMKF</Button>
                  <Button size="sm" type="button" disabled={busy} onClick={() => addName('consultants', name)}>Add as consultant</Button>
                </li>
              ))}
            </ul>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {[['wmkf', 'WMKF attendees'], ['consultants', 'Consultants']].map(([key, label]) => (
              <label key={key} className="block text-sm font-medium">
                {label}
                <textarea className="mt-1 block w-full rounded-lg border p-2" rows={3}
                  value={draft[key]} disabled={busy} maxLength={4050}
                  onChange={event => setDraft({ ...draft, [key]: event.target.value })} />
              </label>
            ))}
          </div>
          {reviewingSaved && (
            <div className="text-sm">
              <p className="font-medium">Names currently saved</p>
              <p>WMKF attendees · {record.roster?.wmkf.join(', ') || 'None'}</p>
              <p>Consultants · {record.roster?.consultants.join(', ') || 'None'}</p>
            </div>
          )}
          {!record.presentation.version && (
            <Button size="sm" type="button" disabled={busy} onClick={reloadForReview}>Reload roster details</Button>
          )}
          <Button size="sm" type="submit" disabled={busy || !record.presentation.version}>Confirm roster</Button>
        </form>
      )}
      {record?.sentence && (
        <div className="mt-3 space-y-2">
          <p className="text-sm">{record.sentence}</p>
          <Button size="sm" type="button" onClick={copy}>Copy attendance for Word</Button>
        </div>
      )}
      {readOnly && record?.presentation && !record.stale && !record.sentence && <p className="mt-2 text-sm">No attendance sentence saved.</p>}
      {notice && <p className="mt-2 text-sm" role="status">{notice}</p>}
      {error && <p className="mt-2 text-sm text-red-700" role="alert">{error}</p>}
    </details>
  );
}
