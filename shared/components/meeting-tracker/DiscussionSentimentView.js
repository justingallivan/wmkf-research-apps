/**
 * Discussion Sentiment: compare how staff discussed the proposals staff choose (plan §4.5).
 * Staff tick proposals from a cycle's site visits, then analyze each one; the comparison table is built
 * from the stored per-proposal results. Nothing is read for a proposal until staff choose it.
 * Every response is applied only while its row is still selected, still the latest request for that
 * row, and the page is mounted.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { requestEnvelope } from '../../utils/api-request';
import { sortSentimentRows } from '../../utils/discussion-sentiment-order';
import Layout, { PageHeader } from '../Layout';
import ToolbarSelect from '../ToolbarSelect';

const DATE_TIME = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const fmt = (formatter, value) => {
  const date = new Date(value || '');
  return Number.isFinite(date.getTime()) ? formatter.format(date) : '';
};
const label = (value) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : '');

const STATUS = {
  no_transcript: { text: 'No staff discussion transcript', tone: 'text-gray-600' },
  not_analyzed: { text: 'Not analyzed', tone: 'text-gray-700' },
  analyzing: { text: 'Analyzing…', tone: 'text-blue-800' },
  current: { text: 'Current', tone: 'text-green-800' },
  out_of_date: { text: 'Out of date', tone: 'text-amber-800' },
};

const buttonClass = 'rounded-lg border px-3 py-2 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
const outlineButton = `${buttonClass} border-gray-300 bg-white text-gray-800 hover:bg-gray-50`;
const solidButton = `${buttonClass} border-gray-900 bg-gray-900 text-white hover:bg-gray-800`;

function Evidence({ items }) {
  return (
    <ul className="mt-1 space-y-2">
      {items.map((item, index) => (
        <li key={index} className="text-sm text-gray-800">
          <q>{item.quote}</q>
          <span className="ml-2 text-gray-500">{item.speaker || item.speakerLabel || 'Unidentified speaker'} · {item.time}</span>
        </li>
      ))}
    </ul>
  );
}

function EvidencePanel({ record }) {
  const sections = [
    ['What staff liked', record.supportPoints],
    ['What staff criticized', record.concernPoints],
  ];
  return (
    <div className="space-y-4 text-sm">
      {sections.map(([title, items]) => items.length > 0 && (
        <section key={title}><h4 className="font-semibold text-gray-900">{title}</h4><Evidence items={items} /></section>
      ))}
      {record.disagreements.length > 0 && (
        <section>
          <h4 className="font-semibold text-gray-900">Where staff disagreed</h4>
          {record.disagreements.map((item, index) => (
            <div key={index} className="mt-2"><p className="text-gray-800">{item.topic}</p><Evidence items={item.sides} /></div>
          ))}
        </section>
      )}
      {record.uncertainties.length > 0 && (
        <section>
          <h4 className="font-semibold text-gray-900">Where staff were unsure</h4>
          {record.uncertainties.map((item, index) => (
            <div key={index} className="mt-2"><p className="text-gray-800">{item.topic}</p><Evidence items={item.evidence} /></div>
          ))}
        </section>
      )}
    </div>
  );
}

/** One chosen proposal's row (plus its evidence row when expanded). */
function SentimentRow({ row, expanded, onToggle, onAnalyze, onRefresh, onAccept, onWithdraw, onRemove }) {
  const { proposal, phase, data, error, busy } = row;
  const state = busy === 'analyzing' ? 'analyzing' : data?.state;
  const status = STATUS[state];
  const record = data?.runCurrent ? data.run?.record : null;
  const run = data?.run;
  const accepted = data?.accepted;
  const acceptedThisRun = Boolean(accepted && run && accepted.id === run.id);
  const canAccept = phase === 'ready' && Boolean(record) && !acceptedThisRun && state !== 'no_transcript';
  const canAnalyze = phase === 'ready' && state && state !== 'no_transcript';
  const working = Boolean(busy);
  return (
    <>
      <tr className="border-t border-gray-200 align-top">
        <td className="py-3 pr-3">
          <p className="font-semibold text-gray-900">#{proposal.requestNumber}</p>
          <p className="text-sm text-gray-700">{proposal.title || 'Untitled request'}</p>
          <p className="text-xs text-gray-500">{fmt(DAY, proposal.siteVisit?.scheduledStartIso)}</p>
        </td>
        <td className="py-3 pr-3 text-sm">{record ? label(record.reception) : '—'}</td>
        <td className="py-3 pr-3 text-sm">{record ? label(record.enthusiasm) : '—'}</td>
        <td className="max-w-md py-3 pr-3 text-sm text-gray-800">
          {record ? record.headline : null}
          {record && !acceptedThisRun && <p className="mt-1 text-xs font-semibold text-amber-800">AI analysis; check the quotes</p>}
        </td>
        <td className="py-3 pr-3 text-sm">{record ? record.disagreements.length : '—'}</td>
        <td className="py-3 pr-3 text-sm">{record ? record.uncertainties.length : '—'}</td>
        <td className="py-3">
          {phase === 'loading' && <p className="text-sm text-gray-600" aria-live="polite">Checking…</p>}
          {status && <p className={`text-sm font-semibold ${status.tone}`} aria-live="polite">{status.text}</p>}
          {accepted && (
            <p className="mt-1 text-xs text-gray-600">
              Accepted{accepted.acceptedByName ? ` by ${accepted.acceptedByName}` : ''} on {fmt(DATE_TIME, accepted.acceptedAt)}
              {accepted.current ? '' : ' (out of date)'}
            </p>
          )}
          {busy === 'analyzing' && <p className="mt-1 text-xs text-gray-600">This can take a few minutes. Keep this page open.</p>}
          {state === 'analyzing' && busy !== 'analyzing' && (
            <button type="button" className={`${outlineButton} mt-2`} onClick={onRefresh}>Check again</button>
          )}
          {error && <p className="mt-1 text-sm text-red-700" role="alert">{error}</p>}
          {!error && data?.lastRunFailed && state !== 'analyzing' && <p className="mt-1 text-sm text-amber-900">The last analysis did not finish. Try again.</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            {canAnalyze && (
              <button type="button" className={outlineButton} disabled={working || state === 'analyzing'} onClick={onAnalyze}>
                {state === 'not_analyzed' ? 'Analyze' : 'Re-analyze'}
              </button>
            )}
            {canAccept && <button type="button" className={solidButton} disabled={working} onClick={onAccept}>Accept</button>}
            {accepted && phase === 'ready' && <button type="button" className={outlineButton} disabled={working} onClick={onWithdraw}>Withdraw</button>}
            {phase === 'error' && <button type="button" className={outlineButton} onClick={onRefresh}>Try again</button>}
            {record && (
              <button type="button" className={outlineButton} aria-expanded={expanded} onClick={onToggle}>
                {expanded ? 'Hide evidence' : 'Show evidence'}
              </button>
            )}
            <button type="button" className={outlineButton} disabled={working} onClick={onRemove}>Remove</button>
          </div>
        </td>
      </tr>
      {expanded && record && (
        <tr><td colSpan={7} className="bg-gray-50 px-4 py-4"><EvidencePanel record={record} /></td></tr>
      )}
    </>
  );
}

export default function DiscussionSentimentView() {
  const [programId, setProgramId] = useState('');
  const [cycleCode, setCycleCode] = useState('');
  const [programs, setPrograms] = useState([]);
  const [cycles, setCycles] = useState([]);
  const [proposals, setProposals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rows, setRows] = useState({});
  const [order, setOrder] = useState([]);
  const [expanded, setExpanded] = useState({});
  const mountedRef = useRef(true);
  const loadToken = useRef(0);
  const selectedRef = useRef(new Set());
  const rowSeq = useRef({});
  // Bumped each time a proposal is ticked, so an action started before an untick never writes to a re-ticked row.
  const pickSeq = useRef({});

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const load = useCallback(async (nextProgramId, nextCycleCode) => {
    const token = ++loadToken.current;
    setLoading(true);
    setError(null);
    const fetchDashboard = async (programKey, cycleKey) => {
      const query = new URLSearchParams({ projection: 'schedule', scope: 'all' });
      if (programKey) query.set('programId', programKey);
      if (cycleKey) query.set('cycleCode', cycleKey);
      const envelope = await requestEnvelope(`/api/meeting-tracker/dashboard?${query}`, { tolerantBody: true });
      if (!envelope.ok) throw new Error(envelope.data?.error || 'The site visits could not be loaded. Try again.');
      return envelope.data;
    };
    try {
      let body = await fetchDashboard(nextProgramId, nextCycleCode);
      if (!mountedRef.current || token !== loadToken.current) return;
      setPrograms((current) => body.programs || current);
      setCycles((current) => body.cycles || current);
      if (!nextProgramId && body.programId) setProgramId(body.programId);
      let visits = body.proposals || [];
      if (!nextCycleCode) {
        // The no-cycle response lists cycles only; load the default cycle's visits next.
        const defaultCycle = body.defaultCycleCode || body.cycles?.[0]?.code || '';
        setCycleCode(defaultCycle);
        visits = [];
        if (defaultCycle) {
          body = await fetchDashboard(nextProgramId || body.programId || '', defaultCycle);
          if (!mountedRef.current || token !== loadToken.current) return;
          visits = body.proposals || [];
        }
      }
      setProposals(visits);
      setLoading(false);
    } catch (loadError) {
      if (!mountedRef.current || token !== loadToken.current) return;
      setError(loadError.message);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load('', ''); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const patchRow = (id, patch) => setRows((current) => (current[id] ? { ...current, [id]: { ...current[id], ...patch } } : current));
  // A response is applied only while the row is selected, is still the newest request for it, and the page is mounted.
  const beginRequest = (id) => {
    const seq = (rowSeq.current[id] || 0) + 1;
    rowSeq.current[id] = seq;
    return () => mountedRef.current && selectedRef.current.has(id) && rowSeq.current[id] === seq;
  };

  const base = (id) => `/api/meeting-tracker/visits/${encodeURIComponent(id)}/discussion-sentiment`;

  // carryError keeps an action's failure message visible while the row reloads.
  const refresh = useCallback(async (id, carryError = null) => {
    const isLive = beginRequest(id);
    patchRow(id, { phase: 'loading', error: carryError });
    let envelope = null;
    try {
      envelope = await requestEnvelope(base(id), { tolerantBody: true });
    } catch {
      envelope = null;
    }
    if (!isLive()) return;
    if (envelope?.ok) patchRow(id, { phase: 'ready', data: envelope.data, error: carryError });
    else patchRow(id, { phase: 'error', error: carryError || envelope?.data?.error || 'The analysis could not be loaded. Try again.' });
  }, []);

  const act = async (id, busy, path, body) => {
    // The picker checkbox can still untick a working row, so apply the result only if the row is still
    // selected (and not unticked and re-ticked since) and the page is mounted.
    const pick = pickSeq.current[id];
    const alive = () => mountedRef.current && selectedRef.current.has(id) && pickSeq.current[id] === pick;
    patchRow(id, { busy, error: null });
    let message = null;
    try {
      const envelope = await requestEnvelope(`${base(id)}${path}`, { method: 'POST', body, tolerantBody: true });
      if (!envelope.ok) message = envelope.data?.error || 'That did not work. Try again.';
    } catch {
      message = 'That did not work. Check your connection and try again.';
    }
    if (!alive()) return;
    patchRow(id, { busy: null, error: message });
    await refresh(id, message);
  };

  const toggle = (proposal) => {
    const id = proposal.requestId;
    if (selectedRef.current.has(id)) {
      selectedRef.current.delete(id);
      setRows((current) => { const next = { ...current }; delete next[id]; return next; });
      setOrder((current) => current.filter((value) => value !== id));
      return;
    }
    selectedRef.current.add(id);
    pickSeq.current[id] = (pickSeq.current[id] || 0) + 1;
    setRows((current) => ({ ...current, [id]: { proposal, phase: 'loading', data: null, error: null, busy: null } }));
    setOrder((current) => [...current, id]);
    void refresh(id);
  };

  const inRange = (proposal) => {
    const start = proposal.siteVisit?.scheduledStartIso;
    if (!from && !to) return true;
    if (!start) return false;
    const day = start.slice(0, 10);
    return (!from || day >= from) && (!to || day <= to);
  };
  const visible = proposals.filter((proposal) => proposal.siteVisit && inRange(proposal));
  const hiddenNoVisit = proposals.filter((proposal) => !proposal.siteVisit).length;

  const selectedRows = sortSentimentRows(order.map((id) => ({ ...rows[id], id, record: rows[id]?.data?.runCurrent ? rows[id].data.run?.record : null })));

  return (
    <Layout title="Discussion Sentiment">
      <PageHeader title="Discussion Sentiment" subtitle="Compare how staff received the proposals you choose, with quotes from the staff discussion." />
      <p className="mb-4 text-sm text-gray-600">
        <Link href="/meeting-tracker" className="font-semibold text-blue-700 underline underline-offset-4">Back to Meeting Tracker</Link>
      </p>

      <div className="mb-6 flex flex-wrap items-end gap-4">
        <ToolbarSelect id="sentiment-program" label="Grant program" value={programId} disabled={!programs.length}
          onChange={(event) => { setProgramId(event.target.value); setCycleCode(''); void load(event.target.value, ''); }}>
          {!programs.length && <option value="">Loading programs…</option>}
          {programs.map((program) => <option key={program.programId} value={program.programId}>{program.name}</option>)}
        </ToolbarSelect>
        <ToolbarSelect id="sentiment-cycle" label="Grant cycle" value={cycleCode} disabled={!cycles.length}
          onChange={(event) => { setCycleCode(event.target.value); void load(programId, event.target.value); }}>
          {cycles.map((cycle) => <option key={cycle.code} value={cycle.code}>{cycle.label || cycle.code}</option>)}
        </ToolbarSelect>
        <label className="text-sm font-medium text-gray-700">Visit on or after
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="mt-1 block h-12 rounded-xl border border-gray-300 px-3 text-base" />
        </label>
        <label className="text-sm font-medium text-gray-700">Visit on or before
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="mt-1 block h-12 rounded-xl border border-gray-300 px-3 text-base" />
        </label>
      </div>

      {error && (
        <div role="alert" className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error} <button type="button" onClick={() => load(programId, cycleCode)} className="font-semibold underline underline-offset-4">Try again</button>.
        </div>
      )}

      <section aria-labelledby="sentiment-picker" className="mb-8">
        <h2 id="sentiment-picker" className="mb-2 text-lg font-semibold text-gray-900">Choose proposals</h2>
        {loading ? (
          <div className="rounded-xl border border-gray-200 bg-white p-6 text-gray-500">Loading site visits…</div>
        ) : visible.length ? (
          <ul className="divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white">
            {visible.map((proposal) => (
              <li key={proposal.requestId} className="flex items-center gap-3 px-4 py-3">
                <input id={`pick-${proposal.requestId}`} type="checkbox" className="h-5 w-5" checked={Boolean(rows[proposal.requestId])} onChange={() => toggle(proposal)} />
                <label htmlFor={`pick-${proposal.requestId}`} className="min-w-0 flex-1 text-sm text-gray-900">
                  <span className="font-semibold">#{proposal.requestNumber}</span> {proposal.title || 'Untitled request'}
                  <span className="ml-2 text-gray-500">{fmt(DAY, proposal.siteVisit.scheduledStartIso)}</span>
                </label>
              </li>
            ))}
          </ul>
        ) : (
          !error && <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-600">No site visits match. Choose another cycle or dates.</div>
        )}
        {!loading && hiddenNoVisit > 0 && <p className="mt-2 text-xs text-gray-500">{hiddenNoVisit} proposal{hiddenNoVisit === 1 ? ' has' : 's have'} no site visit and {hiddenNoVisit === 1 ? 'is' : 'are'} not listed.</p>}
      </section>

      <section aria-labelledby="sentiment-compare">
        <h2 id="sentiment-compare" className="mb-2 text-lg font-semibold text-gray-900">Comparison</h2>
        {selectedRows.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-600">Tick proposals above to compare them.</div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white px-4">
            <table className="w-full min-w-[56rem] text-left">
              <thead>
                <tr className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <th scope="col" className="py-3 pr-3">Proposal</th>
                  <th scope="col" className="py-3 pr-3">Reception</th>
                  <th scope="col" className="py-3 pr-3">Enthusiasm</th>
                  <th scope="col" className="py-3 pr-3">Headline</th>
                  <th scope="col" className="py-3 pr-3">Disagreements</th>
                  <th scope="col" className="py-3 pr-3">Uncertainties</th>
                  <th scope="col" className="py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {selectedRows.map((row) => (
                  <SentimentRow
                    key={row.id}
                    row={row}
                    expanded={Boolean(expanded[row.id])}
                    onToggle={() => setExpanded((current) => ({ ...current, [row.id]: !current[row.id] }))}
                    onAnalyze={() => act(row.id, 'analyzing', '', {})}
                    onRefresh={() => refresh(row.id)}
                    onAccept={() => act(row.id, 'accepting', '/accept', { runId: row.data.run.id })}
                    onWithdraw={() => act(row.id, 'withdrawing', '/withdraw', { runId: row.data.accepted.id })}
                    onRemove={() => toggle(row.proposal)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-gray-500">Rows are ordered by reception, then enthusiasm, then fewer disagreements, then fewer uncertainties. Only accepted analyses are shared beyond this page.</p>
      </section>
    </Layout>
  );
}
