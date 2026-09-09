/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import WorkbenchViewsNav from '../../shared/components/workbench/WorkbenchViewsNav';

const labels = () => screen.getAllByRole('link').map((link) => link.textContent.trim());

describe('WorkbenchViewsNav view order', () => {
  const ORDER = ['Request list', 'Reviewer follow-up', 'Initial assessments', 'Final writeups', 'Awardees'];

  test('renders all five views immediately, before the cycle is known', () => {
    render(<WorkbenchViewsNav activeKey="requests" cycleCode={null} />);
    expect(labels()).toEqual(ORDER);
  });

  test('shows Initial assessments for D26 between Reviewer follow-up and Final writeups (owner reversal 2026-09-09)', () => {
    render(<WorkbenchViewsNav activeKey="requests" cycleCode="D26" />);
    expect(labels()).toEqual(ORDER);
    expect(screen.getByRole('link', { name: 'Initial assessments' })).toHaveAttribute('href', '/workbench?view=initial-assessments&cycleCode=D26');
  });

  test('carries a later cycle in the Initial assessments link', () => {
    render(<WorkbenchViewsNav activeKey="requests" cycleCode="J27" />);
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
  test('carries scope for the three scope consumers, but not for Final writeups or Initial assessments', () => {
    render(<WorkbenchViewsNav activeKey="requests" cycleCode="J27" programId="p1" scope="all" />);
    expect(screen.getByRole('link', { name: 'Request list' })).toHaveAttribute('href', '/workbench?programId=p1&cycleCode=J27&scope=all');
    expect(screen.getByRole('link', { name: 'Reviewer follow-up' })).toHaveAttribute('href', '/workbench?view=reviewer-follow-up&programId=p1&cycleCode=J27&scope=all');
    expect(screen.getByRole('link', { name: 'Awardees' })).toHaveAttribute('href', '/workbench?view=awardees&programId=p1&cycleCode=J27&scope=all');
    expect(screen.getByRole('link', { name: 'Final writeups' })).toHaveAttribute('href', '/workbench?view=final-writeups&programId=p1&cycleCode=J27');
    expect(screen.getByRole('link', { name: 'Initial assessments' })).toHaveAttribute('href', '/workbench?view=initial-assessments&programId=p1&cycleCode=J27');
  });

  test('omits scope entirely when it is the default (my)', () => {
    render(<WorkbenchViewsNav activeKey="requests" cycleCode="D26" programId="p1" scope="my" />);
    expect(screen.getByRole('link', { name: 'Awardees' })).toHaveAttribute('href', '/workbench?view=awardees&programId=p1&cycleCode=D26');
  });
});
