import { useCallback, useEffect, useRef, useState } from 'react';
import { requestJson } from '../../utils/api-request';
import { CHANGE_STATUSES, OPEN_CHANGE_STATUSES, STATUS_FIELDS } from '../../config/testRequestFactory';
import { StatusChip } from './AdminWorkspaceNavigation';
import { codeOf, messageFor } from './test-request-factory-copy';
import {
  ERROR_BAND, INPUT, OUTLINE_BUTTON, PRIMARY_BUTTON, TABLE_WRAP, TH, formatTime,
} from './test-request-factory-ui';

const FORM_OFF_REASON = 'Creating test Requests is switched off on this deployment.';
const RISK_SENTENCE = 'This changes a real status on the test Request and can send emails or create payment and tracking rows.';
const RELOAD_CODES = new Set(['status_change_concurrent', 'status_change_open']);

const fieldByColumn = (column) => STATUS_FIELDS.find((field) => field.column === column) || null;
const labelOf = (options, value) => {
  if (value == null) return 'Not set';
  return options?.find((option) => option.value === value)?.label ?? String(value);
};

function Reason({ id, children }) {
  return <p id={id} className="text-sm leading-6 text-gray-600">{children}</p>;
}

/**
 * Phase I / Phase II status control for a ready production run (the server's
 * own predicate; the caller renders this only then). One status change is sent
 * once; "Check again" repeats the SAME change and never starts another; an
 * "in progress" answer offers no retry at all; no rerun control exists.
 * `getScope()` returns the section's current { signal, isCurrent() }: every
 * await below checks it, and the component's own mounted flag, before it
 * touches state.
 */
export default function TestRequestStatusControl({ run, formEnabled, getScope }) {
  const [load, setLoad] = useState({ state: 'loading', data: null });
  const [fieldKey, setFieldKey] = useState('phase2');
  const [optionValue, setOptionValue] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [lastBody, setLastBody] = useState(null);
  const [stuck, setStuck] = useState(null);
  const [recheck, setRecheck] = useState(null);
  const [copied, setCopied] = useState('');
  const mountedRef = useRef(true);
  const base = `/api/admin/test-requests/runs/${run.runId}/status`;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const liveScope = () => {
    const scope = getScope();
    return { signal: scope.signal, alive: () => mountedRef.current && scope.isCurrent() };
  };

  const loadJournal = useCallback(async (scope) => {
    try {
      const data = await requestJson(base, { signal: scope.signal, fallbackMessage: 'The status could not be loaded.' });
      if (!scope.alive()) return;
      setLoad({ state: 'ready', data });
    } catch (error) {
      if (!scope.alive() || error?.name === 'AbortError') return;
      setLoad({ state: 'error', data: null, text: messageFor(error) });
    }
  }, [base]);

  useEffect(() => {
    loadJournal(liveScope());
    // Loaded once per mounted control (the section keys it by run id).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadJournal]);

  const data = load.data;
  const changes = data?.changes || [];
  const open = changes.find((change) => OPEN_CHANGE_STATUSES.includes(change.status)) || null;
  const openField = open ? fieldByColumn(open.field) : null;
  const effectiveKey = openField ? openField.key : fieldKey;
  const options = (data?.options?.[effectiveKey] || []).filter((option) => option.label);
  const current = data?.current?.[effectiveKey] ?? null;
  const openLabel = open && openField ? labelOf(data?.options?.[openField.key], open.optionAfter) : null;
  const selectedValue = open ? String(open.optionAfter) : optionValue;
  const selected = options.find((option) => String(option.value) === selectedValue) || null;
  const fieldLabel = STATUS_FIELDS.find((field) => field.key === effectiveKey).label;
  const stuckHere = Boolean(open && stuck && stuck.changeId === open.changeId);
  const checkBody = open
    ? (lastBody || (openField && openLabel ? { field: openField.key, optionLabel: openLabel } : null))
    : null;

  async function send(body) {
    const scope = liveScope();
    setBusy(true);
    setResult(null);
    setConfirming(false);
    try {
      const reply = await requestJson(base, { method: 'POST', body, signal: scope.signal, fallbackMessage: 'The status change could not be sent.' });
      if (!scope.alive()) return;
      if (reply.outcome === 'complete') {
        setLastBody(null);
        setResult({
          tone: 'green',
          text: `Status changed. Emails: ${reply.emails}, tracking rows: ${reply.tracking}, payments: ${reply.payments}, background jobs: ${reply.jobs}.`,
        });
      } else if (reply.outcome === 'in_progress') {
        setLastBody(null);
        setStuck({ changeId: reply.changeId, message: reply.message, abandonCommand: reply.abandonCommand || '' });
      } else {
        // jobs_open and unconfirmed: the same body is what "Check again" repeats.
        setLastBody(body);
        setResult({ tone: 'amber', text: reply.message });
      }
      if (reply.outcome !== 'in_progress') await loadJournal(scope);
    } catch (error) {
      if (!scope.alive() || error?.name === 'AbortError') return;
      setResult({ tone: 'red', text: messageFor(error) });
      if (RELOAD_CODES.has(codeOf(error))) await loadJournal(scope);
    } finally {
      if (scope.alive()) setBusy(false);
    }
  }

  async function recheckEffects() {
    const scope = liveScope();
    setBusy(true);
    setRecheck(null);
    try {
      const reply = await requestJson(`${base}/recheck`, { method: 'POST', signal: scope.signal, fallbackMessage: 'The status effects could not be rechecked.' });
      if (!scope.alive()) return;
      setRecheck({ reply });
      await loadJournal(scope);
    } catch (error) {
      if (!scope.alive() || error?.name === 'AbortError') return;
      setRecheck({ error: messageFor(error) });
    } finally {
      if (scope.alive()) setBusy(false);
    }
  }

  async function copyCommand(text) {
    try {
      await navigator.clipboard.writeText(text);
      if (mountedRef.current) setCopied('Copied.');
    } catch {
      if (mountedRef.current) setCopied('Copy failed. Select the command and copy it by hand.');
    }
  }

  if (load.state === 'loading') return <p className="text-sm text-gray-600" role="status">Loading the Request's status…</p>;
  if (load.state === 'error') {
    return (
      <div className="space-y-3">
        <div role="alert" className={ERROR_BAND}>{load.text}</div>
        <button type="button" className={OUTLINE_BUTTON} onClick={() => { setLoad({ state: 'loading', data: null }); loadJournal(liveScope()); }}>Try again</button>
      </div>
    );
  }

  const setReason = (() => {
    if (!formEnabled) return FORM_OFF_REASON;
    if (busy) return 'Waiting for the last request to finish.';
    if (!selected) return 'Choose the status to set.';
    return '';
  })();
  const checkReason = (() => {
    if (!formEnabled) return FORM_OFF_REASON;
    if (busy) return 'Waiting for the last request to finish.';
    if (!checkBody) return "The open change's status label is no longer in the list, so it can't be checked from here. Ask the owner.";
    return '';
  })();
  const lastSent = changes.filter((change) => change.dispatchedAt).length;
  const recheckReason = (() => {
    if (!formEnabled) return FORM_OFF_REASON;
    if (busy) return 'Waiting for the last request to finish.';
    if (!lastSent) return 'No status change has been sent yet, so there is nothing to recheck.';
    return '';
  })();

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label htmlFor="factory-status-field" className="block text-sm font-semibold text-gray-800">
          Status field
          <select
            id="factory-status-field"
            value={effectiveKey}
            disabled={Boolean(open) || busy}
            onChange={(event) => { setFieldKey(event.target.value); setOptionValue(''); setConfirming(false); }}
            className={INPUT}
          >
            {STATUS_FIELDS.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
          </select>
        </label>
        <label htmlFor="factory-status-option" className="block text-sm font-semibold text-gray-800">
          New status
          <select
            id="factory-status-option"
            value={selectedValue}
            disabled={Boolean(open) || busy}
            onChange={(event) => { setOptionValue(event.target.value); setConfirming(false); }}
            className={INPUT}
          >
            <option value="">{open ? '' : 'Choose a status'}</option>
            {options.map((option) => {
              const already = option.value === current;
              return (
                <option key={option.value} value={String(option.value)} disabled={already}>
                  {already ? `${option.label} (already set)` : option.label}
                </option>
              );
            })}
          </select>
        </label>
      </div>
      <p className="text-sm text-gray-600">
        {fieldLabel} now: <span className="font-semibold text-gray-950">{labelOf(data?.options?.[effectiveKey], current)}</span>
      </p>

      {open ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm leading-6 text-amber-950">
          <p className="font-semibold">A status change is still open.</p>
          <p className="mt-1">
            Change {open.sequence} ({fieldLabel}: {labelOf(data?.options?.[effectiveKey], open.optionBefore)} to {openLabel}) is{' '}
            {CHANGE_STATUSES[open.status]?.label?.toLowerCase() || open.status}. Until it settles, only that change can be checked; no different change can be started.
          </p>
        </div>
      ) : null}

      {stuck ? (
        <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm leading-6 text-amber-950">
          <p className="font-semibold">{stuck.message}</p>
          {stuck.abandonCommand ? (
            <div className="mt-3">
              <label htmlFor="factory-abandon-command" className="block font-semibold">Owner command to close it (run only after confirming no sender is still running)</label>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <input id="factory-abandon-command" readOnly value={stuck.abandonCommand} className="min-h-11 flex-1 rounded-lg border border-amber-300 bg-white px-3 py-2 font-mono text-xs text-gray-950" />
                <button type="button" className={OUTLINE_BUTTON} onClick={() => copyCommand(stuck.abandonCommand)}>Copy command</button>
              </div>
              {copied ? <p className="mt-2" role="status">{copied}</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {result ? (
        <div
          role={result.tone === 'red' ? 'alert' : 'status'}
          className={result.tone === 'red' ? ERROR_BAND : `rounded-lg border px-4 py-3 text-sm ${result.tone === 'green' ? 'border-green-200 bg-green-50 text-green-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}
        >
          {result.text}
        </div>
      ) : null}

      {!open ? (
        <div className="space-y-3">
          {confirming && selected ? (
            <div role="group" aria-label="Confirm the status change" className="rounded-xl border border-gray-300 bg-gray-50 px-4 py-4 text-sm leading-6 text-gray-900">
              <p className="font-semibold">
                Change Request {run.destinationRequestNumber || run.runId}: {fieldLabel} from {labelOf(data?.options?.[effectiveKey], current)} to {selected.label}?
              </p>
              <p className="mt-1">{RISK_SENTENCE}</p>
              <div className="mt-3 flex flex-wrap gap-3">
                <button type="button" className={PRIMARY_BUTTON} disabled={Boolean(setReason)} onClick={() => send({ field: effectiveKey, optionLabel: selected.label })}>
                  Yes, set this status
                </button>
                <button type="button" className={OUTLINE_BUTTON} onClick={() => setConfirming(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <button type="button" className={PRIMARY_BUTTON} disabled={Boolean(setReason)} aria-describedby="factory-set-reason" onClick={() => setConfirming(true)}>
                Set status
              </button>
              {setReason ? <Reason id="factory-set-reason">{setReason}</Reason> : null}
            </div>
          )}
        </div>
      ) : null}

      {open && !stuckHere ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <button type="button" className={PRIMARY_BUTTON} disabled={Boolean(checkReason)} aria-describedby="factory-check-reason" onClick={() => send(checkBody)}>
            Check again
          </button>
          {checkReason ? <Reason id="factory-check-reason">{checkReason}</Reason> : null}
        </div>
      ) : null}

      <section aria-labelledby="factory-status-journal-heading" className="border-t border-gray-200 pt-5">
        <h4 id="factory-status-journal-heading" className="text-sm font-semibold text-gray-950">Status change journal</h4>
        <div className={`mt-3 ${TABLE_WRAP}`}>
          <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
            <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-600">
              <tr>
                <th scope="col" className={TH}>No.</th>
                <th scope="col" className={TH}>Field</th>
                <th scope="col" className={TH}>Change</th>
                <th scope="col" className={TH}>Status</th>
                <th scope="col" className={TH}>Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {changes.length ? changes.map((change) => {
                const field = fieldByColumn(change.field);
                const list = field ? data?.options?.[field.key] : null;
                const known = CHANGE_STATUSES[change.status];
                return (
                  <tr key={change.changeId}>
                    <td className="px-4 py-3 tabular-nums">{change.sequence}</td>
                    <td className="px-4 py-3">{field?.label || change.field}</td>
                    <td className="px-4 py-3">{labelOf(list, change.optionBefore)} to {labelOf(list, change.optionAfter)}</td>
                    <td className="px-4 py-3"><StatusChip tone={known?.tone || 'gray'}>{known?.label || change.status}</StatusChip></td>
                    <td className="px-4 py-3 text-gray-600">{formatTime(change.completedAt || change.dispatchedAt || change.createdAt)}</td>
                  </tr>
                );
              }) : (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-600">No status change has been made on this Request.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <button type="button" className={OUTLINE_BUTTON} disabled={Boolean(recheckReason)} aria-describedby="factory-recheck-reason" onClick={recheckEffects}>
            Recheck status effects
          </button>
          {recheckReason ? <Reason id="factory-recheck-reason">{recheckReason}</Reason> : null}
        </div>
        {recheck?.error ? <div role="alert" className={ERROR_BAND}>{recheck.error}</div> : null}
        {recheck?.reply ? (
          <div role="status" className={`rounded-lg border px-4 py-3 text-sm ${recheck.reply.ok ? 'border-green-200 bg-green-50 text-green-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
            {recheck.reply.ok
              ? 'No late effects, and no open or failed background jobs.'
              : `Late emails: ${recheck.reply.lateEffects?.emails ?? 0}, tracking rows: ${recheck.reply.lateEffects?.tracking ?? 0}, payments: ${recheck.reply.lateEffects?.payments ?? 0}. Open jobs: ${recheck.reply.openJobs}, failed jobs: ${recheck.reply.failedJobs}.`}
          </div>
        ) : null}
      </div>
    </div>
  );
}
