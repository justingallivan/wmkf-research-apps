/**
 * ReviewerFindPanel — the Find sub-tab inside the Request Workbench Reviewers tab
 * (tier-3), Phase 3.
 *
 * This is the applicant-reviewer ingestion surface. On open it:
 *   1. Runs `/api/workbench/applicant-reviewers` (idempotent) to materialize the
 *      request's legacy `wmkf_potentialreviewer1..5` slots into
 *      `disposition=recommended` candidate rows and to parse the free-text
 *      `wmkf_excludedreviewers` into clean names.
 *   2. Auto-loads the request's exact canonical reviewer proposal via
 *      `/api/reviewer-finder/load-proposal`, or replays a deliberate dropdown
 *      override from validated `?proposalFile=` navigation state (no PDF-upload
 *      entry in the Workbench and no filename-heuristic fallback).
 *   3. Surfaces the applicant RECOMMENDED set (badged, now candidates), the
 *      applicant EXCLUDED set (per-request soft-block, badged), and the loaded
 *      proposal — and pre-computes the exclude list staff carry into a search.
 *
 * Per the S210 option-B decision, exclusions are soft-block-only: no structured
 * `disposition=excluded` rows are written, and nothing global is touched, so an
 * exclusion here never affects the person's eligibility on any other request
 * (`[[project-excluded-reviewers-often-in-pool]]`).
 *
 * The candidate search runs IN-PANEL via `ReviewerSearchSection` (S210): it
 * reuses the proposal loaded here + the applicant exclude list and chains the
 * reviewer-finder endpoints (analyze → discover → enrich → save), so saved
 * candidates land in this request's pool alongside the applicant recommendations.
 * (PDF upload is not used — the proposal is auto-loaded; summary-page
 * extraction was removed from analyze 2026-09-06.)
 *
 * Props:
 *   - requestId      : the akoya_request GUID (always present)
 *   - savedPool      : the request's saved candidate rows (from ReviewersTab's
 *                      my-candidates fetch). Names union into the search exclude
 *                      set so a re-search doesn't re-surface them; engagement
 *                      fields (invited/accepted/declined/…) let the search
 *                      section collapse re-discovered already-engaged people
 *                      instead of rendering them as invitable cards.
 *   - proposalFileKey / onProposalFileKeyChange : reload-stable navigation
 *                      binding for a server-validated manual SharePoint choice.
 *   (context / canManage are passed by ReviewersTab but not needed here — the
 *   panel is request-scoped by requestId and all ingestion APIs stay org-open.)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Card } from '../Layout';
import ReviewerSearchSection from './ReviewerSearchSection';

function Spinner() {
  return <div className="w-5 h-5 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" />;
}

// Composite key the load-proposal endpoint uses to address a specific file.
function fileKeyOf(f) {
  return `${f.library}::${f.folder}::${f.name}`;
}

export default function ReviewerFindPanel({
  requestId,
  savedPool = [],
  onSaved,
  onNavigate,
  canManage = true,
  prefill = null,
  onPrefillConsumed,
  proposalFileKey = null,
  proposalBindingReady = true,
  onProposalFileKeyChange,
  repairCandidateKey = null,
}) {
  const requestIdRef = useRef(requestId);
  requestIdRef.current = requestId;
  const proposalLoadGenerationRef = useRef(0);
  const lastProposalLoadRef = useRef({ requestId: null, fileKey: undefined });
  const manualCardRef = useRef(null);
  const [ingest, setIngest] = useState({ loading: true, data: null, error: null });
  const [doc, setDoc] = useState({ loading: true, data: null, error: null });
  const [manual, setManual] = useState({
    name: '',
    email: '',
    affiliation: '',
    orcid: '',
    note: '',
    referredBy: '', // S249: who suggested this candidate → tags provenance `referred`
    saving: false,
    error: null,
    added: null,
    remedy: null,
    lookingUp: false,
    lookupMsg: null, // { tone: 'ok' | 'warn', text }
    orcidAutofilled: false, // true iff the orcid field was set by a lookup (not typed)
    lookupResult: null,
    resolution: null,
  });

  // Pre-fill the Add-or-Refer form from a decline referral (parent switches to
  // this sub-tab and passes { name, referredBy }). The suggested text lands in
  // `name` for staff to review/clean before Add — identity resolution still
  // goes through the normal abstain-or-confirm flow, so a free-text suggestion
  // never auto-resolves to a namesake. Consumed once, then cleared.
  useEffect(() => {
    if (!prefill) return;
    // Start from a CLEAN identity slate — carry only name/referredBy from the
    // referral. Leaving a stale email/affiliation would let the add path's
    // confident-lookup auto-resolve reuse the wrong person by email (identity
    // hazard, project-reviewer-verify-fail-dangerous). Clear every identity
    // anchor, not just orcid.
    setManual((prev) => ({
      ...prev,
      name: prefill.name || '',
      referredBy: prefill.referredBy || '',
      note: prefill.note || '',
      email: '',
      affiliation: '',
      error: null,
      added: null,
      lookupResult: null,
      resolution: null,
      orcid: '',
      orcidAutofilled: false,
      lookingUp: false,
      lookupMsg: { tone: 'ok', text: 'Pre-filled from a decline referral — review the name, then Add.' },
    }));
    if (manualCardRef.current) {
      manualCardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    onPrefillConsumed?.();
  }, [prefill, onPrefillConsumed]);

  const runIngestion = useCallback(async () => {
    if (!requestId) return;
    const submittedRequestId = requestId;
    setIngest({ loading: true, data: null, error: null });
    try {
      const res = await fetch(`/api/workbench/applicant-reviewers?requestId=${encodeURIComponent(submittedRequestId)}`);
      if (requestIdRef.current !== submittedRequestId) return;
      const data = await res.json().catch(() => ({}));
      if (requestIdRef.current !== submittedRequestId) return;
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Ingestion failed (${res.status})`);
      }
      setIngest({ loading: false, data, error: null });
    } catch (e) {
      if (requestIdRef.current !== submittedRequestId) return;
      setIngest({ loading: false, data: null, error: e.message });
    }
  }, [requestId]);

  // fileKey is an optional "library::folder::filename" override for deliberate
  // historical/ad-hoc analysis. A validated override is stored by the parent in
  // reload-stable URL state, but the server re-lists this request's files and
  // validates the opaque key on every load. When omitted, the endpoint accepts
  // only the request's exact canonical Reviewer Materials proposal.
  const loadProposal = useCallback(async (fileKey, { persist = false } = {}) => {
    if (!requestId) return;
    const submittedRequestId = requestId;
    const requestedFileKey = fileKey || null;
    const myGeneration = ++proposalLoadGenerationRef.current;
    lastProposalLoadRef.current = { requestId: submittedRequestId, fileKey: requestedFileKey };
    setDoc({ loading: true, data: null, error: null, requestedFileKey });
    try {
      const res = await fetch('/api/reviewer-finder/load-proposal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestedFileKey
          ? { requestId: submittedRequestId, fileKey: requestedFileKey }
          : { requestId: submittedRequestId }),
      });
      const data = await res.json().catch(() => ({}));
      if (
        requestIdRef.current !== submittedRequestId
        || proposalLoadGenerationRef.current !== myGeneration
      ) return;
      if (!res.ok || !data.success) {
        // Carry allFiles through on a 404 so staff can make a deliberate
        // historical/ad-hoc override when the canonical file is absent.
        const err = new Error(data.error || `Could not load the proposal document (${res.status})`);
        err.allFiles = data.allFiles || null;
        throw err;
      }
      setDoc({ loading: false, data, error: null, requestedFileKey });
      if (persist && data.picked) onProposalFileKeyChange?.(data.picked);
    } catch (e) {
      if (
        requestIdRef.current !== submittedRequestId
        || proposalLoadGenerationRef.current !== myGeneration
      ) return;
      setDoc({
        loading: false,
        data: null,
        error: e.message,
        allFiles: e.allFiles || null,
        requestedFileKey,
      });
    }
  }, [requestId, onProposalFileKeyChange]);

  useEffect(() => { runIngestion(); }, [runIngestion]);
  useEffect(() => {
    if (!proposalBindingReady) return;
    const desiredFileKey = proposalFileKey || null;
    const previous = lastProposalLoadRef.current;
    if (previous.requestId === requestId && previous.fileKey === desiredFileKey) return;
    loadProposal(desiredFileKey);
  }, [requestId, proposalFileKey, proposalBindingReady, loadProposal]);

  const updateManual = (field, value) => {
    setManual((prev) => {
      const next = { ...prev, [field]: value, error: null, added: null, lookupMsg: null };
      if (field === 'orcid') {
        // The PD typed the ORCID directly — it's no longer a lookup result.
        next.orcidAutofilled = false;
      } else if ((field === 'name' || field === 'email' || field === 'affiliation') && prev.orcidAutofilled) {
        // An identity field changed after a lookup auto-filled the ORCID — that
        // iD may now belong to a different person. Drop it so a stale ORCID can't
        // be saved against the wrong human (Codex F3). A PD-typed ORCID is left
        // intact (orcidAutofilled is false in that case).
        next.orcid = '';
        next.orcidAutofilled = false;
      }
      if (field === 'name' || field === 'email' || field === 'affiliation' || field === 'orcid') {
        next.lookupResult = null;
        next.resolution = null;
      }
      return next;
    });
  };

  const freshManual = (over = {}) => ({
    name: '', email: '', affiliation: '', orcid: '', note: '', referredBy: '',
    saving: false, error: null, added: null, lookingUp: false, lookupMsg: null,
    orcidAutofilled: false, lookupResult: null, resolution: null, remedy: null,
    ...over,
  });

  const lookupReviewer = async ({ name, email, affiliation, orcid }) => {
    const res = await fetch('/api/workbench/reviewer-lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        email: email || undefined,
        affiliation: affiliation || undefined,
        orcid: orcid || undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Reviewer lookup failed (${res.status})`);
    return data;
  };

  const resolutionForConfident = (result) => {
    if (result?.outcome !== 'confident') return null;
    if (result.match?.reviewerId) {
      return { mode: 'reuse_reviewer', reviewerId: result.match.reviewerId, contactId: result.match.contactId || undefined };
    }
    if (result.match?.contactId) return { mode: 'reuse_contact', contactId: result.match.contactId };
    return null;
  };

  // ORCID iD lookup: name (+ optional affiliation/email) → ORCID via the
  // fail-safe resolver. Fills the ORCID field on a confident match; abstains
  // (message only, nothing attached) when ambiguous or not found, so a wrong
  // namesake's iD is never silently filled in.
  const lookupOrcid = async () => {
    const submittedName = manual.name.trim();
    const submittedEmail = manual.email.trim().toLowerCase();
    if (!submittedName || manual.lookingUp) return;
    setManual((prev) => ({ ...prev, lookingUp: true, lookupMsg: null }));
    const submittedRequestId = requestId;

    // Apply the lookup result only if the form still matches what we searched
    // for. Staff may edit name/email while this request is in flight; a late
    // result for name A must not land on form B. We always clear the in-flight
    // flag (so the button re-enables) but skip the orcid/message on a stale form.
    const apply = (compute) => setManual((prev) => {
      if (prev.name.trim() !== submittedName) return { ...prev, lookingUp: false };
      return { ...prev, lookingUp: false, ...compute() };
    });

    try {
      const res = await fetch('/api/workbench/orcid-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: submittedName,
          affiliation: manual.affiliation.trim() || undefined,
          email: submittedEmail || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (requestIdRef.current !== submittedRequestId) return;
      if (data.found && data.orcid) {
        // If staff typed an email and the matched ORCID record's public email
        // disagrees, that's a wrong-person signal — do NOT auto-fill. Surface it
        // and let staff verify, then enter the iD by hand if it really is them.
        const emailMismatch = !!(submittedEmail && data.recordEmail && !data.emailMatches);
        if (emailMismatch) {
          apply(() => ({
            lookupMsg: { tone: 'warn', text: `Found ${data.matchedName || submittedName}, but its public ORCID email (${data.recordEmail}) doesn't match the email you entered — not filled. Verify it's the right person, then enter the ORCID iD manually if so.` },
          }));
        } else {
          const where = data.matchedInstitution ? ` · ${data.matchedInstitution}` : '';
          const corro = data.institutionCorroborated ? ' (institution matches)' : '';
          const emailOk = data.emailMatches ? ' · email matches' : '';
          apply(() => ({
            orcid: data.orcid,
            orcidAutofilled: true,
            lookupMsg: { tone: 'ok', text: `Found ${data.matchedName || submittedName}${where}${corro}${emailOk}. Confirm it's the right person before adding.` },
          }));
          try {
            const reviewerLookup = await lookupReviewer({
              name: submittedName,
              email: submittedEmail,
              affiliation: manual.affiliation.trim(),
              orcid: data.orcid,
            });
            if (requestIdRef.current !== submittedRequestId) return;
            apply(() => ({
              lookupResult: reviewerLookup,
              resolution: resolutionForConfident(reviewerLookup),
            }));
          } catch {
            if (requestIdRef.current !== submittedRequestId) return;
            apply(() => ({
              lookupMsg: { tone: 'warn', text: 'ORCID was found, but existing-reviewer lookup failed. Try Add reviewer again.' },
            }));
          }
        }
      } else if (data.ambiguous) {
        apply(() => ({
          lookupMsg: { tone: 'warn', text: `Multiple possible matches${data.candidateCount ? ` (${data.candidateCount})` : ''} — none attached. Add an affiliation to disambiguate, or enter the ORCID iD manually.` },
        }));
      } else {
        apply(() => ({
          lookupMsg: { tone: 'warn', text: data.reason || 'No confident ORCID match found. Enter it manually if you have it.' },
        }));
      }
    } catch {
      if (requestIdRef.current !== submittedRequestId) return;
      apply(() => ({ lookupMsg: { tone: 'warn', text: 'ORCID lookup failed. Try again or enter it manually.' } }));
    }
  };

  const submitManualReviewer = async (resolution) => {
    const name = manual.name.trim();
    const res = await fetch('/api/workbench/manual-reviewer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId,
        name,
        email: manual.email.trim() || undefined,
        affiliation: manual.affiliation.trim() || undefined,
        orcid: manual.orcid.trim() || undefined,
        note: manual.note.trim() || undefined,
        referredBy: manual.referredBy.trim() || undefined,
        resolution: resolution || undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      throw new Error(data.error || `Could not add reviewer (${res.status})`);
    }
    return data;
  };

  const addManualReviewer = async (ev) => {
    ev.preventDefault();
    if (!requestId || manual.saving) return;
    const name = manual.name.trim();
    if (!name) {
      setManual((prev) => ({ ...prev, error: 'Name is required.' }));
      return;
    }
    setManual((prev) => ({ ...prev, saving: true, error: null, added: null }));
    const submittedRequestId = requestId;
    try {
      let resolution = manual.resolution;
      if (!resolution) {
        const lookup = await lookupReviewer({
          name,
          email: manual.email.trim().toLowerCase(),
          affiliation: manual.affiliation.trim(),
          orcid: manual.orcid.trim(),
        });
        if (requestIdRef.current !== submittedRequestId) return;
        if (lookup.outcome === 'confident') {
          resolution = resolutionForConfident(lookup);
          setManual((prev) => ({ ...prev, lookupResult: lookup, resolution }));
        } else if (lookup.outcome === 'none') {
          resolution = { mode: 'create_new' };
        } else {
          // Ambiguous (candidates) or conflict: staff must decide. Surface an
          // explicit instruction — returning without a message here made the
          // Add button look like a silent no-op.
          setManual((prev) => ({
            ...prev,
            saving: false,
            lookupResult: lookup,
            resolution: null,
            error: lookup.outcome === 'candidates'
              ? 'This may be an existing person — select a match below and click “Confirm and Add”, or “Disconfirm” if none of these is the same person.'
              : 'Existing records conflict for this person — choose “Create new person” below if this really is someone else.',
          }));
          return;
        }
      }
      const data = await submitManualReviewer(resolution);
      if (requestIdRef.current !== submittedRequestId) return;
      if (['promotion_required', 'restore_required', 'already_handled'].includes(data.outcome)) {
        setManual(freshManual({
          remedy: {
            outcome: data.outcome,
            message: data.remedy,
            suggestionId: data.suggestionId,
            stage: data.stage,
          },
        }));
        if (onSaved) onSaved();
        return;
      }
      setManual(freshManual({ added: data.candidate || { name } }));
      if (onSaved) onSaved();
    } catch (e) {
      if (requestIdRef.current !== submittedRequestId) return;
      setManual((prev) => ({ ...prev, saving: false, error: e.message }));
    }
  };

  const chooseResolution = (resolution) => {
    setManual((prev) => ({ ...prev, resolution, error: null }));
  };

  const createDespiteLookup = () => {
    setManual((prev) => ({ ...prev, resolution: { mode: 'create_new' }, error: null }));
  };

  // "Disconfirm" on the ambiguous-candidates card: staff assert none of the
  // matches is this person. Closes the card AND records create_new — without
  // the resolution, the next submit would re-run the lookup and re-open the
  // same card in a loop.
  const disconfirmLookup = () => {
    setManual((prev) => ({ ...prev, lookupResult: null, resolution: { mode: 'create_new' }, error: null }));
  };

  const renderContext = (context) => {
    const bits = [context?.email, context?.affiliation, context?.hasOrcid ? 'ORCID' : null].filter(Boolean);
    return bits.join(' · ');
  };

  const lookupDecision = manual.lookupResult;

  const data = ingest.data;
  const recommended = data?.recommended || [];
  const recommendedFailed = data?.recommendedFailed || [];
  const knownLookupFailed = data?.knownLookupFailed || [];
  // How many slots the applicant actually populated. `null` when the field is
  // absent (older response / fetch error). Lets us tell a genuine "applicant
  // listed none" from "ingestion failed so the list looks empty."
  const slotsPopulated = typeof data?.slotsPopulated === 'number' ? data.slotsPopulated : null;
  const excludedRaw = data?.excludedRaw || null;
  const excludedParseFailed = data?.excludedParseFailed || false;

  // File list for the deliberate historical/ad-hoc override picker — present
  // on a successful load and, via the carried error, when the canonical file
  // is absent. Proposal-classified files sort first.
  const rawFiles = doc.data?.allFiles || doc.allFiles || [];
  const availableFiles = [...rawFiles].sort((a, b) => {
    const ap = a.classification === 'proposal' ? 0 : 1;
    const bp = b.classification === 'proposal' ? 0 : 1;
    return ap - bp || String(a.name).localeCompare(String(b.name));
  });
  const pickedKey = doc.data?.picked || null;

  // Manual reviewer add — rendered (by ReviewerSearchSection) BELOW the search and
  // ABOVE the optional verify card. State lives here; the JSX is passed down as a
  // slot so it sits between those two without ReviewerSearchSection owning the form.
  const manualAddCard = (
    <div ref={manualCardRef}>
    <Card hover={false}>
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="font-medium text-gray-900">Add or Refer a Reviewer</p>
          <p className="text-xs text-gray-500">Add a reviewer manually, or capture one a contacted reviewer suggested — fill “Referred by” to tag it as a referral.</p>
        </div>
        {manual.saving && <Spinner />}
      </div>
      <form onSubmit={addManualReviewer} className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="block">
            <span className="block text-xs text-gray-500 mb-1">Name</span>
            <input
              type="text"
              value={manual.name}
              onChange={(ev) => updateManual('name', ev.target.value)}
              disabled={!canManage || manual.saving}
              maxLength={180}
              className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-white disabled:bg-gray-50"
              required
            />
          </label>
          <label className="block">
            <span className="block text-xs text-gray-500 mb-1">Email</span>
            <input
              type="email"
              value={manual.email}
              onChange={(ev) => updateManual('email', ev.target.value)}
              disabled={!canManage || manual.saving}
              maxLength={254}
              className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-white disabled:bg-gray-50"
            />
          </label>
          <label className="block">
            <span className="block text-xs text-gray-500 mb-1">Affiliation</span>
            <input
              type="text"
              value={manual.affiliation}
              onChange={(ev) => updateManual('affiliation', ev.target.value)}
              disabled={!canManage || manual.saving}
              maxLength={500}
              className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-white disabled:bg-gray-50"
            />
          </label>
        </div>
        <div className="flex items-end gap-2">
          <label className="block flex-1">
            <span className="block text-xs text-gray-500 mb-1">ORCID iD</span>
            <input
              type="text"
              value={manual.orcid}
              onChange={(ev) => updateManual('orcid', ev.target.value)}
              disabled={!canManage || manual.saving}
              placeholder="0000-0000-0000-0000"
              maxLength={64}
              className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-white disabled:bg-gray-50"
            />
          </label>
          <button
            type="button"
            onClick={lookupOrcid}
            disabled={!canManage || manual.saving || manual.lookingUp || !manual.name.trim()}
            className="px-3 py-1.5 border border-gray-300 rounded text-sm whitespace-nowrap disabled:opacity-50"
            title="Search ORCID by name + affiliation"
          >
            {manual.lookingUp ? 'Searching…' : 'Find ORCID'}
          </button>
        </div>
        {manual.lookupMsg && (
          <p className={`text-xs ${manual.lookupMsg.tone === 'ok' ? 'text-green-700' : 'text-amber-700'}`}>
            {manual.lookupMsg.text}
          </p>
        )}
        {lookupDecision?.outcome === 'confident' && (
          <div className="border border-green-200 bg-green-50 rounded p-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium text-green-900">Use existing person</p>
                <p className="text-green-800">
                  {lookupDecision.match?.context?.name || manual.name || 'Existing reviewer'}
                  {lookupDecision.match?.matchKey ? ` · matched by ${lookupDecision.match.matchKey}` : ''}
                </p>
                {renderContext(lookupDecision.match?.context) && (
                  <p className="text-xs text-green-700 mt-1">{renderContext(lookupDecision.match.context)}</p>
                )}
              </div>
              {lookupDecision.match?.context?.active === false && (
                <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-800">Inactive</span>
              )}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => chooseResolution(resolutionForConfident(lookupDecision))}
                className={`px-2 py-1 rounded border text-xs ${manual.resolution ? 'bg-green-900 text-white border-green-900' : 'bg-white text-green-900 border-green-300'}`}
              >
                Reuse this person
              </button>
              <button type="button" onClick={createDespiteLookup} className="px-2 py-1 rounded border border-gray-300 text-xs bg-white text-gray-700">
                Create new instead
              </button>
            </div>
          </div>
        )}
        {lookupDecision?.outcome === 'candidates' && (
          <div className="border border-amber-200 bg-amber-50 rounded p-3 text-sm">
            <p className="font-medium text-amber-900">Confirm existing person</p>
            <p className="text-xs text-amber-800 mt-1">
              This may already be a known person. Select the matching person below and click “Confirm and Add” — or “Disconfirm” if none of these is the same person.
            </p>
            <div className="mt-2 space-y-2">
              {(lookupDecision.candidates || []).map((candidate, idx) => {
                const key = `${candidate.source}-${candidate.reviewerId || candidate.contactId || idx}`;
                const resolution = candidate.reviewerId
                  ? { mode: 'reuse_reviewer', reviewerId: candidate.reviewerId, contactId: candidate.contactId || undefined }
                  : { mode: 'reuse_contact', contactId: candidate.contactId };
                const selected = manual.resolution && (
                  (manual.resolution.reviewerId && manual.resolution.reviewerId === resolution.reviewerId) ||
                  (manual.resolution.contactId && manual.resolution.contactId === resolution.contactId)
                );
                return (
                  <button
                    type="button"
                    key={key}
                    onClick={() => chooseResolution(resolution)}
                    className={`w-full text-left border rounded p-2 cursor-pointer ${selected ? 'border-emerald-300 bg-emerald-50' : 'border-amber-200 bg-white/70 hover:border-amber-400 hover:bg-white'}`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className={`font-medium ${selected ? 'text-emerald-900' : 'text-gray-900'}`}>{candidate.context?.name || 'Existing person'}</span>
                      <span className="flex items-center gap-2 whitespace-nowrap">
                        <span className="text-xs text-gray-500">
                          {candidate.source}{candidate.matchKey ? ` · ${candidate.matchKey}` : ''}
                          {candidate.context?.active === false ? ' · inactive' : ''}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded border ${selected ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-700 border-gray-300'}`}>
                          {selected ? '✓ Selected' : 'Use this person'}
                        </span>
                      </span>
                    </span>
                    {renderContext(candidate.context) && <span className="block text-xs text-gray-600 mt-1">{renderContext(candidate.context)}</span>}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="submit"
                disabled={!canManage || manual.saving || !manual.resolution}
                title={!manual.resolution ? 'Select the matching person above first' : undefined}
                className="px-2 py-1 rounded text-xs bg-emerald-700 text-white border border-emerald-700 disabled:opacity-50"
              >
                Confirm and Add
              </button>
              <button type="button" onClick={disconfirmLookup} className="px-2 py-1 rounded border border-gray-300 text-xs bg-white text-gray-700">
                Disconfirm
              </button>
            </div>
          </div>
        )}
        {lookupDecision?.outcome === 'conflict' && (
          <div className="border border-red-200 bg-red-50 rounded p-3 text-sm">
            <p className="font-medium text-red-900">Identity conflict</p>
            <p className="text-red-800 mt-1">
              Existing reviewer/contact records disagree for this add ({lookupDecision.reason}). Choose create-new only if this is a different person.
            </p>
            <button type="button" onClick={createDespiteLookup} className="mt-2 px-2 py-1 rounded border border-red-300 text-xs bg-white text-red-800">
              Create new person
            </button>
          </div>
        )}
        <label className="block">
          <span className="block text-xs text-gray-500 mb-1">Referred by <span className="text-gray-400">(optional — the reviewer who suggested this person)</span></span>
          <input
            type="text"
            value={manual.referredBy}
            onChange={(ev) => updateManual('referredBy', ev.target.value)}
            disabled={!canManage || manual.saving}
            maxLength={180}
            placeholder="e.g. Dr. Abby Doyle"
            className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-white disabled:bg-gray-50"
          />
        </label>
        <label className="block">
          <span className="block text-xs text-gray-500 mb-1">Note</span>
          <textarea
            value={manual.note}
            onChange={(ev) => updateManual('note', ev.target.value)}
            disabled={!canManage || manual.saving}
            maxLength={1000}
            rows={2}
            className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-white disabled:bg-gray-50"
          />
        </label>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={!canManage || manual.saving || !manual.name.trim()}
            className="px-3 py-1.5 bg-gray-900 text-white rounded text-sm disabled:opacity-50"
          >
            {manual.saving ? 'Adding...' : 'Add reviewer'}
          </button>
          {manual.error && <span className="text-sm text-red-700">{manual.error}</span>}
          {manual.added && (
            <span className="text-sm text-green-700">
              Added {manual.added.name || 'reviewer'} to Candidates.
            </span>
          )}
          {manual.remedy && (
            <div className="text-sm text-amber-800">
              <span>{manual.remedy.message}</span>
              {onNavigate && manual.remedy.outcome !== 'promotion_required' && (
                <button
                  type="button"
                  onClick={() => onNavigate(
                    manual.remedy.outcome === 'restore_required' || manual.remedy.stage === 'selected'
                      ? 'candidates'
                      : 'track',
                  )}
                  className="ml-2 underline font-medium"
                >
                  {manual.remedy.outcome === 'restore_required'
                    ? 'Open Removed'
                    : manual.remedy.stage === 'selected'
                      ? 'Open Invite'
                      : 'Open Track'}
                </button>
              )}
            </div>
          )}
        </div>
      </form>
    </Card>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Applicant-recommended reviewers are now rendered (and verified) inside
          ReviewerSearchSection's bottom card — combined with the optional verify
          action and positioned below the search. The ingestion state is passed
          through as props. */}

      {/* Applicant-excluded reviewers are no longer a standalone card: the parsed
          names prefill the search's Exclude box, and the applicant's original
          exclusion text is shown as a disclosure under that box (ReviewerSearchSection).
          exclusionsUnavailable surfaces the parse-fail / load-fail case there. */}

      {/* Proposal document (auto-loaded, with manual override) */}
      <Card hover={false}>
        <div className="flex items-center justify-between mb-2">
          <p className="font-medium text-gray-900">Proposal document</p>
          {doc.loading && <Spinner />}
        </div>
        {doc.error ? (
          <div className="p-3 bg-amber-50 text-amber-700 rounded-lg text-sm">
            {availableFiles.length > 0
              ? (doc.requestedFileKey
                ? 'The saved proposal selection could not be loaded. Choose the proposal document below.'
                : 'The standard reviewer proposal was not found. Choose the proposal document below.')
              : doc.error}{' '}
            <button
              type="button"
              onClick={() => loadProposal(doc.requestedFileKey || proposalFileKey || null)}
              className="underline font-medium"
            >Retry</button>
          </div>
        ) : doc.loading ? (
          <p className="text-sm text-gray-500">Loading the request’s proposal from SharePoint…</p>
        ) : doc.data ? (
          <p className="text-sm text-gray-700">
            Loaded {doc.requestedFileKey ? 'selected' : 'canonical reviewer'} proposal{' '}
            <span className="font-medium">{doc.data.filename}</span>.
          </p>
        ) : (
          <p className="text-sm text-gray-600">No proposal document found for this request.</p>
        )}

        {/* Deliberate override for historical/ad-hoc analysis. allFiles is
            present on success and when the canonical file is absent. */}
        {availableFiles.length > 0 && (
          <div className="mt-3">
            <label className="block text-xs text-gray-500 mb-1">
              {doc.error ? 'Choose the proposal document' : 'Use a different proposal document'}
            </label>
            <select
              className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-white"
              value={pickedKey || ''}
              disabled={doc.loading}
              onChange={(ev) => {
                if (ev.target.value) loadProposal(ev.target.value, { persist: true });
              }}
            >
              {!pickedKey && <option value="">Select a file…</option>}
              {availableFiles.map((f) => {
                const k = fileKeyOf(f);
                return (
                  <option key={k} value={k}>
                    {f.name}{f.classification === 'proposal' ? '  ·  proposal' : ''}
                  </option>
                );
              })}
            </select>
          </div>
        )}
      </Card>

      {/* In-panel candidate search — uses the proposal already loaded above and
          the applicant exclude list; saves into this request's candidate pool.
          exclusionsUnavailable flags when ingestion couldn't produce the list so
          the search shows a warning rather than treating it as "no exclusions".
          The manual-add card is passed as manualAddSlot so it renders BELOW the
          search and ABOVE the optional verify card. */}
      <ReviewerSearchSection
        requestId={requestId}
        blobUrl={doc.data?.blobUrl || null}
        proposalKey={doc.data?.picked || null}
        cycleCode={data?.cycleCode || null}
        excludedNames={data?.excludedNames || []}
        exclusionsUnavailable={!!ingest.error || excludedParseFailed}
        excludedRaw={excludedRaw}
        recommended={recommended}
        recommendedFailed={recommendedFailed}
        knownLookupFailed={knownLookupFailed}
        slotsPopulated={slotsPopulated}
        ingestLoading={ingest.loading}
        ingestError={ingest.error}
        onRetryIngestion={runIngestion}
        savedPool={savedPool}
        onSaved={onSaved}
        onNavigate={onNavigate}
        manualAddSlot={manualAddCard}
        repairCandidateKey={repairCandidateKey}
      />
    </div>
  );
}
