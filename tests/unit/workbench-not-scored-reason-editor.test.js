/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import NotScoredReason from '../../shared/components/workbench/NotScoredReason';
import { requestJson } from '../../shared/utils/api-request';
import { TRIAGE_REASONS, OTHER_TRIAGE_REASON } from '../../shared/config/triageReasons';
jest.mock('../../shared/utils/api-request', () => ({ requestJson: jest.fn() }));
jest.mock('../../shared/components/Layout', () => ({ Button: ({ children, loading, ...props }) => <button {...props} disabled={loading || props.disabled}>{children}</button> }));
const record = { reason: 682090000, notes: 'Original notes', version: 'W/"1"', editable: true, maxLength: 2000, options: TRIAGE_REASONS.map(o => ({ ...o, available: true })) };
beforeEach(() => { jest.resetAllMocks(); });
it('preserves existing notes on a standard reason save and adopts concurrently refreshed notes before editing Other', async () => {
  let resolveRead;
  requestJson.mockResolvedValueOnce(record).mockResolvedValueOnce({ success: true }).mockImplementationOnce(() => new Promise(resolve => { resolveRead = resolve; }));
  render(<NotScoredReason requestId="a" active onSaved={jest.fn()} />);
  await screen.findByText('Original notes');
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '682090001' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save reason' }));
  await waitFor(() => expect(resolveRead).toBeDefined());
  expect(requestJson.mock.calls[1][1].body).not.toHaveProperty('notes');
  await act(async () => resolveRead({ ...record, reason: 682090001, notes: 'Concurrent new notes', version: 'W/"3"' }));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: String(OTHER_TRIAGE_REASON) } });
  expect(screen.getByRole('textbox')).toHaveValue('Concurrent new notes');
});
it('retains Other drafts while standard reasons preserve saved notes', async () => {
  requestJson.mockResolvedValue(record);
  const view = render(<NotScoredReason requestId="a" active onSaved={jest.fn()} />);
  await screen.findByText('Original notes');
  fireEvent.change(screen.getByRole('combobox'), { target: { value: String(OTHER_TRIAGE_REASON) } });
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Draft notes' } });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '682090001' } });
  expect(screen.getByText('Original notes')).toBeVisible();
  view.rerender(<NotScoredReason requestId="a" active={false} onSaved={jest.fn()} />);
  expect(screen.queryByRole('combobox')).toBeNull();
  view.rerender(<NotScoredReason requestId="a" active onSaved={jest.fn()} />);
  await waitFor(() => expect(screen.getByRole('combobox')).not.toBeDisabled());
  fireEvent.change(screen.getByRole('combobox'), { target: { value: String(OTHER_TRIAGE_REASON) } });
  expect(screen.getByRole('textbox')).toHaveValue('Draft notes');
});
it('ignores stale reads after leaving the editor', async () => {
  let resolveRead;
  requestJson.mockImplementation(() => new Promise(resolve => { resolveRead = resolve; }));
  const view = render(<NotScoredReason requestId="a" active onSaved={jest.fn()} />);
  view.unmount();
  await act(async () => resolveRead(record));
  expect(screen.queryByText('Original notes')).toBeNull();
});
