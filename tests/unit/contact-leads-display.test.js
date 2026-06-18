/**
 * @jest-environment jsdom
 *
 * Slice 3 — ContactLeads display (docs/REVIEWER_CONTACT_LEADS_SPEC.md §6 Slice 3).
 * Read-only rendering of quarantined contactLeads: high/medium prominent,
 * low/rejected collapsed behind a toggle, each with its not-auto-used reason,
 * deduped against the contact already shown on the card. No promotion action
 * (that is Slice 4).
 */

import { render, screen, fireEvent } from '@testing-library/react';
import ContactLeads, {
  leadSourceLabel,
  leadWarningText,
  visibleLeads,
  partitionLeads,
} from '../../shared/components/reviewers/ContactLeads';

const lead = (over = {}) => ({
  type: 'email', value: 'a@x.edu', source: 'serp_search', confidence: 'rejected',
  persistable: false, rejectedReason: 'verified_domain_contradiction', sourceUrl: null, ...over,
});

describe('pure helpers', () => {
  test('leadSourceLabel maps known sources and falls back', () => {
    expect(leadSourceLabel('serp_search')).toBe('Google search');
    expect(leadSourceLabel('claude_search')).toBe('Claude web search');
    expect(leadSourceLabel('mystery')).toBe('web search');
  });

  test('leadWarningText reflects the rejection reason', () => {
    expect(leadWarningText(lead({ rejectedReason: 'name_mismatch' }))).toMatch(/doesn’t match this name/);
    expect(leadWarningText(lead({ rejectedReason: 'verified_domain_contradiction' }))).toMatch(/verified institution/);
    expect(leadWarningText(lead({ confidence: 'low', rejectedReason: null }))).toMatch(/Unverified lead/);
  });

  test('visibleLeads dedups by (type, value)', () => {
    const leads = [lead({ value: 'dup@x.edu' }), lead({ value: 'dup@x.edu' })];
    expect(visibleLeads(leads)).toEqual([expect.objectContaining({ value: 'dup@x.edu' })]);
  });

  test('visibleLeads suppresses ONLY a non-rejected page/website lead that matches a shown chip', () => {
    const page = { type: 'website', value: 'https://shown.edu', source: 'orcid', confidence: 'low', persistable: false };
    expect(visibleLeads([page], ['https://shown.edu'])).toEqual([]);
  });

  test('visibleLeads hides an email lead that equals the shown email chip (e.g. just promoted)', () => {
    const promoted = lead({ value: 'real@mit.edu' }); // rejected-origin, now the shown email
    expect(visibleLeads([promoted], ['real@mit.edu'])).toEqual([]);
  });

  test('visibleLeads keeps a rejected page sharing the chip URL, and an email with a different value', () => {
    // rejected page sharing the website-chip URL still surfaces (rejection context not on the chip)
    const rejectedPage = { type: 'faculty_page', value: 'https://shown.edu', source: 'serp_search', confidence: 'rejected', rejectedReason: 'identity_anchor_contradiction', persistable: false };
    expect(visibleLeads([rejectedPage], ['https://shown.edu'])).toHaveLength(1);
    // a withheld email NOT matching any shown chip still surfaces
    const otherEmail = lead({ value: 'withheld@ifmo.ru' });
    expect(visibleLeads([otherEmail], ['real@mit.edu', 'https://shown.edu'])).toHaveLength(1);
  });

  test('after promoting the email, the remaining website/page leads stay visible (the bug fix)', () => {
    const leads = [
      lead({ value: 'real@mit.edu' }), // promoted → now the email chip
      { type: 'website', value: 'https://lab.mit.edu', source: 'serp_search', confidence: 'rejected', persistable: false },
      { type: 'faculty_page', value: 'https://mit.edu/~x', source: 'serp_search', confidence: 'rejected', persistable: false },
    ];
    const out = visibleLeads(leads, ['real@mit.edu']); // email now shown, website not yet
    expect(out.map((l) => l.type).sort()).toEqual(['faculty_page', 'website']);
  });

  test('partitionLeads splits prominent vs collapsed and orders best-first', () => {
    const { primary, weak } = partitionLeads([
      lead({ confidence: 'rejected', value: 'r@x.edu' }),
      lead({ confidence: 'medium', value: 'm@x.edu' }),
      lead({ confidence: 'low', value: 'l@x.edu' }),
      lead({ confidence: 'high', value: 'h@x.edu' }),
    ]);
    expect(primary.map((l) => l.value)).toEqual(['h@x.edu', 'm@x.edu']);
    expect(weak.map((l) => l.value)).toEqual(['l@x.edu', 'r@x.edu']);
  });
});

describe('<ContactLeads> render', () => {
  test('renders nothing when there are no leads', () => {
    const { container } = render(<ContactLeads leads={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('rejected leads are collapsed behind a toggle and revealed on click', () => {
    render(<ContactLeads leads={[lead({ value: 'withheld@ifmo.ru' })]} />);
    // header always shown
    expect(screen.getByText(/Possible contact leads/i)).toBeInTheDocument();
    // value hidden until expanded
    expect(screen.queryByText('withheld@ifmo.ru')).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: /Show 1 weak \/ rejected lead/i });
    fireEvent.click(toggle);
    expect(screen.getByText('withheld@ifmo.ru')).toBeInTheDocument();
    expect(screen.getByText(/verified institution/i)).toBeInTheDocument();
  });

  test('a faculty-page lead renders a link and an "Open source" link when sourceUrl differs', () => {
    render(<ContactLeads leads={[{ type: 'faculty_page', value: 'https://u.edu/~p', source: 'serp_search', confidence: 'low', sourceUrl: 'https://google.com/q', persistable: false }]} />);
    fireEvent.click(screen.getByRole('button', { name: /Show 1 weak/i }));
    expect(screen.getByRole('link', { name: 'Faculty page' })).toHaveAttribute('href', 'https://u.edu/~p');
    expect(screen.getByRole('link', { name: /Open source/i })).toHaveAttribute('href', 'https://google.com/q');
  });

  test('a hidden value (already shown as a chip) is not echoed', () => {
    render(<ContactLeads leads={[{ type: 'website', value: 'https://shown.edu', source: 'orcid', confidence: 'low', persistable: false }]} hideValues={['https://shown.edu']} />);
    // only lead was hidden → component renders nothing
    expect(screen.queryByText(/Possible contact leads/i)).not.toBeInTheDocument();
  });

  test('offers no "Use this email" promotion when onUse is absent (read-only / non-manage)', () => {
    render(<ContactLeads leads={[lead()]} />);
    fireEvent.click(screen.getByRole('button', { name: /Show 1 weak/i }));
    expect(screen.queryByRole('button', { name: /use this email/i })).not.toBeInTheDocument();
  });

  test('Slice 4: when onUse is provided, "Use this email" appears and fires with the lead', () => {
    const onUse = jest.fn();
    render(<ContactLeads leads={[lead({ value: 'withheld@ifmo.ru' })]} onUse={onUse} />);
    fireEvent.click(screen.getByRole('button', { name: /Show 1 weak/i }));
    const useBtn = screen.getByRole('button', { name: /use this email/i });
    fireEvent.click(useBtn);
    expect(onUse).toHaveBeenCalledWith(expect.objectContaining({ value: 'withheld@ifmo.ru' }));
  });

  test('Slice 4: a page lead offers "Use this page"', () => {
    const onUse = jest.fn();
    render(<ContactLeads leads={[{ type: 'faculty_page', value: 'https://u.edu/~p', source: 'serp_search', confidence: 'low', persistable: false }]} onUse={onUse} />);
    fireEvent.click(screen.getByRole('button', { name: /Show 1 weak/i }));
    expect(screen.getByRole('button', { name: /use this page/i })).toBeInTheDocument();
  });
});
