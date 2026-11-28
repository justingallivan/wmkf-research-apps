/**
 * Request Workbench Overview. In the phase layout it reads top to bottom:
 * request snapshot (with the short title), abstract with the applicant's summary
 * answers folded under it, Executive Summary (read-first), keywords, documents
 * (staff version visible, the rest folded), reviewer counts (folded), and last the
 * next-step card, which stays mounted because its reads feed the stage strip.
 * The legacy layout keeps its original order.
 */

import { useEffect } from 'react';
import { Card } from '../Layout';
import { StatusBadge } from './StatusTab';
import J27Overview from './J27Overview';
import RequestNarrativesCard from './RequestNarrativesCard';
import { OverviewDocuments } from './ProposalTab';
import { ApplicantAnswers, KeywordsCard } from './IntakeFields';
import useReviewerProgress from './useReviewerProgress';

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const money = (n) => (typeof n === 'number' && Number.isFinite(n) ? USD.format(n) : '—');

// wmkf_meetingdate is DateOnly: it parses as UTC midnight, so format in UTC
// or viewers west of UTC see the day before.
// The linked Grant Cycle's calendar Board date; no cycle or no date is "Not set".
function formatMeetingDate(iso) {
  if (!iso) return 'Not set';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function Field({ label, children }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className="text-sm text-gray-900">{children ?? '—'}</dd>
    </div>
  );
}

function Section({ title, action, children, embedded }) {
  const Container = embedded ? 'section' : Card;
  return (
    <Container {...(embedded ? {} : { hover: false })}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        {action}
      </div>
      {children}
    </Container>
  );
}

function TabLink({ onSelectTab, tab, children }) {
  if (!onSelectTab) return <span className="text-sm text-gray-400">{children}</span>;
  return (
    <button type="button" onClick={() => onSelectTab(tab)} className="text-sm font-medium text-indigo-600 hover:underline">
      {children}
    </button>
  );
}

// AI artifacts present on the request (each deep-links to the Proposal tab).
function aiArtifacts(ai = {}) {
  return [
    ['Fit rationale', ai.fitRationale],
    ['Summary', ai.summary],
    ['Extracted data', ai.dataExtract],
    ['Field primer', ai.fieldPrimer],
  ].map(([label, v]) => ({ label, present: !!v }));
}

function ReviewerProgress({ state, showHint }) {
  if (state.status === 'loading') return <p className="text-sm text-gray-500">Loading reviewer progress…</p>;
  if (state.status === 'error') return <p className="text-sm text-amber-600">Couldn’t load reviewer progress.</p>;

  const { counts, needed, hint } = state.data;
  const n = (v) => (Number.isFinite(v) ? v : 0);

  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Field label="Candidates">{n(counts.candidates)}</Field>
        <Field label="Invited">{n(counts.invited)}</Field>
        <Field label="Accepted">{Number.isFinite(needed) ? `${n(counts.accepted)} / ${needed}` : n(counts.accepted)}</Field>
        <Field label={showHint ? "Complete" : "Closed out"}>{n(counts.completed)}</Field>
      </dl>
      {showHint && hint && <p className="text-sm text-gray-600">{hint}</p>}
    </div>
  );
}

export default function OverviewTab({ context, requestId, onSelectTab, j27Handoffs, initialRationaleEnabled, chairsRecommendationEnabled, meetingRosterEnabled, onJ27Facts = null, reviewerProgress: pageProgress = null }) {
  // A 2027-or-later request page loads the rollup itself and reports it to the
  // strip (C7 amendment, 2026-11-12); this tab then reads that state and fetches nothing.
  const ownProgress = useReviewerProgress(pageProgress ? null : requestId);
  const reviewerProgress = pageProgress || ownProgress;
  // Step E: the page recomputes the J27 stage once the rollup settles (plan C7).
  useEffect(() => {
    if (!pageProgress && onJ27Facts && requestId && reviewerProgress.status !== 'loading') onJ27Facts(requestId, { progress: reviewerProgress });
  }, [pageProgress, onJ27Facts, requestId, reviewerProgress]);
  const info = context?.proposalInfo || {};
  const coPIs = Array.isArray(info.coPIs) ? info.coPIs : [];
  const artifacts = aiArtifacts(context?.aiContent);
  const anyArtifact = artifacts.some((a) => a.present);

  const snapshotFields = context && (
    <dl className="grid sm:grid-cols-2 gap-4">
      <Field label="Principal Investigator">{info.pi}</Field>
      <Field label="Co-Investigators">{coPIs.length ? coPIs.join(', ') : '—'}</Field>
      <Field label="Institution">{context.institution}</Field>
      <Field label="Board Meeting">{formatMeetingDate(context.meetingDate)}</Field>
      <Field label="Requested Amount">{money(info.requestedAmount)}</Field>
      <Field label="Total Project Budget">{money(info.totalProjectBudget)}</Field>
      <Field label="Program">{context.grantProgram}</Field>
      <Field label={j27Handoffs ? "Recorded request status" : "Status"}>
        {context.requestStatus ? (
          <span className="inline-flex items-center gap-2">
            {context.requestStatus}
            <StatusBadge statusClass={context.statusClass} />
          </span>
        ) : '—'}
      </Field>
    </dl>
  );

  const details = (
    <div className={j27Handoffs ? "space-y-5 divide-y divide-gray-200 [&>section+section]:pt-5" : "space-y-4"}>
      {/* Snapshot */}
      {context && <Section
        title="Request snapshot"
        embedded={j27Handoffs}
        action={!j27Handoffs && <TabLink onSelectTab={onSelectTab} tab="proposal">Open proposal →</TabLink>}
      >
        {snapshotFields}
      </Section>}

      {/* AI artifacts */}
      {context && !j27Handoffs && <Section
        title="AI content"
        action={<TabLink onSelectTab={onSelectTab} tab="proposal">View / generate →</TabLink>}
      >
        {anyArtifact ? (
          <ul className="flex flex-wrap gap-2">
            {artifacts.map((a) => {
              const chipCls = `text-xs px-2 py-1 rounded-full ${a.present ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`;
              const text = `${a.present ? '✓ ' : '— '}${a.label}`;
              return (
                <li key={a.label}>
                  {onSelectTab ? (
                    <button
                      type="button"
                      onClick={() => onSelectTab('proposal')}
                      className={`${chipCls} hover:ring-1 hover:ring-indigo-300`}
                      title={a.present ? 'Open in the Proposal tab' : 'Generate in the Proposal tab'}
                    >
                      {text}
                    </button>
                  ) : (
                    <span className={chipCls}>{text}</span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-gray-500">No AI content generated yet — open the Proposal tab to generate it.</p>
        )}
      </Section>}

      {/* Reviewers */}
      <Section
        title={j27Handoffs ? "Reviewer counts" : "Reviewers"}
        embedded={j27Handoffs}
        action={!j27Handoffs && <TabLink onSelectTab={onSelectTab} tab="reviewers">Manage reviewers →</TabLink>}
      >
        <ReviewerProgress state={reviewerProgress} showHint={!j27Handoffs} />
      </Section>
    </div>
  );
  if (!j27Handoffs) return <div className="space-y-4"><RequestNarrativesCard requestId={requestId} />{details}</div>;

  return (
    <div className="space-y-4">
      {context && (
        <Section title="Request snapshot">
          {context.intake?.shortTitle && (
            <p className="mb-4 text-sm text-gray-900"><span className="text-xs uppercase tracking-wide text-gray-400 mr-2">Short title</span>{context.intake.shortTitle}</p>
          )}
          {snapshotFields}
        </Section>
      )}
      {context && (
        <Section title="Abstract">
          <p className="text-sm text-gray-700 whitespace-pre-wrap">
            {info.abstract || <span className="text-gray-500">No abstract on the request.</span>}
          </p>
          <ApplicantAnswers intake={context.intake} />
        </Section>
      )}
      <RequestNarrativesCard requestId={requestId} readFirst />
      {context && <KeywordsCard intake={context.intake} requestId={requestId} />}
      <OverviewDocuments requestId={requestId} />
      <details className="rounded-xl border border-gray-200 bg-white p-4">
        <summary className="cursor-pointer text-sm font-semibold">Reviewer counts</summary>
        <div className="mt-4"><ReviewerProgress state={reviewerProgress} showHint={false} /></div>
      </details>
      <J27Overview key={requestId} context={context} requestId={requestId}
        reviewerProgress={reviewerProgress} onJ27Facts={onJ27Facts}
        onOpenReports={onSelectTab ? () => onSelectTab('reviews') : null}
        initialRationaleEnabled={initialRationaleEnabled} chairsRecommendationEnabled={chairsRecommendationEnabled} meetingRosterEnabled={meetingRosterEnabled} />
    </div>
  );
}
