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
import { requestEnvelope } from '../../utils/api-request';
import { Button } from '../Layout';
import DataverseFieldInfoButton from './DataverseFieldInfoButton';
import DisclosureRow from './DisclosureRow';
import OutcomeBanner from './OutcomeBanner';
import PublishForm from './PolicyPublishForm';
import DiffBlock from './PolicyDiffBlock';
import { StatusChip } from './AdminWorkspaceNavigation';

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
    requestEnvelope('/api/admin/policies')
      .then(({ ok, status, data }) => {
        if (status === 403) throw new Error('Admin access required');
        if (!ok) throw new Error('Failed to load policies');
        return data;
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
