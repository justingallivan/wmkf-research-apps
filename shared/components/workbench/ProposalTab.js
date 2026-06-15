/**
 * Request Workbench — Proposal tab (Phase 1: read-only).
 *
 * Three stacked sections per docs/WORKBENCH_PROPOSAL_TAB_BUILD_PLAN.md:
 *   Top    — Dataverse proposal info (PI, Co-PIs, abstract, amounts)
 *   Middle — Phase I documents (Phase 2 — placeholder for now)
 *   Bottom — AI content (existing fit rationale / summary / extracted data;
 *            the Field Primer generate/persist lands in a later phase)
 *
 * Phase 1 renders entirely from the `context` already loaded by the shell
 * (/api/workbench/resolve-request now returns `proposalInfo` + `aiContent`), so
 * this component does no fetching of its own yet.
 */

import { Card } from '../Layout';

const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

function money(n) {
  return typeof n === 'number' && Number.isFinite(n) ? USD.format(n) : '—';
}

function Field({ label, children }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className="text-sm text-gray-900">{children ?? '—'}</dd>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <Card hover={false}>
      <h2 className="text-base font-semibold text-gray-900 mb-3">{title}</h2>
      {children}
    </Card>
  );
}

// AI Extracted Data is a JSON string — render it readably, falling back to raw
// text if it doesn't parse.
function ExtractedData({ raw }) {
  if (!raw) return <p className="text-sm text-gray-500">Not yet extracted.</p>;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return <p className="text-sm whitespace-pre-wrap text-gray-700">{raw}</p>;
  }
  return (
    <pre className="text-xs bg-gray-50 border border-gray-200 rounded-md p-3 overflow-x-auto text-gray-700">
      {JSON.stringify(parsed, null, 2)}
    </pre>
  );
}

export default function ProposalTab({ context }) {
  if (!context) {
    return (
      <Card hover={false}>
        <p className="text-sm text-gray-500">Loading proposal…</p>
      </Card>
    );
  }

  const info = context.proposalInfo || {};
  const ai = context.aiContent || {};
  const coPIs = Array.isArray(info.coPIs) ? info.coPIs : [];

  return (
    <div className="space-y-4">
      {/* Top — proposal info */}
      <Section title="Proposal">
        <dl className="grid sm:grid-cols-2 gap-4">
          <Field label="Principal Investigator">{info.pi}</Field>
          <Field label="Co-Investigators">
            {coPIs.length ? coPIs.join(', ') : '—'}
          </Field>
          <Field label="Requested Amount">{money(info.requestedAmount)}</Field>
          <Field label="Total Project Budget">{money(info.totalProjectBudget)}</Field>
        </dl>
        <div className="mt-4">
          <dt className="text-xs uppercase tracking-wide text-gray-400 mb-1">Abstract</dt>
          <dd className="text-sm text-gray-700 whitespace-pre-wrap">
            {info.abstract || <span className="text-gray-500">No abstract on the request.</span>}
          </dd>
        </div>
      </Section>

      {/* Middle — documents (Phase 2) */}
      <Section title="Documents">
        <p className="text-sm text-gray-500">Proposal documents are coming in a later update.</p>
      </Section>

      {/* Bottom — AI content */}
      <Section title="AI Content">
        <div className="space-y-4">
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-400 mb-1">AI Fit Rationale</dt>
            <dd className="text-sm text-gray-700 whitespace-pre-wrap">
              {ai.fitRationale || <span className="text-gray-500">Not yet generated.</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-400 mb-1">AI Summary</dt>
            <dd className="text-sm text-gray-700 whitespace-pre-wrap">
              {ai.summary || <span className="text-gray-500">Not yet generated.</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-400 mb-1">AI Extracted Data</dt>
            <dd><ExtractedData raw={ai.dataExtract} /></dd>
          </div>
        </div>
      </Section>
    </div>
  );
}
