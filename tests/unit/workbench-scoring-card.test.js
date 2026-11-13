/** @jest-environment jsdom */

import { act, fireEvent, render, screen } from '@testing-library/react';
import ScoringCard from '../../shared/components/workbench/ScoringCard';
import { SCORING_STATUS } from '../../shared/config/j27Scoring';
import { requestJson } from '../../shared/utils/api-request';

jest.mock('../../shared/utils/api-request', () => ({ requestJson: jest.fn() }));
jest.mock('../../shared/components/Layout', () => ({
  Card: ({ children }) => <div>{children}</div>,
  Button: ({ children, loading, size, ...props }) => <button {...props}>{children}</button>,
}));

const context = {
  requestId: '11111111-1111-4111-8111-111111111111',
  requestVersion: 'W/"123"',
  phaseIStatus: SCORING_STATUS.yes,
  phaseIStatusLabel: 'Scored',
};

beforeEach(() => requestJson.mockReset());

test('selecting a decision saves once and shows confirmation after the request refreshes', async () => {
  let finishSave;
  let finishRefresh;
  requestJson.mockImplementation(() => new Promise(resolve => { finishSave = resolve; }));
  const refresh = jest.fn(() => new Promise(resolve => { finishRefresh = resolve; }));
  const view = render(<ScoringCard context={context} canManage refresh={refresh} />);
  const select = screen.getByRole('combobox', { name: 'Scoring decision' });

  expect(screen.queryByRole('button', { name: 'Save Scoring' })).toBeNull();
  fireEvent.change(select, { target: { value: 'no' } });
  expect(requestJson).toHaveBeenCalledTimes(1);
  expect(requestJson).toHaveBeenCalledWith('/api/workbench/scoring', expect.objectContaining({
    method: 'POST',
    body: { requestId: context.requestId, decision: 'no', version: context.requestVersion },
  }));
  expect(select).toHaveValue('no');
  expect(select).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('Saving Scoring');

  await act(async () => { finishSave({ success: true }); });
  expect(select).toBeDisabled();
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => {
    view.rerender(<ScoringCard context={{
      ...context, phaseIStatus: SCORING_STATUS.no, phaseIStatusLabel: 'Not Scored',
      requestVersion: 'W/"124"',
    }} canManage refresh={refresh} />);
    finishRefresh();
  });
  expect(select).toBeEnabled();
  expect(select).toHaveValue('no');
  expect(screen.getByRole('status')).toHaveTextContent('Scoring saved.');
});

test('a failed save restores the last saved choice and explains the conflict', async () => {
  requestJson.mockRejectedValue(Object.assign(new Error('Changed'), { status: 409 }));
  const refresh = jest.fn().mockResolvedValue(undefined);
  render(<ScoringCard context={context} canManage refresh={refresh} />);
  const select = screen.getByRole('combobox', { name: 'Scoring decision' });

  await act(async () => { fireEvent.change(select, { target: { value: 'no' } }); });
  expect(select).toHaveValue('yes');
  expect(select).toBeEnabled();
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('alert')).toHaveTextContent('The request changed');
  expect(screen.queryByText('Scoring saved.')).toBeNull();
});

test('the recommendation dropdown saves immediately and keeps screen uncertainty separate', async () => {
  requestJson.mockResolvedValue({ success: true, automaticScreen: 'unconfirmed' });
  render(<ScoringCard context={context} canManage refresh={jest.fn()} chairsRecommendation automaticIntegrityEnabled />);
  expect(screen.getByText(/schedules an Integrity Screen in the background/)).toBeVisible();
  await act(async () => { fireEvent.change(screen.getByRole('combobox', { name: 'Recommendation' }), { target: { value: 'yes' } }); });
  expect(requestJson).toHaveBeenCalledTimes(1);
  expect(requestJson).toHaveBeenCalledWith('/api/workbench/scoring', expect.objectContaining({
    body: { requestId: context.requestId, decision: 'yes', version: context.requestVersion, stage: 'chairs-recommendation' },
  }));
  expect(screen.getByRole('status')).toHaveTextContent('Recommendation saved.');
  expect(screen.getByRole('alert')).toHaveTextContent('automatic Integrity Screen could not be confirmed');
});

test('a read-only card says why only when authority is what is missing', () => {
  const view = render(<ScoringCard context={context} canManage={false} refresh={jest.fn()} />);
  expect(screen.getByText('Scoring is read-only. Only the lead Program Director or a superuser can record it.')).toBeInTheDocument();
  view.rerender(<ScoringCard context={context} canManage={false} previewReadOnly refresh={jest.fn()} />);
  expect(screen.getByText('Scoring is read-only on Preview.')).toBeInTheDocument();
  // The lead with no request version cannot save either; that is not an authority problem.
  view.rerender(<ScoringCard context={{ ...context, requestVersion: null }} canManage refresh={jest.fn()} />);
  expect(screen.getByText('Scoring is read-only.')).toBeInTheDocument();
});

test('outside the J27 layout, choosing does not save; only the Save button does', async () => {
  requestJson.mockResolvedValue({ success: true });
  const refresh = jest.fn().mockResolvedValue(undefined);
  render(<ScoringCard context={context} canManage refresh={refresh} explicitSave />);
  const select = screen.getByRole('combobox', { name: 'Scoring decision' });
  const button = screen.getByRole('button', { name: 'Save Scoring' });

  expect(button).toBeDisabled();
  fireEvent.change(select, { target: { value: 'no' } });
  expect(requestJson).not.toHaveBeenCalled();
  expect(select).toHaveValue('no');
  expect(button).toBeEnabled();

  await act(async () => { fireEvent.click(button); });
  expect(requestJson).toHaveBeenCalledTimes(1);
  expect(requestJson).toHaveBeenCalledWith('/api/workbench/scoring', expect.objectContaining({
    method: 'POST',
    body: { requestId: context.requestId, decision: 'no', version: context.requestVersion },
  }));
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('status')).toHaveTextContent('Scoring saved.');
});

test('outside the J27 layout, a failed save returns the selector to the saved choice', async () => {
  requestJson.mockRejectedValue(Object.assign(new Error('Changed'), { status: 409 }));
  render(<ScoringCard context={context} canManage refresh={jest.fn().mockResolvedValue(undefined)} explicitSave />);
  const select = screen.getByRole('combobox', { name: 'Scoring decision' });
  fireEvent.change(select, { target: { value: 'no' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save Scoring' })); });
  expect(requestJson).toHaveBeenCalledTimes(1);
  expect(select).toHaveValue('yes');
  expect(screen.getByRole('alert')).toHaveTextContent('The request changed');
});
