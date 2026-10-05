/** Request-first Staff Deliberations overview for the selected program/cycle. */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { requestJson } from '../../utils/api-request';
import { Card } from '../Layout';
import ScopeSegment from './ScopeSegment';
import TestRequestBadge from '../TestRequestBadge';
import { siteVisitMaterialsLine } from '../../utils/site-visit-materials-line';
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
      dateStyle: 'medium',
      timeStyle: 'short',
      ...(timeZone ? { timeZone } : {}),
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleString();
  }
}

function DocumentLine({ label, fact, href, wordDestination }) {
  const available = fact?.availability === 'available' && fact?.file?.webUrl;
  const state = fact?.operationStatus === REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING ? 'Preparing'
    : fact?.operationStatus === REQUEST_DOCUMENT_OPERATION_STATUS.FAILED ? 'Needs attention'
      : fact?.lifecycleState === REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW ? 'Ready for staff editing'
        : fact?.lifecycleState === REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT ? 'Draft available'
          : null;
  return (
    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="font-medium text-gray-900">{label}</p>
        <p className="text-sm text-gray-600">
          {state === 'Preparing' || state === 'Needs attention' ? state
            : available ? (state || 'Document available') : fact?.availability === 'unavailable'
            ? 'Status could not be read.'
            : fact?.availability === 'ambiguous' ? 'Multiple current documents need reconciliation.'
              : 'No document yet.'}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        {available && (
          <a href={fact.file.webUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-gray-800 underline underline-offset-2">
            Open {wordDestination} in Word
          </a>
        )}
        <Link href={href} className="text-sm font-medium text-blue-700 underline underline-offset-2">
          {available ? 'Edit or review' : 'Open workbench'}
        </Link>
      </div>
    </div>
  );
}

function RequestCard({ request }) {
  const end = dateTime(request.timing?.endIso, request.timing?.timeZone);
  const start = dateTime(request.timing?.startIso, request.timing?.timeZone);
  const due = request.preparation?.due === true;
  const hasReviewReady = due
    && request.writeup?.availability === 'available'
    && request.writeup?.lifecycleState === REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW
    && request.writeup?.operationStatus === REQUEST_DOCUMENT_OPERATION_STATUS.READY;
  const timingText = request.timing?.availability === 'ambiguous'
    ? 'Schedule needs reconciliation; automatic preparation is paused.'
    : request.timing?.availability === 'unavailable'
      ? 'Schedule status is unavailable; automatic preparation is paused.'
    : request.timing?.availability === 'missing'
        ? 'Research presentation not scheduled.'
        : request.timing?.availability === 'unavailable'
          ? 'Presentation timing needs attention; automatic preparation is paused.'
        : due
          ? `Post-presentation editing · ended ${end}`
          : `Before presentation · ${start || 'start time unavailable'}${end ? `–${end}` : ''}${request.timing?.timeZone ? ` (${request.timing.timeZone})` : ''}`;

  return (
    <Card hover={false}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="break-words text-base font-semibold text-gray-900">
              <Link href={requestHref(request)} className="underline-offset-2 hover:underline">
                {request.requestNumber ? `#${request.requestNumber}` : request.requestId}
                {request.title ? ` — ${request.title}` : ''}
              </Link>
            </h3>
            {request.institution && <p className="mt-1 text-sm text-gray-600">{request.institution}</p>}
            {request.programDirector && <p className="mt-1 text-xs text-gray-600">Lead PD: {request.programDirector}</p>}
            <TestRequestBadge isTestRequest={request.isTestRequest} className="mt-2" />
          </div>
          <p className={`text-sm ${request.timing?.availability === 'ambiguous' || request.timing?.availability === 'unavailable' ? 'text-amber-800' : 'text-gray-600'}`}>
            {timingText}
          </p>
        </div>

        <div className="mt-4 space-y-4 divide-y divide-gray-200">
          <div className="pt-4 first:pt-0">
            <DocumentLine label="Pre-site briefing" fact={request.brief} href={requestHref(request)} wordDestination="briefing" />
          </div>
          <div className="pt-4">
            <DocumentLine label="Working writeup" fact={request.writeup} href={requestHref(request)} wordDestination="working writeup" />
            {!due && request.writeup?.availability === 'missing' && request.timing?.availability === 'available' && (
              <p className="mt-2 text-sm text-gray-600">Optional before the presentation · draft not started.</p>
            )}
            {due && request.writeup?.availability === 'missing' && (
              <p className="mt-2 text-sm text-gray-600" role="status">
                {request.preparation?.state === 'running' || request.preparation?.state === 'pending'
                  ? 'Preparing a working writeup from the approved foundation inputs.'
                  : 'Preparation is due. The scheduled worker will create a foundation only if no current draft exists.'}
              </p>
            )}
            {hasReviewReady && (
              <Link href={requestHref(request, 'final-writeup')} className="mt-2 inline-block text-sm font-semibold text-gray-900 underline underline-offset-2">
                Review readiness for group review →
              </Link>
            )}
          </div>
          <div className="pt-4">
            <p className="font-medium text-gray-900">Deliberation session</p>
            <p className="text-sm text-gray-600">
              {request.sessionAvailability === 'unavailable'
                ? 'Session details are unavailable.'
                : request.session?.scheduledStartIso
                  ? dateTime(request.session.scheduledStartIso, request.session.ianaTimeZone) || 'Session time unavailable.'
                  : 'Not yet scheduled.'}
            </p>
          </div>
          <div className="pt-4">
            <p className="font-medium text-gray-900">Research presentation materials</p>
            <p className="text-sm text-gray-600">
              {request.materialsAvailability === 'unavailable'
                ? 'Materials status is unavailable.'
                : siteVisitMaterialsLine(request.materials) || 'No materials recorded.'}
            </p>
          </div>
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
  const [requestCounts, setRequestCounts] = useState({ ordinary: 0, test: 0, total: 0 });
  const [loading, setLoading] = useState(false);
  const [serverNowIso, setServerNowIso] = useState(null);
  const [clockRefresh, setClockRefresh] = useState(0);
  const [error, setError] = useState(null);
  const requestSequence = useRef(0);

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
    setRequests([]);
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
    if (!nextEnd) return undefined;
    const timer = setTimeout(() => setClockRefresh((value) => value + 1), Math.max(1000, nextEnd - serverNow + 1000));
    return () => clearTimeout(timer);
  }, [requests, serverNowIso]);

  if (!cycleCode && !loadingCycles) return null;

  return (
    <section aria-labelledby="staff-deliberations-heading">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="staff-deliberations-heading" className="text-lg font-semibold text-gray-900">Staff Deliberations</h2>
          {!loading && !loadingCycles && <p className="mt-1 text-sm text-gray-600">
            {requestCounts.ordinary} requests in this program and cycle
            {requestCounts.test > 0 ? ` · ${requestCounts.test} test requests also shown` : ''}
          </p>}
        </div>
        <ScopeSegment scope={scope} onChange={onScopeChange} allLabel="All program directors" />
      </div>
      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">{error}</div>}
      {loadingCycles || (loading && requests.length === 0) ? (
        <Card hover={false}><p className="text-gray-600">Loading requests…</p></Card>
      ) : requests.length === 0 ? (
        <Card hover={false}><p className="text-gray-700">No requests in this program and cycle for this view.</p></Card>
      ) : (
        <div className="space-y-3">{requests.map((request) => <RequestCard key={request.requestId} request={request} />)}</div>
      )}
    </section>
  );
}
