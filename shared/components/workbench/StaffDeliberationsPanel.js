/** Request-first Staff Deliberations overview for the selected program/cycle. */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { requestJson } from '../../utils/api-request';
import { Card } from '../Layout';
import ScopeSegment from './ScopeSegment';
import TestRequestBadge from '../TestRequestBadge';
import {
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../config/requestDocument';

function requestHref(request, tab = 'staff-deliberations') {
  const params = new URLSearchParams({ tab });
  if (request.requestNumber) params.set('n', request.requestNumber);
  return `/workbench/${request.requestId}?${params.toString()}`;
}

function dateTime(value, timeZone = null) {
  const ms = Date.parse(value || '');
  if (!Number.isFinite(ms)) return null;
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      ...(timeZone ? { timeZone, timeZoneName: 'short' } : {}),
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleString();
  }
}

function taskFor(request) {
  if (request.finalPhase === 'leadership-review') return { label: 'Leadership review', bucket: 'review', action: 'Open review details', tab: 'final-writeup' };
  if (request.finalPhase === 'group-review') return { label: 'Group review in progress', bucket: 'review', action: 'Open review details', tab: 'final-writeup' };
  if (request.writeup?.correctionInProgress) return { label: 'Corrections in progress', bucket: 'attention', action: 'Open request details', tab: 'staff-deliberations' };
  const attention = ['blocked', 'unavailable'].includes(request.preparation?.state)
    || request.finalReview?.availability === 'unavailable'
    || (request.writeup?.lifecycleState === REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL && request.finalPhase !== 'group-review')
    || ['unavailable', 'ambiguous'].includes(request.timing?.availability)
    || [request.brief, request.writeup].some((fact) => ['unavailable', 'ambiguous'].includes(fact?.availability)
      || fact?.operationStatus === REQUEST_DOCUMENT_OPERATION_STATUS.FAILED);
  if (attention) return { label: 'Needs attention', bucket: 'attention', action: 'Check request details', tab: 'staff-deliberations' };
  if (request.preparation?.due) {
    const ready = request.writeup?.availability === 'available'
      && request.writeup.lifecycleState === REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW
      && request.writeup.milestoneComplete === true;
    if (!ready && request.preparation.state === 'prepared') return { label: 'Needs attention', bucket: 'attention', action: 'Check request details', tab: 'staff-deliberations' };
    if (ready) return { label: 'Post-visit editing', bucket: 'post', action: 'Open request details', tab: 'staff-deliberations' };
    if (request.preparation.state === 'disabled') {
      return { label: request.writeup?.availability === 'available' ? 'Working draft available' : 'No working writeup yet', bucket: 'post', action: 'Open request details', tab: 'staff-deliberations' };
    }
    if (request.preparation.state === 'running' || request.writeup?.operationStatus === REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING) return { label: 'Preparing working writeup', bucket: 'post', action: 'Open request details', tab: 'staff-deliberations' };
    if (request.preparation.state === 'due') return { label: 'Waiting for automatic preparation', bucket: 'post', action: 'Open request details', tab: 'staff-deliberations' };
    if (request.preparation.state === 'pending') return { label: 'Queued for preparation', bucket: 'post', action: 'Open request details', tab: 'staff-deliberations' };
    return { label: 'Working writeup needed', bucket: 'post', action: 'Open request details', tab: 'staff-deliberations' };
  }
  const notScheduled = request.timing?.availability === 'missing' || !request.timing?.endIso;
  return { label: notScheduled ? 'Schedule needed' : 'Before presentation', bucket: notScheduled ? 'attention' : 'before', action: 'Open request details', tab: 'staff-deliberations' };
}

function documentState(fact, isBrief) {
  if (fact?.availability === 'unavailable') return 'Status unavailable';
  if (fact?.availability === 'ambiguous') return 'Needs reconciliation';
  if (fact?.operationStatus === REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING) return 'Draft is being generated';
  if (fact?.operationStatus === REQUEST_DOCUMENT_OPERATION_STATUS.FAILED) return 'Last preparation attempt failed';
  if (fact?.availability !== 'available') return 'No current document';
  if (fact.lifecycleState === REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW) return isBrief ? 'Briefing ready' : fact.milestoneComplete ? 'Ready for presentation findings' : 'Checkpoint needs attention';
  if (fact.lifecycleState === REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL) return 'In review';
  return 'Draft';
}

function primaryDocument(request) {
  const afterPresentation = request.preparation?.due === true
    || request.writeup?.correctionInProgress === true
    || ['group-review', 'leadership-review'].includes(request.finalPhase);
  const preferred = afterPresentation ? 'writeup' : 'brief';
  const fact = request[preferred];
  if (fact?.availability === 'available' && fact.file?.webUrl) return { key: preferred, fact };
  if (afterPresentation) return null;
  const writeup = request.writeup;
  return writeup?.availability === 'available' && writeup.file?.webUrl ? { key: 'writeup', fact: writeup } : null;
}

function presentationTiming(request) {
  const time = dateTime(request.timing?.endIso, request.timing?.timeZone);
  if (['unavailable', 'ambiguous'].includes(request.timing?.availability)) {
    return time ? `Recorded presentation end (unverified) · ${time}` : 'Presentation schedule needs checking';
  }
  if (request.timing?.availability === 'missing') return 'Presentation end · Not scheduled';
  if (request.timing?.availability !== 'available') return 'Presentation end · Not recorded';
  return time ? `Scheduled presentation end · ${time}` : 'Presentation end · Not recorded';
}

function RequestCard({ request }) {
  const task = taskFor(request);
  const document = primaryDocument(request);
  const documentKey = request.preparation?.due === true
    || request.writeup?.correctionInProgress === true
    || ['group-review', 'leadership-review'].includes(request.finalPhase) ? 'writeup' : (document?.key || 'brief');
  const documentName = documentKey === 'writeup' ? 'Working writeup' : 'Pre-site briefing';
  const documentStatus = document
    ? documentState(document.fact, document.key === 'brief')
    : documentKey === 'writeup'
      ? documentState(request.writeup, false)
      : documentState(request.brief, true);
  return (
    <Card hover={false}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-base font-semibold text-gray-900">
            <Link href={requestHref(request)} className="underline-offset-2 hover:underline">
              {request.requestNumber ? `#${request.requestNumber}` : request.requestId}{request.title ? ` — ${request.title}` : ''}
            </Link>
          </h3>
          {request.institution && <p className="mt-1 text-sm text-gray-600">{request.institution}</p>}
          {request.programDirector && <p className="mt-1 text-sm text-gray-600">Lead PD: {request.programDirector}</p>}
          <TestRequestBadge isTestRequest={request.isTestRequest} className="mt-2" />
          <p className={`mt-2 text-sm font-semibold ${task.bucket === 'attention' ? 'text-amber-800' : 'text-gray-900'}`}>{task.label}</p>
          <p className="mt-1 text-sm text-gray-600">{presentationTiming(request)}</p>
          <p className="mt-1 text-sm text-gray-700"><span className="font-medium">{documentName}:</span> {documentStatus}</p>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
          {document ? (
            <a href={document.fact.file.webUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2">
              Open {documentName} in Word
            </a>
          ) : (
            <Link href={requestHref(request, task.tab)} className="inline-flex min-h-11 items-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2">{task.action}</Link>
          )}
          {document && <Link href={requestHref(request, task.tab)} className="inline-flex min-h-11 items-center rounded-lg px-4 py-2 text-sm font-medium text-gray-700 underline underline-offset-2 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2">{task.action}</Link>}
        </div>
      </div>
    </Card>
  );
}

export default function StaffDeliberationsPanel({
  programId,
  cycleCode,
  loadingCycles,
  scope = 'my',
  onScopeChange = () => {},
}) {
  const [requests, setRequests] = useState([]);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [requestCounts, setRequestCounts] = useState({ ordinary: 0, test: 0, total: 0 });
  const [loading, setLoading] = useState(false);
  const [serverNowIso, setServerNowIso] = useState(null);
  const [clockRefresh, setClockRefresh] = useState(0);
  const [error, setError] = useState(null);
  const requestSequence = useRef(0);
  const loadedScope = useRef(null);

  useEffect(() => {
    if (!programId || !cycleCode) {
      requestSequence.current += 1;
      setRequests([]);
      setRequestCounts({ ordinary: 0, test: 0, total: 0 });
      setError(null);
      setLoading(false);
      return undefined;
    }
    const sequence = ++requestSequence.current;
    const scopeKey = `${programId}:${cycleCode}:${scope}`;
    if (loadedScope.current !== scopeKey) setRequests([]);
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const params = new URLSearchParams({ programId, cycleCode, scope });
        const body = await requestJson(
          `/api/workbench/staff-deliberations?${params.toString()}`,
          { fallbackMessage: 'Failed to load requests', tolerantBody: true },
        );
        if (requestSequence.current !== sequence) return;
        loadedScope.current = scopeKey;
        setRequests(Array.isArray(body.artifacts) ? body.artifacts : []);
        setRequestCounts(body.requestCounts || { ordinary: body.artifacts?.length || 0, test: 0, total: body.artifacts?.length || 0 });
        setServerNowIso(body.serverNowIso || null);
      } catch (loadError) {
        if (requestSequence.current === sequence) {
          setError(loadError.message);
          setRequests([]);
          setRequestCounts({ ordinary: 0, test: 0, total: 0 });
          setServerNowIso(null);
        }
      } finally {
        if (requestSequence.current === sequence) setLoading(false);
      }
    })();
    return () => { requestSequence.current += 1; };
  }, [programId, cycleCode, scope, clockRefresh]);

  useEffect(() => {
    const serverNow = Date.parse(serverNowIso || '');
    if (!Number.isFinite(serverNow)) return undefined;
    const nextEnd = requests
      .filter((request) => request.timing?.availability === 'available' && request.preparation?.due !== true)
      .map((request) => Date.parse(request.timing.endIso || ''))
      .filter((end) => Number.isFinite(end) && end > serverNow)
      .sort((left, right) => left - right)[0];
    const waiting = requests.some((request) => ['due', 'pending', 'running'].includes(request.preparation?.state));
    if (!nextEnd && !waiting) return undefined;
    const delay = waiting ? 15000 : Math.min(2147483647, Math.max(1000, nextEnd - serverNow + 1000));
    const timer = setTimeout(() => setClockRefresh((value) => value + 1), delay);
    return () => clearTimeout(timer);
  }, [requests, serverNowIso]);

  const visible = requests.filter((request) => (filter === 'all' || taskFor(request).bucket === filter)
    && [request.requestNumber, request.title, request.institution, request.programDirector].filter(Boolean).join(' ').toLowerCase().includes(search.toLowerCase().trim()));
  if (!cycleCode && !loadingCycles) return null;

  return (
    <section aria-labelledby="staff-deliberations-heading">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="staff-deliberations-heading" className="sr-only">Staff Deliberations</h2>
          {!loading && !loadingCycles && <p className="mt-1 text-sm text-gray-600">
            {requestCounts.ordinary} requests in this program and cycle
            {requestCounts.test > 0 ? ` · ${requestCounts.test} test requests also shown` : ''}
          </p>}
        </div>
        <ScopeSegment scope={scope} onChange={onScopeChange} allLabel="All program directors" />
      </div>
      <p className="mb-3 max-w-3xl text-sm text-gray-600">Use the briefing before the presentation and the working writeup to add findings afterward. Open request details for preparation, sharing, and review steps.</p>
      <div className="mb-4 flex flex-wrap gap-3">
        <label className="text-sm text-gray-700">Task
          <select value={filter} onChange={(event) => setFilter(event.target.value)} className="ml-2 min-h-11 rounded-lg border border-gray-300 bg-white px-3">
            <option value="all">All tasks</option><option value="before">Before presentation</option><option value="post">Post-visit work</option><option value="review">In review</option><option value="attention">Needs attention</option>
          </select>
        </label>
        <label className="flex w-full min-w-0 items-center gap-2 text-sm text-gray-700 sm:w-auto sm:flex-1">Search
          <input value={search} onChange={(event) => setSearch(event.target.value)} type="search" placeholder="Request, title, institution or PD" className="min-h-11 min-w-0 flex-1 rounded-lg border border-gray-300 px-3" />
        </label>
      </div>
      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">{error}</div>}
      {loadingCycles || (loading && requests.length === 0) ? (
        <Card hover={false}><p className="text-gray-600">Loading requests…</p></Card>
      ) : error ? null : visible.length === 0 ? (
        <Card hover={false}><p className="text-gray-700">No requests match this view. Try All tasks or clear the search.</p></Card>
      ) : (
        <div className="space-y-3">{visible.map((request) => <RequestCard key={request.requestId} request={request} />)}</div>
      )}
    </section>
  );
}
