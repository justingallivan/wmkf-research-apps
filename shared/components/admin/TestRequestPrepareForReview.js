import { useEffect, useRef, useState } from 'react';
import { requestJson } from '../../utils/api-request';
import { OPEN_CHANGE_STATUSES, STATUS_FIELDS } from '../../config/testRequestFactory';
import { StatusChip } from './AdminWorkspaceNavigation';
import { messageFor } from './test-request-factory-copy';
import { buttonProps, focusAndShow } from './test-request-factory-ui';

/**
 * "Prepare for review" for a prepared J27+ test Request (owner, 2026-11-15).
 * One action does the only order that works: Phase I → Invited (allowed only
 * while Phase II is empty), Phase II → Phase II Pending Committee Review, then
 * Mark ready for review, which is what puts the Request in the Workbench.
 *
 * Each step uses the existing server routes and their guards: a status change
 * is sent once and a "check again" answer resumes the SAME change (by its
 * changeId); readiness is one journaled PATCH that is never resent. The flow
 * stops at any answer other than complete and continues from there when
 * pressed again. Each step's state is read from the server after every answer,
 * never assumed. Readiness cannot be undone, so the first press asks first.
 *
 * Props: `data` is the status GET (options with the server's own verdicts,
 * current pair, journal, readiness); `reload(scope)` re-reads it and returns the
 * fresh data or null; `openChangeBody(data)` gives the resume body for the
 * journal's open status change (null when none or ambiguous). `autoStart`
 * (owner, 2026-11-18): this page just created the test Request, so the action
 * starts on its own, without the question, but only from a clean start; a run
 * already begun, stopped or finished still waits for Continue.
 */
const STEP_LABELS = ['Set Phase I to Invited', 'Set Phase II to Phase II Pending Committee Review', 'Mark ready for review'];
// The one status failure readiness tolerates (readiness-finalizer.js): a 412 that wrote nothing.
const NO_WRITE_412 = 'The Request changed since it was read (412); nothing was written.';
const STOP_TONES = {
  green: 'border-green-200 bg-green-50 text-green-900',
  amber: 'border-amber-200 bg-amber-50 text-amber-900',
  red: 'border-red-200 bg-red-50 text-red-900',
};

/** Where the Request stands, from the server's data only. */
export function preparationState(data) {
  const readiness = data?.readiness;
  const pair = readiness?.requiredPair;
  const current = data?.current || {};
  const phaseIDone = current.phase1 === pair?.phase1;
  const phaseIIDone = phaseIDone && current.phase2 === pair?.phase2;
  const readyDone = readiness?.ready === true && readiness?.attemptStatus === 'complete';
  const optionFor = (key, value) => (data?.options?.[key] || []).find((option) => option.value === value && typeof option.label === 'string' && option.label.trim()) || null;
  const invited = optionFor('phase1', pair?.phase1);
  const pending = optionFor('phase2', pair?.phase2);
  const openChange = (data?.changes || []).find((change) => OPEN_CHANGE_STATUSES.includes(change.status)) || null;

  const statusAttention = (data?.changes || []).some((change) => change.status === 'needs_attention' && change.error !== NO_WRITE_412);
  let blocked = '';
  if (statusAttention) {
    blocked = 'A status change on this Request needs the owner to inspect it (background jobs failed or something unexpected appeared). Nothing more can be sent from here; see the history under More options.';
  } else if (readiness?.attemptStatus === 'needs_attention') {
    blocked = 'The last readiness attempt needs the owner to inspect it from the command-line tool. Nothing more can be sent from here.';
  } else if (readiness?.ready === true && !readyDone && !['dispatched', 'applied'].includes(readiness?.attemptStatus)) {
    blocked = 'This Request was marked ready outside this form; the owner inspects it from the command-line tool.';
  } else if (!openChange && !phaseIDone && current.phase2 != null) {
    blocked = "This test Request can't be prepared: Phase II was set before Phase I was Invited, and Phase I can't become Invited now. Create a new test Request and use Prepare for review on it.";
  } else if (!openChange && !phaseIDone && (!invited || invited.blocked)) {
    blocked = "This test Request can't be prepared: Phase I can't be set to Invited from its current status. Create a new test Request and use Prepare for review on it.";
  } else if (!openChange && phaseIDone && !phaseIIDone && (!pending || pending.blocked)) {
    blocked = "This test Request can't be prepared: Phase II can't be set to Phase II Pending Committee Review from here. Use More options below, or create a new test Request.";
  } else if (!readyDone && !readiness?.manifestStored) {
    blocked = "This run's stored files are gone, so the form can't mark it ready. The owner can do that from the command-line tool with the downloaded manifest.";
  }
  // Once readiness is complete there is nothing left for this action to send; a later open or failed status
  // change (from More options) keeps it from reading as finished.
  const laterChange = readyDone && Boolean(openChange)
    ? 'A later status change on this Request is still open. Check it under More options.' : '';
  return {
    done: [phaseIDone, phaseIIDone, readyDone],
    allDone: readyDone && phaseIIDone && !openChange && !blocked,
    finished: readyDone,
    laterChange,
    invited, pending, openChange, blocked,
    readinessResumable: ['dispatched', 'applied'].includes(readiness?.attemptStatus),
    readinessApplied: readiness?.attemptStatus === 'applied' && readiness?.ready === true,
    // The step a sent-but-unconfirmed status change belongs to (0 or 1), else -1.
    openStep: openChange ? (STATUS_FIELDS.find((field) => field.column === openChange.field)?.key === 'phase1' ? 0 : 1) : -1,
  };
}

export default function TestRequestPrepareForReview({
  run, data, autoStart = false, writeBlock, busy, setBusy, liveScope, reload, openChangeBody,
}) {
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(-1);
  const [stop, setStop] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const questionRef = useRef(null);
  const stopRef = useRef(null);
  const autoStartedRef = useRef(false);

  useEffect(() => { if (confirming) focusAndShow(questionRef.current); }, [confirming]);
  useEffect(() => { if (stop) focusAndShow(stopRef.current); }, [stop]);

  const requestName = run.destinationRequestNumber ? `Request ${run.destinationRequestNumber}` : 'this test Request';
  const state = preparationState(data);

  // One server call for the next step; returns the reply's outcome, or null after a refusal.
  async function sendStep(scope, fresh, view) {
    const base = `/api/admin/test-requests/runs/${run.runId}`;
    if (view.openChange) {
      const body = openChangeBody(fresh);
      if (!body) {
        setStop({ tone: 'amber', text: "An open status change can't be resumed from here (its status label is missing or ambiguous). Open More options below." });
        return null;
      }
      setWorking(body.field === 'phase1' ? 0 : 1);
      return requestJson(`${base}/status`, { method: 'POST', body: { ...body, changeId: view.openChange.changeId }, signal: scope.signal, fallbackMessage: 'The status change could not be sent.' });
    }
    if (!view.done[0]) {
      setWorking(0);
      return requestJson(`${base}/status`, { method: 'POST', body: { field: 'phase1', optionLabel: view.invited.label }, signal: scope.signal, fallbackMessage: 'The status change could not be sent.' });
    }
    if (!view.done[1]) {
      setWorking(1);
      return requestJson(`${base}/status`, { method: 'POST', body: { field: 'phase2', optionLabel: view.pending.label }, signal: scope.signal, fallbackMessage: 'The status change could not be sent.' });
    }
    setWorking(2);
    return requestJson(`${base}/readiness`, { method: 'POST', signal: scope.signal, fallbackMessage: 'The readiness change could not be sent.' });
  }

  async function prepare() {
    setConfirming(false);
    setConfirmed(true);
    const scope = liveScope();
    setBusy(true);
    setStop(null);
    let fresh = data;
    try {
      // At most one call per step plus one resume: never an unbounded loop. The state is checked after
      // every reload, including the last, before any "not finished" answer.
      for (let calls = 0; ; calls += 1) {
        const view = preparationState(fresh);
        if (view.blocked) { setStop({ tone: 'amber', text: view.blocked }); return; }
        if (view.allDone) {
          setStop({ tone: 'green', text: `${requestName} is ready for review. It now appears in the Workbench.` });
          return;
        }
        if (view.finished) { setStop({ tone: 'amber', text: view.laterChange || `${requestName} is already marked ready; its statuses were changed afterwards. Check them under More options.` }); return; }
        if (calls >= 4) break;
        const reply = await sendStep(scope, fresh, view);
        if (!scope.alive()) return;
        if (!reply) return;
        fresh = await reload(scope);
        if (!scope.alive() || !fresh) return;
        if (reply.outcome !== 'complete') {
          const extra = reply.abandonCommand ? ` Command to close it once nothing is still sending: ${reply.abandonCommand}` : '';
          setStop({ tone: 'amber', text: `${reply.message || 'This step is not finished yet.'}${reply.outcome === 'in_progress' ? extra : ' Press Continue to pick up from here.'}` });
          return;
        }
      }
      setStop({ tone: 'amber', text: 'Stopped after the expected steps without finishing. Reload the run and check its status.' });
    } catch (error) {
      if (!scope.alive() || error?.name === 'AbortError') return;
      setStop({ tone: 'red', text: messageFor(error) });
      await reload(scope);
    } finally {
      if (scope.alive()) { setBusy(false); setWorking(-1); }
    }
  }

  useEffect(() => {
    if (!autoStart || autoStartedRef.current || writeBlock || busy) return;
    const view = preparationState(data);
    const clean = !view.blocked && !view.finished && !view.done.some(Boolean) && !view.openChange && !view.readinessResumable;
    autoStartedRef.current = true;
    if (clean) prepare();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, data, writeBlock, busy]);

  const reason = (() => {
    if (writeBlock) return writeBlock;
    if (busy) return 'Working…';
    return '';
  })();
  // A retained success never outlives the state it described; current state messages always show (Codex round 3).
  const shownStop = stop && !(stop.tone === 'green' && !state.allDone) ? stop : null;
  const unlessShown = (text) => (shownStop?.text === text ? null : text);
  const started = state.done.some(Boolean) || Boolean(state.openChange) || state.readinessResumable;
  // From the server's state after a reload, not only from this mount: a step that was sent but not yet
  // confirmed never reads "Not started".
  const sentStep = state.openChange ? state.openStep : (state.readinessResumable ? 2 : -1);
  const chip = (index) => {
    if (state.done[index]) return <StatusChip tone="green">Done</StatusChip>;
    if (working === index) return <StatusChip tone="blue">In progress</StatusChip>;
    // A planned change is journaled but not yet sent: Continue sends it (status-change-runner.js resumes it).
    if (sentStep === index) return <StatusChip tone="blue">{state.openChange?.status === 'planned' ? 'Planned, not sent' : 'Sent, not confirmed'}</StatusChip>;
    return <StatusChip tone="gray">Not started</StatusChip>;
  };
  // Where a paused run stands, from the server's state, for when no reply from this mount is on screen.
  const pausedNote = (() => {
    if (busy || shownStop || state.blocked || state.finished) return '';
    if (state.openChange?.status === 'planned') return 'A status change was saved but not sent yet. Press Continue to send it and carry on.';
    if (state.openChange) return 'A status change was sent and is still being confirmed. Press Continue to check it; it is not sent again.';
    if (state.readinessApplied) return `Ready for review is set, so ${requestName} already appears in the Workbench. The last check was still waiting for Dynamics' background jobs. Press Continue to finish it; nothing is sent again.`;
    if (state.readinessResumable) return "Ready for review was sent, but its result isn't confirmed yet. Press Continue to check; it is not sent again.";
    return '';
  })();

  return (
    <section aria-labelledby="factory-prepare-heading" className="space-y-4">
      <div>
        <h4 id="factory-prepare-heading" className="text-base font-semibold text-gray-950">Prepare for review</h4>
        <p className="mt-1 text-sm leading-6 text-gray-600">
          Puts {requestName} in the Workbench in three steps. Each waits for Dynamics&apos; background jobs, so it takes about 5 to 10 minutes. Leave this page open.
        </p>
      </div>
      <ol className="divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white">
        {STEP_LABELS.map((label, index) => (
          <li key={label} className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-gray-900">
            <span>{index + 1}. {label}</span>
            {chip(index)}
          </li>
        ))}
      </ol>
      {pausedNote ? <p role="status" className="text-sm leading-6 text-gray-800">{pausedNote}</p> : null}
      {shownStop ? (
        <div ref={stopRef} tabIndex={-1} role={shownStop.tone === 'red' ? 'alert' : 'status'} className={`rounded-lg border px-4 py-3 text-sm leading-6 focus:outline-none ${STOP_TONES[shownStop.tone]}`}>{shownStop.text}</div>
      ) : null}
      {state.blocked ? (
        unlessShown(state.blocked) ? <p role="status" className={`rounded-lg border px-4 py-3 text-sm leading-6 ${STOP_TONES.amber}`}>{state.blocked}</p> : null
      ) : state.allDone ? (
        shownStop?.tone === 'green' ? null : <p className="text-sm text-gray-800">{requestName} is ready for review and appears in the Workbench.</p>
      ) : state.finished ? (
        <p role="status" className={`rounded-lg border px-4 py-3 text-sm leading-6 ${STOP_TONES.amber}`}>{state.laterChange || `${requestName} is marked ready for review, but its statuses were changed afterwards. Check them under More options.`}</p>
      ) : confirming ? (
        <div role="group" aria-label="Confirm Prepare for review" className="rounded-xl border border-gray-300 bg-gray-50 px-4 py-4 text-sm leading-6 text-gray-900">
          <p ref={questionRef} tabIndex={-1} className="font-semibold focus:outline-none">Prepare {requestName} for review on Production?</p>
          <p className="mt-1">Setting Phase I to Invited may create a draft email and a GoApply tracking row. Marking it ready can&apos;t be undone: readiness can&apos;t be set back from here or the command-line tool.</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="button" {...buttonProps(true)} disabled={Boolean(reason)} onClick={prepare}>Yes, prepare it</button>
            <button type="button" {...buttonProps(false)} onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <button
            type="button"
            {...buttonProps(true)}
            disabled={Boolean(reason)}
            aria-describedby="factory-prepare-reason"
            onClick={confirmed ? prepare : () => setConfirming(true)}
          >
            {started ? 'Continue' : 'Prepare for review'}
          </button>
          {reason ? <p id="factory-prepare-reason" className="text-sm text-gray-600">{reason}</p> : null}
        </div>
      )}
    </section>
  );
}
