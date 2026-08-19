import { useState } from 'react';
import Link from 'next/link';
import Layout, { PageHeader } from '../../shared/components/Layout';
import RequireAppAccess from '../../shared/components/RequireAppAccess';
import { CandidateCard } from '../../shared/components/reviewers/ReviewerSearchSection';
import {
  INSTITUTION_STAGE2_PRESENTATION_VERSION,
  isInstitutionStage2PresentationEnabled,
} from '../../shared/utils/institution-stage2-presentation';

const BASE_CANDIDATE = {
  affiliation: 'Recorded University',
  suggestedInstitution: 'Evidence University',
  institutionMismatch: true,
  identityStatus: 'confirmed',
  pdIdentityConfirmed: true,
  email: 'preview-only@example.invalid',
  emailSource: 'staff_verified',
  addressTrustReceipt: {
    personConfirmed: true,
    email: 'preview-only@example.invalid',
  },
  sources: ['pubmed'],
  publications: [],
};

function presentation(overrides) {
  return {
    version: INSTITUTION_STAGE2_PRESENTATION_VERSION,
    visible: true,
    relationship: 'unresolved',
    evidenceContext: 'unresolved',
    evidenceInstitution: 'Evidence University',
    recordedInstitution: 'Recorded University',
    remedies: [],
    legacyHold: false,
    ...overrides,
  };
}

export const INSTITUTION_STAGE2_SMOKE_CASES = [
  {
    key: 'compatible',
    candidate: {
      ...BASE_CANDIDATE,
      name: 'Preview Case: Compatible affiliations',
      pdIdentityConfirmed: false,
      serverIdentityReviewReason: 'identity_conflict',
      institutionPresentation: presentation({
        relationship: 'same',
        evidenceContext: 'compatible',
        kind: 'compatible',
        tone: 'neutral',
        heading: 'Affiliations appear compatible',
        detail: 'Evidence University and Recorded University resolve as compatible. Existing identity verification still requires confirmation before Invite.',
        remedies: ['confirm_identity', 'not_a_fit'],
        legacyHold: true,
      }),
    },
    actions: ['confirmIdentity', 'exclude'],
  },
  {
    key: 'additional',
    candidate: {
      ...BASE_CANDIDATE,
      name: 'Preview Case: Additional affiliation',
      institutionPresentation: presentation({
        relationship: 'same',
        evidenceContext: 'compatible_with_additional',
        kind: 'additional',
        tone: 'neutral',
        heading: 'Additional affiliation',
        detail: 'Evidence University is compatible with Recorded University; additional affiliation: Partner Institute.',
      }),
    },
    actions: [],
  },
  {
    key: 'historical',
    candidate: {
      ...BASE_CANDIDATE,
      name: 'Preview Case: Earlier affiliation',
      institutionPresentation: presentation({
        relationship: 'distinct',
        evidenceContext: 'historical_difference',
        kind: 'historical',
        tone: 'neutral',
        heading: 'Earlier affiliation',
        detail: 'Earlier work lists Evidence University; the recorded affiliation is Recorded University. No institution correction is required from this evidence alone.',
      }),
    },
    actions: [],
  },
  {
    key: 'current-conflict',
    candidate: {
      ...BASE_CANDIDATE,
      name: 'Preview Case: Current conflict',
      institutionPresentation: presentation({
        relationship: 'distinct',
        evidenceContext: 'current_conflict',
        kind: 'current_conflict',
        tone: 'warning',
        heading: 'Current affiliations conflict',
        detail: 'Current evidence lists Evidence University, while the recorded affiliation is Recorded University. Confirm the person and correct or explain the affiliation before Invite.',
        remedies: [
          'confirm_identity',
          'correct_current_institution',
          'record_joint_appointment',
          'not_a_fit',
        ],
      }),
    },
    actions: ['confirmIdentity', 'edit', 'exclude'],
  },
  {
    key: 'unresolved',
    candidate: {
      ...BASE_CANDIDATE,
      name: 'Preview Case: Unresolved comparison',
      pdIdentityConfirmed: false,
      serverIdentityReviewReason: 'identity_conflict',
      institutionPresentation: presentation({
        kind: 'unresolved',
        tone: 'neutral',
        heading: 'Institution comparison unresolved',
        detail: 'The available evidence could not establish whether Evidence University and Recorded University are compatible. This is not a confirmed mismatch.',
        remedies: ['confirm_identity', 'add_authoritative_evidence', 'not_a_fit'],
      }),
    },
    actions: ['confirmIdentity', 'exclude'],
  },
  {
    key: 'provider-failure',
    candidate: {
      ...BASE_CANDIDATE,
      name: 'Preview Case: Provider failure',
      institutionPresentation: presentation({
        kind: 'provider_failure',
        tone: 'warning',
        heading: 'Institution comparison unavailable',
        detail: 'The institution service could not compare Evidence University with Recorded University. Retry enrichment; this is not a confirmed mismatch.',
        remedies: ['retry_enrichment'],
      }),
    },
    actions: ['retryInstitution'],
  },
];

function InstitutionStage2Smoke() {
  const [actionLog, setActionLog] = useState([]);
  const flagEnabled = isInstitutionStage2PresentationEnabled();

  function recordAction(testCase, action) {
    setActionLog((current) => [
      ...current,
      `${testCase.candidate.name}: ${action}`,
    ]);
  }

  return (
    <Layout title="Stage II Institution Presentation Smoke">
      <div className="mb-4">
        <Link href="/workbench" className="text-sm text-gray-500 hover:text-gray-700">
          ← Back to Request Workbench
        </Link>
      </div>
      <PageHeader
        title="Stage II Institution Presentation Smoke"
        subtitle="Synthetic Preview cases rendered by the production reviewer candidate card."
      />

      <dl className="mb-6 grid gap-3 border-y border-gray-200 bg-white px-4 py-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-gray-500">Data</dt>
          <dd className="font-medium text-gray-900">Synthetic fixtures</dd>
        </div>
        <div>
          <dt className="text-gray-500">Persistence</dt>
          <dd className="font-medium text-gray-900">None</dd>
        </div>
        <div>
          <dt className="text-gray-500">Stage II flag</dt>
          <dd className={`font-medium ${flagEnabled ? 'text-emerald-700' : 'text-red-700'}`}>
            {flagEnabled ? 'On' : 'Off'}
          </dd>
        </div>
      </dl>

      <div className="space-y-5">
        {INSTITUTION_STAGE2_SMOKE_CASES.map((testCase) => {
          const supports = (action) => testCase.actions.includes(action);
          return (
            <section key={testCase.key} data-testid={`stage2-case-${testCase.key}`}>
              <CandidateCard
                candidate={testCase.candidate}
                checked={false}
                onToggle={() => {}}
                readOnly
                onConfirmIdentity={supports('confirmIdentity')
                  ? () => recordAction(testCase, 'Confirm identity')
                  : undefined}
                onEdit={supports('edit')
                  ? () => recordAction(testCase, 'Edit affiliation')
                  : undefined}
                onExclude={supports('exclude')
                  ? () => recordAction(testCase, 'Not a fit')
                  : undefined}
                onRetryInstitution={supports('retryInstitution')
                  ? () => recordAction(testCase, 'Retry enrichment')
                  : undefined}
              />
            </section>
          );
        })}
      </div>

      <div
        className="sticky bottom-3 mt-6 border border-gray-300 bg-white px-4 py-3 text-sm shadow-sm"
        aria-live="polite"
        data-testid="stage2-action-log"
      >
        <span className="font-medium text-gray-900">Local actions: {actionLog.length}</span>
        <span className="ml-2 text-gray-600">
          {actionLog[actionLog.length - 1] || 'No action selected'}
        </span>
      </div>
    </Layout>
  );
}

export default function InstitutionStage2SmokeGuard() {
  return (
    <RequireAppAccess appKey="reviewers">
      <InstitutionStage2Smoke />
    </RequireAppAccess>
  );
}

export async function getServerSideProps() {
  if (process.env.VERCEL_ENV !== 'preview') {
    return { notFound: true };
  }
  return { props: {} };
}
