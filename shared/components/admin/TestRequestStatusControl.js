import { useCallback, useEffect, useRef, useState } from 'react';
import { requestJson } from '../../utils/api-request';
import { CHANGE_STATUSES, OPEN_CHANGE_STATUSES, STATUS_FIELDS } from '../../config/testRequestFactory';
import { StatusChip } from './AdminWorkspaceNavigation';
import { codeOf, messageFor } from './test-request-factory-copy';
import {
  ERROR_BAND, INPUT, SUMMARY_CLASS, TABLE_WRAP, TH, buttonProps, focusAndShow, formatTime,
} from './test-request-factory-ui';

const RISK_SENTENCE = 'It changes a real status on the test Request.';
const EFFECT_PHRASES = { emails: 'send emails', tracking: 'create a status-tracking row', payments: 'create a payment row' };
const RECHECK_STATUS_COPY = Object.freeze({
  dispatched: 'The status change is still marked as sent, and its result is not confirmed. Rechecking does not settle it or prove sending has stopped.',
  applied: 'The status change is applied but not complete. Rechecking does not change its status.',
  complete: 'The saved status change is complete. This recheck can record newly observed late effects in its history.',
  needs_attention: 'The saved status change needs attention. This recheck can record newly observed late effects in its history.',
});
// What the planner expects a change to do: null effects (unknown) says only that it may do any of these.
const effectsSentence = (effects) => {
  if (!Array.isArray(effects)) return 'It may send emails or create payment and tracking rows.';
  if (!effects.length) return 'No emails, payments or tracking rows are expected from this change.';
  return `This change may: ${effects.map((effect) => EFFECT_PHRASES[effect] || effect).join('; ')}.`;
};
// The server's own verdict for each option (`blocked`, from the status GET), in the owner's voice.
const BLOCKED_COPY = {
  status_change_noop: 'That status is already set. Choose a different one.',
  status_change_edge: "This change can create a payment or a status-tracking row, and it isn't allowed from the Request's current Phase I and Phase II statuses.",
  status_change_replay: "An earlier change to this status created, or may have created, a payment or status-tracking row. Repeating it needs the command-line tool; it can't be done from this form.",
  default: "This status isn't one the form can set.",
};
const RELOAD_CODES = new Set(['status_change_concurrent', 'status_change_open']);

const fieldByColumn = (column) => STATUS_FIELDS.find((field) => field.column === column) || null;
// Display only: never a bare number for a value the list no longer has.
// A before/after pair is joined with an arrow, never "to": "Not set to X" reads as "was not set to X".
const labelOf = (options, value) => {
  if (value == null) return 'Not set';
  return options?.find((option) => option.value === value)?.label ?? `${value} (no longer in the list)`;
};

/**
 * The body "Check again" may send, built only from the journal's open change:
 * exactly one option carries its target value and a non-empty label, and no
 * other option in that list shares the label (case-insensitive). Else null.
 */
function strictCheckBody(data, change) {
  const field = change ? fieldByColumn(change.field) : null;
  if (!field) return null;
  const list = data?.options?.[field.key] || [];
  const matches = list.filter((option) => option.value === change.optionAfter && typeof option.label === 'string' && option.label.trim());
  if (matches.length !== 1) return null;
  const label = matches[0].label;
  if (list.some((option) => option !== matches[0] && typeof option.label === 'string' && option.label.toLowerCase() === label.toLowerCase())) return null;
  return { field: field.key, optionLabel: label };
}

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
export default function TestRequestStatusControl({ run, writeBlock, getScope, initialStuck = null, onStuck }) {
  const [load, setLoad] = useState({ state: 'loading', data: null });
  const [fieldKey, setFieldKey] = useState('');
  const [optionValue, setOptionValue] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [stuck, setStuck] = useState(initialStuck);
  const stuckRef = useRef(initialStuck);
  const [recheck, setRecheck] = useState(null);
  const [copied, setCopied] = useState('');
  const mountedRef = useRef(true);
  const questionRef = useRef(null);
  const resultRef = useRef(null);
  const checkButtonRef = useRef(null);
  // After an action whose button unmounts: 'result' (the result band) or 'check' (the "Check again" button).
  const pendingFocusRef = useRef(null);
  const setButtonRef = useRef(null);
  const returnFocusRef = useRef(false);
  const base = `/api/admin/test-requests/runs/${run.runId}/status`;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const liveScope = () => {
    const scope = getScope();
    return { signal: scope.signal, alive: () => mountedRef.current && scope.isCurrent() };
  };

  useEffect(() => {
    const target = pendingFocusRef.current;
    if (!target) return;
    const element = target === 'check' ? checkButtonRef.current : resultRef.current;
    if (element) {
      pendingFocusRef.current = null;
      element.focus();
    }
  });

  // Focus the confirmation question when it opens; Cancel returns focus to "Set status".
  useEffect(() => {
    if (confirming) focusAndShow(questionRef.current);
    else if (returnFocusRef.current) {
      returnFocusRef.current = false;
      setButtonRef.current?.focus();
    }
  }, [confirming]);

  const loadJournal = useCallback(async (scope) => {
    try {
      const data = await requestJson(base, { signal: scope.signal, fallbackMessage: 'The status could not be loaded.' });
      if (!scope.alive()) return null;
      setLoad({ state: 'ready', data });
      const latestDispatched = (data.changes || []).filter((change) => change.dispatchedAt).at(-1);
      setRecheck((current) => (current?.reply && (
        current.changeId !== latestDispatched?.changeId
        || current.reply.sequence !== latestDispatched?.sequence
        || current.reply.status !== latestDispatched?.status
      ) ? null : current));
      // The no-retry record ends only when its change is no longer the open one.
      const held = stuckRef.current;
      if (held && !(data.changes || []).some((change) => change.changeId === held.changeId && OPEN_CHANGE_STATUSES.includes(change.status))) {
        stuckRef.current = null;
        setStuck(null);
        onStuck?.(null);
      }
      return data;
    } catch (error) {
      if (!scope.alive() || error?.name === 'AbortError') return null;
      setLoad({ state: 'error', data: null, text: messageFor(error) });
      setRecheck(null);
      return null;
    }
  }, [base]);

  useEffect(() => {
    loadJournal(liveScope());
    // Loaded once per mounted control (the section keys it by run id).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadJournal]);

  const data = load.data;
  const changes = data?.changes || [];
  const latestDispatchedChange = changes.filter((change) => change.dispatchedAt).at(-1);
  const displayedRecheck = recheck?.reply && (
    recheck.changeId !== latestDispatchedChange?.changeId
    || recheck.reply.sequence !== latestDispatchedChange?.sequence
    || recheck.reply.status !== latestDispatchedChange?.status
  ) ? null : recheck;
  const open = changes.find((change) => OPEN_CHANGE_STATUSES.includes(change.status)) || null;
  const openField = open ? fieldByColumn(open.field) : null;
  const effectiveKey = openField ? openField.key : fieldKey;
  const options = (data?.options?.[effectiveKey] || []).filter((option) => option.label);
  const current = data?.current?.[effectiveKey] ?? null;
  const openLabel = open && openField ? labelOf(data?.options?.[openField.key], open.optionAfter) : null;
  const selectedValue = open ? String(open.optionAfter) : optionValue;
  const selected = options.find((option) => String(option.value) === selectedValue) || null;
  const fieldLabel = STATUS_FIELDS.find((field) => field.key === effectiveKey)?.label || '';
  const requestName = run.destinationRequestNumber ? `Request ${run.destinationRequestNumber}` : 'this test Request';
  // The in-progress banner and the missing retry belong to the change that is still open, no other.
  const stuckHere = Boolean(open && stuck && stuck.changeId === open.changeId);
  const checkBody = open ? strictCheckBody(data, open) : null;

  async function send(body) {
    const scope = liveScope();
    setBusy(true);
    setResult(null);
    setRecheck(null);
    setConfirming(false);
    try {
      const reply = await requestJson(base, { method: 'POST', body, signal: scope.signal, fallbackMessage: 'The status change could not be sent.' });
      if (!scope.alive()) return;
      pendingFocusRef.current = reply.outcome === 'jobs_open' || reply.outcome === 'unconfirmed' ? 'check' : 'result';
      if (reply.outcome === 'complete') {
        setResult({
          tone: 'green',
          text: `Status changed. Emails: ${reply.emails}, tracking rows: ${reply.tracking}, payments: ${reply.payments}, background jobs: ${reply.jobs}.`,
        });
      } else if (reply.outcome === 'in_progress') {
        const record = { changeId: reply.changeId, message: reply.message, abandonCommand: reply.abandonCommand || '' };
        stuckRef.current = record;
        setStuck(record);
        onStuck?.(record);
      } else {
        // jobs_open and unconfirmed: "Check again" is built from the journal's open change.
        setResult({ tone: 'amber', text: reply.message });
      }
      // Reload after every answer so the journal shows the change (an in-progress change stays without a retry control).
      await loadJournal(scope);
    } catch (error) {
      if (!scope.alive() || error?.name === 'AbortError') return;
      pendingFocusRef.current = 'result';
      setResult({ tone: 'red', text: messageFor(error) });
      if (RELOAD_CODES.has(codeOf(error))) await loadJournal(scope);
    } finally {
      if (scope.alive()) setBusy(false);
    }
  }

  // Reload first; send only if the SAME change is still open, with the body built from the fresh journal.
  async function checkAgain() {
    const scope = liveScope();
    const changeId = open.changeId;
    setBusy(true);
    setResult(null);
    setRecheck(null);
    const fresh = await loadJournal(scope);
    if (!scope.alive()) return;
    const stillOpen = fresh?.changes?.find((change) => change.changeId === changeId && OPEN_CHANGE_STATUSES.includes(change.status));
    const body = stillOpen ? strictCheckBody(fresh, stillOpen) : null;
    if (!fresh) { setBusy(false); return; }
    if (!body) {
      setResult({
        tone: 'amber',
        text: stillOpen ? "That change's status label is missing or ambiguous in the list, so it can't be checked from here. This needs the command-line tool; it can't be done from this form." : 'That change is no longer open. The status list has been reloaded.',
      });
      setBusy(false);
      return;
    }
    // The change id makes this resume-only on the server: if the change closed after the reload above, nothing new starts.
    await send({ ...body, changeId });
  }

  async function recheckEffects() {
    const scope = liveScope();
    setBusy(true);
    setRecheck(null);
    try {
      const reply = await requestJson(`${base}/recheck`, { method: 'POST', signal: scope.signal, fallbackMessage: 'The status effects could not be rechecked.' });
      if (!scope.alive()) return;
      const fresh = await loadJournal(scope);
      if (!scope.alive()) return;
      const latestDispatched = (fresh?.changes || []).filter((change) => change.dispatchedAt).at(-1);
      if (!latestDispatched || latestDispatched.sequence !== reply.sequence || latestDispatched.status !== reply.status) {
        setRecheck({ error: 'The status list changed during this check. Reload it before relying on these results.' });
        return;
      }
      setRecheck({ reply, changeId: latestDispatched.changeId });
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
        <button type="button" {...buttonProps(false)} onClick={() => { setLoad({ state: 'loading', data: null }); loadJournal(liveScope()); }}>Try again</button>
      </div>
    );
  }

  const setReason = (() => {
    if (writeBlock) return writeBlock;
    if (busy) return 'Waiting for the last request to finish.';
    if (!effectiveKey) return 'Choose the field first.';
    if (!selected) return 'Choose the status to set.';
    // Mirrors the server's no-op refusal: the journal reload after a change makes the chosen option the current one.
    if (selected.value === current) return BLOCKED_COPY.status_change_noop;
    if (selected.blocked) return BLOCKED_COPY[selected.blocked] || BLOCKED_COPY.default;
    return '';
  })();
  // The status already set is not a refusal: the menu marks it "(already set)" and the line below names it,
  // so it stays out of this list. Right after a successful change it would otherwise read as a failure.
  const blockedOptions = options.filter((option) => option.value !== current && option.blocked && option.blocked !== 'status_change_noop');
  const blockedWhy = (option) => BLOCKED_COPY[option.blocked] || BLOCKED_COPY.default;
  const checkReason = (() => {
    if (writeBlock) return writeBlock;
    if (busy) return 'Waiting for the last request to finish.';
    if (!checkBody) return "The open change's status label is missing or ambiguous in the list, so it can't be checked from here. This needs the command-line tool; it can't be done from this form.";
    return '';
  })();
  const lastSent = changes.filter((change) => change.dispatchedAt).length;
  const recheckReason = (() => {
    if (writeBlock) return writeBlock;
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
            <option value="">Choose a field</option>
            {STATUS_FIELDS.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
          </select>
        </label>
        <div>
          <label htmlFor="factory-status-option" className="block text-sm font-semibold text-gray-800">
            New status
            <select
              id="factory-status-option"
              value={selectedValue}
              disabled={Boolean(open) || busy || !effectiveKey}
              aria-describedby="factory-option-reason"
              onChange={(event) => { setOptionValue(event.target.value); setConfirming(false); }}
              className={INPUT}
            >
              <option value="">{open ? '' : 'Choose a status'}</option>
              {options.map((option) => {
                const already = option.value === current;
                const blocked = already || Boolean(option.blocked);
                return (
                  <option key={option.value} value={String(option.value)} disabled={blocked}>
                    {already ? `${option.label} (already set)` : (blocked ? `${option.label} (not available now)` : option.label)}
                  </option>
                );
              })}
            </select>
          </label>
          {!effectiveKey && !open ? <p id="factory-option-reason" className="mt-1 text-sm text-gray-600">Choose the field first.</p> : <span id="factory-option-reason" />}
        </div>
      </div>
      {effectiveKey ? (
        <p className="text-sm text-gray-600">
          {fieldLabel} now: <span className="font-semibold text-gray-950">{labelOf(data?.options?.[effectiveKey], current)}</span>
        </p>
      ) : null}
      {blockedOptions.length ? (
        <details className="text-sm">
          <summary className={SUMMARY_CLASS}>{`Why ${blockedOptions.length} ${blockedOptions.length === 1 ? 'status' : 'statuses'} can't be set now`}</summary>
          <ul className="mb-2 list-disc space-y-1 pl-5 leading-6 text-gray-700">
            {blockedOptions.map((option) => <li key={option.value}><span className="font-semibold text-gray-950">{option.label}</span>: {blockedWhy(option)}</li>)}
          </ul>
        </details>
      ) : null}

      {open ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm leading-6 text-amber-950">
          <p className="font-semibold">A status change is still open.</p>
          <p className="mt-1">
            Change {open.sequence} ({fieldLabel}: {labelOf(data?.options?.[effectiveKey], open.optionBefore)} → {openLabel}) is{' '}
            {CHANGE_STATUSES[open.status]?.label?.toLowerCase() || open.status}. Until it settles, only that change can be checked; no different change can be started.
          </p>
        </div>
      ) : null}

      {stuckHere ? (
        <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm leading-6 text-amber-950">
          <p className="font-semibold">{stuck.message}</p>
          {stuck.abandonCommand ? (
            <div className="mt-3">
              <label htmlFor="factory-abandon-command" className="block font-semibold">Command to close this change. Run it only after making sure nothing is still sending this change: no open form request and no command-line run.</label>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <input id="factory-abandon-command" readOnly value={stuck.abandonCommand} className="min-h-11 flex-1 rounded-lg border border-amber-300 bg-white px-3 py-2 font-mono text-xs text-gray-950" />
                <button type="button" {...buttonProps(false)} onClick={() => copyCommand(stuck.abandonCommand)}>Copy command</button>
              </div>
              {copied ? <p className="mt-2" role="status">{copied}</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {result ? (
        <div
          ref={resultRef}
          tabIndex={-1}
          role={result.tone === 'red' ? 'alert' : 'status'}
          className={`focus:outline-none ${result.tone === 'red' ? ERROR_BAND : `rounded-lg border px-4 py-3 text-sm ${result.tone === 'green' ? 'border-green-200 bg-green-50 text-green-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}`}
        >
          {result.text}
        </div>
      ) : null}

      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <button type="button" {...buttonProps(false)} disabled={Boolean(recheckReason)} aria-describedby="factory-recheck-reason" onClick={recheckEffects}>
            Recheck status effects
          </button>
          {recheckReason ? <Reason id="factory-recheck-reason">{recheckReason}</Reason> : null}
        </div>
        <p className="text-sm leading-6 text-gray-600">
          Recheck reads the Request and its background jobs. It may add newly found late-effect records to the saved history when the change is complete or needs attention. If the change is still marked as sent, this check does not confirm its result or that sending has stopped. Email records do not prove delivery.
        </p>
        {displayedRecheck?.error ? <div role="alert" className={ERROR_BAND}>{displayedRecheck.error}</div> : null}
        {displayedRecheck?.reply ? (
          <div role="status" className={`rounded-lg border px-4 py-3 text-sm ${displayedRecheck.reply.ok && displayedRecheck.reply.status === 'complete' ? 'border-green-200 bg-green-50 text-green-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
            <p>Rechecked change {displayedRecheck.reply.sequence}: {RECHECK_STATUS_COPY[displayedRecheck.reply.status] || 'The stored status is not recognized. This check does not change it.'}</p>
            <p className="mt-1">Records absent from saved history at this check: email {displayedRecheck.reply.lateEffects?.emails ?? 0}; tracking {displayedRecheck.reply.lateEffects?.tracking ?? 0}; payments {displayedRecheck.reply.lateEffects?.payments ?? 0}. Open background jobs: {displayedRecheck.reply.openJobs}; failed background jobs: {displayedRecheck.reply.failedJobs}.</p>
          </div>
        ) : null}
      </div>

      {!open ? (
        <div className="space-y-3">
          {confirming && selected ? (
            <div role="group" aria-label="Confirm the status change" className="rounded-xl border border-gray-300 bg-gray-50 px-4 py-4 text-sm leading-6 text-gray-900">
              <p ref={questionRef} tabIndex={-1} className="font-semibold focus:outline-none">
                Change {requestName}: {fieldLabel} from {labelOf(data?.options?.[effectiveKey], current)} to {selected.label} on Production?
              </p>
              <p className="mt-1">{effectsSentence(selected.effects)} {RISK_SENTENCE}</p>
              <div className="mt-3 flex flex-wrap gap-3">
                <button type="button" {...buttonProps(true)} disabled={Boolean(setReason)} onClick={() => send({ field: effectiveKey, optionLabel: selected.label })}>
                  Yes, set this status
                </button>
                <button type="button" {...buttonProps(false)} onClick={() => { returnFocusRef.current = true; setConfirming(false); }}>Cancel</button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <button ref={setButtonRef} type="button" {...buttonProps(true)} disabled={Boolean(setReason)} aria-describedby="factory-set-reason" onClick={() => setConfirming(true)}>
                Set status
              </button>
              {setReason ? <Reason id="factory-set-reason">{setReason}</Reason> : null}
            </div>
          )}
        </div>
      ) : null}

      {open && !stuckHere ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <button ref={checkButtonRef} type="button" {...buttonProps(true)} disabled={Boolean(checkReason)} aria-describedby="factory-check-reason" onClick={checkAgain}>
            Check again
          </button>
          {checkReason ? <Reason id="factory-check-reason">{checkReason}</Reason> : null}
        </div>
      ) : null}

      <details className="rounded-xl border border-gray-200 bg-white px-4" open={Boolean(open) || stuckHere}>
        <summary className={SUMMARY_CLASS}>Status change history ({changes.length})</summary>
        <div className="space-y-4 pb-4">
          <div className={TABLE_WRAP}>
            <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
              <caption className="sr-only">Status change history</caption>
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
                      <td className="px-4 py-3">{labelOf(list, change.optionBefore)} → {labelOf(list, change.optionAfter)}</td>
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

        </div>
      </details>
    </div>
  );
}
