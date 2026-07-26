/**
 * @jest-environment jsdom
 */

import { render, screen } from '@testing-library/react';
import AcceptedConfirmationView from '../../shared/components/external/AcceptedConfirmationView';

describe('AcceptedConfirmationView', () => {
  it('offers a subdued self-service withdrawal section on a later visit', () => {
    const onRequestDecline = jest.fn();
    render(
      <AcceptedConfirmationView
        onRequestDecline={onRequestDecline}
      />,
    );

    expect(screen.getByRole('heading', { name: /confirmed as a reviewer/i })).toBeInTheDocument();
    expect(screen.getByText('Need to change your response?')).toBeInTheDocument();
    screen.getByRole('button', { name: /I can no longer review/i }).click();
    expect(onRequestDecline).toHaveBeenCalledTimes(1);
  });

  it('keeps the immediate post-accept screen confirmatory', () => {
    render(
      <AcceptedConfirmationView
        onRequestDecline={jest.fn()}
        showWithdrawalOption={false}
      />,
    );

    expect(screen.getByRole('heading', { name: /confirmed as a reviewer/i })).toBeInTheDocument();
    expect(screen.queryByText('Need to change your response?')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /I can no longer review/i })).not.toBeInTheDocument();
    expect(screen.getByText(/secure link in your confirmation email/i)).toBeInTheDocument();
  });

  it('shows the assigned Program Director name and actionable email in parentheses', () => {
    render(
      <AcceptedConfirmationView
        programDirector={{ name: 'Jane Director', email: 'jane.director@wmkeck.org' }}
      />,
    );

    const guidance = screen.getByText(/reach out to your Program Director/i);
    expect(guidance).toHaveTextContent(
      'Program Director (Jane Director, jane.director@wmkeck.org)',
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

    expect(screen.getByText(/reach out to your Program Director/i))
      .not.toHaveTextContent('Jane Director');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
