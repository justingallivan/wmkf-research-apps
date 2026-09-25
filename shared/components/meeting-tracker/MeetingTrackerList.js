import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { requestJson, requestEnvelope } from '../../utils/api-request';
import Layout, { PageHeader } from '../Layout';
import ToolbarSelect from '../ToolbarSelect';
import ScopeSegment from '../workbench/ScopeSegment';
import MaterialsStatusPill from './MaterialsStatusPill';
import { classifySiteVisitMaterialsStatus, MATERIALS_STATUS_FILTERS } from '../../utils/site-visit-materials-status';
import TestRequestBadge from '../TestRequestBadge';

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
});

function formatDate(value) {
  const date = new Date(value || '');
  return Number.isFinite(date.getTime()) ? DATE_FORMAT.format(date) : 'Date not set';
}

function trackerHref(path, { cycleCode, programId, requestId } = {}) {
  const query = new URLSearchParams();
  if (cycleCode) query.set('cycleCode', cycleCode);
  if (programId) query.set('programId', programId);
  if (requestId) query.set('requestId', requestId);
  return `${path}${query.size ? `?${query}` : ''}`;
}

export function MeetingTrackerRequestRow({ proposal, cycleCode, programId }) {
  // Slice 2b: the site visit is edited from the tracker too (plan §5.1).
  const visitHref = (() => {
    const query = new URLSearchParams();
    if (cycleCode) query.set('cycleCode', cycleCode);
    if (programId) query.set('programId', programId);
    if (proposal.requestNumber) query.set('n', proposal.requestNumber);
    return `/meeting-tracker/visits/${proposal.requestId}${query.size ? `?${query}` : ''}`;
  })();
  const sessionHref = trackerHref(
    proposal.deliberation
      ? `/meeting-tracker/sessions/${proposal.deliberation.sessionId}`
      : '/meeting-tracker/sessions/new',
    { cycleCode, programId, requestId: proposal.requestId },
  );
  return (
    <article className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-colors hover:border-gray-300">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 w-full sm:w-auto sm:flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-gray-900">#{proposal.requestNumber}</h2>
            <TestRequestBadge isTestRequest={proposal.isTestRequest} />
            {proposal.needsScheduling && (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">Needs scheduling</span>
            )}
          </div>
          <p className="mt-1 text-base text-gray-800">{proposal.title || 'Untitled request'}</p>
          <p className="mt-1 text-sm text-gray-500">
            {proposal.programDirector || 'Program Director not assigned'}
            {proposal.projectLeader ? ` · ${proposal.projectLeader}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={sessionHref} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2">
            {proposal.deliberation ? 'Open session' : 'Schedule session'}
          </Link>
          <Link href={visitHref} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2">
            {proposal.siteVisit ? 'Edit visit' : 'Schedule visit'}
          </Link>
        </div>
      </div>

      <div className="mt-5 grid gap-4 border-t border-gray-100 pt-4 md:grid-cols-4">
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Share state</h3>
          <p className="mt-1 text-sm font-medium text-gray-900">{proposal.shareState?.lifecycleLabel || 'No Pre-Site artifact'}</p>
        </section>
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Deliberation</h3>
          {proposal.deliberation ? (
            <div className="mt-1 text-sm text-gray-700">
              <p>{formatDate(proposal.deliberation.scheduledStartIso)} · #{proposal.deliberation.order} · {proposal.deliberation.minutes} min</p>
              {proposal.deliberation.meetingLink ? (
                <a href={proposal.deliberation.meetingLink} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex font-semibold text-blue-700 underline decoration-blue-300 underline-offset-4 hover:text-blue-900">Join</a>
              ) : <p className="mt-1 font-medium text-amber-700">No link</p>}
            </div>
          ) : <p className="mt-1 text-sm font-medium text-amber-700">No session</p>}
        </section>
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Site visit</h3>
          {proposal.siteVisit ? (
            <div className="mt-1 text-sm text-gray-700">
              <p>{formatDate(proposal.siteVisit.scheduledStartIso)}</p>
              <p className="mt-1 text-gray-500">{[proposal.siteVisit.formatLabel, proposal.siteVisit.location].filter(Boolean).join(' · ') || 'Details not set'}</p>
              {proposal.siteVisitNeedsReconciliation && <p className="mt-1 font-medium text-amber-800">More than one active Site Visit; showing the earliest. Reconcile in the Workbench.</p>}
            </div>
          ) : <p className="mt-1 text-sm font-medium text-amber-700">No site visit</p>}
        </section>
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Materials</h3>
          <MaterialsStatusPill summary={proposal.materials} availability={proposal.materialsAvailability} hasSiteVisit={Boolean(proposal.siteVisit)} requestMaterialsHref={visitHref} />
        </section>
      </div>
    </article>
  );
}

export default function MeetingTrackerList() {
  const router = useRouter();
  const [programId, setProgramId] = useState('');
  const [cycleCode, setCycleCode] = useState('');
  const [scope, setScope] = useState('my');
  const [programs, setPrograms] = useState([]);
  const [cycles, setCycles] = useState([]);
  const [proposals, setProposals] = useState([]);
  const [notices, setNotices] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [materialsFilter, setMaterialsFilter] = useState('all');
  const loadToken = useRef(0);
  // The cycle picker's options come only from the dashboard's no-cycle
  // response. Arriving with a cycle already in the URL (the session page's
  // "Back to the cycle schedule" link does this) must still load them, or the
  // Grant cycle select renders disabled (owner, 2026-09-10).
  const cyclesRef = useRef([]);

  const load = useCallback(async (selectedProgramId, selectedCycleCode, selectedScope) => {
    const token = ++loadToken.current;
    let navigatingToCycle = false;
    setLoading(true);
    setError(null);
    setProposals([]);
    setNotices([]);
    try {
      const query = new URLSearchParams();
      if (selectedProgramId) query.set('programId', selectedProgramId);
      if (selectedCycleCode) query.set('cycleCode', selectedCycleCode);
      if (selectedScope === 'all') query.set('scope', 'all');
      const needsPicker = Boolean(selectedCycleCode) && cyclesRef.current.length === 0;
      const pickerQuery = new URLSearchParams();
      if (selectedProgramId) pickerQuery.set('programId', selectedProgramId);
      const [dashboardEnvelope, sessionsEnvelope, pickerEnvelope] = await Promise.all([
        requestEnvelope(`/api/meeting-tracker/dashboard${query.size ? `?${query}` : ''}`, { tolerantBody: true }),
        requestEnvelope('/api/meeting-tracker/sessions', { tolerantBody: true }),
        needsPicker ? requestEnvelope(`/api/meeting-tracker/dashboard${pickerQuery.size ? `?${pickerQuery}` : ''}`, { tolerantBody: true }) : Promise.resolve(null),
      ]);
      const dashboard = dashboardEnvelope.data;
      const sessionBody = sessionsEnvelope.data;
      const picker = pickerEnvelope?.ok ? pickerEnvelope.data : null;
      if (token !== loadToken.current) return;
      if (!dashboardEnvelope.ok) throw new Error(dashboard.error || 'The meeting schedule could not be loaded. Please try again.');
      if (!sessionsEnvelope.ok) throw new Error(sessionBody.error || 'The meeting sessions could not be loaded. Please try again.');
      setPrograms((current) => dashboard.programs || picker?.programs || current);
      const nextCycles = dashboard.cycles || picker?.cycles || cyclesRef.current;
      cyclesRef.current = nextCycles;
      setCycles(nextCycles);
      setSessions(sessionBody.sessions || []);
      if (!selectedProgramId && dashboard.programId) setProgramId(dashboard.programId);
      if (!selectedCycleCode) {
        const nextCycle = dashboard.defaultCycleCode || dashboard.cycles?.[0]?.code || '';
        setCycleCode(nextCycle);
        if (nextCycle) {
          navigatingToCycle = true;
          const navigated = await router.replace({
            pathname: '/meeting-tracker',
            query: {
              programId: selectedProgramId || dashboard.programId || '',
              cycleCode: nextCycle,
              ...(selectedScope === 'all' ? { scope: 'all' } : {}),
            },
          }, undefined, { shallow: true });
          if (navigated === false) throw new Error('The cycle view could not be opened. Please try again.');
        }
      } else {
        setProposals(dashboard.proposals || []);
        setNotices(dashboard.notices || []);
      }
    } catch (loadError) {
      navigatingToCycle = false;
      if (token === loadToken.current) setError(loadError.message);
    } finally {
      if (token === loadToken.current && !navigatingToCycle) setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (!router.isReady) return undefined;
    const nextProgram = Array.isArray(router.query.programId) ? '' : router.query.programId || '';
    const nextCycle = Array.isArray(router.query.cycleCode) ? '' : router.query.cycleCode || '';
    const nextScope = router.query.scope === 'all' ? 'all' : 'my';
    const timer = window.setTimeout(() => {
      setProgramId(nextProgram);
      setCycleCode(nextCycle);
      setScope(nextScope);
      setMaterialsFilter('all');
      void load(nextProgram, nextCycle, nextScope);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      loadToken.current += 1;
    };
  }, [load, router.isReady, router.query.cycleCode, router.query.programId, router.query.scope]);

  const changeFilters = async (next) => {
    const nextProgram = next.programId ?? programId;
    const nextCycle = next.cycleCode ?? cycleCode;
    const nextScope = next.scope ?? scope;
    if (nextProgram === programId && nextCycle === cycleCode && nextScope === scope) return;
    const token = ++loadToken.current;
    setLoading(true);
    setProposals([]);
    setNotices([]);
    setError(null);
    setProgramId(nextProgram);
    setCycleCode(nextCycle);
    setScope(nextScope);
    setMaterialsFilter('all');
    try {
      const navigated = await router.replace({ pathname: '/meeting-tracker', query: { programId: nextProgram, cycleCode: nextCycle, ...(nextScope === 'all' ? { scope: 'all' } : {}) } }, undefined, { shallow: true });
      if (navigated === false) throw new Error('The view could not be changed. Please try again.');
    } catch {
      if (token !== loadToken.current) return;
      setError('The view could not be changed. Please try again.');
      setLoading(false);
    }
  };

  const classified = proposals.map((proposal) => ({
    proposal,
    status: classifySiteVisitMaterialsStatus(proposal.materials, {
      availability: proposal.materialsAvailability,
      hasSiteVisit: Boolean(proposal.siteVisit),
    }),
  }));
  const counts = classified.reduce((result, item) => {
    result[item.status.key] = (result[item.status.key] || 0) + 1;
    return result;
  }, {});
  const visibleProposals = materialsFilter === 'all'
    ? proposals
    : classified.filter((item) => item.status.key === materialsFilter).map((item) => item.proposal);
  const optionalFilters = ['closed', 'no_visit', 'unavailable'].filter((key) => counts[key]);
  const filterOptions = [
    ...MATERIALS_STATUS_FILTERS,
    ...optionalFilters.map((key) => ({ key, label: key === 'no_visit' ? 'No visit' : key === 'unavailable' ? 'Status unavailable' : 'Closed' })),
  ];

  return (
    <Layout title="Meeting Tracker">
      <PageHeader title="Meeting Tracker" subtitle="Keep deliberation sessions and site visits visible in one cycle schedule." />
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <ToolbarSelect id="meeting-program" label="Grant program" value={programId} disabled={!programs.length} onChange={(event) => changeFilters({ programId: event.target.value, cycleCode: '' })}>
            {!programs.length && <option value="">Loading programs…</option>}
            {programs.map((program) => <option key={program.programId} value={program.programId}>{program.name}</option>)}
          </ToolbarSelect>
          <ToolbarSelect id="meeting-cycle" label="Grant cycle" value={cycleCode} disabled={!cycles.length} onChange={(event) => changeFilters({ cycleCode: event.target.value })}>
            {cycles.map((cycle) => <option key={cycle.code} value={cycle.code}>{cycle.label || cycle.code}</option>)}
          </ToolbarSelect>
          <ScopeSegment scope={scope} onChange={(value) => changeFilters({ scope: value })} allLabel="All program directors" />
        </div>
        <Link href={trackerHref('/meeting-tracker/sessions/new', { cycleCode, programId })} className="inline-flex h-12 items-center rounded-lg bg-gray-900 px-5 text-sm font-semibold text-white hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2">
          Create session
        </Link>
      </div>

      {sessions.length > 0 && (
        <nav aria-label="Deliberation sessions" className="mb-6 flex gap-2 overflow-x-auto pb-1">
          {sessions.map((session) => (
            <Link key={session.sessionId} href={trackerHref(`/meeting-tracker/sessions/${session.sessionId}`, { cycleCode, programId })} className="shrink-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:border-gray-400 hover:text-gray-900">
              {formatDate(session.scheduledStartIso)}
            </Link>
          ))}
        </nav>
      )}

      {error && (
        <div role="alert" className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error} <button type="button" onClick={() => load(programId, cycleCode, scope)} className="font-semibold underline underline-offset-4">Try again</button>. If the problem continues, contact an administrator.
        </div>
      )}
      {!loading && notices.length > 0 && (
        <ul role="status" className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {notices.map((item) => <li key={item.code + (item.requestIds || []).join(',')}>{item.message}</li>)}
        </ul>
      )}
      {!loading && !error && proposals.length > 0 && (
        <nav aria-label="Materials status filters" className="mb-6 flex flex-wrap gap-2">
          <button type="button" aria-pressed={materialsFilter === 'all'} onClick={() => setMaterialsFilter('all')} className={`rounded-lg border px-3 py-2 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2 ${materialsFilter === 'all' ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>All ({proposals.length})</button>
          {filterOptions.map((option) => (
            <button key={option.key} type="button" aria-pressed={materialsFilter === option.key} onClick={() => setMaterialsFilter(option.key)} className={`rounded-lg border px-3 py-2 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2 ${materialsFilter === option.key ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>
              {option.label} ({counts[option.key] || 0})
            </button>
          ))}
        </nav>
      )}
      {loading ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500">Loading the cycle schedule…</div>
      ) : visibleProposals.length ? (
        <div className="space-y-3">{visibleProposals.map((proposal) => <MeetingTrackerRequestRow key={proposal.requestId} proposal={proposal} cycleCode={cycleCode} programId={programId} />)}</div>
      ) : proposals.length ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center"><h2 className="text-lg font-semibold text-gray-900">No requests match this materials status</h2><button type="button" onClick={() => setMaterialsFilter('all')} className="mt-2 font-semibold text-blue-700 underline">Show all requests</button></div>
      ) : !error && (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
          <h2 className="text-lg font-semibold text-gray-900">No advancing requests are in this view</h2>
          <p className="mt-2 text-sm text-gray-600">Choose another cycle, program, or scope.</p>
        </div>
      )}
    </Layout>
  );
}
