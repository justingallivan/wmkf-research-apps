import Link from 'next/link';
import { useEffect, useRef } from 'react';
import {
  ADVANCE_LABELS, BASIC_STEPS, RESOURCE_KIND_LABELS, RESOURCE_OUTCOME_LABELS, RUN_STATUSES, labelFor,
} from '../../config/testRequestFactory';
import { StatusChip } from './AdminWorkspaceNavigation';
import TestRequestStatusControl from './TestRequestStatusControl';
import { attentionCopyFor } from './test-request-factory-copy';
import {
  ERROR_BAND, SUMMARY_CLASS, TABLE_WRAP, TH, buttonProps, focusAndShow, formatTime,
} from './test-request-factory-ui';

const HOUR_MS = 3_600_000;
const stepLabel = (key) => BASIC_STEPS.find((step) => step.key === key)?.label || key;
const errorCodeOf = (error) => (error && typeof error === 'object' ? error.code : error) || '';
const envName = (run) => (run.destinationEnvironment === 'production' ? 'Production' : 'Sandbox');

/**
 * Progress comes from the run's own stepIndex and status, never from the last
 * response's `step`. A ready run has done every step.
 */
function stepState(run, index, advancing) {
  if (run.status === 'ready') return 'Done';
  const at = Number.isInteger(run.stepIndex) ? run.stepIndex : 0;
  if (index < at) return 'Done';
  if (index > at) return 'Pending';
  if (run.status === 'needs_attention') return 'Needs attention';
  if (advancing) return 'In progress';
  return 'Up next';
}

function ProgressList({ run, advancing }) {
  return (
    <ol className="divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 bg-white" aria-label="Steps">
      {BASIC_STEPS.map((step, index) => {
        const state = stepState(run, index, advancing);
        const tone = { Done: 'green', 'Needs attention': 'amber', 'In progress': 'blue' }[state] || 'gray';
        return (
          <li key={step.key} className="flex items-center justify-between gap-4 px-4 py-3 text-sm" aria-current={state === 'In progress' || state === 'Up next' ? 'step' : undefined}>
            <span className="min-w-0 break-words text-gray-950">{index + 1}. {step.label}</span>
            <span className="shrink-0"><StatusChip tone={tone}>{state}</StatusChip></span>
          </li>
        );
      })}
    </ol>
  );
}

const NOTE_CLASSES = {
  green: 'border-green-200 bg-green-50 text-green-900',
  amber: 'border-amber-200 bg-amber-50 text-amber-900',
  gray: 'border-gray-200 bg-gray-50 text-gray-800',
};

const clock = (time) => new Date(time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** "Meaningful after 3:10 PM (in 35 minutes)" or "since 2:10 PM"; null when the baseline time is unknown. */
function recheckAdvisory(capturedIso, now = Date.now()) {
  const captured = capturedIso ? Date.parse(capturedIso) : NaN;
  if (Number.isNaN(captured)) return null;
  const at = captured + HOUR_MS;
  if (at > now) {
    const minutes = Math.max(1, Math.ceil((at - now) / 60_000));
    return `A recheck is useful after ${clock(at)} (in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}).`;
  }
  const sameDay = new Date(at).toDateString() === new Date(now).toDateString();
  return `A recheck is useful since ${sameDay ? clock(at) : formatTime(at)}.`;
}

/**
 * The selected run: status, progress, the one advance action, then the
 * read-only tools (recorded steps, run tools) and, for a ready production run,
 * the status control. Presentational: the section owns every request and the
 * stale guard.
 */
export default function TestRequestFactoryRunPanel({
  view, advancing, stopRequested, note, writeBlock, onAdvance, onStop, recheck, onRecheck, artifacts, onArtifacts, getScope, epoch, initialStuck, onStuck,
}) {
  const { run } = view;
  const headingRef = useRef(null);
  const skipFocus = Boolean(view.skipFocus);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!skipFocus) focusAndShow(headingRef.current); }, [run.runId]);

  const status = RUN_STATUSES[run.status] || { label: run.status, tone: 'gray' };
  const advanceLabel = ADVANCE_LABELS[run.status];
  const production = run.destinationEnvironment === 'production';
  const attention = run.status === 'needs_attention';
  const stepName = stepLabel(run.currentStep);
  const advanceDisabled = Boolean(writeBlock) || advancing;
  const buttonText = (() => {
    if (advancing) return 'Running…';
    if (attention) return `Retry step: ${stepName}`;
    return `${advanceLabel} ${production ? 'production' : 'sandbox'} run`;
  })();
  const stepAt = Number.isInteger(run.stepIndex) ? run.stepIndex : 0;
  const progressLine = advancing
    ? `${stepAt > 0 ? `Finished: ${BASIC_STEPS[stepAt - 1]?.label || ''}. ` : ''}Working on: ${stepName}.`
    : '';
  const advisory = production ? recheckAdvisory(view.foundationCapturedAt) : null;
  const attentionNote = note && note.kind === 'attention' ? note : null;
  const otherNote = note && note.kind !== 'attention' ? note : null;
  const resourceCount = view.resources?.length ?? 0;
  const recordedReason = run.needsAttentionReason || run.lastError || '';

  return (
    <section aria-labelledby="factory-run-heading" className="space-y-6 border-t border-gray-300 pt-7">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 id="factory-run-heading" ref={headingRef} tabIndex={-1} className="break-words text-xl font-semibold tracking-tight text-gray-950 focus:outline-none">{run.testLabel}</h3>
          <p className="mt-1 text-sm leading-6 text-gray-600">
            Source Request {run.sourceRequestNumber}
            {run.destinationRequestNumber ? ` · Test Request ${run.destinationRequestNumber}` : ' · Test Request not created yet'}
            {` · ${envName(run)} run`}
          </p>
          {run.status === 'ready' && production && run.destinationRequestId ? (
            <p className="mt-1 text-sm">
              <Link href={`/workbench/${run.destinationRequestId}`} className="font-semibold text-gray-900 underline underline-offset-2">Open in the Workbench</Link>
            </p>
          ) : null}
        </div>
        <span className="shrink-0">
          {advancing ? <StatusChip tone="blue">In progress</StatusChip> : <StatusChip tone={status.tone}>{status.label}</StatusChip>}
        </span>
      </div>

      {view.state === 'error' ? <div role="alert" className={ERROR_BAND}>{view.text}</div> : null}

      {run.status === 'retiring' || run.status === 'retired' ? (
        <p className="text-sm leading-6 text-gray-700">This run is {status.label.toLowerCase()}, so its steps are not shown.</p>
      ) : (
        <ProgressList run={run} advancing={advancing} />
      )}

      <div role="status" aria-live="polite" className="text-sm text-gray-700">{progressLine}</div>
      {advancing ? <p className="text-sm text-gray-600">This can take a few minutes. Leave this page open.</p> : null}

      {attention ? (
        <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
          <p className="font-semibold">Stopped at &quot;{stepName}&quot;.</p>
          <p className="mt-1">{attentionCopyFor(run.needsAttentionReason)}</p>
          {attentionNote?.detail || recordedReason ? (
            <details className="mt-1">
              <summary className={SUMMARY_CLASS}>Technical detail</summary>
              {attentionNote?.detail
                ? <p className="mb-1 break-words font-mono text-xs">{attentionNote.detail}</p>
                : <p className="mb-1 break-words text-xs">Recorded reason: <code className="font-mono">{recordedReason}</code></p>}
            </details>
          ) : null}
        </div>
      ) : null}
      {otherNote ? (
        <div role={otherNote.tone === 'red' ? 'alert' : 'status'} className={otherNote.tone === 'red' ? ERROR_BAND : `rounded-lg border px-4 py-3 text-sm ${NOTE_CLASSES[otherNote.tone] || NOTE_CLASSES.gray}`}>
          <p className="font-semibold">{otherNote.text}</p>
          {otherNote.detail ? <p className="mt-1 break-words">{otherNote.detail}</p> : null}
        </div>
      ) : null}

      {advanceLabel ? (
        <div className="space-y-2">
          <p className="text-sm leading-6 text-gray-700">
            {run.status === 'prepared'
              ? `Writes to ${envName(run)} Dataverse and SharePoint: creates the test Request, sets its meeting date, makes its document folder and copies its documents.`
              : `The remaining steps write to ${envName(run)} Dataverse and SharePoint.`}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button type="button" disabled={advanceDisabled} aria-describedby="factory-advance-reason" onClick={onAdvance} {...buttonProps(!attention)}>
              {buttonText}
            </button>
            {advancing ? (
              <button type="button" {...buttonProps(false)} disabled={stopRequested} onClick={onStop}>
                {stopRequested ? 'Stopping after this step…' : 'Stop after this step'}
              </button>
            ) : null}
            {writeBlock ? <p id="factory-advance-reason" className="text-sm leading-6 text-gray-600">{writeBlock}</p> : <span id="factory-advance-reason" />}
          </div>
        </div>
      ) : null}

      <details className="rounded-xl border border-gray-200 bg-white px-4" open={attention}>
        <summary className={SUMMARY_CLASS}>Recorded steps ({resourceCount})</summary>
        <div className={`mb-4 ${TABLE_WRAP}`}>
          <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
            <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-600">
              <tr>
                <th scope="col" className={TH}>Step</th>
                <th scope="col" className={TH}>What</th>
                <th scope="col" className={TH}>Result</th>
                <th scope="col" className={TH}>Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {view.resources?.length ? view.resources.map((resource) => {
                const code = errorCodeOf(resource.error);
                return (
                  <tr key={resource.resourceId || `${resource.step}-${resource.sequence}`}>
                    <td className="px-4 py-3">{stepLabel(resource.step)}</td>
                    <td className="px-4 py-3">{labelFor(RESOURCE_KIND_LABELS, resource.resourceKind)}</td>
                    <td className="px-4 py-3">{resource.outcome ? labelFor(RESOURCE_OUTCOME_LABELS, resource.outcome) : 'Pending'}</td>
                    <td className="px-4 py-3 text-gray-600">{code ? <>Error <code className="font-mono text-xs">{code}</code></> : 'None'}</td>
                  </tr>
                );
              }) : (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-600">{view.resources ? 'No steps recorded yet.' : 'Loading resources…'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </details>

      <details className="rounded-xl border border-gray-200 bg-white px-4">
        <summary className={SUMMARY_CLASS}>Run tools</summary>
        <div className="flex flex-col gap-5 pb-4">
          {production ? (
            <div className="space-y-2">
              <button type="button" {...buttonProps(false)} disabled={recheck.busy} onClick={onRecheck}>
                {recheck.busy ? 'Rechecking…' : 'Recheck the Foundation record'}
              </button>
              <p className="text-sm leading-6 text-gray-600">
                Checks that creating the test Request did not change the Foundation&apos;s own account record. It is useful about an hour after the run started.
              </p>
              {advisory ? <p className="text-sm leading-6 text-gray-600">{advisory}</p> : null}
              {recheck.error ? <div role="alert" className={ERROR_BAND}>{recheck.error}</div> : null}
              {recheck.result ? (
                <div role="status" className={`rounded-lg border px-4 py-3 text-sm ${recheck.result.ok ? NOTE_CLASSES.green : NOTE_CLASSES.amber}`}>
                  <p className="font-semibold">{recheck.result.ok ? 'The Foundation records are as expected.' : 'The Foundation records need a look.'}</p>
                  {recheck.result.failures?.length ? (
                    <ul className="mt-1 list-disc pl-5">{recheck.result.failures.map((failure) => <li key={String(failure)}>{String(failure)}</li>)}</ul>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-2">
            <button type="button" {...buttonProps(false)} disabled={artifacts.busy} onClick={onArtifacts}>
              {artifacts.busy ? 'Preparing files…' : 'Download run files'}
            </button>
            {artifacts.error ? <div role="alert" className={ERROR_BAND}>{artifacts.error}</div> : null}
            {artifacts.note ? <p role="status" className="text-sm leading-6 text-gray-700">{artifacts.note}</p> : null}
          </div>
        </div>
      </details>

      {run.status === 'ready' && production ? (
        <section aria-labelledby="factory-status-heading" className="space-y-3 border-t border-gray-200 pt-5">
          <h4 id="factory-status-heading" className="text-base font-semibold text-gray-950">Phase I and Phase II status</h4>
          <TestRequestStatusControl key={`${run.runId}:${epoch}`} run={run} writeBlock={writeBlock} getScope={getScope} initialStuck={initialStuck} onStuck={onStuck} />
        </section>
      ) : null}
      {run.status === 'ready' && !production ? (
        <p className="border-t border-gray-200 pt-5 text-sm leading-6 text-gray-700">Status changes are available only for production test Requests.</p>
      ) : null}
    </section>
  );
}
