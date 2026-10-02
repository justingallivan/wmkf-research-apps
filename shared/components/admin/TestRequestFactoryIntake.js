import { useEffect, useRef, useState } from 'react';
import { requestJson } from '../../utils/api-request';
import { LIMITS } from '../../config/testRequestFactory';
import { messageFor } from './test-request-factory-copy';
import {
  ERROR_BAND, INPUT, OUTLINE_BUTTON, PRIMARY_BUTTON, TABLE_WRAP, TH, formatBytes,
} from './test-request-factory-ui';

const NUMBER_PATTERN = /^\d{1,10}$/;
const KEY_UNAVAILABLE = "This browser can't create the safe request key a new Request needs, so nothing was started. Use a current browser and try again.";

function mintKey() {
  const crypto = globalThis.crypto;
  return typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : null;
}

function Reason({ id, children }) {
  return <p id={id} className="text-sm leading-6 text-gray-600">{children}</p>;
}

/**
 * Source lookup and Confirm. The idempotency key is minted when a lookup
 * succeeds and kept in a ref for every Confirm of that draft, including after
 * a failed or lost response; only a new lookup or "Create another" replaces
 * it. It is never derived from the label or the number.
 *
 * `writeBlock` is '' when writes are allowed, else the reason they are not.
 * `onLookupStart` lets the section abort whatever run work is in flight;
 * `onReserved(run)` hands the reserved run back to be selected.
 */
export default function TestRequestFactoryIntake({ writeBlock, onLookupStart, onReserved }) {
  const [sourceNumber, setSourceNumber] = useState('');
  const [looking, setLooking] = useState(false);
  const [lookupError, setLookupError] = useState('');
  const [draft, setDraft] = useState(null);
  const [form, setForm] = useState({ label: '', fiscalYear: '', meetingDate: '', typed: '' });
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState('');
  const [reserved, setReserved] = useState(null);
  const [keyMissing, setKeyMissing] = useState(false);
  const keyRef = useRef(null);
  const lookupControllerRef = useRef(null);
  const lookupSeqRef = useRef(0);
  const confirmingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      lookupControllerRef.current?.abort();
    };
  }, []);

  const trimmedNumber = sourceNumber.trim();
  const lookupReason = (() => {
    if (writeBlock) return writeBlock;
    if (confirming) return 'Waiting for the run to finish reserving.';
    if (!NUMBER_PATTERN.test(trimmedNumber)) return `Enter a Request number of 1 to ${LIMITS.requestNumberMax} digits.`;
    return '';
  })();

  async function lookup(event) {
    event.preventDefault();
    if (lookupReason || looking) return;
    onLookupStart?.();
    lookupSeqRef.current += 1;
    const seq = lookupSeqRef.current;
    lookupControllerRef.current?.abort();
    const controller = new AbortController();
    lookupControllerRef.current = controller;
    // A new lookup discards the previous draft and its key.
    keyRef.current = null;
    setDraft(null);
    setReserved(null);
    setKeyMissing(false);
    setConfirmError('');
    setLookupError('');
    setForm({ label: '', fiscalYear: '', meetingDate: '', typed: '' });
    setLooking(true);
    try {
      const body = await requestJson('/api/admin/test-requests/runs/source', {
        method: 'POST',
        body: { sourceRequestNumber: trimmedNumber },
        signal: controller.signal,
        fallbackMessage: 'The source Request could not be read.',
      });
      if (controller.signal.aborted || seq !== lookupSeqRef.current || !mountedRef.current) return;
      const key = mintKey();
      if (!key) {
        setLookupError(KEY_UNAVAILABLE);
        return;
      }
      keyRef.current = key;
      setDraft(body);
      setForm({
        label: '', fiscalYear: body.defaults?.fiscalYear ?? '', meetingDate: body.defaults?.meetingDate ?? '', typed: '',
      });
    } catch (error) {
      if (controller.signal.aborted || seq !== lookupSeqRef.current || !mountedRef.current || error?.name === 'AbortError') return;
      setLookupError(messageFor(error));
    } finally {
      if (seq === lookupSeqRef.current && mountedRef.current) setLooking(false);
    }
  }

  const summary = draft?.summary || null;
  const label = form.label.trim();
  const confirmReason = (() => {
    if (writeBlock) return writeBlock;
    if (keyMissing) return KEY_UNAVAILABLE;
    if (confirming) return 'Reserving the run…';
    if (!label) return 'Enter a test label.';
    if (label.length > LIMITS.labelMax) return `Keep the test label to ${LIMITS.labelMax} characters or fewer.`;
    if (!form.fiscalYear.trim() || !form.meetingDate.trim()) return 'Enter both the fiscal year and the meeting date.';
    if (summary && form.typed !== summary.requestNumber) return `Type Request number ${summary.requestNumber} exactly to confirm.`;
    return '';
  })();

  async function confirm(event) {
    event.preventDefault();
    if (confirmReason || confirmingRef.current || !draft || !keyRef.current) return;
    confirmingRef.current = true;
    setConfirming(true);
    setConfirmError('');
    try {
      const reply = await requestJson('/api/admin/test-requests/runs', {
        method: 'POST',
        body: {
          draftId: draft.draftId,
          idempotencyKey: keyRef.current, // the same key on every retry of this draft
          confirmSourceRequestNumber: form.typed,
          testLabel: label,
          fiscalYear: form.fiscalYear.trim(),
          meetingDate: form.meetingDate.trim(),
        },
        fallbackMessage: 'The run could not be reserved.',
      });
      if (!mountedRef.current) return;
      const sent = { label, fiscalYear: form.fiscalYear.trim(), meetingDate: form.meetingDate.trim() };
      const day = (value) => String(value ?? '').slice(0, 10);
      const differs = reply.created === false
        && (reply.run.testLabel !== sent.label || reply.run.fiscalYear !== sent.fiscalYear || day(reply.run.meetingDate) !== day(sent.meetingDate));
      setReserved({ run: reply.run, differs });
      onReserved?.(reply.run);
    } catch (error) {
      if (mountedRef.current && error?.name !== 'AbortError') setConfirmError(messageFor(error));
    } finally {
      confirmingRef.current = false;
      if (mountedRef.current) setConfirming(false);
    }
  }

  function createAnother() {
    keyRef.current = mintKey();
    setKeyMissing(!keyRef.current);
    setReserved(null);
    setConfirmError(keyRef.current ? '' : KEY_UNAVAILABLE);
    setForm((current) => ({ ...current, label: '', typed: '' }));
  }

  const update = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setConfirmError('');
  };

  return (
    <div className="space-y-6">
      <form onSubmit={lookup} className="max-w-2xl">
        <label htmlFor="factory-source-number" className="block text-sm font-semibold text-gray-950">Source Request number</label>
        <p id="factory-source-help" className="mt-1 text-sm leading-6 text-gray-600">
          The source Request is read and left unchanged. Its documents are checked before anything is reserved.
        </p>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <input
            id="factory-source-number"
            aria-describedby="factory-source-help factory-lookup-reason"
            value={sourceNumber}
            onChange={(event) => { setSourceNumber(event.target.value); setLookupError(''); }}
            inputMode="numeric"
            autoComplete="off"
            maxLength={LIMITS.requestNumberMax}
            className={`${INPUT} mt-0 flex-1`}
          />
          <button type="submit" disabled={Boolean(lookupReason) || looking} className={PRIMARY_BUTTON}>
            {looking ? 'Looking up…' : 'Look up source'}
          </button>
        </div>
        {writeBlock || (lookupReason && trimmedNumber) ? <div className="mt-2"><Reason id="factory-lookup-reason">{lookupReason}</Reason></div> : <span id="factory-lookup-reason" />}
      </form>

      {looking ? (
        <p role="status" className="text-sm text-gray-700">Reading the source Request and checking its documents. This can take a few minutes.</p>
      ) : null}
      {lookupError ? <div role="alert" className={ERROR_BAND}>{lookupError}</div> : null}

      {summary ? (
        <section aria-labelledby="factory-summary-heading" className="space-y-5 border-t border-gray-200 pt-6">
          <div>
            <h3 id="factory-summary-heading" className="text-base font-semibold text-gray-950">Source Request {summary.requestNumber}</h3>
            <dl className="mt-2 grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
              <div className="flex gap-2"><dt className="text-gray-600">Fiscal year</dt><dd className="font-semibold text-gray-950">{summary.fiscalYear || 'Not set'}</dd></div>
              <div className="flex gap-2"><dt className="text-gray-600">Meeting date</dt><dd className="font-semibold text-gray-950">{summary.meetingDate || 'Not set'}</dd></div>
            </dl>
          </div>
          <div className={TABLE_WRAP}>
            <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
              <caption className="sr-only">Documents that would be copied</caption>
              <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-600">
                <tr>
                  <th scope="col" className={TH}>Kind</th>
                  <th scope="col" className={TH}>Name</th>
                  <th scope="col" className={TH}>Size</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {summary.documents?.length ? summary.documents.map((document) => (
                  <tr key={`${document.kind}-${document.name}-${document.sha256Prefix}`}>
                    <td className="px-4 py-3">{document.kind}</td>
                    <td className="px-4 py-3 font-semibold text-gray-950">{document.name}</td>
                    <td className="px-4 py-3 tabular-nums text-gray-600">{formatBytes(document.size)}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={3} className="px-4 py-6 text-center text-gray-600">This Request has no documents to copy.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {reserved ? (
            <div role="status" className="rounded-xl border border-green-200 bg-green-50 px-4 py-4 text-sm leading-6 text-green-900">
              <p className="font-semibold">The run is reserved: {reserved.run.testLabel}.</p>
              <p className="mt-1">Fiscal year {reserved.run.fiscalYear || 'not set'}. Meeting date {String(reserved.run.meetingDate ?? '').slice(0, 10) || 'not set'}.</p>
              {reserved.differs ? (
                <p className="mt-1 font-semibold">This run was already reserved by an earlier attempt, with the values shown here, not the ones you just entered. To use different values, choose Create another.</p>
              ) : null}
              <p className="mt-1">Nothing has been created in Dataverse yet. Start it from the run panel below.</p>
              <button type="button" className={`${OUTLINE_BUTTON} mt-3`} onClick={createAnother}>Create another</button>
            </div>
          ) : (
            <form onSubmit={confirm} className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-3">
                <label className="block text-sm font-semibold text-gray-800">
                  Test label
                  <input value={form.label} onChange={(event) => update('label', event.target.value)} maxLength={LIMITS.labelMax} required className={INPUT} />
                </label>
                <label className="block text-sm font-semibold text-gray-800">
                  Fiscal year
                  <input value={form.fiscalYear} onChange={(event) => update('fiscalYear', event.target.value)} maxLength={LIMITS.cycleFieldMax} required className={INPUT} />
                </label>
                <label className="block text-sm font-semibold text-gray-800">
                  Meeting date
                  <input type="date" value={form.meetingDate} onChange={(event) => update('meetingDate', event.target.value)} required className={INPUT} />
                </label>
              </div>
              <label className="block max-w-md text-sm font-semibold text-gray-800">
                {`Type Request number ${summary.requestNumber} to confirm`}
                <input value={form.typed} onChange={(event) => update('typed', event.target.value)} autoComplete="off" className={INPUT} />
              </label>
              {confirmError ? <div role="alert" className={ERROR_BAND}>{confirmError}</div> : null}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <button type="submit" disabled={Boolean(confirmReason)} aria-describedby="factory-confirm-reason" className={PRIMARY_BUTTON}>
                  {confirming ? 'Reserving…' : 'Confirm and reserve run'}
                </button>
                {confirmReason ? <Reason id="factory-confirm-reason">{confirmReason}</Reason> : <span id="factory-confirm-reason" />}
              </div>
              <p className="max-w-2xl text-sm leading-6 text-gray-600">
                Confirm reserves the run and creates nothing in Dataverse yet. You start the run, step by step, from the run panel.
              </p>
            </form>
          )}
        </section>
      ) : null}
    </div>
  );
}
