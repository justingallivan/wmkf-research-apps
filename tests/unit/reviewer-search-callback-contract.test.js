/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReviewerSearchSection from '../../shared/components/reviewers/ReviewerSearchSection';
import CandidateEditModal from '../../shared/components/reviewers/CandidateEditModal';
import { reviewerSaveKey } from '../../lib/utils/reviewer-save-key';

const candidate = {
  name: 'Callback Reviewer', email: 'callback@example.edu', emailSource: 'pubmed',
  emailPersistAllowed: true, identityStatus: 'probable', website: 'https://example.edu/reviewer',
  addressTrustReceipt: { receiptId: 'synthetic-receipt', personConfirmed: true, email: 'callback@example.edu' },
  provenance: { kind: 'literature_retrieved', sources: ['pubmed'], seedRole: 'query_seed', groundingWorkIds: [] },
};
const response = (data) => ({ ok: true, json: async () => data });
afterEach(() => { jest.restoreAllMocks(); });

test('one current successful promotion calls onSaved exactly once without arguments', async () => {
  const onSaved = jest.fn();
  const saveKey = reviewerSaveKey(candidate);
  global.fetch = jest.fn(async (url) => {
    if (String(url).includes('/api/workbench/reviewer-roster?')) return response({
      success: true, active: [candidate], excluded: [], ineligible: [], blocked: [], handled: [], savedKeys: [], allNames: [candidate.name],
    });
    if (url === '/api/reviewer-finder/save-candidates') return response({
      success: true, savedCount: 1, savedKeys: [saveKey],
      results: [{ index: 0, name: candidate.name, candidateKey: saveKey, outcome: 'saved' }],
    });
    throw new Error(`Unexpected mocked request: ${url}`);
  });
  render(<ReviewerSearchSection requestId="11111111-1111-4111-8111-111111111111" blobUrl="synthetic-blob" onSaved={onSaved} />);
  fireEvent.click(await screen.findByLabelText(`Select ${candidate.name}`));
  fireEvent.click(screen.getByRole('button', { name: 'Add 1 selected to Invite' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  expect(onSaved).toHaveBeenCalledWith();
  expect(screen.queryByLabelText(`Select ${candidate.name}`)).not.toBeInTheDocument();
});

// The real modal consumes these callbacks. Keep its false/throw distinction
// alongside facade wiring coverage; no mocked modal can establish this contract.
test.each([
  ['verify', 'false'], ['verify', 'throw'], ['confirm', 'false'], ['confirm', 'throw'],
])('%s callback %s keeps the modal open with actionable feedback', async (mode, outcome) => {
  const onClose = jest.fn();
  const callback = jest.fn(async () => {
    if (outcome === 'throw') throw new Error('Synthetic durable write failure');
    return false;
  });
  render(<CandidateEditModal
    candidate={candidate} nameEditable={false} onClose={onClose}
    onApply={jest.fn()} requireAddressVerification
    confirmMode={mode === 'confirm'} onConfirm={callback} onVerifyAddress={callback}
  />);
  // These labels wrap their checkboxes; all exact-person/address acknowledgments
  // are deliberately satisfied so a validation failure cannot mask the callback.
  for (const checkbox of screen.getAllByRole('checkbox')) fireEvent.click(checkbox);
  fireEvent.click(screen.getByRole('button', { name: 'Use the Website URL below' }));
  fireEvent.click(screen.getByRole('button', { name: mode === 'confirm' ? 'Add to candidates' : 'Save changes' }));
  await waitFor(() => expect(callback).toHaveBeenCalledTimes(1));
  expect(await screen.findByText(outcome === 'throw'
    ? 'Synthetic durable write failure'
    : 'This request reloaded while you were reviewing it. Re-check the current reviewer card before saving.')).toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
});

test('ordinary onApply awaits a false result and still closes, preserving its distinct existing contract', async () => {
  const onClose = jest.fn();
  const onApply = jest.fn(async () => false);
  render(<CandidateEditModal candidate={candidate} nameEditable={false} onApply={onApply} onClose={onClose} />);
  fireEvent.change(screen.getByDisplayValue(candidate.website), { target: { value: 'https://example.edu/updated' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  expect(onApply).toHaveBeenCalledWith({ website: 'https://example.edu/updated' });
});
