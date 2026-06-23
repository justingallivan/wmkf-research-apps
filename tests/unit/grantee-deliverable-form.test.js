/**
 * @jest-environment jsdom
 *
 * GranteeDeliverableForm (chunk 4) — the external grantee edit form. Covers the
 * publish-image waiver SUBMIT GATE (button disabled until the box is checked AND
 * the required fields are present), the multipart submit contract, and the
 * thank-you state. The waiver is a client gate only — it is never sent.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import GranteeDeliverableForm from '../../shared/components/external/GranteeDeliverableForm';

const deliverable = {
  abstractFormatted: 'The team will measure the thing across a long enough sentence to be valid.',
  abstractApproved: null,
  caption: null,
  hasImage: false,
};

function pngFile() {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'fig.png', { type: 'image/png' });
}

afterEach(() => { if (global.fetch && global.fetch.mockRestore) global.fetch.mockRestore(); });

test('prefills the abstract and disables submit until waiver + fields are complete', () => {
  render(<GranteeDeliverableForm token="tok" deliverable={deliverable} />);
  // abstract prefilled from abstractFormatted
  expect(screen.getByLabelText('Abstract')).toHaveValue(deliverable.abstractFormatted);
  const submit = screen.getByRole('button', { name: /^submit$/i });
  // caption empty + no image + waiver unchecked → disabled
  expect(submit).toBeDisabled();

  // fill caption + image, but leave waiver UNCHECKED → still disabled (the gate)
  fireEvent.change(screen.getByLabelText('Image caption'), { target: { value: 'A figure.' } });
  fireEvent.change(screen.getByLabelText('Graphical image'), { target: { files: [pngFile()] } });
  expect(submit).toBeDisabled();

  // check the waiver → now enabled
  fireEvent.click(screen.getByRole('checkbox'));
  expect(submit).toBeEnabled();
});

test('checking the waiver alone does NOT enable submit without an image', () => {
  render(<GranteeDeliverableForm token="tok" deliverable={deliverable} />);
  fireEvent.change(screen.getByLabelText('Image caption'), { target: { value: 'A figure.' } });
  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.getByRole('button', { name: /^submit$/i })).toBeDisabled();
});

test('an already-on-file image satisfies the image requirement (no re-upload needed)', () => {
  render(<GranteeDeliverableForm token="tok" deliverable={{ ...deliverable, hasImage: true, caption: 'Existing caption.' }} />);
  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.getByRole('button', { name: /^submit$/i })).toBeEnabled();
});

test('submit POSTs multipart to the submit route and shows the thank-you state', async () => {
  const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  render(<GranteeDeliverableForm token="tok-123" deliverable={deliverable} />);

  fireEvent.change(screen.getByLabelText('Image caption'), { target: { value: 'A figure.' } });
  fireEvent.change(screen.getByLabelText('Graphical image'), { target: { files: [pngFile()] } });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: /^submit$/i }));

  await waitFor(() => expect(screen.getByText(/your materials have been submitted/i)).toBeInTheDocument());

  expect(fetchSpy).toHaveBeenCalledTimes(1);
  const [url, opts] = fetchSpy.mock.calls[0];
  expect(url).toBe('/api/external/grantee/tok-123/submit');
  expect(opts.method).toBe('POST');
  expect(opts.body).toBeInstanceOf(FormData);
  // waiver is a client gate — it must NOT be in the payload
  expect(opts.body.has('image')).toBe(true);
  expect(opts.body.get('editedAbstract')).toBe(deliverable.abstractFormatted);
  expect(opts.body.get('caption')).toBe('A figure.');
  expect(opts.body.has('waiver')).toBe(false);
});

test('a failed submit surfaces an error and re-enables the button', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, json: async () => ({ error: 'Scan failed.' }) });
  render(<GranteeDeliverableForm token="tok" deliverable={deliverable} />);
  fireEvent.change(screen.getByLabelText('Image caption'), { target: { value: 'A figure.' } });
  fireEvent.change(screen.getByLabelText('Graphical image'), { target: { files: [pngFile()] } });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: /^submit$/i }));

  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/scan failed/i));
  expect(screen.getByRole('button', { name: /^submit$/i })).toBeEnabled();
});
