/**
 * @jest-environment jsdom
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InstitutionStage2SmokeGuard, {
  getServerSideProps,
  INSTITUTION_STAGE2_SMOKE_CASES,
} from '../../pages/workbench/institution-stage2-smoke';
import { projectInstitutionStage2Presentation } from '../../lib/services/institution-affiliation-stage2';

jest.mock('../../shared/components/Layout', () => ({
  __esModule: true,
  default: ({ children }) => <main>{children}</main>,
  PageHeader: ({ title, subtitle }) => (
    <header>
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </header>
  ),
}));

jest.mock('../../shared/components/RequireAppAccess', () => ({
  __esModule: true,
  default: ({ appKey, children }) => <div data-app-key={appKey}>{children}</div>,
}));

const ORIGINAL_VERCEL_ENV = process.env.VERCEL_ENV;
const ORIGINAL_PRESENTATION_FLAG = process.env.NEXT_PUBLIC_INSTITUTION_STAGE2_PRESENTATION;
const ORIGINAL_FETCH = global.fetch;

afterEach(() => {
  if (ORIGINAL_VERCEL_ENV === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = ORIGINAL_VERCEL_ENV;
  if (ORIGINAL_PRESENTATION_FLAG === undefined) {
    delete process.env.NEXT_PUBLIC_INSTITUTION_STAGE2_PRESENTATION;
  } else {
    process.env.NEXT_PUBLIC_INSTITUTION_STAGE2_PRESENTATION = ORIGINAL_PRESENTATION_FLAG;
  }
  global.fetch = ORIGINAL_FETCH;
  jest.restoreAllMocks();
});

function projectionInput({ relationship, evidenceContext, action, remedies = [], additional = [], providerFailure = false, legacyHold = false }) {
  return {
    assessment: {
      relationship,
      evidenceContext,
      evidenceAssertion: {
        rawText: 'Evidence University',
        segments: providerFailure
          ? [{ resolution: { reason: 'provider_failure' } }]
          : [],
      },
      recordedAssertion: {
        rawText: 'Recorded University',
        segments: [],
      },
      additionalAffiliations: additional.map((rawText) => ({ rawText })),
    },
    policy: { action, remedies },
    consumer: 'candidate_card',
    legacyHold,
  };
}

test('fixtures stay identical to the production Stage II projector', () => {
  const inputs = {
    compatible: projectionInput({
      relationship: 'same',
      evidenceContext: 'compatible',
      action: 'clear_institution_warning',
      legacyHold: true,
    }),
    additional: projectionInput({
      relationship: 'same',
      evidenceContext: 'compatible_with_additional',
      action: 'show_additional_affiliation_note',
      additional: ['Partner Institute'],
    }),
    historical: projectionInput({
      relationship: 'distinct',
      evidenceContext: 'historical_difference',
      action: 'show_career_history_note',
    }),
    'current-conflict': projectionInput({
      relationship: 'distinct',
      evidenceContext: 'current_conflict',
      action: 'show_current_conflict',
      remedies: [
        'confirm_identity',
        'correct_current_institution',
        'record_joint_appointment',
        'not_a_fit',
      ],
    }),
    unresolved: projectionInput({
      relationship: 'unresolved',
      evidenceContext: 'unresolved',
      action: 'show_identity_remedy',
      remedies: ['confirm_identity', 'add_authoritative_evidence', 'not_a_fit'],
    }),
    'provider-failure': projectionInput({
      relationship: 'unresolved',
      evidenceContext: 'unresolved',
      action: 'show_retry_without_identity_hold',
      remedies: ['retry_enrichment'],
      providerFailure: true,
    }),
  };

  for (const testCase of INSTITUTION_STAGE2_SMOKE_CASES) {
    expect(testCase.candidate.institutionPresentation).toEqual(
      projectInstitutionStage2Presentation(inputs[testCase.key]),
    );
  }
});

test('server-side guard exposes the harness only in Preview', async () => {
  process.env.VERCEL_ENV = 'preview';
  await expect(getServerSideProps()).resolves.toEqual({ props: {} });

  process.env.VERCEL_ENV = 'production';
  await expect(getServerSideProps()).resolves.toEqual({ notFound: true });

  delete process.env.VERCEL_ENV;
  await expect(getServerSideProps()).resolves.toEqual({ notFound: true });
});

test('renders all Stage II cases behind reviewer access and keeps actions local', async () => {
  process.env.NEXT_PUBLIC_INSTITUTION_STAGE2_PRESENTATION = 'on';
  const user = userEvent.setup();
  global.fetch = jest.fn();

  const { container } = render(<InstitutionStage2SmokeGuard />);

  expect(container.firstChild).toHaveAttribute('data-app-key', 'reviewers');
  expect(screen.getAllByTestId('institution-stage2-presentation')).toHaveLength(
    INSTITUTION_STAGE2_SMOKE_CASES.length,
  );
  expect(screen.getByText(/This is not a confirmed mismatch/)).toBeInTheDocument();
  expect(screen.queryByText(/Institution needs review:/)).not.toBeInTheDocument();

  let clickedActions = 0;
  for (const testCase of INSTITUTION_STAGE2_SMOKE_CASES) {
    const caseRegion = screen.getByTestId(`stage2-case-${testCase.key}`);
    const notice = within(caseRegion).getByTestId('institution-stage2-presentation');
    const buttons = within(notice).queryAllByRole('button');
    expect(buttons).toHaveLength(testCase.actions.length);
    for (const button of buttons) {
      await user.click(button);
      clickedActions += 1;
    }
  }

  expect(screen.getByTestId('stage2-action-log')).toHaveTextContent(`Local actions: ${clickedActions}`);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('the exact off path suppresses every Stage II notice', () => {
  process.env.NEXT_PUBLIC_INSTITUTION_STAGE2_PRESENTATION = 'off';

  render(<InstitutionStage2SmokeGuard />);

  expect(screen.queryByTestId('institution-stage2-presentation')).not.toBeInTheDocument();
  expect(screen.getAllByText(/Institution needs review:/)).toHaveLength(
    INSTITUTION_STAGE2_SMOKE_CASES.length,
  );
});
