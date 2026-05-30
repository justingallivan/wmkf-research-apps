import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Layout, { PageHeader, Card, Button } from '../shared/components/Layout';
import RequireAppAccess from '../shared/components/RequireAppAccess';
import ErrorAlert from '../shared/components/ErrorAlert';

/**
 * Dataverse Bulk Export — Track B expert filter builder (build plan §6).
 *
 * The UI is a thin, honest face over a stable + twice-Codex-reviewed API
 * seam. It does NOT re-derive query semantics: it emits a structured
 * QuerySpec, /preview is the sole authority for the true total / composition
 * / warnings, and /run is the sole retrieval path. Every fan-out is a forced
 * explicit choice (no hidden default that could silently change scope), and
 * truncation is loud — never a quiet footnote.
 *
 * Confirm gate (build plan §5/§11): /run is only reachable after a rendered
 * /preview. Any change to the spec invalidates the preview (and its
 * resultToken), forcing a fresh preview before a run.
 */

// ── Axis vocabulary (business words, never akoya_* logical names in labels) ──
const AXES = {
  program: {
    label: 'Program',
    kind: 'guid',
    taxonomy: 'programs',
    help: 'Canonical program taxonomy (default program axis ∧ type = Program).',
  },
  fundingCategory: {
    label: 'Funding category',
    kind: 'guid',
    taxonomy: 'fundingCategories',
    help: 'Coarse funding / payment axis — a separate dimension from Program, never conflated.',
  },
  type: {
    label: 'Type',
    kind: 'guid',
    taxonomy: 'types',
    help: 'Grant / concept / operational polymorphism.',
  },
  requestType: {
    label: 'Request type',
    kind: 'guid',
    taxonomy: 'requestTypeOptions',
    help: 'Request-type picklist (Office Visit / Phone / Grant / …).',
  },
  status: {
    label: 'Status',
    kind: 'enum',
    taxonomy: 'statuses',
    help: 'Live request-status taxonomy. A brand-new or just-retired value still filters literally; the preview flags any value not in the current taxonomy.',
  },
  dateBasis: {
    label: 'Decision date',
    kind: 'date',
    help: 'Business history is sliced on the decision date only. Record-creation date is provenance — it is the separate Era control, never a history filter.',
  },
  amount: {
    label: 'Amount',
    kind: 'money',
    help: 'Requires an explicit which-amount choice — there is no bare "budget".',
  },
  institution: {
    label: 'Institution',
    kind: 'identity',
    help: 'Applicant / payee account name (identity match).',
  },
};

const OPS_BY_KIND = {
  guid: [['eq', 'is'], ['in', 'is any of'], ['notnull', 'has a value'], ['null', 'is empty']],
  enum: [['eq', 'is'], ['in', 'is any of'], ['notnull', 'has a value'], ['null', 'is empty']],
  money: [['eq', '='], ['gt', '>'], ['gte', '≥'], ['lt', '<'], ['lte', '≤'], ['between', 'between']],
  date: [['between', 'between'], ['onorafter', 'on or after'], ['onorbefore', 'on or before']],
  identity: [['eq', 'is'], ['contains', 'contains'], ['in', 'is any of']],
};

const AMOUNT_WHICH = [
  ['awarded', 'Awarded'],
  ['requested', 'Requested'],
  ['total', 'Total project'],
  ['recommended', 'Recommended'],
  ['invited', 'Invited'],
];

const VALUELESS_OPS = new Set(['null', 'notnull']);

let _rid = 0;
const newRow = () => ({
  id: ++_rid,
  axis: 'program',
  op: 'eq',
  which: 'awarded',
  value: '',
  values: [],
  from: '',
  to: '',
});

// Map a builder row → the QuerySpec filter shape the compiler validates.
function toSpecFilter(row) {
  const base = { axis: row.axis, op: row.op };
  if (VALUELESS_OPS.has(row.op)) return base;

  if (row.axis === 'amount') {
    base.which = row.which;
    if (row.op === 'between') {
      return { ...base, from: Number(row.from), to: Number(row.to) };
    }
    return { ...base, value: Number(row.value) };
  }
  if (row.op === 'between') return { ...base, from: row.from, to: row.to };
  if (row.op === 'in') return { ...base, value: row.values };
  return { ...base, value: row.value };
}

const nonEmpty = (v) => String(v ?? '').trim() !== '';
const finiteNum = (v) => nonEmpty(v) && Number.isFinite(Number(v));

// A row is COMPLETE iff every input the chosen axis/op needs has a real
// value. Incomplete rows must never reach /preview — a blank field would
// otherwise coerce to a plausible-but-wrong predicate (`Number('')===0`,
// `value=""` ⇒ a literal-empty filter, an empty `in` array). That silent
// wrong-scope is exactly the plausible-wrong-answer this tool exists to
// prevent (Codex S161 P0/P1). Valueless ops (null/notnull) are complete.
function rowComplete(row) {
  if (VALUELESS_OPS.has(row.op)) return true;
  const isMoney = AXES[row.axis].kind === 'money';
  if (row.op === 'between') {
    return isMoney
      ? finiteNum(row.from) && finiteNum(row.to)
      : nonEmpty(row.from) && nonEmpty(row.to);
  }
  if (row.op === 'in') return Array.isArray(row.values) && row.values.length > 0;
  if (isMoney) return finiteNum(row.value);
  return nonEmpty(row.value);
}

function MultiSelect({ options, selected, onChange, disabled }) {
  return (
    <select
      multiple
      disabled={disabled}
      value={selected}
      onChange={(e) =>
        onChange(Array.from(e.target.selectedOptions).map((o) => o.value))
      }
      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm h-32 disabled:bg-gray-100"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function DataverseBulkExport() {
  // ── Live taxonomy (fail-loud; never a hardcoded list) ──
  const [tax, setTax] = useState(null);
  const [taxError, setTaxError] = useState(null);
  const [taxLoading, setTaxLoading] = useState(true);

  // ── Forced scope choices (no hidden defaults) ──
  const [eraScope, setEraScope] = useState('all');
  const [excludeOperational, setExcludeOperational] = useState(true);
  const [excludeTestRecords, setExcludeTestRecords] = useState(true);
  const [programRollup, setProgramRollup] = useState(false);
  const [useDefaultColumns, setUseDefaultColumns] = useState(true);

  // ── Filters — start EMPTY: filters:[] is the valid "every request row"
  //    baseline (loud truncation downstream). A synthetic default row would
  //    silently scope the export (Codex S161 P0). ──
  const [filters, setFilters] = useState([]);

  // Monotonic spec revision — bumped on every spec mutation. A /preview
  // response whose captured revision no longer matches is STALE and dropped
  // (Codex S161 P1: an in-flight preview must not restore a token bound to a
  // spec the user already edited away from).
  const specRev = useRef(0);
  // P3 — abort the SSE fetch + clear the expiry timer on unmount; mountedRef
  // gates every post-await state setter so an unmount (or a stale-discarded
  // preview) can never setState on an unmounted/abandoned component.
  const abortRef = useRef(null);
  const expiryTimerRef = useRef(null);
  const mountedRef = useRef(true);

  // ── Preview / confirm gate ──
  const [preview, setPreview] = useState(null); // { ...response } incl. resultToken
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState(null); // { error, message, violations?, appliedRules? }

  // ── Run / SSE ──
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null); // { stage, pages, fetched, total }
  const [truncation, setTruncation] = useState(null); // { reason, total, fetched }
  const [ready, setReady] = useState(null); // { downloadUrl, bytes, rows, trueTotal, truncated, expiresInSec }
  const [downloadExpired, setDownloadExpired] = useState(false); // P2 — link TTL elapsed
  const [runError, setRunError] = useState(null); // { stage, message, retryable }

  const [topError, setTopError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch('/api/dataverse-export/metadata');
        const data = await resp.json();
        if (cancelled) return;
        if (!resp.ok) {
          setTaxError(
            data.message ||
              `Could not load the live taxonomy (${resp.status}). The builder refuses to show a stale or partial list.`
          );
          return;
        }
        setTax(data);
      } catch (err) {
        if (!cancelled) setTaxError(err.message || 'Taxonomy fetch failed.');
      } finally {
        if (!cancelled) setTaxLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Any spec change invalidates the rendered preview + its resultToken: the
  // confirm gate (build plan §11) — /run cannot execute an unpreviewed spec.
  // Bumping specRev also strands any in-flight /preview response (Codex P1).
  const invalidatePreview = useCallback(() => {
    specRev.current += 1;
    if (expiryTimerRef.current) {
      clearTimeout(expiryTimerRef.current);
      expiryTimerRef.current = null;
    }
    setPreview(null);
    setPreviewError(null);
    setReady(null);
    setDownloadExpired(false);
    setProgress(null);
    setTruncation(null);
    setRunError(null);
  }, []);

  // P3 — on unmount: mark unmounted, abort an in-flight SSE fetch, clear the
  // expiry timer. The mounted flag makes the post-await setState guards fire.
  useEffect(() => () => {
    mountedRef.current = false;
    if (abortRef.current) abortRef.current.abort();
    if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
  }, []);

  const patchRow = (id, patch) => {
    setFilters((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const next = { ...r, ...patch };
        // Axis change: snap op to a legal one for the new axis kind.
        if (patch.axis && patch.axis !== r.axis) {
          const kind = AXES[patch.axis].kind;
          const legal = OPS_BY_KIND[kind].map(([v]) => v);
          if (!legal.includes(next.op)) next.op = legal[0];
          next.value = '';
          next.values = [];
          next.from = '';
          next.to = '';
        }
        return next;
      })
    );
    invalidatePreview();
  };

  // Only COMPLETE rows are emitted; an incomplete row never leaks a
  // placeholder predicate. With zero (or all-incomplete) rows this is the
  // valid filters:[] = every-request-row baseline.
  const querySpec = useMemo(
    () => ({
      version: 1,
      filters: filters.filter(rowComplete).map(toSpecFilter),
      eraScope,
      excludeOperational,
      excludeTestRecords,
      ...(programRollup ? { programRollup: 'optionB' } : {}),
      columns: { default: useDefaultColumns },
    }),
    [filters, eraScope, excludeOperational, excludeTestRecords, programRollup, useDefaultColumns]
  );

  // Every present row must be complete before /preview is allowed — so the
  // user is never surprised that a half-filled row was silently dropped.
  // (filters:[] ⇒ every() true ⇒ the all-rows baseline stays runnable.)
  const specComplete = filters.every(rowComplete);
  const busy = previewing || running;

  const taxOptions = (axis) => {
    if (!tax) return [];
    const key = AXES[axis].taxonomy;
    if (key === 'statuses') return (tax.statuses || []).map((s) => ({ value: s, label: s }));
    if (key === 'requestTypeOptions') {
      return (tax.requestTypeOptions || []).map((o) => ({
        value: String(o.value),
        label: `${o.label} (${o.value})`,
      }));
    }
    return (tax[key] || []).map((x) => ({ value: x.id, label: x.name }));
  };

  const handlePreview = async () => {
    // Snapshot the spec revision; if it changes (any edit) before this
    // response lands, the response is stale and is dropped wholesale —
    // including resultToken — so the run button can never be revealed
    // bound to a spec the user already edited away from (Codex P1).
    const myRev = specRev.current;
    setPreviewing(true);
    setPreviewError(null);
    setPreview(null);
    setReady(null);
    setDownloadExpired(false);
    setRunError(null);
    setProgress(null);
    setTruncation(null);
    setTopError(null);
    try {
      const resp = await fetch('/api/dataverse-export/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ querySpec }),
      });
      const data = await resp.json();
      // Stale (spec edited mid-flight) or unmounted ⇒ drop the response
      // wholesale; the finally below still clears the spinner so the UI
      // can never get stuck disabled (Codex S161 confirm P1a).
      if (!mountedRef.current || myRev !== specRev.current) return;
      if (!resp.ok) {
        setPreviewError(data);
        return;
      }
      setPreview(data);
    } catch (err) {
      if (mountedRef.current && myRev === specRev.current) {
        setTopError(err.message || 'Preview request failed.');
      }
    } finally {
      if (mountedRef.current) setPreviewing(false);
    }
  };

  const handleRun = async () => {
    if (!preview?.resultToken) return;
    setRunning(true);
    setRunError(null);
    setReady(null);
    setDownloadExpired(false);
    setProgress(null);
    setTruncation(null);
    setTopError(null);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const response = await fetch('/api/dataverse-export/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resultToken: preview.resultToken }),
        signal: ac.signal,
      });

      // Pre-stream gate failures come back as a clean JSON 4xx/5xx, not SSE.
      if (!response.ok) {
        let data = {};
        try {
          data = await response.json();
        } catch {
          /* non-JSON body */
        }
        setRunError({
          stage: 'gate',
          message:
            data.message ||
            `The run was rejected before it started (${response.status}). Re-preview and try again.`,
          retryable: false,
        });
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const handle = (evt) => {
        if (evt.event === 'progress') {
          setProgress({
            stage: evt.stage,
            pages: evt.pages || 0,
            fetched: evt.fetched || 0,
            total: evt.total,
          });
        } else if (evt.event === 'truncated') {
          setTruncation({ reason: evt.reason, total: evt.total, fetched: evt.fetched });
        } else if (evt.event === 'ready') {
          setReady(evt);
          setDownloadExpired(false);
          // P2 — the download token is short-lived; when it elapses, swap
          // the link for an in-app "expired, re-run" message rather than
          // letting the user land on a raw 403 JSON page.
          if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
          if (evt.expiresInSec) {
            expiryTimerRef.current = setTimeout(
              () => setDownloadExpired(true),
              evt.expiresInSec * 1000
            );
          }
        } else if (evt.event === 'error') {
          setRunError({ stage: evt.stage, message: evt.message, retryable: !!evt.retryable });
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            handle(JSON.parse(line.slice(6)));
          } catch {
            /* skip malformed frame */
          }
        }
      }
      if (buffer.startsWith('data: ')) {
        try {
          handle(JSON.parse(buffer.slice(6)));
        } catch {
          /* skip */
        }
      }
    } catch (err) {
      // An intentional abort (unmount) is not a user-facing failure.
      if (err && err.name === 'AbortError') return;
      if (mountedRef.current) {
        setRunError({
          stage: 'transport',
          message: err.message || 'The export stream was interrupted.',
          retryable: true,
        });
      }
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      // Skip post-unmount setState (the unmount abort lands here too —
      // Codex S161 confirm P3).
      if (mountedRef.current) setRunning(false);
    }
  };

  const fmt = (n) => (typeof n === 'number' ? n.toLocaleString() : n);

  return (
    <Layout>
      <PageHeader
        icon="📤"
        title="Dataverse Bulk Export"
        subtitle="A plain-English filter builder over the grant request store. Every fan-out is an explicit choice; the true total is the real FetchXML count (never the 5,000 cap); truncation is loud; the artifact ships with a baked-in Methods sheet."
      />

      <ErrorAlert message={topError} onDismiss={() => setTopError(null)} />

      {/* Fail-loud taxonomy state */}
      {taxLoading && (
        <Card className="mb-6">
          <p className="text-sm text-gray-600">Loading the live taxonomy…</p>
        </Card>
      )}
      {taxError && (
        <Card className="mb-6 border-red-300 bg-red-50">
          <h2 className="text-lg font-semibold text-red-900 mb-1">
            Taxonomy unavailable — builder disabled
          </h2>
          <p className="text-sm text-red-800">{taxError}</p>
          <p className="text-sm text-red-800 mt-2">
            This is an actionable Dataverse / connectivity condition, not a soft warning. Refusing
            to show a stale or partial list. Retry once it is resolved.
          </p>
        </Card>
      )}

      {tax && (
        <>
          {/* ── Scope: forced explicit choices ── */}
          <Card className="mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Scope — explicit choices</h2>
            <p className="text-xs text-gray-500 mb-4">
              These are not hidden defaults. Each one changes what the export contains; you choose
              them deliberately and the Methods sheet records exactly what was applied.
            </p>

            <fieldset disabled={busy} className="border-0 m-0 p-0 min-w-0 disabled:opacity-60">
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Era scope <span className="font-normal text-gray-500">(record-creation provenance — NOT a business period)</span>
              </label>
              <select
                value={eraScope}
                onChange={(e) => {
                  setEraScope(e.target.value);
                  invalidatePreview();
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              >
                <option value="all">All eras (era is a disclosure column, no partition)</option>
                <option value="migrated">Migrated only (pre-cutover Blackbaud/Sky records)</option>
                <option value="native">Native only (AkoyaGO-born records)</option>
              </select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={excludeOperational}
                  onChange={(e) => {
                    setExcludeOperational(e.target.checked);
                    invalidatePreview();
                  }}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium text-gray-900">Exclude operational rows</span>
                  <span className="block text-xs text-gray-600">
                    Site/office visits, phone interactions, research-reviewer honoraria. Unchecking
                    includes interaction logs / honoraria in the result.
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={excludeTestRecords}
                  onChange={(e) => {
                    setExcludeTestRecords(e.target.checked);
                    invalidatePreview();
                  }}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium text-gray-900">Exclude test records</span>
                  <span className="block text-xs text-gray-600">
                    Native-era rows whose applicant is the Foundation itself (test clones).
                    Included with disclosure if unchecked.
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={programRollup}
                  onChange={(e) => {
                    setProgramRollup(e.target.checked);
                    invalidatePreview();
                  }}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium text-gray-900">Program roll-up (Option B)</span>
                  <span className="block text-xs text-gray-600">
                    A program total counts <code>type = Program</code> rows only; Special
                    Projects/Grants report as separate lines (applied by the disclosure engine).
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={useDefaultColumns}
                  onChange={(e) => {
                    setUseDefaultColumns(e.target.checked);
                    invalidatePreview();
                  }}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium text-gray-900">Default column set</span>
                  <span className="block text-xs text-gray-600">
                    The S159-closed default contract (with per-row sentinels, era, and resolved
                    institution). An explicit choice — no implicit default.
                  </span>
                </span>
              </label>
            </div>
            </fieldset>
          </Card>

          {/* ── Filters ── */}
          <Card className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-gray-900">Filters</h2>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setFilters((p) => [...p, newRow()]);
                  invalidatePreview();
                }}
                className="text-sm text-gray-700 border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40"
              >
                + Add filter
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              All filters are combined with AND. No filters = every request row — a valid
              baseline, but the true total will be large and the run will truncate loudly.
            </p>

            {filters.length === 0 && (
              <div className="border border-dashed border-gray-300 rounded-lg p-4 text-sm text-gray-500 mb-4">
                No filters yet. Preview will count <span className="font-medium">every request
                row</span> (expect a large total and a loud truncation). Add a filter to narrow
                the export.
              </div>
            )}

            <fieldset disabled={busy} className="border-0 m-0 p-0 min-w-0 space-y-4 disabled:opacity-60">
              {filters.map((row) => {
                const kind = AXES[row.axis].kind;
                const ops = OPS_BY_KIND[kind];
                const isTax = !!AXES[row.axis].taxonomy;
                const opts = isTax ? taxOptions(row.axis) : [];
                const incomplete = !rowComplete(row);
                return (
                  <div
                    key={row.id}
                    className={`border rounded-lg p-3 ${
                      incomplete
                        ? 'border-amber-300 bg-amber-50'
                        : 'border-gray-200 bg-gray-50'
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={row.axis}
                        onChange={(e) => patchRow(row.id, { axis: e.target.value })}
                        className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm bg-white"
                      >
                        {Object.entries(AXES).map(([k, def]) => (
                          <option key={k} value={k}>
                            {def.label}
                          </option>
                        ))}
                      </select>

                      {row.axis === 'amount' && (
                        <select
                          value={row.which}
                          onChange={(e) => patchRow(row.id, { which: e.target.value })}
                          className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm bg-white"
                        >
                          {AMOUNT_WHICH.map(([v, l]) => (
                            <option key={v} value={v}>
                              {l}
                            </option>
                          ))}
                        </select>
                      )}

                      <select
                        value={row.op}
                        onChange={(e) => patchRow(row.id, { op: e.target.value })}
                        className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm bg-white"
                      >
                        {ops.map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </select>

                      {/* Value control — shaped by axis kind + op */}
                      {!VALUELESS_OPS.has(row.op) && (
                        <div className="flex-1 min-w-[200px]">
                          {row.op === 'between' ? (
                            <div className="flex items-center gap-2">
                              <input
                                type={kind === 'date' ? 'date' : 'number'}
                                value={row.from}
                                onChange={(e) => patchRow(row.id, { from: e.target.value })}
                                placeholder="from"
                                className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                              />
                              <span className="text-gray-400 text-sm">…</span>
                              <input
                                type={kind === 'date' ? 'date' : 'number'}
                                value={row.to}
                                onChange={(e) => patchRow(row.id, { to: e.target.value })}
                                placeholder="to"
                                className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                              />
                            </div>
                          ) : row.op === 'in' && isTax ? (
                            <MultiSelect
                              options={opts}
                              selected={row.values}
                              onChange={(vals) => patchRow(row.id, { values: vals })}
                            />
                          ) : row.op === 'in' ? (
                            <input
                              type="text"
                              value={row.values.join(', ')}
                              onChange={(e) =>
                                patchRow(row.id, {
                                  values: e.target.value
                                    .split(',')
                                    .map((s) => s.trim())
                                    .filter(Boolean),
                                })
                              }
                              placeholder="comma-separated values"
                              className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                            />
                          ) : isTax ? (
                            <select
                              value={row.value}
                              onChange={(e) => patchRow(row.id, { value: e.target.value })}
                              className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm bg-white"
                            >
                              <option value="">— select —</option>
                              {opts.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type={
                                kind === 'date'
                                  ? 'date'
                                  : kind === 'money'
                                  ? 'number'
                                  : 'text'
                              }
                              value={row.value}
                              onChange={(e) => patchRow(row.id, { value: e.target.value })}
                              placeholder={
                                kind === 'money'
                                  ? 'amount'
                                  : AXES[row.axis].label.toLowerCase()
                              }
                              className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                            />
                          )}
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          setFilters((p) => p.filter((r) => r.id !== row.id));
                          invalidatePreview();
                        }}
                        className="text-xs text-gray-500 hover:text-red-600 px-2"
                        title="Remove this filter"
                      >
                        ✕
                      </button>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">{AXES[row.axis].help}</p>
                    {incomplete && (
                      <p className="text-xs text-amber-700 mt-1 font-medium">
                        Incomplete — give this filter a value, or remove it. It will not be
                        previewed until then.
                      </p>
                    )}
                  </div>
                );
              })}
            </fieldset>

            <div className="mt-5">
              <Button
                onClick={handlePreview}
                loading={previewing}
                disabled={busy || !specComplete}
              >
                {previewing ? 'Computing true total…' : 'Preview (true count + composition)'}
              </Button>
              {!specComplete && (
                <p className="mt-2 text-xs text-amber-700 font-medium">
                  One or more filters are incomplete. Complete or remove them before previewing —
                  a half-filled filter is never silently dropped or guessed.
                </p>
              )}
              <p className="mt-2 text-xs text-gray-500">
                Preview computes the real FetchXML aggregate count and composition. You must
                preview before you can run — the run can only execute a spec you have seen.
              </p>
            </div>
          </Card>

          {/* ── Preview error (fail-loud, legible) ── */}
          {previewError && (
            <Card className="mb-6 border-red-300 bg-red-50">
              <h2 className="text-lg font-semibold text-red-900 mb-2">
                {previewError.error === 'INVALID_QUERYSPEC'
                  ? 'The filter spec is invalid'
                  : previewError.error === 'OPERATIONAL_EXCLUSION_UNRESOLVED'
                  ? 'Operational exclusion could not be honored'
                  : 'Preview failed'}
              </h2>
              {previewError.message && (
                <p className="text-sm text-red-800 mb-2">{previewError.message}</p>
              )}
              {Array.isArray(previewError.violations) && (
                <ul className="text-sm text-red-800 list-disc pl-5 space-y-1">
                  {previewError.violations.map((v, i) => (
                    <li key={i}>
                      <span className="font-mono text-xs bg-red-100 px-1 rounded">{v.code}</span>{' '}
                      at <span className="font-mono text-xs">{v.path}</span> — {v.detail}
                    </li>
                  ))}
                </ul>
              )}
              {Array.isArray(previewError.appliedRules) && previewError.appliedRules.length > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm text-red-900 font-medium">
                    Applied rules so far
                  </summary>
                  <ul className="mt-2 text-xs text-red-800 list-disc pl-5 space-y-1">
                    {previewError.appliedRules.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </details>
              )}
            </Card>
          )}

          {/* ── Preview / confirm panel ── */}
          {preview && (
            <Card className="mb-6 border-gray-300">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">
                Preview — review before you run
              </h2>

              <div className="bg-gray-900 text-white rounded-lg p-4 mb-4">
                <div className="text-sm text-gray-300">True total (FetchXML aggregate count)</div>
                <div className="text-4xl font-bold">{fmt(preview.trueTotal)}</div>
                <div className="text-xs text-gray-400 mt-1">
                  This is the real count — never the OData /$count 5,000 cap.
                </div>
              </div>

              {/* Exclusion waterfall — surprising-but-correct numbers must
                  never be misread (matched → −operational → −test → exported). */}
              {preview.composition && (
                <div className="border border-gray-300 rounded-lg p-4 mb-4">
                  <div className="text-sm font-medium text-gray-700 mb-2">
                    How this total was reached
                  </div>
                  <div className="font-mono text-sm space-y-1">
                    <div className="flex justify-between">
                      <span>Rows matching your filters</span>
                      <span className="font-semibold">{fmt(preview.composition.matched)}</span>
                    </div>
                    {preview.composition.operationalApplied ? (
                      <div className="flex justify-between text-amber-700">
                        <span>− excluded as operational interaction logs
                          {' '}(Office/Site Visit, phone, honoraria)</span>
                        <span className="font-semibold">
                          −{fmt(preview.composition.excludedOperational)}
                        </span>
                      </div>
                    ) : (
                      <div className="flex justify-between text-gray-500">
                        <span>operational rows INCLUDED (toggle off)</span><span>—</span>
                      </div>
                    )}
                    {preview.composition.testRecordsApplied ? (
                      <div className="flex justify-between text-amber-700">
                        <span>− excluded as test records (Foundation-applicant, native)</span>
                        <span className="font-semibold">
                          −{fmt(preview.composition.excludedTestRecords)}
                        </span>
                      </div>
                    ) : (
                      <div className="flex justify-between text-gray-500">
                        <span>test records INCLUDED (toggle off)</span><span>—</span>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-gray-300 pt-1 mt-1">
                      <span className="font-semibold">Exported (this run)</span>
                      <span className="font-bold">{fmt(preview.composition.exported)}</span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    {preview.composition.sequencing}
                  </p>
                </div>
              )}

              {preview.estimate?.note && (
                <div
                  className={`text-sm rounded-lg p-3 mb-4 ${
                    preview.trueTotal > 50000
                      ? 'bg-amber-50 border border-amber-300 text-amber-900'
                      : 'bg-gray-50 border border-gray-200 text-gray-700'
                  }`}
                >
                  {preview.trueTotal > 50000 ? '⚠ ' : ''}
                  {preview.estimate.note}
                </div>
              )}

              {/* Composition / era split */}
              <div className="mb-4">
                <div className="text-sm font-medium text-gray-700 mb-1">Era composition</div>
                {preview.eraSplit?.otherEraOutOfScope ? (
                  <p className="text-sm text-gray-700">
                    Era-scoped to <span className="font-medium">{preview.eraSplit.scope}</span> —{' '}
                    {fmt(preview.eraSplit.count)} rows (the other era is out of scope by your
                    choice).
                  </p>
                ) : (
                  <p className="text-sm text-gray-700">
                    {fmt(preview.eraSplit?.migrated)} migrated · {fmt(preview.eraSplit?.native)}{' '}
                    native{' '}
                    {preview.eraSplit && !preview.eraSplit.reconciles && (
                      <span className="text-amber-700 font-medium">
                        (⚠ migrated + native ≠ true total — surfaced, not hidden)
                      </span>
                    )}
                  </p>
                )}
                {preview.compositionNote && (
                  <p className="text-xs text-gray-500 mt-1">{preview.compositionNote}</p>
                )}
              </div>

              {/* Taxonomy warnings — 0-match literals */}
              {preview.taxonomyWarnings?.length > 0 && (
                <div className="mb-4 bg-amber-50 border border-amber-300 rounded-lg p-3">
                  <div className="text-sm font-medium text-amber-900 mb-1">
                    Filter values not in the current taxonomy
                  </div>
                  <ul className="text-sm text-amber-800 list-disc pl-5 space-y-1">
                    {preview.taxonomyWarnings.map((w, i) => (
                      <li key={i}>{w.message}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Plain-English applied rules */}
              {preview.appliedRules?.length > 0 && (
                <details className="mb-4" open>
                  <summary className="cursor-pointer text-sm text-gray-900 font-medium">
                    What will be applied ({preview.appliedRules.length} rules, plain English)
                  </summary>
                  <ul className="mt-2 text-sm text-gray-700 list-disc pl-5 space-y-1">
                    {preview.appliedRules.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </details>
              )}

              <details className="mb-4">
                <summary className="cursor-pointer text-sm text-gray-600 font-medium">
                  Compiled FetchXML (for inspection)
                </summary>
                <pre className="mt-2 text-xs whitespace-pre-wrap bg-gray-50 border border-gray-200 rounded p-2 max-h-64 overflow-auto">
                  {preview.compiledFetchXml}
                </pre>
              </details>

              <Button onClick={handleRun} loading={running} disabled={running}>
                {running ? 'Running export…' : `Confirm & run export (${fmt(preview.trueTotal)} rows)`}
              </Button>
              {preview.resultTokenExpiresInSec && (
                <p className="mt-2 text-xs text-gray-500">
                  This confirmation is valid for ~{Math.round(preview.resultTokenExpiresInSec / 60)}{' '}
                  min. Editing any filter above invalidates it — you will re-preview.
                </p>
              )}
            </Card>
          )}

          {/* ── Run progress / outcome ── */}
          {(progress || truncation || ready || runError) && (
            <Card className="mb-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Export run</h2>

              {progress && !ready && !runError && (
                <div className="text-sm text-gray-700 mb-3">
                  <div className="flex items-center gap-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-gray-900 border-t-transparent" />
                    <span>
                      {progress.stage === 'count'
                        ? `Counted ${fmt(progress.total)} rows — starting to page…`
                        : `Paging — ${fmt(progress.fetched)} of ${fmt(progress.total)} fetched (${fmt(
                            progress.pages
                          )} pages)`}
                    </span>
                  </div>
                </div>
              )}

              {truncation && (
                <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 mb-3">
                  <div className="text-base font-semibold text-amber-900 mb-1">
                    ⚠ Result truncated —{' '}
                    {truncation.reason === 'cap'
                      ? 'hit the 50,000-row hard cap'
                      : 'hit the time budget'}
                  </div>
                  <p className="text-sm text-amber-900">
                    <span className="font-bold">{fmt(truncation.total)}</span> rows match your
                    filter; <span className="font-bold">{fmt(truncation.fetched)}</span> were
                    written to the file. This is <span className="font-semibold">not</span> a
                    complete export. Narrow by program / year / status / institution and re-run for
                    a complete set. The truncated file is still produced and is clearly labelled in
                    its Methods sheet.
                  </p>
                </div>
              )}

              {ready && (
                <div className="bg-green-50 border border-green-300 rounded-lg p-4">
                  <div className="text-base font-semibold text-green-900 mb-1">
                    {ready.truncated ? 'Export ready (truncated — see above)' : 'Export ready'}
                  </div>
                  <p className="text-sm text-green-900 mb-3">
                    {fmt(ready.rows)} rows · {(ready.bytes / 1024 / 1024).toFixed(2)} MB
                    {typeof ready.trueTotal === 'number' && (
                      <> · true total {fmt(ready.trueTotal)}</>
                    )}
                  </p>
                  {downloadExpired ? (
                    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                      <span className="font-semibold">Download link expired.</span> The file is
                      unchanged but the single-purpose link has timed out. Re-run the export to
                      get a fresh link.
                    </div>
                  ) : (
                    <>
                      <a
                        href={ready.downloadUrl}
                        className="inline-flex items-center justify-center font-semibold rounded-lg px-6 py-3 bg-gray-900 hover:bg-gray-800 text-white"
                      >
                        ⬇ Download Excel
                      </a>
                      {ready.expiresInSec && (
                        <p className="mt-2 text-xs text-green-800">
                          Link valid ~{Math.round(ready.expiresInSec / 60)} min (authenticated,
                          single-purpose). Re-run the export for a fresh link.
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}

              {runError && (
                <div className="bg-red-50 border border-red-300 rounded-lg p-4">
                  <div className="text-base font-semibold text-red-900 mb-1">
                    Export failed — nothing was produced
                  </div>
                  <p className="text-sm text-red-900">
                    Stage: <span className="font-mono text-xs">{runError.stage}</span>.{' '}
                    {runError.message}
                  </p>
                  <p className="text-sm text-red-900 mt-2">
                    No file was written — there is nothing to download. A failure can never present
                    as a short-but-complete file.
                    {runError.retryable
                      ? ' This condition is retryable.'
                      : ' Re-preview and adjust the filter before retrying.'}
                  </p>
                  {runError.retryable && preview?.resultToken && (
                    <div className="mt-3">
                      <Button onClick={handleRun} loading={running} disabled={running}>
                        Retry run
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </Card>
          )}
        </>
      )}
    </Layout>
  );
}

export default function Page() {
  return (
    <RequireAppAccess appKey="dataverse-bulk-export">
      <DataverseBulkExport />
    </RequireAppAccess>
  );
}
