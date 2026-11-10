import { buildWorkbenchHref, readWorkbenchQuery, resolveWorkbenchView, isStageLayout, WORKBENCH_LOCATION_KEYS } from '../../shared/components/workbench/workbench-location';

describe('readWorkbenchQuery', () => {
  test('defaults: Request list, server program, unresolved cycle, my requests, Set Aside hidden', () => {
    expect(readWorkbenchQuery({})).toEqual({ view: 'requests', programId: '', cycleCode: '', scope: 'my', scopeSet: false, includeSetAside: false, reviewersView: 'attention', search: '', writeupsView: 'needs-review', pd: '', uncycled: false, section: '', showing: 'open', standing: '', showClosed: false });
  });

  test('reads every key, normalizing the cycle code and rejecting unknown values', () => {
    expect(readWorkbenchQuery({ view: 'awardees', programId: 'p1', cycleCode: ' d26 ', scope: 'all', setAside: '1' }))
      .toEqual({ view: 'awardees', programId: 'p1', cycleCode: 'D26', scope: 'all', scopeSet: true, includeSetAside: true, reviewersView: 'attention', search: '', writeupsView: 'needs-review', pd: '', uncycled: false, section: '', showing: 'open', standing: '', showClosed: false });
    expect(readWorkbenchQuery({ view: 'nope', cycleCode: 'M27', scope: 'theirs', setAside: 'yes' }))
      .toEqual({ view: 'requests', programId: '', cycleCode: '', scope: 'my', scopeSet: false, includeSetAside: false, reviewersView: 'attention', search: '', writeupsView: 'needs-review', pd: '', uncycled: false, section: '', showing: 'open', standing: '', showClosed: false });
  });

  test('Final writeups keys: view whitelist, pd canonical GUID (invalid dropped), uncycled flag', () => {
    expect(readWorkbenchQuery({ writeups: 'reviewed', pd: ' 33333333-3333-4333-8333-333333333331 '.toUpperCase(), uncycled: '1' }))
      .toMatchObject({ writeupsView: 'reviewed', pd: '33333333-3333-4333-8333-333333333331', uncycled: true });
    expect(readWorkbenchQuery({ writeups: 'bogus', pd: 'not-a-guid', uncycled: 'yes' }))
      .toMatchObject({ writeupsView: 'needs-review', pd: '', uncycled: false });
    expect(buildWorkbenchHref({ view: 'final-writeups', writeupsView: 'needs-review', pd: '', uncycled: false })).toBe('/workbench?view=final-writeups');
  });

  test('accepts repeated keys (first wins) and URLSearchParams', () => {
    expect(readWorkbenchQuery({ cycleCode: ['J27', 'D26'] }).cycleCode).toBe('J27');
    expect(readWorkbenchQuery(new URLSearchParams('view=reviewer-follow-up&cycleCode=j27')))
      .toMatchObject({ view: 'reviewer-follow-up', cycleCode: 'J27' });
  });
});

describe('buildWorkbenchHref', () => {
  test('omits defaults so the canonical address stays short', () => {
    expect(buildWorkbenchHref({})).toBe('/workbench');
    expect(buildWorkbenchHref({ view: 'requests', scope: 'my', includeSetAside: false })).toBe('/workbench');
  });

  test('round-trips through readWorkbenchQuery', () => {
    const state = { view: 'reviewer-follow-up', programId: 'p2', cycleCode: 'D26', scope: 'all', scopeSet: true, includeSetAside: true, reviewersView: 'all', search: 'south university', writeupsView: 'all', pd: '33333333-3333-4333-8333-333333333331', uncycled: true, section: '', showing: 'open', standing: '', showClosed: false };
    const href = buildWorkbenchHref(state);
    expect(href).toBe('/workbench?view=reviewer-follow-up&programId=p2&cycleCode=D26&scope=all&setAside=1&reviewers=all&q=south+university&writeups=all&pd=33333333-3333-4333-8333-333333333331&uncycled=1');
    expect(readWorkbenchQuery(new URL(href, 'http://x').searchParams)).toEqual(state);
  });
});

describe('J27 Research layout keys', () => {
  const RESEARCH = '94cab30b-958f-ee11-8179-000d3a341e8f';

  test('every key the shell compares round-trips, including an explicit "Assigned to me"', () => {
    const state = {
      view: 'peer-review', programId: RESEARCH, cycleCode: 'J27', scope: 'my', scopeSet: true, includeSetAside: false,
      reviewersView: 'attention', search: 'northfield', writeupsView: 'needs-review', pd: '', uncycled: false,
      section: 'reviewers', showing: 'not-invited', standing: 'scored', showClosed: true,
    };
    expect(Object.keys(state).sort()).toEqual([...WORKBENCH_LOCATION_KEYS].sort());
    const href = buildWorkbenchHref(state);
    expect(href).toBe(`/workbench?view=peer-review&programId=${RESEARCH}&cycleCode=J27&scope=my&q=northfield&section=reviewers&showing=not-invited&standing=scored&closed=1`);
    expect(readWorkbenchQuery(new URL(href, 'http://x').searchParams)).toEqual(state);
  });

  test('no scope in the address means no choice was made; unknown filter values fall back to defaults', () => {
    expect(readWorkbenchQuery({ view: 'initial-assessment' })).toMatchObject({ view: 'initial-assessment', scope: 'my', scopeSet: false });
    expect(readWorkbenchQuery({ scope: 'my' })).toMatchObject({ scope: 'my', scopeSet: true });
    expect(readWorkbenchQuery({ section: 'x', showing: 'open', standing: 'nope', closed: 'yes' }))
      .toMatchObject({ section: '', showing: 'open', standing: '', showClosed: false });
    expect(buildWorkbenchHref({ view: 'requests', scope: 'my', scopeSet: false, showing: 'open', standing: '', showClosed: false, section: '' })).toBe('/workbench');
  });

  test('the layout follows the stage model cycle test and the server-named programs', () => {
    expect(isStageLayout({ cycleCode: 'J27', programId: RESEARCH.toUpperCase(), stageProgramIds: [RESEARCH] })).toBe(true);
    expect(isStageLayout({ cycleCode: 'D27', programId: RESEARCH, stageProgramIds: [RESEARCH] })).toBe(true);
    expect(isStageLayout({ cycleCode: 'D26', programId: RESEARCH, stageProgramIds: [RESEARCH] })).toBe(false);
    expect(isStageLayout({ cycleCode: 'J27', programId: 'other', stageProgramIds: [RESEARCH] })).toBe(false);
    expect(isStageLayout({ cycleCode: 'J27', programId: RESEARCH, stageProgramIds: [] })).toBe(false);
    expect(isStageLayout({ cycleCode: '', programId: RESEARCH, stageProgramIds: [RESEARCH] })).toBe(false);
  });

  test('an old link lands on the matching tab in the new layout', () => {
    const to = (view, extra = {}) => resolveWorkbenchView({ view, ...extra }, true);
    expect(to('requests')).toEqual({ view: 'requests', section: '' });
    expect(to('reviewer-follow-up')).toEqual({ view: 'peer-review', section: 'reviewers' });
    expect(to('staff-deliberations')).toEqual({ view: 'deliberations', section: '' });
    expect(to('initial-assessments')).toEqual({ view: 'initial-assessment', section: '' });
    expect(to('final-writeups')).toEqual({ view: 'final-assessment', section: '' });
    expect(to('awardees')).toEqual({ view: 'awardees', section: '' });
    expect(to('peer-review', { section: 'reviewers' })).toEqual({ view: 'peer-review', section: 'reviewers' });
    expect(to('initial-assessment', { section: 'reviewers' })).toEqual({ view: 'initial-assessment', section: '' });
    expect(to('nope')).toEqual({ view: 'requests', section: '' });
  });

  test('a new link lands on the nearest of today\'s views for an earlier cycle or another program', () => {
    const from = (view, extra = {}) => resolveWorkbenchView({ view, ...extra }, false);
    expect(from('initial-assessment')).toEqual({ view: 'requests', section: '' });
    expect(from('peer-review')).toEqual({ view: 'requests', section: '' });
    expect(from('peer-review', { section: 'reviewers' })).toEqual({ view: 'reviewer-follow-up', section: '' });
    expect(from('deliberations')).toEqual({ view: 'staff-deliberations', section: '' });
    expect(from('final-assessment')).toEqual({ view: 'final-writeups', section: '' });
    for (const view of ['requests', 'reviewer-follow-up', 'staff-deliberations', 'initial-assessments', 'final-writeups', 'awardees']) {
      expect(from(view)).toEqual({ view, section: '' });
    }
  });
});
