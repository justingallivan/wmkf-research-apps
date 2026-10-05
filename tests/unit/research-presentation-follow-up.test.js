/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import ResearchPresentationFollowUp from '../../shared/components/workbench/ResearchPresentationFollowUp.js';

jest.mock('../../shared/components/Layout', () => ({ Card: ({ children }) => <div>{children}</div> }));

test('renders loading, unavailable, loaded-empty, Zoom, SharePoint transcript, and summary states truthfully', () => {
  const view = render(<ResearchPresentationFollowUp status="loading" />);
  expect(screen.getByText('Loading presentation materials…')).toBeInTheDocument();
  view.rerender(<ResearchPresentationFollowUp status="unavailable" />);
  expect(screen.getByRole('alert')).toHaveTextContent('Presentation materials could not be loaded.');
  view.rerender(<ResearchPresentationFollowUp status="loaded" materials={[]} />);
  expect(screen.getAllByText('Not added yet')).toHaveLength(5);

  view.rerender(<ResearchPresentationFollowUp status="loaded" materials={[
    { artifactType: 100000005, filename: 'Zoom recording', backing: 'external', externalUrl: 'https://zoom.us/rec/share/x?pwd=y' },
    { artifactType: 100000006, filename: 'transcript.pdf', backing: 'file', webUrl: 'https://tenant.sharepoint.com/transcript.pdf' },
    { artifactType: 100000012, filename: 'presentation.txt', backing: 'file', webUrl: 'https://tenant.sharepoint.com/presentation.txt' },
    { artifactType: 100000013, filename: 'discussion.txt', backing: 'file', webUrl: 'https://tenant.sharepoint.com/discussion.txt' },
    { artifactType: 100000007, filename: 'summary.docx', backing: 'file', webUrl: 'https://tenant.sharepoint.com/summary.docx' },
  ]} />);
  expect(screen.getByRole('link', { name: 'Watch recording' })).toHaveAttribute('href', 'https://zoom.us/rec/share/x?pwd=y');
  expect(screen.getByRole('link', { name: 'Open transcript' })).toHaveAttribute('href', 'https://tenant.sharepoint.com/transcript.pdf');
  expect(screen.getByRole('link', { name: 'Open presentation transcript' })).toHaveAttribute('href', 'https://tenant.sharepoint.com/presentation.txt');
  expect(screen.getByRole('link', { name: 'Open staff discussion transcript' })).toHaveAttribute('href', 'https://tenant.sharepoint.com/discussion.txt');
  expect(screen.getByRole('link', { name: 'Open presentation summary' })).toHaveAttribute('href', 'https://tenant.sharepoint.com/summary.docx');
});

test('disabled projection does not masquerade as an empty collection', () => {
  const { container } = render(<ResearchPresentationFollowUp status="disabled" materials={[]} />);
  expect(container).toBeEmptyDOMElement();
});

describe('inline presentation summary', () => {
  const summaryRow = { artifactType: 100000007, filename: 'summary.txt', backing: 'file', webUrl: 'https://tenant.sharepoint.com/summary.txt' };
  const TEXT = 'What was presented\nQuantum dots for imaging.\n\nQuestions and answers\nAsked about cost.\n\nOpen points\nNone noted.';

  test('shows the first section with Read more, then the whole text', () => {
    render(<ResearchPresentationFollowUp status="loaded" materials={[summaryRow]}
      summary={{ text: TEXT, stale: false, publishedAt: '2026-10-05T15:00:00Z' }} />);
    const block = screen.getByTestId('presentation-summary-text');
    expect(block).toHaveTextContent('Quantum dots for imaging.');
    expect(block).not.toHaveTextContent('Asked about cost.');
    expect(block).not.toHaveTextContent('earlier transcript version');
    fireEvent.click(screen.getByRole('button', { name: 'Read more' }));
    expect(block).toHaveTextContent('Asked about cost.');
    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true');
  });

  test('a stale summary says the Board link no longer shows it', () => {
    render(<ResearchPresentationFollowUp status="loaded" materials={[summaryRow]}
      summary={{ text: TEXT, stale: true, publishedAt: '2026-10-05T15:00:00Z' }} />);
    expect(screen.getByTestId('presentation-summary-text')).toHaveTextContent('from an earlier transcript version; the Board link no longer shows it');
  });

  test('no inline block without a summary row, and only the link when the text could not be read', () => {
    const view = render(<ResearchPresentationFollowUp status="loaded" materials={[]} summary={{ text: TEXT, stale: false, publishedAt: null }} />);
    expect(screen.queryByTestId('presentation-summary-text')).not.toBeInTheDocument();
    view.rerender(<ResearchPresentationFollowUp status="loaded" materials={[summaryRow]} summary={{ text: null, stale: false, publishedAt: null }} />);
    expect(screen.queryByRole('button', { name: 'Read more' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open presentation summary' })).toBeInTheDocument();
  });
});

