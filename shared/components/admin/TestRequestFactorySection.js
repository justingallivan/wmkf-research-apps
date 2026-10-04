import { useCallback, useEffect, useRef, useState } from 'react';
import { requestJson } from '../../utils/api-request';
import { BASIC_STEPS, RUN_STATUSES } from '../../config/testRequestFactory';
import { StatusChip } from './AdminWorkspaceNavigation';
import TestRequestFactoryIntake from './TestRequestFactoryIntake';
import TestRequestFactoryRunPanel from './TestRequestFactoryRunPanel';
import { messageFor } from './test-request-factory-copy';
import {
  ERROR_BAND, OUTLINE_BUTTON, TABLE_WRAP, TH, formatTime,
} from './test-request-factory-ui';

const BASE = '/api/admin/test-requests/runs';
const FORM_OFF_FULL = 'Creating test Requests is switched off on this deployment. Existing runs can still be inspected.';
// The per-control reason; the full sentence appears once, in the banner at the top.
const FORM_OFF = 'Switched off on this deployment (see the note at the top).';
const LEASE_COPY = 'Another process is advancing this run. That can be a step you started a moment ago that is still finishing. Try again in a few minutes.';
const stepLabel = (key) => BASIC_STEPS.find((step) => step.key === key)?.label || key;
const IDLE_RECHECK = { busy: false, result: null, error: '' };
const IDLE_ARTIFACTS = { busy: false, note: '', error: '' };

/** The words for what an advance answer means. The answer's text is shown, never kept. */
function noteFor(reply) {
  switch (reply.outcome) {
    case 'ready':
      return { tone: 'green', text: 'The test Request is ready.', detail: reply.destinationRequestNumber ? `Request ${reply.destinationRequestNumber}` : '' };
    case 'needs_attention':
      return { kind: 'attention', tone: 'amber', text: `Stopped at "${stepLabel(reply.step)}".`, detail: reply.errorMessage || '' };
    case 'lease_unavailable':
    case 'lease_lost':
      return { tone: 'amber', text: LEASE_COPY, detail: '' };
    case 'not_advanced':
      return { tone: 'gray', text: `This run is ${(RUN_STATUSES[reply.status]?.label || String(reply.status)).toLowerCase()}, so nothing was advanced.`, detail: '' };
    default:
      return { tone: 'amber', text: "The server's answer wasn't one this form knows, so nothing more was sent. Reload the run to see where it stands.", detail: '' };
  }
}

function saveJson(name, value) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * Admin form that creates a test Request, step by step, and sets its Phase I/II
 * status. One section-wide scope (an AbortController and the run it belongs to)
 * guards every run-scoped request: selecting another run, starting a new
 * lookup or unmounting aborts it, and every await below compares the scope
 * before it touches state, so a late answer for a run no longer shown updates
 * nothing. An abort is not an error and shows no message.
 */
export default function TestRequestFactorySection({ onTarget }) {
  const [list, setList] = useState({ state: 'loading', runs: [], formEnabled: false, target: null, text: '' });
  const [view, setView] = useState(null);
  const [advancing, setAdvancing] = useState(false);
  const [stopRequested, setStopRequested] = useState(false);
  const [note, setNote] = useState(null);
  const [recheck, setRecheck] = useState(IDLE_RECHECK);
  const [artifacts, setArtifacts] = useState(IDLE_ARTIFACTS);
  const [epoch, setEpoch] = useState(0);
  const scopeRef = useRef(null);
  const stopRef = useRef(false);
  // Bumped by every selection change (selectRun, abortActive); a late Confirm may select its run only if it is unchanged.
  const selectionSeqRef = useRef(0);
  // In-progress status records by run id, for the life of this mounted section (never stored in the browser).
  const stuckMapRef = useRef(new Map());
  const listControllerRef = useRef(null);
  const mountedRef = useRef(true);

  const writeBlock = list.state === 'loading'
    ? 'Checking whether this deployment allows creating test Requests…'
    : list.state === 'error'
      ? "I couldn't check whether this deployment allows creating test Requests. Reload the run list first."
      : (list.formEnabled ? '' : FORM_OFF);

  const loadList = useCallback(async () => {
    listControllerRef.current?.abort();
    const controller = new AbortController();
    listControllerRef.current = controller;
    try {
      const body = await requestJson(BASE, { signal: controller.signal, fallbackMessage: 'The runs could not be loaded.' });
      if (controller.signal.aborted || !mountedRef.current) return;
      setList({
        state: 'ready', runs: body.runs || [], formEnabled: body.formEnabled === true, target: body.target || null, text: '',
      });
      onTarget?.(body.target || null);
    } catch (error) {
      if (controller.signal.aborted || !mountedRef.current || error?.name === 'AbortError') return;
      setList((current) => ({ ...current, state: 'error', text: messageFor(error) }));
    }
  }, [onTarget]);

  useEffect(() => {
    mountedRef.current = true;
    loadList();
    return () => {
      mountedRef.current = false;
      scopeRef.current?.controller.abort();
      listControllerRef.current?.abort();
    };
  }, [loadList]);

  // ---- scope ---------------------------------------------------------------

  const isLive = (scope) => mountedRef.current && scopeRef.current === scope && !scope.controller.signal.aborted;

  const openScope = (runId) => {
    scopeRef.current?.controller.abort();
    const scope = { runId, controller: new AbortController() };
    scopeRef.current = scope;
    return scope;
  };

  // A new scope always resets the panel, so no path can replace a scope and leave stale panel state.
  const scopeFor = (runId) => {
    const scope = scopeRef.current;
    if (scope && scope.runId === runId && !scope.controller.signal.aborted) return scope;
    const fresh = openScope(runId);
    resetPanel();
    return fresh;
  };

  const handleFor = (runId) => {
    const scope = scopeFor(runId);
    return { signal: scope.controller.signal, isCurrent: () => isLive(scope) };
  };

  const resetPanel = () => {
    stopRef.current = false;
    setAdvancing(false);
    setStopRequested(false);
    setNote(null);
    setRecheck(IDLE_RECHECK);
    setArtifacts(IDLE_ARTIFACTS);
    setEpoch((value) => value + 1);
  };

  /** Aborts whatever run-scoped work is in flight and returns the panel to rest. */
  const abortActive = () => {
    selectionSeqRef.current += 1;
    scopeRef.current?.controller.abort();
    scopeRef.current = null;
    resetPanel();
    setView(null); // the run stays in the list and the server finishes any step it had begun
  };

  async function refreshRun(scope) {
    try {
      const body = await requestJson(`${BASE}/${scope.runId}`, { signal: scope.controller.signal, fallbackMessage: 'The run could not be loaded.' });
      if (!isLive(scope)) return;
      setView((current) => ({
        state: 'ready', run: body.run, resources: body.resources || [], foundationCapturedAt: body.foundationCapturedAt || null,
        diagnosis: body.diagnosis || null, text: '', skipFocus: Boolean(current?.skipFocus && current.run.runId === body.run.runId),
      }));
    } catch (error) {
      if (!isLive(scope) || error?.name === 'AbortError') return;
      setView((current) => (current && current.run.runId === scope.runId
        ? { ...current, state: 'error', diagnosis: null, text: messageFor(error) } : current));
    }
  }

  // `skipFocus`: a run just reserved keeps focus on the intake's reserved line, not the panel heading.
  function selectRun(run, { skipFocus = false } = {}) {
    selectionSeqRef.current += 1;
    const scope = openScope(run.runId);
    resetPanel();
    setView({
      state: 'loading', run, resources: null, foundationCapturedAt: null, diagnosis: null, text: '', skipFocus,
    });
    return refreshRun(scope);
  }

  const mergeRun = (runId, reply) => setView((current) => {
    if (!current || current.run.runId !== runId) return current;
    const next = { ...current.run };
    if (reply.status) next.status = reply.status;
    if (reply.currentStep != null) next.currentStep = reply.currentStep;
    if (Number.isInteger(reply.stepIndex)) next.stepIndex = reply.stepIndex;
    if (reply.destinationRequestNumber) next.destinationRequestNumber = reply.destinationRequestNumber;
    return { ...current, run: next, diagnosis: null };
  });

  // ---- advance loop --------------------------------------------------------

  async function advance(runId) {
    const scope = scopeFor(runId);
    stopRef.current = false;
    setStopRequested(false);
    setAdvancing(true);
    setNote(null);
    let finalNote = null;
    for (;;) {
      let reply;
      try {
        // One POST per step. Only `advanced` continues; every other answer, and any error, stops the loop.
        reply = await requestJson(`${BASE}/${runId}/advance`, { method: 'POST', signal: scope.controller.signal, fallbackMessage: 'The step could not be run.' });
      } catch (error) {
        if (!isLive(scope)) return;
        finalNote = { tone: 'red', text: messageFor(error), detail: '' };
        break;
      }
      if (!isLive(scope)) return;
      mergeRun(runId, reply);
      if (reply.outcome !== 'advanced' || reply.status === 'ready') {
        finalNote = noteFor(reply.status === 'ready' && reply.outcome === 'advanced' ? { ...reply, outcome: 'ready' } : reply);
        break;
      }
      if (stopRef.current) {
        finalNote = { tone: 'gray', text: 'Stopped after that step. Resume when you are ready.', detail: '' };
        break;
      }
    }
    setAdvancing(false);
    setNote(finalNote);
    await refreshRun(scope);
    if (isLive(scope)) loadList();
  }

  // ---- read tools ----------------------------------------------------------

  async function recheckFoundation(runId) {
    const scope = scopeFor(runId);
    setRecheck({ busy: true, result: null, error: '' });
    try {
      const result = await requestJson(`${BASE}/${runId}/recheck`, { method: 'POST', signal: scope.controller.signal, fallbackMessage: 'The recheck could not be run.' });
      if (!isLive(scope)) return;
      setRecheck({ busy: false, result, error: '' });
    } catch (error) {
      if (!isLive(scope) || error?.name === 'AbortError') return;
      setRecheck({ busy: false, result: null, error: messageFor(error) });
    }
  }

  async function downloadArtifacts(runId) {
    const scope = scopeFor(runId);
    setArtifacts({ busy: true, note: '', error: '' });
    try {
      const body = await requestJson(`${BASE}/${runId}/artifacts`, { signal: scope.controller.signal, fallbackMessage: 'The run files could not be read.' });
      if (!isLive(scope)) return;
      if (body.cleanedUp) {
        setArtifacts({ busy: false, note: 'The run files were removed after the run finished, so there is nothing to download.', error: '' });
        return;
      }
      saveJson(`test-request-run-${runId}-manifest.json`, body.manifest);
      saveJson(`test-request-run-${runId}-bundle.json`, body.bundle);
      setArtifacts({ busy: false, note: 'Downloaded the manifest and the source bundle.', error: '' });
    } catch (error) {
      if (!isLive(scope) || error?.name === 'AbortError') return;
      setArtifacts({ busy: false, note: '', error: messageFor(error) });
    }
  }

  // Returns true when the reserved run was selected; false when the operator changed selection meanwhile.
  const onReserved = (run, token) => {
    loadList();
    if (token !== selectionSeqRef.current) return false;
    selectRun(run, { skipFocus: true });
    return true;
  };

  return (
    <div className="space-y-6">
      {list.state === 'ready' && !list.formEnabled ? (
        <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm font-semibold text-amber-950">
          {FORM_OFF_FULL}
        </div>
      ) : null}
      {list.state === 'ready' && list.formEnabled ? (
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-4 text-sm text-gray-900">
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip tone={list.target === 'production' ? 'amber' : 'gray'}>
              {list.target === 'production' ? 'Writes to production' : 'Writes to sandbox'}
            </StatusChip>
            <p className="max-w-3xl leading-6">
              {list.target === 'production'
                ? 'This panel changes real data on Production: it creates a test Request step by step and can change its Phase I or Phase II status.'
                : 'This panel changes real data on the sandbox: it creates a test Request step by step.'}
            </p>
          </div>
        </div>
      ) : null}

      <TestRequestFactoryIntake writeBlock={writeBlock} onLookupStart={abortActive} onReserved={onReserved} getSelectionToken={() => selectionSeqRef.current} hasSelection={Boolean(view)} />

      <section aria-labelledby="factory-runs-heading" className="space-y-3 border-t border-gray-200 pt-6">
        <div className="flex items-center justify-between gap-3">
          <h3 id="factory-runs-heading" className="text-base font-semibold text-gray-950">Your runs</h3>
          <button type="button" className={OUTLINE_BUTTON} onClick={loadList}>Reload list</button>
        </div>
        {list.state === 'error' ? <div role="alert" className={ERROR_BAND}>{list.text}</div> : null}
        <div className={TABLE_WRAP}>
          <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
            <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-600">
              <tr>
                <th scope="col" className={TH}>Label</th>
                <th scope="col" className={TH}>Source</th>
                <th scope="col" className={TH}>Test Request</th>
                <th scope="col" className={TH}>Status</th>
                <th scope="col" className={TH}>Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {list.runs.length ? list.runs.map((run) => {
                const status = RUN_STATUSES[run.status] || { label: run.status, tone: 'gray' };
                return (
                  <tr key={run.runId} className={view?.run.runId === run.runId ? 'bg-gray-100' : ''}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button type="button" title={run.testLabel} className="inline-flex min-h-11 max-w-xs items-center truncate font-semibold text-gray-950 underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900" aria-current={view?.run.runId === run.runId ? 'true' : undefined} onClick={() => selectRun(run)}>
                          <span className="truncate">{run.testLabel}</span>
                        </button>
                        {view?.run.runId === run.runId ? <span className="shrink-0"><StatusChip tone="gray">Selected</StatusChip></span> : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 tabular-nums">{run.sourceRequestNumber}</td>
                    <td className="px-4 py-3 tabular-nums">{run.destinationRequestNumber || 'Not created yet'}</td>
                    <td className="px-4 py-3">
                      {advancing && view?.run.runId === run.runId ? <StatusChip tone="blue">In progress</StatusChip> : <StatusChip tone={status.tone}>{status.label}</StatusChip>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{formatTime(run.createdAt)}</td>
                  </tr>
                );
              }) : (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-600">{list.state === 'loading' ? 'Loading runs…' : 'No runs yet.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {view ? (
        <TestRequestFactoryRunPanel
          view={view}
          advancing={advancing}
          stopRequested={stopRequested}
          note={note}
          writeBlock={writeBlock}
          onAdvance={() => advance(view.run.runId)}
          onStop={() => { stopRef.current = true; setStopRequested(true); }}
          recheck={recheck}
          onRecheck={() => recheckFoundation(view.run.runId)}
          artifacts={artifacts}
          onArtifacts={() => downloadArtifacts(view.run.runId)}
          getScope={() => handleFor(view.run.runId)}
          initialStuck={stuckMapRef.current.get(view.run.runId) || null}
          onStuck={(record) => { if (record) stuckMapRef.current.set(view.run.runId, record); else stuckMapRef.current.delete(view.run.runId); }}
          epoch={epoch}
        />
      ) : null}
    </div>
  );
}
