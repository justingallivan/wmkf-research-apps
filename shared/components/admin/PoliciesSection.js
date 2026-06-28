/**
 * Admin section for publishing new versions of wmkf_policy slots.
 *
 * Mount point: pages/admin.js — rendered alongside Model Configuration et al.
 *
 * Operations supported:
 *   - View a slot's active version + history (with residue badges for
 *     orphan child versions from partial publishes).
 *   - Publish a new version — server enforces immutability rules, so this
 *     is the only edit operation. New version = new wmkf_policyversion
 *     child, parent's wmkf_activeversion flipped, prior active retired.
 *
 * The route handles all the concurrency / idempotency / audit complexity.
 * This component focuses on presenting outcomes intelligibly to the user.
 */

import { useEffect, useState } from 'react';
import { renderPolicyMarkdown } from '../../utils/policy-markdown-client';
import DataverseFieldInfoButton from './DataverseFieldInfoButton';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

const STATUS_COPY = {
  completed:             { tone: 'green',  text: 'Published.' },
  already_published:     { tone: 'gray',   text: 'No change — that exact version is already active.' },
  partial:               { tone: 'amber',  text: 'Published with warnings — see details below.' },
  concurrency_conflict:  { tone: 'amber',  text: 'Another admin published while you were editing. Reload and re-apply your changes.' },
  label_conflict:        { tone: 'amber',  text: 'A version with that label already exists with different content.' },
  invalid_body:          { tone: 'red',    text: 'Policy body contains disallowed content.' },
  slot_not_provisioned:  { tone: 'red',    text: 'Slot row missing in Dataverse. Run the seed script.' },
  duplicate_slot_rows:   { tone: 'red',    text: 'Multiple Dataverse rows for this slot. Manual cleanup required.' },
  audit_unavailable:     { tone: 'red',    text: 'Audit table unavailable; refused to publish.' },
  failed:                { tone: 'red',    text: 'Publish failed. Check server logs.' },
};

const TONE_CLASSES = {
  green: 'bg-green-50 text-green-800 border-green-200',
  amber: 'bg-amber-50 text-amber-800 border-amber-200',
  red:   'bg-red-50   text-red-800   border-red-200',
  gray:  'bg-gray-50  text-gray-800  border-gray-200',
};

export default function PoliciesSection() {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchState = () => {
    setLoading(true);
    setError(null);
    fetch('/api/admin/policies')
      .then(r => {
        if (r.status === 403) throw new Error('Admin access required');
        if (!r.ok) throw new Error('Failed to load policies');
        return r.json();
      })
      .then(data => setState(data))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchState(); }, []);

  // Only blank the section on the FIRST load. Subsequent refetches keep
  // the prior state on screen so per-slot transient state (outcome banner,
  // form expansion) survives a reload-after-publish.
  if (loading && !state) {
    return <div className="text-gray-500 text-sm">Loading…</div>;
  }

  if (error && !state) {
    return <div className="text-red-600 text-sm">{error}</div>;
  }

  if (!state || !state.slots || state.slots.length === 0) {
    return <div className="text-gray-500 text-sm">No visible policy slots.</div>;
  }

  return (
    <>
      <p className="text-xs text-gray-500 mb-4">
        Publish a new version of a policy. Version rows are immutable once referenced — edits always create a new version and flip the active pointer.
      </p>
      <div className="space-y-6">
        {state.slots.map(slot => (
          <SlotPanel key={slot.code} slot={slot} onPublishedReload={fetchState} />
        ))}
      </div>
    </>
  );
}

function SlotPanel({ slot, onPublishedReload }) {
  const [expanded, setExpanded] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const dataverseFields = buildSlotDataverseFields(slot);

  if (slot.invariantError) {
    const tone = STATUS_COPY[slot.invariantError]?.tone || 'red';
    return (
      <div className="border rounded-lg p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="font-medium text-gray-900">{slot.code}</div>
          <DataverseFieldInfoButton items={dataverseFields} />
        </div>
        <div className={`mt-2 text-sm px-3 py-2 rounded border ${TONE_CLASSES[tone]}`}>
          {STATUS_COPY[slot.invariantError]?.text || slot.invariantError}
          {slot.duplicateIds && (
            <div className="mt-1 text-xs">Duplicate IDs: {slot.duplicateIds.join(', ')}</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="p-4 bg-gray-50 border-b">
        <div className="flex items-baseline justify-between">
          <div>
            <div className="font-medium text-gray-900">{slot.displayName || slot.code}</div>
            <div className="text-xs text-gray-500">slot: <code>{slot.code}</code></div>
          </div>
          <div className="flex items-center gap-2">
            <DataverseFieldInfoButton items={dataverseFields} />
            <button
              onClick={() => setExpanded(e => !e)}
              className="px-3 py-1.5 text-sm bg-gray-900 text-white rounded hover:bg-gray-800"
            >
              {expanded ? 'Cancel' : 'Publish new version'}
            </button>
          </div>
        </div>

        {slot.activeVersion ? (
          <div className="mt-3">
            <div className="text-xs text-gray-500 mb-1">
              Active version: <strong>{slot.activeVersion.versionLabel}</strong>
              {slot.activeVersion.effectiveDate && <> · effective {slot.activeVersion.effectiveDate}</>}
            </div>
            <div className="text-sm font-medium text-gray-800">{slot.activeVersion.title}</div>
            <div
              className="prose prose-sm max-w-none mt-2 text-gray-700"
              dangerouslySetInnerHTML={/* nosemgrep: typescript.react.security.audit.react-dangerouslysetinnerhtml.react-dangerouslysetinnerhtml -- renderPolicyMarkdown sanitizes via DOMPurify strict allowlist; server validator rejects raw HTML */ { __html: renderPolicyMarkdown(slot.activeVersion.body || '') }}
            />
          </div>
        ) : (
          <div className="mt-3 text-sm text-amber-700">No active version yet.</div>
        )}
      </div>

      {expanded && (
        <PublishForm
          slot={slot}
          onSuccess={(o) => { setOutcome(o); onPublishedReload(); setExpanded(false); }}
          onOutcome={setOutcome}
        />
      )}

      {outcome && <OutcomeBanner outcome={outcome} onDismiss={() => setOutcome(null)} />}

      {slot.versions && slot.versions.length > 1 && (
        <VersionHistory versions={slot.versions} />
      )}
    </div>
  );
}

function buildSlotDataverseFields(slot) {
  const slotRow = `wmkf_code = "${slot.code}"`;
  const versionRow = slot.activeVersion?.id
    ? `wmkf_policyversionid = "${slot.activeVersion.id}"`
    : 'Current child is selected by the parent wmkf_activeversion lookup.';
  return [
    {
      label: 'Slot code',
      entity: 'wmkf_policy',
      entitySet: 'wmkf_policies',
      field: 'wmkf_code',
      row: slotRow,
    },
    {
      label: 'Slot display name',
      entity: 'wmkf_policy',
      entitySet: 'wmkf_policies',
      field: 'wmkf_displayname',
      row: slotRow,
    },
    {
      label: 'Active version pointer',
      entity: 'wmkf_policy',
      entitySet: 'wmkf_policies',
      field: 'wmkf_activeversion',
      row: slotRow,
      note: 'The route reads this as _wmkf_activeversion_value and publishes by flipping the parent lookup.',
    },
    {
      label: 'Active version label',
      entity: 'wmkf_policyversion',
      entitySet: 'wmkf_policyversions',
      field: 'wmkf_versionlabel',
      row: versionRow,
    },
    {
      label: 'Active version title',
      entity: 'wmkf_policyversion',
      entitySet: 'wmkf_policyversions',
      field: 'wmkf_policytitle',
      row: versionRow,
    },
    {
      label: 'Active version body',
      entity: 'wmkf_policyversion',
      entitySet: 'wmkf_policyversions',
      field: 'wmkf_policybody',
      row: versionRow,
    },
    {
      label: 'Effective date',
      entity: 'wmkf_policyversion',
      entitySet: 'wmkf_policyversions',
      field: 'wmkf_effectivedate',
      row: versionRow,
    },
    {
      label: 'Version state',
      entity: 'wmkf_policyversion',
      entitySet: 'wmkf_policyversions',
      field: 'statecode / statuscode',
      row: versionRow,
      note: 'The active version is authoritative through the parent lookup; state is shown for repair/history context.',
    },
  ];
}

function PublishForm({ slot, onSuccess, onOutcome }) {
  const [versionLabel, setVersionLabel] = useState(todayISO());
  const [title, setTitle] = useState(slot.activeVersion?.title || '');
  const [body, setBody] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(todayISO());
  const [submitting, setSubmitting] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const prefillFromActive = () => {
    if (!slot.activeVersion) return;
    setVersionLabel(slot.activeVersion.versionLabel || '');
    setTitle(slot.activeVersion.title || '');
    setBody(slot.activeVersion.body || '');
    setEffectiveDate(slot.activeVersion.effectiveDate || todayISO());
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const r = await fetch('/api/admin/policies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slotCode: slot.code,
          versionLabel,
          title,
          body,
          effectiveDate,
          parentEtag: slot.parentEtag,
        }),
      });
      const data = await r.json();
      if (data.status === 'completed' || data.status === 'already_published') {
        onSuccess(data);
      } else {
        onOutcome(data);
      }
    } catch (err) {
      onOutcome({ status: 'failed', warnings: [err.message] });
    } finally {
      setSubmitting(false);
    }
  };

  const bodyTooShort = body.length < 50;

  return (
    <div className="p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs text-gray-700">
          Version label
          <input
            value={versionLabel}
            onChange={e => setVersionLabel(e.target.value)}
            maxLength={50}
            className="mt-1 w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
          />
        </label>
        <label className="block text-xs text-gray-700">
          Effective date
          <input
            type="date"
            value={effectiveDate}
            onChange={e => setEffectiveDate(e.target.value)}
            className="mt-1 w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
          />
        </label>
      </div>

      <label className="block text-xs text-gray-700">
        Title
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          maxLength={300}
          className="mt-1 w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
        />
      </label>

      <label className="block text-xs text-gray-700">
        Body (markdown)
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={10}
          maxLength={64 * 1024}
          className="mt-1 w-full px-2 py-1.5 border border-gray-300 rounded text-sm font-mono text-xs"
          placeholder="Paste or write the policy text. Markdown is supported (headings, lists, bold/italic, links). Raw HTML is rejected by the server."
        />
        <div className="mt-1 flex items-center justify-between text-[10px] text-gray-400">
          <span>{body.length} chars (min 50)</span>
          <button
            type="button"
            onClick={() => setPreviewOpen(p => !p)}
            className="text-gray-600 hover:text-gray-900"
          >
            {previewOpen ? 'Hide preview' : 'Show preview'}
          </button>
        </div>
      </label>

      {previewOpen && (
        <div className="border rounded p-3 bg-white">
          <div className="text-[10px] uppercase text-gray-500 mb-2">Preview</div>
          <div
            className="prose prose-sm max-w-none text-gray-800"
            dangerouslySetInnerHTML={/* nosemgrep: typescript.react.security.audit.react-dangerouslysetinnerhtml.react-dangerouslysetinnerhtml -- renderPolicyMarkdown sanitizes via DOMPurify strict allowlist; server validator rejects raw HTML */ { __html: renderPolicyMarkdown(body) }}
          />
        </div>
      )}

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={prefillFromActive}
          disabled={!slot.activeVersion}
          className="text-xs text-gray-600 hover:text-gray-900 disabled:opacity-40"
          title="Copy the currently active version's fields into this form. Useful for testing already_published or for tweaking a single field."
        >
          Prefill from active version
        </button>
        <button
          onClick={submit}
          disabled={submitting || !title.trim() || bodyTooShort || !versionLabel.trim()}
          className="px-4 py-1.5 bg-gray-900 text-white text-sm font-medium rounded hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {submitting ? 'Publishing…' : 'Publish'}
        </button>
      </div>
    </div>
  );
}

function OutcomeBanner({ outcome, onDismiss }) {
  const meta = STATUS_COPY[outcome.status] || { tone: 'gray', text: outcome.status };
  return (
    <div className={`p-3 border-t text-sm ${TONE_CLASSES[meta.tone]}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="font-medium">{meta.text}</div>
          {outcome.warnings && outcome.warnings.length > 0 && (
            <ul className="mt-1 text-xs list-disc ml-5">
              {outcome.warnings.map((w, i) => (<li key={i}>{w}</li>))}
            </ul>
          )}
          {outcome.details?.dropped && outcome.details.dropped.length > 0 && (
            <div className="mt-1 text-xs">
              Dropped: <code>{outcome.details.dropped.join(', ')}</code>
            </div>
          )}
          {outcome.details?.existing && outcome.details?.submitted && (
            <DiffBlock
              existing={outcome.details.existing}
              submitted={outcome.details.submitted}
              fieldsMatch={outcome.details.fieldsMatch}
            />
          )}
          {outcome.orphan && (
            <div className="mt-1 text-xs">
              Orphan version: <code>{outcome.orphan.id}</code> ({outcome.orphan.reason})
            </div>
          )}
        </div>
        <button onClick={onDismiss} className="text-xs underline">dismiss</button>
      </div>
    </div>
  );
}

function DiffBlock({ existing, submitted, fieldsMatch }) {
  const mark = (matches) => (matches === undefined ? '' : matches ? ' ✓' : ' ✗ differs');
  return (
    <div className="mt-2 grid grid-cols-2 gap-3 text-xs">
      <div>
        <div className="font-semibold mb-1">Existing</div>
        <div>Label: {existing.versionLabel}</div>
        <div>Title{mark(fieldsMatch?.title)}: {existing.title}</div>
        <div>Effective{mark(fieldsMatch?.effectiveDate)}: {existing.effectiveDate}</div>
        <div>Body{mark(fieldsMatch?.body)} ({existing.bodyLength ?? '?'} chars):</div>
        <div className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[10px]">
          {existing.bodyExcerpt}
        </div>
      </div>
      <div>
        <div className="font-semibold mb-1">Submitted</div>
        <div>Label: {submitted.versionLabel}</div>
        <div>Title{mark(fieldsMatch?.title)}: {submitted.title}</div>
        <div>Effective{mark(fieldsMatch?.effectiveDate)}: {submitted.effectiveDate}</div>
        <div>Body{mark(fieldsMatch?.body)} ({submitted.bodyLength ?? '?'} chars):</div>
        <div className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[10px]">
          {submitted.bodyExcerpt}
        </div>
      </div>
    </div>
  );
}

function VersionHistory({ versions }) {
  const [open, setOpen] = useState(false);
  const inactive = versions.filter(v => !v.isActive);
  if (inactive.length === 0) return null;
  return (
    <div className="p-3 border-t bg-white">
      <button
        onClick={() => setOpen(o => !o)}
        className="text-xs text-gray-600 hover:text-gray-900"
      >
        {open ? '▼' : '▶'} Version history ({inactive.length})
      </button>
      {open && (
        <ul className="mt-2 space-y-1 text-xs">
          {inactive.map(v => (
            <li key={v.id} className="flex items-center gap-2 text-gray-700">
              <span className="font-mono">{v.versionLabel}</span>
              <span className="text-gray-500">{v.title}</span>
              {v.isResidue && (
                <span
                  className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px]"
                  title="This version was created but never activated — likely a partial publish failure. Safe to leave; consider manual cleanup if frequent."
                >
                  Repair needed
                </span>
              )}
              {!v.isResidue && !v.isActive && (
                <span className="text-[10px] text-gray-400">retired</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
