/** Request-first Staff Deliberations overview for the selected program/cycle. */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CalendarClock, CalendarX2, PenLine, TriangleAlert, Users } from 'lucide-react';
import { requestJson } from '../../utils/api-request';
import { Card } from '../Layout';
import ScopeSegment from './ScopeSegment';
import TestRequestBadge from '../TestRequestBadge';
import {
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../config/requestDocument';

function requestHref(request, tab = 'staff-deliberations', card = null) {
  const params = new URLSearchParams({ tab });
  if (request.requestNumber) params.set('n', request.requestNumber);
  return `/workbench/${request.requestId}?${params.toString()}${card ? `#${card}` : ''}`;
}

// The request page's Staff deliberations tab scrolls to the card whose action
// is this row's next step (anchors defined in StaffDeliberationsTab.js).
function cardFor(request, task, stage) {
  if (task.bucket === 'review') return null;
  if (task.label === 'Needs attention' || stage.tone === 'amber') return 'deliberations-status';
  if (request.preparation?.due || request.writeup?.correctionInProgress) return 'deliberations-writeup';
  return 'deliberations-briefing';
}

function dateTime(value, timeZone = null) {
  const ms = Date.parse(value || '');
  if (!Number.isFinite(ms)) return null;
  try {
    return new Intl.DateTimeFormat(undefined, {
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

const RELOAD_THEN_ADMIN = 'Reload the page; if this continues, contact an administrator.';

function writeupReady(request) {
  return request.writeup?.availability === 'available'
    && request.writeup.lifecycleState === REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW
    && request.writeup.milestoneComplete === true;
}

// One plain-language reason per attention condition, in a fixed order so a row
// with several problems names the most fundamental one. taskFor() uses the same
// function, so the "Needs attention" filter and the row text cannot disagree.
function attentionReason(request) {
  if (request.timing?.availability === 'ambiguous') return 'More than one presentation is scheduled for this request, so the time can’t be confirmed.';
  if (request.timing?.availability === 'unavailable') return `The system couldn’t confirm the presentation time. ${RELOAD_THEN_ADMIN}`;
  if (request.preparation?.state === 'blocked') return 'Automatic writeup preparation stopped before it finished. Your existing document is preserved; open the request to retry.';
  if (request.preparation?.state === 'unavailable') return `The system couldn’t load the writeup preparation status. ${RELOAD_THEN_ADMIN}`;
  for (const [key, name] of [['brief', 'briefing'], ['writeup', 'writeup']]) {
    const fact = request[key];
    if (fact?.operationStatus === REQUEST_DOCUMENT_OPERATION_STATUS.FAILED) return `The ${name} couldn’t be generated. Open the request to try again.`;
    if (fact?.availability === 'ambiguous') return `More than one ${name} is linked to this request. Contact an administrator.`;
    if (fact?.availability === 'unavailable') return `The system couldn’t load the ${name}. ${RELOAD_THEN_ADMIN}`;
  }
  if (request.finalReview?.availability === 'unavailable') return `The system couldn’t load the review status. ${RELOAD_THEN_ADMIN}`;
  if (request.writeup?.lifecycleState === REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL && request.finalPhase !== 'group-review') {
    return 'The writeup is marked final but hasn’t been through group review. Contact an administrator.';
  }
  if (request.preparation?.due && request.preparation.state === 'prepared' && !writeupReady(request)) {
    return `The writeup was prepared but isn’t ready to edit yet. ${RELOAD_THEN_ADMIN}`;
  }
  return null;
}

function taskFor(request) {
  if (request.finalPhase === 'leadership-review') return { label: 'Leadership review', bucket: 'review', tab: 'final-writeup' };
  if (request.finalPhase === 'group-review') return { label: 'Group review in progress', bucket: 'review', tab: 'final-writeup' };
  if (request.writeup?.correctionInProgress) return { label: 'Corrections in progress', bucket: 'attention', tab: 'staff-deliberations' };
  if (attentionReason(request)) return { label: 'Needs attention', bucket: 'attention', tab: 'staff-deliberations' };
  if (request.preparation?.due) {
    const ready = writeupReady(request);
    if (ready) return { label: 'Post-visit editing', bucket: 'post', tab: 'staff-deliberations' };
    if (request.preparation.state === 'disabled') {
      return { label: request.writeup?.availability === 'available' ? 'Working draft available' : 'No working writeup yet', bucket: 'post', tab: 'staff-deliberations' };
    }
    if (request.preparation.state === 'running' || request.writeup?.operationStatus === REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING) return { label: 'Preparing working writeup', bucket: 'post', tab: 'staff-deliberations' };
    if (request.preparation.state === 'due') return { label: 'Waiting for automatic preparation', bucket: 'post', tab: 'staff-deliberations' };
    if (request.preparation.state === 'pending') return { label: 'Queued for preparation', bucket: 'post', tab: 'staff-deliberations' };
    return { label: 'Working writeup needed', bucket: 'post', tab: 'staff-deliberations' };
  }
  const notScheduled = request.timing?.availability === 'missing' || !request.timing?.endIso;
  return { label: notScheduled ? 'Schedule needed' : 'Before presentation', bucket: notScheduled ? 'attention' : 'before', tab: 'staff-deliberations' };
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

// Where the request is in the process. A problem never replaces the stage; it
// is shown beneath it. An unconfirmed schedule is its own stage so an
// unverified time is never presented as the scheduled one.
// Chip tones follow DESIGN.md: gray for upcoming, blue for active writeup work,
// violet for review, amber for an issue. The icon and text carry the meaning.
const STAGE_TONES = {
  blue: 'bg-blue-50 text-blue-800 ring-blue-200',
  violet: 'bg-violet-50 text-violet-800 ring-violet-200',
  amber: 'bg-amber-50 text-amber-900 ring-amber-200',
  gray: 'bg-gray-100 text-gray-700 ring-gray-200',
};

function stageFor(request) {
  if (request.finalPhase === 'leadership-review') return { label: 'Leadership review', tone: 'violet', Icon: Users };
  if (request.finalPhase === 'group-review') return { label: 'Group review', tone: 'violet', Icon: Users };
  if (['unavailable', 'ambiguous'].includes(request.timing?.availability)) return { label: 'Presentation time not confirmed', tone: 'amber', Icon: CalendarClock };
  // Only a passed presentation end makes a request 'after'; corrections can
  // be reopened before it.
  if (request.preparation?.due) return { label: 'After presentation', tone: 'blue', Icon: PenLine };
  if (request.timing?.availability === 'missing' || !request.timing?.endIso) return { label: 'Not scheduled', tone: 'amber', Icon: CalendarX2 };
  return { label: 'Before presentation', tone: 'gray', Icon: CalendarClock };
}

function presentationWhen(request) {
  const time = dateTime(request.timing?.endIso, request.timing?.timeZone);
  if (!time) return null;
  if (['unavailable', 'ambiguous'].includes(request.timing?.availability)) return `recorded ${time}, unverified`;
  return request.timing?.availability === 'available' ? time : null;
}

function nextStep(request, task, document) {
  if (task.bucket === 'review') return 'Read the writeup and follow its review progress.';
  // Someone else's draft before group review: the lead PD drafts alone.
  if (request.writeup?.fileHidden === true) return 'The lead Program Director is drafting this writeup.';
  if (request.writeup?.correctionInProgress) return 'Make the requested corrections in the writeup, then choose Finish corrections.';
  if (task.label === 'Schedule needed') return 'Add the presentation schedule on the request page.';
  if (request.preparation?.state === 'running' || request.writeup?.operationStatus === REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING) {
    return 'Your writeup is being prepared. Check back shortly.';
  }
  if (request.preparation?.due && ['due', 'pending'].includes(request.preparation?.state)) {
    return 'Preparation will run automatically. No action is needed now.';
  }
  if (task.label === 'Post-visit editing') return 'Add your presentation findings to the writeup, then open group review.';
  if (task.bucket === 'post') return document
    ? 'Prepare the writeup for post-visit editing.'
    : 'Prepare your working writeup.';
  if (request.brief?.operationStatus === REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING) return 'The briefing is being prepared. Check back shortly.';
  if (document?.key === 'brief') return 'Check the briefing in Word, then share it for the presentation.';
  return 'Generate the pre-site briefing.';
}

function RequestRow({ request }) {
  const task = taskFor(request);
  const document = primaryDocument(request);
  const problem = task.label === 'Needs attention' ? attentionReason(request) : null;
  const stage = stageFor(request);
  const when = presentationWhen(request);
  const people = [
    request.institution,
    request.projectLeader && `PI: ${request.projectLeader}`,
    request.programDirector && `PD: ${request.programDirector}`,
  ].filter(Boolean).join(' · ');
  return (
    <li className="rounded-xl border border-gray-200 bg-white px-4 py-3.5 shadow-sm sm:px-5 sm:py-4">
      <div className="flex flex-col gap-3 sm:gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="font-semibold tabular-nums text-gray-900">
              {request.requestNumber ? `#${request.requestNumber}` : request.requestId}
            </span>
            <TestRequestBadge isTestRequest={request.isTestRequest} />
            <h3 className="min-w-0 text-base font-semibold text-gray-900 sm:text-lg">{request.title || 'Untitled request'}</h3>
          </div>
          {people && <p className="mt-1 text-sm text-gray-600">{people}</p>}
          <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${STAGE_TONES[stage.tone]}`}>
              <stage.Icon aria-hidden="true" className="h-3.5 w-3.5" />
              {stage.label}
            </span>
            {when && <span className="text-xs tabular-nums text-gray-500">{when}</span>}
          </div>
          {problem ? (
            <p className="mt-1.5 flex gap-1.5 text-sm text-amber-800">
              <TriangleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{problem}</span>
            </p>
          ) : (
            <p className="mt-1.5 text-sm text-gray-700">{nextStep(request, task, document)}</p>
          )}
        </div>
        <div className="flex shrink-0 lg:justify-end">
          <Link
            href={requestHref(request, task.tab, cardFor(request, task, stage))}
            className="inline-flex min-h-11 items-center rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2"
          >
            {task.bucket === 'review' ? 'Open review' : 'Open request'}
          </Link>
        </div>
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
    && [request.requestNumber, request.title, request.institution, request.projectLeader, request.programDirector].filter(Boolean).join(' ').toLowerCase().includes(search.toLowerCase().trim()));
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
            <input value={search} onChange={(event) => setSearch(event.target.value)} type="search" placeholder="Request, title, institution, PI or PD" className="h-11 w-72 rounded-lg border border-gray-300 px-3 text-sm font-normal text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2" />
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
        <ul className="space-y-3">
          {visible.map((request) => <RequestRow key={request.requestId} request={request} />)}
        </ul>
      )}
    </section>
  );
}
