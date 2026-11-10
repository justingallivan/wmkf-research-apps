import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import RequestNarrativesCard from '../../shared/components/workbench/RequestNarrativesCard';
import { useRouter } from 'next/router';
import { requestJson } from '../../shared/utils/api-request';
jest.mock('next/router', () => ({ useRouter: jest.fn() }));
jest.mock('../../shared/utils/api-request', () => ({ requestJson: jest.fn() }));
jest.mock('../../shared/components/Layout', () => ({
  Card: ({ children }) => <div>{children}</div>,
  Button: ({ children, loading, variant, ...props }) => <button {...props}>{children}</button>,
}));
const record = { success: true, requestId: 'a', canEdit: true, version: 'W/"1"', lay_abstract: 'External abstract', initial_assessment: 'Existing human assessment' };
beforeEach(() => { jest.resetAllMocks(); useRouter.mockReturnValue({ events: { on: jest.fn(), off: jest.fn(), emit: jest.fn() }, beforePopState: jest.fn() }); requestJson.mockResolvedValue(record); });
test('loading/rendering and typing never auto-save; explicit save patches only edited field', async () => {
  render(<RequestNarrativesCard requestId="a" />);
  const box = await screen.findByLabelText('Lay Abstract');
  fireEvent.change(box, { target: { value: 'Human revision' } });
  expect(requestJson).toHaveBeenCalledTimes(1);
  requestJson.mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ ...record, version: 'W/"2"', lay_abstract: 'Human revision' });
  fireEvent.click(screen.getByText('Save request text'));
  await waitFor(() => expect(requestJson).toHaveBeenCalledTimes(3));
  expect(requestJson.mock.calls[1][1]).toEqual({ method: 'PATCH', body: { requestId: 'a', version: 'W/"1"', changes: { lay_abstract: 'Human revision' } } });
  expect(screen.getByLabelText('Initial Assessment')).toHaveValue('Existing human assessment');
});
test('conflict preserves draft and disables another save until deliberate reload', async () => {
  render(<RequestNarrativesCard requestId="a" />);
  fireEvent.change(await screen.findByLabelText('Lay Abstract'), { target: { value: 'Keep draft' } });
  requestJson.mockRejectedValueOnce(Object.assign(new Error('The request changed.'), { status: 409 }));
  fireEvent.click(screen.getByText('Save request text'));
  expect(await screen.findByRole('alert')).toHaveTextContent('The request changed.');
  expect(screen.getByLabelText('Lay Abstract')).toHaveValue('Keep draft');
  expect(screen.getByText('Save request text')).toBeDisabled();
});
test('save success with failed readback is reported as saved; draft survives', async () => {
  render(<RequestNarrativesCard requestId="a" />);
  fireEvent.change(await screen.findByLabelText('Lay Abstract'), { target: { value: 'Saved revision' } });
  requestJson.mockResolvedValueOnce({ success: true }).mockRejectedValueOnce(new Error('offline'));
  fireEvent.click(screen.getByText('Save request text'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Saved, but');
  expect(screen.getByLabelText('Lay Abstract')).toHaveValue('Saved revision');
  expect(screen.getByText('Save request text')).toBeDisabled();
});
test('late response for previous request cannot replace new request content', async () => {
  let resolveOld;
  requestJson.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  const view = render(<RequestNarrativesCard requestId="a" />);
  requestJson.mockResolvedValueOnce({ ...record, requestId: 'b', lay_abstract: 'Request B' });
  view.rerender(<RequestNarrativesCard requestId="b" />);
  expect(await screen.findByLabelText('Lay Abstract')).toHaveValue('Request B');
  await act(async () => resolveOld(record));
  expect(screen.getByLabelText('Lay Abstract')).toHaveValue('Request B');
});
test('late save does not reload the prior request after navigation', async () => {
  let resolveSave;
  const view = render(<RequestNarrativesCard requestId="a" />);
  fireEvent.change(await screen.findByLabelText('Lay Abstract'), { target: { value: 'A edit' } });
  requestJson.mockImplementationOnce(() => new Promise(resolve => { resolveSave = resolve; }));
  fireEvent.click(screen.getByText('Save request text'));
  requestJson.mockResolvedValueOnce({ ...record, requestId: 'b', lay_abstract: 'B text' });
  view.rerender(<RequestNarrativesCard requestId="b" />);
  expect(await screen.findByLabelText('Lay Abstract')).toHaveValue('B text');
  await act(async () => resolveSave({ success: true }));
  expect(requestJson).toHaveBeenCalledTimes(3);
  expect(screen.getByLabelText('Lay Abstract')).toHaveValue('B text');
});
test('read-only user sees plain text without a save button', async () => {
  requestJson.mockResolvedValueOnce({ ...record, canEdit: false, lay_abstract: '<script>plain</script>' });
  render(<RequestNarrativesCard requestId="a" />);
  expect(await screen.findByText('<script>plain</script>')).toBeInTheDocument();
  expect(screen.queryByText('Save request text')).not.toBeInTheDocument();
});

test('tab navigation asks before discarding a dirty draft and cancels when declined', async () => {
  const handlers = {};
  const router = { events: { on: jest.fn((name, fn) => { handlers[name] = fn; }), off: jest.fn(), emit: jest.fn() }, beforePopState: jest.fn() };
  useRouter.mockReturnValue(router);
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
  render(<RequestNarrativesCard requestId="a" />);
  fireEvent.change(await screen.findByLabelText('Lay Abstract'), { target: { value: 'Unsaved long draft' } });
  expect(() => handlers.routeChangeStart('/workbench/a?tab=proposal', { shallow: true })).toThrow('Unsaved request text');
  expect(confirm).toHaveBeenCalled();
  expect(screen.getByLabelText('Lay Abstract')).toHaveValue('Unsaved long draft');
  expect(router.events.emit).toHaveBeenCalledWith('routeChangeError', expect.objectContaining({ cancelled: true }), '/workbench/a?tab=proposal', { shallow: true });
  confirm.mockReturnValue(true);
  expect(() => handlers.routeChangeStart('/workbench/a?tab=proposal', { shallow: true })).not.toThrow();
  confirm.mockRestore();
});
