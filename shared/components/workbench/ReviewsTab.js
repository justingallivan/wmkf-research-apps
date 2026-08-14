/**
 * ReviewsTab — the Reviews tab inside the Request Workbench (tier-3).
 *
 * Read surface for submitted reviews. Structured ratings, categorical answers,
 * and narratives come from the `wmkf_appreviewanswer` snapshot; affiliation and
 * receipt/file metadata come from `wmkf_appreviewersuggestion`. This renders each
 * submitted reviewer, their answers, receipt state, and any SharePoint download.
 *
 * Reuses the existing GET `/api/review-manager/reviewers?proposalId=<guid>`,
 * which projects the snapshot-derived rating fields and `reviewer.answers[]`.
 * Ratings decode through `labelForReviewRating` — the same schema the form wrote;
 * rich-text answers render as sanitized HTML (the route re-sanitizes server-side
 * immediately before this read, so the bytes here are trusted).
 *
 * Phase 2 (docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md) adds a "Compare" view
 * toggle alongside the default "Cards" rendering above — a schema-free ratings
 * grid + per-question narrative browser derived via `deriveReviewMatrix`
 * (shared/utils/review-matrix.js) from the same `reviewer.answers[]` plus the
 * route's `liveQuestions` (the live admin-panel question set, or null on a
 * fetch failure). "Cards" stays byte-identical to the pre-Phase-2 rendering.
 *
 * Phase 3 (panel-prep export) adds a Word export affordance to the submitted-
 * reviews toolbar via `composeReviewReport` +
 * `shared/utils/review-report-docx.js`, composed client-side from the same
 * already-loaded `submitted`/`liveQuestions` data — no new fetch, no new
 * route, no Dataverse roll-up column (governing decision 4 in the plan doc).
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Card } from '../Layout';
import { labelForReviewRating, reviewRatingShortLabels } from '../../../lib/external/review-form-schema';
import { deriveReviewMatrix } from '../../utils/review-matrix';
import { composeReviewReport } from '../../utils/review-report';
import { generateReviewReportDocx } from '../../utils/review-report-docx';
import ManualReviewEntryForm from './ManualReviewEntryForm';
import { isTerminalReviewStatus } from '../../config/reviewerStatus';

function formatDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function reviewerAffiliationOf(reviewer) {
  const acceptedAffiliation = typeof reviewer?.reviewerAffiliation === 'string'
    ? reviewer.reviewerAffiliation.trim()
    : '';
  const personAffiliation = typeof reviewer?.affiliation === 'string'
    ? reviewer.affiliation.trim()
    : '';
  return acceptedAffiliation || personAffiliation || null;
}

// Reviews tab rating order, and the projection field that holds each value.
const RATING_KEYS = ['riskLevel', 'overallAssessment'];
const PROJECTION_FIELD = {
  riskLevel: 'reviewerRiskLevel',
  overallAssessment: 'reviewerOverallAssessment',
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
  const affiliation = reviewerAffiliationOf(reviewer);
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
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-gray-100 pt-3">
        {RATING_KEYS.map((k) => (
          <RatingCell key={k} fieldKey={k} value={reviewer[PROJECTION_FIELD[k]]} />
        ))}
      </div>
      <AnswerDetails answers={reviewer.answers} />
    </Card>
  );
}

// Every answered question from the answer snapshot, in question order —
// including the rating picklists (owner decision 2026-08-09: no question is
// skipped in the numbered flow; the RISK/OVERALL cells above remain as a
// quick-scan summary). HTML is rendered as-is because the API re-sanitizes on
// read (the stored value was sanitized on write, and the route is the trusted
// server boundary immediately before this render).
function AnswerDetails({ answers }) {
  const details = (answers || []).filter(
    (a) => (a.questionType === 'richtext' && a.answerHtml && a.answerHtml.trim().length > 0)
      || a.questionType === 'multiselect'
      || a.questionType === 'picklist',
  );
  if (details.length === 0) return null;
  return (
    <div className="mt-4 border-t border-gray-100 pt-3 space-y-4">
      {details.map((a) => (
        <div key={a.questionKey || a.questionOrder}>
          <div className="text-xs font-semibold text-gray-700">{a.questionText}</div>
          {a.questionType === 'richtext' ? (
            <div
              className="prose prose-sm max-w-none text-gray-800 mt-1"
              dangerouslySetInnerHTML={{ __html: a.answerHtml }}
            />
          ) : a.questionType === 'picklist' ? (
            <div className="text-sm text-gray-800 mt-1">
              {a.answerText || 'Not provided'}
            </div>
          ) : a.answerValuesUnreadable ? (
            <div className="text-sm text-amber-700 mt-1">Unreadable answer</div>
          ) : (
            <div className="flex flex-wrap gap-1.5 mt-1">
              {(a.answerValues || []).map((pair) => (
                <span key={`${pair.value}:${pair.label}`} className="text-xs rounded-full bg-gray-100 text-gray-700 px-2 py-1">
                  {pair.label}
                </span>
              ))}
            </div>
          )}
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

function CompareCategoricalSelections({ matrix }) {
  const questions = matrix.questions.filter((q) => q.type === 'multiselect');
  if (questions.length === 0) return null;
  return (
    <div className="space-y-5">
      {questions.map((question) => (
        <div key={question.key}>
          <div className="text-sm font-semibold text-gray-900">{question.text}</div>
          <div className="mt-2 space-y-2">
            {(question.tallies || []).map((tally) => (
              <div key={`${tally.value}:${tally.label}`} className="rounded-lg border border-gray-100 p-3">
                <div className="text-sm text-gray-900">
                  {tally.label} <span className="text-gray-500">({tally.count})</span>
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {tally.reviewers.map((reviewer) => reviewer.name || 'Unnamed reviewer').join(', ')}
                </div>
              </div>
            ))}
            {question.cells.filter((cell) => cell.answerValuesUnreadable).map((cell) => {
              const reviewer = matrix.reviewers.find((candidate) => candidate.suggestionId === cell.suggestionId);
              return (
                <div key={cell.suggestionId} className="text-xs text-amber-700">
                  {reviewer?.name || 'Unnamed reviewer'}: Unreadable answer
                </div>
              );
            })}
          </div>
        </div>
      ))}
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
// a plain report object (`composeReviewReport`), then hands it to the Word
// renderer. Proposal identity fields come from whatever `proposals[0]`
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const synthesisCurrent = proposal?.reviewSynthesisState?.current ?? null;

  const buildReport = useCallback(() => {
    const matrix = deriveReviewMatrix(submitted, liveQuestions);
    return composeReviewReport({
      requestNumber: proposal?.requestNumber ?? null,
      requestTitle: proposal?.proposalTitle ?? null,
      piName: proposal?.proposalAuthors ?? null,
      institution: proposal?.proposalInstitution ?? null,
      matrix,
      generatedAtIso: new Date().toISOString(),
      // Phase 4: include the stored AI synthesis when present (additive —
      // omitting it keeps the export byte-identical to the Phase 3 shape).
      synthesis: proposal?.reviewSynthesis ?? null,
      synthesisCurrent,
    });
  }, [proposal, submitted, liveQuestions, synthesisCurrent]);

  const filenameBase = `reviews-${proposal?.requestNumber || proposal?.proposalId || 'export'}-${yyyymmdd(new Date())}`;

  const handleWordExport = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const report = buildReport();
      const blob = await generateReviewReportDocx(report);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${filenameBase}.docx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message || 'Failed to generate Word document.');
    } finally {
      setBusy(false);
    }
  }, [buildReport, filenameBase]);

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500">Export:</span>
      <button
        type="button"
        onClick={handleWordExport}
        disabled={busy}
        className="text-xs text-gray-700 hover:text-gray-900 border border-gray-300 rounded-lg px-2.5 py-1 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {busy ? 'Generating…' : 'Word (.docx)'}
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
      <CompareCategoricalSelections matrix={matrix} />
      <CompareNarrativeBrowser matrix={matrix} />
    </div>
  );
}

// AI synthesis of submitted reviews (Phase 4). Rendered ONLY when at least one
// review is submitted (caller gates this). Values are LLM output — rendered
// as plain text nodes (NO dangerouslySetInnerHTML) per the plan's rendering
// contract. `synthesis` is the stored `proposal.reviewSynthesis` (fail-soft
// parsed server-side, or null when never generated / parse failed).
function SynthesisCard({ requestId, synthesis, state, reviewers = [], onUpdated }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const automaticInFlight = state?.status === 'queued' || state?.status === 'running';
  const canGenerate = state?.canRunManually === true && !automaticInFlight;

  const generate = useCallback(async (overwrite) => {
    const confirmEarly = state?.ready !== true;
    if (confirmEarly) {
      const confirmed = window.confirm(
        `Generate before every participating reviewer is resolved? `
        + `${state?.submittedCount || 0} review(s) are submitted and `
        + `${state?.blockingCount || 0} reviewer(s) remain unresolved.`,
      );
      if (!confirmed) return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/review-manager/synthesize-reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId,
          overwrite: !!overwrite,
          confirmEarly,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        if (data.writtenToDynamics === true) {
          await onUpdated?.();
        }
        setError(
          data.reason === 'no_submitted_reviews'
            ? 'No submitted reviews to synthesize.'
            : data.reason === 'already_exists'
              ? 'A synthesis already exists — use Regenerate to replace it.'
              : data.reason === 'early_confirmation_required'
                ? 'Confirm early generation before synthesizing unresolved reviews.'
                : data.reason === 'tracking_completion_failed'
                  ? 'The synthesis was saved, but its generation status could not be recorded. Refresh before retrying.'
              : (data.reason || 'Failed to generate synthesis.'),
        );
        return;
      }
      if (onUpdated) onUpdated();
    } catch (e) {
      setError(e.message || 'Failed to generate synthesis.');
    } finally {
      setBusy(false);
    }
  }, [requestId, state, onUpdated]);

  const statusText = (() => {
    if (automaticInFlight) {
      return state.status === 'running'
        ? 'Automatic synthesis is generating.'
        : 'Automatic synthesis is queued.';
    }
    if (state?.status === 'failed') {
      return state.lastError
        ? `Latest generation failed: ${state.lastError}`
        : 'Latest generation failed.';
    }
    if (synthesis && state?.current) return 'Current for the participating reviews shown below.';
    if (synthesis) return 'Stored synthesis is stale or predates lifecycle tracking.';
    if (state?.ready) return 'All participating reviewers are resolved; synthesis is ready.';
    if (state?.canRunManually) {
      return `${state.blockingCount || 0} participating reviewer(s) remain unresolved. Early generation requires confirmation.`;
    }
    return 'At least one submitted review is required before synthesis.';
  })();

  return (
    <Card hover={false}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-gray-900">AI Synthesis</p>
        <div className="flex items-center gap-2">
          {synthesis && (
            <span className={`text-[10px] uppercase tracking-wide rounded-full px-2 py-1 ${
              state?.current
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-amber-50 text-amber-700'
            }`}>
              {state?.current ? 'Current' : 'Stale'}
            </span>
          )}
          <button
            type="button"
            onClick={() => generate(!!synthesis)}
            disabled={busy || !canGenerate}
            title={!state?.canRunManually
              ? 'A submitted review is required'
              : automaticInFlight
                ? 'Automatic synthesis is already in progress'
                : undefined}
            className="text-xs text-gray-700 hover:text-gray-900 border border-gray-300 rounded-lg px-2.5 py-1 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? 'Generating…' : synthesis ? 'Regenerate' : 'Generate synthesis'}
          </button>
        </div>
      </div>
      <p className={`text-xs mt-2 ${
        state?.status === 'failed' || (synthesis && !state?.current)
          ? 'text-amber-700'
          : 'text-gray-500'
      }`}>
        {statusText}
      </p>
      {error && <p className="text-xs text-amber-600 mt-2">{error}</p>}
      {!synthesis ? (
        <p className="text-sm text-gray-500 mt-2">No synthesis generated yet.</p>
      ) : (
        <div className="mt-3 space-y-3 text-sm">
          {reviewers.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-700">Reviewers</div>
              <ul className="mt-1 space-y-0.5 text-gray-800">
                {reviewers.map((reviewer) => {
                  const affiliation = reviewerAffiliationOf(reviewer);
                  return (
                    <li key={reviewer.suggestionId}>
                      <span className="font-medium text-gray-900">
                        {reviewer.name || 'Unnamed reviewer'}
                      </span>
                      {affiliation ? ` — ${affiliation}` : ' — Affiliation not reported'}
                    </li>
                  );
                })}
              </ul>
              {state?.current !== true && (
                <p className="text-xs text-amber-700 mt-1">
                  This roster reflects current submitted reviews; the stale synthesis below may reflect an earlier reviewer set.
                </p>
              )}
            </div>
          )}
          {synthesis.consensus?.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-700">Consensus</div>
              <ul className="list-disc list-inside text-gray-800 mt-1 space-y-0.5">
                {synthesis.consensus.map((item, i) => <li key={i}>{item}</li>)}
              </ul>
            </div>
          )}
          {synthesis.disagreements?.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-700">Disagreements</div>
              <ul className="list-disc list-inside text-gray-800 mt-1 space-y-0.5">
                {synthesis.disagreements.map((item, i) => <li key={i}>{item}</li>)}
              </ul>
            </div>
          )}
          {synthesis.keyConcerns?.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-700">Key concerns</div>
              <ul className="list-disc list-inside text-gray-800 mt-1 space-y-0.5">
                {synthesis.keyConcerns.map((item, i) => <li key={i}>{item}</li>)}
              </ul>
            </div>
          )}
          {synthesis.ratingSummaries?.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-700">Rating summaries</div>
              <div className="mt-1 space-y-1">
                {synthesis.ratingSummaries.map((rs, i) => (
                  <div key={rs.questionKey || i}>
                    <span className="font-medium text-gray-900">{rs.questionText || rs.questionKey}: </span>
                    <span className="text-gray-800">{rs.summary}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {synthesis.overall && (
            <div>
              <div className="text-xs font-semibold text-gray-700">Overall</div>
              <p className="text-gray-800 mt-1">{synthesis.overall}</p>
            </div>
          )}
        </div>
      )}
    </Card>
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
  return !r.reviewReceivedAt && !isTerminalReviewStatus(r.reviewStatus);
}

function OutstandingRow({ reviewer, requestId, onSent, onManualEntry }) {
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const lastReminder = formatDate(reviewer.reminderSentAt);
  const canSend = !!reviewer.materialsSentAt;
  const affiliation = reviewerAffiliationOf(reviewer);

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
        const messages = {
          conflict: 'Already claimed by another send — refresh to see the latest status.',
          removed: 'This reviewer was removed from the proposal — restore them first.',
          revoked: "This reviewer's access was withdrawn — reissue their link before sending a reminder.",
          not_found: 'This reviewer is no longer available — refresh to update the list.',
          read_failed: "Couldn't verify this reviewer's latest status. No reminder was sent; try again.",
          prepare_failed: 'Could not prepare the reminder. No reminder was sent; try again.',
        };
        setFeedback({ ok: false, message: messages[data.reason] || 'Failed to send reminder.' });
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
        {affiliation && <div className="text-sm text-gray-600 truncate">{affiliation}</div>}
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
      <div className="shrink-0 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleSend}
          disabled={sending || !canSend}
          title={canSend ? 'Send a review-due reminder now' : 'Materials have not been sent to this reviewer yet'}
          className="inline-flex items-center gap-1 text-sm text-gray-700 hover:text-gray-900 border border-gray-300 rounded-lg px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {sending ? 'Sending…' : 'Send reminder now'}
        </button>
        <button
          type="button"
          onClick={() => onManualEntry(reviewer)}
          className="inline-flex items-center gap-1 text-sm text-gray-700 hover:text-gray-900 border border-gray-300 rounded-lg px-3 py-1.5"
        >
          Enter review manually
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
  const [manualEntry, setManualEntry] = useState(null);

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

  const handleManualSubmitted = useCallback(async () => {
    await load();
    setManualEntry(null);
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
  const manualEntryReviewer = manualEntry?.requestId === requestId
    ? manualEntry.reviewer
    : null;

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
      <div className="space-y-4">
        <Card hover={false}>
          <p className="text-sm text-gray-500">
            No reviews submitted yet
            {acceptedCount > 0
              ? ` — ${acceptedCount} reviewer${acceptedCount === 1 ? '' : 's'} accepted and pending.`
              : '.'}
          </p>
        </Card>
        <SynthesisCard
          requestId={requestId}
          synthesis={proposal?.reviewSynthesis ?? null}
          state={proposal?.reviewSynthesisState ?? null}
          reviewers={submitted}
          onUpdated={load}
        />
      </div>
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
              <OutstandingRow
                key={r.suggestionId}
                reviewer={r}
                requestId={requestId}
                onSent={load}
                onManualEntry={(reviewer) => setManualEntry({ requestId, reviewer })}
              />
            ))}
          </div>
        </Card>
      )}
      {manualEntryReviewer && (
        <ManualReviewEntryForm
          key={manualEntryReviewer.suggestionId}
          reviewer={manualEntryReviewer}
          onCancel={() => setManualEntry(null)}
          onSubmitted={handleManualSubmitted}
        />
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
      <SynthesisCard
        requestId={requestId}
        synthesis={proposal?.reviewSynthesis ?? null}
        state={proposal?.reviewSynthesisState ?? null}
        reviewers={submitted}
        onUpdated={load}
      />
    </div>
  );
}
