/**
 * Request Workbench — Proposal tab.
 *
 * Three stacked sections per docs/WORKBENCH_PROPOSAL_TAB_BUILD_PLAN.md:
 *   Top    — Dataverse proposal info (PI, Co-PIs, abstract, amounts)
 *   Middle — Phase I documents (slot-matched + other; download via the scoped proxy)
 *   Bottom — AI content (existing fit rationale / summary / extracted data; the
 *            Field Primer generate/persist lands in a later phase)
 *
 * Top + AI render from the `context` the shell already loaded; documents are
 * fetched here from /api/workbench/proposal-documents (request-scoped).
 */

import { useState, useEffect } from 'react';
import { Card } from '../Layout';

const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

function money(n) {
  return typeof n === 'number' && Number.isFinite(n) ? USD.format(n) : '—';
}

function downloadUrl(requestId, file) {
  const p = new URLSearchParams({
    requestId,
    library: file.library,
    folder: file.folder,
    filename: file.name,
  });
  return `/api/workbench/download-proposal-document?${p.toString()}`;
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

function DocumentsSection({ requestId, docs, error }) {
  if (error) {
    return <p className="text-sm text-amber-600">Couldn’t load documents: {error}</p>;
  }
  if (!docs) {
    return <p className="text-sm text-gray-500">Loading documents…</p>;
  }
  const slots = Array.isArray(docs.slots) ? docs.slots : [];
  const others = Array.isArray(docs.otherDocuments) ? docs.otherDocuments : [];
  return (
    <div className="space-y-4">
      <ul className="divide-y divide-gray-100">
        {slots.map((s) => (
          <li key={s.key} className="flex items-center justify-between gap-3 py-2">
            <span className="text-sm text-gray-700">{s.label}</span>
            {s.found ? (
              <a className="text-sm font-medium text-indigo-600 hover:underline" href={downloadUrl(requestId, s)}>
                Download
              </a>
            ) : (
              <span className="text-xs text-gray-400">not found</span>
            )}
          </li>
        ))}
      </ul>

      {others.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-400 mb-1">Other documents</p>
          <ul className="space-y-1">
            {others.map((d) => (
              <li key={`${d.folder}/${d.name}`}>
                <a className="text-sm text-indigo-600 hover:underline" href={downloadUrl(requestId, d)}>
                  {d.name}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {Array.isArray(docs.errors) && docs.errors.length > 0 && (
        <p className="text-xs text-amber-600">Some document folders couldn’t be read.</p>
      )}
    </div>
  );
}

export default function ProposalTab({ context }) {
  const requestId = context?.requestId || null;
  const [docs, setDocs] = useState(null);
  const [docsError, setDocsError] = useState(null);

  useEffect(() => {
    if (!requestId) return undefined;
    let cancelled = false;
    setDocs(null);
    setDocsError(null);
    fetch(`/api/workbench/proposal-documents?requestId=${encodeURIComponent(requestId)}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `Failed to load documents (${res.status})`);
        if (!cancelled) setDocs(body);
      })
      .catch((e) => {
        if (!cancelled) setDocsError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [requestId]);

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
          <Field label="Co-Investigators">{coPIs.length ? coPIs.join(', ') : '—'}</Field>
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

      {/* Middle — Phase I documents */}
      <Section title="Documents">
        <DocumentsSection requestId={requestId} docs={docs} error={docsError} />
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
