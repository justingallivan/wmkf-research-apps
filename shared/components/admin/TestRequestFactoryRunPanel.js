import { ADVANCE_LABELS, BASIC_STEPS, RUN_STATUSES } from '../../config/testRequestFactory';
import { StatusChip } from './AdminWorkspaceNavigation';
import TestRequestStatusControl from './TestRequestStatusControl';
import {
  ERROR_BAND, OUTLINE_BUTTON, PRIMARY_BUTTON, TABLE_WRAP, TH, formatTime,
} from './test-request-factory-ui';

const HOUR_MS = 3_600_000;
const stepLabel = (key) => BASIC_STEPS.find((step) => step.key === key)?.label || key;
const errorCodeOf = (error) => (error && typeof error === 'object' ? error.code : error) || '';

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
        const tone = { Done: 'green', 'Needs attention': 'amber', 'In progress': 'amber' }[state] || 'gray';
        return (
          <li key={step.key} className="flex items-center justify-between gap-4 px-4 py-3 text-sm" aria-current={state === 'In progress' || state === 'Up next' ? 'step' : undefined}>
            <span className="text-gray-950">{index + 1}. {step.label}</span>
            <StatusChip tone={tone}>{state}</StatusChip>
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

/**
 * The selected run: status, progress, the one advance action, then the
 * read-only tools (resources, Foundation recheck, run files) and, for a ready
 * production run, the status control. Presentational: the section owns every
 * request and the stale guard.
 */
export default function TestRequestFactoryRunPanel({
  view, advancing, stopRequested, note, writeBlock, onAdvance, onStop, recheck, onRecheck, artifacts, onArtifacts, getScope, epoch,
}) {
  const { run } = view;
  const status = RUN_STATUSES[run.status] || { label: run.status, tone: 'gray' };
  const advanceLabel = ADVANCE_LABELS[run.status];
  const production = run.destinationEnvironment === 'production';
  const capturedAt = view.foundationCapturedAt ? Date.parse(view.foundationCapturedAt) : NaN;
  const advanceDisabled = Boolean(writeBlock) || advancing;
  const stepName = stepLabel(run.currentStep);

  return (
    <section aria-labelledby="factory-run-heading" className="space-y-6 border-t border-gray-300 pt-7">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 id="factory-run-heading" className="text-xl font-semibold tracking-tight text-gray-950">{run.testLabel}</h3>
          <p className="mt-1 text-sm leading-6 text-gray-600">
            Source Request {run.sourceRequestNumber}
            {run.destinationRequestNumber ? ` · Test Request ${run.destinationRequestNumber}` : ' · Test Request not created yet'}
            {` · ${run.destinationEnvironment === 'production' ? 'Production' : 'Sandbox'} run`}
          </p>
        </div>
        <StatusChip tone={status.tone}>{status.label}</StatusChip>
      </div>

      {view.state === 'error' ? <div role="alert" className={ERROR_BAND}>{view.text}</div> : null}

      {run.status === 'retiring' || run.status === 'retired' ? (
        <p className="text-sm leading-6 text-gray-700">This run is {status.label.toLowerCase()}, so its steps are not shown.</p>
      ) : (
        <ProgressList run={run} advancing={advancing} />
      )}

      {advancing ? (
        <p role="status" className="text-sm text-gray-700">Working on: {stepName}. This can take a few minutes. Leave this page open.</p>
      ) : null}
      {note ? (
        <div role={note.tone === 'red' ? 'alert' : 'status'} className={note.tone === 'red' ? ERROR_BAND : `rounded-lg border px-4 py-3 text-sm ${NOTE_CLASSES[note.tone] || NOTE_CLASSES.gray}`}>
          <p className="font-semibold">{note.text}</p>
          {note.detail ? <p className="mt-1 break-words">{note.detail}</p> : null}
        </div>
      ) : null}

      {advanceLabel ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <button type="button" className={PRIMARY_BUTTON} disabled={advanceDisabled} aria-describedby="factory-advance-reason" onClick={onAdvance}>
            {advancing ? 'Running…' : advanceLabel}
          </button>
          {advancing ? (
            <button type="button" className={OUTLINE_BUTTON} disabled={stopRequested} onClick={onStop}>
              {stopRequested ? 'Stopping after this step…' : 'Stop after this step'}
            </button>
          ) : null}
          {writeBlock ? <p id="factory-advance-reason" className="text-sm leading-6 text-gray-600">{writeBlock}</p> : <span id="factory-advance-reason" />}
        </div>
      ) : null}

      <section aria-labelledby="factory-resources-heading" className="space-y-3">
        <h4 id="factory-resources-heading" className="text-sm font-semibold text-gray-950">Recorded resources</h4>
        <div className={TABLE_WRAP}>
          <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
            <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-600">
              <tr>
                <th scope="col" className={TH}>Step</th>
                <th scope="col" className={TH}>Kind</th>
                <th scope="col" className={TH}>Outcome</th>
                <th scope="col" className={TH}>Error code</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {view.resources?.length ? view.resources.map((resource) => (
                <tr key={resource.resourceId || `${resource.step}-${resource.sequence}`}>
                  <td className="px-4 py-3">{stepLabel(resource.step)}</td>
                  <td className="px-4 py-3">{resource.resourceKind}</td>
                  <td className="px-4 py-3">{resource.outcome || 'Pending'}</td>
                  <td className="px-4 py-3 text-gray-600">{errorCodeOf(resource.error) || 'None'}</td>
                </tr>
              )) : (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-600">{view.resources ? 'No resources recorded yet.' : 'Loading resources…'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="flex flex-col gap-4 border-t border-gray-200 pt-5">
        {production ? (
          <div className="space-y-2">
            <button type="button" className={OUTLINE_BUTTON} disabled={recheck.busy} onClick={onRecheck}>
              {recheck.busy ? 'Rechecking…' : 'Recheck Foundation'}
            </button>
            {Number.isNaN(capturedAt) ? null : (
              <p className="text-sm leading-6 text-gray-600">A recheck is meaningful after {formatTime(capturedAt + HOUR_MS)}.</p>
            )}
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
          <button type="button" className={OUTLINE_BUTTON} disabled={artifacts.busy} onClick={onArtifacts}>
            {artifacts.busy ? 'Preparing files…' : 'Download run files'}
          </button>
          {artifacts.error ? <div role="alert" className={ERROR_BAND}>{artifacts.error}</div> : null}
          {artifacts.note ? <p role="status" className="text-sm leading-6 text-gray-700">{artifacts.note}</p> : null}
        </div>
      </div>

      {run.status === 'ready' && production ? (
        <section aria-labelledby="factory-status-heading" className="space-y-3 border-t border-gray-200 pt-5">
          <h4 id="factory-status-heading" className="text-base font-semibold text-gray-950">Phase I and Phase II status</h4>
          <TestRequestStatusControl key={`${run.runId}:${epoch}`} run={run} writeBlock={writeBlock} getScope={getScope} />
        </section>
      ) : null}
    </section>
  );
}
