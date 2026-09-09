/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import WorkbenchViewsNav from '../../shared/components/workbench/WorkbenchViewsNav';

jest.mock('next/router', () => ({ useRouter: () => ({ pathname: '/workbench' }) }));

const labels = () => screen.getAllByRole('link').map((link) => link.textContent.trim());

describe('WorkbenchViewsNav cycle-conditional views', () => {
  test('holds back Initial assessments until the cycle is known, but renders every other view immediately', () => {
    render(<WorkbenchViewsNav activeKey="requests" cycleCode={null} />);
    expect(labels()).toEqual(['Request list', 'Reviewer follow-up', 'Final writeups', 'Awardees']);
  });

  test('hides Initial assessments for D26', () => {
    render(<WorkbenchViewsNav activeKey="requests" cycleCode="D26" />);
    expect(screen.queryByRole('link', { name: /Initial assessments/ })).not.toBeInTheDocument();
  });

  test('shows Initial assessments for a later cycle, carrying the cycle in the link', () => {
    render(<WorkbenchViewsNav activeKey="requests" cycleCode="J27" />);
    const link = screen.getByRole('link', { name: /Initial assessments/ });
    expect(link).toHaveAttribute('href', '/workbench/artifacts?cycleCode=J27');
    expect(labels()).toHaveLength(5);
  });
});

describe('WorkbenchViewsNav shell links', () => {
  test('shell-backed views link into the shell with the program and cycle; the rest still open their pages', () => {
    render(<WorkbenchViewsNav activeKey="requests" cycleCode="D26" programId="p1" />);
    expect(screen.getByRole('link', { name: 'Request list' })).toHaveAttribute('href', '/workbench?programId=p1&cycleCode=D26');
    expect(screen.getByRole('link', { name: 'Reviewer follow-up' })).toHaveAttribute('href', '/workbench?view=reviewer-follow-up&programId=p1&cycleCode=D26');
    expect(screen.getByRole('link', { name: 'Awardees' })).toHaveAttribute('href', '/workbench/awardees?cycleCode=D26');
    expect(screen.getByRole('link', { name: 'Final writeups' })).toHaveAttribute('href', '/workbench/final-writeups');
  });

  test('marks the active view for assistive tech', () => {
    render(<WorkbenchViewsNav activeKey="requests" cycleCode="D26" />);
    expect(screen.getByRole('link', { name: 'Request list' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Awardees' })).not.toHaveAttribute('aria-current');
  });
});
