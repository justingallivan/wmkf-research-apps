/**
 * Stage 2a view — pre-materials invitation landing.
 *
 * Stack:
 *   1. Proposal summary card (read-only)
 *   2. Confirm contact info (inline-editable)
 *   3. Honorarium opt-out (single checkbox)
 *   4. Two policy ack cards (compact; each opens a modal on click)
 *   5. Accept / Decline buttons
 *
 * Accept disabled until both policies are in the acknowledged state.
 * Decline is always enabled — submits to the dispatcher's onRequestDecline
 * callback which routes to the decline-form view.
 *
 * On Accept submit, calls /respond with action='accept' + the contact edits
 * collected here + honorariumOptOut + policyAcks { slot: true }. Server
 * resolves the active wmkf_policyversion lookups at accept time (we don't
 * round-trip the GUIDs from the client — booleans express intent, server
 * pins the versions).
 */

import { useEffect, useRef, useState } from 'react';
import PolicyAckModal from './PolicyAckModal';

export default function Stage2aView({ data, token, onRequestDecline, onAccepted }) {
  const prefill = data.prefill || {};
  const policies = data.policies || {};
  const policySlots = ['reviewer-coi', 'reviewer-ai-use'];

  // Per-field local form state — initialized from server prefill.
  const [contact, setContact] = useState({
    firstName: prefill.firstName || '',
    lastName: prefill.lastName || '',
    nickname: prefill.nickname || '',
    title: prefill.title || '',
    affiliation: prefill.affiliation || '',
    email: prefill.email || '',
    orcid: prefill.orcid || '',
  });
  const [honorariumOptOut, setHonorariumOptOut] = useState(!!prefill.honorariumOptOut);

  // Per-slot ack state. Modal handles the scroll-gate; we just track which
  // slots have been acknowledged in this session.
  const [acknowledged, setAcknowledged] = useState({});
  const [openModalSlot, setOpenModalSlot] = useState(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Refs for restoring focus to the policy-card "Read policy" button when the
  // modal closes — standard a11y pattern. Keyed by slot code.
  const policyTriggerRefs = useRef({});

  // Heading focus on view entry so screen readers announce the new view.
  const headingRef = useRef(null);
  useEffect(() => {
    if (headingRef.current) headingRef.current.focus();
  }, []);

  const allAcked = policySlots.every((s) => acknowledged[s]);

  function updateField(name, value) {
    setContact((c) => ({ ...c, [name]: value }));
  }

  async function handleAccept() {
    setError(null);
    if (!allAcked) {
      setError('Please acknowledge both policies to proceed.');
      return;
    }
    setSubmitting(true);
    try {
      // Send only fields that differ from the server prefill (prevents
      // writing junk when the reviewer didn't touch anything). Trim each
      // value before comparing — a whitespace-only edit (trailing space
      // pasted from email, accidental spacebar in an empty field) shouldn't
      // count as a real change. The trimmed value is what gets written.
      const contactEdits = {};
      for (const [k, v] of Object.entries(contact)) {
        const trimmed = (v || '').trim();
        if (trimmed !== (prefill[k] || '').trim()) contactEdits[k] = trimmed;
      }
      const resp = await fetch(`/api/external/review/${encodeURIComponent(token)}/respond`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Optimistic lock: round-trip the suggestion _etag from page load so
          // a concurrent staff edit is caught with a 412 (handled below).
          ...(data.etag ? { 'If-Match': data.etag } : {}),
        },
        body: JSON.stringify({
          action: 'accept',
          contactEdits: Object.keys(contactEdits).length ? contactEdits : undefined,
          honorariumOptOut,
          policyAcks: Object.fromEntries(policySlots.map((s) => [s, true])),
        }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok || !json.ok) {
        if (resp.status === 409) {
          setError(
            json.message || 'This invitation can no longer be accepted online. Please contact your Program Director.',
          );
        } else if (resp.status === 412) {
          setError('Someone else updated this invitation while you were viewing it. Please refresh and try again.');
        } else if (json.reason === 'policy_misconfigured') {
          setError('We hit a configuration error on our end. The Foundation has been notified.');
        } else {
          setError('Could not submit your response. Please try again.');
        }
        setSubmitting(false);
        return;
      }
      // Success — await parent's context refetch + view transition before
      // letting the finally re-enable submit. This closes the race where a
      // user could double-click Accept while the parent was mid-fetch.
      // The component will unmount when the new view renders, so submitting
      // doesn't need to be reset on success.
      await onAccepted();
    } catch (e) {
      setError('Network error. Please try again.');
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="text-xl font-semibold text-gray-900 outline-none sr-only"
      >
        Invitation to review
      </h2>
      <ProposalSummaryCard proposal={data.proposal} />

      <ContactConfirmCard
        contact={contact}
        affiliationHint={prefill.affiliationHint}
        onUpdate={updateField}
        disabled={submitting}
      />

      <HonorariumCard
        value={honorariumOptOut}
        onChange={setHonorariumOptOut}
        disabled={submitting}
      />

      <div className="space-y-3">
        <p className="text-xs uppercase tracking-wide text-gray-500">Required acknowledgments</p>
        {policySlots.map((slot) => {
          const policy = policies[slot];
          if (!policy) return null;
          return (
            <PolicyAckCard
              key={slot}
              policy={policy}
              isAcknowledged={!!acknowledged[slot]}
              triggerRef={(el) => { policyTriggerRefs.current[slot] = el; }}
              onOpen={() => setOpenModalSlot(slot)}
            />
          );
        })}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 pt-2">
        <button
          type="button"
          onClick={onRequestDecline}
          disabled={submitting}
          className="px-4 py-2 text-sm text-gray-700 hover:text-gray-900 disabled:text-gray-400"
        >
          Decline
        </button>
        <button
          type="button"
          onClick={handleAccept}
          disabled={!allAcked || submitting}
          className="px-5 py-2.5 text-sm font-semibold rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          {submitting ? 'Submitting…' : 'Accept and continue'}
        </button>
      </div>

      {openModalSlot && policies[openModalSlot] && (
        <PolicyAckModal
          policy={policies[openModalSlot]}
          isAcknowledged={!!acknowledged[openModalSlot]}
          onAcknowledge={() => {
            const slot = openModalSlot;
            setAcknowledged((a) => ({ ...a, [slot]: true }));
            setOpenModalSlot(null);
            // Restore focus to the trigger button after the modal unmounts.
            // Defer to next tick so the parent re-render has happened.
            requestAnimationFrame(() => policyTriggerRefs.current[slot]?.focus());
          }}
          onClose={() => {
            const slot = openModalSlot;
            setOpenModalSlot(null);
            requestAnimationFrame(() => policyTriggerRefs.current[slot]?.focus());
          }}
        />
      )}
    </div>
  );
}

function ProposalSummaryCard({ proposal }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6">
      <p className="text-xs uppercase tracking-wide text-gray-500">Proposal</p>
      <h2 className="text-lg font-semibold text-gray-900 mt-1">{proposal.title}</h2>
      <p className="text-sm text-gray-600 mt-1">
        Request #{proposal.requestNumber}
        {proposal.applicantInstitution ? ` · ${proposal.applicantInstitution}` : ''}
      </p>
      {proposal.projectLeader && (
        <p className="text-sm text-gray-700 mt-3">
          <span className="text-xs text-gray-500 uppercase tracking-wide mr-1">PI</span>
          {proposal.projectLeader}
        </p>
      )}
      {proposal.coPIs && proposal.coPIs.length > 0 && (
        <p className="text-sm text-gray-700 mt-1">
          <span className="text-xs text-gray-500 uppercase tracking-wide mr-1">Co-PIs</span>
          {proposal.coPIs.join(', ')}
        </p>
      )}
      {proposal.abstract && (
        <div className="mt-4 pt-4 border-t border-gray-100">
          <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">Abstract</p>
          <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
            {proposal.abstract}
          </p>
        </div>
      )}
    </div>
  );
}

function ContactConfirmCard({ contact, affiliationHint, onUpdate, disabled }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6">
      <h3 className="text-base font-semibold text-gray-900">Confirm your contact info</h3>
      <p className="text-sm text-gray-600 mt-1">
        We pre-filled what we have on file. Please correct anything that's out of date.
      </p>
      <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="First name" value={contact.firstName} onChange={(v) => onUpdate('firstName', v)} disabled={disabled} />
        <Field label="Last name" value={contact.lastName} onChange={(v) => onUpdate('lastName', v)} disabled={disabled} />
        <Field label="Display preference" value={contact.nickname} onChange={(v) => onUpdate('nickname', v)} placeholder="e.g., 'Sam' or 'Dr. Lee'" disabled={disabled} />
        <Field label="Title" value={contact.title} onChange={(v) => onUpdate('title', v)} disabled={disabled} />
        <Field
          label="Affiliation"
          value={contact.affiliation}
          onChange={(v) => onUpdate('affiliation', v)}
          disabled={disabled}
          fullWidth
          hint={affiliationHint ? `On file from your prior role at ${affiliationHint} — please update if you've moved.` : null}
        />
        <Field label="Email" value={contact.email} onChange={(v) => onUpdate('email', v)} type="email" disabled={disabled} />
        <Field label="ORCID" value={contact.orcid} onChange={(v) => onUpdate('orcid', v)} placeholder="0000-0000-0000-0000" disabled={disabled} />
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', placeholder, disabled, fullWidth, hint }) {
  return (
    <label className={`block text-sm ${fullWidth ? 'sm:col-span-2' : ''}`}>
      <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:ring-0 disabled:bg-gray-50"
      />
      {hint && <span className="block text-xs text-gray-500 mt-1">{hint}</span>}
    </label>
  );
}

function HonorariumCard({ value, onChange, disabled }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          className="mt-1 h-4 w-4 rounded border-gray-300"
        />
        <span className="text-sm text-gray-800">
          <span className="font-semibold">I'd prefer to decline the honorarium.</span>
          <span className="block text-xs text-gray-500 mt-0.5">
            Optional. The Foundation offers a modest honorarium for completed reviews; check this box if you'd rather not receive it.
          </span>
        </span>
      </label>
    </div>
  );
}

function PolicyAckCard({ policy, isAcknowledged, triggerRef, onOpen }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5 flex items-center justify-between gap-3">
      <div>
        <h4 className="text-sm font-semibold text-gray-900">{policy.title}</h4>
        {isAcknowledged ? (
          <p className="text-xs text-green-700 mt-1">
            ✓ Acknowledged · v{policy.versionLabel}{' '}
            <button
              type="button"
              ref={triggerRef}
              onClick={onOpen}
              className="ml-2 text-xs text-gray-500 underline hover:text-gray-700"
            >
              View again
            </button>
          </p>
        ) : (
          <p className="text-xs text-gray-500 mt-1">Read and acknowledge to proceed.</p>
        )}
      </div>
      {!isAcknowledged && (
        <button
          type="button"
          ref={triggerRef}
          onClick={onOpen}
          className="flex-shrink-0 px-3 py-1.5 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800"
        >
          Read policy →
        </button>
      )}
    </div>
  );
}
