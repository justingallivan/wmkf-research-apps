import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Layout, { PageHeader } from '../Layout';
import ToolbarSelect from '../ToolbarSelect';
import ScopeSegment from '../workbench/ScopeSegment';

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
  const sessionHref = trackerHref(
    proposal.deliberation
      ? `/meeting-tracker/sessions/${proposal.deliberation.sessionId}`
      : '/meeting-tracker/sessions/new',
    { cycleCode, programId, requestId: proposal.requestId },
  );
  return (
    <article className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-colors hover:border-gray-300">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-gray-900">#{proposal.requestNumber}</h2>
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
        <Link href={sessionHref} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2">
          {proposal.deliberation ? 'Open session' : 'Schedule'}
        </Link>
      </div>

      <div className="mt-5 grid gap-4 border-t border-gray-100 pt-4 md:grid-cols-3">
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
  const loadToken = useRef(0);
  // The cycle picker's options come only from the dashboard's no-cycle
  // response. Arriving with a cycle already in the URL (the session page's
  // "Back to the cycle schedule" link does this) must still load them, or the
  // Grant cycle select renders disabled (owner, 2026-09-10).
  const cyclesRef = useRef([]);

  const load = useCallback(async (selectedProgramId, selectedCycleCode, selectedScope) => {
    const token = ++loadToken.current;
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams();
      if (selectedProgramId) query.set('programId', selectedProgramId);
      if (selectedCycleCode) query.set('cycleCode', selectedCycleCode);
      if (selectedScope === 'all') query.set('scope', 'all');
      const needsPicker = Boolean(selectedCycleCode) && cyclesRef.current.length === 0;
      const pickerQuery = new URLSearchParams();
      if (selectedProgramId) pickerQuery.set('programId', selectedProgramId);
      const [dashboardResponse, sessionsResponse, pickerResponse] = await Promise.all([
        fetch(`/api/meeting-tracker/dashboard${query.size ? `?${query}` : ''}`),
        fetch('/api/meeting-tracker/sessions'),
        needsPicker ? fetch(`/api/meeting-tracker/dashboard${pickerQuery.size ? `?${pickerQuery}` : ''}`) : Promise.resolve(null),
      ]);
      const dashboard = await dashboardResponse.json().catch(() => ({}));
      const sessionBody = await sessionsResponse.json().catch(() => ({}));
      const picker = pickerResponse?.ok ? await pickerResponse.json().catch(() => ({})) : null;
      if (token !== loadToken.current) return;
      if (!dashboardResponse.ok) throw new Error(dashboard.error || 'The meeting schedule could not be loaded. Please try again.');
      if (!sessionsResponse.ok) throw new Error(sessionBody.error || 'The meeting sessions could not be loaded. Please try again.');
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
          void router.replace({
            pathname: '/meeting-tracker',
            query: {
              programId: selectedProgramId || dashboard.programId || '',
              cycleCode: nextCycle,
              ...(selectedScope === 'all' ? { scope: 'all' } : {}),
            },
          }, undefined, { shallow: true });
        }
      } else {
        setProposals(dashboard.proposals || []);
        setNotices(dashboard.notices || []);
      }
    } catch (loadError) {
      if (token === loadToken.current) setError(loadError.message);
    } finally {
      if (token === loadToken.current) setLoading(false);
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
      void load(nextProgram, nextCycle, nextScope);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      loadToken.current += 1;
    };
  }, [load, router.isReady, router.query.cycleCode, router.query.programId, router.query.scope]);

  const changeFilters = (next) => {
    const nextProgram = next.programId ?? programId;
    const nextCycle = next.cycleCode ?? cycleCode;
    const nextScope = next.scope ?? scope;
    setProgramId(nextProgram);
    setCycleCode(nextCycle);
    setScope(nextScope);
    void router.replace({ pathname: '/meeting-tracker', query: { programId: nextProgram, cycleCode: nextCycle, ...(nextScope === 'all' ? { scope: 'all' } : {}) } }, undefined, { shallow: true });
  };

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
      {loading ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500">Loading the cycle schedule…</div>
      ) : proposals.length ? (
        <div className="space-y-3">{proposals.map((proposal) => <MeetingTrackerRequestRow key={proposal.requestId} proposal={proposal} cycleCode={cycleCode} programId={programId} />)}</div>
      ) : !error && (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
          <h2 className="text-lg font-semibold text-gray-900">No advancing requests are in this view</h2>
          <p className="mt-2 text-sm text-gray-600">Choose another cycle, program, or scope.</p>
        </div>
      )}
    </Layout>
  );
}
