/**
 * Admin section for editing + versioned-publishing `wmkf_ai_prompt` rows (S222).
 *
 * Mounted in pages/admin.js alongside PoliciesSection (which this mirrors). The
 * route (/api/admin/prompts/[name]) owns all the concurrency / idempotency /
 * audit complexity; this component presents prompts, validates edits client-side
 * (same validators the server enforces), and surfaces outcomes.
 *
 * Editing is immutable-by-version: a publish creates a NEW wmkf_ai_prompt row
 * (iscurrent=true, version+1) and flips the prior row down.
 */
import { useEffect, useState } from 'react';
import { validatePromptForSave } from '../../../lib/utils/prompt-validators';

const STATUS_COPY = {
  completed:             { tone: 'green', text: 'Published — new version is now current.' },
  already_published:     { tone: 'gray',  text: 'No change — that request was already published.' },
  partial:               { tone: 'amber', text: 'Published with warnings — see details below.' },
  concurrency_conflict:  { tone: 'amber', text: 'Another admin published while you were editing. Reload and re-apply.' },
  no_current_row:        { tone: 'red',   text: 'Prompt rows exist but none is current — use the seed --force recovery path, or resolve in Dynamics.' },
  duplicate_current_rows:{ tone: 'red',   text: 'Multiple current rows (store corruption). Resolve in Dynamics.' },
  invalid_body:          { tone: 'red',   text: 'Prompt body failed validation.' },
  audit_unavailable:     { tone: 'red',   text: 'Audit table unavailable; refused to publish.' },
  failed:                { tone: 'red',   text: 'Publish failed. Check server logs.' },
};
const TONE = {
  green: 'bg-green-50 text-green-800 border-green-200',
  amber: 'bg-amber-50 text-amber-800 border-amber-200',
  red:   'bg-red-50   text-red-800   border-red-200',
  gray:  'bg-gray-50  text-gray-800  border-gray-200',
};

function newRequestId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `req-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

// Short timestamp; '—' when absent. Guards an unparseable value.
function fmtTs(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

export default function PromptTemplatesSection() {
  const [prompts, setPrompts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = () => {
    setLoading(true);
    setError(null);
    fetch('/api/admin/prompts')
      .then((r) => {
        if (r.status === 403) throw new Error('Admin access required');
        if (!r.ok) throw new Error('Failed to load prompts');
        return r.json();
      })
      .then((data) => setPrompts(data.prompts || []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  if (loading && !prompts) return <div className="text-gray-500 text-sm">Loading…</div>;
  if (error && !prompts) return <div className="text-red-600 text-sm">{error}</div>;
  if (!prompts || prompts.length === 0) return <div className="text-gray-500 text-sm">No prompts found.</div>;

  return (
    <>
      <p className="text-xs text-gray-500 mb-4">
        Edit and publish a new version of a stored prompt. Publishing creates a new immutable version and makes it current. Reviewer-finder prompts are validated against their output parse contract before save.
      </p>
      <div className="space-y-6">
        {prompts.map((p) => (
          <PromptPanel key={p.name} prompt={p} onPublished={load} />
        ))}
      </div>
    </>
  );
}

function PromptPanel({ prompt, onPublished }) {
  const [expanded, setExpanded] = useState(false);
  const [outcome, setOutcome] = useState(null);
  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="p-4 bg-gray-50 border-b flex items-baseline justify-between">
        <div>
          <div className="font-medium text-gray-900">
            <code>{prompt.name}</code>
            {!prompt.hasCurrent && (
              <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] align-middle">
                draft — no published version
              </span>
            )}
          </div>
          <div className="text-xs text-gray-500">
            {prompt.hasCurrent ? 'current version' : 'latest version'} <strong>v{prompt.version ?? '?'}</strong> · {(prompt.body || '').length} chars
          </div>
          <div className="text-[11px] text-gray-400 mt-0.5">
            published {fmtTs(prompt.publishedAt || prompt.createdOn)} · last touched {fmtTs(prompt.modifiedOn)}
            {prompt.modifiedByName ? <> by {prompt.modifiedByName}</> : null}
          </div>
        </div>
        {prompt.hasCurrent ? (
          <button
            onClick={() => setExpanded((e) => !e)}
            className="px-3 py-1.5 text-sm bg-gray-900 text-white rounded hover:bg-gray-800"
          >
            {expanded ? 'Cancel' : 'Edit & publish'}
          </button>
        ) : (
          <button
            onClick={() => setExpanded((e) => !e)}
            className="px-3 py-1.5 text-sm border border-gray-300 text-gray-700 rounded hover:bg-gray-100"
            title="No published current version. View the body; publishing requires seeding a current version first."
          >
            {expanded ? 'Hide' : 'View'}
          </button>
        )}
      </div>

      {expanded && (
        <PublishForm
          prompt={prompt}
          onSuccess={(o) => { setOutcome(o); onPublished(); setExpanded(false); }}
          onOutcome={setOutcome}
        />
      )}
      {outcome && <OutcomeBanner outcome={outcome} onDismiss={() => setOutcome(null)} />}
    </div>
  );
}

function PublishForm({ prompt, onSuccess, onOutcome }) {
  const [body, setBody] = useState(prompt.body || '');
  const [submitting, setSubmitting] = useState(false);
  const [requestId] = useState(newRequestId); // stable across retries of this edit

  const validation = validatePromptForSave(prompt.name, body);
  const unchanged = body === (prompt.body || '');

  const submit = async () => {
    setSubmitting(true);
    try {
      const r = await fetch(`/api/admin/prompts/${encodeURIComponent(prompt.name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, requestId }),
      });
      const data = await r.json();
      if (data.status === 'completed' || data.status === 'already_published') onSuccess(data);
      else onOutcome(data);
    } catch (err) {
      onOutcome({ status: 'failed', warnings: [err.message] });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-4 space-y-3">
      <label className="block text-xs text-gray-700">
        Prompt body
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={16}
          className="mt-1 w-full px-2 py-1.5 border border-gray-300 rounded text-sm font-mono text-xs"
        />
        <div className="mt-1 text-[10px] text-gray-400">{body.length} chars</div>
      </label>

      {!validation.valid && (
        <div className={`text-xs px-3 py-2 rounded border ${TONE.red}`}>
          <div className="font-medium">Validation issues (fix before publishing):</div>
          <ul className="mt-1 list-disc ml-5">
            {validation.issues.map((iss, i) => (<li key={i}>{iss}</li>))}
          </ul>
        </div>
      )}

      {!prompt.hasCurrent && (
        <div className="text-xs px-3 py-2 rounded border bg-amber-50 text-amber-800 border-amber-200">
          This prompt has rows but no published current version, so it can&apos;t be versioned from here. Recover a current version with the seed&apos;s <code>--force</code> path (publishes max+1), or resolve in Dynamics.
        </div>
      )}

      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={() => setBody(prompt.body || '')}
          disabled={unchanged}
          className="text-xs text-gray-600 hover:text-gray-900 disabled:opacity-40"
        >
          Reset
        </button>
        <button
          onClick={submit}
          disabled={submitting || !validation.valid || unchanged || !prompt.hasCurrent}
          className="px-4 py-1.5 bg-gray-900 text-white text-sm font-medium rounded hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {submitting ? 'Publishing…' : `Publish v${(prompt.version ?? 0) + 1}`}
        </button>
      </div>
    </div>
  );
}

function OutcomeBanner({ outcome, onDismiss }) {
  const meta = STATUS_COPY[outcome.status] || { tone: 'gray', text: outcome.status };
  return (
    <div className={`p-3 border-t text-sm ${TONE[meta.tone]}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="font-medium">{meta.text}</div>
          {outcome.newPromptId && <div className="mt-1 text-xs">New version: v{outcome.targetVersion} (<code>{outcome.newPromptId}</code>)</div>}
          {outcome.issues && outcome.issues.length > 0 && (
            <ul className="mt-1 text-xs list-disc ml-5">{outcome.issues.map((x, i) => (<li key={i}>{x}</li>))}</ul>
          )}
          {outcome.warnings && outcome.warnings.length > 0 && (
            <ul className="mt-1 text-xs list-disc ml-5">{outcome.warnings.map((w, i) => (<li key={i}>{w}</li>))}</ul>
          )}
          {outcome.orphan && <div className="mt-1 text-xs">Orphan version: <code>{outcome.orphan.id}</code> ({outcome.orphan.reason})</div>}
          {outcome.ids && <div className="mt-1 text-xs">Current IDs: {outcome.ids.join(', ')}</div>}
        </div>
        <button onClick={onDismiss} className="text-xs underline">dismiss</button>
      </div>
    </div>
  );
}
