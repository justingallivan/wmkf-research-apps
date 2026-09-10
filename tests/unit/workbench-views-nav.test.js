/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import WorkbenchViewsNav from '../../shared/components/workbench/WorkbenchViewsNav';

const labels = () => screen.getAllByRole('link').map((link) => link.textContent.trim());

describe('WorkbenchViewsNav view order and cycle-conditional views', () => {
  const D26_ORDER = ['Request list', 'Reviewer follow-up', 'Staff deliberations', 'Final writeups', 'Awardees'];
  const J27_ORDER = ['Request list', 'Reviewer follow-up', 'Staff deliberations', 'Initial assessments', 'Final writeups', 'Awardees'];

  test('holds back Initial assessments until the cycle is known, but renders every other view immediately', () => {
    render(<WorkbenchViewsNav activeKey="requests" cycleCode={null} />);
    expect(labels()).toEqual(D26_ORDER);
  });

  test('D26: Staff deliberations sits between Reviewer follow-up and Final writeups; Initial assessments is hidden', () => {
    render(<WorkbenchViewsNav activeKey="requests" cycleCode="D26" />);
    expect(labels()).toEqual(D26_ORDER);
    expect(screen.getByRole('link', { name: 'Staff deliberations' })).toHaveAttribute('href', '/workbench?view=staff-deliberations&cycleCode=D26');
    expect(screen.queryByRole('link', { name: /Initial assessments/ })).not.toBeInTheDocument();
  });

  test('a later cycle shows Initial assessments after Staff deliberations, carrying the cycle in the link', () => {
    render(<WorkbenchViewsNav activeKey="requests" cycleCode="J27" />);
    expect(labels()).toEqual(J27_ORDER);
    expect(screen.getByRole('link', { name: 'Initial assessments' })).toHaveAttribute('href', '/workbench?view=initial-assessments&cycleCode=J27');
  });
});

describe('WorkbenchViewsNav shell links', () => {
  test('every view links into the shell with the program and cycle', () => {
    render(<WorkbenchViewsNav activeKey="requests" cycleCode="D26" programId="p1" />);
    expect(screen.getByRole('link', { name: 'Request list' })).toHaveAttribute('href', '/workbench?programId=p1&cycleCode=D26');
    expect(screen.getByRole('link', { name: 'Reviewer follow-up' })).toHaveAttribute('href', '/workbench?view=reviewer-follow-up&programId=p1&cycleCode=D26');
    expect(screen.getByRole('link', { name: 'Awardees' })).toHaveAttribute('href', '/workbench?view=awardees&programId=p1&cycleCode=D26');
    expect(screen.getByRole('link', { name: 'Final writeups' })).toHaveAttribute('href', '/workbench?view=final-writeups&programId=p1&cycleCode=D26');
  });

  test('marks the active view for assistive tech', () => {
    render(<WorkbenchViewsNav activeKey="requests" cycleCode="D26" />);
    expect(screen.getByRole('link', { name: 'Request list' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Awardees' })).not.toHaveAttribute('aria-current');
  });
});

describe('WorkbenchViewsNav scope preservation', () => {
  test('carries scope for the four scope consumers, but not for Final writeups or Initial assessments', () => {
    render(<WorkbenchViewsNav activeKey="requests" cycleCode="J27" programId="p1" scope="all" />);
    expect(screen.getByRole('link', { name: 'Request list' })).toHaveAttribute('href', '/workbench?programId=p1&cycleCode=J27&scope=all');
    expect(screen.getByRole('link', { name: 'Reviewer follow-up' })).toHaveAttribute('href', '/workbench?view=reviewer-follow-up&programId=p1&cycleCode=J27&scope=all');
    expect(screen.getByRole('link', { name: 'Awardees' })).toHaveAttribute('href', '/workbench?view=awardees&programId=p1&cycleCode=J27&scope=all');
    expect(screen.getByRole('link', { name: 'Final writeups' })).toHaveAttribute('href', '/workbench?view=final-writeups&programId=p1&cycleCode=J27');
    expect(screen.getByRole('link', { name: 'Initial assessments' })).toHaveAttribute('href', '/workbench?view=initial-assessments&programId=p1&cycleCode=J27');
    expect(screen.getByRole('link', { name: 'Staff deliberations' })).toHaveAttribute('href', '/workbench?view=staff-deliberations&programId=p1&cycleCode=J27&scope=all');
  });

  test('omits scope entirely when it is the default (my)', () => {
    render(<WorkbenchViewsNav activeKey="requests" cycleCode="D26" programId="p1" scope="my" />);
    expect(screen.getByRole('link', { name: 'Awardees' })).toHaveAttribute('href', '/workbench?view=awardees&programId=p1&cycleCode=D26');
  });
});
