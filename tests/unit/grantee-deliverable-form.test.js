/**
 * @jest-environment jsdom
 *
 * GranteeDeliverableForm — the external grantee edit form. Covers the publish
 * waiver SUBMIT GATE (button disabled until the waiver is acknowledged AND the
 * required fields are present AND the signed render token is present), the
 * versioned waiver text, the multipart submit contract (now echoing the render
 * token), and the thank-you state.
 *
 * As of S351 the inline checkbox was replaced by the scroll-gated PolicyAckModal
 * (see grantee-deliverable-form-waiver.test.js for the modal-wiring test).
 * PolicyAckModal is mocked at its boundary here too, so acknowledgment is
 * "click Read waiver, then click the mock's acknowledge button" instead of
 * "click the checkbox". The signed waiverToken (never the raw acknowledgment)
 * is still what's sent to the server.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import GranteeDeliverableForm from '../../shared/components/external/GranteeDeliverableForm';

// Minimal stand-in exposing the two callbacks the form depends on (mirrors
// grantee-deliverable-form-waiver.test.js's mocking pattern).
jest.mock('../../shared/components/external/PolicyAckModal', () => ({
  __esModule: true,
  default: (props) => (
    <div data-testid="policy-modal">
      <span>{props.policy?.body}</span>
      <button type="button" onClick={props.onAcknowledge}>mock-acknowledge</button>
      <button type="button" onClick={props.onClose}>mock-close</button>
    </div>
  ),
}));

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

const submitBtn = () => screen.getByRole('button', { name: /^submit$/i });

// Acknowledge via the mocked PolicyAckModal: open it, then click its acknowledge
// button — mirrors the real "Read waiver" → scroll-gate → acknowledge flow that
// grantee-deliverable-form-waiver.test.js exercises against the real modal wiring.
function acknowledgeWaiver() {
  fireEvent.click(screen.getByRole('button', { name: /read waiver/i }));
  fireEvent.click(screen.getByRole('button', { name: 'mock-acknowledge' }));
}

test('renders the VERSIONED waiver text from waiverPolicy (not the hardcoded constant)', () => {
  renderForm();
  fireEvent.click(screen.getByRole('button', { name: /read waiver/i }));
  expect(screen.getByText(/consent to publication of the versioned waiver text/i)).toBeInTheDocument();
});

test('prefills the abstract and disables submit until waiver + fields are complete', () => {
  renderForm();
  expect(screen.getByLabelText('Abstract')).toHaveValue(deliverable.abstractFormatted);
  const submit = submitBtn();
  expect(submit).toBeDisabled();

  fireEvent.change(screen.getByLabelText('Image caption'), { target: { value: 'A figure.' } });
  fireEvent.change(screen.getByLabelText('Graphical image'), { target: { files: [pngFile()] } });
  expect(submit).toBeDisabled();

  acknowledgeWaiver();
  expect(submit).toBeEnabled();
});

test('a missing render token keeps submit disabled even when everything else is complete (defensive gate)', () => {
  renderForm({ waiverToken: null });
  fireEvent.change(screen.getByLabelText('Image caption'), { target: { value: 'A figure.' } });
  fireEvent.change(screen.getByLabelText('Graphical image'), { target: { files: [pngFile()] } });
  acknowledgeWaiver();
  expect(submitBtn()).toBeDisabled();
});

test('checking the waiver alone does NOT enable submit without an image', () => {
  renderForm();
  fireEvent.change(screen.getByLabelText('Image caption'), { target: { value: 'A figure.' } });
  acknowledgeWaiver();
  expect(submitBtn()).toBeDisabled();
});

test('an already-on-file image satisfies the image requirement (no re-upload needed)', () => {
  renderForm({ deliverable: { ...deliverable, hasImage: true, caption: 'Existing caption.' } });
  acknowledgeWaiver();
  expect(submitBtn()).toBeEnabled();
});

test('submit POSTs multipart (echoing the render token) and shows the thank-you state', async () => {
  const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  renderForm({ token: 'tok-123' });

  fireEvent.change(screen.getByLabelText('Image caption'), { target: { value: 'A figure.' } });
  fireEvent.change(screen.getByLabelText('Graphical image'), { target: { files: [pngFile()] } });
  acknowledgeWaiver();
  fireEvent.click(submitBtn());

  await waitFor(() => expect(screen.getByText(/your materials have been submitted/i)).toBeInTheDocument());

  expect(fetchSpy).toHaveBeenCalledTimes(1);
  const [url, opts] = fetchSpy.mock.calls[0];
  expect(url).toBe('/api/external/grantee/tok-123/submit');
  expect(opts.method).toBe('POST');
  expect(opts.body).toBeInstanceOf(FormData);
  expect(opts.body.has('image')).toBe(true);
  expect(opts.body.get('editedAbstract')).toBe(deliverable.abstractFormatted);
  expect(opts.body.get('caption')).toBe('A figure.');
  // The signed render token IS echoed; the raw acknowledgment is NOT.
  expect(opts.body.get('waiverToken')).toBe(WAIVER_TOKEN);
  expect(opts.body.has('waiver')).toBe(false);
});

test('a failed submit surfaces an error and re-enables the button', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, json: async () => ({ error: 'Scan failed.' }) });
  renderForm();
  fireEvent.change(screen.getByLabelText('Image caption'), { target: { value: 'A figure.' } });
  fireEvent.change(screen.getByLabelText('Graphical image'), { target: { files: [pngFile()] } });
  acknowledgeWaiver();
  fireEvent.click(submitBtn());

  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/scan failed/i));
  expect(submitBtn()).toBeEnabled();
});
