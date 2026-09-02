/**
 * @jest-environment jsdom
 */

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import ReviewerManagePanel from '../../shared/components/reviewers/ReviewerManagePanel';

const REQUEST_ID = '00000000-0000-0000-0000-000000000001';
const PROPOSAL_URL = 'https://blob.vercel-storage.com/request-proposal.pdf';
const MANUAL_URL = 'https://blob.vercel-storage.com/manual-instructions.pdf';

const proposal = {
  proposalId: REQUEST_ID,
  proposalTitle: 'Proposal Under Review',
  reviewDeadline: '2026-07-22',
};

const reviewer = {
  suggestionId: '11111111-1111-1111-1111-111111111111',
  name: 'Dr. Test Reviewer',
  email: 'reviewer@example.org',
  affiliation: 'Example University',
  reviewStatus: 'accepted',
  tokenState: 'active',
};

const draft = {
  suggestionId: reviewer.suggestionId,
  candidateName: reviewer.name,
  candidateEmail: reviewer.email,
  subject: 'Review Materials',
  body: 'Please review the proposal.',
};

const files = [
  {
    name: 'Proposal.pdf',
    library: 'Active Requests',
    folder: 'REQ-1',
    classification: 'proposal',
  },
  {
    name: 'Alternate Narrative.docx',
    library: 'Archive',
    folder: 'REQ-1/Docs',
    classification: 'proposal',
  },
];

function mockJson(data, ok = true, status = ok ? 200 : 500) {
  return { ok, status, json: async () => data };
}

function mockSseResponse() {
  const chunks = [Buffer.from('event: complete\ndata: {}\n\n')];
  let index = 0;
  return {
    ok: true,
    body: {
      getReader: () => ({
        read: jest.fn(async () => {
          if (index < chunks.length) return { value: chunks[index++], done: false };
          return { done: true };
        }),
      }),
    },
  };
}

function successProposal(overrides = {}) {
  return mockJson({
    success: true,
    blobUrl: PROPOSAL_URL,
    filename: 'Proposal.pdf',
    contentType: 'application/pdf',
    size: 1234,
    picked: 'Active Requests::REQ-1::Proposal.pdf',
    allFiles: files,
    ...overrides,
  });
}

function renderPanel({
  proposalResponses = [successProposal()],
  reviewers: reviewerList = [reviewer],
  attachProposalEmail = true,
  materialsPreflight = { ok: true, fileCount: 3 },
} = {}) {
  const loadProposalResponses = [...proposalResponses];
  global.fetch.mockImplementation(async (url) => {
    if (String(url).startsWith('/api/user-preferences')) return mockJson({});
    if (url === '/api/review-manager/release-settings') return mockJson({ attachProposalEmail });
    if (String(url).startsWith('/api/review-manager/materials-preflight')) return mockJson(materialsPreflight);
    if (url === '/api/reviewer-finder/load-proposal') {
      return loadProposalResponses.shift() || successProposal();
    }
    if (url === '/api/review-manager/render-emails') return mockJson({ drafts: [draft] });
    if (url === '/api/review-manager/send-emails') return mockSseResponse();
    throw new Error(`Unexpected fetch: ${url}`);
  });

  return render(
    <ReviewerManagePanel
      proposal={proposal}
      reviewers={reviewerList}
      settings={{ signature: 'Program Director' }}
    />,
  );
}

async function openReleaseModal() {
  fireEvent.click(screen.getByRole('button', { name: /release proposal to reviewers \(1\)/i }));
  await screen.findByText('Proposal document');
}

async function previewAndSend() {
  fireEvent.click(screen.getByRole('button', { name: /preview 1 email/i }));
  const sendButton = await screen.findByRole('button', { name: /send 1 email/i });
  fireEvent.click(sendButton);
  await waitFor(() => expect(global.fetch.mock.calls.some(([url]) => url === '/api/review-manager/send-emails')).toBe(true));
}

function sentPayload() {
  const call = global.fetch.mock.calls.find(([url]) => url === '/api/review-manager/send-emails');
  return JSON.parse(call[1].body);
}

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  jest.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  window.confirm.mockRestore();
});

describe('ReviewerManagePanel proposal attachment in the materials release modal', () => {
  test('materials send includes the loaded proposal blobUrl before manual attachments', async () => {
    localStorage.setItem('review_manager_attachments', JSON.stringify({
      materials: [
        { url: MANUAL_URL, filename: 'Manual instructions.pdf' },
        { url: PROPOSAL_URL, filename: 'Duplicate proposal.pdf' },
      ],
      followup: [],
      thankyou: [],
    }));
    renderPanel();

    await openReleaseModal();
    await screen.findByText(/Will attach:/);
    expect(screen.getByText('Proposal.pdf')).toBeInTheDocument();

    await previewAndSend();

    expect(sentPayload()).toMatchObject({
      templateType: 'materials',
      attachmentUrls: [PROPOSAL_URL, MANUAL_URL],
    });
  });

  test('release modal is materials-only and cannot switch into reminder or thank-you email', async () => {
    renderPanel();

    await openReleaseModal();
    expect(screen.queryByText('Email Type')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Follow-up' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Thank You' })).not.toBeInTheDocument();

    await previewAndSend();

    expect(sentPayload()).toMatchObject({
      templateType: 'materials',
    });
  });

  test('override picker re-calls load-proposal with the selected fileKey', async () => {
    const alternateKey = 'Archive::REQ-1/Docs::Alternate Narrative.docx';
    renderPanel({
      proposalResponses: [
        successProposal(),
        successProposal({
          blobUrl: 'https://blob.vercel-storage.com/alternate-narrative.docx',
          filename: 'Alternate Narrative.docx',
          picked: alternateKey,
        }),
      ],
    });

    await openReleaseModal();
    await screen.findByText(/Will attach:/);
    fireEvent.change(screen.getByLabelText(/historical\/manual override/i), {
      target: { value: alternateKey },
    });

    await screen.findByText('Alternate Narrative.docx');
    const loadCalls = global.fetch.mock.calls.filter(([url]) => url === '/api/reviewer-finder/load-proposal');
    expect(JSON.parse(loadCalls[1][1].body)).toEqual({ requestId: REQUEST_ID, fileKey: alternateKey });
  });

  test('not-found proposal warning still allows send without proposal attachment', async () => {
    renderPanel({
      proposalResponses: [
        mockJson({ error: 'No SharePoint files found for this request.', allFiles: [] }, false, 404),
      ],
    });

    await openReleaseModal();
    expect(await screen.findByText(/No canonical reviewer proposal was found/)).toBeInTheDocument();

    await previewAndSend();

    expect(sentPayload()).toMatchObject({
      templateType: 'materials',
      attachmentUrls: [],
    });
  });
});

describe('ReviewerManagePanel release respects checkbox selection', () => {
  const acceptedA = { ...reviewer, suggestionId: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Accepted A', reviewStatus: 'accepted' };
  const acceptedB = { ...reviewer, suggestionId: 'bbbbbbbb-0000-0000-0000-000000000002', name: 'Accepted B', reviewStatus: 'accepted' };
  const pendingC = { ...reviewer, suggestionId: 'cccccccc-0000-0000-0000-000000000003', name: 'Pending C', reviewStatus: 'pending' };

  function checkboxForRow(name) {
    const row = screen.getByText(name).closest('tr');
    return within(row).getByRole('checkbox');
  }

  function recipientsSummary() {
    return screen.getAllByText(/reviewer(s)? selected/)
      .map((node) => node.closest('p'))
      .find(Boolean);
  }

  test('selecting one of several accepted reviewers releases only that subset', async () => {
    renderPanel({ reviewers: [acceptedA, acceptedB] });

    fireEvent.click(checkboxForRow('Accepted A'));

    const releaseButton = screen.getByRole('button', { name: /release proposal to reviewers \(1\)/i });
    fireEvent.click(releaseButton);
    await screen.findByText('Proposal document');

    expect(recipientsSummary().textContent).toMatch(/1 reviewer selected/);

    fireEvent.click(screen.getByRole('button', { name: /preview 1 email/i }));
    await waitFor(() => expect(global.fetch.mock.calls.some(([url]) => url === '/api/review-manager/render-emails')).toBe(true));
    const renderCall = global.fetch.mock.calls.find(([url]) => url === '/api/review-manager/render-emails');
    expect(JSON.parse(renderCall[1].body).suggestionIds).toEqual([acceptedA.suggestionId]);
  });

  test('no selection releases all accepted reviewers', async () => {
    renderPanel({ reviewers: [acceptedA, acceptedB] });

    const releaseButton = screen.getByRole('button', { name: /release proposal to reviewers \(2\)/i });
    fireEvent.click(releaseButton);
    await screen.findByText('Proposal document');

    expect(recipientsSummary().textContent).toMatch(/2 reviewers selected/);
  });

  test('only accepted reviewers awaiting materials are selectable', async () => {
    renderPanel({ reviewers: [acceptedA, pendingC] });

    expect(checkboxForRow('Accepted A')).toBeInTheDocument();
    const pendingRow = screen.getByText('Pending C').closest('tr');
    expect(within(pendingRow).queryByRole('checkbox')).not.toBeInTheDocument();

    expect(screen.queryByRole('button', { name: /send email/i })).not.toBeInTheDocument();
  });

  test('when no reviewer is awaiting materials, selection controls and generic email action are absent', () => {
    renderPanel({ reviewers: [pendingC] });

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /send email/i })).not.toBeInTheDocument();
  });
});

describe('ReviewerManagePanel one-time materials release', () => {
  test('excludes an already-released reviewer from Materials and exposes no generic email composer', () => {
    const releasedReviewer = {
      ...reviewer,
      reviewStatus: 'under_review',
      materialsSentAt: '2026-08-18T20:00:00.000Z',
    };
    renderPanel({ reviewers: [releasedReviewer] });

    const row = screen.getByText(releasedReviewer.name).closest('tr');
    expect(within(row).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /release proposal/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /send email/i })).not.toBeInTheDocument();
  });
});

describe('ReviewerManagePanel release with attach-proposal-email OFF (default)', () => {
  async function openReleaseModalOff() {
    fireEvent.click(screen.getByRole('button', { name: /release proposal to reviewers \(1\)/i }));
    await screen.findByText(/Reviewers access materials via their secure portal link/i);
  }

  test('does not show the proposal document section or the attachment file picker, and never calls load-proposal', async () => {
    renderPanel({ attachProposalEmail: false });

    await openReleaseModalOff();

    expect(screen.queryByText('Proposal document')).not.toBeInTheDocument();
    expect(screen.queryByText(/Attachments \(included in \.eml files\)/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/historical\/manual override/i)).not.toBeInTheDocument();
    expect(global.fetch.mock.calls.some(([url]) => url === '/api/reviewer-finder/load-proposal')).toBe(false);
  });

  test('sends no attachmentUrls in the send-emails payload', async () => {
    renderPanel({ attachProposalEmail: false });

    await openReleaseModalOff();
    await previewAndSend();

    expect(sentPayload()).toMatchObject({
      templateType: 'materials',
      attachmentUrls: [],
    });
  });

  test('release-settings is re-fetched (read fresh) each time the modal opens', async () => {
    let attachProposalEmail = false;
    global.fetch.mockImplementation(async (url) => {
      if (String(url).startsWith('/api/user-preferences')) return mockJson({});
      if (url === '/api/review-manager/release-settings') return mockJson({ attachProposalEmail });
      if (String(url).startsWith('/api/review-manager/materials-preflight')) return mockJson({ ok: true, fileCount: 3 });
      if (url === '/api/reviewer-finder/load-proposal') return successProposal();
      if (url === '/api/review-manager/render-emails') return mockJson({ drafts: [draft] });
      if (url === '/api/review-manager/send-emails') return mockSseResponse();
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(
      <ReviewerManagePanel
        proposal={proposal}
        reviewers={[reviewer]}
        settings={{ signature: 'Program Director' }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /release proposal to reviewers \(1\)/i }));
    await screen.findByText(/Reviewers access materials via their secure portal link/i);
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

    attachProposalEmail = true;
    fireEvent.click(screen.getByRole('button', { name: /release proposal to reviewers \(1\)/i }));
    await screen.findByText('Proposal document');
  });
});

describe('ReviewerManagePanel materials-preflight (empty SharePoint folder guard)', () => {
  test('empty reviewer-materials folder shows the amber banner and gates send with an extra confirm', async () => {
    renderPanel({ materialsPreflight: { ok: true, fileCount: 0 } });

    await openReleaseModal();
    await screen.findByText(/The expected reviewer proposal PDF is not available/i);

    fireEvent.click(screen.getByRole('button', { name: /preview 1 email/i }));
    const sendButton = await screen.findByRole('button', { name: /send 1 email/i });
    fireEvent.click(sendButton);

    await waitFor(() => expect(global.fetch.mock.calls.some(([url]) => url === '/api/review-manager/send-emails')).toBe(true));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/Release anyway\?/i));
  });

  test('non-empty reviewer-materials folder shows no banner and no extra confirm', async () => {
    renderPanel({ materialsPreflight: { ok: true, fileCount: 5 } });

    await openReleaseModal();
    await screen.findByText('Proposal document');
    expect(screen.queryByText(/The expected reviewer proposal PDF is not available/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Couldn.t verify reviewer materials availability/i)).not.toBeInTheDocument();

    await previewAndSend();
    expect(window.confirm).not.toHaveBeenCalledWith(expect.stringMatching(/Release anyway\?/i));
  });

  test('preflight check failure shows a neutral note and does not gate send', async () => {
    renderPanel({ materialsPreflight: { ok: false, reason: 'materials_unavailable' } });

    await openReleaseModal();
    await screen.findByText(/Couldn.t verify reviewer materials availability/i);
    expect(screen.queryByText(/The expected reviewer proposal PDF is not available/i)).not.toBeInTheDocument();

    await previewAndSend();
    expect(window.confirm).not.toHaveBeenCalledWith(expect.stringMatching(/Release anyway\?/i));
  });
});
