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

function docUrl(requestId, file, { inline = false } = {}) {
  const p = new URLSearchParams({
    requestId,
    library: file.library,
    folder: file.folder,
    filename: file.name,
  });
  if (inline) p.set('disposition', 'inline');
  return `/api/workbench/download-proposal-document?${p.toString()}`;
}

// Only PDFs view usefully (and safely) inline; everything else is download-only.
function isViewable(file) {
  return /\.pdf$/i.test(file?.name || '') || file?.mimeType === 'application/pdf';
}

function DocActions({ requestId, file }) {
  return (
    <span className="flex items-center gap-3 shrink-0">
      {isViewable(file) && (
        <a
          className="text-sm font-medium text-indigo-600 hover:underline"
          href={docUrl(requestId, file, { inline: true })}
          target="_blank"
          rel="noopener noreferrer"
        >
          View
        </a>
      )}
      <a className="text-sm font-medium text-indigo-600 hover:underline" href={docUrl(requestId, file)}>
        Download
      </a>
    </span>
  );
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

function parseEnvelope(raw) {
  if (!raw) return null;
  try {
    const env = JSON.parse(raw);
    return env && env.primer ? env : null;
  } catch {
    return null;
  }
}

function GroundingBadge({ grounding }) {
  if (!grounding?.status) return null;
  const map = {
    confirmed: ['confirmed', 'bg-green-100 text-green-700'],
    corrected: ['suggested correction', 'bg-amber-100 text-amber-800'],
    unverified: ['unverified', 'bg-gray-100 text-gray-600'],
  };
  const [label, cls] = map[grounding.status] || [grounding.status, 'bg-gray-100 text-gray-600'];
  return <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${cls}`}>{label}</span>;
}

function PrimerList({ title, items, render }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-gray-400 mb-1">{title}</p>
      <ul className="space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="text-sm text-gray-700">{render(it)}</li>
        ))}
      </ul>
    </div>
  );
}

function PrimerView({ envelope }) {
  const p = envelope?.primer || {};
  return (
    <div className="space-y-4">
      {p.field_overview && (
        <p className="text-sm text-gray-700 whitespace-pre-wrap">{p.field_overview}</p>
      )}
      <PrimerList title="Subareas" items={p.subareas} render={(s) => <span><span className="font-medium text-gray-900">{s.name}</span>{s.description ? ` — ${s.description}` : ''}</span>} />
      <PrimerList title="Key methods" items={p.key_methods} render={(m) => <span><span className="font-medium text-gray-900">{m.name}</span>{m.description ? ` — ${m.description}` : ''}</span>} />
      <PrimerList title="Frontiers" items={p.frontiers} render={(f) => <span><span className="font-medium text-gray-900">{f.frontier}</span>{f.why_now ? ` — ${f.why_now}` : ''}</span>} />
      <PrimerList title="Communities" items={p.communities} render={(c) => <span><span className="font-medium text-gray-900">{c.name}</span>{c.description ? ` — ${c.description}` : ''}</span>} />
      {Array.isArray(p.venues) && p.venues.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-400 mb-1">Venues</p>
          <p className="text-sm text-gray-700">{p.venues.join(' · ')}</p>
        </div>
      )}
      <PrimerList title="Experts (orienting only — verify before use)" items={p.experts} render={(e) => (
        <span>
          <span className="font-medium text-gray-900">{e.name}</span>
          {e.affiliation ? ` (${e.affiliation})` : ''}
          <GroundingBadge grounding={e.grounding} />
          {e.grounding?.status === 'corrected' && e.grounding?.resolvedName ? (
            <span className="text-amber-700"> → did you mean {e.grounding.resolvedName}?</span>
          ) : null}
          {e.why_relevant ? <span className="block text-gray-600">{e.why_relevant}</span> : null}
        </span>
      )} />
      {p.proposal_placement && (
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-400 mb-1">Where this proposal sits</p>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{p.proposal_placement}</p>
        </div>
      )}
      {p.caveats && (
        <div className="bg-amber-50 border border-amber-100 rounded-md p-3">
          <p className="text-xs uppercase tracking-wide text-amber-700 mb-1">Caveats</p>
          <p className="text-sm text-amber-900 whitespace-pre-wrap">{p.caveats}</p>
        </div>
      )}
    </div>
  );
}

function FieldPrimer({ requestId, initialRaw }) {
  const [envelope, setEnvelope] = useState(() => parseEnvelope(initialRaw));
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);

  const generate = async (regenerate) => {
    if (!requestId) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch('/api/field-primer/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, ...(regenerate ? { regenerate: true } : {}) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Generation failed (${res.status})`);
      setEnvelope(body.envelope || null);
    } catch (e) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-1">
        <dt className="text-xs uppercase tracking-wide text-gray-400">Field Primer</dt>
        {envelope ? (
          <button
            type="button"
            onClick={() => generate(true)}
            disabled={generating}
            className="text-sm font-medium text-indigo-600 hover:underline disabled:text-gray-400"
          >
            {generating ? 'Regenerating…' : 'Regenerate'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => generate(false)}
            disabled={generating}
            className="text-sm font-medium text-indigo-600 hover:underline disabled:text-gray-400"
          >
            {generating ? 'Generating…' : 'Generate field primer'}
          </button>
        )}
      </div>
      {error && <p className="text-sm text-amber-600 mb-2">{error}</p>}
      {generating && !envelope && (
        <p className="text-sm text-gray-500">Generating the field primer — this can take up to a minute…</p>
      )}
      {envelope ? (
        <PrimerView envelope={envelope} />
      ) : (
        !generating && <p className="text-sm text-gray-500">Not yet generated.</p>
      )}
    </div>
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
              <DocActions requestId={requestId} file={s} />
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
              <li key={`${d.folder}/${d.name}`} className="flex items-center justify-between gap-3 py-1">
                <span className="text-sm text-gray-700 truncate">{d.name}</span>
                <DocActions requestId={requestId} file={d} />
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
          <FieldPrimer requestId={requestId} initialRaw={ai.fieldPrimer} />
        </div>
      </Section>
    </div>
  );
}
