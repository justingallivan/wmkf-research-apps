/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import ResearchPresentationFollowUp from '../../shared/components/workbench/ResearchPresentationFollowUp.js';

jest.mock('../../shared/components/Layout', () => ({ Card: ({ children }) => <div>{children}</div> }));

test('renders loading, unavailable, loaded-empty, Zoom, SharePoint transcript, and summary states truthfully', () => {
  const view = render(<ResearchPresentationFollowUp status="loading" />);
  expect(screen.getByText('Loading presentation materials…')).toBeInTheDocument();
  view.rerender(<ResearchPresentationFollowUp status="unavailable" />);
  expect(screen.getByRole('alert')).toHaveTextContent('Presentation materials could not be loaded.');
  view.rerender(<ResearchPresentationFollowUp status="loaded" materials={[]} />);
  expect(screen.getAllByText('Not added yet')).toHaveLength(3);

  view.rerender(<ResearchPresentationFollowUp status="loaded" materials={[
    { artifactType: 100000005, filename: 'Zoom recording', backing: 'external', externalUrl: 'https://zoom.us/rec/share/x?pwd=y' },
    { artifactType: 100000006, filename: 'transcript.pdf', backing: 'file', webUrl: 'https://tenant.sharepoint.com/transcript.pdf' },
    { artifactType: 100000007, filename: 'summary.docx', backing: 'file', webUrl: 'https://tenant.sharepoint.com/summary.docx' },
  ]} />);
  expect(screen.getByRole('link', { name: 'Watch recording' })).toHaveAttribute('href', 'https://zoom.us/rec/share/x?pwd=y');
  expect(screen.getByRole('link', { name: 'Open transcript' })).toHaveAttribute('href', 'https://tenant.sharepoint.com/transcript.pdf');
  expect(screen.getByRole('link', { name: 'Open transcript summary' })).toHaveAttribute('href', 'https://tenant.sharepoint.com/summary.docx');
});

test('disabled projection does not masquerade as an empty collection', () => {
  const { container } = render(<ResearchPresentationFollowUp status="disabled" materials={[]} />);
  expect(container).toBeEmptyDOMElement();
});
