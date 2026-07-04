/**
 * ReviewsTab — the Reviews tab inside the Request Workbench (tier-3).
 *
 * Read surface for submitted reviews. A submitted review is captured on the
 * `wmkf_appreviewersuggestion` row (structured Q1/Q3/Q10 ratings) plus an
 * uploaded file in SharePoint; until now nothing read it back. This renders,
 * per reviewer who has submitted, the decoded impact/risk/overall ratings, the
 * reviewer's affiliation, when the review was received, and a download link to
 * the uploaded file.
 *
 * Reuses the existing GET `/api/review-manager/reviewers?proposalId=<guid>`,
 * which projects the rating fields AND (Phase 4) the narrative answer snapshot
 * `reviewer.answers[]` read from the `wmkf_appreviewanswer` child table. Ratings
 * decode through `labelForReviewRating` — the same schema the form wrote; the
 * narrative rich-text answers render as sanitized HTML (the route re-sanitizes
 * server-side immediately before this read, so the bytes here are trusted).
 *
 * Phase 2 (docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md) adds a "Compare" view
 * toggle alongside the default "Cards" rendering above — a schema-free ratings
 * grid + per-question narrative browser derived via `deriveReviewMatrix`
 * (shared/utils/review-matrix.js) from the same `reviewer.answers[]` plus the
 * route's `liveQuestions` (the live admin-panel question set, or null on a
 * fetch failure). "Cards" stays byte-identical to the pre-Phase-2 rendering.
 *
 * Phase 3 (panel-prep export) adds an "Export" affordance to the submitted-
 * reviews toolbar: DOCX (via `composeReviewReport` +
 * `shared/utils/review-report-docx.js`) and PDF (+
 * `shared/utils/review-report-pdf.js`), composed client-side from the same
 * already-loaded `submitted`/`liveQuestions` data — no new fetch, no new
 * route, no Dataverse roll-up column (governing decision 4 in the plan doc).
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Card } from '../Layout';
import { labelForReviewRating, reviewRatingShortLabels } from '../../../lib/external/review-form-schema';
import { deriveReviewMatrix } from '../../utils/review-matrix';
import { composeReviewReport } from '../../utils/review-report';
import { generateReviewReportDocx } from '../../utils/review-report-docx';
import { generateReviewReportPdf } from '../../utils/review-report-pdf';
import { downloadPdf } from '../../utils/pdf-export';

function formatDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// Reviews tab rating order, and the projection field that holds each value.
const RATING_KEYS = ['impact', 'risk', 'overallRating'];
const PROJECTION_FIELD = {
  impact: 'reviewerImpact',
  risk: 'reviewerRisk',
  overallRating: 'reviewerOverallRating',
};

function RatingCell({ fieldKey, value }) {
  const label = labelForReviewRating(fieldKey, value);
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-gray-400">{reviewRatingShortLabels[fieldKey]}</div>
      <div className={`text-sm ${label ? 'text-gray-900' : 'text-gray-400'}`}>{label || 'Not provided'}</div>
    </div>
  );
}

function ReviewCard({ reviewer }) {
  const received = formatDate(reviewer.reviewReceivedAt);
  const affiliation = reviewer.reviewerAffiliation || reviewer.affiliation || null;
  const hasFile = !!reviewer.reviewSharePointFolder;
  return (
    <Card hover={false}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-gray-900">{reviewer.name || 'Unnamed reviewer'}</div>
          {affiliation && <div className="text-sm text-gray-600 truncate">{affiliation}</div>}
          <div className="text-xs text-gray-400 mt-0.5">
            {received ? `Review received ${received}` : 'Review received'}
            {reviewer.reviewUploadedByStaff ? ' · staff upload' : ''}
          </div>
        </div>
        <div className="shrink-0">
          {hasFile ? (
            <a
              href={`/api/review-manager/download-review?suggestionId=${encodeURIComponent(reviewer.suggestionId)}`}
              className="inline-flex items-center gap-1 text-sm text-gray-700 hover:text-gray-900 border border-gray-300 rounded-lg px-3 py-1.5"
              title={`Download: ${reviewer.reviewFilename || 'review'}`}
            >
              ⬇ Download{reviewer.reviewFilename ? '' : ' review'}
            </a>
          ) : (
            <span className="text-xs text-gray-400">No file on record</span>
          )}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 border-t border-gray-100 pt-3">
        {RATING_KEYS.map((k) => (
          <RatingCell key={k} fieldKey={k} value={reviewer[PROJECTION_FIELD[k]]} />
        ))}
      </div>
      <NarrativeAnswers answers={reviewer.answers} />
    </Card>
  );
}

// The narrative (rich-text) answers from the answer snapshot. Ratings already
// render as cells above, so only the rich-text questions show here, in question
// order. HTML is rendered as-is because the API re-sanitizes on read (the stored
// value was sanitized on write, and the route is the trusted server boundary
// immediately before this render).
function NarrativeAnswers({ answers }) {
  const narrative = (answers || []).filter(
    (a) => a.questionType === 'richtext' && a.answerHtml && a.answerHtml.trim().length > 0,
  );
  if (narrative.length === 0) return null;
  return (
    <div className="mt-4 border-t border-gray-100 pt-3 space-y-4">
      {narrative.map((a) => (
        <div key={a.questionKey || a.questionOrder}>
          <div className="text-xs font-semibold text-gray-700">{a.questionText}</div>
          <div
            className="prose prose-sm max-w-none text-gray-800 mt-1"
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: a.answerHtml }}
          />
        </div>
      ))}
    </div>
  );
}

// Phase 2 (schema-free comparison matrix): "Compare" view of the submitted-
// reviews area, alternative to the default "Cards" rendering above. Everything
// here is derived via `deriveReviewMatrix` (shared/utils/review-matrix.js) —
// schema-free per decision 1: no hardcoded question keys, labels come from
// each row's own `answerText`, live question text where the key is live.

// Ratings grid: rows = picklist (rating) questions in live order, columns =
// reviewers + Average + Spread. Wide grids scroll horizontally within their
// own container rather than the page.
function CompareRatingsGrid({ matrix }) {
  const ratingQuestions = matrix.questions.filter((q) => q.type === 'picklist');
  if (ratingQuestions.length === 0) return null;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm border-separate border-spacing-0">
        <thead>
          <tr>
            <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide py-2 pr-4 sticky left-0 bg-white">
              Question
            </th>
            {matrix.reviewers.map((r) => (
              <th key={r.suggestionId} className="text-left text-xs font-semibold text-gray-700 py-2 px-3 whitespace-nowrap">
                {r.name || 'Unnamed reviewer'}
              </th>
            ))}
            <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide py-2 px-3 whitespace-nowrap">
              Average
            </th>
            <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide py-2 px-3 whitespace-nowrap">
              Spread
            </th>
          </tr>
        </thead>
        <tbody>
          {ratingQuestions.map((q) => (
            <tr key={q.key} className="border-t border-gray-100">
              <td className="py-2 pr-4 align-top sticky left-0 bg-white">
                <div className="text-gray-900">{q.text}</div>
                {q.retired && (
                  <span className="inline-block mt-1 text-[10px] uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                    Prior cycle
                  </span>
                )}
              </td>
              {q.cells.map((c) => (
                <td key={c.suggestionId} className="py-2 px-3 align-top whitespace-nowrap">
                  {c.state === 'not-asked' ? (
                    <span className="text-xs text-gray-400 italic">Not asked</span>
                  ) : c.state === 'empty' ? (
                    <span className="text-xs text-gray-400">—</span>
                  ) : (
                    <span className="text-gray-900">
                      {c.answerText || 'Not provided'}
                      {Number.isFinite(c.answerValue) ? ` (${c.answerValue})` : ''}
                    </span>
                  )}
                </td>
              ))}
              <td className="py-2 px-3 align-top whitespace-nowrap text-gray-900">
                {q.average != null ? q.average : <span className="text-gray-400">—</span>}
              </td>
              <td className="py-2 px-3 align-top whitespace-nowrap text-gray-900">
                {q.min != null && q.max != null ? `${q.min}–${q.max}` : <span className="text-gray-400">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Per-question narrative browser: for each richtext question (live order),
// all reviewers' answerHtml stacked with reviewer attribution. HTML is
// rendered the same way NarrativeAnswers (cards view) does — already
// sanitized server-side, this is the trusted last render step.
function CompareNarrativeBrowser({ matrix }) {
  const narrativeQuestions = matrix.questions.filter((q) => q.type === 'richtext');
  if (narrativeQuestions.length === 0) return null;
  return (
    <div className="space-y-6">
      {narrativeQuestions.map((q) => (
        <div key={q.key}>
          <div className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            {q.text}
            {q.retired && (
              <span className="text-[10px] uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                Prior cycle
              </span>
            )}
          </div>
          <div className="mt-2 space-y-3">
            {matrix.reviewers.map((r) => {
              const cell = q.cells.find((c) => c.suggestionId === r.suggestionId);
              return (
                <div key={r.suggestionId} className="border border-gray-100 rounded-lg p-3">
                  <div className="text-xs font-semibold text-gray-500 mb-1">{r.name || 'Unnamed reviewer'}</div>
                  {cell.state === 'not-asked' ? (
                    <div className="text-xs text-gray-400 italic">Not asked</div>
                  ) : cell.state === 'empty' ? (
                    <div className="text-xs text-gray-400">No answer provided</div>
                  ) : (
                    <div
                      className="prose prose-sm max-w-none text-gray-800"
                      dangerouslySetInnerHTML={{ __html: cell.answerHtml }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// Panel-prep export (Phase 3): composes the same matrix Compare renders into
// a plain report object (`composeReviewReport`), then hands it to the DOCX or
// PDF renderer. Proposal identity fields come from whatever `proposals[0]`
// already carries on the reviewers DTO (proposalTitle/requestNumber/
// proposalAuthors/proposalInstitution) — there is no dedicated `piName`
// field, so `proposalAuthors` (project leader/applicant) is used as the best
// available PI identity.
function pad2(n) {
  return String(n).padStart(2, '0');
}

function yyyymmdd(date) {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
}

function ExportMenu({ proposal, submitted, liveQuestions }) {
  const [busy, setBusy] = useState(null); // 'docx' | 'pdf' | null
  const [error, setError] = useState(null);

  const buildReport = useCallback(() => {
    const matrix = deriveReviewMatrix(submitted, liveQuestions);
    return composeReviewReport({
      requestNumber: proposal?.requestNumber ?? null,
      requestTitle: proposal?.proposalTitle ?? null,
      piName: proposal?.proposalAuthors ?? null,
      institution: proposal?.proposalInstitution ?? null,
      matrix,
      generatedAtIso: new Date().toISOString(),
    });
  }, [proposal, submitted, liveQuestions]);

  const filenameBase = `reviews-${proposal?.requestNumber || proposal?.proposalId || 'export'}-${yyyymmdd(new Date())}`;

  const handleExport = useCallback(async (format) => {
    setBusy(format);
    setError(null);
    try {
      const report = buildReport();
      if (format === 'docx') {
        const blob = await generateReviewReportDocx(report);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${filenameBase}.docx`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } else {
        const pdfBytes = await generateReviewReportPdf(report);
        downloadPdf(pdfBytes, `${filenameBase}.pdf`);
      }
    } catch (e) {
      setError(e.message || `Failed to generate ${format.toUpperCase()}.`);
    } finally {
      setBusy(null);
    }
  }, [buildReport, filenameBase]);

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500">Export:</span>
      <button
        type="button"
        onClick={() => handleExport('docx')}
        disabled={busy !== null}
        className="text-xs text-gray-700 hover:text-gray-900 border border-gray-300 rounded-lg px-2.5 py-1 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {busy === 'docx' ? 'Generating…' : 'Word (.docx)'}
      </button>
      <button
        type="button"
        onClick={() => handleExport('pdf')}
        disabled={busy !== null}
        className="text-xs text-gray-700 hover:text-gray-900 border border-gray-300 rounded-lg px-2.5 py-1 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {busy === 'pdf' ? 'Generating…' : 'PDF'}
      </button>
      {error && <span className="text-xs text-amber-600">{error}</span>}
    </div>
  );
}

function CompareView({ submitted, liveQuestions }) {
  const matrix = useMemo(() => deriveReviewMatrix(submitted, liveQuestions), [submitted, liveQuestions]);
  if (matrix.questions.length === 0) {
    return <p className="text-sm text-gray-500">No answers to compare yet.</p>;
  }
  return (
    <div className="space-y-6">
      <CompareRatingsGrid matrix={matrix} />
      <CompareNarrativeBrowser matrix={matrix} />
    </div>
  );
}

// Outstanding = accepted but not yet submitted — including reviewers whose
// materials haven't gone out yet (their nudge button renders disabled with a
// tooltip; the send route re-derives eligibility itself, so this is a display
// filter only). Keyed on reviewReceivedAt — the SAME signal the submitted-list
// filter below uses — so the two lists are structurally disjoint (the DTO's
// `submitted` field is derived from the same column, but sharing one signal
// here removes the dual-source fragility).
function isOutstanding(r) {
  return !r.reviewReceivedAt;
}

function OutstandingRow({ reviewer, requestId, onSent }) {
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const lastReminder = formatDate(reviewer.reminderSentAt);
  const canSend = !!reviewer.materialsSentAt;

  const handleSend = useCallback(async () => {
    setSending(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/review-manager/send-review-reminder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, suggestionId: reviewer.suggestionId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setFeedback({ ok: false, message: data.reason === 'conflict'
          ? 'Already claimed by another send — refresh to see the latest status.'
          : (data.reason || 'Failed to send reminder.') });
        return;
      }
      setFeedback({ ok: true, message: 'Reminder sent.' });
      if (onSent) onSent();
    } catch (e) {
      setFeedback({ ok: false, message: e.message || 'Failed to send reminder.' });
    } finally {
      setSending(false);
    }
  }, [requestId, reviewer.suggestionId, onSent]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3 border-b border-gray-100 last:border-b-0">
      <div className="min-w-0">
        <div className="font-semibold text-gray-900">{reviewer.name || 'Unnamed reviewer'}</div>
        {reviewer.affiliation && <div className="text-sm text-gray-600 truncate">{reviewer.affiliation}</div>}
        <div className="text-xs text-gray-400 mt-0.5">
          {Number.isInteger(reviewer.daysSinceMaterialsSent)
            ? `${reviewer.daysSinceMaterialsSent} day${reviewer.daysSinceMaterialsSent === 1 ? '' : 's'} outstanding`
            : 'Materials not yet sent'}
          {' · '}
          {reviewer.reminderCount > 0
            ? `${reviewer.reminderCount} reminder${reviewer.reminderCount === 1 ? '' : 's'} sent${lastReminder ? ` (last ${lastReminder})` : ''}`
            : 'No reminders sent yet'}
        </div>
        {feedback && (
          <div className={`text-xs mt-1 ${feedback.ok ? 'text-green-600' : 'text-amber-600'}`}>{feedback.message}</div>
        )}
      </div>
      <div className="shrink-0">
        <button
          type="button"
          onClick={handleSend}
          disabled={sending || !canSend}
          title={canSend ? 'Send a review-due reminder now' : 'Materials have not been sent to this reviewer yet'}
          className="inline-flex items-center gap-1 text-sm text-gray-700 hover:text-gray-900 border border-gray-300 rounded-lg px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {sending ? 'Sending…' : 'Send reminder now'}
        </button>
      </div>
    </div>
  );
}

export default function ReviewsTab({ requestId }) {
  const [proposal, setProposal] = useState(null);
  // Phase 2: the live admin-panel question set (or null on fetch failure —
  // fail-soft per the route; the matrix derivation falls back to
  // snapshot-order-only and marks nothing retired in that case).
  const [liveQuestions, setLiveQuestions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // View toggle for the submitted-reviews area (Phase 2). "cards" is the
  // existing, unchanged default rendering; "compare" is the new schema-free
  // matrix.
  const [view, setView] = useState('cards');

  // Monotonic fetch id: [requestId].js is a dynamic page, so switching between
  // two workbench requests re-renders this component rather than remounting it
  // — without this guard a slow response for the PREVIOUS requestId could land
  // after the current one and paint the wrong proposal's reviews.
  const fetchIdRef = useRef(0);

  const load = useCallback(async () => {
    if (!requestId) return;
    const fetchId = ++fetchIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/review-manager/reviewers?proposalId=${encodeURIComponent(requestId)}`);
      const data = await res.json().catch(() => ({}));
      if (fetchId !== fetchIdRef.current) return; // stale response — a newer load started
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Failed to load reviews (${res.status})`);
      }
      setProposal((data.proposals && data.proposals[0]) || null);
      setLiveQuestions(data.liveQuestions ?? null);
    } catch (e) {
      if (fetchId !== fetchIdRef.current) return;
      setError(e.message);
      setProposal(null);
    } finally {
      if (fetchId === fetchIdRef.current) setLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    load();
  }, [load]);

  const reviewers = proposal?.reviewers || [];
  // A submitted review is signalled by reviewReceivedAt (set on both the
  // file-upload and the staff "mark received (no file)" paths) — same signal
  // Track uses for `hasReview`.
  const submitted = reviewers
    .filter((r) => r.reviewReceivedAt)
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  // Outstanding tracking (workbench Reviews tab Phase 1): accepted reviewers
  // who have not submitted, sorted by longest-outstanding first so the
  // staffer sees who most needs a nudge.
  const outstanding = reviewers
    .filter(isOutstanding)
    .sort((a, b) => (b.daysSinceMaterialsSent ?? -1) - (a.daysSinceMaterialsSent ?? -1));
  const acceptedCount = reviewers.length;

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-6 h-6 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-3 bg-amber-50 text-amber-700 rounded-lg text-sm">
        Couldn’t load reviews: {error}
      </div>
    );
  }

  if (submitted.length === 0 && outstanding.length === 0) {
    return (
      <Card hover={false}>
        <p className="text-sm text-gray-500">
          No reviews submitted yet
          {acceptedCount > 0
            ? ` — ${acceptedCount} reviewer${acceptedCount === 1 ? '' : 's'} accepted and pending.`
            : '.'}
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {outstanding.length > 0 && (
        <Card hover={false}>
          <p className="text-sm font-semibold text-gray-900 mb-1">
            Outstanding ({outstanding.length})
          </p>
          <p className="text-xs text-gray-500 mb-2">
            Accepted reviewer{outstanding.length === 1 ? '' : 's'} who {outstanding.length === 1 ? 'has' : 'have'} not yet submitted a review.
          </p>
          <div>
            {outstanding.map((r) => (
              <OutstandingRow key={r.suggestionId} reviewer={r} requestId={requestId} onSent={load} />
            ))}
          </div>
        </Card>
      )}
      {submitted.length === 0 ? (
        <Card hover={false}>
          <p className="text-sm text-gray-500">
            No reviews submitted yet — {acceptedCount} reviewer{acceptedCount === 1 ? '' : 's'} accepted and pending.
          </p>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-gray-500">
              {submitted.length} of {acceptedCount} accepted reviewer{acceptedCount === 1 ? '' : 's'} submitted a review.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <ExportMenu proposal={proposal} submitted={submitted} liveQuestions={liveQuestions} />
              <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden text-xs">
                <button
                  type="button"
                  onClick={() => setView('cards')}
                  className={`px-3 py-1.5 ${view === 'cards' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                >
                  Cards
                </button>
                <button
                  type="button"
                  onClick={() => setView('compare')}
                  className={`px-3 py-1.5 border-l border-gray-300 ${view === 'compare' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                >
                  Compare
                </button>
              </div>
            </div>
          </div>
          {view === 'cards' ? (
            <div className="space-y-3">
              {submitted.map((r) => (
                <ReviewCard key={r.suggestionId} reviewer={r} />
              ))}
            </div>
          ) : (
            <Card hover={false}>
              <CompareView submitted={submitted} liveQuestions={liveQuestions} />
            </Card>
          )}
        </>
      )}
    </div>
  );
}
