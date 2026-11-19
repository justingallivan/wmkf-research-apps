/**
 * Proposal lists staff page — a mutation that finishes after staff switch
 * cycles must not repaint the page with the earlier cycle's links.
 *
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProposalLists from '../../shared/components/proposal-lists/ProposalLists';

jest.mock('next/router', () => ({ useRouter: () => ({ isReady: true, query: { cycle: 'J27' } }) }));
jest.mock('../../shared/components/Layout', () => ({
  __esModule: true,
  Button: ({ children, variant, size, loading, ...props }) => <button {...props} disabled={props.disabled || loading}>{children}</button>,
  Card: ({ children }) => <div>{children}</div>,
}));

const json = (body, ok = true) => ({ ok, status: ok ? 200 : 409, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => 'application/json' } });

function overview(cycle, links) {
  return {
    success: true,
    overview: {
      cycleCode: cycle, listKind: 'ordinary', meetingDate: '2027-06-09', expiresAt: '2027-06-10T08:00:00.000Z',
      sectionSource: { placeholder: true, label: 'Placeholder.' }, self: null,
      recipients: [{ rosterId: 7, name: 'Board Member', email: 'board@example.org' }],
      links,
    },
  };
}
const link = (name) => ({ id: `id-${name}`, recipientName: name, recipientEmail: `${name}@example.org`.toLowerCase(), url: 'https://x/external/proposal-list/t', itemCount: 2, highlightedCount: 0, expiresAt: '2027-06-10T08:00:00.000Z' });

test('a create that finishes after a cycle switch reloads the cycle now shown', async () => {
  let finishCreate;
  const reads = [];
  global.fetch = jest.fn((url, init = {}) => {
    if (init.method === 'POST') return new Promise((resolve) => { finishCreate = () => resolve(json({ success: true, link: link('Created') })); });
    reads.push(String(url));
    return Promise.resolve(String(url).includes('cycle=D27')
      ? json(overview('D27', [link('DecemberPerson')]))
      : json(overview('J27', [link('JunePerson')])));
  });

  render(<ProposalLists />);
  expect(await screen.findByText('JunePerson')).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Board member'), { target: { value: '7' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create list' }));
  await waitFor(() => expect(finishCreate).toBeInstanceOf(Function));

  fireEvent.change(screen.getByLabelText('Cycle'), { target: { value: 'D27' } });
  expect(await screen.findByText('DecemberPerson')).toBeInTheDocument();

  await act(async () => { finishCreate(); });
  await waitFor(() => expect(reads.at(-1)).toContain('cycle=D27'));
  expect(screen.getByText('DecemberPerson')).toBeInTheDocument();
  expect(screen.queryByText('JunePerson')).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Lists for D27' })).toBeInTheDocument();
});
