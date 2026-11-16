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

test('an Undo conflict caused by a colleague justification save shows their text instead of enabling an overwrite', async () => {
  requestJson.mockResolvedValueOnce({ ...offramped, justification: 'Old.' })
    .mockRejectedValueOnce(Object.assign(new Error('This request changed.'), { status: 409 }))
    .mockResolvedValueOnce({ ...offramped, justification: 'Colleague text.', version: 'W/"9"' });
  render(<OfframpControl requestId={requestId} />);
  fireEvent.change(await screen.findByLabelText('Offramp justification'), { target: { value: 'My text.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Undo offramp' }));
  await screen.findByText('Colleague text.');
  expect(screen.getByLabelText('Offramp justification')).toHaveValue('My text.');
  expect(screen.getByRole('button', { name: 'Save justification' })).toBeDisabled();
  expect(requestJson).toHaveBeenCalledTimes(3);
});

test('after an undo the justification box disappears', async () => {
  requestJson.mockResolvedValueOnce({ ...offramped, justification: 'Saved.' })
    .mockResolvedValueOnce({ success: true })
    .mockResolvedValueOnce({ ...base, justification: 'Saved.', showJustification: false, version: 'W/"9"' });
  render(<OfframpControl requestId={requestId} onStatusChange={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Undo offramp' }));
  await screen.findByText('Offramp undone.');
  expect(screen.queryByLabelText('Offramp justification')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save justification' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Mark as offramped' })).toBeInTheDocument();
});

test('a later offramp shows the kept justification again', async () => {
  requestJson.mockResolvedValueOnce({ ...base, justification: 'Kept.' })
    .mockResolvedValueOnce({ success: true })
    .mockResolvedValueOnce({ ...offramped, justification: 'Kept.', version: 'W/"9"' });
  render(<OfframpControl requestId={requestId} onStatusChange={() => {}} />);
  expect(await screen.findByRole('button', { name: 'Mark as offramped' })).toBeInTheDocument();
  expect(screen.queryByLabelText('Offramp justification')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Mark as offramped' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm offramp' }));
  expect(await screen.findByLabelText('Offramp justification')).toHaveValue('Kept.');
  expect(screen.getByRole('button', { name: 'Save justification' })).toBeDisabled();
});

// Conflicts superseded by a later read. The later read comes from an Undo that
// meets a 409, so the request is still offramped and the box stays visible.
function conflictThenUndo409(laterJustification) {
  requestJson.mockResolvedValueOnce({ ...offramped, justification: 'Old.' })
    .mockRejectedValueOnce(Object.assign(new Error('This request changed.'), { status: 409 }))
    .mockResolvedValueOnce({ ...offramped, justification: 'Colleague text.', version: 'W/"9"' })
    .mockRejectedValueOnce(Object.assign(new Error('This request changed again.'), { status: 409 }))
    .mockResolvedValueOnce({ ...offramped, justification: laterJustification, version: 'W/"12"' });
}

test('an Undo stays available while a justification conflict is open and uses the newest version', async () => {
  conflictThenUndo409('Colleague text.');
  render(<OfframpControl requestId={requestId} />);
  fireEvent.change(await screen.findByLabelText('Offramp justification'), { target: { value: 'My text.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save justification' }));
  await screen.findByText('Someone else saved a different justification');
  fireEvent.click(screen.getByRole('button', { name: 'Undo offramp' }));
  await screen.findByText('This request changed again.');
  expect(requestJson).toHaveBeenNthCalledWith(4, '/api/workbench/offramp', {
    method: 'POST', body: { requestId, version: 'W/"9"', action: 'undo' },
  });
  expect(screen.getByLabelText('Offramp justification')).toHaveValue('My text.');
  expect(screen.getByText('Someone else saved a different justification')).toBeInTheDocument();
});

test('a later read that matches the draft closes an open conflict', async () => {
  conflictThenUndo409('My text.');
  render(<OfframpControl requestId={requestId} />);
  fireEvent.change(await screen.findByLabelText('Offramp justification'), { target: { value: 'My text.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save justification' }));
  await screen.findByText('Someone else saved a different justification');
  fireEvent.click(screen.getByRole('button', { name: 'Undo offramp' }));
  await screen.findByText('This request changed again.');
  expect(screen.queryByText('Someone else saved a different justification')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Offramp justification')).toHaveValue('My text.');
  expect(screen.getByRole('button', { name: 'Save justification' })).toBeDisabled();
});

test('a later read with newer text replaces the open conflict, and Use saved takes the newest text', async () => {
  conflictThenUndo409('Newest text.');
  render(<OfframpControl requestId={requestId} />);
  fireEvent.change(await screen.findByLabelText('Offramp justification'), { target: { value: 'My text.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save justification' }));
  await screen.findByText('Colleague text.');
  fireEvent.click(screen.getByRole('button', { name: 'Undo offramp' }));
  await screen.findByText('Newest text.');
  expect(screen.queryByText('Colleague text.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Use saved justification' }));
  expect(screen.getByLabelText('Offramp justification')).toHaveValue('Newest text.');
  expect(screen.getByRole('button', { name: 'Save justification' })).toBeDisabled();
});

test('an untouched draft follows newer text and no conflict reopens', async () => {
  conflictThenUndo409('Newest text.');
  render(<OfframpControl requestId={requestId} />);
  fireEvent.change(await screen.findByLabelText('Offramp justification'), { target: { value: 'My text.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save justification' }));
  // Taking the saved text makes the draft untouched again, so the next read replaces it.
  fireEvent.click(await screen.findByRole('button', { name: 'Use saved justification' }));
  fireEvent.click(screen.getByRole('button', { name: 'Undo offramp' }));
  await screen.findByText('This request changed again.');
  expect(screen.getByLabelText('Offramp justification')).toHaveValue('Newest text.');
  expect(screen.queryByText('Someone else saved a different justification')).not.toBeInTheDocument();
});
