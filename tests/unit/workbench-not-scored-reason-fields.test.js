/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import NotScoredReasonFields from '../../shared/components/workbench/NotScoredReasonFields';
import { TRIAGE_REASONS, OTHER_TRIAGE_REASON } from '../../shared/config/triageReasons';

it('keeps the five existing choices and offers three additions; only Other shows free text', () => {
  const props = { reason: null, otherRationale: 'Existing explanation', options: TRIAGE_REASONS.map(o => ({ ...o, available: true })), onReasonChange: jest.fn(), onOtherRationaleChange: jest.fn() };
  const view = render(<NotScoredReasonFields {...props} />);
  expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['Select a reason',
    'Too applied/translational', 'Limited impact', 'Continuation/incremental', 'Basic science question unclear',
    'Implementation/risk', 'Overlap with existing funding', 'Overlap with a recent Keck award', 'Other']);
  expect(screen.queryByRole('textbox')).toBeNull();
  fireEvent.change(screen.getByRole('combobox', { name: 'Reason' }), { target: { value: String(OTHER_TRIAGE_REASON) } });
  expect(props.onReasonChange).toHaveBeenCalledWith(OTHER_TRIAGE_REASON);
  view.rerender(<NotScoredReasonFields {...props} reason={OTHER_TRIAGE_REASON} />);
  expect(screen.getByRole('textbox', { name: 'Other rationale' })).toHaveValue('Existing explanation');
  view.rerender(<NotScoredReasonFields {...props} reason={682090004} />);
  expect(screen.queryByRole('textbox')).toBeNull();
});
