/**
 * Stage 2a view — pre-materials invitation landing.
 *
 * Stack:
 *   1. Proposal summary card (read-only)
 *   2. Confirm contact info (inline-editable)
 *   3. Honorarium opt-out (single checkbox)
 *   4. Honorarium payment address (shown only when NOT opted out; chunk 5)
 *   5. Two policy ack cards (compact; each opens a modal on click)
 *   6. Accept / Decline buttons
 *
 * Accept disabled until both policies are in the acknowledged state. A blocked
 * submit also surfaces inline errors when the honorarium address is required
 * but incomplete (required only when the reviewer is taking the honorarium —
 * opting out hides the card and sends no address).
 * Decline is always enabled — submits to the dispatcher's onRequestDecline
 * callback which routes to the decline-form view.
 *
 * On Accept submit, calls /respond with action='accept' + the contact edits
 * collected here + honorariumOptOut + the optional payment address +
 * policyAcks { slot: true }. Server resolves the active wmkf_policyversion
 * lookups at accept time (we don't round-trip the GUIDs from the client —
 * booleans express intent, server pins the versions). Country is emitted as an
 * ISO-2 code to match the server validateAddress + downstream BILL contract.
 */

import { useEffect, useRef, useState } from 'react';
import PolicyAckModal from './PolicyAckModal';
import { COUNTRIES } from '../../config/countries';

// Payment-address fields the reviewer must complete to receive the honorarium.
// line2 + state stay optional (many countries have no sub-national state, and
// the downstream BILL contract treats both as optional). Mirrors the server's
// validateAddress field set in respond.js. Phone is required this cycle so staff
// have a contact number for manual honorarium payment (BILL onboarding deferred).
export const REQUIRED_ADDRESS_FIELDS = ['line1', 'city', 'postalCode', 'country', 'phone'];

// Server-side address fields that can be flagged inline when /respond rejects
// a value (keys match respond.js ADDRESS_MAX exactly).
const ADDRESS_FIELD_KEYS = new Set(['line1', 'line2', 'city', 'state', 'postalCode', 'country', 'phone']);

// S308 board-writeup identity — three REQUIRED fields captured at accept (academic
// rank, primary department, main institution). Person-level confirmed values used in
// board write-ups; the server re-validates on the public token endpoint.
const BOARD_IDENTITY_FIELDS = ['academicRank', 'primaryDepartment', 'mainInstitution'];
const BOARD_IDENTITY_FIELD_KEYS = new Set(BOARD_IDENTITY_FIELDS);

/** Required board-identity fields that are empty/whitespace. */
export function missingBoardIdentityFields(identity) {
  return BOARD_IDENTITY_FIELDS.filter((k) => !((identity[k] || '').trim()));
}

/**
 * The contactEdits object POSTed to /respond on accept. Contains only the
 * visible contact fields the reviewer actually changed (trimmed; unchanged
 * fields are omitted so we never re-write stale prefill), PLUS two values
 * DERIVED from the board-identity card:
 *   - title       ← academicRank   (becomes the CRM job title via wmkf_reviewertitle)
 *   - affiliation ← mainInstitution (the value used for the COI mismatch check)
 * Title and Affiliation are no longer separate inputs, so they always mirror
 * the reviewer-confirmed board identity rather than a stale on-file value.
 */
export function buildSubmitContactEdits({ contact, prefill = {}, boardIdentity }) {
  const edits = {};
  for (const [k, v] of Object.entries(contact)) {
    const trimmed = (v || '').trim();
    if (trimmed !== (prefill[k] || '').trim()) edits[k] = trimmed;
  }
  // Clamp to the server contactEdits caps (respond.js CONTACT_EDIT_MAX:
  // title 200, affiliation 300) so an over-long board value can't 400 the whole
  // accept. The board card has no maxLength and its person columns only truncate,
  // so without this an implausibly long rank/institution would hard-fail here.
  edits.title = (boardIdentity.academicRank || '').trim().slice(0, 200);
  edits.affiliation = (boardIdentity.mainInstitution || '').trim().slice(0, 300);
  return edits;
}

/**
 * Required address fields that are empty OR (for country) not a 2-char code.
 * The country guard makes the client contract explicit even though the closed
 * <select> only ever emits valid ISO-2 codes — server requires length === 2.
 */
export function missingAddressFields(address) {
  return REQUIRED_ADDRESS_FIELDS.filter((k) => {
    const v = (address[k] || '').trim();
    if (!v) return true;
    if (k === 'country' && !/^[A-Za-z]{2}$/.test(v)) return true;
    return false;
  });
}

/** Trimmed, non-empty address fields only — the shape POSTed to /respond. */
export function buildAddressPayload(address) {
  const out = {};
  for (const [k, v] of Object.entries(address)) {
    const trimmed = (v || '').trim();
    if (trimmed) out[k] = trimmed;
  }
  return out;
}

// Maps a /respond 400 validation reason to reviewer-facing copy. Covers the
// address branches of validateAddress + the contact branches of
// validateContactEdits so a rejected submit explains itself instead of
// collapsing into the generic failure message.
const VALIDATION_REASON_COPY = {
  invalid_country: 'Please select a valid country.',
  address_field_too_long: 'One of your mailing-address fields is too long. Please shorten it.',
  unknown_address_field: 'We couldn’t read part of your mailing address. Please re-check it.',
  invalid_address: 'Please re-check your mailing address.',
  invalid_address_field: 'Please re-check your mailing address.',
  invalid_email: 'That email address doesn’t look right. Please re-check it.',
  invalid_contact_field: 'Please re-check your contact details.',
  contact_field_too_long: 'One of your contact fields is too long. Please shorten it.',
  unknown_contact_field: 'We couldn’t read part of your contact details. Please re-check it.',
};

export default function Stage2aView({ data, token, onRequestDecline, onAccepted }) {
  const prefill = data.prefill || {};
  const policies = data.policies || {};
  const policySlots = ['reviewer-coi', 'reviewer-ai-use'];

  // Per-field local form state — initialized from server prefill.
  const [contact, setContact] = useState({
    firstName: prefill.firstName || '',
    lastName: prefill.lastName || '',
    email: prefill.email || '',
    orcid: prefill.orcid || '',
  });
  const [honorariumOptOut, setHonorariumOptOut] = useState(!!prefill.honorariumOptOut);

  // S308 board-writeup identity — required at accept. Prefilled from the person's
  // prior confirmed value (or enrichment seed for dept/institution); rank starts blank.
  const [boardIdentity, setBoardIdentity] = useState({
    academicRank: prefill.academicRank || '',
    primaryDepartment: prefill.primaryDepartment || '',
    mainInstitution: prefill.mainInstitution || '',
  });
  const [identityErrors, setIdentityErrors] = useState([]);

  // Payment mailing address — prefilled from the promoted contact when present
  // (empty for not-yet-promoted reviewers). Collected only when the reviewer is
  // taking the honorarium; the card is hidden when they opt out.
  const prefillAddress = prefill.address || {};
  const [address, setAddress] = useState({
    line1: prefillAddress.line1 || '',
    line2: prefillAddress.line2 || '',
    city: prefillAddress.city || '',
    state: prefillAddress.state || '',
    postalCode: prefillAddress.postalCode || '',
    country: prefillAddress.country || '',
    phone: prefillAddress.phone || '',
  });
  // Which required address fields to flag after a blocked submit attempt.
  const [addressErrors, setAddressErrors] = useState([]);

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

  function updateAddressField(name, value) {
    setAddress((a) => ({ ...a, [name]: value }));
    // Clear a field's error indicator as soon as the reviewer types into it.
    if (value && value.trim()) {
      setAddressErrors((errs) => errs.filter((k) => k !== name));
    }
  }

  function updateIdentityField(name, value) {
    setBoardIdentity((i) => ({ ...i, [name]: value }));
    if (value && value.trim()) {
      setIdentityErrors((errs) => errs.filter((k) => k !== name));
    }
  }

  async function handleAccept() {
    setError(null);
    setAddressErrors([]);
    setIdentityErrors([]);
    if (!allAcked) {
      setError('Please acknowledge both policies to proceed.');
      return;
    }
    // Board-writeup identity is required for every accept, independent of the
    // honorarium choice.
    const missingIdentity = missingBoardIdentityFields(boardIdentity);
    if (missingIdentity.length) {
      setIdentityErrors(missingIdentity);
      setError('Please complete your academic rank, primary department, and main institution.');
      return;
    }
    // Address is required only when the reviewer is taking the honorarium.
    if (!honorariumOptOut) {
      const missing = missingAddressFields(address);
      if (missing.length) {
        setAddressErrors(missing);
        setError('Please complete your mailing address to receive the honorarium.');
        return;
      }
    }
    setSubmitting(true);
    try {
      // Send only fields that differ from the server prefill (prevents
      // writing junk when the reviewer didn't touch anything). Trim each
      // value before comparing — a whitespace-only edit (trailing space
      // pasted from email, accidental spacebar in an empty field) shouldn't
      // count as a real change. The trimmed value is what gets written.
      // Only changed visible fields + derived title/affiliation (see helper).
      const contactEdits = buildSubmitContactEdits({ contact, prefill, boardIdentity });
      // Address rides along only when taking the honorarium; opting out means
      // no payment, so we collect and send nothing. Send only the non-empty,
      // trimmed fields (required-field completeness was checked above).
      let addressPayload;
      if (!honorariumOptOut) {
        const trimmedAddress = buildAddressPayload(address);
        if (Object.keys(trimmedAddress).length) addressPayload = trimmedAddress;
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
          address: addressPayload,
          // S308 board-writeup identity — always sent (required, validated above),
          // trimmed. Person-scoped, so it rides outside contactEdits (which is
          // engagement-scoped + allowlisted server-side).
          boardIdentity: {
            academicRank: boardIdentity.academicRank.trim(),
            primaryDepartment: boardIdentity.primaryDepartment.trim(),
            mainInstitution: boardIdentity.mainInstitution.trim(),
          },
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
        } else if (json.reason === 'payment_contact_required') {
          // Server rejected an incomplete payment-contact set (mailing address +
          // phone required this cycle for manual honorarium payment). The client
          // pre-validates so this is a defensive path — flag the named fields
          // inline so the reviewer sees exactly what to complete.
          const fields = Array.isArray(json.fields)
            ? json.fields.filter((f) => ADDRESS_FIELD_KEYS.has(f))
            : [];
          if (fields.length) setAddressErrors(fields);
          setError('Please complete your mailing address and phone number to receive the honorarium.');
        } else if (json.reason === 'board_identity_required') {
          // Server rejected a missing board-identity field (defensive — the client
          // pre-validates). Flag the named fields inline.
          const fields = Array.isArray(json.fields)
            ? json.fields.filter((f) => BOARD_IDENTITY_FIELD_KEYS.has(f))
            : [];
          if (fields.length) setIdentityErrors(fields);
          setError('Please complete your academic rank, primary department, and main institution.');
        } else if (resp.status === 400 && VALIDATION_REASON_COPY[json.reason]) {
          // Surface the specific server validation reason and, when it points at
          // a named address field, flag that field inline.
          if (json.field && ADDRESS_FIELD_KEYS.has(json.field)) {
            setAddressErrors([json.field]);
          }
          setError(VALIDATION_REASON_COPY[json.reason]);
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
    <div className="space-y-6 pb-28">
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
        onUpdate={updateField}
        disabled={submitting}
      />

      <BoardIdentityCard
        identity={boardIdentity}
        errors={identityErrors}
        onUpdate={updateIdentityField}
        disabled={submitting}
      />

      <HonorariumCard
        value={honorariumOptOut}
        onChange={setHonorariumOptOut}
        disabled={submitting}
      />

      {!honorariumOptOut && (
        <AddressCard
          address={address}
          errors={addressErrors}
          onUpdate={updateAddressField}
          disabled={submitting}
          prefilled={!!(prefill.address && prefill.address.line1)}
        />
      )}

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

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-gray-50/95 px-4 py-3 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
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
      {proposal.applicantInstitution && (
        <p className="text-sm text-gray-600 mt-1">{proposal.applicantInstitution}</p>
      )}
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

function ContactConfirmCard({ contact, onUpdate, disabled }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6">
      <h3 className="text-base font-semibold text-gray-900">Confirm your contact info</h3>
      <p className="text-sm text-gray-600 mt-1">
        We pre-filled what we have on file. Please correct anything that's out of date.
      </p>
      <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="First name" value={contact.firstName} onChange={(v) => onUpdate('firstName', v)} disabled={disabled} />
        <Field label="Last name" value={contact.lastName} onChange={(v) => onUpdate('lastName', v)} disabled={disabled} />
        <Field label="Email" value={contact.email} onChange={(v) => onUpdate('email', v)} type="email" disabled={disabled} />
        <Field label="ORCID" value={contact.orcid} onChange={(v) => onUpdate('orcid', v)} placeholder="0000-0000-0000-0000" disabled={disabled} />
      </div>
    </div>
  );
}

function BoardIdentityCard({ identity, errors, onUpdate, disabled }) {
  const fieldErr = (k) => errors.includes(k);
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6">
      <h3 className="text-base font-semibold text-gray-900">Your academic identity</h3>
      <p className="text-sm text-gray-600 mt-1">
        We include this in the review materials prepared for our board. All three are required.
      </p>
      <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field
          label="Academic rank"
          value={identity.academicRank}
          onChange={(v) => onUpdate('academicRank', v)}
          placeholder="e.g., Professor, Associate Professor, Investigator, Group Leader"
          disabled={disabled}
          required
          name="academicRank"
          error={fieldErr('academicRank')}
          errorMessage="Please enter your academic rank."
          fullWidth
        />
        <Field
          label="Primary department"
          value={identity.primaryDepartment}
          onChange={(v) => onUpdate('primaryDepartment', v)}
          placeholder="e.g., Department of Chemistry"
          disabled={disabled}
          required
          name="primaryDepartment"
          error={fieldErr('primaryDepartment')}
          errorMessage="Please enter your primary department."
          hint="If you're affiliated with more than one, give your primary department."
        />
        <Field
          label="Main institution"
          value={identity.mainInstitution}
          onChange={(v) => onUpdate('mainInstitution', v)}
          placeholder="e.g., Stanford University"
          disabled={disabled}
          required
          name="mainInstitution"
          error={fieldErr('mainInstitution')}
          errorMessage="Please enter your main institution."
          hint="Your main institution — the parent organization, not a center or institute within it."
        />
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', placeholder, disabled, fullWidth, hint, required, error, name, errorMessage }) {
  const errorId = error && name ? `${name}-error` : undefined;
  return (
    <label className={`block text-sm ${fullWidth ? 'sm:col-span-2' : ''}`}>
      <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
        {label}
        {required && <span className="text-red-600 ml-0.5" aria-hidden="true">*</span>}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        aria-invalid={error || undefined}
        aria-describedby={errorId}
        className={`mt-1 block w-full rounded-lg border px-3 py-2 text-sm text-gray-900 focus:ring-0 disabled:bg-gray-50 ${
          error ? 'border-red-400 focus:border-red-500' : 'border-gray-300 focus:border-gray-900'
        }`}
      />
      {errorId && (
        <span id={errorId} className="block text-xs text-red-600 mt-1">{errorMessage}</span>
      )}
      {hint && <span className="block text-xs text-gray-500 mt-1">{hint}</span>}
    </label>
  );
}

function AddressCard({ address, errors, onUpdate, disabled, prefilled }) {
  const hasError = (k) => errors.includes(k);
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6">
      <h3 className="text-base font-semibold text-gray-900">Honorarium payment address</h3>
      <p className="text-sm text-gray-600 mt-1">
        {prefilled
          ? "We pre-filled the mailing address we have on file. Please correct anything that's out of date — we'll use it to issue your honorarium."
          : "Where should we mail correspondence for your honorarium? We'll use this to set up your payment."}
      </p>
      <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field
          name="line1" label="Street address" value={address.line1} onChange={(v) => onUpdate('line1', v)}
          disabled={disabled} fullWidth required error={hasError('line1')}
          errorMessage="Street address is required."
        />
        <Field
          name="line2" label="Apt, suite, etc. (optional)" value={address.line2} onChange={(v) => onUpdate('line2', v)}
          disabled={disabled} fullWidth
        />
        <Field
          name="city" label="City" value={address.city} onChange={(v) => onUpdate('city', v)}
          disabled={disabled} required error={hasError('city')}
          errorMessage="City is required."
        />
        <Field
          name="state" label="State / Province (optional)" value={address.state} onChange={(v) => onUpdate('state', v)}
          disabled={disabled}
        />
        <Field
          name="postalCode" label="Postal code" value={address.postalCode} onChange={(v) => onUpdate('postalCode', v)}
          disabled={disabled} required error={hasError('postalCode')}
          errorMessage="Postal code is required."
        />
        <CountrySelect
          value={address.country} onChange={(v) => onUpdate('country', v)}
          disabled={disabled} error={hasError('country')}
        />
        <Field
          name="phone" label="Phone number" value={address.phone} onChange={(v) => onUpdate('phone', v)}
          type="tel" placeholder="e.g., +1 555 123 4567"
          disabled={disabled} required error={hasError('phone')}
          errorMessage="Phone number is required."
        />
      </div>
    </div>
  );
}

function CountrySelect({ value, onChange, disabled, error }) {
  const errorId = error ? 'country-error' : undefined;
  return (
    <label className="block text-sm">
      <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
        Country
        <span className="text-red-600 ml-0.5" aria-hidden="true">*</span>
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        required
        aria-invalid={error || undefined}
        aria-describedby={errorId}
        className={`mt-1 block w-full rounded-lg border px-3 py-2 text-sm text-gray-900 bg-white focus:ring-0 disabled:bg-gray-50 ${
          error ? 'border-red-400 focus:border-red-500' : 'border-gray-300 focus:border-gray-900'
        }`}
      >
        <option value="">Select a country…</option>
        {COUNTRIES.map((c) => (
          <option key={c.code} value={c.code}>{c.name}</option>
        ))}
      </select>
      {errorId && (
        <span id={errorId} className="block text-xs text-red-600 mt-1">Please select a country.</span>
      )}
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
