/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import OfframpControl from '../../shared/components/workbench/OfframpControl';
import { requestJson } from '../../shared/utils/api-request';

jest.mock('../../shared/utils/api-request', () => ({ requestJson: jest.fn() }));

const requestId = 'request-1';
const base = {
  offramped: false, statusLabel: 'Phase II Pending Committee Review', canOfframp: true, canUndo: false,
  undoRestores: null, justification: '', showJustification: false, version: 'W/"1"',
};
const offramped = {
  ...base, offramped: true, statusLabel: 'Phase II Offramped', canOfframp: false, canUndo: true,
  undoRestores: 'Phase II Pending Committee Review', showJustification: true, version: 'W/"2"',
};

beforeEach(() => requestJson.mockReset());

test('renders nothing where the route is switched off', async () => {
  requestJson.mockRejectedValue(Object.assign(new Error('unavailable'), { status: 404 }));
  const { container } = render(<OfframpControl requestId={requestId} />);
  await waitFor(() => expect(container).toBeEmptyDOMElement());
});

test('marking offramped asks for confirmation, writes with the read version, and reloads the page', async () => {
  const onStatusChange = jest.fn();
  requestJson.mockResolvedValueOnce(base).mockResolvedValueOnce({ success: true }).mockResolvedValueOnce(offramped);
  render(<OfframpControl requestId={requestId} onStatusChange={onStatusChange} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Mark as offramped' }));
  expect(requestJson).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Confirm offramp' }));
  await screen.findByLabelText('Offramp justification');
  expect(requestJson).toHaveBeenNthCalledWith(2, '/api/workbench/offramp', {
    method: 'POST', body: { requestId, version: 'W/"1"', action: 'offramp' },
  });
  expect(onStatusChange).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Phase II Status returns to Phase II Pending Committee Review.')).toBeInTheDocument();
});

test('cancel leaves the request unchanged', async () => {
  requestJson.mockResolvedValueOnce(base);
  render(<OfframpControl requestId={requestId} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Mark as offramped' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('button', { name: 'Mark as offramped' })).toBeInTheDocument();
  expect(requestJson).toHaveBeenCalledTimes(1);
});

test('saving the justification posts trimmed text and does not reload the page', async () => {
  const onStatusChange = jest.fn();
  requestJson.mockResolvedValueOnce(offramped).mockResolvedValueOnce({ success: true })
    .mockResolvedValueOnce({ ...offramped, justification: 'Three Poor reviews.', version: 'W/"3"' });
  render(<OfframpControl requestId={requestId} onStatusChange={onStatusChange} />);
  fireEvent.change(await screen.findByLabelText('Offramp justification'), { target: { value: ' Three Poor reviews. ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save justification' }));
  await screen.findByText('Justification saved.');
  expect(requestJson).toHaveBeenNthCalledWith(2, '/api/workbench/offramp', {
    method: 'POST', body: { requestId, version: 'W/"2"', action: 'justification', justification: 'Three Poor reviews.' },
  });
  expect(onStatusChange).not.toHaveBeenCalled();
});

test('a conflict shows the message and re-reads the current state', async () => {
  requestJson.mockResolvedValueOnce(base)
    .mockRejectedValueOnce(Object.assign(new Error('This request changed.'), { status: 409 }))
    .mockResolvedValueOnce({ ...base, canOfframp: false, statusLabel: 'Approved', version: 'W/"5"' });
  render(<OfframpControl requestId={requestId} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Mark as offramped' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm offramp' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('This request changed.');
  await screen.findByText('This request already has a Phase II outcome, so it cannot be offramped here.');
  expect(screen.queryByRole('button', { name: 'Mark as offramped' })).not.toBeInTheDocument();
});

test('a justification conflict shows the other saved text and blocks Save until staff choose', async () => {
  requestJson.mockResolvedValueOnce({ ...offramped, justification: 'Old.' })
    .mockRejectedValueOnce(Object.assign(new Error('This request changed.'), { status: 409 }))
    .mockResolvedValueOnce({ ...offramped, justification: 'Colleague text.', version: 'W/"9"' });
  render(<OfframpControl requestId={requestId} />);
  fireEvent.change(await screen.findByLabelText('Offramp justification'), { target: { value: 'My text.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save justification' }));
  await screen.findByText('Colleague text.');
  expect(screen.getByLabelText('Offramp justification')).toHaveValue('My text.');
  expect(screen.getByRole('button', { name: 'Save justification' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Use saved justification' }));
  expect(screen.getByLabelText('Offramp justification')).toHaveValue('Colleague text.');
  expect(requestJson).toHaveBeenCalledTimes(3);
});

test('keeping the draft after a conflict saves with the new version', async () => {
  requestJson.mockResolvedValueOnce({ ...offramped, justification: 'Old.' })
    .mockRejectedValueOnce(Object.assign(new Error('This request changed.'), { status: 409 }))
    .mockResolvedValueOnce({ ...offramped, justification: 'Colleague text.', version: 'W/"9"' })
    .mockResolvedValueOnce({ success: true })
    .mockResolvedValueOnce({ ...offramped, justification: 'My text.', version: 'W/"10"' });
  render(<OfframpControl requestId={requestId} />);
  fireEvent.change(await screen.findByLabelText('Offramp justification'), { target: { value: 'My text.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save justification' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Keep my draft' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save justification' }));
  await screen.findByText('Justification saved.');
  expect(requestJson).toHaveBeenNthCalledWith(4, '/api/workbench/offramp', {
    method: 'POST', body: { requestId, version: 'W/"9"', action: 'justification', justification: 'My text.' },
  });
});
