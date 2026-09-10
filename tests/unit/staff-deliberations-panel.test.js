/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import StaffDeliberationsPanel from '../../shared/components/workbench/StaffDeliberationsPanel';

jest.mock('next/link', () => function MockLink({ children, href }) {
  return <a href={href}>{children}</a>;
});

let visitExpectedFeed = true;
jest.mock('../../shared/utils/deliberation-stage', () => ({
  ...jest.requireActual('../../shared/utils/deliberation-stage'),
  visitExpected: () => visitExpectedFeed,
}));

const STAGE_LABELS = { draft: 'AI draft ready', shared: 'Shared', visit: 'Visit', final: 'Final' };

function artifact(overrides = {}) {
  return {
    artifactId: 'a1',
    requestId: 'r1',
    requestNumber: '1002959',
    title: 'Drafted proposal',
    institution: 'U',
    programDirector: 'PD',
    isCurrent: true,
    operationLabel: 'Ready',
    lifecycleLabel: 'Draft',
    stage: 'draft',
    substate: 'ready',
    visit: { status: 'not-scheduled', startIso: null },
    everSent: false,
    siteVisit: null,
    file: { webUrl: 'https://sp/doc.docx', name: 'doc.docx', metadataStatus: 'unchecked' },
    ...overrides,
  };
}

function mockResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

beforeEach(() => {
  visitExpectedFeed = true;
  global.fetch = jest.fn();
});

it('renders the stage sentence, session and visit lines, and a plain Open document link (no registry block or metadata cue)', async () => {
  global.fetch.mockResolvedValue(mockResponse({
    success: true,
    cycleCode: 'D26',
    scope: 'all',
    stageLabels: STAGE_LABELS,
    counts: { draft: 1, shared: 0, visit: 0, final: 0 },
    artifacts: [artifact()],
  }));
  render(<StaffDeliberationsPanel cycleCode="D26" loadingCycles={false} scope="all" />);

  const link = await screen.findByRole('link', { name: 'Open document →' });
  expect(link).toHaveAttribute('href', 'https://sp/doc.docx');
  expect(screen.queryByText(/has not been checked/)).not.toBeInTheDocument();
  expect(screen.queryByText('Ready')).not.toBeInTheDocument();
  expect(screen.getByTestId('deliberations-stage-sentence'))
    .toHaveTextContent('Review and edit the AI draft in Word, then share it for the deliberation session.');
  expect(screen.getByTestId('deliberations-session-line')).toHaveTextContent('Deliberation session: not yet scheduled.');
  expect(screen.getByTestId('deliberations-visit-line')).toHaveTextContent('Visit not scheduled.');
});

it('a scheduled session renders its date and time in the session\'s own time zone', async () => {
  global.fetch.mockResolvedValue(mockResponse({
    success: true,
    cycleCode: 'D26',
    scope: 'all',
    stageLabels: STAGE_LABELS,
    counts: { draft: 0, shared: 1, visit: 0, final: 0 },
    artifacts: [artifact({
      stage: 'shared',
      substate: 'sent',
      sharedAtIso: '2026-09-10T16:03:28Z',
      session: { scheduledStartIso: '2026-12-01T18:00:00Z', scheduledEndIso: null, ianaTimeZone: 'America/Los_Angeles', meetingLink: null, location: null },
    })],
  }));
  render(<StaffDeliberationsPanel cycleCode="D26" loadingCycles={false} scope="all" />);

  const line = await screen.findByTestId('deliberations-session-line');
  expect(line).toHaveTextContent(/^Deliberation session: .*Dec 1, 2026.*10:00.*AM\.$/);
  expect(screen.getByTestId('deliberations-stage-sentence'))
    .toHaveTextContent(`Shared on ${new Date('2026-09-10T16:03:28Z').toLocaleDateString()}. The deliberation email has gone out`);
});

it('guards a missing artifact.visit and renders "Visit not scheduled." instead of crashing', async () => {
  const rowWithoutVisit = artifact();
  delete rowWithoutVisit.visit;
  global.fetch.mockResolvedValue(mockResponse({
    success: true,
    cycleCode: 'D26',
    scope: 'all',
    stageLabels: STAGE_LABELS,
    counts: { draft: 1, shared: 0, visit: 0, final: 0 },
    artifacts: [rowWithoutVisit],
  }));
  render(<StaffDeliberationsPanel cycleCode="D26" loadingCycles={false} scope="all" />);

  expect(await screen.findByTestId('deliberations-visit-line')).toHaveTextContent('Visit not scheduled.');
});

it('puts a row with an unknown stage in a trailing "Other" block instead of dropping it', async () => {
  global.fetch.mockResolvedValue(mockResponse({
    success: true,
    cycleCode: 'D26',
    scope: 'all',
    stageLabels: STAGE_LABELS,
    counts: { draft: 0, shared: 0, visit: 0, final: 0 },
    artifacts: [artifact({ stage: 'beyond', substate: 'unknown-lifecycle', lifecycleLabel: 'Board Ready' })],
  }));
  render(<StaffDeliberationsPanel cycleCode="D26" loadingCycles={false} scope="all" />);

  expect(await screen.findByText(/#1002959/)).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Other' })).toBeInTheDocument();
});

it('when visitExpected() is false, the visit line is hidden at draft/shared but not at visit/final (discriminating fixture)', async () => {
  visitExpectedFeed = false;
  global.fetch.mockResolvedValue(mockResponse({
    success: true,
    cycleCode: 'D26',
    scope: 'all',
    stageLabels: STAGE_LABELS,
    counts: { draft: 1, shared: 1, final: 1 }, // service omits 'visit' when not expected
    artifacts: [
      artifact({ artifactId: 'a-draft', requestNumber: '1', stage: 'draft' }),
      artifact({ artifactId: 'a-shared', requestNumber: '2', stage: 'shared', substate: 'not-sent' }),
      artifact({
        artifactId: 'a-visit',
        requestNumber: '3',
        stage: 'visit',
        substate: 'awaiting-observations',
        visit: { status: 'visited', startIso: '2020-01-01T00:00:00Z' },
      }),
    ],
  }));
  render(<StaffDeliberationsPanel cycleCode="D26" loadingCycles={false} scope="all" />);

  await screen.findByText(/#1/);
  // No anticipatory visit line at draft/shared; the visited row states the
  // real date in its stage sentence instead of a separate line.
  expect(screen.queryAllByTestId('deliberations-visit-line')).toHaveLength(0);
  const sentences = screen.getAllByTestId('deliberations-stage-sentence');
  expect(sentences[2]).toHaveTextContent(`Visited ${new Date('2020-01-01T00:00:00Z').toLocaleDateString()}. Add your site-visit edits`);
  // The lead line omits the visit stop entirely rather than showing "0 visit".
  expect(screen.getByText('1 ai draft ready · 1 shared · 1 final')).toBeInTheDocument();
});

test('cycle-view rails read the draft substate on the first stop (S503)', async () => {
  global.fetch.mockResolvedValue(mockResponse({
    success: true,
    cycleCode: 'D26',
    scope: 'all',
    stageLabels: STAGE_LABELS,
    counts: { draft: 3, shared: 0, visit: 0, final: 0 },
    artifacts: [
      artifact({ artifactId: 'a-none', requestNumber: '1', stage: 'draft', substate: 'none', file: null }),
      artifact({ artifactId: 'a-gen', requestNumber: '2', stage: 'draft', substate: 'generating', file: null }),
      artifact({ artifactId: 'a-ready', requestNumber: '3', stage: 'draft', substate: 'ready' }),
    ],
  }));
  render(<StaffDeliberationsPanel cycleCode="D26" loadingCycles={false} scope="all" />);

  await screen.findByText(/#3/);
  const rails = screen.getAllByTestId('stage-rail');
  expect(rails.map((rail) => rail.textContent)).toEqual([
    expect.stringContaining('● No draft yet'),
    expect.stringContaining('● Generating draft'),
    expect.stringContaining('● AI draft ready'),
  ]);
});
