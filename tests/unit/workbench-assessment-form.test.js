/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AssessmentForm from '../../shared/components/workbench/AssessmentForm';
import { requestJson } from '../../shared/utils/api-request';
import { TRIAGE_REASONS, OTHER_TRIAGE_REASON } from '../../shared/config/triageReasons';
jest.mock('../../shared/utils/api-request', () => ({ requestJson: jest.fn() }));
jest.mock('../../shared/components/Layout', () => ({ Button: ({ children, loading, ...props }) => <button {...props} disabled={props.disabled || loading}>{children}</button> }));
const record = { decision: '', decisionEditable: true, rationale: 'Saved rationale', reason: 682090000, notes: 'Saved notes', version: 'W/"1"', maxLength: 2000, options: TRIAGE_REASONS.map(o => ({ ...o, available: true })) };
const onSaved = jest.fn();
beforeEach(() => { jest.resetAllMocks(); requestJson.mockResolvedValue(record); });
async function open() { render(<AssessmentForm requestId="request" canManage onSaved={onSaved} />); await screen.findByRole('combobox', { name: 'Scoring decision' }); }
const choose = value => fireEvent.change(screen.getByRole('combobox', { name: 'Scoring decision' }), { target: { value } });
it('switches instantly without network calls and retains both text drafts', async () => {
  await open(); choose('yes'); fireEvent.change(screen.getByRole('textbox', { name: 'Staff rationale' }), { target: { value: 'Draft rationale' } });
  choose('no'); fireEvent.change(screen.getByRole('combobox', { name: 'Reason' }), { target: { value: OTHER_TRIAGE_REASON } });
  expect(screen.getByRole('textbox', { name: 'Other rationale' })).toHaveValue('Saved notes');
  fireEvent.change(screen.getByRole('textbox', { name: 'Other rationale' }), { target: { value: 'Draft notes' } });
  choose('yes'); expect(screen.getByRole('textbox', { name: 'Staff rationale' })).toHaveValue('Draft rationale');
  choose('no'); expect(screen.getByRole('textbox', { name: 'Other rationale' })).toHaveValue('Draft notes');
  expect(requestJson).toHaveBeenCalledTimes(1);
  expect(screen.getAllByRole('button', { name: /Save/ })).toHaveLength(1);
});
it('submits decision and reason together only on Save assessment', async () => {
  await open(); choose('no');
  requestJson.mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ ...record, decision: 'no', version: 'W/"2"' });
  fireEvent.click(screen.getByRole('button', { name: 'Save assessment' }));
  await screen.findByText('Assessment saved.');
  expect(requestJson.mock.calls.filter(([, init]) => init?.method === 'POST')).toEqual([[
    '/api/workbench/initial-assessment-rationale', { method: 'POST', body: { requestId: 'request', mode: 'assessment', version: record.version, decision: 'no', reason: record.reason } },
  ]]);
  expect(onSaved).toHaveBeenCalledTimes(1);
});
it('retains hidden notes draft after saving Scored', async () => {
  await open(); choose('no'); fireEvent.change(screen.getByRole('combobox', { name: 'Reason' }), { target: { value: OTHER_TRIAGE_REASON } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Other rationale' }), { target: { value: 'Draft notes' } }); choose('yes');
  requestJson.mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ ...record, decision: 'yes', version: 'W/"2"' });
  fireEvent.click(screen.getByRole('button', { name: 'Save assessment' })); await screen.findByText('Assessment saved.');
  choose('no'); expect(screen.getByRole('textbox', { name: 'Other rationale' })).toHaveValue('Draft notes');
});
it('keeps drafts on conflict and requires explicit reload', async () => {
  await open(); choose('yes'); fireEvent.change(screen.getByRole('textbox', { name: 'Staff rationale' }), { target: { value: 'My draft' } });
  requestJson.mockRejectedValueOnce(Object.assign(new Error('The request changed'), { status: 409 }));
  fireEvent.click(screen.getByRole('button', { name: 'Save assessment' })); await screen.findByRole('alert');
  expect(screen.getByRole('textbox', { name: 'Staff rationale' })).toHaveValue('My draft');
  expect(screen.getByRole('button', { name: 'Save assessment' })).toBeDisabled();
});
it('blocks a second submit while the first save is pending', async () => {
  await open(); choose('no'); requestJson.mockImplementationOnce(() => new Promise(() => {}));
  const button = screen.getByRole('button', { name: 'Save assessment' }); fireEvent.submit(button.closest('form')); fireEvent.submit(button.closest('form'));
  expect(requestJson.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
});
it('ignores an old request load after the component is replaced', async () => {
  let resolve; requestJson.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const view = render(<AssessmentForm key="old" requestId="old" canManage onSaved={onSaved} />);
  view.rerender(<AssessmentForm key="new" requestId="new" canManage onSaved={onSaved} />);
  await screen.findByRole('combobox', { name: 'Scoring decision' });
  await act(async () => resolve({ ...record, decision: 'yes', rationale: 'Wrong request' }));
  expect(screen.queryByText('Wrong request')).toBeNull();
});
it('does not silently overwrite notes changed by someone else while a hidden draft exists', async () => {
  await open(); choose('no'); fireEvent.change(screen.getByRole('combobox', { name: 'Reason' }), { target: { value: OTHER_TRIAGE_REASON } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Other rationale' }), { target: { value: 'Local draft' } }); choose('yes');
  requestJson.mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ ...record, decision: 'yes', notes: 'Concurrent update', version: 'W/"3"' });
  fireEvent.click(screen.getByRole('button', { name: 'Save assessment' })); await screen.findByRole('alert');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save assessment' })).toBeDisabled());
  choose('no'); expect(screen.getByRole('textbox', { name: 'Other rationale' })).toHaveValue('Local draft');
});
it('keeps the submitted text if another writer changes it before readback', async () => {
  await open(); choose('yes'); fireEvent.change(screen.getByRole('textbox', { name: 'Staff rationale' }), { target: { value: 'My submitted draft' } });
  requestJson.mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ ...record, decision: 'yes', rationale: 'Concurrent replacement', version: 'W/"3"' });
  fireEvent.click(screen.getByRole('button', { name: 'Save assessment' })); await screen.findByRole('alert');
  expect(screen.getByRole('textbox', { name: 'Staff rationale' })).toHaveValue('My submitted draft');
  expect(screen.getByRole('button', { name: 'Save assessment' })).toBeDisabled();
});
