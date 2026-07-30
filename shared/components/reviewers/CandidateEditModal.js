/**
 * CandidateEditModal — edit a saved candidate's person/researcher details.
 *
 * Click a candidate's name on the Candidates tab to open this; corrects the
 * name, affiliation, email, and website. The common case is fixing an
 * email that resolved to an assistant/department address rather than the
 * reviewer themselves (so the invitation reaches the right inbox).
 *
 * PATCHes /api/reviewer-finder/my-candidates with { suggestionId, ...changed }.
 * Only changed fields are sent. These edits hit the shared person record
 * (wmkf_potentialreviewer — which since the S213 collapse carries the
 * bibliometric fields directly; the wmkf_appresearcher sidecar was dropped),
 * so they apply to EVERY proposal that references this researcher — not just
 * this request. The footer says so. Ported from the standalone Reviewer Finder.
 *
 * Props:
 *   - candidate : { suggestionId, name, affiliation, email, website, hIndex }
 *   - onClose()
 *   - onSaved()  — called after a successful PATCH so the parent can refresh
 *   - onApply(updates)  — LOCAL mode (the Find/Workbench card, which isn't saved
 *       yet): when provided, Save hands the changed fields to the parent to apply
 *       to client state instead of PATCHing my-candidates. The parent stamps
 *       manual provenance (email/website → emailSource/websiteSource 'manual',
 *       which the invite gate reads as quick-check). No suggestionId needed.
 *   - nameEditable (default true) — set false in local mode: the Find card keys
 *       candidates by normalized name, so renaming there would desync selection/
 *       dedup. Name is shown read-only and never included in the emitted updates.
 */

import { useState, useEffect, useRef } from 'react';

// Local value helpers for the merge picker. Mirror the service's norm/isSet
// (reviewer-merge.js) so the UI's email-default and orphan detection agree with
// what the backend will actually write.
const norm = (v) => (v === null || v === undefined ? '' : String(v).trim().toLowerCase());
const isSet = (v) => {
  if (v === null || v === undefined || v === false) return false;
  if (typeof v === 'string') return v.trim() !== '';
  return true;
};

// Human labels for the picker fields (plan.fields[].field).
const FIELD_LABELS = {
  name: 'Name',
  affiliation: 'Affiliation',
  email: 'Email',
  website: 'Website',
  hIndex: 'h-index',
};
const fieldLabel = (f) => FIELD_LABELS[f] || f;
const showValue = (v) => (isSet(v) ? String(v) : '—');

// Main institution mirrors the reviewer accept-form prefill (context.js
// buildStage2aPrefill): fall back to the enrichment affiliation when the
// dedicated wmkf_maininstitution column is empty, so staff see the same value
// the reviewer will (Affiliation is wmkf_primaryaffiliation ‖ organizationname
// in the DTO). Used as BOTH the prefill and the change-comparison baseline, so
// merely opening + saving never writes the affiliation into the dedicated
// column — only a genuine staff edit persists.
const mainInstitutionFallback = (candidate) =>
  (candidate?.mainInstitution || candidate?.affiliation || '');

// Orientation-aware default for the merge field picker (S289 chunk-4 §Field-picker).
// All fields default to 'keeper'; the EMAIL field defaults to whichever side
// currently OWNS the conflict-target value (the address the staffer was setting),
// recomputed on every (re)plan incl. after Swap — so the merge realizes the
// original edit and never transplants the edited row's old email onto an
// email-owner keeper.
function defaultFieldChoices(plan, conflictValue) {
  const choices = {};
  for (const f of (plan?.fields || [])) {
    if (f.field === 'email' && conflictValue && norm(f.loser) === norm(conflictValue) && f.differs) {
      choices.email = 'loser';
    } else {
      choices[f.field] = 'keeper';
    }
  }
  return choices;
}

export default function CandidateEditModal({ candidate, onClose, onSaved, onApply, onConfirm, confirmMode = false, nameEditable = true }) {
  const [formData, setFormData] = useState({ name: '', affiliation: '', email: '', website: '', academicRank: '', primaryDepartment: '', mainInstitution: '' });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);
  // confirmMode only: the PD must tick "I've verified this is the correct person"
  // before the candidate can be added (the deliberate identity-gate override).
  const [identityConfirmed, setIdentityConfirmed] = useState(false);

  // Merge mode (S289 chunk-4). Set when a saved-candidate email edit hits a 409
  // duplicate-key conflict and we have the data to offer a record merge. Shape:
  //   { keeperId, loserId, conflictValue, plan, fieldChoices, loading, error,
  //     bothBlocked, recovery }
  // recovery: null | { kind:'orphan', address } | { kind:'empty' }
  const [merge, setMerge] = useState(null);

  // Stale-async guard: every async merge handler captures this token at dispatch
  // and bails before any setState if it changed (modal closed / candidate swapped).
  const reqToken = useRef(0);
  const guard = (token) => token === reqToken.current;

  useEffect(() => {
    // Invalidate any in-flight merge async from a previous candidate (R8).
    reqToken.current += 1;
    if (candidate) {
      setFormData({
        name: candidate.name || '',
        affiliation: candidate.affiliation || '',
        email: candidate.email || '',
        website: candidate.website || '',
        academicRank: candidate.academicRank || '',
        primaryDepartment: candidate.primaryDepartment || '',
        mainInstitution: mainInstitutionFallback(candidate),
      });
      setError(null);
      setIdentityConfirmed(false);
      setMerge(null);
    }
    // On unmount / candidate change, invalidate again so a late response can't
    // write state into a closed or repurposed modal.
    return () => { reqToken.current += 1; };
  }, [candidate]);

  if (!candidate) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    setError(null);
    // Capture the token BEFORE the PATCH so a 409 that lands after the candidate
    // changed doesn't open merge mode for the stale candidate (Codex S290 post-impl).
    const submitToken = reqToken.current;

    try {
      // CONFIRM mode: always send email/website/affiliation as the PD-confirmed
      // contact — even an unchanged field is an explicit "use this". The parent
      // must await the authenticated server attestation before stamping local UI.
      if (confirmMode) {
        if (!identityConfirmed) {
          setError('Tick the confirmation box to add this reviewer.');
          return;
        }
        if (!formData.email.trim()) {
          setError('An email is required to add and invite this reviewer.');
          return;
        }
        await onConfirm({
          email: formData.email.trim(),
          website: formData.website.trim(),
          affiliation: formData.affiliation.trim(),
        });
        onClose();
        return;
      }

      // Send only changed fields. Name is omitted entirely when not editable
      // (local mode): the Find card is keyed by normalized name, so a rename
      // there would desync selection/dedup.
      const updates = {};
      if (nameEditable && formData.name !== (candidate.name || '')) updates.name = formData.name;
      if (formData.affiliation !== (candidate.affiliation || '')) updates.affiliation = formData.affiliation;
      if (formData.email !== (candidate.email || '')) updates.email = formData.email;
      if (
        updates.email !== undefined
        && !String(updates.email).trim()
        && candidate.email
      ) {
        updates.emailClear = {
          expectedEmail: candidate.email,
          expectedEmailSource: candidate.emailSource || null,
          expectedEtag: candidate.personEtag || null,
          reason: 'staff_removed_incorrect_address',
        };
      }
      if (formData.website !== (candidate.website || '')) updates.website = formData.website;
      // S308 board-writeup identity (saved-candidate edit only — hidden in local/confirm
      // modes, so these never differ there). Only changed fields are sent.
      if (formData.academicRank !== (candidate.academicRank || '')) updates.academicRank = formData.academicRank;
      if (formData.primaryDepartment !== (candidate.primaryDepartment || '')) updates.primaryDepartment = formData.primaryDepartment;
      if (formData.mainInstitution !== mainInstitutionFallback(candidate)) updates.mainInstitution = formData.mainInstitution;

      if (Object.keys(updates).length === 0) {
        onClose();
        return;
      }

      // LOCAL mode: apply to client state via the parent (no PATCH — the Find-card
      // candidate isn't a saved row yet). The parent stamps manual provenance.
      if (onApply) {
        onApply(updates);
        onClose();
        return;
      }

      const response = await fetch('/api/reviewer-finder/my-candidates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestionId: candidate.suggestionId, ...updates }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        // Duplicate-key 409 on a saved-candidate email edit → offer a record merge
        // (S289 chunk-4). Only in the saved-Candidates path: we need the edited
        // record's person id, and the local Find-card (onApply) / confirm paths
        // return before this PATCH so can never reach here — the guard is belt-and-
        // suspenders. `conflictingRecordId` is the OTHER person row owning the email.
        if (
          response.status === 409 &&
          data.conflictingRecordId &&
          candidate.potentialReviewerId &&
          !onApply &&
          !confirmMode
        ) {
          await enterMergeMode(data, submitToken);
          return;
        }
        // Prefer the human-readable `message` (set for translated errors like
        // duplicate-key 409s); fall back to the machine code or a generic line.
        throw new Error(data.message || data.error || 'Failed to update candidate');
      }

      if (onSaved) await onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  // ───────── Merge mode (S289 chunk-4) ─────────

  // POST {keeperId, loserId} → read-only plan. Used for the initial plan, Swap
  // re-plans, and the post-confirm recovery re-read. Stale-guarded.
  const fetchPlan = async (keeperId, loserId, token) => {
    const res = await fetch('/api/reviewer-finder/merge-candidates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keeperId, loserId }),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data, token };
  };

  // Load (or re-load, e.g. after Swap) the plan into merge state.
  const loadPlan = async (keeperId, loserId, conflictValue) => {
    const token = reqToken.current;
    setMerge((m) => ({ ...(m || {}), keeperId, loserId, conflictValue, loading: true, error: null, recovery: null, bothBlocked: m?.bothBlocked }));
    try {
      const { ok, data } = await fetchPlan(keeperId, loserId, token);
      if (!guard(token)) return;
      if (!ok || !data.plan) {
        setMerge((m) => ({ ...m, loading: false, error: data.error || 'Could not load the merge plan.' }));
        return;
      }
      setMerge((m) => ({
        ...m,
        keeperId,
        loserId,
        conflictValue,
        plan: data.plan,
        fieldChoices: defaultFieldChoices(data.plan, conflictValue),
        loading: false,
        error: null,
      }));
    } catch (err) {
      if (!guard(token)) return;
      setMerge((m) => ({ ...m, loading: false, error: err.message }));
    }
  };

  // Entry point from the 409 handler. keeper defaults to the EDITED record (the row
  // the staffer just curated), loser = the email owner (conflictingRecordId).
  const enterMergeMode = async (data, token) => {
    // Bail if the PATCH 409 landed after the candidate changed (stale-async).
    if (token !== undefined && !guard(token)) return;
    const keeperId = candidate.potentialReviewerId;
    const loserId = data.conflictingRecordId;
    const conflictValue = data.value || null;
    // Carry the route's partial-save report (the conflict-safe fields the server
    // already committed) into merge state so MergeMode can reassure the staffer and
    // so a cancel refreshes the list to show them (R: don't leave a stale card).
    setMerge({
      keeperId, loserId, conflictValue, plan: null, fieldChoices: {}, loading: true,
      error: null, recovery: null, bothBlocked: false,
      partialSuccess: !!data.partialSuccess,
      savedFields: Array.isArray(data.savedFields) ? data.savedFields : [],
    });
    await loadPlan(keeperId, loserId, conflictValue);
  };

  // Swap which record is kept and re-plan (re-derives the orientation-aware email
  // default). Tracks whether BOTH orientations are blocked so the UI can stop
  // implying Swap will help.
  const swapKeeper = async () => {
    const token = reqToken.current;
    const wasBlocked = !!merge?.plan?.blocked;
    await loadPlan(merge.loserId, merge.keeperId, merge.conflictValue);
    if (!guard(token)) return;
    setMerge((m) => (m ? { ...m, bothBlocked: wasBlocked ? !!m.plan?.blocked : false } : m));
  };

  const setFieldChoice = (field, pick) => {
    setMerge((m) => (m ? { ...m, fieldChoices: { ...m.fieldChoices, [field]: pick } } : m));
  };

  // After a confirm, re-plan to detect the FINAL-2 email tear by its true signature.
  // after500=true  → the conflict-target address is owned by NEITHER side ⇒ the
  //                  clear-loser/set-keeper move tore: {kind:'orphan', address}.
  //                  Still owned ⇒ null (transient, safe to retry). If the re-plan
  //                  ITSELF failed we can't confirm the email is safe, so return
  //                  {kind:'unknown'} — NOT null — to block a silent retry that
  //                  could deactivate the loser and orphan the address
  //                  (Codex S290 post-impl Q1).
  // after500=false → benign post-success check: surviving keeper has no email ⇒
  //                  {kind:'empty'}. A re-plan failure here is harmless (the merge
  //                  already succeeded) ⇒ null.
  const detectRecovery = async (keeperId, loserId, conflictValue, token, after500) => {
    let plan = null;
    try {
      const { ok, data } = await fetchPlan(keeperId, loserId, token);
      if (!guard(token)) return null;
      if (ok && data.plan) plan = data.plan;
    } catch {
      plan = null;
    }
    if (!guard(token)) return null;
    if (after500) {
      if (!conflictValue) return plan ? null : { kind: 'unknown' };
      if (!plan) return { kind: 'unknown' };
      const stillOwned = norm(plan.keeper.email) === norm(conflictValue) || norm(plan.loser.email) === norm(conflictValue);
      return stillOwned ? null : { kind: 'orphan', address: conflictValue };
    }
    if (!plan) return null;
    return isSet(plan.keeper.email) ? null : { kind: 'empty' };
  };

  const confirmMerge = async () => {
    const token = reqToken.current;
    const { keeperId, loserId, conflictValue, fieldChoices } = merge;
    setMerge((m) => ({ ...m, loading: true, error: null }));
    try {
      const res = await fetch('/api/reviewer-finder/merge-candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keeperId, loserId, fieldChoices, confirm: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!guard(token)) return;

      if (res.ok) {
        const recovery = await detectRecovery(keeperId, loserId, conflictValue, token, false);
        if (!guard(token)) return;
        if (recovery) {
          setMerge((m) => ({ ...m, loading: false, recovery }));
          return;
        }
        if (onSaved) await onSaved();
        onClose();
        return;
      }

      if (res.status === 409) {
        if (data.code === 'merge_retryable_replan') {
          await loadPlan(keeperId, loserId, conflictValue);
          if (!guard(token)) return;
          setMerge((m) => ({
            ...m,
            loading: false,
            error: 'The records changed while merging. Review the updated plan and try again.',
            recovery: null,
          }));
          return;
        }
        // Became blocked between plan and confirm — re-plan to show accurate reasons.
        await loadPlan(keeperId, loserId, conflictValue);
        return;
      }
      if (res.status === 400) {
        // Validation (e.g. loser already inactive / already merged): not retryable.
        setMerge((m) => ({ ...m, loading: false, error: data.error || 'This merge is no longer valid. Refresh the list and try again.', staleValidation: true }));
        return;
      }
      // 500 — may be the email tear. Detect the orphan signature.
      const recovery = await detectRecovery(keeperId, loserId, conflictValue, token, true);
      if (!guard(token)) return;
      if (recovery) {
        setMerge((m) => ({ ...m, loading: false, recovery }));
        return;
      }
      setMerge((m) => ({ ...m, loading: false, error: `${data.error ? `${data.error}. ` : ''}The merge didn’t complete — you can try again.` }));
    } catch (err) {
      if (!guard(token)) return;
      setMerge((m) => ({ ...m, loading: false, error: err.message }));
    }
  };

  // Always refresh the list before closing out of a recovery/stale state so a
  // partial tear can't leave a stale candidate row visible (Codex S290 post-impl Q4).
  const refreshAndClose = async () => {
    if (onSaved) await onSaved();
    onClose();
  };

  if (merge) {
    return (
      <MergeMode
        merge={merge}
        onSwap={swapKeeper}
        onSetField={setFieldChoice}
        onConfirm={confirmMerge}
        // After a partial-success 409 the server already saved the non-email fields,
        // so any cancel/close must refresh the list (not just clear edit state) or
        // the card shows stale values (Codex review: cancel-from-partial-merge).
        onCancel={merge.partialSuccess ? refreshAndClose : onClose}
        onRefreshClose={refreshAndClose}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="font-semibold text-gray-900">{confirmMode ? 'Confirm reviewer & correct contact' : 'Edit candidate'}</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className={`w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 ${nameEditable ? '' : 'bg-gray-100 text-gray-500 cursor-not-allowed'}`}
              required
              readOnly={!nameEditable}
              title={nameEditable ? undefined : 'Name is locked here — rename from the saved Candidates tab if needed'}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Affiliation</label>
            <input
              type="text"
              value={formData.affiliation}
              onChange={(e) => setFormData({ ...formData, affiliation: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              placeholder="researcher@university.edu"
            />
            <p className="text-xs text-gray-400 mt-1">Correct this if the listed address belongs to an assistant or department.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Website</label>
            <input
              type="url"
              value={formData.website}
              onChange={(e) => setFormData({ ...formData, website: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              placeholder="https://..."
            />
          </div>

          {/* Board-writeup identity (S308) — only on the saved-candidate edit (not
              the pre-save Find card / confirm flow). These are the reviewer-confirmed
              values captured at accept; staff can correct them here. */}
          {!confirmMode && !onApply && (
            <div className="space-y-4 rounded-md bg-gray-50 border border-gray-200 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Board-writeup identity</p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Academic rank</label>
                <input
                  type="text"
                  value={formData.academicRank}
                  onChange={(e) => setFormData({ ...formData, academicRank: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  placeholder="e.g., Professor, Investigator, Group Leader"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Primary department</label>
                <input
                  type="text"
                  value={formData.primaryDepartment}
                  onChange={(e) => setFormData({ ...formData, primaryDepartment: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  placeholder="e.g., Department of Chemistry"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Main institution</label>
                <input
                  type="text"
                  value={formData.mainInstitution}
                  onChange={(e) => setFormData({ ...formData, mainInstitution: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  placeholder="e.g., Stanford University"
                />
              </div>
            </div>
          )}

          {confirmMode && (
            <label className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 p-3">
              <input
                type="checkbox"
                checked={identityConfirmed}
                onChange={(e) => setIdentityConfirmed(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600"
              />
              <span className="text-xs text-amber-800">
                I’ve verified this is the correct person. Add them using the contact above — the
                auto-suggested ORCID / metrics won’t be carried over, and the email is marked
                unverified and requires a quick check before any invitation is sent.
              </span>
            </label>
          )}

          {!confirmMode && (
            <p className="text-xs text-gray-500">
              {onApply
                ? 'A manually entered email/website is marked unverified — a quick check is required before any invitation is sent. Saved with this request when you save the candidate.'
                : 'Changes apply to this researcher across all proposals that reference them.'}
            </p>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200">
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving || (confirmMode && !identityConfirmed)}
              className="px-4 py-2 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {confirmMode ? 'Add to candidates' : (isSaving ? 'Saving…' : 'Save changes')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ───────── Merge mode view (S289 chunk-4) ─────────
// Presentational: all state + handlers live in CandidateEditModal. Renders the
// merge plan (keeper/loser + field picker), the blocked explainer, and the
// half-done-email recovery prompt.

// Module-level (not redefined per render) so React keeps a stable identity.
function MergeShell({ onCancel, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50" onClick={onCancel}>
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="font-semibold text-gray-900">Merge duplicate reviewer records</h3>
          <button type="button" onClick={onCancel} className="text-gray-400 hover:text-gray-600" aria-label="Close">✕</button>
        </div>
        <div className="p-4 space-y-4">{children}</div>
      </div>
    </div>
  );
}

function MergeRecordLine({ label, rec, tone }) {
  return (
    <div className={`rounded-md border p-2 ${tone}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="text-sm font-medium text-gray-900 truncate">{showValue(rec.name)}</p>
      <p className="text-xs text-gray-600 truncate">{showValue(rec.email)}</p>
      {norm(rec.identityStatus) === 'confirmed' && (
        <span className="inline-flex items-center mt-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-emerald-100 text-emerald-700">verified identity</span>
      )}
    </div>
  );
}

function MergeMode({ merge, onSwap, onSetField, onConfirm, onCancel, onRefreshClose }) {
  const { plan, fieldChoices, loading, error, recovery, bothBlocked, staleValidation, partialSuccess, savedFields = [] } = merge;

  // ── Half-done email recovery (FINAL-2 / Option B) ──
  // Dismissing via the overlay/X routes through onRefreshClose (not onCancel) so a
  // partial tear always refreshes the list on the way out (Codex S290 post-impl Q4).
  if (recovery) {
    return (
      <MergeShell onCancel={onRefreshClose}>
        <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900 space-y-2">
          {recovery.kind === 'orphan' ? (
            <>
              <p className="font-medium">This email address needs to be re-entered:</p>
              <p className="font-mono text-amber-800">{recovery.address}</p>
              <p>
                It was removed during a failed merge and is no longer saved on either record. Open this
                reviewer from the Candidates list and re-enter their email. The other duplicate record was
                not removed.
              </p>
            </>
          ) : recovery.kind === 'unknown' ? (
            <p>
              The merge didn’t complete and the record state couldn’t be verified. Don’t retry from here —
              reopen this reviewer from the Candidates list and check their email is still set before trying
              again.
            </p>
          ) : (
            <p>
              The merge completed, but the surviving record has no email. Open it from the Candidates list to
              add one before inviting.
            </p>
          )}
        </div>
        <div className="flex justify-end">
          <button type="button" onClick={onRefreshClose} className="px-4 py-2 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700">
            Refresh and close
          </button>
        </div>
      </MergeShell>
    );
  }

  // ── Loading the initial plan ──
  if (!plan) {
    return (
      <MergeShell onCancel={onCancel}>
        {error ? (
          <>
            <p className="text-sm text-red-600">{error}</p>
            <div className="flex justify-end">
              <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200">Close</button>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-3 text-sm text-gray-600">
            <div className="w-5 h-5 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" />
            Loading merge plan…
          </div>
        )}
      </MergeShell>
    );
  }

  const { keeper, loser } = plan;

  return (
    <MergeShell onCancel={onCancel}>
      <p className="text-sm text-gray-600">
        Two reviewer records appear to be the same person. Choose which one to keep; the other is removed and
        its proposals are re-linked to the kept record.
      </p>

      {partialSuccess && savedFields.length > 0 && (
        <div className="rounded-md bg-emerald-50 border border-emerald-200 p-2 text-xs text-emerald-800">
          Saved: {savedFields.map(fieldLabel).join(', ')}. Only the email still needs resolving — your other
          edits are already on this record.
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <MergeRecordLine label="Kept" rec={keeper} tone="border-blue-200 bg-blue-50" />
        <MergeRecordLine label="Removed" rec={loser} tone="border-gray-200 bg-gray-50" />
      </div>
      <div>
        <button
          type="button"
          onClick={onSwap}
          disabled={loading}
          className="text-sm text-blue-600 underline hover:text-blue-800 disabled:opacity-50"
        >
          Swap — keep {showValue(loser.name)} instead
        </button>
      </div>

      {plan.blocked ? (
        <div className="rounded-md bg-red-50 border border-red-200 p-3 space-y-2">
          <p className="text-sm font-medium text-red-800">This merge can’t proceed as set up:</p>
          <ul className="list-disc list-inside text-sm text-red-700 space-y-1">
            {(plan.reasons || []).map((r, i) => <li key={r.code || i}>{r.detail}</li>)}
          </ul>
          {bothBlocked && (
            <p className="text-xs text-red-700">
              Neither record can be discarded automatically. These duplicates need to be resolved in CRM
              (e.g. by Connor) rather than here.
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-700">For each detail, choose the value the kept record should have:</p>
            {plan.fields.map((f) => (
              <div key={f.field} className="text-sm">
                <p className="text-xs font-medium text-gray-600">{fieldLabel(f.field)}</p>
                {f.differs ? (
                  <div className="flex flex-col gap-1 mt-0.5">
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name={`merge-${f.field}`}
                        checked={(fieldChoices[f.field] || 'keeper') === 'keeper'}
                        onChange={() => onSetField(f.field, 'keeper')}
                      />
                      <span className="text-gray-900">{showValue(f.keeper)} <span className="text-xs text-gray-400">(kept record)</span></span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name={`merge-${f.field}`}
                        checked={fieldChoices[f.field] === 'loser'}
                        onChange={() => onSetField(f.field, 'loser')}
                      />
                      <span className="text-gray-900">{showValue(f.loser)} <span className="text-xs text-gray-400">(removed record)</span></span>
                    </label>
                  </div>
                ) : (
                  <p className="text-gray-700">{showValue(f.keeper)} <span className="text-xs text-gray-400">(same on both)</span></p>
                )}
              </div>
            ))}
          </div>

          <p className="text-xs text-gray-500">
            {plan.repointCount} proposal{plan.repointCount === 1 ? '' : 's'} re-linked
            {plan.collisionCount > 0 && `, ${plan.collisionCount} duplicate entr${plan.collisionCount === 1 ? 'y' : 'ies'} removed`}
            . The removed record is deactivated.
          </p>
        </>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex justify-end gap-2 pt-1">
        {staleValidation ? (
          <button type="button" onClick={onRefreshClose} className="px-4 py-2 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700">
            Refresh and close
          </button>
        ) : (
          <>
            <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200">
              Cancel
            </button>
            {!plan.blocked && (
              <button
                type="button"
                onClick={onConfirm}
                disabled={loading}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? 'Merging…' : 'Merge records'}
              </button>
            )}
          </>
        )}
      </div>
    </MergeShell>
  );
}
