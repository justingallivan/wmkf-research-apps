/**
 * ReviewerInvitePanel — the Workbench "Invite Reviewers" sub-tab (was CandidatesPanel;
 * renamed S291. The sub-tab key `candidates` / `?sub=candidates` deep-link is unchanged).
 * The persistent roster of
 * every saved candidate for a request (applicant-recommended + search-found),
 * with their invitation status, and the surface to actually INVITE them.
 *
 * Data: GET /api/reviewer-finder/my-candidates?requestId=<guid> (returns ALL
 * selected suggestion rows for the request, regardless of accepted). Sending an
 * invitation runs through InviteEmailModal (render-emails → send-emails,
 * templateType 'invitation' → real Dynamics email with an accept/decline magic
 * link; sets invited=true). Once a candidate accepts in the external portal they
 * move into the Track Reviewers tab (accepted-only).
 *
 * Props:
 *   - requestId
 *   - candidates : [{ suggestionId, name, affiliation, email, hIndex, totalCitations,
 *                     relevanceScore, reasoning, keywords, website, googleScholarUrl,
 *                     googleScholarId, orcidUrl, applicantRecommended, manualAdded, invited, accepted,
 *                     declined, emailSentAt, responseType }]
 *
 * Each candidate carries the persisted selection rationale (reasoning) + metrics
 * (h-index, citations, relevance) + profile links so a PD returning to the list
 * across multiple invite rounds can refresh their memory without re-running a
 * search. NB: recent papers are NOT persisted (live-only during a search) — the
 * Scholar link is the way to pull them up again.
 *   - loading, onRefresh, settings ({ signature })
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Card } from '../Layout';
import InviteEmailModal from './InviteEmailModal';
import CandidateEditModal from './CandidateEditModal';
import RemoveEntirelyModal from './RemoveEntirelyModal';
import ReleaseEmailModal from './ReleaseEmailModal';
import { buildScholarSearchUrl, isRealScholarProfileUrl } from '../../../lib/utils/scholar-url';
import { ContactParser } from '../../../lib/utils/contact-parser';

function StatusChip({ c }) {
  const tones = {
    declined: 'bg-red-100 text-red-700',
    accepted: 'bg-green-100 text-green-700',
    invited: 'bg-amber-100 text-amber-800',
    closed: 'bg-gray-100 text-gray-500',
    none: 'bg-gray-100 text-gray-600',
  };
  // Reviewer-engagement Phase 4: a set responseType (withdrawn_sufficient / no_response /
  // held) is a resolved state — don't keep showing the row as "awaiting response".
  const withdrawn = c.responseType === 'withdrawn_sufficient';
  const noResponse = c.responseType === 'no_response';
  const label = c.declined ? 'Declined'
    : c.accepted ? 'Accepted'
    : withdrawn ? 'Released — no longer needed'
    : noResponse ? 'No response'
    : c.invited ? 'Invited — awaiting response'
    : 'Not invited';
  const tone = c.declined ? tones.declined
    : c.accepted ? tones.accepted
    : (withdrawn || noResponse) ? tones.closed
    : c.invited ? tones.invited
    : tones.none;
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${tone}`}>{label}</span>;
}

function isManualAdded(c) {
  return c.manualAdded === true || (Array.isArray(c.sources) && c.sources.includes('staff_manual'));
}

function candidateContactPageUrl(c) {
  const facultyPageUrl = c.facultyPageUrl && !ContactParser.isDocumentUrl(c.facultyPageUrl) ? c.facultyPageUrl : null;
  return facultyPageUrl || c.website;
}

const REMOVE_MENU_WIDTH = 264; // wide enough for the permanent-delete subtitle
const REMOVE_MENU_ITEM_H = 56;  // two two-line items — drives the upward-flip estimate

// The single "Remove ▾" control on an active candidate row, surfacing the two
// distinct removals directly (S347 discoverability fix — permanent delete used
// to be reachable ONLY after a soft-remove + expanding the "Removed" section):
//   • "Remove from this proposal" → recoverable per-request drop (removeCandidate)
//   • "Delete permanently…"       → opens RemoveEntirelyModal (engagement +
//                                    honorarium + reviews; contact-delete is that
//                                    modal's own nested opt-in)
// Both destinations carry their own confirm, so this menu is just routing.
// Mirrors TokenActionsMenu's portalled, outside-click-closing, upward-flipping
// pattern so the menu escapes the row's clipping/stacking context.
function RowRemoveMenu({ candidate, disabled = false, onRemoveFromProposal, onDeletePermanently }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null); // { left, top } in viewport px, or null
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  const place = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const estHeight = 2 * REMOVE_MENU_ITEM_H + 8;
    const openUp = rect.bottom + estHeight > window.innerHeight && rect.top > estHeight;
    setCoords({
      left: Math.max(8, rect.right - REMOVE_MENU_WIDTH),
      top: openUp ? rect.top - estHeight - 4 : rect.bottom + 4,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    place();
    // Close only when the click is outside BOTH the trigger and the portalled menu.
    const onDocClick = (e) => {
      if (btnRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    // Position is computed once on open; close on scroll/resize so a stale fixed
    // position can never be shown detached from its row.
    const onReflow = () => setOpen(false);
    document.addEventListener('mousedown', onDocClick);
    window.addEventListener('scroll', onReflow, true);
    window.addEventListener('resize', onReflow);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('scroll', onReflow, true);
      window.removeEventListener('resize', onReflow);
    };
  }, [open, place]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        className="flex items-center gap-0.5 px-1.5 py-1 text-xs text-gray-400 hover:text-red-600 disabled:opacity-50 rounded hover:bg-gray-100"
        title="Remove this candidate"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        Remove
        <span aria-hidden="true" className="text-[10px]">▾</span>
      </button>
      {open && coords && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          role="menu"
          style={{ position: 'fixed', left: coords.left, top: coords.top, width: REMOVE_MENU_WIDTH }}
          className="bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1 text-sm"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); onRemoveFromProposal(); }}
            className="w-full text-left px-3 py-2 hover:bg-gray-50"
          >
            Remove from this proposal
            <span className="block text-xs text-gray-400">Recoverable — moves to Removed below</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); onDeletePermanently(); }}
            className="w-full text-left px-3 py-2 hover:bg-gray-50 text-red-700 border-t border-gray-100"
          >
            Delete permanently…
            <span className="block text-xs text-red-400">Engagement, honorarium &amp; reviews — cannot be undone</span>
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}

export default function ReviewerInvitePanel({ requestId, candidates = [], removedCandidates = [], loading = false, onRefresh, settings = {}, canManage = true }) {
  const [selected, setSelected] = useState(() => new Set());
  const [modal, setModal] = useState(null); // { candidates, allowResend } | null
  const [editing, setEditing] = useState(null); // candidate row being edited | null
  const [removingId, setRemovingId] = useState(null);
  const [releaseModal, setReleaseModal] = useState(null); // { suggestionIds } | null
  const [restoringId, setRestoringId] = useState(null);
  const [showRemoved, setShowRemoved] = useState(true);
  const [removeEntirelyTarget, setRemoveEntirelyTarget] = useState(null); // candidate row | null
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);
  const exportingRef = useRef(false);

  // Export the saved candidate list to Excel (same Request Info + Candidates
  // workbook the Find tab builds, server-side). The persisted rows carry only
  // invite-stage fields (contact, affiliation, rationale, expertise, metrics) —
  // search-time COI / publication counts aren't persisted, so those columns read
  // as "None noted"/blank, matching what this tab shows. Board-writeup identity
  // (rank/department/institution) is captured at acceptance, not here.
  const exportCandidates = async () => {
    if (exportingRef.current || candidates.length === 0) return;
    exportingRef.current = true;
    setExporting(true);
    setExportError(null);
    try {
      const rows = candidates.map((c) => ({
        name: c.name,
        affiliation: c.affiliation || null,
        email: c.email || null,
        reasoning: c.reasoning || null,
        isApplicantRecommended: !!c.applicantRecommended,
        keywords: c.keywords || null,
        orcidUrl: c.orcidUrl || null,
        scholarUrl: c.googleScholarUrl || buildScholarSearchUrl(c.name, c.affiliation),
        hasRealScholar: isRealScholarProfileUrl(c.googleScholarUrl),
        hIndex: c.hIndex ?? null,
      }));
      const res = await fetch('/api/workbench/export-candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, candidates: rows }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="?([^"]+)"?/);
      const filename = match ? match[1] : 'reviewer-candidates.xlsx';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(e.message);
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  };

  // Remove a candidate from THIS request. Same server-authoritative DELETE the
  // Track Reviewers rows use (my-candidates → soft-delete wmkf_selected=false + revoke
  // any link atomically) — never touches the global person/contact. fetch() doesn't
  // throw on 4xx/5xx, so we check resp.ok before refreshing.
  const removeCandidate = async (c) => {
    const msg = `Remove ${c.name || 'this candidate'} from this request?\n\n`
      + 'This drops them from the candidate list for this proposal'
      + (c.invited && !c.accepted ? ' and revokes their invitation link' : '')
      + '. Their reviewer record is preserved, and you can restore them from the '
      + 'Removed list at the bottom of this tab.';
    if (!confirm(msg)) return;
    setRemovingId(c.suggestionId);
    try {
      const resp = await fetch('/api/reviewer-finder/my-candidates', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestionId: c.suggestionId }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        alert(`Could not remove candidate: ${data.error || data.message || data.details || resp.status}`);
        return;
      }
      if (onRefresh) onRefresh();
    } catch (err) {
      alert(`Network error removing candidate: ${err.message}`);
    } finally {
      setRemovingId(null);
    }
  };

  // Reverse the X: re-select a removed candidate so it returns to the list above.
  // PATCH { restore:true } → server re-selects (never un-revokes a token). Same
  // resp.ok guard as removeCandidate (fetch doesn't throw on 4xx/5xx).
  const restoreCandidate = async (c) => {
    setRestoringId(c.suggestionId);
    try {
      const resp = await fetch('/api/reviewer-finder/my-candidates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestionId: c.suggestionId, restore: true }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        alert(`Could not restore candidate: ${data.error || data.message || data.details || resp.status}`);
        return;
      }
      if (onRefresh) onRefresh();
    } catch (err) {
      alert(`Network error restoring candidate: ${err.message}`);
    } finally {
      setRestoringId(null);
    }
  };

  const invitable = candidates.filter(
    (c) => !c.invited && !c.accepted && !c.declined && !c.responseType && c.email
  );
  const acceptedCount = candidates.filter((c) => c.accepted).length;
  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const selectedRows = candidates.filter((c) => selected.has(c.suggestionId));
  // Require an email for the Send set (mirrors the checkbox-disable predicate): if a
  // row was selected and then edited to clear its email mid-session, it must drop out
  // of the invite count + InviteEmailModal rather than ride along as a doomed,
  // server-skipped send (Codex S290 sanity-check #2 — stale `selected` not pruned).
  const selectedNotInvited = selectedRows.filter(
    (c) => !c.invited && !c.accepted && !c.declined && !c.responseType && c.email
  );
  // Still-pending = invited, no response yet (not accepted/declined, and no resolved
  // responseType — excludes already-withdrawn/no_response). The only rows the PD may
  // "no longer needed"-release (reviewer-engagement Phase 4 §3.C). Server re-guards this.
  const selectedPending = selectedRows.filter((c) => c.invited && !c.accepted && !c.declined && !c.responseType);

  // Staff review the rendered emails and can tune each one before anything is
  // sent (staff request, 2026-07-27). The release itself still happens
  // server-side in the same call as the send — see ReleaseEmailModal.
  const handleWithdraw = () => {
    if (selectedPending.length === 0) return;
    setReleaseModal({ suggestionIds: selectedPending.map((c) => c.suggestionId) });
  };

  const openInvite = (rows, allowResend) => {
    setModal({
      candidates: rows.map((c) => ({ suggestionId: c.suggestionId, name: c.name, email: c.email })),
      allowResend,
    });
  };

  const afterSent = () => { setSelected(new Set()); if (onRefresh) onRefresh(); };

  return (
    <Card hover={false}>
      <div className="flex items-center justify-between mb-3">
        <p className="font-medium text-gray-900">Invite Reviewers ({candidates.length})</p>
        <span className="flex items-center gap-3">
          {candidates.length > 0 && (
            <button
              type="button"
              onClick={exportCandidates}
              disabled={exporting}
              className="text-sm text-gray-600 hover:text-gray-900 underline disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
              title="Download the saved candidate list as an Excel workbook"
            >
              {exporting ? 'Exporting…' : '⬇ Export to Excel'}
            </button>
          )}
          {loading && <div className="w-5 h-5 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" />}
        </span>
      </div>
      {exportError && (
        <p className="text-xs text-red-600 mb-2">Export failed: {exportError}</p>
      )}

      {candidates.length === 0 ? (
        <p className="text-sm text-gray-600">
          No saved candidates yet. Use the <span className="font-medium">Find</span> tab to add applicant-recommended
          reviewers and search for more, then invite them here.
        </p>
      ) : (
        <>
          <p className="text-sm text-gray-600 mb-2">
            Select candidates and send invitations. Each invitation includes a secure accept/decline link; once a
            reviewer accepts they appear in the <span className="font-medium">Track Reviewers</span> tab.
          </p>

          <ul className="divide-y divide-gray-100 max-h-[34rem] overflow-y-auto">
            {candidates.map((c) => (
              <li key={c.suggestionId} className="py-3 flex items-start gap-3">
                {/* No email ⇒ can't be invited (send-emails skips no_email). Block
                    selection so a doomed invite can't be queued — but let an
                    already-invited row through (email may have been cleared after
                    invite) so it stays releasable. */}
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={selected.has(c.suggestionId)}
                  disabled={
                    c.accepted ||
                    c.declined ||
                    Boolean(c.responseType) ||
                    (!c.email && !c.invited)
                  }
                  onChange={() => toggle(c.suggestionId)}
                  title={
                    c.declined || c.responseType
                      ? 'This reviewer has already responded and cannot be invited again'
                      : !c.email && !c.invited
                        ? 'Add an email (✏️ Edit contact) before this candidate can be invited'
                        : undefined
                  }
                  aria-label={`Select ${c.name}`}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 min-w-0">
                      <button
                        type="button"
                        onClick={() => setEditing(c)}
                        className="text-sm font-medium text-gray-900 hover:text-blue-700 hover:underline truncate text-left"
                        title="Edit this candidate’s details (name, email, affiliation…)"
                      >
                        {c.name || '(unnamed)'}
                      </button>
                      {c.applicantRecommended && (
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700 whitespace-nowrap"
                          title="Recommended by the applicant on their proposal"
                        >
                          Applicant-Referred
                        </span>
                      )}
                      {isManualAdded(c) && (
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700 whitespace-nowrap"
                          title="Manually added by staff for this request"
                        >
                          Manually added
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-1 flex-shrink-0">
                      <StatusChip c={c} />
                      {canManage && (
                        <RowRemoveMenu
                          candidate={c}
                          disabled={removingId === c.suggestionId}
                          onRemoveFromProposal={() => removeCandidate(c)}
                          onDeletePermanently={() => setRemoveEntirelyTarget(c)}
                        />
                      )}
                    </span>
                  </div>
                  {c.affiliation && <p className="text-xs text-gray-500 mt-0.5 truncate">{c.affiliation}</p>}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-xs text-gray-500">
                    {c.email ? <span>{c.email}</span> : (
                      <span className="text-amber-700">
                        no email — can’t invite
                        {candidateContactPageUrl(c) && (
                          <>
                            {' · '}
                            <a
                              href={candidateContactPageUrl(c)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-amber-800 underline hover:text-amber-900"
                              title="Open the faculty page to find this reviewer’s email, then add it via Edit"
                            >
                              find on faculty page →
                            </a>
                          </>
                        )}
                      </span>
                    )}
                    {c.hIndex != null && <span>h-index {c.hIndex}</span>}
                    {c.totalCitations != null && <span>{Number(c.totalCitations).toLocaleString()} citations</span>}
                    {c.priorReviewCount > 0 && (
                      <span
                        className="text-gray-600"
                        title="Reviews this person has completed for WMKF across all requests"
                      >
                        reviewed {c.priorReviewCount}×{c.lastReviewAt ? ` · last ${new Date(c.lastReviewAt).toLocaleDateString()}` : ''}
                      </span>
                    )}
                    {c.emailSentAt && <span>invited {new Date(c.emailSentAt).toLocaleDateString()}</span>}
                  </div>
                  {!c.email && !c.invited && (
                    <div className="mt-1.5 p-2 rounded border border-amber-300 bg-amber-50 text-xs text-amber-800">
                      <span className="font-medium">Contact withheld / identity review required.</span>{' '}
                      This legacy selected row has no canonical email. Verify the person and add the exact address before inviting.
                    </div>
                  )}

                  {/* Persisted selection rationale — the key "refresh my memory"
                      content when a PD returns to the list across invite rounds. */}
                  {c.reasoning && (
                    <p className="text-xs text-gray-700 mt-1.5">
                      <span className="font-medium">Why: </span>{c.reasoning}
                    </p>
                  )}
                  {c.keywords && (
                    <p className="text-xs text-gray-500 mt-1 truncate" title={c.keywords}>
                      <span className="font-medium text-gray-600">Expertise: </span>{c.keywords}
                    </p>
                  )}

                  {/* Profile links. Recent papers aren't persisted (live-only
                      during a search), so Scholar is how staff pull them up again. */}
                  <div className="mt-1.5 flex items-center flex-wrap gap-3 text-xs">
                    <a
                      href={c.googleScholarUrl || buildScholarSearchUrl(c.name, c.affiliation)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-purple-600 hover:text-purple-800"
                      title={isRealScholarProfileUrl(c.googleScholarUrl) ? 'Open Google Scholar profile to view papers' : 'Search Google Scholar to view papers'}
                    >
                      🎓 {isRealScholarProfileUrl(c.googleScholarUrl) ? 'Scholar profile' : 'Scholar search'} →
                    </a>
                    {c.website && (
                      <a href={c.website} target="_blank" rel="noopener noreferrer" className="text-green-700 hover:text-green-900" title="Faculty / personal website">
                        🔗 Website
                      </a>
                    )}
                    {c.orcidUrl && (
                      <a href={c.orcidUrl} target="_blank" rel="noopener noreferrer" className="text-emerald-700 hover:text-emerald-900" title="ORCID profile">
                        ORCID
                      </a>
                    )}
                    {/* Explicit edit affordance, mirroring the Find tab's "✏️ Edit
                        contact" (ReviewerSearchSection) so staff don't have to discover
                        that the name is clickable. Same PATCH-mode modal as the name. */}
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => setEditing(c)}
                        className="text-gray-500 hover:text-blue-700 flex items-center gap-1"
                        title="Edit this candidate’s details (name, email, affiliation…)"
                      >
                        ✏️ Edit contact
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-3 mt-3">
            <button
              type="button"
              onClick={() => openInvite(selectedNotInvited, false)}
              disabled={selectedNotInvited.length === 0}
              className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Send invitation{selectedNotInvited.length > 0 ? ` (${selectedNotInvited.length})` : ''}
            </button>
            {selectedPending.length > 0 && (
              <button
                type="button"
                onClick={handleWithdraw}
                className="text-sm text-gray-600 underline disabled:opacity-40 disabled:cursor-not-allowed"
                title="Review and edit the 'no longer needed' note, then send it and close these pending invitations"
              >
                {`Review & release ${selectedPending.length} as no longer needed`}
              </button>
            )}
            <span className="text-xs text-gray-400">{invitable.length} invitable · {acceptedCount} accepted</span>
          </div>
        </>
      )}

      {removedCandidates.length > 0 && (
        <div className="mt-4 border-t border-gray-100 pt-3">
          <button
            type="button"
            onClick={() => setShowRemoved((v) => !v)}
            className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700"
            aria-expanded={showRemoved}
          >
            <span className="text-gray-400">{showRemoved ? '▾' : '▸'}</span>
            Removed ({removedCandidates.length})
          </button>
          {showRemoved && (
            <>
              <p className="text-xs text-gray-400 mt-1.5">
                Candidates removed from this request and reviewers who declined. Restoring starts a fresh
                invitation.
              </p>
              <ul className="mt-2 divide-y divide-gray-100">
                {removedCandidates.map((c) => (
                  <li key={c.suggestionId} className="py-2 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm text-gray-700 truncate">
                        {c.name || '(unnamed)'}
                        {c.declined ? (
                          <span className="ml-2 text-xs font-medium text-red-600">Declined</span>
                        ) : c.wasInvited && (
                          <span className="ml-2 text-xs text-gray-400">(invite was revoked)</span>
                        )}
                      </p>
                      {c.affiliation && <p className="text-xs text-gray-400 truncate">{c.affiliation}</p>}
                    </div>
                    {canManage && (
                      <span className="flex items-center gap-3 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => restoreCandidate(c)}
                          disabled={restoringId === c.suggestionId}
                          className="text-xs font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50 whitespace-nowrap"
                          title={c.declined
                            ? 'Clear the prior decline and restore this reviewer for a fresh invitation'
                            : 'Restore this candidate to the list above'}
                        >
                          {restoringId === c.suggestionId
                            ? 'Restoring…'
                            : c.declined ? 'Reset & restore' : 'Restore'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setRemoveEntirelyTarget(c)}
                          className="text-xs font-medium text-red-600 hover:text-red-800 whitespace-nowrap"
                          title="Permanently delete this engagement (cannot be restored)"
                        >
                          Remove entirely
                        </button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {modal && (
        <InviteEmailModal
          requestId={requestId}
          candidates={modal.candidates}
          settings={settings}
          allowResend={modal.allowResend}
          onClose={() => setModal(null)}
          onSent={afterSent}
        />
      )}

      {releaseModal && (
        <ReleaseEmailModal
          requestId={requestId}
          suggestionIds={releaseModal.suggestionIds}
          onClose={() => setReleaseModal(null)}
          onReleased={() => { setSelected(new Set()); if (onRefresh) onRefresh(); }}
        />
      )}

      {removeEntirelyTarget && (
        <RemoveEntirelyModal
          candidate={removeEntirelyTarget}
          onClose={() => setRemoveEntirelyTarget(null)}
          onRemoved={() => { if (onRefresh) onRefresh(); }}
        />
      )}

      {editing && (
        <CandidateEditModal
          candidate={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { if (onRefresh) onRefresh(); }}
          onResolveAddressConflict={() => {
            const target = editing;
            setEditing(null);
            openInvite([target], false);
          }}
        />
      )}
    </Card>
  );
}
