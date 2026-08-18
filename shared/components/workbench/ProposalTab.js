/**
 * Request Workbench — Proposal tab.
 *
 * Three stacked sections per docs/WORKBENCH_PROPOSAL_TAB_BUILD_PLAN.md:
 *   Top    — Dataverse proposal info (PI, Co-PIs, abstract, amounts)
 *   Middle — Reviewer Materials, canonical AI Materials, and Phase I/II documents
 *            (download via the scoped proxy)
 *   Bottom — AI content (existing fit rationale / summary / extracted data; the
 *            Field Primer generate/persist lands in a later phase)
 *
 * Top + AI render from the `context` the shell already loaded; documents are
 * fetched here from /api/workbench/proposal-documents (request-scoped).
 */

import { useState, useEffect, useRef } from 'react';
import { Card } from '../Layout';
import { parseFieldPrimerEnvelope } from '../../utils/field-primer-envelope';
import { expertProfileLinks, expertMetrics } from '../../utils/field-primer-display';

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

function GroundingBadge({ grounding }) {
  if (!grounding?.status || typeof grounding.status !== 'string') return null;
  const map = {
    confirmed: ['confirmed', 'bg-green-100 text-green-700'],
    corrected: ['suggested correction', 'bg-amber-100 text-amber-800'],
    unverified: ['unverified', 'bg-gray-100 text-gray-600'],
  };
  const [label, cls] = map[grounding.status] || [grounding.status, 'bg-gray-100 text-gray-600'];
  return <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${cls}`}>{label}</span>;
}

// Public profile links + bibliometrics for a grounded expert (orientation only —
// never contact). Renders nothing for unverified/ungrounded experts.
function ExpertProfile({ grounding }) {
  const metrics = expertMetrics(grounding);
  const links = expertProfileLinks(grounding);
  if (!metrics && links.length === 0) return null;
  const chips = [];
  if (metrics) chips.push(...metrics.map((m) => <span key={`m-${m}`} className="text-gray-500">{m}</span>));
  links.forEach((l) => chips.push(
    <a
      key={`l-${l.label}`}
      href={l.href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-indigo-600 hover:underline"
    >
      {l.label}
    </a>
  ));
  return (
    <span className="block text-xs mt-0.5">
      {chips.map((c, i) => (
        <span key={i}>
          {i > 0 ? <span className="text-gray-300"> · </span> : null}
          {c}
        </span>
      ))}
    </span>
  );
}

function PrimerList({ title, items, render }) {
  // The LLM output is parseable JSON but not schema-validated per-item, so guard
  // against null/non-object array entries before rendering.
  const safe = Array.isArray(items) ? items.filter((it) => it && typeof it === 'object') : [];
  if (safe.length === 0) return null;
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-gray-400 mb-1">{title}</p>
      <ul className="space-y-1.5">
        {safe.map((it, i) => (
          <li key={i} className="text-sm text-gray-700">{render(it)}</li>
        ))}
      </ul>
    </div>
  );
}

// Coerce a primer field to a renderable string — the LLM output is parseable but
// not per-field schema-validated, so an object/array value must never reach React
// as a child (it would throw). Non-string/number → ''.
const str = (v) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');

function PrimerView({ envelope }) {
  const p = envelope?.primer || {};
  const venues = Array.isArray(p.venues) ? p.venues.filter((v) => typeof v === 'string' && v.trim()) : [];
  const overview = str(p.field_overview);
  const placement = str(p.proposal_placement);
  const caveats = str(p.caveats);
  return (
    <div className="space-y-4">
      {overview && <p className="text-sm text-gray-700 whitespace-pre-wrap">{overview}</p>}
      <PrimerList title="Subareas" items={p.subareas} render={(s) => <span><span className="font-medium text-gray-900">{str(s.name)}</span>{str(s.description) ? ` — ${str(s.description)}` : ''}</span>} />
      <PrimerList title="Key methods" items={p.key_methods} render={(m) => <span><span className="font-medium text-gray-900">{str(m.name)}</span>{str(m.description) ? ` — ${str(m.description)}` : ''}</span>} />
      <PrimerList title="Frontiers" items={p.frontiers} render={(f) => <span><span className="font-medium text-gray-900">{str(f.frontier)}</span>{str(f.why_now) ? ` — ${str(f.why_now)}` : ''}</span>} />
      <PrimerList title="Communities" items={p.communities} render={(c) => <span><span className="font-medium text-gray-900">{str(c.name)}</span>{str(c.description) ? ` — ${str(c.description)}` : ''}</span>} />
      {venues.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-400 mb-1">Venues</p>
          <p className="text-sm text-gray-700">{venues.join(' · ')}</p>
        </div>
      )}
      <PrimerList title="Experts (orienting only — verify before use)" items={p.experts} render={(e) => (
        <span>
          <span className="font-medium text-gray-900">{str(e.name)}</span>
          {str(e.affiliation) ? ` (${str(e.affiliation)})` : ''}
          <GroundingBadge grounding={e.grounding} />
          {e.grounding?.status === 'corrected' && str(e.grounding?.resolvedName) ? (
            <span className="text-amber-700"> → did you mean {str(e.grounding.resolvedName)}?</span>
          ) : null}
          {str(e.why_relevant) ? <span className="block text-gray-600">{str(e.why_relevant)}</span> : null}
          <ExpertProfile grounding={e.grounding} />
        </span>
      )} />
      {placement && (
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-400 mb-1">Where this proposal sits</p>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{placement}</p>
        </div>
      )}
      {caveats && (
        <div className="bg-amber-50 border border-amber-100 rounded-md p-3">
          <p className="text-xs uppercase tracking-wide text-amber-700 mb-1">Caveats</p>
          <p className="text-sm text-amber-900 whitespace-pre-wrap">{caveats}</p>
        </div>
      )}
    </div>
  );
}

function FieldPrimer({ requestId, initialRaw }) {
  const [envelope, setEnvelope] = useState(() => parseFieldPrimerEnvelope(initialRaw));
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false); // another session is generating
  const reqRef = useRef(0);

  // Reset state (and invalidate any in-flight generate) when the request — or its
  // persisted primer — changes, so a stale response can't apply to another request.
  useEffect(() => {
    reqRef.current += 1;
    setEnvelope(parseFieldPrimerEnvelope(initialRaw));
    setGenerating(false);
    setError(null);
    setPending(false);
  }, [requestId, initialRaw]);

  const generate = async (regenerate) => {
    if (!requestId) return;
    const token = reqRef.current;
    setGenerating(true);
    setError(null);
    setPending(false);
    try {
      const res = await fetch('/api/field-primer/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, ...(regenerate ? { regenerate: true } : {}) }),
      });
      const body = await res.json().catch(() => ({}));
      if (token !== reqRef.current) return; // request changed mid-flight — ignore stale response
      if (!res.ok) throw new Error(body.error || `Generation failed (${res.status})`);
      if (body.envelope) setEnvelope(body.envelope);
      else if (body.status === 'generating') setPending(true);
    } catch (e) {
      if (token === reqRef.current) setError(e.message);
    } finally {
      if (token === reqRef.current) setGenerating(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-1">
        <dt className="text-xs uppercase tracking-wide text-gray-400">Field Primer</dt>
        <button
          type="button"
          onClick={() => generate(!!envelope)}
          disabled={generating}
          className="text-sm font-medium text-indigo-600 hover:underline disabled:text-gray-400"
        >
          {generating
            ? (envelope ? 'Regenerating…' : 'Generating…')
            : (envelope ? 'Regenerate' : 'Generate field primer')}
        </button>
      </div>
      {error && <p className="text-sm text-amber-600 mb-2">{error}</p>}
      {pending && !envelope && (
        <p className="text-sm text-gray-500">Another session is generating this primer — refresh in a moment.</p>
      )}
      {generating && !envelope && (
        <p className="text-sm text-gray-500">Generating the field primer — this can take several minutes…</p>
      )}
      {envelope ? (
        <PrimerView envelope={envelope} />
      ) : (
        !generating && !pending && <p className="text-sm text-gray-500">Not yet generated.</p>
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
  const reviewerMaterials = Array.isArray(docs.reviewerMaterials) ? docs.reviewerMaterials : [];
  const aiMaterials = Array.isArray(docs.aiMaterials) ? docs.aiMaterials : [];
  const slots = Array.isArray(docs.slots) ? docs.slots : [];
  const phaseIIDocuments = Array.isArray(docs.phaseIIDocuments) ? docs.phaseIIDocuments : [];
  const others = Array.isArray(docs.otherDocuments) ? docs.otherDocuments : [];
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-gray-400 mb-1">Reviewer Materials</p>
        {reviewerMaterials.length > 0 ? (
          <ul className="divide-y divide-gray-100">
            {reviewerMaterials.map((document) => (
              <li
                key={`${document.library}/${document.folder}/${document.name}`}
                className="flex items-center justify-between gap-3 py-2"
              >
                <span className="text-sm text-gray-700 truncate">{document.name}</span>
                <DocActions requestId={requestId} file={document} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-400 py-2">No documents found.</p>
        )}
      </div>

      {aiMaterials.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-400 mb-1">AI Materials</p>
          <ul className="divide-y divide-gray-100">
            {aiMaterials.map((material) => (
              <li key={material.key} className="flex items-center justify-between gap-3 py-2">
                <span className="text-sm text-gray-700">{material.label}</span>
                {material.found ? (
                  <DocActions requestId={requestId} file={material} />
                ) : (
                  <span className="text-xs text-gray-400">not found</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="text-xs uppercase tracking-wide text-gray-400 mb-1">Phase I documents</p>
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
      </div>

      <div>
        <p className="text-xs uppercase tracking-wide text-gray-400 mb-1">Phase II documents</p>
        {phaseIIDocuments.length > 0 ? (
          <ul className="divide-y divide-gray-100">
            {phaseIIDocuments.map((document) => (
              <li
                key={`${document.library}/${document.folder}/${document.name}`}
                className="flex items-center justify-between gap-3 py-2"
              >
                <span className="text-sm text-gray-700 truncate">{document.name}</span>
                <DocActions requestId={requestId} file={document} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-400 py-2">No documents found.</p>
        )}
      </div>

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

      {/* Middle — proposal documents */}
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
