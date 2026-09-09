/**
 * Request Workbench shell — one page a PD moves across left to right through a
 * cycle. The shell owns the Grant Program and cycle (in the URL, see
 * workbench-location.js), loads the program's cycle list once, and mounts the
 * selected view as a panel below a shared toolbar. Every view is a panel; the
 * old per-view pages redirect here.
 *
 * Cycle default: the dashboard cycle list's `defaultCycleCode` (the working
 * cycle = the upcoming board meeting, per lib/utils/cycle-code.js) when the
 * URL carries no cycle; the resolved cycle is written back into the URL so
 * the address is always shareable. A well-formed `?cycleCode=` is honored
 * even when the program's list omits it (a Final writeups or Awardees cycle
 * need not have pending requests) and is rendered as an extra option.
 *
 * Data: /api/workbench/dashboard (no cycleCode = cycle list for a program).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import Layout, { PageHeader } from '../Layout';
import ToolbarSelect from '../ToolbarSelect';
import WorkbenchViewsNav from './WorkbenchViewsNav';
import RequestListPanel from './RequestListPanel';
import ReviewerFollowUpPanel from './ReviewerFollowUpPanel';
import { FinalWriteupsPanel } from '../final-writeups/FinalWriteupsViews';
import AwardeesPanel from './AwardeesPanel';
import InitialAssessmentsPanel from './InitialAssessmentsPanel';
import { cycleCodeToLabel } from '../../../lib/utils/cycle-code.js';
import { WORKBENCH_LOCATION_KEYS, buildWorkbenchHref, readWorkbenchQuery } from './workbench-location';

const sameLocation = (a, b) => WORKBENCH_LOCATION_KEYS.every((key) => a[key] === b[key]);

export function WorkbenchShell({ previewReadOnly = false }) {
  const router = useRouter();

  // URL-mirrored state. Local state is the render source; every change is
  // written to the URL (push for navigations, replace for filter tweaks), and
  // an external navigation (back/forward, a nav link) is adopted from the URL
  // once no write of ours is still in flight.
  const [location, setLocation] = useState(() => readWorkbenchQuery(router.query));
  const [ready, setReady] = useState(false);
  const locationRef = useRef(location);
  const pendingWritesRef = useRef(0);

  useEffect(() => {
    if (!router.isReady) return;
    if (ready && pendingWritesRef.current > 0) return;
    const next = readWorkbenchQuery(router.query);
    if (ready && sameLocation(next, locationRef.current)) return;
    locationRef.current = next;
    setLocation(next);
    setReady(true);
  }, [router.isReady, router.query, ready]);

  const routerRef = useRef(router);
  routerRef.current = router;
  const navigate = useCallback((patch, { push = false } = {}) => {
    const next = { ...locationRef.current, ...patch };
    locationRef.current = next;
    setLocation(next);
    pendingWritesRef.current += 1;
    const { push: routerPush, replace: routerReplace } = routerRef.current;
    Promise.resolve((push ? routerPush : routerReplace)(buildWorkbenchHref(next), undefined, { shallow: true, scroll: false }))
      .catch(() => {})
      .finally(() => { pendingWritesRef.current -= 1; });
  }, []);

  // Cycle list for the program in the URL (absent = the server's default).
  const [cycles, setCycles] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [resolvedProgramId, setResolvedProgramId] = useState('');
  const [defaultCycleCode, setDefaultCycleCode] = useState(null);
  const [loadingCycles, setLoadingCycles] = useState(true);
  // Which program the loaded list belongs to. Derived readiness (rather than
  // the loading flag alone) keeps the render after a program change from
  // reading the previous program's default cycle before its effect resets it.
  const [loadedProgramKey, setLoadedProgramKey] = useState(null);
  const [cyclesError, setCyclesError] = useState(null);
  const cyclesGenerationRef = useRef(0);
  const [cyclesGeneration, setCyclesGeneration] = useState(0);
  const cyclesLoadRef = useRef(0);
  const [cyclesAttempt, setCyclesAttempt] = useState(0);

  const requestedProgramId = location.programId;
  useEffect(() => {
    if (!ready) return undefined;
    const token = ++cyclesLoadRef.current;
    setLoadingCycles(true);
    setCyclesError(null);
    setCycles([]);
    setDefaultCycleCode(null);
    (async () => {
      try {
        const res = await fetch(`/api/workbench/dashboard${requestedProgramId ? `?programId=${encodeURIComponent(requestedProgramId)}` : ''}`);
        const body = await res.json().catch(() => ({}));
        if (cyclesLoadRef.current !== token) return;
        if (!res.ok) throw new Error(body.error || `Failed to load cycles (${res.status})`);
        cyclesGenerationRef.current += 1;
        setCyclesGeneration(cyclesGenerationRef.current);
        setCycles(body.cycles || []);
        setPrograms(Array.isArray(body.programs) ? body.programs : []);
        setResolvedProgramId(body.programId || '');
        setDefaultCycleCode(body.defaultCycleCode || (body.cycles || [])[0]?.code || null);
        setLoadedProgramKey(requestedProgramId);
      } catch (e) {
        if (cyclesLoadRef.current === token) setCyclesError(e.message);
      } finally {
        if (cyclesLoadRef.current === token) setLoadingCycles(false);
      }
    })();
    return () => { cyclesLoadRef.current += 1; };
  }, [ready, requestedProgramId, cyclesAttempt]);

  // The cycle the panels see: the URL's cycle when it has one, else the
  // working cycle, which is written back so the URL stays honest. Compared
  // against this render's location (not the ref) so an adoption committed by
  // the effect above cannot be undone by this one.
  const cyclesReady = !loadingCycles && loadedProgramKey === requestedProgramId;
  const urlCycleCode = location.cycleCode;
  const cycleCode = cyclesReady ? (urlCycleCode || defaultCycleCode) : null;
  const cycleOptions = cycleCode && !cycles.some((cycle) => cycle.code === cycleCode)
    ? [...cycles, { code: cycleCode, label: cycleCodeToLabel(cycleCode) || cycleCode }]
    : cycles;
  useEffect(() => {
    if (!cyclesReady || !cycleCode || cycleCode === urlCycleCode) return;
    navigate({ cycleCode });
  }, [cyclesReady, cycleCode, urlCycleCode, navigate]);

  const patchCycleCounts = useCallback((code, { myDelta = 0, mySetAsideDelta = 0 }, generation) => {
    if (generation !== cyclesGenerationRef.current) return;
    setCycles((previousCycles) => previousCycles.map((cycle) => {
      if (cycle.code !== code) return cycle;
      const myCount = Math.max(0, Number(cycle.myCount) || 0);
      const mySetAsideCount = Math.max(0, Number(cycle.mySetAsideCount) || 0);
      return {
        ...cycle,
        myCount: Math.max(0, myCount + myDelta),
        mySetAsideCount: Math.max(0, mySetAsideCount + mySetAsideDelta),
      };
    }));
  }, []);

  // The URL's program shows immediately on a change; otherwise the server's default.
  const programId = location.programId || resolvedProgramId;
  const changeProgram = (nextProgramId) => {
    if (!nextProgramId || nextProgramId === programId) return;
    // A new program has its own cycle list; the cycle resolves from it.
    navigate({ programId: nextProgramId, cycleCode: '' }, { push: true });
  };

  return (
    <Layout title="Request Workbench">
      <PageHeader
        title="Request Workbench"
        subtitle="Find and manage peer reviewers for your grant requests, one cycle at a time."
        icon="🗂️"
      />
      <WorkbenchViewsNav activeKey={location.view} cycleCode={cycleCode} programId={location.programId} />

      <div className="flex flex-wrap items-end gap-4 mb-6">
        <ToolbarSelect
          id="workbench-program"
          label="Grant Program"
          value={programId}
          disabled={!cyclesReady || programs.length === 0}
          onChange={(e) => changeProgram(e.target.value)}
        >
          {programs.length === 0 && <option value="">Loading programs…</option>}
          {programs.map((program) => (
            <option key={program.programId} value={program.programId}>{program.name}</option>
          ))}
        </ToolbarSelect>
        <ToolbarSelect
          id="workbench-cycle"
          label="Cycle"
          value={cycleCode || ''}
          disabled={!cyclesReady || cycleOptions.length === 0}
          onChange={(e) => navigate({ cycleCode: e.target.value, uncycled: false }, { push: true })}
        >
          {cycleOptions.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label || c.code}{c.count ? ` (${c.count})` : ''}
            </option>
          ))}
        </ToolbarSelect>
      </div>

      {cyclesError && (
        <div className="mb-6 p-4 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm" role="alert">
          {cyclesError}{' '}
          <button type="button" className="underline font-medium" onClick={() => setCyclesAttempt((n) => n + 1)}>Try again</button>
        </div>
      )}

      {location.view === 'requests' ? (
        <RequestListPanel
          key={programId}
          programId={programId}
          cycleCode={cycleCode}
          cycles={cycles}
          cyclesGeneration={cyclesGeneration}
          patchCycleCounts={patchCycleCounts}
          loadingCycles={!cyclesReady && !cyclesError}
          scope={location.scope}
          includeSetAside={location.includeSetAside}
          onScopeChange={(scope) => navigate({ scope })}
          onIncludeSetAsideChange={(includeSetAside) => navigate({ includeSetAside })}
        />
      ) : location.view === 'reviewer-follow-up' ? (
        <ReviewerFollowUpPanel
          key={programId}
          programId={programId}
          cycleCode={cycleCode}
          loadingCycles={!cyclesReady && !cyclesError}
          previewReadOnly={previewReadOnly}
          scope={location.scope}
          reviewersView={location.reviewersView}
          search={location.search}
          onScopeChange={(scope) => navigate({ scope })}
          onReviewersViewChange={(reviewersView) => navigate({ reviewersView })}
          onSearchChange={(search) => navigate({ search })}
        />
      ) : location.view === 'final-writeups' ? (
        <FinalWriteupsPanel
          cycleCode={cycleCode}
          loadingCycles={!cyclesReady && !cyclesError}
          writeupsView={location.writeupsView}
          pd={location.pd}
          search={location.search}
          uncycled={location.uncycled}
          onWriteupsViewChange={(writeupsView) => navigate({ writeupsView })}
          onPdChange={(pd) => navigate({ pd })}
          onSearchChange={(search) => navigate({ search })}
          onUncycledChange={(uncycled) => navigate({ uncycled }, { push: true })}
          onCycleChange={(code) => navigate({ cycleCode: code, uncycled: false }, { push: true })}
        />
      ) : location.view === 'awardees' ? (
        <AwardeesPanel
          cycleCode={cycleCode}
          loadingCycles={!cyclesReady && !cyclesError}
          scope={location.scope}
          onScopeChange={(scope) => navigate({ scope })}
          onCycleChange={(code) => navigate({ cycleCode: code }, { push: true })}
        />
      ) : (
        <InitialAssessmentsPanel cycleCode={cycleCode} loadingCycles={!cyclesReady && !cyclesError} />
      )}
    </Layout>
  );
}

export default WorkbenchShell;
