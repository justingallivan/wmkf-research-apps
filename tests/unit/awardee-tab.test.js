/**
 * @jest-environment jsdom
 *
 * AwardeeTab (chunk 3d) — staff orchestration: load recipients → generate
 * abstract → send invite. Drives the three grantee-deliverables endpoints.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AwardeeTab from '../../shared/components/workbench/AwardeeTab';

const REQ = '11111111-1111-1111-1111-111111111111';

function wireFetch({ generateOk = true, sendOk = true } = {}) {
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
