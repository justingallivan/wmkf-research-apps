/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import TestRequestBadge from '../../shared/components/TestRequestBadge';

test('renders the shared TEST badge only for a derived true flag', () => {
  const { rerender } = render(<TestRequestBadge isTestRequest />);
  expect(screen.getByLabelText('Test request')).toHaveTextContent('TEST');
  rerender(<TestRequestBadge isTestRequest={false} />);
  expect(screen.queryByLabelText('Test request')).not.toBeInTheDocument();
});
