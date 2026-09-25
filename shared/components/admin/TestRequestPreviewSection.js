import { useEffect, useRef, useState } from 'react';
import { requestJson } from '../../utils/api-request';
import TestRequestBadge from '../TestRequestBadge';
import { StatusChip } from './AdminWorkspaceNavigation';

function formatBytes(value) {
  if (!Number.isFinite(value)) return 'Unknown size';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function valueText(value) {
  if (value == null || value === '') return 'Not set';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

const OPERATION_LABELS = Object.freeze({
  blocked: 'Blocked',
  omitted: 'Omitted',
  'would-copy': 'Would copy',
});

const OPERATION_TONES = Object.freeze({
  blocked: 'red',
  omitted: 'gray',
  'would-copy': 'green',
});

export default function TestRequestPreviewSection() {
  const [sourceNumber, setSourceNumber] = useState('');
  const [sourceState, setSourceState] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [form, setForm] = useState({ testLabel: '', fiscalYear: '', meetingDate: '' });
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loadingSource, setLoadingSource] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const sourceAbortRef = useRef(null);
  const previewAbortRef = useRef(null);
  const contextVersionRef = useRef(0);
  const previewSequenceRef = useRef(0);

  useEffect(() => () => {
    sourceAbortRef.current?.abort();
    previewAbortRef.current?.abort();
  }, []);

  const invalidatePreview = () => {
    previewSequenceRef.current += 1;
    previewAbortRef.current?.abort();
    setLoadingPreview(false);
    setResult(null);
  };

  const changeSourceNumber = (value) => {
    setSourceNumber(value);
    if (sourceState && value.trim() !== sourceState.source.requestNumber) {
      contextVersionRef.current += 1;
      sourceAbortRef.current?.abort();
      setSourceState(null);
      setSelectedIds([]);
      setForm({ testLabel: '', fiscalYear: '', meetingDate: '' });
      invalidatePreview();
    }
    setError('');
  };

  const loadSource = async (event) => {
    event.preventDefault();
    const normalized = sourceNumber.trim();
    if (!normalized) return;
    contextVersionRef.current += 1;
    const contextVersion = contextVersionRef.current;
    sourceAbortRef.current?.abort();
    previewAbortRef.current?.abort();
    const controller = new AbortController();
    sourceAbortRef.current = controller;
    setLoadingSource(true);
    setLoadingPreview(false);
    setError('');
    setResult(null);
    try {
      const body = await requestJson(`/api/admin/test-requests/preview?sourceRequestNumber=${encodeURIComponent(normalized)}`, {
        signal: controller.signal,
        fallbackMessage: 'The source Request could not be loaded.',
      });
      if (controller.signal.aborted || contextVersion !== contextVersionRef.current) return;
      setSourceState(body);
      setSourceNumber(body.source.requestNumber);
      setSelectedIds(body.documents.filter((document) => document.copyMode === 'copy' || document.copyMode === 'copy-rename').map((document) => document.id));
      setForm({
        testLabel: body.defaults.testLabel,
        fiscalYear: body.defaults.fiscalYear,
        meetingDate: body.defaults.meetingDate,
      });
    } catch (loadError) {
      if (loadError.name !== 'AbortError' && contextVersion === contextVersionRef.current) {
        setError(loadError.message);
        setSourceState(null);
      }
    } finally {
      if (contextVersion === contextVersionRef.current) setLoadingSource(false);
    }
  };

  const updateForm = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    invalidatePreview();
    setError('');
  };

  const toggleDocument = (id) => {
    setSelectedIds((current) => (
      current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id]
    ));
    invalidatePreview();
    setError('');
  };

  const buildPreview = async (event) => {
    event.preventDefault();
    if (!sourceState) return;
    previewSequenceRef.current += 1;
    const previewSequence = previewSequenceRef.current;
    const contextVersion = contextVersionRef.current;
    previewAbortRef.current?.abort();
    const controller = new AbortController();
    previewAbortRef.current = controller;
    setLoadingPreview(true);
    setError('');
    try {
      const body = await requestJson('/api/admin/test-requests/preview', {
        method: 'POST',
        signal: controller.signal,
        fallbackMessage: 'The preview could not be prepared.',
        body: {
          sourceRequestId: sourceState.source.requestId,
          selectedDocumentIds: selectedIds,
          testLabel: form.testLabel,
          ...(form.fiscalYear !== sourceState.source.fiscalYear ? { fiscalYear: form.fiscalYear } : {}),
          ...(form.meetingDate !== sourceState.source.meetingDate ? { meetingDate: form.meetingDate } : {}),
        },
      });
      if (controller.signal.aborted
          || contextVersion !== contextVersionRef.current
          || previewSequence !== previewSequenceRef.current) return;
      setResult(body);
    } catch (previewError) {
      if (previewError.name !== 'AbortError'
          && contextVersion === contextVersionRef.current
          && previewSequence === previewSequenceRef.current) {
        setError(previewError.message);
      }
    } finally {
      if (contextVersion === contextVersionRef.current
          && previewSequence === previewSequenceRef.current) {
        setLoadingPreview(false);
      }
    }
  };

  const requestFields = result?.preview?.preview?.request?.fields || [];
  const blockers = result?.preview?.blockers || [];
  const disclosures = result?.preview?.disclosures || [];

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-4 text-sm text-blue-950">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip tone="gray">Preview only</StatusChip>
          <p className="font-semibold">This tool cannot create a Request or copy a file.</p>
        </div>
        <p className="mt-2 max-w-3xl leading-6 text-blue-900">
          It reads one sandbox Request, inventories allowlisted proposal documents from the registered shared akoyaGO SharePoint site, and shows the field and filename plan that a future authorized run would use.
        </p>
      </div>

      <form onSubmit={loadSource} className="max-w-2xl">
        <label htmlFor="test-request-source-number" className="block text-sm font-semibold text-gray-950">
          Source Request number
        </label>
        <p id="test-request-source-help" className="mt-1 text-sm leading-6 text-gray-600">
          The source remains unchanged. Dataverse must be the registered sandbox; documents come from the separately registered shared akoyaGO SharePoint site.
        </p>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <input
            id="test-request-source-number"
            aria-describedby="test-request-source-help"
            value={sourceNumber}
            onChange={(event) => changeSourceNumber(event.target.value)}
            placeholder="1000338"
            autoComplete="off"
            className="min-h-11 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-950 outline-none transition focus:border-gray-900 focus:ring-2 focus:ring-gray-900 focus:ring-offset-2 sm:text-sm"
          />
          <button
            type="submit"
            disabled={loadingSource || !sourceNumber.trim()}
            className="min-h-11 rounded-lg bg-gray-950 px-5 py-2 text-sm font-semibold text-white transition hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loadingSource ? 'Loading source…' : 'Load source'}
          </button>
        </div>
      </form>

      {error ? (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error} Try again after checking the Request number and sandbox connection.
        </div>
      ) : null}

      {sourceState ? (
        <form onSubmit={buildPreview} className="space-y-7">
          <section aria-labelledby="test-request-source-heading" className="border-t border-gray-200 pt-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 id="test-request-source-heading" className="text-base font-semibold text-gray-950">
                  Request {sourceState.source.requestNumber}
                </h3>
                <TestRequestBadge isTestRequest={sourceState.source.isTestRequest} className="mt-1" />
                <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-600">
                  {sourceState.source.title || 'Untitled Request'} · {sourceState.source.applicant || 'Applicant unavailable'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
                <StatusChip tone="green">Dataverse sandbox</StatusChip>
                <span>{sourceState.environment.hostname}</span>
                <StatusChip tone="gray">Shared SharePoint</StatusChip>
                <span>{sourceState.environment.sharePoint.hostname}{sourceState.environment.sharePoint.pathname}</span>
              </div>
            </div>
          </section>

          <section aria-labelledby="test-request-values-heading">
            <h3 id="test-request-values-heading" className="text-base font-semibold text-gray-950">Requested test values</h3>
            <p className="mt-1 text-sm leading-6 text-gray-600">
              Fiscal year and meeting date come from the source Request. Enter either value if it is missing, or change it here when needed. Organization, Request type, marker, run ID, and reminder controls are resolved by the server.
            </p>
            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              <label className="block text-sm font-semibold text-gray-800">
                Test label
                <input
                  value={form.testLabel}
                  onChange={(event) => updateForm('testLabel', event.target.value)}
                  maxLength={120}
                  required
                  className="mt-2 min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-normal text-gray-950 outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900 focus:ring-offset-2"
                />
              </label>
              <label className="block text-sm font-semibold text-gray-800">
                Fiscal year
                <input
                  value={form.fiscalYear}
                  onChange={(event) => updateForm('fiscalYear', event.target.value)}
                  required
                  className="mt-2 min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-normal text-gray-950 outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900 focus:ring-offset-2"
                />
              </label>
              <label className="block text-sm font-semibold text-gray-800">
                Meeting date
                <input
                  type="date"
                  value={form.meetingDate}
                  onChange={(event) => updateForm('meetingDate', event.target.value)}
                  required
                  className="mt-2 min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-normal text-gray-950 outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900 focus:ring-offset-2"
                />
              </label>
            </div>
          </section>

          <section aria-labelledby="test-request-documents-heading">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h3 id="test-request-documents-heading" className="text-base font-semibold text-gray-950">Proposal documents</h3>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-600">
                  Phase I files and the numbered proposal PDFs are selected by default. Numbered PDFs are copied as-is and renamed to the new Request number.
                </p>
              </div>
              <span className="text-sm tabular-nums text-gray-500">{selectedIds.length} selected</span>
            </div>
            <div className="mt-4 overflow-x-auto rounded-xl border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
                <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-600">
                  <tr>
                    <th scope="col" className="w-20 px-4 py-3">Include</th>
                    <th scope="col" className="px-4 py-3">Document</th>
                    <th scope="col" className="px-4 py-3">Source</th>
                    <th scope="col" className="px-4 py-3">Size</th>
                    <th scope="col" className="px-4 py-3">Handling</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {sourceState.documents.length ? sourceState.documents.map((document) => (
                    <tr key={document.id} className="align-top">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(document.id)}
                          onChange={() => toggleDocument(document.id)}
                          aria-label={`Include ${document.label}`}
                          className="h-4 w-4 rounded border-gray-300 text-gray-950 focus:ring-gray-900"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-semibold text-gray-950">{document.label}</span>
                        <span className="mt-0.5 block text-xs text-gray-500">{document.name}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{document.source === 'dynamics' ? 'Current Request folder' : 'Request archive'}</td>
                      <td className="px-4 py-3 tabular-nums text-gray-600">{formatBytes(document.size)}</td>
                      <td className="px-4 py-3">
                        <StatusChip tone="green">
                          {document.copyMode === 'copy-rename' ? 'Copy, renamed to new number' : 'Direct copy candidate'}
                        </StatusChip>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-gray-600">
                        No allowlisted proposal documents were found for this Request.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {sourceState.inventoryErrors.length ? (
              <p className="mt-3 text-sm text-amber-800">
                One or more SharePoint locations could not be inventoried. Any preview will remain blocked until the inventory is complete.
              </p>
            ) : null}
          </section>

          <div className="flex flex-col gap-3 border-t border-gray-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-2xl text-sm leading-6 text-gray-600">
              Previewing hashes the selected current file versions. It does not reserve a Request number or authorize a later create.
            </p>
            <button
              type="submit"
              disabled={loadingPreview}
              className="min-h-11 shrink-0 rounded-lg bg-gray-950 px-5 py-2 text-sm font-semibold text-white transition hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loadingPreview ? 'Preparing preview…' : 'Build read-only preview'}
            </button>
          </div>
        </form>
      ) : null}

      {result ? (
        <section aria-labelledby="test-request-preview-heading" className="space-y-6 border-t border-gray-300 pt-7">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 id="test-request-preview-heading" className="text-xl font-semibold tracking-tight text-gray-950">Preview result</h3>
              <p className="mt-1 text-sm leading-6 text-gray-600">Non-authoritative plan for Request {result.source.requestNumber}.</p>
            </div>
            <StatusChip tone={result.preview.planReady ? 'green' : 'amber'}>
              {result.preview.planReady ? 'Plan ready' : 'Blocked from execution'}
            </StatusChip>
          </div>

          {blockers.length ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4">
              <h4 className="text-sm font-semibold text-amber-950">What must be resolved</h4>
              <ul className="mt-2 space-y-2 text-sm leading-6 text-amber-900">
                {blockers.map((blocker, index) => (
                  <li key={`${blocker.code}-${blocker.field || 'general'}-${index}`}>
                    <span className="font-semibold">{blocker.code}</span>
                    {blocker.field ? ` (${blocker.field})` : ''}: {blocker.detail}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.8fr)]">
            <section aria-labelledby="test-request-field-preview-heading">
              <h4 id="test-request-field-preview-heading" className="text-sm font-semibold text-gray-950">Request field preview</h4>
              <div className="mt-3 overflow-hidden rounded-xl border border-gray-200 bg-white">
                {requestFields.length ? (
                  <dl className="divide-y divide-gray-200">
                    {requestFields.map(({ field, value }) => (
                      <div key={field} className="grid gap-1 px-4 py-3 sm:grid-cols-[14rem_minmax(0,1fr)] sm:gap-4">
                        <dt className="text-xs font-semibold text-gray-600">{field}</dt>
                        <dd className="break-words text-sm text-gray-950">{valueText(value)}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="px-4 py-6 text-sm text-gray-600">No valid field preview is available.</p>
                )}
              </div>
            </section>

            <section aria-labelledby="test-request-file-preview-heading">
              <h4 id="test-request-file-preview-heading" className="text-sm font-semibold text-gray-950">Document result</h4>
              <ul className="mt-3 divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 bg-white">
                {result.documents.map((document) => (
                  <li key={document.id} className="flex items-start justify-between gap-4 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-gray-950">{document.name}</p>
                      <p className="mt-0.5 text-xs text-gray-500">{document.folder}</p>
                    </div>
                    <StatusChip tone={OPERATION_TONES[document.previewOperation] || 'gray'}>
                      {OPERATION_LABELS[document.previewOperation] || document.previewOperation}
                    </StatusChip>
                  </li>
                ))}
                {!result.documents.length ? (
                  <li className="px-4 py-6 text-sm text-gray-600">No allowlisted documents were found.</li>
                ) : null}
              </ul>
            </section>
          </div>

          {disclosures.length ? (
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-4">
              <h4 className="text-sm font-semibold text-gray-950">Content disclosure</h4>
              <ul className="mt-2 space-y-1 text-sm leading-6 text-gray-700">
                {disclosures.map((disclosure) => <li key={disclosure}>{disclosure}</li>)}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
