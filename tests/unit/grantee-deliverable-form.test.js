/**
 * @jest-environment jsdom
 *
 * GranteeDeliverableForm — the external grantee edit form. Covers the publish
 * waiver SUBMIT GATE (button disabled until the box is checked AND the required
 * fields are present AND the signed render token is present), the versioned
 * waiver text, the multipart submit contract (now echoing the render token), and
 * the thank-you state. The checkbox itself is still a client gate — never sent.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import GranteeDeliverableForm from '../../shared/components/external/GranteeDeliverableForm';

const deliverable = {
  abstractFormatted: 'The team will measure the thing across a long enough sentence to be valid.',
  abstractApproved: null,
  caption: null,
  hasImage: false,
};
const WAIVER_POLICY = { title: 'Publication Consent Waiver', body: 'I, the grantee, consent to publication of the versioned waiver text.', versionId: 'v-1' };
const WAIVER_TOKEN = 'signed.render.token';

const renderForm = (props = {}) => render(
  <GranteeDeliverableForm
    token="tok"
    deliverable={deliverable}
    waiverPolicy={WAIVER_POLICY}
    waiverToken={WAIVER_TOKEN}
    {...props}
  />,
);

function pngFile() {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'fig.png', { type: 'image/png' });
}

afterEach(() => { if (global.fetch && global.fetch.mockRestore) global.fetch.mockRestore(); });

test('renders the VERSIONED waiver text from waiverPolicy (not the hardcoded constant)', () => {
  renderForm();
  expect(screen.getByText(/consent to publication of the versioned waiver text/i)).toBeInTheDocument();
});

test('prefills the abstract and disables submit until waiver + fields are complete', () => {
  renderForm();
  expect(screen.getByLabelText('Abstract')).toHaveValue(deliverable.abstractFormatted);
  const submit = screen.getByRole('button', { name: /^submit$/i });
  expect(submit).toBeDisabled();

  fireEvent.change(screen.getByLabelText('Image caption'), { target: { value: 'A figure.' } });
  fireEvent.change(screen.getByLabelText('Graphical image'), { target: { files: [pngFile()] } });
  expect(submit).toBeDisabled();

  fireEvent.click(screen.getByRole('checkbox'));
  expect(submit).toBeEnabled();
});

test('a missing render token keeps submit disabled even when everything else is complete (defensive gate)', () => {
  renderForm({ waiverToken: null });
  fireEvent.change(screen.getByLabelText('Image caption'), { target: { value: 'A figure.' } });
  fireEvent.change(screen.getByLabelText('Graphical image'), { target: { files: [pngFile()] } });
  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.getByRole('button', { name: /^submit$/i })).toBeDisabled();
});

test('checking the waiver alone does NOT enable submit without an image', () => {
  renderForm();
  fireEvent.change(screen.getByLabelText('Image caption'), { target: { value: 'A figure.' } });
  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.getByRole('button', { name: /^submit$/i })).toBeDisabled();
});

test('an already-on-file image satisfies the image requirement (no re-upload needed)', () => {
  renderForm({ deliverable: { ...deliverable, hasImage: true, caption: 'Existing caption.' } });
  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.getByRole('button', { name: /^submit$/i })).toBeEnabled();
});

test('submit POSTs multipart (echoing the render token) and shows the thank-you state', async () => {
  const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  renderForm({ token: 'tok-123' });

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
  expect(opts.body.has('image')).toBe(true);
  expect(opts.body.get('editedAbstract')).toBe(deliverable.abstractFormatted);
  expect(opts.body.get('caption')).toBe('A figure.');
  // The signed render token IS echoed; the raw checkbox value is NOT.
  expect(opts.body.get('waiverToken')).toBe(WAIVER_TOKEN);
  expect(opts.body.has('waiver')).toBe(false);
});

test('a failed submit surfaces an error and re-enables the button', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, json: async () => ({ error: 'Scan failed.' }) });
  renderForm();
  fireEvent.change(screen.getByLabelText('Image caption'), { target: { value: 'A figure.' } });
  fireEvent.change(screen.getByLabelText('Graphical image'), { target: { files: [pngFile()] } });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: /^submit$/i }));

  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/scan failed/i));
  expect(screen.getByRole('button', { name: /^submit$/i })).toBeEnabled();
});
