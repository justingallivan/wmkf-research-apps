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

function RequestRow({ request }) {
  const task = taskFor(request);
  const document = primaryDocument(request);
  const step = nextStep(request, task, document);
  const documentAction = document?.key === 'writeup' ? 'Edit writeup in Word' : 'Edit briefing in Word';
  const primaryClass = 'inline-flex h-9 items-center justify-center whitespace-nowrap rounded-lg border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-900 shadow-sm hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2';
  const secondaryClass = 'whitespace-nowrap text-sm font-medium text-gray-600 underline underline-offset-4 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2 rounded';
  const stageClass = task.bucket === 'attention' ? 'bg-amber-50 text-amber-900' : task.bucket === 'review' ? 'bg-violet-50 text-violet-900' : 'bg-blue-50 text-blue-800';
  const meta = [
    request.institution,
    request.programDirector && `Lead PD: ${request.programDirector}`,
  ].filter(Boolean);
  return (
    <li className="grid grid-cols-1 gap-x-6 gap-y-2 px-4 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,24rem)_auto] md:items-center">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="min-w-0 truncate text-sm font-semibold text-gray-900" title={request.title || undefined}>
            <Link href={requestHref(request)} className="underline-offset-2 hover:underline">
              {request.requestNumber ? `#${request.requestNumber}` : request.requestId}{request.title ? ` — ${request.title}` : ''}
            </Link>
          </h3>
          <TestRequestBadge isTestRequest={request.isTestRequest} />
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500">
          {meta.map((item) => <span key={item}>{item}</span>)}
          <span>{presentationTiming(request)}</span>
        </div>
      </div>
      <div className="min-w-0">
        <p className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${stageClass}`}>{step.stage || task.label}</p>
        <p className="mt-1 text-sm text-gray-700">{step.instruction}</p>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 md:justify-end">
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
    </li>
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
      <h2 id="staff-deliberations-heading" className="sr-only">Staff Deliberations</h2>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700">Task
            <select value={filter} onChange={(event) => setFilter(event.target.value)} className="h-11 rounded-lg border border-gray-300 bg-white px-3 text-sm font-normal text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2">
              <option value="all">All tasks</option><option value="before">Before presentation</option><option value="post">Post-visit work</option><option value="review">In review</option><option value="attention">Needs attention</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700">Search
            <input value={search} onChange={(event) => setSearch(event.target.value)} type="search" placeholder="Request, title, institution or PD" className="h-11 w-72 rounded-lg border border-gray-300 px-3 text-sm font-normal text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2" />
          </label>
        </div>
        <ScopeSegment scope={scope} onChange={onScopeChange} allLabel="All program directors" />
      </div>
      {!loading && !loadingCycles && <p className="mb-3 text-sm text-gray-600">
        {requestCounts.ordinary} requests in this program and cycle
        {requestCounts.test > 0 ? ` · ${requestCounts.test} test requests also shown` : ''}
      </p>}
      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">{error}</div>}
      {loadingCycles || (loading && requests.length === 0) ? (
        <Card hover={false}><p className="text-gray-600">Loading requests…</p></Card>
      ) : error ? null : visible.length === 0 ? (
        <Card hover={false}><p className="text-gray-700">No requests match this view. Try All tasks or clear the search.</p></Card>
      ) : (
        <ul className="divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          {visible.map((request) => <RequestRow key={request.requestId} request={request} />)}
        </ul>
      )}
    </section>
  );
}
