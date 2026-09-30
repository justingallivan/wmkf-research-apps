/** @jest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ResearchPresentationMaterialsCard, { presentationMaterialsStatus } from '../../shared/components/workbench/ResearchPresentationMaterialsCard';

jest.mock('../../shared/components/Layout', () => ({
  Card: ({ children }) => <div>{children}</div>,
}));

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const VISIT = { siteVisit: { startIso: '2026-10-09T17:00:00Z' } };

function respond(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('presentationMaterialsStatus', () => {
  it.each([
    ['loading', null, null, null],
    ['unavailable', { unavailable: true }, null, 'The presentation schedule could not be loaded.'],
    ['no visit', { siteVisit: null }, null, 'Presentation not scheduled.'],
    ['visit, no collection', VISIT, null, 'Presentation scheduled · materials not requested.'],
    ['open collection', VISIT, { state: 'missing' }, 'Presentation scheduled · materials requested.'],
    ['all received, unconfirmed', VISIT, { state: 'received' }, 'Presentation scheduled · materials requested.'],
    ['ready', VISIT, { state: 'ready' }, 'Presentation scheduled · materials ready.'],
    ['closed', VISIT, { state: 'closed' }, 'Presentation scheduled · materials request closed.'],
  ])('%s', (_label, context, summary, text) => {
    expect(presentationMaterialsStatus(context, summary)?.text ?? null).toBe(text);
  });

  it('never reads a failed visit fetch as "not scheduled", even with a summary present', () => {
    expect(presentationMaterialsStatus({ unavailable: true }, { state: 'ready' }).text).toBe('The presentation schedule could not be loaded.');
  });
});

describe('ResearchPresentationMaterialsCard', () => {
  it('links every file found in each folder and marks an empty folder "Not received yet"', async () => {
    global.fetch = jest.fn(async () => respond({
      success: true,
      folderFound: true,
      slides: [
        { name: '1002903 Site Visit Presentation.pdf', webUrl: 'https://sp/slides.pdf' },
        { name: '1002903 Site Visit Presentation.pptx', webUrl: 'https://sp/slides.pptx' },
      ],
      participantBios: [],
    }));
    render(<ResearchPresentationMaterialsCard requestId={REQUEST_ID} siteVisitContext={VISIT} materialsSummary={null} />);

    expect(screen.getByText('Research Presentation Materials')).toBeInTheDocument();
    expect(screen.getByText('Presentation scheduled · materials not requested.')).toBeInTheDocument();
    const pdf = await screen.findByRole('link', { name: '1002903 Site Visit Presentation.pdf' });
    expect(pdf).toHaveAttribute('href', 'https://sp/slides.pdf');
    expect(pdf).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('link', { name: '1002903 Site Visit Presentation.pptx' })).toHaveAttribute('href', 'https://sp/slides.pptx');
    expect(screen.getByText('Participant bios').nextSibling).toHaveTextContent('Not received yet');
    expect(global.fetch).toHaveBeenCalledWith(
      `/api/workbench/site-visit/material-files?requestId=${REQUEST_ID}`,
      expect.anything(),
    );
  });

  it('shows the loading line until the listing settles', async () => {
    let resolve;
    global.fetch = jest.fn(() => new Promise((r) => { resolve = r; }));
    render(<ResearchPresentationMaterialsCard requestId={REQUEST_ID} siteVisitContext={null} materialsSummary={null} />);
    expect(screen.getByText('Checking SharePoint for materials…')).toBeInTheDocument();
    expect(screen.getByText('Checking the presentation schedule…')).toBeInTheDocument();
    resolve(respond({ success: true, folderFound: true, slides: [], participantBios: [] }));
    await waitFor(() => expect(screen.queryByText('Checking SharePoint for materials…')).not.toBeInTheDocument());
    expect(screen.getAllByText('Not received yet')).toHaveLength(2);
  });

  it('says the folders could not be read on a failed listing, not "Not received yet"', async () => {
    global.fetch = jest.fn(async () => respond({ error: 'SharePoint could not be read.' }, 502));
    render(<ResearchPresentationMaterialsCard requestId={REQUEST_ID} siteVisitContext={VISIT} materialsSummary={null} />);
    expect(await screen.findByText(/The SharePoint materials folders could not be read/)).toBeInTheDocument();
    expect(screen.queryByText('Not received yet')).not.toBeInTheDocument();
  });

  it('names a missing request folder', async () => {
    global.fetch = jest.fn(async () => respond({ success: true, folderFound: false, slides: [], participantBios: [] }));
    render(<ResearchPresentationMaterialsCard requestId={REQUEST_ID} siteVisitContext={{ siteVisit: null }} materialsSummary={null} />);
    expect(await screen.findByText('This request has no SharePoint folder yet.')).toBeInTheDocument();
    expect(screen.getByText('Presentation not scheduled.')).toBeInTheDocument();
  });
});
