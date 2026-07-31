/**
 * @jest-environment jsdom
 *
 * CandidateEditModal LOCAL mode (the Find/Workbench card manual-contact edit,
 * docs/REVIEWER_CONTACT_LEADS_SPEC.md follow-up). When `onApply` is provided the
 * modal hands the changed fields to the parent (which stamps manual provenance)
 * instead of PATCHing /my-candidates, and the Name field is locked so a rename
 * can't desync the name-keyed Find card.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CandidateEditModal from '../../shared/components/reviewers/CandidateEditModal';

const candidate = { name: 'Javier Martinez', affiliation: 'MIT', email: 'wrong@gmail.com', website: '', hIndex: 31 };

afterEach(() => { if (global.fetch && global.fetch.mockRestore) global.fetch.mockRestore(); });

describe('CandidateEditModal — local (onApply) mode', () => {
  test('Save emits only changed fields to onApply and does NOT PATCH', async () => {
    const onApply = jest.fn();
    const onClose = jest.fn();
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) });

    render(<CandidateEditModal candidate={candidate} onApply={onApply} onClose={onClose} nameEditable={false} />);
    fireEvent.change(screen.getByDisplayValue('wrong@gmail.com'), { target: { value: 'real@mit.edu' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(onApply).toHaveBeenCalledWith({ email: 'real@mit.edu' }));
    expect(fetchSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  test('the Name field is read-only in local mode', () => {
    render(<CandidateEditModal candidate={candidate} onApply={jest.fn()} onClose={jest.fn()} nameEditable={false} />);
    expect(screen.getByDisplayValue('Javier Martinez')).toHaveAttribute('readonly');
  });

  test('local-mode footer flags the manual address as unverified / quick-check', () => {
    render(<CandidateEditModal candidate={candidate} onApply={jest.fn()} onClose={jest.fn()} nameEditable={false} />);
    expect(screen.getByText(/marked unverified.*quick check.*before any invitation/i)).toBeInTheDocument();
  });

  test('no changes → just closes, no onApply', async () => {
    const onApply = jest.fn();
    const onClose = jest.fn();
    render(<CandidateEditModal candidate={candidate} onApply={onApply} onClose={onClose} nameEditable={false} />);
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onApply).not.toHaveBeenCalled();
  });

  test('saved mode (no onApply) still PATCHes /my-candidates', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) });
    const onSaved = jest.fn();
    render(<CandidateEditModal candidate={{ ...candidate, suggestionId: 'S1' }} onClose={jest.fn()} onSaved={onSaved} />);
    fireEvent.change(screen.getByDisplayValue('wrong@gmail.com'), { target: { value: 'real@mit.edu' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith('/api/reviewer-finder/my-candidates', expect.objectContaining({ method: 'PATCH' })));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  test('a fresh conflict disclosure offers both addresses and verifies the chosen side', async () => {
    const onVerifyAddress = jest.fn(async () => {});
    render(<CandidateEditModal
      candidate={{
        ...candidate,
        addressConflict: {
          storedEmail: 'stored@example.edu',
          foundEmail: 'found@example.edu',
        },
      }}
      onApply={jest.fn()}
      onVerifyAddress={onVerifyAddress}
      requireAddressVerification
      onClose={jest.fn()}
      nameEditable={false}
    />);

    fireEvent.click(screen.getByRole('button', { name: /use found: found@example.edu/i }));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getAllByPlaceholderText('https://...')[0], {
      target: { value: 'https://example.edu/paper' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(onVerifyAddress).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'found@example.edu' }),
      expect.objectContaining({
        evidenceType: 'publication_corresponding_author',
        evidenceUrl: 'https://example.edu/paper',
      }),
    ));
  });
});

describe('CandidateEditModal — identity confirmation', () => {
  test('awaits server confirmation and stays open with an error when it fails', async () => {
    const onClose = jest.fn();
    const onConfirm = jest.fn(async () => { throw new Error('Confirmation could not be recorded'); });
    render(<CandidateEditModal
      candidate={candidate}
      onClose={onClose}
      onConfirm={onConfirm}
      confirmMode
      nameEditable={false}
    />);

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /add to candidates/i }));

    await waitFor(() => expect(screen.getByText('Confirmation could not be recorded')).toBeInTheDocument());
    expect(onConfirm).toHaveBeenCalledWith({
      email: 'wrong@gmail.com', website: '', affiliation: 'MIT',
    }, {
      evidenceType: 'publication_corresponding_author', evidenceUrl: null, note: null,
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});
