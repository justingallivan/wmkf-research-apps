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

  it('shows the assigned Program Director name and actionable email in parentheses', () => {
    render(
      <AcceptedConfirmationView
        programDirector={{ name: 'Jane Director', email: 'jane.director@wmkeck.org' }}
      />,
    );

    const guidance = screen.getByText(/please reach out to your Program Director/i);
    expect(guidance).toHaveTextContent(
      'Program Director (Jane Director, jane.director@wmkeck.org) rather than',
    );
    expect(screen.getByRole('link', { name: 'jane.director@wmkeck.org' }))
      .toHaveAttribute('href', 'mailto:jane.director@wmkeck.org');
  });

  it('keeps the generic guidance when the contact is incomplete', () => {
    render(
      <AcceptedConfirmationView
        programDirector={{ name: 'Jane Director', email: '' }}
      />,
    );

    expect(screen.getByText(/please reach out to your Program Director/i))
      .not.toHaveTextContent('Jane Director');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
