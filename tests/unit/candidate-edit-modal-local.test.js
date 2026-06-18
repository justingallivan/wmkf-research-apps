/**
 * @jest-environment jsdom
 *
 * CandidateEditModal LOCAL mode (the Find/Workbench card manual-contact edit,
 * docs/REVIEWER_CONTACT_LEADS_SPEC.md follow-up). When `onApply` is provided the
 * modal hands the changed fields to the parent (which stamps manual provenance)
 * instead of PATCHing /my-candidates, and the Name field is locked so a rename
 * can't desync the name-keyed Find card.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import CandidateEditModal from '../../shared/components/reviewers/CandidateEditModal';

const candidate = { name: 'Javier Martinez', affiliation: 'MIT', email: 'wrong@gmail.com', website: '', hIndex: 31 };

afterEach(() => { if (global.fetch && global.fetch.mockRestore) global.fetch.mockRestore(); });

describe('CandidateEditModal — local (onApply) mode', () => {
  test('Save emits only changed fields to onApply and does NOT PATCH', () => {
    const onApply = jest.fn();
    const onClose = jest.fn();
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) });

    render(<CandidateEditModal candidate={candidate} onApply={onApply} onClose={onClose} nameEditable={false} />);
    fireEvent.change(screen.getByDisplayValue('wrong@gmail.com'), { target: { value: 'real@mit.edu' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(onApply).toHaveBeenCalledWith({ email: 'real@mit.edu' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  test('the Name field is read-only in local mode', () => {
    render(<CandidateEditModal candidate={candidate} onApply={jest.fn()} onClose={jest.fn()} nameEditable={false} />);
    expect(screen.getByDisplayValue('Javier Martinez')).toHaveAttribute('readonly');
  });

  test('local-mode footer flags the manual address as unverified / confirm-before-invite', () => {
    render(<CandidateEditModal candidate={candidate} onApply={jest.fn()} onClose={jest.fn()} nameEditable={false} />);
    expect(screen.getByText(/marked unverified.*confirm before any invitation/i)).toBeInTheDocument();
  });

  test('no changes → just closes, no onApply', () => {
    const onApply = jest.fn();
    const onClose = jest.fn();
    render(<CandidateEditModal candidate={candidate} onApply={onApply} onClose={onClose} nameEditable={false} />);
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(onApply).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  test('saved mode (no onApply) still PATCHes /my-candidates', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) });
    render(<CandidateEditModal candidate={{ ...candidate, suggestionId: 'S1' }} onClose={jest.fn()} onSaved={jest.fn()} />);
    fireEvent.change(screen.getByDisplayValue('wrong@gmail.com'), { target: { value: 'real@mit.edu' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(fetchSpy).toHaveBeenCalledWith('/api/reviewer-finder/my-candidates', expect.objectContaining({ method: 'PATCH' }));
  });
});
