import { buildWorkbenchHref, readWorkbenchQuery } from '../../shared/components/workbench/workbench-location';

describe('readWorkbenchQuery', () => {
  test('defaults: Request list, server program, unresolved cycle, my requests, Set Aside hidden', () => {
    expect(readWorkbenchQuery({})).toEqual({ view: 'requests', programId: '', cycleCode: '', scope: 'my', includeSetAside: false });
  });

  test('reads every key, normalizing the cycle code and rejecting unknown values', () => {
    expect(readWorkbenchQuery({ view: 'awardees', programId: 'p1', cycleCode: ' d26 ', scope: 'all', setAside: '1' }))
      .toEqual({ view: 'awardees', programId: 'p1', cycleCode: 'D26', scope: 'all', includeSetAside: true });
    expect(readWorkbenchQuery({ view: 'nope', cycleCode: 'M27', scope: 'theirs', setAside: 'yes' }))
      .toEqual({ view: 'requests', programId: '', cycleCode: '', scope: 'my', includeSetAside: false });
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
    const state = { view: 'final-writeups', programId: 'p2', cycleCode: 'D26', scope: 'all', includeSetAside: true };
    const href = buildWorkbenchHref(state);
    expect(href).toBe('/workbench?view=final-writeups&programId=p2&cycleCode=D26&scope=all&setAside=1');
    expect(readWorkbenchQuery(new URL(href, 'http://x').searchParams)).toEqual(state);
  });
});
