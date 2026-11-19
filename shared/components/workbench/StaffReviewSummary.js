import { useEffect, useRef, useState } from 'react';
import { Button, Card } from '../Layout';
import { requestJson } from '../../utils/api-request';
import { composeReviewerFacts } from '../../utils/review-writeup-paragraphs';

export default function StaffReviewSummary({ requestId, evidenceHash, reviewers = [], refreshReports, readOnly = false, onOpenReports = null, onJ27Facts = null }) {
  const [record, setRecord] = useState(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [conflictSummary, setConflictSummary] = useState(null);
  const generation = useRef(0);
  const endpoint = '/api/workbench/staff-review-summary';
  const read = () => requestJson(endpoint + '?requestId=' + encodeURIComponent(requestId)
    + (readOnly ? '&includeReviewerFacts=1' : ''));

  useEffect(() => {
    const current = ++generation.current;
    read().then(result => {
      if (generation.current !== current) return;
      setRecord(result);
      setDraft(result.summary);
    }).catch(failure => {
      if (generation.current !== current) return;
      setError(failure.message);
      onJ27Facts?.(requestId, { summaryStale: null }); // a failed read leaves freshness unknown (step E)
    });
    return () => { generation.current += 1; };
  }, [requestId, readOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  // Step E (plan C7): summary freshness for the page's stage, only when both the
  // saved and the current evidence hashes are known; unknown is never "current".
  useEffect(() => {
    if (!onJ27Facts || !record) return;
    const current = readOnly ? record.currentEvidenceHash : evidenceHash;
    // A read that cannot establish freshness replaces any earlier value with unknown.
    const known = Boolean(record.summary && record.evidenceHash && current);
    onJ27Facts(requestId, { summaryStale: known ? record.evidenceHash !== current : null });
  }, [onJ27Facts, record, readOnly, evidenceHash, requestId]);

  async function save(event) {
    event.preventDefault();
    if (busy || !record?.version || !evidenceHash || conflictSummary !== null) return;
    const current = generation.current;
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      await requestJson(endpoint, {
        method: 'POST',
        body: { requestId, version: record.version, summary: draft, evidenceHash },
      });
      if (generation.current !== current) return;
      // A successful write consumes the version, even if readback fails.
      setRecord({ ...record, version: null });
      setSaved(true);
      const updated = await read();
      if (generation.current !== current) return;
      setRecord(updated);
      setDraft(updated.summary);
    } catch (failure) {
      if (generation.current !== current) return;
      setError(failure.message);
      if (failure.status === 409) {
        try {
          const updated = await read();
          if (generation.current !== current) return;
          setRecord(updated);
          if (updated.summary !== record.summary) setConflictSummary(updated.summary);
          await refreshReports?.();
        } catch (refreshFailure) {
          if (generation.current === current) {
            setRecord({ ...record, version: null });
            setError(refreshFailure.message);
          }
        }
      }
    } finally {
      if (generation.current === current) setBusy(false);
    }
  }

  const currentEvidenceHash = readOnly ? record?.currentEvidenceHash : evidenceHash;
  const evidenceChanged = Boolean(record?.evidenceHash && currentEvidenceHash && record.evidenceHash !== currentEvidenceHash);
  const evidenceNotice = evidenceChanged && (
    <p className="mt-2 text-sm text-amber-800">Review evidence changed since the summary was saved.</p>
  );

  if (readOnly && onOpenReports) {
    return (
      <section aria-label="Staff interpretation from Reports" className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <h3 className="text-base font-semibold text-gray-900">Staff interpretation from Reports</h3>
          <button type="button" onClick={onOpenReports}
            className="rounded-md text-sm font-semibold text-blue-800 underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-blue-600">
            Open Reports
          </button>
        </div>
        <p className="mt-2 max-w-prose whitespace-pre-wrap text-sm text-gray-700">
          {error || (record ? record.summary || 'No staff interpretation saved.' : 'Loading staff interpretation…')}
        </p>
        {evidenceNotice}
        {record && (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer font-medium text-gray-700">Reviewer facts</summary>
            <p className="mt-1 max-w-prose text-gray-700">{record.reviewerFacts ?? 'Reviewer facts could not be loaded.'}</p>
          </details>
        )}
      </section>
    );
  }

  if (readOnly) {
    const content = error ? <p role="alert" className="mt-2 text-sm text-red-700">{error}</p> : record ? (
      <dl className="mt-3 space-y-3 text-sm">
        <div>
          <dt className="font-medium">Reviewer facts</dt>
          <dd>{record.reviewerFacts ?? 'Reviewer facts could not be loaded.'}</dd>
          {evidenceNotice}
        </div>
        <div>
          <dt className="font-medium">Staff interpretation</dt>
          <dd className="whitespace-pre-wrap">{record.summary || 'No staff interpretation saved.'}</dd>
        </div>
      </dl>
    ) : <p className="mt-2 text-sm" role="status">Loading staff summary…</p>;
    return (
      <section className="py-3">
        <h3 className="text-sm font-semibold text-gray-900">Staff review summary</h3>
        {content}
      </section>
    );
  }

  return (
    <Card hover={false}>
      <h2 id="staff-review-summary-heading" tabIndex={-1} className="scroll-mt-4 font-semibold">Staff review summary</h2>
      <p className="mt-2 text-sm font-medium">Reviewer facts</p>
      <p className="text-sm">{composeReviewerFacts(reviewers)}</p>
      {evidenceNotice}
      {record && (
        <form className="mt-3 space-y-2" onSubmit={save}>
          <label className="block text-sm font-medium" htmlFor="staff-review-interpretation">Staff interpretation</label>
          <textarea
            className="w-full rounded-lg border p-2"
            id="staff-review-interpretation"
            rows={4}
            maxLength={10000}
            value={draft}
            disabled={busy}
            onChange={event => { setDraft(event.target.value); setSaved(false); }}
          />
          {conflictSummary !== null && (
            <div className="space-y-2 text-sm">
              <p className="font-medium">Current saved summary</p>
              <p className="whitespace-pre-wrap">{conflictSummary || 'The saved summary was cleared.'}</p>
              <Button size="sm" type="button" onClick={() => setConflictSummary(null)}>Keep my draft</Button>
            </div>
          )}
          <Button size="sm" type="submit" loading={busy}
            disabled={conflictSummary !== null || !record.version || !evidenceHash || (draft.trim() === record.summary && !evidenceChanged)}>
            Save summary
          </Button>
        </form>
      )}
      {saved && <p role="status" className="mt-2 text-sm">Summary saved.</p>}
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      {!record && !error && !saved && <p className="mt-2 text-sm">Loading staff summary…</p>}
    </Card>
  );
}
