/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import DeclineFormView from '../../shared/components/external/DeclineFormView';

function renderForm() {
  const onDeclined = jest.fn(async () => {});
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ ok: true }),
  }));
  const view = render(
    <DeclineFormView
      token="test-token"
      etag={'W/"1"'}
      onCancel={jest.fn()}
      onDeclined={onDeclined}
    />,
  );
  return { onDeclined, ...view };
}

afterEach(() => {
  jest.restoreAllMocks();
});

test('renders structured referral inputs and no prose prompts', () => {
  renderForm();

  expect(screen.getByLabelText('Name as published')).toBeInTheDocument();
  expect(screen.getByLabelText('Institution')).toBeInTheDocument();
  expect(screen.getByLabelText('Email')).toBeInTheDocument();
  expect(screen.queryByText(/anything else/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/submit without explanation/i)).not.toBeInTheDocument();
  expect(document.querySelectorAll('textarea')).toHaveLength(0);
});

test('submits up to four structured people and omits blank rows', async () => {
  const { onDeclined } = renderForm();

  fireEvent.change(screen.getByLabelText('Name as published'), { target: { value: 'Sarah Chen' } });
  fireEvent.change(screen.getByLabelText('Institution'), { target: { value: 'Stanford University' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'chen@example.edu' } });
  fireEvent.click(screen.getByRole('button', { name: /add another reviewer/i }));
  fireEvent.change(screen.getAllByLabelText('Name as published')[1], { target: { value: 'Alex Rivera' } });
  fireEvent.change(screen.getAllByLabelText('Institution')[1], { target: { value: 'UCLA' } });
  fireEvent.change(screen.getByLabelText('Reason for declining'), { target: { value: 'too-busy' } });
  fireEvent.click(screen.getByRole('button', { name: 'Submit decline' }));

  await waitFor(() => expect(onDeclined).toHaveBeenCalled());
  expect(global.fetch).toHaveBeenCalledWith(
    '/api/external/review/test-token/respond',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        action: 'decline',
        decline: {
          reasonPicklist: 'too-busy',
          referrals: [
            { name: 'Sarah Chen', institution: 'Stanford University', email: 'chen@example.edu' },
            { name: 'Alex Rivera', institution: 'UCLA', email: '' },
          ],
        },
      }),
    }),
  );
});

test('allows an empty decline and blocks a partial referral without a name', async () => {
  const { unmount } = renderForm();
  fireEvent.click(screen.getByRole('button', { name: 'Submit decline' }));
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ action: 'decline', decline: {} });

  unmount();
  renderForm();
  fireEvent.change(screen.getByLabelText('Institution'), { target: { value: 'MIT' } });
  fireEvent.click(screen.getByRole('button', { name: 'Submit decline' }));
  expect(await screen.findByText(/include a name/i)).toBeInTheDocument();
  expect(global.fetch).not.toHaveBeenCalled();
});

// T5 matrix for the single POST /respond site.
test('(b) a 409 with a server message shows it verbatim', async () => {
  global.fetch = jest.fn(async () => ({ ok: false, status: 409, json: async () => ({ ok: false, message: 'Already handled by staff.' }) }));
  render(<DeclineFormView token="t" etag={null} onCancel={jest.fn()} onDeclined={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Submit decline' }));
  await screen.findByText('Already handled by staff.');
});

test('(b) a 409 with no message falls back to the generic 409 copy', async () => {
  global.fetch = jest.fn(async () => ({ ok: false, status: 409, json: async () => ({ ok: false }) }));
  render(<DeclineFormView token="t" etag={null} onCancel={jest.fn()} onDeclined={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Submit decline' }));
  await screen.findByText(/can no longer be declined online/i);
});

test('(b) a 412 shows the optimistic-lock conflict copy', async () => {
  global.fetch = jest.fn(async () => ({ ok: false, status: 412, json: async () => ({ ok: false }) }));
  render(<DeclineFormView token="t" etag={null} onCancel={jest.fn()} onDeclined={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Submit decline' }));
  await screen.findByText(/Someone else updated this invitation/i);
});

test('(b) any other non-ok status shows the generic retry copy', async () => {
  global.fetch = jest.fn(async () => ({ ok: false, status: 500, json: async () => ({ ok: false }) }));
  render(<DeclineFormView token="t" etag={null} onCancel={jest.fn()} onDeclined={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Submit decline' }));
  await screen.findByText('Could not submit your response. Please try again.');
});

test('(b) a 2xx body with ok:false is treated as a failure too (body-level flag, not status)', async () => {
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: false }) }));
  render(<DeclineFormView token="t" etag={null} onCancel={jest.fn()} onDeclined={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Submit decline' }));
  await screen.findByText('Could not submit your response. Please try again.');
});

test('(c) a network rejection shows the network-error copy', async () => {
  global.fetch = jest.fn(async () => { throw new Error('network down'); });
  render(<DeclineFormView token="t" etag={null} onCancel={jest.fn()} onDeclined={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Submit decline' }));
  await screen.findByText('Network error. Please try again.');
});

test('(d) a malformed 2xx body is tolerated to {} (today\'s `.catch(() => ({}))`) and treated as a failure', async () => {
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } }));
  render(<DeclineFormView token="t" etag={null} onCancel={jest.fn()} onDeclined={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Submit decline' }));
  await screen.findByText('Could not submit your response. Please try again.');
});

test('(e) a non-2xx unparseable body (502 gateway page) is tolerated to {} and hits the generic retry copy', async () => {
  global.fetch = jest.fn(async () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError('bad json'); } }));
  render(<DeclineFormView token="t" etag={null} onCancel={jest.fn()} onDeclined={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Submit decline' }));
  await screen.findByText('Could not submit your response. Please try again.');
});
