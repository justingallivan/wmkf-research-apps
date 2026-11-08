/** @jest-environment jsdom */

import { act, fireEvent, render, screen } from '@testing-library/react';
import FirstCutCard from '../../shared/components/workbench/FirstCutCard';
import { FIRST_CUT_STATUS } from '../../shared/config/j27FirstCut';
import { requestJson } from '../../shared/utils/api-request';

jest.mock('../../shared/utils/api-request', () => ({ requestJson: jest.fn() }));
jest.mock('../../shared/components/Layout', () => ({ Card: ({ children }) => <div>{children}</div> }));

const context = {
  requestId: '11111111-1111-4111-8111-111111111111',
  requestVersion: 'W/"123"',
  phaseIStatus: FIRST_CUT_STATUS.yes,
  phaseIStatusLabel: 'Scored',
};

beforeEach(() => requestJson.mockReset());

test('selecting a decision saves once and shows confirmation after the request refreshes', async () => {
  let finishSave;
  let finishRefresh;
  requestJson.mockImplementation(() => new Promise(resolve => { finishSave = resolve; }));
  const refresh = jest.fn(() => new Promise(resolve => { finishRefresh = resolve; }));
  const view = render(<FirstCutCard context={context} canManage refresh={refresh} />);
  const select = screen.getByRole('combobox', { name: 'First Cut decision' });

  expect(screen.queryByRole('button', { name: 'Save First Cut' })).toBeNull();
  fireEvent.change(select, { target: { value: 'no' } });
  expect(requestJson).toHaveBeenCalledTimes(1);
  expect(requestJson).toHaveBeenCalledWith('/api/workbench/first-cut', expect.objectContaining({
    method: 'POST',
    body: { requestId: context.requestId, decision: 'no', version: context.requestVersion },
  }));
  expect(select).toHaveValue('no');
  expect(select).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('Saving First Cut');

  await act(async () => { finishSave({ success: true }); });
  expect(select).toBeDisabled();
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => {
    view.rerender(<FirstCutCard context={{
      ...context, phaseIStatus: FIRST_CUT_STATUS.no, phaseIStatusLabel: 'Not Scored',
      requestVersion: 'W/"124"',
    }} canManage refresh={refresh} />);
    finishRefresh();
  });
  expect(select).toBeEnabled();
  expect(select).toHaveValue('no');
  expect(screen.getByRole('status')).toHaveTextContent('First Cut saved.');
});

test('a failed save restores the last saved choice and explains the conflict', async () => {
  requestJson.mockRejectedValue(Object.assign(new Error('Changed'), { status: 409 }));
  const refresh = jest.fn().mockResolvedValue(undefined);
  render(<FirstCutCard context={context} canManage refresh={refresh} />);
  const select = screen.getByRole('combobox', { name: 'First Cut decision' });

  await act(async () => { fireEvent.change(select, { target: { value: 'no' } }); });
  expect(select).toHaveValue('yes');
  expect(select).toBeEnabled();
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('alert')).toHaveTextContent('The request changed');
  expect(screen.queryByText('First Cut saved.')).toBeNull();
});
