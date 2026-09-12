/**
 * `/meeting-tracker/sessions` and `/meeting-tracker/visits` have no index of
 * their own; both redirect to the dashboard and keep only its filter keys.
 */
import * as sessions from '../../pages/meeting-tracker/sessions/index';
import * as visits from '../../pages/meeting-tracker/visits/index';

describe.each([['sessions', sessions], ['visits', visits]])('/meeting-tracker/%s index', (_name, page) => {
  test('redirects to the dashboard with no query', async () => {
    await expect(page.getServerSideProps({ query: {} })).resolves.toEqual({
      redirect: { destination: '/meeting-tracker', permanent: false },
    });
  });

  test('keeps cycleCode and programId, drops everything else, takes the first of a repeated key', async () => {
    const result = await page.getServerSideProps({ query: { cycleCode: ['J27', 'J26'], programId: ' p1 ', requestId: 'r', view: 'x' } });
    expect(result.redirect.destination).toBe('/meeting-tracker?cycleCode=J27&programId=p1');
  });

  test('renders nothing', () => {
    expect(page.default()).toBeNull();
  });
});
