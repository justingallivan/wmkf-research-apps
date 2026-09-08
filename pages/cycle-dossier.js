import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Layout, { Button, Card, PageHeader } from '../shared/components/Layout';
import RequireAuth from '../shared/components/RequireAuth';
import { useAppAccess } from '../shared/context/AppAccessContext';

const POLL_MS = 4000;
const EMPTY_ARRAY = [];

function toId(value) {
  return value == null ? '' : String(value);
}

function asSet(values) {
  return new Set((Array.isArray(values) ? values : []).map(toId).filter(Boolean));
}

export function groupedCandidates(candidates = []) {
  const groups = new Map();
  [...candidates]
    .sort((a, b) => toId(a.programDirector || 'Unassigned').localeCompare(toId(b.programDirector || 'Unassigned'))
      || toId(a.requestNumber).localeCompare(toId(b.requestNumber), undefined, { numeric: true }))
    .forEach((candidate) => {
      const label = candidate.programDirector || 'Unassigned';
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(candidate);
    });
  return [...groups.entries()];
}

export function isCurrentGeneration(expected, current) {
  return expected === current;
}

export function retainSelection(currentIds, rosterIds, hydrated) {
  const incoming = asSet(rosterIds);
  if (!hydrated) return incoming;
  return new Set([...asSet(currentIds)].filter((id) => incoming.has(id)));
}

export function buildLaunchPayload({ previewId, selectedIds, generateIds, budgetUsd, idempotencyKey }) {
  return {
    action: 'launch',
    previewId: toId(previewId),
    idempotencyKey,
    budgetUsd: budgetUsd === '' || budgetUsd == null ? null : Number(budgetUsd),
  };
}

export function parseBudgetUsd(value) {
  if (value === '' || value == null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 10000) {
    throw new Error('Enter a spending cap between $0.01 and $10,000.');
  }
  return parsed;
}

function makeIdempotencyKey() {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `cycle-dossier-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatCostRange(estimate) {
  if (!Number.isFinite(estimate?.lowUsd) || !Number.isFinite(estimate?.highUsd)) return 'Unknown';
  return `$${estimate.lowUsd}–$${estimate.highUsd}`;
}

async function readResponse(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

function Icon({ name, className = 'h-5 w-5' }) {
  const paths = {
    dossier: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h8A2.5 2.5 0 0 1 17 5.5V21l-6.5-3.5L4 21V5.5Z" /><path d="M8 7h4M8 10h6M8 13h4" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    file: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5M9 13h6M9 16h6" /></>,
    download: <><path d="M12 3v12m0 0 4-4m-4 4-4-4" /><path d="M5 20h14" /></>,
    play: <path d="m8 5 11 7-11 7V5Z" />,
    pause: <><path d="M8 5v14M16 5v14" /></>,
    refresh: <><path d="M20 11a8 8 0 0 0-14.7-4L3 10" /><path d="M3 5v5h5M4 13a8 8 0 0 0 14.7 4L21 14" /><path d="M21 19v-5h-5" /></>,
  };
  return <svg aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24">{paths[name]}</svg>;
}

function StatusPill({ children, tone = 'neutral' }) {
  const tones = {
    neutral: 'bg-gray-100 text-gray-700',
    good: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
    warning: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200',
    danger: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200',
    info: 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200',
  };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${tones[tone] || tones.neutral}`}>{children}</span>;
}

function Skeleton({ className = '' }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-lg bg-gray-200 ${className}`} />;
}

function SectionTitle({ icon, title, detail, children }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-700"><Icon name={icon} className="h-4.5 w-4.5" /></div>
        <div>
          <h2 className="text-lg font-bold tracking-[-0.01em] text-gray-900">{title}</h2>
          {detail && <p className="mt-0.5 max-w-2xl text-sm leading-6 text-gray-500">{detail}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

function CandidateCard({ candidate, included, mode, onToggleIncluded, onChangeMode, disabled }) {
  const revision = candidate.latestRevision;
  return (
    <article className={`rounded-xl border p-4 transition-colors ${included ? 'border-gray-200 bg-white' : 'border-dashed border-gray-300 bg-gray-50/80'}`}>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          aria-label={`Include request ${candidate.requestNumber}`}
          checked={included}
          disabled={disabled}
          onChange={() => onToggleIncluded(candidate.requestId)}
          className="mt-1 h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-2 focus:ring-gray-500"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.08em] text-gray-500">Request {candidate.requestNumber || candidate.requestId}</p>
              <h3 className="mt-1 font-semibold leading-5 text-gray-900">{candidate.title || 'Untitled request'}</h3>
            </div>
            {included ? <StatusPill tone="good">Included</StatusPill> : <StatusPill>Excluded</StatusPill>}
          </div>
          <p className="mt-2 text-sm text-gray-700">{candidate.institution || 'Institution unavailable'}</p>
          <p className="mt-0.5 text-xs text-gray-500">PI: {candidate.pi || 'Unassigned'}</p>
          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5 text-xs text-gray-500">
            <span className={candidate.sourceAvailable === false ? 'font-semibold text-amber-700' : ''}>
              {candidate.sourceAvailable === false ? 'Narrative unavailable' : candidate.sourceAvailable === true ? 'Narrative available' : 'Narrative checked in preview'}
            </span>
            <span aria-hidden="true">·</span>
            <span>{revision ? `Latest revision ${revision.revision}` : 'No usable revision'}</span>
          </div>
          {revision && <div className="mt-2 flex flex-wrap gap-2"><a href={`/api/cycle-dossier/download?entryId=${encodeURIComponent(revision.id)}&format=docx`} className="text-xs font-semibold text-gray-600 underline underline-offset-2 hover:text-gray-900">Word</a><a href={`/api/cycle-dossier/download?entryId=${encodeURIComponent(revision.id)}&format=pdf`} className="text-xs font-semibold text-gray-600 underline underline-offset-2 hover:text-gray-900">PDF</a></div>}
          {included && (
            <fieldset className="mt-4 border-t border-gray-100 pt-3">
              <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Entry work</legend>
              <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1" role="group" aria-label={`Work mode for request ${candidate.requestNumber}`}>
                {[['reuse', 'Reuse latest'], ['generate', 'Generate new']].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    disabled={disabled}
                    aria-pressed={mode === value}
                    onClick={() => onChangeMode(candidate.requestId, value)}
                    className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 ${mode === value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'} ${value === 'reuse' && !revision ? 'opacity-50' : ''}`}
                  >{label}</button>
                ))}
              </div>
              {!revision && <p className="mt-2 text-xs font-medium text-amber-700">A new entry is required for this request.</p>}
            </fieldset>
          )}
        </div>
      </div>
    </article>
  );
}

function RunItem({ item, candidateById }) {
  const candidate = candidateById.get(toId(item.requestId));
  const statusTone = item.status === 'ready' || item.status === 'succeeded' ? 'good' : item.status === 'failed' ? 'danger' : item.status === 'cancelled' ? 'neutral' : 'info';
  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-gray-100 py-3 last:border-0">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusTone === 'good' ? 'bg-emerald-500' : statusTone === 'danger' ? 'bg-red-500' : statusTone === 'info' ? 'bg-blue-500' : 'bg-gray-400'}`} aria-hidden="true" />
      <span className="min-w-36 flex-1 text-sm font-medium text-gray-800">{candidate ? `#${candidate.requestNumber}` : item.requestId}</span>
      <span className="text-xs text-gray-500">{item.stage || 'Queued'}</span>
      <StatusPill tone={statusTone}>{item.status || 'queued'}</StatusPill>
      {item.error && <p className="basis-full pl-5 text-xs text-red-700">{item.error}</p>}
    </li>
  );
}

function EditionRow({ edition, onPreview }) {
  const missing = Array.isArray(edition.missing) ? edition.missing : [];
  const fallback = Array.isArray(edition.fallback) ? edition.fallback : [];
  const statusTone = edition.status === 'Complete' || edition.status === 'completed' ? 'good' : edition.status === 'Partial' || edition.status === 'partial' ? 'warning' : 'neutral';
  return (
    <li className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold text-gray-900">Edition {edition.id}</p>
          <p className="mt-1 text-xs text-gray-500">{edition.createdAt ? new Date(edition.createdAt).toLocaleString() : 'Date unavailable'}</p>
        </div>
        <StatusPill tone={statusTone}>{edition.status || 'Unpublished'}</StatusPill>
      </div>
      {(missing.length > 0 || fallback.length > 0) && (
        <p className="mt-3 text-xs leading-5 text-amber-800">
          {missing.length > 0 && `${missing.length} missing entr${missing.length === 1 ? 'y' : 'ies'}`}
          {missing.length > 0 && fallback.length > 0 ? ' · ' : ''}
          {fallback.length > 0 && `${fallback.length} fallback entr${fallback.length === 1 ? 'y' : 'ies'}`}
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => onPreview(edition)} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500">Preview PDF</button>
        <a className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500" href={`/api/cycle-dossier/download?editionId=${encodeURIComponent(edition.id)}&format=docx`} download><Icon name="download" className="h-3.5 w-3.5" /> Word</a>
        <a className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500" href={`/api/cycle-dossier/download?editionId=${encodeURIComponent(edition.id)}&format=pdf`} download><Icon name="download" className="h-3.5 w-3.5" /> PDF</a>
      </div>
    </li>
  );
}

export function CycleDossierWorkspace() {
  const { isSuperuser } = useAppAccess();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [workModes, setWorkModes] = useState({});
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [budgetUsd, setBudgetUsd] = useState('');
  const [actionLoading, setActionLoading] = useState('');
  const [editionPreview, setEditionPreview] = useState(null);
  const [view, setView] = useState('requests');
  const [rosterFilter, setRosterFilter] = useState('all');
  const [selectionSaved, setSelectionSaved] = useState(true);
  const requestSeq = useRef(0);
  const selectionGeneration = useRef(0);
  const selectedIdsRef = useRef(new Set());
  const selectionHydrated = useRef(false);
  const previewSeq = useRef(0);
  const mounted = useRef(true);
  const selectionWriteChain = useRef(Promise.resolve());
  const launchKeyRef = useRef({ signature: '', key: '' });

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const load = useCallback(async ({ silent = false } = {}) => {
    const seq = ++requestSeq.current;
    if (!silent) setLoading(true);
    setError('');
    try {
      const body = await readResponse(await fetch('/api/cycle-dossier'));
      if (!mounted.current || !isCurrentGeneration(requestSeq.current, seq)) return;
      setData(body);
      // A null selection is the untouched first dossier: select the current
      // eligible roster once. An empty array is a deliberate all-excluded
      // choice and must remain empty on refresh.
      const incoming = body.dossier?.selection == null
        ? asSet((body.candidates || []).map((candidate) => candidate.requestId))
        : asSet(body.dossier.selection);
      if (!selectionHydrated.current) {
        // Keep initialization outside a functional state updater. React may
        // invoke updater functions twice in StrictMode, which would otherwise
        // turn the first all-selected roster into an empty selection.
        selectionHydrated.current = true;
        selectedIdsRef.current = incoming;
        setSelectedIds(incoming);
      } else {
        setSelectedIds((current) => {
          const retained = retainSelection(current, [...incoming], true);
          selectedIdsRef.current = retained;
          return retained;
        });
      }
      const modes = {};
      (body.candidates || []).forEach((candidate) => {
        modes[toId(candidate.requestId)] = candidate.latestRevision ? 'reuse' : 'generate';
      });
      setWorkModes((current) => ({ ...modes, ...current }));
      setSelectionSaved(true);
    } catch (loadError) {
      if (mounted.current && isCurrentGeneration(requestSeq.current, seq)) setError(loadError.message);
    } finally {
      if (mounted.current && isCurrentGeneration(requestSeq.current, seq)) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const candidates = data?.candidates || EMPTY_ARRAY;
  const candidateById = useMemo(() => new Map(candidates.map((candidate) => [toId(candidate.requestId), candidate])), [candidates]);
  const filteredCandidates = useMemo(() => candidates.filter((candidate) => {
    const included = selectedIds.has(toId(candidate.requestId));
    return rosterFilter === 'all' || (rosterFilter === 'included' ? included : !included);
  }), [candidates, rosterFilter, selectedIds]);
  const groups = useMemo(() => groupedCandidates(filteredCandidates), [filteredCandidates]);
  const selectedCandidates = useMemo(() => candidates.filter((candidate) => selectedIds.has(toId(candidate.requestId))), [candidates, selectedIds]);
  const generateIds = useMemo(() => selectedCandidates.filter((candidate) => workModes[toId(candidate.requestId)] === 'generate' || !candidate.latestRevision).map((candidate) => toId(candidate.requestId)), [selectedCandidates, workModes]);
  const reuseCount = Math.max(0, selectedCandidates.length - generateIds.length);
  const latestRun = data?.runs?.[0] || null;
  const runStatus = String(latestRun?.status || '').toLowerCase();
  const hasFailedItems = Boolean(latestRun?.items?.some((item) => item.status === 'failed'));
  const retryableRun = runStatus === 'failed' || runStatus === 'partial' || hasFailedItems;
  const runActive = latestRun && ['queued', 'running', 'paused', 'pausing', 'cancelling'].includes(runStatus);
  const previewHasUsableItems = Boolean(preview?.items?.some((item) => item.reuseId || ['queued', 'ready'].includes(String(item.status || '').toLowerCase())));

  useEffect(() => {
    if (!runActive) return undefined;
    let cancelled = false;
    const poll = async () => {
      const actionGeneration = requestSeq.current;
      try {
        const body = await readResponse(await fetch('/api/cycle-dossier'));
        if (!cancelled && mounted.current && requestSeq.current === actionGeneration) setData(body);
      } catch (pollError) {
        if (!cancelled && mounted.current && requestSeq.current === actionGeneration) setError(pollError.message);
      }
    };
    const timer = window.setInterval(poll, POLL_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [runActive]);

  const saveSelection = useCallback(async (nextIds) => {
    const generation = ++selectionGeneration.current;
    setSelectionSaved(false);
    const write = selectionWriteChain.current.catch(() => {}).then(async () => {
      try {
        const body = await readResponse(await fetch('/api/cycle-dossier', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'selection', selectedRequestIds: [...nextIds] }),
        }));
        if (!mounted.current || selectionGeneration.current !== generation) return;
        if (body.dossier) setData((current) => ({ ...(current || {}), dossier: body.dossier }));
        setSelectionSaved(true);
      } catch (saveError) {
        if (mounted.current && selectionGeneration.current === generation) {
          setError(saveError.message);
          setSelectionSaved(false);
        }
      }
    });
    selectionWriteChain.current = write;
    await write;
  }, []);

  const toggleIncluded = useCallback((requestId) => {
    const id = toId(requestId);
    const next = new Set(selectedIdsRef.current);
    if (next.has(id)) next.delete(id); else next.add(id);
    selectedIdsRef.current = next;
    setSelectedIds(next);
    void saveSelection(next);
    setPreview(null);
  }, [saveSelection]);

  const changeMode = useCallback((requestId, mode) => {
    setWorkModes((current) => ({ ...current, [toId(requestId)]: mode }));
    setPreview(null);
  }, []);

  const createPreview = async () => {
    const generation = ++previewSeq.current;
    const selectionAtRequest = selectionGeneration.current;
    setPreviewLoading(true);
    setError('');
    try {
      const body = await readResponse(await fetch('/api/cycle-dossier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'preview', selectedRequestIds: [...selectedIds], generateRequestIds: generateIds }),
      }));
      if (!mounted.current || previewSeq.current !== generation || selectionGeneration.current !== selectionAtRequest) return;
      setPreview(body.preview || null);
      setView('review');
    } catch (previewError) {
      if (mounted.current && previewSeq.current === generation) setError(previewError.message);
    } finally {
      if (mounted.current && previewSeq.current === generation) setPreviewLoading(false);
    }
  };

  const launch = async () => {
    if (!preview?.id) return;
    let parsedBudget;
    try {
      parsedBudget = parseBudgetUsd(budgetUsd);
    } catch (budgetError) {
      setError(budgetError.message);
      return;
    }
    const launchSignature = `${preview.id}|${parsedBudget ?? ''}`;
    if (launchKeyRef.current.signature !== launchSignature) launchKeyRef.current = { signature: launchSignature, key: makeIdempotencyKey() };
    setActionLoading('launch');
    setError('');
    try {
      const body = await readResponse(await fetch('/api/cycle-dossier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildLaunchPayload({ previewId: preview.id, selectedIds: [...selectedIds], generateIds, budgetUsd: parsedBudget, idempotencyKey: launchKeyRef.current.key })),
      }));
      if (!mounted.current) return;
      setPreview(null);
      setView('progress');
      setData((current) => ({ ...(current || {}), runs: body.run ? [body.run, ...(current?.runs || [])] : current?.runs || [] }));
      void load({ silent: true });
    } catch (launchError) {
      if (mounted.current) setError(launchError.message);
    } finally {
      if (mounted.current) setActionLoading('');
    }
  };

  const runAction = async (action) => {
    if (!latestRun?.id) return;
    let actionBudget = null;
    if (['resume', 'retry'].includes(action)) {
      try {
        actionBudget = parseBudgetUsd(budgetUsd);
      } catch (budgetError) {
        setError(budgetError.message);
        return;
      }
    }
    const actionGeneration = ++requestSeq.current;
    setActionLoading(action);
    setError('');
    try {
      const body = await readResponse(await fetch('/api/cycle-dossier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, runId: latestRun.id, ...(actionBudget != null ? { budgetUsd: actionBudget } : {}) }),
      }));
      if (mounted.current && requestSeq.current === actionGeneration && body.run) setData((current) => ({ ...(current || {}), runs: [body.run, ...(current?.runs || []).filter((run) => run.id !== body.run.id)] }));
    } catch (actionError) {
      if (mounted.current && requestSeq.current === actionGeneration) setError(actionError.message);
    } finally {
      if (mounted.current && requestSeq.current === actionGeneration) setActionLoading('');
    }
  };

  if (!isSuperuser) {
    return <div className="mx-auto max-w-xl rounded-2xl border border-gray-200 bg-white p-10 text-center shadow-sm"><h1 className="text-2xl font-bold text-gray-900">Cycle Dossier is restricted</h1><p className="mt-3 text-sm leading-6 text-gray-600">This D26 pilot is available to authorized superusers only.</p></div>;
  }

  return (
    <Layout title="Cycle Dossier · D26" description="Prepare private D26 scientific briefing dossiers." maxWidth="7xl">
      <PageHeader title="Cycle Dossier" subtitle="Prepare a private D26 scientific briefing for program directors." icon={<Icon name="dossier" className="h-9 w-9" />} />

      <div className="mb-7 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-3 text-sm"><span className="font-bold text-gray-900">D26 pilot</span><span className="text-gray-300">/</span><span className="text-gray-600">Superuser workspace</span>{data?.configuration?.ready ? <StatusPill tone="good">Configuration ready</StatusPill> : data?.configuration ? <StatusPill tone="warning">Configuration needs attention</StatusPill> : null}</div>
        <span className="text-xs text-gray-500">Selections save automatically{!selectionSaved && ' · saving…'}</span>
      </div>

      {error && <div role="alert" className="mb-6 flex items-start justify-between gap-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><span>{error}</span><button type="button" className="font-semibold underline underline-offset-2" onClick={() => { setError(''); void load(); }}>Retry</button></div>}
      {data?.configuration && !data.configuration.ready && <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900"><p className="font-semibold">Dossier preparation is unavailable.</p><p className="mt-1">{data.configuration.error || 'An administrator must publish the Cycle Dossier prompt and model configuration before launch.'}</p></div>}

      <nav aria-label="Cycle Dossier workflow" className="mb-6 grid grid-cols-3 gap-1 rounded-xl border border-gray-200 bg-gray-100 p-1">
        {[['requests', 'Choose requests'], ['review', 'Review & launch'], ['progress', 'Progress & editions']].map(([key, label], index) => <button key={key} type="button" onClick={() => setView(key)} className={`rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 ${view === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}><span className="mr-2 text-xs text-gray-400">{index + 1}</span>{label}</button>)}
      </nav>

      {(view === 'requests' || view === 'review') && <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-labelledby="choose-requests-heading">
          <Card hover={false} padding="p-5 sm:p-6">
            <SectionTitle icon="file" title="Choose requests" detail="All eligible D26 requests start included. Exclude test cases here; the decision persists for your dossier.">
              <div className="flex items-center gap-2"><div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1" role="group" aria-label="Roster filter">{[['all', 'All'], ['included', 'Included'], ['excluded', 'Excluded']].map(([value, label]) => <button key={value} type="button" aria-pressed={rosterFilter === value} onClick={() => setRosterFilter(value)} className={`rounded-md px-2.5 py-1.5 text-xs font-semibold ${rosterFilter === value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}>{label}</button>)}</div><StatusPill tone="info">{selectedCandidates.length} of {candidates.length} included</StatusPill></div>
            </SectionTitle>
            {loading ? <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div> : filteredCandidates.length === 0 ? <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-5 py-10 text-center"><p className="font-semibold text-gray-900">{candidates.length === 0 ? 'No eligible D26 requests were returned.' : `No ${rosterFilter} requests`}</p><p className="mt-2 text-sm text-gray-900">{candidates.length === 0 ? 'The roster is loaded from the Workbench; no sample requests are shown.' : 'Change the roster filter to see the other requests.'}</p></div> : <div className="space-y-6">{groups.map(([pd, group]) => <div key={pd}><div className="mb-3 flex items-center gap-2"><h3 className="text-sm font-bold text-gray-900">{pd}</h3><span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-900">{group.length}</span></div><div className="grid gap-3 xl:grid-cols-2">{group.map((candidate) => <CandidateCard key={candidate.requestId} candidate={candidate} included={selectedIds.has(toId(candidate.requestId))} mode={workModes[toId(candidate.requestId)] || (candidate.latestRevision ? 'reuse' : 'generate')} onToggleIncluded={toggleIncluded} onChangeMode={changeMode} disabled={previewLoading || actionLoading === 'launch'} />)}</div></div>)}</div>}
          </Card>
        </section>
        <aside className="space-y-4 lg:sticky lg:top-5 lg:self-start">
          <Card hover={false} padding="p-5"><h2 className="text-base font-bold text-gray-900">Review your composition</h2><dl className="mt-4 divide-y divide-gray-100 text-sm"><div className="flex justify-between gap-3 py-2"><dt className="text-gray-500">Included</dt><dd className="font-semibold text-gray-900">{selectedCandidates.length}</dd></div><div className="flex justify-between gap-3 py-2"><dt className="text-gray-500">Excluded</dt><dd className="font-semibold text-gray-900">{Math.max(0, candidates.length - selectedCandidates.length)}</dd></div><div className="flex justify-between gap-3 py-2"><dt className="text-gray-500">Generate new</dt><dd className="font-semibold text-gray-900">{generateIds.length}</dd></div><div className="flex justify-between gap-3 py-2"><dt className="text-gray-500">Reuse latest</dt><dd className="font-semibold text-gray-900">{reuseCount}</dd></div></dl><Button type="button" className="mt-4 w-full" loading={previewLoading} disabled={!data?.configuration?.ready || selectedCandidates.length === 0 || !selectionSaved} onClick={createPreview}>Review cost & sources</Button><p className="mt-3 text-center text-xs leading-5 text-gray-500">The server rechecks the roster and freezes sources before any generation.</p></Card>
          {preview && <Card hover={false} padding="p-5"><div className="flex items-start justify-between gap-3"><h2 className="text-base font-bold text-gray-900">Preview ready</h2><StatusPill tone="good">Review</StatusPill></div><p className="mt-2 text-xs text-gray-900">Expires {preview.expiresAt ? new Date(preview.expiresAt).toLocaleString() : 'soon'}</p><div className="mt-4 rounded-lg bg-gray-50 p-3"><p className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-900">Estimated new work</p><p className="mt-1 text-xl font-bold text-gray-900">{formatCostRange(preview.estimate)}</p><p className="mt-1 text-xs text-gray-900">{preview.estimate?.newCount ?? generateIds.length} new · {preview.estimate?.reuseCount ?? reuseCount} reused</p></div>{preview.errors?.length > 0 && <div className="mt-3 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900"><span className="font-semibold">Will be missing or use a prior revision:</span> {preview.errors.map((item) => item.error).join(' ')}</div>}<div className="mt-4"><label htmlFor="cycle-dossier-budget" className="text-xs font-semibold text-gray-700">Optional spending cap (USD)</label><input id="cycle-dossier-budget" type="number" inputMode="decimal" min="0" step="0.01" value={budgetUsd} onChange={(event) => setBudgetUsd(event.target.value)} placeholder="No cap" className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-600 focus:ring-2 focus:ring-gray-200" /></div><Button type="button" className="mt-4 w-full" loading={actionLoading === 'launch'} disabled={!previewHasUsableItems || !preview.id || selectedCandidates.length === 0} onClick={launch}>Launch dossier run</Button></Card>}
        </aside>
      </div>}

      {view === 'review' && preview && <section className="mt-6"><Card hover={false} padding="p-5 sm:p-6"><SectionTitle icon="check" title="Included and excluded preview" detail="This is the server preview that will be pinned at launch. A changed roster requires a new preview." /><div className="grid gap-5 md:grid-cols-2"><div><h3 className="mb-2 text-sm font-bold text-gray-900">Included ({preview.items?.length ?? selectedCandidates.length})</h3><ul className="space-y-2">{(preview.items || selectedCandidates).map((item) => { const id = toId(item.requestId); const candidate = candidateById.get(id); const modeLabel = item.reuseId ? 'Reuse' : item.status === 'queued' || generateIds.includes(id) ? 'Generate' : 'Reuse'; return <li key={id} className="flex items-center justify-between gap-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm"><span className="min-w-0 truncate text-emerald-950">{candidate ? `#${candidate.requestNumber} · ${candidate.title}` : id}</span><span className="shrink-0 text-xs font-semibold text-emerald-700">{modeLabel}{item.status ? ` · ${item.status}` : ''}</span></li>; })}</ul></div><div><h3 className="mb-2 text-sm font-bold text-gray-900">Preview warnings</h3>{preview.errors?.length ? <ul className="space-y-2">{preview.errors.map((item) => <li key={item.requestId} className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{item.error}</li>)}</ul> : <p className="rounded-lg bg-gray-50 px-3 py-3 text-sm text-gray-900">No source or configuration warnings were returned.</p>}</div></div>{data.configuration?.prompts?.length > 0 && <div className="mt-5 border-t border-gray-100 pt-4"><h3 className="text-sm font-bold text-gray-900">Published configuration</h3><ul className="mt-2 grid gap-2 sm:grid-cols-2">{data.configuration.prompts.map((prompt) => <li key={`${prompt.name}-${prompt.version}`} className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-900"><span className="font-semibold">{prompt.name}</span><span className="ml-2 text-gray-700">v{prompt.version} · {prompt.model}</span></li>)}</ul></div>}</Card></section>}

      {view === 'progress' && <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]"><section><Card hover={false} padding="p-5 sm:p-6"><SectionTitle icon="play" title="Run progress" detail="Progress is saved on the server. You can leave this page and return without restarting work.">{latestRun && <StatusPill tone={runStatus === 'failed' ? 'danger' : runStatus === 'partial' ? 'warning' : runStatus === 'completed' ? 'good' : 'info'}>{latestRun.status}</StatusPill>}</SectionTitle>{!latestRun ? <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-5 py-10 text-center"><p className="font-semibold text-gray-900">No dossier runs yet.</p><p className="mt-2 text-sm text-gray-900">Review your D26 composition to prepare the first run.</p></div> : <><div className="mb-4 flex flex-wrap items-end gap-2">{(runStatus === 'paused' || retryableRun) && <div><label htmlFor="cycle-dossier-progress-budget" className="block text-xs font-semibold text-gray-700">New budget authorization (USD)</label><input id="cycle-dossier-progress-budget" type="number" inputMode="decimal" min="0" step="0.01" value={budgetUsd} onChange={(event) => setBudgetUsd(event.target.value)} placeholder="Keep current" className="mt-1 w-44 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-600 focus:ring-2 focus:ring-gray-200" /></div>}{['running', 'queued'].includes(runStatus) && <Button size="sm" variant="secondary" loading={actionLoading === 'pause'} onClick={() => runAction('pause')}>Pause</Button>}{runStatus === 'paused' && <Button size="sm" loading={actionLoading === 'resume'} onClick={() => runAction('resume')}>Resume</Button>}{['running', 'queued', 'paused'].includes(runStatus) && <Button size="sm" variant="outline" loading={actionLoading === 'cancel'} onClick={() => runAction('cancel')}>Cancel remaining</Button>}{retryableRun && <Button size="sm" loading={actionLoading === 'retry'} onClick={() => runAction('retry')}>Retry failed</Button>}<span className="ml-auto text-xs text-gray-700">Spent ${latestRun.spentUsd ?? '0.00'}{latestRun.reservedUsd > 0 ? ` · $${latestRun.reservedUsd} reserved` : ''}{latestRun.budgetUsd != null ? ` of $${latestRun.budgetUsd}` : ''}</span></div>{(runStatus === 'paused' || retryableRun) && <p className="mb-4 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-900">Leave the field blank to keep the current cap. A value authorizes a new budget for resume or a fresh retry run.</p>}{latestRun.error && <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{latestRun.error}</div>}<ul className="divide-y divide-gray-100">{(latestRun.items || []).map((item) => <RunItem key={item.requestId} item={item} candidateById={candidateById} />)}</ul></>}</Card></section><aside><Card hover={false} padding="p-5"><h2 className="text-base font-bold text-gray-900">Latest edition</h2>{data?.editions?.[0] ? <div className="mt-4"><EditionRow edition={data.editions[0]} onPreview={setEditionPreview} /></div> : <p className="mt-3 text-sm leading-6 text-gray-900">An edition appears here once the run has a usable entry or fallback.</p>}</Card></aside></div>}

      <section className="mt-6"><Card hover={false} padding="p-5 sm:p-6"><SectionTitle icon="file" title="Edition history" detail="Previous Word and PDF pairs remain available as immutable private snapshots." />{data?.editions?.length ? <ul className="grid gap-3 md:grid-cols-2">{data.editions.map((edition) => <EditionRow key={edition.id} edition={edition} onPreview={setEditionPreview} />)}</ul> : <p className="rounded-lg bg-gray-50 px-4 py-4 text-sm text-gray-900">No editions are available yet.</p>}</Card></section>

      {editionPreview && <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="edition-preview-title"><div className="flex h-[min(85vh,850px)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"><div className="flex items-center justify-between gap-4 border-b border-gray-200 px-5 py-4"><div><h2 id="edition-preview-title" className="font-bold text-gray-900">Edition {editionPreview.id} PDF preview</h2><p className="mt-0.5 text-xs text-gray-500">{editionPreview.status || 'Edition'} · private to this dossier</p></div><button type="button" aria-label="Close PDF preview" onClick={() => setEditionPreview(null)} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500">×</button></div><iframe title={`PDF preview for edition ${editionPreview.id}`} className="min-h-0 flex-1 bg-gray-100" src={`/api/cycle-dossier/download?editionId=${encodeURIComponent(editionPreview.id)}&format=pdf`} /></div></div>}
    </Layout>
  );
}

export default function CycleDossierPage() {
  return <RequireAuth><CycleDossierWorkspace /></RequireAuth>;
}
