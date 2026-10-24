import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { requestEnvelope } from '../../utils/api-request';
import Layout from '../Layout';
import ToolbarSelect from '../ToolbarSelect';
import MaterialsStatusPill from './MaterialsStatusPill';
import { classifySiteVisitMaterialsStatus, MATERIALS_STATUS_FILTERS } from '../../utils/site-visit-materials-status';
import TestRequestBadge from '../TestRequestBadge';
import MeetingSessionsView from './MeetingSessionsView';

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
  const actionClass = 'mt-1 inline text-sm font-semibold text-blue-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600';
  return (
    <article className="grid grid-cols-2 gap-4 border-b border-gray-200 bg-white px-4 py-3 last:border-b-0 lg:grid-cols-[minmax(0,1fr)_11.5rem_11.5rem_8.5rem] lg:items-center lg:gap-5">
      <div className="col-span-2 min-w-0 lg:col-span-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h2 className="text-sm font-medium text-gray-600">#{proposal.requestNumber}</h2>
          {proposal.institution && <span className="text-sm font-semibold text-gray-900">{proposal.institution}</span>}
          <TestRequestBadge isTestRequest={proposal.isTestRequest} />
        </div>
        <p className="mt-1 text-sm text-gray-700">{proposal.title || 'Untitled request'}</p>
        <p className="mt-1 text-xs text-gray-600">{`PD: ${proposal.programDirector || 'Not assigned'}`}{proposal.projectLeader ? ` · PI: ${proposal.projectLeader}` : ''}</p>
      </div>
      <div>
        <h3 className="text-xs font-medium text-gray-500 lg:sr-only">Proposal discussion session</h3>
        <p className="mt-1 text-sm text-gray-700 lg:mt-0">{proposal.deliberation ? formatDate(proposal.deliberation.scheduledStartIso) : 'Not scheduled'}</p>
        <Link href={sessionHref} className={actionClass}>{proposal.deliberation ? 'Open session' : 'Schedule session'}<span aria-hidden="true" className="ml-1">→</span></Link>
      </div>
      <div>
        <h3 className="text-xs font-medium text-gray-500 lg:sr-only">Research presentation</h3>
        <p className="mt-1 text-sm text-gray-700 lg:mt-0">{proposal.siteVisit ? formatDate(proposal.siteVisit.scheduledStartIso) : 'Not scheduled'}</p>
        <a href={visitHref} data-full-page-navigation="true" className={actionClass}>{proposal.siteVisit ? 'Open research presentation' : 'Schedule research presentation'}<span aria-hidden="true" className="ml-1">→</span></a>
        {proposal.siteVisitNeedsReconciliation && <p className="mt-1 text-xs text-amber-800">Multiple active visits; showing the earliest. Reconcile in the Workbench.</p>}
      </div>
      <div className="col-span-2 lg:col-span-1"><span className="mr-2 text-xs font-medium text-gray-500 lg:sr-only">Materials: </span><MaterialsStatusPill compact summary={proposal.materials} availability={proposal.materialsAvailability} hasSiteVisit={Boolean(proposal.siteVisit)} requestMaterialsHref={`${visitHref}#materials`} /></div>
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
  const [sessionsError, setSessionsError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const view = router.query.view === 'sessions' ? 'sessions' : 'cycle';
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
      query.set('projection', 'schedule');
      if (selectedProgramId) query.set('programId', selectedProgramId);
      if (selectedCycleCode) query.set('cycleCode', selectedCycleCode);
      if (selectedScope === 'all') query.set('scope', 'all');
      const needsPicker = Boolean(selectedCycleCode) && cyclesRef.current.length === 0;
      const pickerQuery = new URLSearchParams({ projection: 'schedule' });
      if (selectedProgramId) pickerQuery.set('programId', selectedProgramId);
      const [dashboardEnvelope, sessionsEnvelope, pickerEnvelope] = await Promise.all([
        requestEnvelope(`/api/meeting-tracker/dashboard${query.size ? `?${query}` : ''}`, { tolerantBody: true }),
        requestEnvelope('/api/meeting-tracker/sessions', { tolerantBody: true }).catch(() => ({ ok: false, data: {} })),
        needsPicker ? requestEnvelope(`/api/meeting-tracker/dashboard${pickerQuery.size ? `?${pickerQuery}` : ''}`, { tolerantBody: true }) : Promise.resolve(null),
      ]);
      const dashboard = dashboardEnvelope.data;
      const sessionBody = sessionsEnvelope.data;
      const picker = pickerEnvelope?.ok ? pickerEnvelope.data : null;
      if (token !== loadToken.current) return;
      setSessions(sessionBody.sessions || []);
      setSessionsError(sessionsEnvelope.ok ? null : 'The meeting sessions could not be loaded.');
      if (!dashboardEnvelope.ok) throw new Error(dashboard.error || 'The meeting schedule could not be loaded. Please try again.');
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
              ...(router.query.view === 'sessions' ? { view: 'sessions' } : {}),
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
  const statusProposals = materialsFilter === 'all'
    ? proposals
    : classified.filter((item) => item.status.key === materialsFilter).map((item) => item.proposal);
  const normalizedSearch = search.trim().toLowerCase();
  const visibleProposals = statusProposals.filter((proposal) => !normalizedSearch || [proposal.requestNumber, proposal.institution, proposal.title].some((value) => String(value || '').toLowerCase().includes(normalizedSearch)));
  const optionalFilters = ['closed', 'no_visit', 'unavailable'].filter((key) => counts[key]);
  const filterOptions = [
    ...MATERIALS_STATUS_FILTERS,
    ...optionalFilters.map((key) => ({ key, label: key === 'no_visit' ? 'No visit' : key === 'unavailable' ? 'Status unavailable' : 'Closed' })),
  ];

  return (
    <Layout title="Meeting Tracker">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 pt-6">
        <h1 className="text-2xl font-semibold text-gray-900">Meeting Tracker</h1>
        <div className="flex flex-wrap gap-5 text-sm font-semibold text-gray-600">
          <Link href="/meeting-tracker/program-briefing" className="hover:text-gray-900 hover:underline">Program briefing</Link>
          <Link href="/meeting-tracker/discussion-sentiment" className="hover:text-gray-900 hover:underline">Discussion sentiment</Link>
        </div>
      </div>
      <nav aria-label="Meeting Tracker views" className="mb-5 flex gap-6 border-b border-gray-300">
        {[['cycle', 'Cycle schedule'], ['sessions', 'Proposal discussion sessions']].map(([key, label]) => <Link key={key} href={{ pathname: '/meeting-tracker', query: { ...router.query, view: key } }} shallow aria-current={view === key ? 'page' : undefined} className={`border-b-2 pb-3 text-left text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 ${view === key ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-900'}`}>{label}</Link>)}
      </nav>
      {view === 'sessions' ? <MeetingSessionsView sessions={sessions} loading={loading} error={sessionsError} onRetry={() => load(programId, cycleCode, scope)} cycleCode={cycleCode} programId={programId} /> : <>
      <div className="mb-5 flex flex-wrap items-end gap-4">
        <ToolbarSelect className="min-w-[9rem] flex-1 sm:flex-none" size="compact" id="meeting-program" label="Grant program" value={programId} disabled={!programs.length} onChange={(event) => changeFilters({ programId: event.target.value, cycleCode: '' })}>
          {!programs.length && <option value="">Loading programs…</option>}
          {programs.map((program) => <option key={program.programId} value={program.programId}>{program.name}</option>)}
        </ToolbarSelect>
        <ToolbarSelect className="min-w-[9rem] flex-1 sm:flex-none" size="compact" id="meeting-cycle" label="Grant cycle" value={cycleCode} disabled={!cycles.length} onChange={(event) => changeFilters({ cycleCode: event.target.value })}>
          {cycles.map((cycle) => <option key={cycle.code} value={cycle.code}>{cycle.label || cycle.code}</option>)}
        </ToolbarSelect>
        <div role="group" aria-label="Request scope" className="flex max-w-full flex-col gap-1.5"><span className="text-sm font-medium text-gray-700">Request scope</span><div className="flex h-11 overflow-hidden rounded-lg border border-gray-300 bg-white">{[['my', 'My requests'], ['all', 'All program directors']].map(([value, label]) => <button key={value} type="button" aria-pressed={scope === value} onClick={() => changeFilters({ scope: value })} className={`px-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 ${scope === value ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-50'}`}>{label}</button>)}</div></div>
        <label className="flex min-w-full flex-1 flex-col gap-1.5 sm:min-w-[15rem] text-sm font-medium text-gray-700 lg:ml-auto lg:max-w-xs">Find a request
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Request, institution, or title" className="h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-base font-normal focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 sm:text-sm" />
        </label>
      </div>

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
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <p role="status" className="text-sm text-gray-600"><strong className="font-semibold text-gray-900">{visibleProposals.length} request{visibleProposals.length === 1 ? '' : 's'}</strong><span className="hidden sm:inline"> · In this cycle and scope</span></p>
          <label className="text-sm text-gray-700"><span className="sr-only">Materials status</span><select aria-label="Materials status" value={materialsFilter} onChange={(event) => setMaterialsFilter(event.target.value)} className="h-10 max-w-full rounded-lg border border-gray-300 bg-white px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">
            <option value="all">Materials: All statuses ({proposals.length})</option>
            {filterOptions.map((option) => <option key={option.key} value={option.key} disabled={!counts[option.key]}>{option.label} ({counts[option.key] || 0})</option>)}
          </select></label>
        </div>
      )}
      {loading ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500">Loading the cycle schedule…</div>
      ) : visibleProposals.length ? (
        <div className="overflow-hidden rounded-lg border border-gray-200"><div aria-hidden="true" className="hidden grid-cols-[minmax(0,1fr)_11.5rem_11.5rem_8.5rem] gap-5 border-b border-gray-200 bg-gray-100 px-4 py-3 text-xs font-semibold text-gray-600 lg:grid"><span>Request</span><span>Proposal discussion session</span><span>Research presentation</span><span>Materials</span></div>{visibleProposals.map((proposal) => <MeetingTrackerRequestRow key={proposal.requestId} proposal={proposal} cycleCode={cycleCode} programId={programId} />)}</div>
      ) : proposals.length ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center"><h2 className="text-lg font-semibold text-gray-900">No requests match these filters</h2><button type="button" onClick={() => { setMaterialsFilter('all'); setSearch(''); }} className="mt-2 font-semibold text-blue-700 underline">Show all requests</button></div>
      ) : !error && (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
          <h2 className="text-lg font-semibold text-gray-900">No advancing requests are in this view</h2>
          <p className="mt-2 text-sm text-gray-600">Choose another cycle, program, or scope.</p>
        </div>
      )}
      </>}
    </Layout>
  );
}
