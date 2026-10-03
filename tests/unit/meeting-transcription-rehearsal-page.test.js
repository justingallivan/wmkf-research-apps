/** @jest-environment jsdom */

import { render, screen } from '@testing-library/react';
import TranscriptionRehearsalPage, { getServerSideProps } from '../../pages/meeting-tracker/transcription-rehearsal';
import { REHEARSAL_REQUEST_ID } from '../../lib/services/meeting-tracker-transcription/rehearsal-fixture';

jest.mock('../../lib/services/meeting-tracker-transcription/test-deployment-policy', () => ({
  isMeetingTranscriptionRehearsalReady: jest.fn(),
}));
jest.mock('../../shared/components/meeting-tracker/MeetingTranscriptionPanel', () => ({
  __esModule: true,
  default: ({ requestId, apiBasePath, reviewOnly }) => (
    <div data-testid="rehearsal-panel" data-request-id={requestId} data-api-base-path={apiBasePath} data-review-only={String(reviewOnly)} />
  ),
}));

const { isMeetingTranscriptionRehearsalReady } = require('../../lib/services/meeting-tracker-transcription/test-deployment-policy');

test('server gate returns notFound unless the dedicated rehearsal is enabled', async () => {
  isMeetingTranscriptionRehearsalReady.mockReturnValue(false);
  await expect(getServerSideProps()).resolves.toEqual({ notFound: true });

  isMeetingTranscriptionRehearsalReady.mockReturnValue(true);
  await expect(getServerSideProps()).resolves.toEqual({ props: { rehearsalEnabled: true } });
  expect(isMeetingTranscriptionRehearsalReady).toHaveBeenCalledTimes(2);
});

test('renders only the explicitly synthetic speaker-review panel on the dedicated page', () => {
  const { rerender } = render(<TranscriptionRehearsalPage rehearsalEnabled={false} />);
  expect(screen.queryByTestId('rehearsal-panel')).not.toBeInTheDocument();

  rerender(<TranscriptionRehearsalPage rehearsalEnabled />);
  expect(screen.getByRole('heading', { name: 'Synthetic speaker review' })).toBeInTheDocument();
  expect(screen.getByText(/fictional transcript.*synthetic.*does not read CRM records or meeting attendees/i)).toBeInTheDocument();
  expect(screen.getByTestId('rehearsal-panel')).toHaveAttribute('data-request-id', REHEARSAL_REQUEST_ID);
  expect(screen.getByTestId('rehearsal-panel')).toHaveAttribute('data-api-base-path', '/api/meeting-transcription-rehearsal');
  expect(screen.getByTestId('rehearsal-panel')).toHaveAttribute('data-review-only', 'true');
});
