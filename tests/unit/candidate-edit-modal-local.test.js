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

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByText(/Evidence checked/i)).not.toBeInTheDocument();
    expect(screen.getByText(/shared person record/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /replace with found@example.edu/i }));
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(onVerifyAddress).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'found@example.edu' }),
      expect.objectContaining({
        evidenceType: 'staff_address_choice',
        evidenceUrl: null,
        note: null,
      }),
    ));
  });

  test('email-choice dialog explains prior AkoyaGO use without treating it as email proof', () => {
    render(<CandidateEditModal
      candidate={{
        ...candidate,
        addressConflict: {
          storedEmail: 'stored@example.edu',
          foundEmail: 'found@example.edu',
        },
        contactEnrichment: {
          dataverseContactEvidence: {
            priorRequestContext: {
              complete: true,
              totalCount: 1,
              requests: [{
                requestId: '22222222-2222-2222-2222-222222222222',
                requestNumber: '1002278',
                title: 'Deciphering the role of the secretome in aging',
                fiscalYear: 'June 2026',
                meetingDate: '2026-06-04',
              }],
            },
          },
        },
      }}
      onApply={jest.fn()}
      onVerifyAddress={jest.fn()}
      requireAddressVerification
      onClose={jest.fn()}
      nameEditable={false}
    />);

    expect(screen.getByText(/previously listed this person on #1002278 \(June 2026\)/i)).toBeInTheDocument();
    expect(screen.getByText(/does not establish which email is current/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /keep stored@example.edu/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /replace with found@example.edu/i })).toBeInTheDocument();
    expect(screen.queryByText(/2022|Admin/i)).not.toBeInTheDocument();
  });

  test('requires an explicit conflict choice and stays open when the request reloads', async () => {
    const onClose = jest.fn();
    const onVerifyAddress = jest.fn(async () => false);
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
      onClose={onClose}
      nameEditable={false}
    />);

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(await screen.findByText(/Choose whether to keep the stored address/i)).toBeInTheDocument();
    expect(onVerifyAddress).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /keep stored@example.edu/i }));
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(await screen.findByText(/request reloaded while you were reviewing it/i)).toBeInTheDocument();
    expect(onVerifyAddress).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'stored@example.edu' }),
      { evidenceType: 'staff_address_choice', evidenceUrl: null, note: null },
    );
    expect(onClose).not.toHaveBeenCalled();
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

  test('combines identity confirmation with the same explicit email choice', async () => {
    const onClose = jest.fn();
    const onConfirm = jest.fn(async () => true);
    render(<CandidateEditModal
      candidate={{
        ...candidate,
        addressConflict: {
          storedEmail: 'stored@example.edu',
          foundEmail: 'found@example.edu',
        },
      }}
      onClose={onClose}
      onConfirm={onConfirm}
      onVerifyAddress={jest.fn()}
      requireAddressVerification
      confirmMode
      nameEditable={false}
    />);

    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /replace with found@example.edu/i }));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /add to candidates/i }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'found@example.edu' }),
      { evidenceType: 'staff_address_choice', evidenceUrl: null, note: null },
    ));
    expect(onClose).toHaveBeenCalled();
  });
});
