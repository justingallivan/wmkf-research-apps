/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import TranscriptionPilotPage from '../../pages/admin/transcription-pilot';

jest.mock('../../shared/components/Layout', () => ({
  __esModule: true,
  default: ({ children }) => <div>{children}</div>,
}));

test('old pilot bookmarks show retirement without starting pilot requests or exposing uploads', () => {
  const fetchSpy = jest.spyOn(global, 'fetch');
  render(<TranscriptionPilotPage />);
  expect(screen.getByRole('heading', { name: 'Transcription Pilot has been retired' })).toBeInTheDocument();
  expect(screen.getByText(/Meeting Tracker transcription remains available/)).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(fetchSpy).not.toHaveBeenCalled();
  fetchSpy.mockRestore();
});
