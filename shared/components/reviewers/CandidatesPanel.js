/**
 * CandidatesPanel — the Workbench "Candidates" sub-tab. The persistent roster of
 * every saved candidate for a request (applicant-recommended + search-found),
 * with their invitation status, and the surface to actually INVITE them.
 *
 * Data: GET /api/reviewer-finder/my-candidates?requestId=<guid> (returns ALL
 * selected suggestion rows for the request, regardless of accepted). Sending an
 * invitation runs through InviteEmailModal (render-emails → send-emails,
 * templateType 'invitation' → real Dynamics email with an accept/decline magic
 * link; sets invited=true). Once a candidate accepts in the external portal they
 * move into the Invite/Track/Completed tabs (accepted-only).
 *
 * Props:
 *   - requestId
 *   - candidates : [{ suggestionId, name, affiliation, email, hIndex, totalCitations,
 *                     relevanceScore, reasoning, keywords, website, googleScholarUrl,
 *                     googleScholarId, orcidUrl, applicantRecommended, invited, accepted,
 *                     declined, emailSentAt, responseType }]
 *
 * Each candidate carries the persisted selection rationale (reasoning) + metrics
 * (h-index, citations, relevance) + profile links so a PD returning to the list
 * across multiple invite rounds can refresh their memory without re-running a
 * search. NB: recent papers are NOT persisted (live-only during a search) — the
 * Scholar link is the way to pull them up again.
 *   - loading, onRefresh, settings ({ signature })
 */

import { useState } from 'react';
import { Card } from '../Layout';
import InviteEmailModal from './InviteEmailModal';
import CandidateEditModal from './CandidateEditModal';
import { buildScholarSearchUrl } from '../../../lib/utils/scholar-url';

function StatusChip({ c }) {
  const tones = {
    declined: 'bg-red-100 text-red-700',
    accepted: 'bg-green-100 text-green-700',
    invited: 'bg-amber-100 text-amber-800',
    none: 'bg-gray-100 text-gray-600',
  };
  const label = c.declined ? 'Declined' : c.accepted ? 'Accepted' : c.invited ? 'Invited — awaiting response' : 'Not invited';
  const tone = c.declined ? tones.declined : c.accepted ? tones.accepted : c.invited ? tones.invited : tones.none;
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${tone}`}>{label}</span>;
}

export default function CandidatesPanel({ requestId, candidates = [], loading = false, onRefresh, settings = {}, canManage = true }) {
  const [selected, setSelected] = useState(() => new Set());
  const [modal, setModal] = useState(null); // { candidates, allowResend } | null
  const [editing, setEditing] = useState(null); // candidate row being edited | null
  const [removingId, setRemovingId] = useState(null);

  // Remove a candidate from THIS request. Same server-authoritative DELETE the
  // Invite/Track rows use (my-candidates → soft-delete wmkf_selected=false + revoke
  // any link atomically) — never touches the global person/contact. fetch() doesn't
  // throw on 4xx/5xx, so we check resp.ok before refreshing.
  const removeCandidate = async (c) => {
    const msg = `Remove ${c.name || 'this candidate'} from this request?\n\n`
      + 'This drops them from the candidate list for this proposal'
      + (c.invited && !c.accepted ? ' and revokes their invitation link' : '')
      + '. Their reviewer record is preserved.';
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

  // Accepted candidates are managed in the Invite/Track tabs; not selectable here.
  const selectable = candidates.filter((c) => !c.accepted);
  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const selectedRows = candidates.filter((c) => selected.has(c.suggestionId));
  const selectedNotInvited = selectedRows.filter((c) => !c.invited && !c.accepted);
  const selectedInvited = selectedRows.filter((c) => c.invited && !c.accepted);

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
        <p className="font-medium text-gray-900">Candidates ({candidates.length})</p>
        {loading && <div className="w-5 h-5 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" />}
      </div>

      {candidates.length === 0 ? (
        <p className="text-sm text-gray-600">
          No saved candidates yet. Use the <span className="font-medium">Find</span> tab to add applicant-recommended
          reviewers and search for more, then invite them here.
        </p>
      ) : (
        <>
          <p className="text-sm text-gray-600 mb-2">
            Select candidates and send invitations. Each invitation includes a secure accept/decline link; once a
            reviewer accepts they appear in the <span className="font-medium">Invite</span> tab.
          </p>

          <ul className="divide-y divide-gray-100 max-h-[34rem] overflow-y-auto">
            {candidates.map((c) => (
              <li key={c.suggestionId} className="py-3 flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={selected.has(c.suggestionId)}
                  disabled={c.accepted}
                  onChange={() => toggle(c.suggestionId)}
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
                          Applicant-suggested
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-1 flex-shrink-0">
                      <StatusChip c={c} />
                      {canManage && (
                        <button
                          type="button"
                          onClick={() => removeCandidate(c)}
                          disabled={removingId === c.suggestionId}
                          className="p-1 text-gray-300 hover:text-red-600 disabled:opacity-50 rounded hover:bg-gray-100"
                          title="Remove from this request"
                          aria-label={`Remove ${c.name || 'candidate'} from this request`}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </span>
                  </div>
                  {c.affiliation && <p className="text-xs text-gray-500 mt-0.5 truncate">{c.affiliation}</p>}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-xs text-gray-500">
                    {c.email ? <span>{c.email}</span> : <span className="text-amber-700">no email — can’t invite</span>}
                    {c.hIndex != null && <span>h-index {c.hIndex}</span>}
                    {c.totalCitations != null && <span>{Number(c.totalCitations).toLocaleString()} citations</span>}
                    {c.emailSentAt && <span>invited {new Date(c.emailSentAt).toLocaleDateString()}</span>}
                  </div>

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
                      title={c.googleScholarUrl ? 'Open Google Scholar profile to view papers' : 'Search Google Scholar to view papers'}
                    >
                      🎓 {c.googleScholarUrl ? 'Scholar profile' : 'Scholar search'} →
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
            {selectedInvited.length > 0 && (
              <button
                type="button"
                onClick={() => openInvite(selectedInvited, true)}
                className="text-sm text-gray-600 underline"
              >
                Re-invite {selectedInvited.length} already-invited
              </button>
            )}
            <span className="text-xs text-gray-400">{selectable.length} invitable · {candidates.length - selectable.length} accepted</span>
          </div>
        </>
      )}

      {modal && (
        <InviteEmailModal
          candidates={modal.candidates}
          settings={settings}
          allowResend={modal.allowResend}
          onClose={() => setModal(null)}
          onSent={afterSent}
        />
      )}

      {editing && (
        <CandidateEditModal
          candidate={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { if (onRefresh) onRefresh(); }}
        />
      )}
    </Card>
  );
}
