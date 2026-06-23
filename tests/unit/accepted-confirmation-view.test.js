/**
 * @jest-environment jsdom
 */

import { render, screen } from '@testing-library/react';
import AcceptedConfirmationView from '../../shared/components/external/AcceptedConfirmationView';

describe('AcceptedConfirmationView', () => {
  it('does not offer self-decline after acceptance even if context is flippable', () => {
    render(
      <AcceptedConfirmationView
        data={{ engagementState: { view: 'accepted-pre-materials', canFlipState: true } }}
        onRequestFlipToDecline={jest.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: /confirmed as a reviewer/i })).toBeInTheDocument();
    expect(screen.queryByText(/Changed your mind/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Switch to declining/i })).not.toBeInTheDocument();
  });
});
