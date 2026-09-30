import { useEffect, useRef, useState } from 'react';
import { requestEnvelope } from '../../utils/api-request';
import { Button, Card } from '../Layout';

const SOURCES = [
  ['retraction_watch', 'Retraction Watch'],
  ['pubpeer', 'PubPeer'],
  ['news', 'News'],
];

function sourceState(source) {
  if (source?.error && source.searched !== true) return 'Not searched · error';
  if (!source || source.searched !== true) return 'Not searched';
  if (source.error) return 'Error';
  return 'Searched';
}

function isIncomplete(result) {
  return SOURCES.some(([key]) => {
    const source = result?.sources?.[key];
    return !source || source.searched !== true || Boolean(source.error);
  });
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString();
}

function normalizeContext(data) {
  return {
    ...data,
    history: Array.isArray(data?.history) ? data.history : (data?.latestRun ? [data.latestRun] : []),
    historyHasMore: data?.historyHasMore === true,
    historyNextBeforeId: Number.isFinite(data?.historyNextBeforeId) ? data.historyNextBeforeId : null,
    review: data?.review && typeof data.review === 'object' ? data.review : null,
  };
}

function isFullContext(data, requestId) {
  return data?.requestId === requestId
    && Array.isArray(data.people)
    && (data.latestRun === null || (data.latestRun && typeof data.latestRun === 'object'))
    && Array.isArray(data.history)
    && data.review && typeof data.review === 'object'
    && typeof data.review.status === 'string';
}

function reviewStatusLabel(status) {
  const labels = {
    not_screened: 'Not reviewed',
    needs_review: 'Needs staff review',
    incomplete: 'Incomplete screen',
    roster_changed: 'People roster changed',
    identity_unavailable: 'Person identity unavailable',
    approved: 'Integrity review complete',
    hold: 'Review on hold',
  };
  return labels[status] || 'Review status unavailable';
}

function DecisionNote({ decision }) {
  if (!decision) return null;
  return (
    <div className="mt-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
      <p className="font-medium text-gray-900">{decision.decision === 'approved' ? 'Integrity review approved' : 'Integrity review placed on hold'}</p>
      <p className="mt-1">Recorded by {decision.reviewerName || 'staff reviewer'} · {formatDate(decision.createdAt)}</p>
      {decision.notes && <p className="mt-2 whitespace-pre-wrap">{decision.notes}</p>}
    </div>
  );
}

function RunFindings({ run }) {
  const results = Array.isArray(run?.results) ? run.results : [];
  return results.length ? (
    <ul className="mt-3">{results.map((result, index) => <PersonResult key={`${result.name || 'person'}-${index}`} result={result} />)}</ul>
  ) : <p className="mt-3 text-sm text-amber-800">This saved run has no person results to display.</p>;
}

function SourceSummary({ sourceKey, label, source }) {
  const searched = source?.searched === true;
  const matches = sourceKey === 'retraction_watch' && Array.isArray(source?.matches) ? source.matches : [];
  const hasConcerns = source?.hasConcerns === true || matches.length > 0;
  const hasResultCount = typeof source?.resultCount === 'number' && Number.isFinite(source.resultCount);
  const summary = typeof source?.summary === 'string' && source.summary.trim() ? source.summary : null;
  const sourceItems = Array.isArray(source?.rawResults) ? source.rawResults : [];
  return (
    <li className="py-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
        <span className="font-medium text-gray-900">{label}</span>
        <span className={source?.error ? 'text-red-700' : 'text-gray-600'}>{sourceState(source)}</span>
        {searched && !source?.error && (
          sourceKey === 'retraction_watch'
            ? <span className="text-gray-600">{hasConcerns ? `${matches.length} match${matches.length === 1 ? '' : 'es'}` : 'No matches reported'}</span>
            : hasConcerns
              ? <span className="text-gray-600">Flagged for human review{hasResultCount ? ` · ${source.resultCount} search results` : ''}</span>
              : hasResultCount
                ? <span className="text-gray-600">{source.resultCount} search result{source.resultCount === 1 ? '' : 's'}</span>
                : <span className="text-gray-600">No concerns reported by this source</span>
        )}
      </div>
      {summary && <p className="mt-1 text-sm text-gray-700 whitespace-pre-wrap">{summary}</p>}
      {matches.map((match, index) => (
        <div key={`${match.sourceIdentifier || match.doi || match.title || 'match'}-${index}`} className="mt-1 text-sm text-gray-700">
          <p className="font-medium text-gray-900">{match.title || 'Retraction Watch match'}</p>
          {match.confidenceLevel && <p className="mt-0.5 text-xs text-gray-600">Match confidence: {match.confidenceLevel}{typeof match.confidence === 'number' && Number.isFinite(match.confidence) ? ` (${match.confidence}%)` : ''}</p>}
          {match.matchedAuthor && <p className="mt-0.5 text-sm">Matched author: {match.matchedAuthor}</p>}
          {match.source && <span className="text-gray-500"> · {match.source}</span>}
          {match.retractionNature && <p className="mt-1">Action: {match.retractionNature}</p>}
          {Array.isArray(match.reasons) && match.reasons.length > 0 && <p className="mt-1">Reasons: {match.reasons.join(', ')}</p>}
          {match.doi && <p className="mt-1">DOI: <a className="text-blue-700 underline underline-offset-2" href={`https://doi.org/${match.doi.split('/').map(encodeURIComponent).join('/')}`} target="_blank" rel="noopener noreferrer">{match.doi}</a></p>}
          {(typeof match.urls === 'string' ? match.urls.split(';') : (Array.isArray(match.urls) ? match.urls : []))
            .map((rawUrl) => rawUrl.trim()).filter((url) => /^https?:\/\//i.test(url))
            .map((url) => <a key={url} className="ml-2 text-blue-700 underline underline-offset-2" href={url} target="_blank" rel="noopener noreferrer">View Source</a>)}
        </div>
      ))}
      {sourceItems.map((item, index) => /^https?:\/\//i.test(item?.link || '') && (
        <p key={`${item.link}-${index}`} className="mt-1 text-sm">
          <a className="text-blue-700 underline underline-offset-2" href={item.link} target="_blank" rel="noopener noreferrer">{item.title || item.link}</a>
        </p>
      ))}
      {source?.searchUrl && /^https?:\/\//i.test(source.searchUrl) && <a className="mt-1 inline-block text-sm text-blue-700 underline underline-offset-2" href={source.searchUrl} target="_blank" rel="noopener noreferrer">Open source search</a>}
      {source?.error && <p className="mt-1 text-sm text-red-700">{source.error}</p>}
      {!searched && !source?.error && <p className="mt-1 text-sm text-gray-600">This source was not searched.</p>}
    </li>
  );
}

function PersonResult({ result }) {
  const incomplete = isIncomplete(result);
  const matches = Number.isFinite(Number(result?.matchCount)) ? Number(result.matchCount) : 0;
  const hasConcerns = result?.hasConcerns === true || matches > 0;
  return (
    <li className="border-t border-gray-200 py-4 first:border-0 first:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-gray-900">{result?.name || 'Unnamed person'}</h3>
          {result?.isCommonName && <p className="mt-0.5 text-xs font-medium text-blue-800">Common name — verify identity carefully</p>}
          {result?.institution && <p className="mt-0.5 text-sm text-gray-600">{result.institution}</p>}
        </div>
        <p className={hasConcerns || incomplete ? 'text-sm font-medium text-amber-800' : 'text-sm text-gray-600'}>
          {hasConcerns ? `${matches > 0 ? `${matches} item${matches === 1 ? '' : 's'}` : 'Concerns flagged'} for human review${incomplete ? ' · Incomplete screen' : ''}` : incomplete ? 'Incomplete screen' : 'No concerns reported'}
        </p>
      </div>
      <ul className="mt-3 divide-y divide-gray-100">
        {SOURCES.map(([key, label]) => (
          <SourceSummary key={key} sourceKey={key} label={label} source={result?.sources?.[key]} />
        ))}
      </ul>
      {incomplete && <p className="mt-2 text-xs text-amber-800">Review the source status and error above; this result is not a complete screen.</p>}
    </li>
  );
}

export default function IntegrityTab({ requestId }) {
  const [record, setRecord] = useState(null);
  const [loadingRequestId, setLoadingRequestId] = useState(requestId || null);
  const [runningRequestId, setRunningRequestId] = useState(null);
  const [error, setError] = useState(null);
  const [loadedRequestId, setLoadedRequestId] = useState(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [uncertainRun, setUncertainRun] = useState(false);
  const [refreshingRun, setRefreshingRun] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [reviewNotes, setReviewNotes] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewUncertain, setReviewUncertain] = useState(false);
  const generation = useRef(0);
  const mounted = useRef(false);
  const activeRequest = useRef(requestId);
  activeRequest.current = requestId;

  useEffect(() => {
    mounted.current = true;
    const id = requestId;
    const current = ++generation.current;
    setLoadingRequestId(id || null);
    setError(null);
    setRunningRequestId(null);
    setUncertainRun(false);
    setReviewNotes('');
    setRefreshingRun(false);
    setHistoryLoading(false);
    setReviewSubmitting(false);
    setReviewUncertain(false);
    setRecord(null);
    setLoadedRequestId(null);
    if (!id) {
      setLoadingRequestId(null);
      return () => { mounted.current = false; generation.current += 1; };
    }
    (async () => {
      try {
        const response = await requestEnvelope(`/api/workbench/integrity/${encodeURIComponent(id)}`, { tolerantBody: true });
        if (!response.ok) throw new Error(response.data?.error || `Could not load integrity screen (${response.status})`);
        if (generation.current !== current || activeRequest.current !== id) return;
        if (!isFullContext(response.data, id)) {
          throw new Error('Integrity information did not match the requested request. Retry loading.');
        }
        setRecord(normalizeContext(response.data));
        setLoadedRequestId(id);
      } catch (loadError) {
        if (generation.current === current && activeRequest.current === id) setError(loadError.message);
      } finally {
        if (generation.current === current && activeRequest.current === id) setLoadingRequestId(null);
      }
    })();
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, [requestId, reloadTick]);

  const currentRecord = record?.requestId === requestId ? record : null;
  const people = Array.isArray(currentRecord?.people) ? currentRecord.people : [];
  const latestRun = currentRecord?.latestRun || null;
  const running = runningRequestId === requestId;
  const missingNames = people.filter((person) => !String(person?.name || '').trim());

  const runScreen = async () => {
    if (!requestId || running || reviewSubmitting || refreshingRun || uncertainRun || reviewUncertain || people.length === 0 || missingNames.length > 0) return;
    const confirmed = window.confirm(`Run an integrity screen for ${people.length} ${people.length === 1 ? 'person' : 'people'}? This uses Claude and SerpAPI credits for each person.`);
    if (!confirmed) return;
    const id = requestId;
    const current = generation.current;
    let screenSaved = false;
    setRunningRequestId(id);
    setReviewUncertain(true);
    setRecord((existing) => existing ? { ...existing, review: null } : existing);
    setError(null);
    try {
      const response = await requestEnvelope(`/api/workbench/integrity/${encodeURIComponent(id)}/run`, {
        method: 'POST', body: {}, tolerantBody: true,
      });
      if (!response.ok) throw new Error(response.data?.error || `Integrity screen failed (${response.status})`);
      if (response.data?.requestId !== id || !Array.isArray(response.data.people)
        || !response.data.run || typeof response.data.run !== 'object'
        || !Array.isArray(response.data.run.results) || !response.data.run.createdAt) {
        throw new Error('The returned screen did not match this request. The previous saved screen is still shown.');
      }
      if (!mounted.current || generation.current !== current || activeRequest.current !== id) return;
      setRecord((currentRecord) => normalizeContext({
        ...currentRecord,
        requestId: id,
        people: response.data.people,
        latestRun: response.data.run,
        history: [response.data.run, ...(currentRecord?.history || []).filter((run) => String(run.id) !== String(response.data.run.id))],
        review: null,
      }));
      setLoadedRequestId(id);
      screenSaved = true;
      setUncertainRun(false);
      setReviewUncertain(true);
      const refreshed = await requestEnvelope(`/api/workbench/integrity/${encodeURIComponent(id)}`, { tolerantBody: true });
      if (!refreshed.ok || !isFullContext(refreshed.data, id)
        || String(refreshed.data.latestRun?.id) !== String(response.data.run.id)) {
        throw new Error('The screen was saved, but its staff review status could not be refreshed.');
      }
      if (!mounted.current || generation.current !== current || activeRequest.current !== id) return;
      setRecord(normalizeContext(refreshed.data));
      setReviewUncertain(false);
    } catch (runError) {
      if (mounted.current && generation.current === current && activeRequest.current === id) {
        if (!screenSaved) {
          setUncertainRun(true);
          setError(`${runError.message} Completion may be uncertain. The previous saved screen is still shown; reload it before running again.`);
        } else {
          setReviewUncertain(true);
          setError(`${runError.message} The screen may be saved, but its staff review status is unknown. Reload the review context before approval.`);
        }
      }
    } finally {
      if (mounted.current && generation.current === current && activeRequest.current === id) setRunningRequestId(null);
    }
  };

  const reloadSavedRun = async () => {
    if (!requestId || refreshingRun || runningRequestId === requestId || reviewSubmitting) return;
    const id = requestId;
    const current = generation.current;
    setRefreshingRun(true);
    try {
      const response = await requestEnvelope(`/api/workbench/integrity/${encodeURIComponent(id)}`, { tolerantBody: true });
      if (!response.ok) throw new Error(response.data?.error || `Reload failed (${response.status})`);
      if (!isFullContext(response.data, id)) {
        throw new Error('The reloaded integrity information did not match this request.');
      }
      if (!mounted.current || generation.current !== current || activeRequest.current !== id) return;
      setRecord(normalizeContext(response.data));
      setLoadedRequestId(id);
      setUncertainRun(false);
      setReviewUncertain(false);
      setError(null);
    } catch (reloadError) {
      if (mounted.current && generation.current === current && activeRequest.current === id) {
        setError(`${reloadError.message} The previous saved screen remains visible; retry loading before running again.`);
      }
    } finally {
      if (mounted.current && generation.current === current && activeRequest.current === id) setRefreshingRun(false);
    }
  };

  const loadMoreHistory = async () => {
    if (!requestId || historyLoading || !currentRecord?.historyHasMore || !currentRecord?.historyNextBeforeId) return;
    const id = requestId;
    const beforeId = currentRecord.historyNextBeforeId;
    const current = generation.current;
    setHistoryLoading(true);
    try {
      const response = await requestEnvelope(`/api/workbench/integrity/${encodeURIComponent(id)}?beforeRunId=${encodeURIComponent(beforeId)}`, { tolerantBody: true });
      if (!response.ok) throw new Error(response.data?.error || `Could not load earlier screens (${response.status})`);
      if (response.data?.requestId !== id || !Array.isArray(response.data.history)) throw new Error('Earlier screens did not match this request.');
      if (!mounted.current || generation.current !== current || activeRequest.current !== id) return;
      const page = normalizeContext(response.data);
      setRecord((existing) => normalizeContext({
        ...existing,
        history: [...(existing?.history || []), ...page.history.filter((run) => !(existing?.history || []).some((known) => String(known.id) === String(run.id)))],
        historyHasMore: page.historyHasMore,
        historyNextBeforeId: page.historyNextBeforeId,
      }));
      setError(null);
    } catch (historyError) {
      if (mounted.current && generation.current === current && activeRequest.current === id) setError(historyError.message);
    } finally {
      if (mounted.current && generation.current === current && activeRequest.current === id) setHistoryLoading(false);
    }
  };

  const submitReview = async (decision) => {
    const screeningId = Number(latestRun?.id);
    if (!requestId || running || refreshingRun || reviewUncertain || !record?.review?.canReview || !Number.isFinite(screeningId) || reviewSubmitting) return;
    if (decision === 'approved' && !record.review.canApprove) return;
    if (decision === 'hold' && !reviewNotes.trim()) return;
    const id = requestId;
    const current = generation.current;
    setReviewSubmitting(true);
    setReviewUncertain(true);
    setRecord((existing) => ({ ...existing, review: null }));
    setError(null);
    try {
      const response = await requestEnvelope(`/api/workbench/integrity/${encodeURIComponent(id)}/review`, {
        method: 'POST',
        body: { screeningId, decision, notes: reviewNotes },
        tolerantBody: true,
      });
      if (!response.ok) throw new Error(response.data?.error || `Could not record integrity review (${response.status})`);
      if (response.data?.requestId !== id || !Array.isArray(response.data.people)
        || !Array.isArray(response.data.history) || !response.data.review) {
        throw new Error('The review response did not match this request.');
      }
      if (!mounted.current || generation.current !== current || activeRequest.current !== id) return;
      setRecord(normalizeContext(response.data));
      setReviewNotes('');
      setReviewUncertain(false);
    } catch (reviewError) {
      if (mounted.current && generation.current === current && activeRequest.current === id) {
        setError(`${reviewError.message} The decision outcome may be uncertain; reload the review context before acting again.`);
      }
    } finally {
      if (mounted.current && generation.current === current && activeRequest.current === id) setReviewSubmitting(false);
    }
  };

  if (loadingRequestId === requestId) {
    return <Card hover={false}><p className="text-sm text-gray-600" role="status">Loading integrity information…</p></Card>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">{error}</div>}
      {loadedRequestId !== requestId ? (
        <Card hover={false}>
          <p className="text-sm text-gray-700">Integrity information could not be loaded, so the people list and saved result are unknown.</p>
          <Button className="mt-3" variant="outline" onClick={() => setReloadTick((value) => value + 1)}>Retry loading</Button>
        </Card>
      ) : <>
      <Card hover={false}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Integrity screen</h2>
            <p className="mt-1 max-w-3xl text-sm text-gray-600">Screens the request’s PI and Co-PIs using public integrity sources. Results support human review and are not a determination of misconduct.</p>
          </div>
          <Button onClick={runScreen} disabled={!people.length || !requestId || missingNames.length > 0 || uncertainRun || reviewUncertain || reviewSubmitting || refreshingRun} loading={running}>
            {running ? 'Screening…' : 'Run screen'}
          </Button>
        </div>
        {missingNames.length > 0 && <p className="mt-2 text-sm text-amber-800">A screen cannot run because {missingNames.length === 1 ? 'one person has' : `${missingNames.length} people have`} no usable name. Reload the request people details before screening.</p>}
        {uncertainRun && <Button className="mt-2" variant="outline" onClick={reloadSavedRun} loading={refreshingRun}>Reload saved screen</Button>}
        <h3 className="mt-5 text-base font-semibold text-gray-900">People to be screened</h3>
        {people.length === 0 ? (
          <p className="mt-2 text-sm text-gray-600">No PI or Co-PI contacts were found for this request.</p>
        ) : (
          <ul className="mt-2 divide-y divide-gray-200" aria-label="People to be screened">
            {people.map((person) => (
              <li key={person.contactId} className="py-3 first:pt-0">
                <p className="text-sm font-medium text-gray-900">{String(person.name || '').trim() || 'Name unavailable'}</p>
                <p className="mt-0.5 text-sm text-gray-600">{[person.role || 'Role unavailable', person.institution || 'Institution unavailable'].join(' · ')}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card hover={false}>
        <h2 className="text-lg font-semibold text-gray-900">Latest saved screen</h2>
        {!latestRun ? (
          <p className="mt-2 text-sm text-gray-600">No saved screen yet. Run a screen to see findings here.</p>
        ) : (
          <>
            <p className="mt-1 text-sm text-gray-600">Run {formatDate(latestRun.createdAt)} · {latestRun.matchCount || 0} items reported</p>
            <RunFindings run={latestRun} />
          </>
        )}
        {latestRun && (
          <div className="mt-5 border-t border-gray-200 pt-4" aria-labelledby="integrity-review-heading">
            <h3 id="integrity-review-heading" className="text-base font-semibold text-gray-900">PD integrity review</h3>
            {reviewUncertain ? (
              <div className="mt-2" role="status">
                <p className="text-sm text-amber-800">{running ? 'Screening is in progress; the previous approval is hidden until review status refreshes.' : 'Review status is unknown until the saved context is reloaded. No approval is shown as complete.'}</p>
                {!running && <Button className="mt-2" variant="outline" onClick={reloadSavedRun} loading={refreshingRun} disabled={reviewSubmitting}>Reload review context</Button>}
              </div>
            ) : record?.review ? (
              <>
                <p className={`mt-1 text-sm ${record.review.status === 'approved' ? 'font-semibold text-green-800' : record.review.status === 'hold' ? 'font-semibold text-amber-800' : 'text-gray-700'}`}>
                  {reviewStatusLabel(record.review.status)}
                </p>
                {record.review.reason && <p className="mt-1 text-sm text-gray-600">{record.review.reason}</p>}
                <DecisionNote decision={record.review.latestDecision} />
                {(() => {
                  const latestHistoryRun = (record.history || []).find((run) => String(run.id) === String(latestRun.id));
                  const decisions = Array.isArray(latestHistoryRun?.reviews) ? latestHistoryRun.reviews : [];
                  if (decisions.length < 2) return null;
                  return (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-sm font-medium text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500">Earlier decisions for this screen ({decisions.length - 1})</summary>
                      {decisions.slice(1).map((decision) => <DecisionNote key={decision.id} decision={decision} />)}
                    </details>
                  );
                })()}
                {record.review.canReview && (
                  <div className="mt-4 space-y-2">
                    <label htmlFor="integrity-review-notes" className="block text-sm font-medium text-gray-900">Staff-only review notes</label>
                    <textarea
                      id="integrity-review-notes"
                      value={reviewNotes}
                      onChange={(event) => setReviewNotes(event.target.value.slice(0, 2000))}
                      maxLength={2000}
                      rows={3}
                      disabled={reviewSubmitting}
                      className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
                      aria-describedby="integrity-review-note-help"
                    />
                    <p id="integrity-review-note-help" className="text-xs text-gray-500">Visible to staff only. Required to place this review on hold. An approval records integrity review only; it is not a funding decision. {reviewNotes.length}/2000</p>
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => submitReview('approved')} disabled={!record.review.canApprove || reviewSubmitting || running || refreshingRun || reviewUncertain} loading={reviewSubmitting}>
                        Record approval
                      </Button>
                      <Button variant="outline" onClick={() => submitReview('hold')} disabled={!reviewNotes.trim() || reviewSubmitting || running || refreshingRun || reviewUncertain} loading={reviewSubmitting}>
                        Place on hold
                      </Button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p className="mt-1 text-sm text-gray-600">Review status is unavailable. Reload the saved context before recording a decision.</p>
            )}
          </div>
        )}
        <p className="mt-4 text-xs text-gray-500">Staff should review the cited source material and context before drawing conclusions.</p>
      </Card>
      {latestRun && (() => {
        const earlierRuns = (Array.isArray(record?.history) ? record.history : [])
          .filter((run) => String(run.id) !== String(latestRun.id));
        if (!earlierRuns.length && !record?.historyHasMore) return null;
        return (
          <Card hover={false}>
            <details>
              <summary className="cursor-pointer text-base font-semibold text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500">Earlier screens ({earlierRuns.length}{record?.historyHasMore ? '+' : ''})</summary>
              <ul className="mt-3 divide-y divide-gray-200">
                {earlierRuns.map((run) => (
                  <li key={run.id} className="py-3 first:pt-0">
                    <details>
                      <summary className="cursor-pointer text-sm font-medium text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500">Screen from {formatDate(run.createdAt)} · {run.matchCount || 0} items · read only</summary>
                      <RunFindings run={run} />
                      {Array.isArray(run.reviews) && run.reviews.length > 0 && (
                        <div className="mt-3">
                          <p className="text-sm font-medium text-gray-900">Recorded review decisions</p>
                          {run.reviews.map((decision) => <DecisionNote key={decision.id} decision={decision} />)}
                        </div>
                      )}
                    </details>
                  </li>
                ))}
              </ul>
              {record?.historyHasMore && (
                <Button className="mt-3" variant="outline" onClick={loadMoreHistory} loading={historyLoading}>
                  {historyLoading ? 'Loading earlier screens…' : 'Load earlier screens'}
                </Button>
              )}
            </details>
          </Card>
        );
      })()}
      </>}
    </div>
  );
}
