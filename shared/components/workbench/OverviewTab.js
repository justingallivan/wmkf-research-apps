/**
 * Request Workbench — Overview tab (v1).
 *
 * The per-request "command center" (REQUEST_WORKBENCH_SCOPING.md §3.2/§3.7):
 * a fast answer to "where is this request and what do I do next." v1 is
 * deliberately scoped to data that already has a live source:
 *   - the request `context` the shell already loaded (resolve-request)
 *   - the per-request reviewer-stage rollup from /api/workbench/reviewer-rollup
 *     (the shared lightweight count path — counts only, no person/researcher
 *     fan-out; the server derives the funnel counts + the "what next" hint).
 *
 * Out of v1 (no live source yet — lands as those tabs are built): writeup status
 * and returned-review state. The full actionability rule set (`isActionableForPD`)
 * is also deferred — the rollup `hint` here is a light heuristic, not that rule.
 */

import { useState, useEffect, useRef } from 'react';
import { Card } from '../Layout';
import { StatusBadge } from './StatusTab';

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const money = (n) => (typeof n === 'number' && Number.isFinite(n) ? USD.format(n) : '—');

function formatMeetingDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function Field({ label, children }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className="text-sm text-gray-900">{children ?? '—'}</dd>
    </div>
  );
}

function Section({ title, action, children }) {
  return (
    <Card hover={false}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

function TabLink({ onSelectTab, tab, children }) {
  if (!onSelectTab) return <span className="text-sm text-gray-400">{children}</span>;
  return (
    <button type="button" onClick={() => onSelectTab(tab)} className="text-sm font-medium text-indigo-600 hover:underline">
      {children}
    </button>
  );
}

// AI artifacts present on the request (each deep-links to the Proposal tab).
function aiArtifacts(ai = {}) {
  return [
    ['Fit rationale', ai.fitRationale],
    ['Summary', ai.summary],
    ['Extracted data', ai.dataExtract],
    ['Field primer', ai.fieldPrimer],
  ].map(([label, v]) => ({ label, present: !!v }));
}

function ReviewerProgress({ requestId }) {
  const [state, setState] = useState({ status: 'loading', data: null });
  const reqRef = useRef(0);

  useEffect(() => {
    if (!requestId) return undefined;
    const token = (reqRef.current += 1);
    let cancelled = false;
    setState({ status: 'loading', data: null });
    // Lightweight per-request rollup (counts only, no person/researcher fan-out —
    // Codex S260). Returns { counts, needed, workRemaining, hint }.
    fetch(`/api/workbench/reviewer-rollup?requestId=${encodeURIComponent(requestId)}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (cancelled || token !== reqRef.current) return;
        if (!res.ok || !body.success) throw new Error(body.error || `Failed (${res.status})`);
        const counts = body.counts && typeof body.counts === 'object' ? body.counts : {};
        setState({ status: 'ready', data: { counts, needed: body.needed, hint: body.hint } });
      })
      .catch(() => {
        if (!cancelled && token === reqRef.current) setState({ status: 'error', data: null });
      });
    return () => { cancelled = true; };
  }, [requestId]);

  if (state.status === 'loading') return <p className="text-sm text-gray-500">Loading reviewer progress…</p>;
  if (state.status === 'error') return <p className="text-sm text-amber-600">Couldn’t load reviewer progress.</p>;

  const { counts, needed, hint } = state.data;
  const n = (v) => (Number.isFinite(v) ? v : 0);

  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-4 gap-4">
        <Field label="Candidates">{n(counts.candidates)}</Field>
        <Field label="Invited">{n(counts.invited)}</Field>
        <Field label="Accepted">{Number.isFinite(needed) ? `${n(counts.accepted)} / ${needed}` : n(counts.accepted)}</Field>
        <Field label="Complete">{n(counts.completed)}</Field>
      </dl>
      {hint && <p className="text-sm text-gray-600">{hint}</p>}
    </div>
  );
}

export default function OverviewTab({ context, requestId, onSelectTab }) {
  if (!context) {
    return (
      <Card hover={false}>
        <p className="text-sm text-gray-500">Loading overview…</p>
      </Card>
    );
  }

  const info = context.proposalInfo || {};
  const coPIs = Array.isArray(info.coPIs) ? info.coPIs : [];
  const artifacts = aiArtifacts(context.aiContent);
  const anyArtifact = artifacts.some((a) => a.present);

  return (
    <div className="space-y-4">
      {/* Snapshot */}
      <Section
        title="Request snapshot"
        action={<TabLink onSelectTab={onSelectTab} tab="proposal">Open proposal →</TabLink>}
      >
        <dl className="grid sm:grid-cols-2 gap-4">
          <Field label="Principal Investigator">{info.pi}</Field>
          <Field label="Co-Investigators">{coPIs.length ? coPIs.join(', ') : '—'}</Field>
          <Field label="Institution">{context.institution}</Field>
          <Field label="Board Meeting">{formatMeetingDate(context.meetingDate)}</Field>
          <Field label="Requested Amount">{money(info.requestedAmount)}</Field>
          <Field label="Total Project Budget">{money(info.totalProjectBudget)}</Field>
          <Field label="Program">{context.grantProgram}</Field>
          <Field label="Status">
            {context.requestStatus ? (
              <span className="inline-flex items-center gap-2">
                {context.requestStatus}
                <StatusBadge statusClass={context.statusClass} />
              </span>
            ) : '—'}
          </Field>
        </dl>
      </Section>

      {/* AI artifacts */}
      <Section
        title="AI content"
        action={<TabLink onSelectTab={onSelectTab} tab="proposal">View / generate →</TabLink>}
      >
        {anyArtifact ? (
          <ul className="flex flex-wrap gap-2">
            {artifacts.map((a) => {
              const chipCls = `text-xs px-2 py-1 rounded-full ${a.present ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`;
              const text = `${a.present ? '✓ ' : '— '}${a.label}`;
              return (
                <li key={a.label}>
                  {onSelectTab ? (
                    <button
                      type="button"
                      onClick={() => onSelectTab('proposal')}
                      className={`${chipCls} hover:ring-1 hover:ring-indigo-300`}
                      title={a.present ? 'Open in the Proposal tab' : 'Generate in the Proposal tab'}
                    >
                      {text}
                    </button>
                  ) : (
                    <span className={chipCls}>{text}</span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-gray-500">No AI content generated yet — open the Proposal tab to generate it.</p>
        )}
      </Section>

      {/* Reviewers */}
      <Section
        title="Reviewers"
        action={<TabLink onSelectTab={onSelectTab} tab="reviewers">Manage reviewers →</TabLink>}
      >
        <ReviewerProgress requestId={requestId} />
      </Section>
    </div>
  );
}
