/**
 * @jest-environment jsdom
 *
 * AwardeeTab (chunk 3d) — staff orchestration: load recipients → generate
 * abstract → send invite. Drives the three grantee-deliverables endpoints.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AwardeeTab from '../../shared/components/workbench/AwardeeTab';

const REQ = '11111111-1111-1111-1111-111111111111';

const CYCLE_CTX = { cycleCode: 'J26', cycleLabel: 'June 2026' };

function wireFetch({ generateOk = true, sendOk = true, websiteOk = true } = {}) {
  global.fetch = jest.fn(async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('/grantee-deliverables/recipients')) {
      return { ok: true, json: async () => ({
        pi: { name: 'Monika Raj', email: 'monika.raj@emory.edu', hasEmail: true },
        liaison: { name: 'Lorena McLaren', email: 'lorena.mclaren@emory.edu', hasEmail: true },
      }) };
    }
    if (u.includes('/grantee-deliverables/generate')) {
      return generateOk
        ? { ok: true, json: async () => ({ abstractFormatted: 'The team will study the thing in a long enough abstract.', status: 100000000 }) }
        : { ok: false, json: async () => ({ error: 'no applicant abstract' }) };
    }
    if (u.includes('/grantee-deliverables/send-invite')) {
      return sendOk
        ? { ok: true, json: async () => ({ ok: true, status: 100000001 }) }
        : { ok: false, json: async () => ({ error: 'send failed' }) };
    }
    if (u.includes('/grantee-deliverables/website-html')) {
      return websiteOk
        ? { ok: true, json: async () => ({ requestId: REQ, html: '<article class="grantee-award"><strong>Emory University</strong></article>' }) }
        : { ok: false, json: async () => ({ error: 'no request found' }) };
    }
    throw new Error(`unexpected fetch ${u}`);
  });
}

afterEach(() => { if (global.fetch?.mockRestore) global.fetch.mockRestore(); });

test('loads recipients on mount and pre-fills To/Cc', async () => {
  wireFetch();
  render(<AwardeeTab requestId={REQ} />);
  await waitFor(() => expect(screen.getByLabelText('To email')).toHaveValue('monika.raj@emory.edu'));
  expect(screen.getByLabelText('Cc email')).toHaveValue('lorena.mclaren@emory.edu');
  expect(screen.getByText(/Status:/)).toHaveTextContent('Not started');
  // Send disabled until an abstract is generated
  expect(screen.getByRole('button', { name: /send invitation/i })).toBeDisabled();
});

test('generate shows the abstract, sets status Drafted, and flips the button to Regenerate', async () => {
  wireFetch();
  render(<AwardeeTab requestId={REQ} />);
  await waitFor(() => expect(screen.getByLabelText('To email')).toHaveValue('monika.raj@emory.edu'));

  fireEvent.click(screen.getByRole('button', { name: /generate abstract/i }));
  await waitFor(() => expect(screen.getByLabelText('Formatted abstract')).toBeInTheDocument());
  expect(screen.getByText(/Status:/)).toHaveTextContent('Drafted');
  expect(screen.getByRole('button', { name: /regenerate abstract/i })).toBeInTheDocument();
});

test('full flow: generate then send → status Invited + confirmation', async () => {
  wireFetch();
  render(<AwardeeTab requestId={REQ} />);
  await waitFor(() => expect(screen.getByLabelText('To email')).toHaveValue('monika.raj@emory.edu'));

  fireEvent.click(screen.getByRole('button', { name: /generate abstract/i }));
  await waitFor(() => expect(screen.getByLabelText('Formatted abstract')).toBeInTheDocument());

  const sendBtn = screen.getByRole('button', { name: /send invitation/i });
  expect(sendBtn).toBeEnabled();
  fireEvent.click(sendBtn);
  await waitFor(() => expect(screen.getByText(/invitation sent/i)).toBeInTheDocument());
  expect(screen.getByText(/Status:/)).toHaveTextContent('Invited');

  // verify the send payload carried the confirmed To/Cc + subject
  const sendCall = global.fetch.mock.calls.find(([u]) => String(u).includes('/send-invite'));
  expect(JSON.parse(sendCall[1].body)).toMatchObject({
    requestId: REQ, toEmail: 'monika.raj@emory.edu', ccEmail: 'lorena.mclaren@emory.edu',
  });
});

test('a generation error surfaces and leaves Send disabled', async () => {
  wireFetch({ generateOk: false });
  render(<AwardeeTab requestId={REQ} />);
  await waitFor(() => expect(screen.getByLabelText('To email')).toHaveValue('monika.raj@emory.edu'));
  fireEvent.click(screen.getByRole('button', { name: /generate abstract/i }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/no applicant abstract/i));
  expect(screen.getByRole('button', { name: /send invitation/i })).toBeDisabled();
});

// --- Deliverable outputs (chunk 8 b/c) ---

test('Copy website HTML fetches the fragment, shows it, and copies to clipboard', async () => {
  wireFetch();
  const writeText = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByLabelText('To email')).toHaveValue('monika.raj@emory.edu'));

  fireEvent.click(screen.getByRole('button', { name: /copy website html/i }));
  await waitFor(() => expect(screen.getByLabelText('Website HTML')).toBeInTheDocument());
  expect(screen.getByLabelText('Website HTML').value).toContain('Emory University');
  expect(writeText).toHaveBeenCalledWith(expect.stringContaining('grantee-award'));
  expect(screen.getByText(/copied to the clipboard/i)).toBeInTheDocument();

  const call = global.fetch.mock.calls.find(([u]) => String(u).includes('/website-html'));
  expect(String(call[0])).toContain(`requestId=${REQ}`);
});

test('Copy website HTML still shows the fragment when the clipboard API is unavailable', async () => {
  wireFetch();
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: jest.fn().mockRejectedValue(new Error('blocked')) },
    configurable: true,
  });
  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByLabelText('To email')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: /copy website html/i }));
  await waitFor(() => expect(screen.getByLabelText('Website HTML')).toBeInTheDocument());
  expect(screen.getByText(/select the text below to copy/i)).toBeInTheDocument();
});

test('a website-html error surfaces and no fragment is shown', async () => {
  wireFetch({ websiteOk: false });
  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByLabelText('To email')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: /copy website html/i }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/no request found/i));
  expect(screen.queryByLabelText('Website HTML')).not.toBeInTheDocument();
});

test('Cycle export link targets the cycle-export route for the request cycle', async () => {
  wireFetch();
  render(<AwardeeTab requestId={REQ} context={CYCLE_CTX} />);
  await waitFor(() => expect(screen.getByLabelText('To email')).toBeInTheDocument());
  const link = screen.getByRole('link', { name: /cycle export/i });
  expect(link).toHaveAttribute('href', '/api/workbench/grantee-deliverables/cycle-export?cycleCode=J26');
  expect(link).toHaveTextContent('June 2026');
  expect(link).toHaveAttribute('target', '_blank');
});

test('Cycle export is unavailable (no link) when the request has no June/December cycle', async () => {
  wireFetch();
  render(<AwardeeTab requestId={REQ} context={{ cycleCode: null }} />);
  await waitFor(() => expect(screen.getByLabelText('To email')).toBeInTheDocument());
  expect(screen.queryByRole('link', { name: /cycle export/i })).not.toBeInTheDocument();
  expect(screen.getByText(/cycle export unavailable/i)).toBeInTheDocument();
});
