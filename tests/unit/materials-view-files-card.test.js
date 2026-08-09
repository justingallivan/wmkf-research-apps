/**
 * MaterialsView FilesCard visibility.
 *
 * The proposal-materials card exists for the stage2b authoring view only.
 * After submission the reviewer no longer needs the proposal, so the whole
 * card — downloads included — is hidden (owner decision 2026-08-09,
 * superseding the S328 behavior that kept existing files downloadable).
 * That covers both the server-known submitted state (return visit) and the
 * just-submitted state signalled by the form's onSubmitted callback.
 *
 * @jest-environment jsdom
 */

import { render, screen, fireEvent } from '@testing-library/react';
import MaterialsView from '../../shared/components/external/MaterialsView';

jest.mock('../../shared/components/external/ReviewAuthoringForm', () => ({
  __esModule: true,
  default: ({ onSubmitted }) => (
    <button data-testid="authoring-form" onClick={onSubmitted}>submit</button>
  ),
}));

function baseData(overrides = {}) {
  return {
    proposal: { title: 'To Explore the Universe' },
    reviewer: { name: 'Test Case' },
    reviewDeadline: '2026-09-09',
    files: [],
    submission: null,
    ...overrides,
  };
}

const TOKEN = 'test-token';

describe('MaterialsView FilesCard', () => {
  test('authoring view with no files shows the awaiting-materials prompt', () => {
    render(<MaterialsView data={baseData()} token={TOKEN} />);
    expect(screen.getByText(/hasn't shared materials for this review yet/i)).toBeInTheDocument();
    expect(screen.getByTestId('authoring-form')).toBeInTheDocument();
  });

  test('submission deadline shows the review due date as a local calendar date', () => {
    render(<MaterialsView data={baseData()} token={TOKEN} />);
    // 2026-09-09 must render as September 9 in EVERY timezone — a UTC parse
    // would show September 8 west of UTC.
    expect(screen.getByText('September 9, 2026')).toBeInTheDocument();
  });

  test('submission deadline falls back to a dash without a review due date', () => {
    render(<MaterialsView data={baseData({ reviewDeadline: null })} token={TOKEN} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  test('submitted view with no files hides the materials card entirely', () => {
    render(
      <MaterialsView
        data={baseData({ submission: { receivedAt: '2026-07-04T17:26:56Z' } })}
        token={TOKEN}
      />,
    );
    expect(screen.queryByText(/hasn't shared materials/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/proposal materials/i)).not.toBeInTheDocument();
    expect(screen.getByText(/review received/i)).toBeInTheDocument();
  });

  test('submitted notice names the Program Director with a mailto link when provided', () => {
    render(
      <MaterialsView
        data={baseData({
          submission: { receivedAt: '2026-07-04T17:26:56Z' },
          programDirector: { name: 'Jane Director', email: 'jane.director@wmkeck.org' },
        })}
        token={TOKEN}
      />,
    );
    expect(screen.getByText(/please contact your Program Director/i))
      .toHaveTextContent('Program Director (Jane Director, jane.director@wmkeck.org)');
    expect(screen.getByRole('link', { name: 'jane.director@wmkeck.org' }))
      .toHaveAttribute('href', 'mailto:jane.director@wmkeck.org');
  });

  test('submitted notice keeps the generic guidance without Program Director contact', () => {
    render(
      <MaterialsView
        data={baseData({ submission: { receivedAt: '2026-07-04T17:26:56Z' } })}
        token={TOKEN}
      />,
    );
    expect(screen.getByText(/please contact your Program Director/i))
      .not.toHaveTextContent('(');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  test('submitted view hides the materials card even when files exist', () => {
    render(
      <MaterialsView
        data={baseData({
          submission: { receivedAt: '2026-07-04T17:26:56Z' },
          files: [{ id: 'f1', library: 'lib1', name: 'proposal.pdf' }],
        })}
        token={TOKEN}
      />,
    );
    expect(screen.queryByText(/proposal materials/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/proposal\.pdf/i)).not.toBeInTheDocument();
    expect(screen.getByText(/review received/i)).toBeInTheDocument();
  });

  test('submitting in-page hides the materials card without a refetch', () => {
    render(
      <MaterialsView
        data={baseData({ files: [{ id: 'f1', library: 'lib1', name: 'proposal.pdf' }] })}
        token={TOKEN}
      />,
    );
    expect(screen.getByText(/proposal\.pdf/i)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('authoring-form')); // form signals onSubmitted
    expect(screen.queryByText(/proposal\.pdf/i)).not.toBeInTheDocument();
    // The form (showing its own success banner) stays mounted — the server
    // hasn't been refetched, so SubmittedNotice must NOT replace it.
    expect(screen.getByTestId('authoring-form')).toBeInTheDocument();
  });
});
