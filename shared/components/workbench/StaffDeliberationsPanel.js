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

function nextStep(request, task, document) {
  if (task.bucket === 'review') return { instruction: 'Read the writeup and follow its review progress.', detailsFirst: true };
  if (request.writeup?.correctionInProgress) return { instruction: 'Check the requested corrections and update the writeup.', detailsFirst: true };
  if (task.label === 'Schedule needed') return { instruction: 'Add the presentation schedule in request details.', detailsFirst: true };
  if (task.bucket === 'attention') return { instruction: 'Open request details to check what needs attention.', detailsFirst: true };
  if (request.preparation?.state === 'running' || request.writeup?.operationStatus === REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING) {
    return { instruction: 'Your writeup is being prepared. Check back shortly.', detailsFirst: true };
  }
  if (request.preparation?.due && ['due', 'pending'].includes(request.preparation?.state)) {
    return { instruction: 'Preparation will run automatically. No action is needed now.', detailsFirst: true };
  }
  if (task.bucket === 'post') return document
    ? { instruction: 'Add findings to your writeup after the presentation.', stage: 'After scheduled presentation' }
    : { instruction: 'Open request details to prepare your writeup.', stage: 'Writeup needed', detailsFirst: true };
  if (request.brief?.operationStatus === REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING) {
    return { instruction: 'The briefing is being prepared. Check back shortly.', stage: 'Preparing briefing', detailsFirst: true };
  }
  if (document?.key === 'brief') return { instruction: 'Check the briefing before sharing it for the presentation.' };
  return { instruction: 'Open request details to prepare the pre-site briefing.', detailsFirst: true };
}

function RequestCard({ request }) {
  const task = taskFor(request);
  const document = primaryDocument(request);
  const step = nextStep(request, task, document);
  const documentAction = document?.key === 'writeup' ? 'Edit writeup in Word' : 'Edit briefing in Word';
  const primaryClass = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2';
  const secondaryClass = 'inline-flex min-h-11 items-center text-sm font-medium text-gray-600 underline underline-offset-4 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2';
  const stageClass = task.bucket === 'attention' ? 'bg-amber-50 text-amber-900' : task.bucket === 'review' ? 'bg-violet-50 text-violet-900' : 'bg-blue-50 text-blue-800';
  return (
    <Card hover={false}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-72">
          <h3 className="break-words text-base font-semibold text-gray-900">
            <Link href={requestHref(request)} className="underline-offset-2 hover:underline">
              {request.requestNumber ? `#${request.requestNumber}` : request.requestId}{request.title ? ` — ${request.title}` : ''}
            </Link>
          </h3>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
            {request.institution && <p>{request.institution}</p>}
            {request.programDirector && <p>Lead PD: {request.programDirector}</p>}
          </div>
          <TestRequestBadge isTestRequest={request.isTestRequest} className="mt-2" />
        </div>
        <p className={`rounded-full px-3 py-1 text-xs font-semibold ${stageClass}`}>{step.stage || task.label}</p>
      </div>
      <div className="mt-5 flex flex-col gap-4 border-t border-gray-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="max-w-2xl text-lg font-semibold leading-7 text-gray-900">{step.instruction}</p>
          <p className="mt-1 text-sm text-gray-600">{presentationTiming(request)}</p>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
          {document && !step.detailsFirst ? (
            <a href={document.fact.file.webUrl} target="_blank" rel="noopener noreferrer" className={primaryClass}>{documentAction}</a>
          ) : (
            <Link href={requestHref(request, task.tab)} className={primaryClass}>{task.action}</Link>
          )}
          {document && (step.detailsFirst ? (
            <a href={document.fact.file.webUrl} target="_blank" rel="noopener noreferrer" className={secondaryClass}>{documentAction}</a>
          ) : (
            <Link href={requestHref(request, task.tab)} className={secondaryClass}>{task.action}</Link>
          ))}
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
      <p className="mb-3 max-w-3xl text-sm text-gray-600">Each request shows your next step. Use the briefing before the presentation; add findings to the writeup afterward.</p>
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
