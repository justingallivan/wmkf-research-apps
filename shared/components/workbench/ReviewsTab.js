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
 * Panel-prep roll-up / export is a deferred add-on, intentionally out of scope.
 */

import { useState, useEffect, useCallback } from 'react';
import { Card } from '../Layout';
import { labelForReviewRating, reviewRatingShortLabels } from '../../../lib/external/review-form-schema';

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

export default function ReviewsTab({ requestId }) {
  const [proposal, setProposal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!requestId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/review-manager/reviewers?proposalId=${encodeURIComponent(requestId)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Failed to load reviews (${res.status})`);
      }
      setProposal((data.proposals && data.proposals[0]) || null);
    } catch (e) {
      setError(e.message);
      setProposal(null);
    } finally {
      setLoading(false);
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

  if (submitted.length === 0) {
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
      <p className="text-sm text-gray-500">
        {submitted.length} of {acceptedCount} accepted reviewer{acceptedCount === 1 ? '' : 's'} submitted a review.
      </p>
      <div className="space-y-3">
        {submitted.map((r) => (
          <ReviewCard key={r.suggestionId} reviewer={r} />
        ))}
      </div>
    </div>
  );
}
