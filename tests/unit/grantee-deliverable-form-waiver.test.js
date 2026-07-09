/**
 * @jest-environment jsdom
 *
 * GranteeDeliverableForm waiver UX: the publication waiver is a scroll-gated
 * acknowledgment MODAL (mirroring the reviewer policy modal), not an inline
 * checkbox. Submit stays disabled until the grantee acknowledges; the signed
 * waiverToken (unchanged) still binds the acknowledged version server-side.
 *
 * PolicyAckModal is mocked at its boundary — its scroll-gating/markdown
 * internals ship + are exercised by the reviewer Stage 2a flow; here we verify
 * the FORM's wiring: trigger → open → onAcknowledge → enabled submit.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import GranteeDeliverableForm from '../../shared/components/external/GranteeDeliverableForm';

// Minimal stand-in exposing the two callbacks the form depends on.
jest.mock('../../shared/components/external/PolicyAckModal', () => ({
  __esModule: true,
  default: (props) => (
    <div data-testid="policy-modal">
      <span>{props.policy?.title}</span>
      <button type="button" onClick={props.onAcknowledge}>mock-acknowledge</button>
      <button type="button" onClick={props.onClose}>mock-close</button>
    </div>
  ),
}));

const baseProps = {
  token: 'tok-abc',
  deliverable: {
    abstractFormatted: 'An award abstract long enough to satisfy the non-empty gate.',
    caption: 'A caption describing the image.',
    hasImage: true, // an image is already on file → the image gate is satisfied
  },
  waiverPolicy: {
    title: 'Publication consent',
    body: 'The versioned grantee-waiver body text.',
    versionId: 'c5cc866c-cc7b-f111-ab0f-000d3a306d45',
    versionLabel: '3',
  },
  waiverToken: 'signed.waiver.token',
  onSubmitted: () => {},
};

const submitBtn = () => screen.getByRole('button', { name: /^submit/i });

describe('GranteeDeliverableForm — waiver acknowledgment modal', () => {
  test('renders a modal trigger, not a checkbox', () => {
    render(<GranteeDeliverableForm {...baseProps} />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByRole('button', { name: /read waiver/i })).toBeInTheDocument();
    expect(screen.queryByTestId('policy-modal')).toBeNull();
  });

  test('submit is disabled until the waiver is acknowledged, then enabled', () => {
    render(<GranteeDeliverableForm {...baseProps} />);
    // Abstract, caption, and image-on-file are all satisfied — only the waiver gate remains.
    expect(submitBtn()).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /read waiver/i }));
    expect(screen.getByTestId('policy-modal')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'mock-acknowledge' }));
    // Modal closed, acknowledged state shown, submit now enabled.
    expect(screen.queryByTestId('policy-modal')).toBeNull();
    expect(screen.getByText(/✓ Acknowledged/)).toBeInTheDocument();
    expect(submitBtn()).toBeEnabled();
  });

  test('without a waiverToken, acknowledging alone does not enable submit', () => {
    render(<GranteeDeliverableForm {...baseProps} waiverToken={null} />);
    fireEvent.click(screen.getByRole('button', { name: /read waiver/i }));
    fireEvent.click(screen.getByRole('button', { name: 'mock-acknowledge' }));
    expect(submitBtn()).toBeDisabled();
  });
});
