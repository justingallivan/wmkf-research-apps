/**
 * MaterialsView FilesCard visibility (S328).
 *
 * The empty-files "hasn't shared materials yet — contact us" prompt exists
 * for the stage2b authoring view. After submission it reads as an error next
 * to the Review-received notice, so the card is hidden when submitted AND
 * empty; files that do exist stay downloadable in both states.
 *
 * @jest-environment jsdom
 */

import { render, screen } from '@testing-library/react';
import MaterialsView from '../../shared/components/external/MaterialsView';

jest.mock('../../shared/components/external/ReviewAuthoringForm', () => ({
  __esModule: true,
  default: () => <div data-testid="authoring-form" />,
}));

function baseData(overrides = {}) {
  return {
    proposal: { title: 'To Explore the Universe' },
    reviewer: { name: 'Test Case' },
    tokenExpiresAt: '2026-10-14T23:59:59Z',
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

  test('submitted view with files keeps the download list', () => {
    render(
      <MaterialsView
        data={baseData({
          submission: { receivedAt: '2026-07-04T17:26:56Z' },
          files: [{ id: 'f1', library: 'lib1', name: 'proposal.pdf' }],
        })}
        token={TOKEN}
      />,
    );
    expect(screen.getByText(/proposal materials/i)).toBeInTheDocument();
    expect(screen.getByText(/proposal\.pdf/i)).toBeInTheDocument();
  });
});
