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
 *                     applicantRecommended, invited, accepted, declined, emailSentAt, responseType }]
 *   - loading, onRefresh, settings ({ signature })
 */

import { useState } from 'react';
import { Card } from '../Layout';
import InviteEmailModal from './InviteEmailModal';

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

export default function CandidatesPanel({ requestId, candidates = [], loading = false, onRefresh, settings = {} }) {
  const [selected, setSelected] = useState(() => new Set());
  const [modal, setModal] = useState(null); // { candidates, allowResend } | null

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
                      <span className="text-sm font-medium text-gray-900 truncate">{c.name || '(unnamed)'}</span>
                      {c.applicantRecommended && (
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700 whitespace-nowrap"
                          title="Recommended by the applicant on their proposal"
                        >
                          Applicant-suggested
                        </span>
                      )}
                    </span>
                    <StatusChip c={c} />
                  </div>
                  {c.affiliation && <p className="text-xs text-gray-500 mt-0.5 truncate">{c.affiliation}</p>}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-xs text-gray-500">
                    {c.email ? <span>{c.email}</span> : <span className="text-amber-700">no email — can’t invite</span>}
                    {c.hIndex != null && <span>h-index {c.hIndex}</span>}
                    {c.totalCitations != null && <span>{Number(c.totalCitations).toLocaleString()} citations</span>}
                    {c.emailSentAt && <span>invited {new Date(c.emailSentAt).toLocaleDateString()}</span>}
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
    </Card>
  );
}
