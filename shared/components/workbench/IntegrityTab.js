import { useEffect, useRef, useState } from 'react';
import { requestEnvelope } from '../../utils/api-request';
import { Button, Card } from '../Layout';

const SOURCES = [
  ['retraction_watch', 'Retraction Watch'],
  ['pubpeer', 'PubPeer'],
  ['news', 'News'],
];

function sourceState(source) {
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

function SourceSummary({ sourceKey, label, source }) {
  const searched = source?.searched === true;
  const matches = sourceKey === 'retraction_watch' && Array.isArray(source?.matches) ? source.matches : [];
  const hasConcerns = source?.hasConcerns === true || matches.length > 0;
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
            : Number.isFinite(Number(source?.resultCount))
              ? <span className="text-gray-600">{source.resultCount} search result{Number(source.resultCount) === 1 ? '' : 's'}</span>
              : hasConcerns ? <span className="text-gray-600">Flagged for human review</span> : <span className="text-gray-600">No concerns reported by this source</span>
        )}
      </div>
      {summary && <p className="mt-1 text-sm text-gray-700 whitespace-pre-wrap">{summary}</p>}
      {matches.map((match, index) => (
        <div key={`${match.sourceIdentifier || match.doi || match.title || 'match'}-${index}`} className="mt-1 text-sm text-gray-700">
          {match.title || match.summary || match.doi || 'Retraction Watch match'}
          {match.source && <span className="text-gray-500"> · {match.source}</span>}
          {match.doi && <span className="text-gray-500"> · DOI {match.doi}</span>}
          {Array.isArray(match.urls) && match.urls.map((url) => /^https?:\/\//i.test(url) && <a key={url} className="ml-2 text-blue-700 underline underline-offset-2" href={url} target="_blank" rel="noopener noreferrer">Source</a>)}
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
  return (
    <li className="border-t border-gray-200 py-4 first:border-0 first:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-gray-900">{result?.name || 'Unnamed person'}</h3>
          {result?.institution && <p className="mt-0.5 text-sm text-gray-600">{result.institution}</p>}
        </div>
        <p className={incomplete ? 'text-sm font-medium text-amber-800' : (result?.hasConcerns ? 'text-sm font-medium text-amber-800' : 'text-sm text-gray-600')}>
          {incomplete ? 'Incomplete screen' : result?.hasConcerns ? `${matches} item${matches === 1 ? '' : 's'} for human review` : 'No concerns reported'}
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
        if (response.data?.requestId !== id || !Array.isArray(response.data.people)
          || !(response.data.latestRun === null || (response.data.latestRun && typeof response.data.latestRun === 'object'))) {
          throw new Error('Integrity information did not match the requested request. Retry loading.');
        }
        setRecord(response.data);
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

  const runScreen = async () => {
    if (!requestId || running || people.length === 0) return;
    const confirmed = window.confirm(`Run an integrity screen for ${people.length} ${people.length === 1 ? 'person' : 'people'}? This uses Claude and SerpAPI credits for each person.`);
    if (!confirmed) return;
    const id = requestId;
    const current = generation.current;
    setRunningRequestId(id);
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
      setRecord({ requestId: id, people: response.data.people, latestRun: response.data.run });
      setLoadedRequestId(id);
    } catch (runError) {
      if (mounted.current && generation.current === current && activeRequest.current === id) setError(runError.message);
    } finally {
      if (mounted.current && generation.current === current && activeRequest.current === id) setRunningRequestId(null);
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
          <Button onClick={runScreen} disabled={!people.length || !requestId} loading={running}>
            {running ? 'Screening…' : 'Run screen'}
          </Button>
        </div>
        <h3 className="mt-5 text-base font-semibold text-gray-900">People to be screened</h3>
        {people.length === 0 ? (
          <p className="mt-2 text-sm text-gray-600">No PI or Co-PI contacts were found for this request.</p>
        ) : (
          <ul className="mt-2 divide-y divide-gray-200" aria-label="People to be screened">
            {people.map((person) => (
              <li key={person.contactId} className="py-3 first:pt-0">
                <p className="text-sm font-medium text-gray-900">{person.name || 'Name unavailable'}</p>
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
            {Array.isArray(latestRun.results) && latestRun.results.length > 0 ? (
              <ul className="mt-4">
                {latestRun.results.map((result, index) => <PersonResult key={`${result.name || 'person'}-${index}`} result={result} />)}
              </ul>
            ) : <p className="mt-3 text-sm text-amber-800">This saved run has no person results to display.</p>}
          </>
        )}
        <p className="mt-4 text-xs text-gray-500">Staff should review the cited source material and context before drawing conclusions.</p>
      </Card>
      </>}
    </div>
  );
}
