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

import { useState, useEffect } from 'react';
import { renderPolicyMarkdown } from '../../utils/policy-markdown-client';
import { Button } from '../Layout';
import DataverseFieldInfoButton from './DataverseFieldInfoButton';
import DisclosureRow from './DisclosureRow';
import OutcomeBanner from './OutcomeBanner';
import { StatusChip } from './AdminWorkspaceNavigation';

const INPUT_CLASS = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300 focus:border-gray-500';
const TEXTAREA_CLASS = `${INPUT_CLASS} font-mono`;

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Labels are unique per slot (Dataverse alternate key; server-enforced).
// Comparison mirrors the server: trimmed, and case-insensitive like the
// Dataverse OData label lookup. slot.versions is capped at the 50 newest,
// so this set is advisory — the server remains the enforcer.
function takenLabelSet(versions) {
  return new Set((versions || []).map(v => (v.versionLabel || '').trim().toLowerCase()));
}

function isLabelTaken(label, taken) {
  return taken.has((label || '').trim().toLowerCase());
}

function suggestUniqueLabel(base, taken) {
  const root = (base || todayISO()).trim();
  if (!isLabelTaken(root, taken)) return root;
  for (let i = 2; i <= 99; i++) {
    const candidate = `${root}-${i}`;
    if (candidate.length <= 50 && !isLabelTaken(candidate, taken)) return candidate;
  }
  return root;
}

const STATUS_COPY = {
  completed:             { tone: 'green',  text: 'Published.' },
  already_published:     { tone: 'gray',   text: 'No change — that exact version is already active.' },
  partial:               { tone: 'amber',  text: 'Published with warnings — see details below.' },
  concurrency_conflict:  { tone: 'amber',  text: 'Another admin published while you were editing. Reload and re-apply your changes.' },
  label_conflict:        { tone: 'amber',  text: 'That label is already used by a published version with different content. Published versions are immutable — pick a new label (see the suggestion under the label field) and publish again.' },
  invalid_body:          { tone: 'red',    text: 'Policy body contains disallowed content.' },
  slot_not_provisioned:  { tone: 'red',    text: 'This policy has not been set up in Dataverse yet. Contact an administrator.' },
  duplicate_slot_rows:   { tone: 'red',    text: 'This policy has more than one Dataverse record. Contact an administrator before publishing.' },
  audit_unavailable:     { tone: 'red',    text: 'The audit log is unavailable, so publishing was refused. Try again later.' },
  failed:                { tone: 'red',    text: 'Publishing failed. Try again; if it keeps failing, contact an administrator.' },
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
    return <div className="text-red-700 text-sm">{error}</div>;
  }

  if (!state || !state.slots || state.slots.length === 0) {
    return <div className="text-gray-500 text-sm">No visible policy slots.</div>;
  }

  return (
    <div className="space-y-3">
      {state.slots.map(slot => (
        <SlotPanel key={slot.code} slot={slot} onPublishedReload={fetchState} />
      ))}
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

function SlotPanel({ slot, onPublishedReload }) {
  const [editing, setEditing] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const dataverseFields = buildSlotDataverseFields(slot);

  const dataverseFieldsGuard = (
    // Capture phase: see DisclosureRow's doc comment — stopPropagation inside
    // the popover doesn't cancel <summary>'s native toggle, only preventDefault does.
    <span onClickCapture={(e) => e.preventDefault()}>
      <DataverseFieldInfoButton items={dataverseFields} />
    </span>
  );

  if (slot.invariantError) {
    const meta = STATUS_COPY[slot.invariantError] || { tone: 'red', text: slot.invariantError };
    return (
      <div className="rounded-lg border border-gray-200 p-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-sm font-semibold text-gray-900">{slot.displayName || slot.code}</h3>
          <DataverseFieldInfoButton items={dataverseFields} />
        </div>
        <div className="mt-2">
          <OutcomeBanner tone={meta.tone} text={meta.text}>
            {slot.duplicateIds && (
              <div className="mt-1 text-xs">Duplicate IDs: {slot.duplicateIds.join(', ')}</div>
            )}
          </OutcomeBanner>
        </div>
      </div>
    );
  }

  const inactiveVersions = (slot.versions || []).filter(v => !v.isActive);

  return (
    <div className="rounded-lg border border-gray-200">
      <DisclosureRow
        id={`policy-slot-${slot.code}`}
        groupName="slot"
        headingLevel={3}
        title={slot.displayName || slot.code}
        meta={
          slot.activeVersion ? (
            <span className="inline-flex items-center gap-2">
              <StatusChip tone="green">Active version</StatusChip>
              <span>{slot.activeVersion.versionLabel}{slot.activeVersion.effectiveDate && <> · effective {slot.activeVersion.effectiveDate}</>}</span>
            </span>
          ) : (
            <StatusChip tone="amber">No active version</StatusChip>
          )
        }
        actions={dataverseFieldsGuard}
      >
        <div className="space-y-4">
          <div>
            {editing ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>
                Cancel editing
              </Button>
            ) : (
              <Button type="button" variant="primary" size="sm" onClick={() => setEditing(true)}>
                Edit policy
              </Button>
            )}
          </div>

          {editing && (
            <PublishForm
              slot={slot}
              onSuccess={(o) => { setOutcome(o); onPublishedReload(); setEditing(false); }}
              onOutcome={setOutcome}
            />
          )}

          {outcome && <OutcomeBanner tone={(STATUS_COPY[outcome.status] || {}).tone || 'gray'} text={(STATUS_COPY[outcome.status] || {}).text || outcome.status} onDismiss={() => setOutcome(null)}>
            <OutcomeExtras outcome={outcome} />
          </OutcomeBanner>}

          {editing ? (
            slot.activeVersion && (
              <DisclosureRow
                id={`policy-slot-${slot.code}-current`}
                groupName="current"
                headingLevel={4}
                title="Current version"
              >
                <ActiveVersionBody activeVersion={slot.activeVersion} />
              </DisclosureRow>
            )
          ) : (
            slot.activeVersion ? (
              <ActiveVersionBody activeVersion={slot.activeVersion} />
            ) : (
              <div className="text-sm text-amber-700">No active version yet.</div>
            )
          )}

          {inactiveVersions.length > 0 && (
            <DisclosureRow
              id={`policy-slot-${slot.code}-history`}
              groupName="history"
              headingLevel={4}
              title={`Version history (${inactiveVersions.length})`}
            >
              <VersionHistory versions={inactiveVersions} />
            </DisclosureRow>
          )}
        </div>
      </DisclosureRow>
    </div>
  );
}

function OutcomeExtras({ outcome }) {
  return (
    <>
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
    </>
  );
}

function ActiveVersionBody({ activeVersion }) {
  return (
    <div>
      <div className="text-sm font-medium text-gray-800">{activeVersion.title}</div>
      <div
        className="prose prose-sm max-w-none mt-2 text-gray-700"
        dangerouslySetInnerHTML={/* nosemgrep: typescript.react.security.audit.react-dangerouslysetinnerhtml.react-dangerouslysetinnerhtml -- renderPolicyMarkdown sanitizes via DOMPurify strict allowlist; server validator rejects raw HTML */ { __html: renderPolicyMarkdown(activeVersion.body || '') }}
      />
    </div>
  );
}

function buildDiffSide(versionLabel, title, effectiveDate, body) {
  return {
    versionLabel,
    title,
    effectiveDate,
    bodyLength: (body || '').length,
    bodyExcerpt: (body || '').slice(0, 200),
  };
}

function PublishForm({ slot, onSuccess, onOutcome }) {
  const taken = takenLabelSet(slot.versions);
  const [versionLabel, setVersionLabel] = useState(() => suggestUniqueLabel(todayISO(), taken));
  const [title, setTitle] = useState(slot.activeVersion?.title || '');
  const [body, setBody] = useState(slot.activeVersion?.body || '');
  const [effectiveDate, setEffectiveDate] = useState(todayISO());
  const [submitting, setSubmitting] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const resetToActive = () => {
    setTitle(slot.activeVersion?.title || '');
    setBody(slot.activeVersion?.body || '');
    setEffectiveDate(todayISO());
    setVersionLabel(suggestUniqueLabel(todayISO(), taken));
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
      setConfirming(false);
    }
  };

  const bodyTooShort = body.length < 50;
  const labelTaken = isLabelTaken(versionLabel, taken);
  const suggestedLabel = suggestUniqueLabel(versionLabel, taken);
  const canPublish = !submitting && title.trim() && !bodyTooShort && versionLabel.trim();

  if (confirming) {
    const existing = slot.activeVersion
      ? buildDiffSide(slot.activeVersion.versionLabel, slot.activeVersion.title, slot.activeVersion.effectiveDate, slot.activeVersion.body)
      : null;
    const submitted = buildDiffSide(versionLabel, title, effectiveDate, body);
    const fieldsMatch = existing ? {
      title: existing.title === submitted.title,
      effectiveDate: existing.effectiveDate === submitted.effectiveDate,
      body: (slot.activeVersion.body || '') === body,
    } : undefined;

    return (
      <div className="space-y-3 rounded-lg border border-gray-200 p-4">
        <p className="text-sm text-gray-800">
          Publish version <strong>{versionLabel}</strong>, effective {effectiveDate}? Published versions cannot be edited later.
        </p>
        {existing ? (
          <DiffBlock existing={existing} submitted={submitted} fieldsMatch={fieldsMatch} />
        ) : (
          <p className="text-xs text-gray-500">This will be the first version.</p>
        )}
        <div className="flex items-center gap-2">
          <Button type="button" variant="primary" size="sm" onClick={submit} disabled={submitting}>
            {submitting ? 'Publishing…' : 'Publish'}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(false)} disabled={submitting}>
            Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm font-medium text-gray-700">
          Version label
          <input
            value={versionLabel}
            onChange={e => setVersionLabel(e.target.value)}
            maxLength={50}
            className={`mt-1 ${INPUT_CLASS}`}
          />
          {labelTaken && (
            <span className="mt-1 block text-xs text-amber-700">
              Already used by a published version. Identical content is a no-op; changed
              content will be rejected — versions are immutable.{' '}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setVersionLabel(suggestedLabel)}
                className="mt-1"
              >
                Use “{suggestedLabel}”
              </Button>
            </span>
          )}
        </label>
        <label className="block text-sm font-medium text-gray-700">
          Effective date
          <input
            type="date"
            value={effectiveDate}
            onChange={e => setEffectiveDate(e.target.value)}
            className={`mt-1 ${INPUT_CLASS}`}
          />
        </label>
      </div>

      <label className="block text-sm font-medium text-gray-700">
        Title
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          maxLength={300}
          className={`mt-1 ${INPUT_CLASS}`}
        />
      </label>

      <label className="block text-sm font-medium text-gray-700">
        Body (markdown)
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={12}
          maxLength={64 * 1024}
          className={`mt-1 ${TEXTAREA_CLASS}`}
          placeholder="Paste or write the policy text. Markdown is supported (headings, lists, bold/italic, links). Raw HTML is rejected by the server."
        />
        <div className="mt-1 flex items-center justify-between text-xs text-gray-500">
          <span>{body.length} chars (min 50)</span>
          <Button type="button" variant="outline" size="sm" onClick={() => setPreviewOpen(p => !p)}>
            {previewOpen ? 'Hide preview' : 'Show preview'}
          </Button>
        </div>
      </label>

      {previewOpen && (
        <div className="rounded-lg border border-gray-200 p-3 bg-white">
          <div className="text-xs uppercase text-gray-500 mb-2">Preview</div>
          <div
            className="prose prose-sm max-w-none text-gray-800"
            dangerouslySetInnerHTML={/* nosemgrep: typescript.react.security.audit.react-dangerouslysetinnerhtml.react-dangerouslysetinnerhtml -- renderPolicyMarkdown sanitizes via DOMPurify strict allowlist; server validator rejects raw HTML */ { __html: renderPolicyMarkdown(body) }}
          />
        </div>
      )}

      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={resetToActive}
          disabled={!slot.activeVersion}
        >
          Reset to active version
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={() => setConfirming(true)}
          disabled={!canPublish}
        >
          Publish
        </Button>
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
        <div className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-xs">
          {existing.bodyExcerpt}
        </div>
      </div>
      <div>
        <div className="font-semibold mb-1">Submitted</div>
        <div>Label: {submitted.versionLabel}</div>
        <div>Title{mark(fieldsMatch?.title)}: {submitted.title}</div>
        <div>Effective{mark(fieldsMatch?.effectiveDate)}: {submitted.effectiveDate}</div>
        <div>Body{mark(fieldsMatch?.body)} ({submitted.bodyLength ?? '?'} chars):</div>
        <div className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-xs">
          {submitted.bodyExcerpt}
        </div>
      </div>
    </div>
  );
}

function VersionHistory({ versions }) {
  return (
    <ul className="space-y-1 text-xs">
      {versions.map(v => (
        <li key={v.id} className="flex items-center gap-2 text-gray-700">
          <span className="font-mono">{v.versionLabel}</span>
          <span className="text-gray-500">{v.title}</span>
          {v.isResidue ? (
            <span title="This version was created but never activated — likely a partial publish failure. Safe to leave; consider manual cleanup if frequent.">
              <StatusChip tone="red">Repair needed</StatusChip>
            </span>
          ) : (
            <StatusChip tone="gray">Retired</StatusChip>
          )}
        </li>
      ))}
    </ul>
  );
}
